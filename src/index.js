/* istanbul ignore if */
if (!Error.prepareStackTrace) {
	require('source-map-support/register');
}

import fs from 'fs-extra';
import globalModules from 'global-modules';
import got from 'got';
import HookEmitter from 'hook-emitter';
import hostedGitInfo from 'hosted-git-info';
import inly from 'inly';
import pacote from 'pacote';
import path from 'path';
import snooplogg from 'snooplogg';
import tmp from 'tmp';

import { expandPath } from 'appcd-path';
import { isDir, isFile } from 'appcd-fs';
import { run, which } from 'appcd-subprocess';

const { log, warn } = snooplogg('template-kit');
const { highlight } = snooplogg.styles;

const filenameRegExp = /[^\\/]+(\.zip|\.tgz|\.tbz2|\.tar\.gz|\.tar\.bz2|(?<!\.tar)\.gz|(?<!\.tar)\.bz2)$/;

class API {
	constructor(state) {
		try {
			this.metadata = fs.readJsonSync(path.join(state.src, 'package.json'));
		} catch (e) {
			this.metadata = {};
		}
	}
}

export default class TemplateEngine extends HookEmitter {
	/**
	 * Builds a project based on the specified template and options.
	 *
	 * @param {Object} opts - Various options.
	 * @param {String} opts.dest - The destination directory to create the project in.
	 * @param {Boolean} [opts.force] - When `true`, overrides the destination if it already exists.
	 * @param {Boolean} [opts.git=true] - When `true` and `git` executable is found, after the
	 * the project is generated, initialize a git repo in the project directory.
	 * @param {Array.<String>} [opts.npmArgs] - An array of additional parameters to pass into npm.
	 * Useful if you need to add extra arguments for things such as skipping shrinkwrap.
	 * @param {String} opts.src - The path to a directory, archive file, globally installed npm
	 * package, archive URL, npm package name, or git repo.
	 * @returns {Promise}
	 * @access public
	 */
	async run(opts) {
		if (!opts || typeof opts !== 'object') {
			throw new TypeError('Expected options to be an object');
		}

		const state = await this.hook('init', this, this.init)(opts);

		try {
			let installDeps = false;

			if (state.gitInfo = hostedGitInfo.fromUrl(state.src)) {
				await this.gitClone(state);
				installDeps = true;
			} else if (/^https?:\/\//.test(state.src)) {
				await this.download(state);
				installDeps = true;
			}

			if (isFile(state.src)) {
				await this.extract(state);
				installDeps = true;
			}

			if (isDir(state.src)) {
				// pre-existing local directory or result of git clone, file download, or extracted
				// archive
			} else {
				const globalDir = process.env.GLOBAL_NPM_MODULES_DIR || globalModules;
				let globalPackageDir;
				for (const name of fs.readdirSync(globalDir)) {
					try {
						const pkgFile = path.join(globalDir, name, 'package.json');
						if (fs.readJsonSync(pkgFile).name === state.src) {
							globalPackageDir = path.join(globalDir, name);
							break;
						}
					} catch (e) {
						// squelch
					}
				}

				if (globalPackageDir) {
					// global npm package
					// note: we assume global packages already have deps installed
					log(`Found global npm package: ${highlight(globalPackageDir)}`);
					state.src = globalPackageDir;

				} else {
					// remote npm package
					try {
						state.manifest = await pacote.manifest(state.src, { fullMetadata: true });
					} catch (e) {
						throw new Error('Unable to determine template source');
					}

					await this.npmDownload(state);
					installDeps = true;
				}
			}

			log(`Creating project destination: ${highlight(state.dest)}`);
			await fs.mkdirs(state.dest);

			await this.hook('create', async state => {
				let generator = path.join(state.src, 'generator.js');
				if (!isFile(generator)) {
					generator = path.join(state.src, 'generator', 'index.js');
				}

				if (isFile(generator)) {
					if (installDeps) {
						await this.npmInstall(state.src, 'npm-install-generator', state);
					}

					await this.hook('generate', async (state, generator, api) => {
						await generator(api);
					})(state, require(generator), new API(state));
				} else {
					// copy files
					await this.copy(state, new Set([
						path.join(state.src, '.git'),
						path.join(state.src, 'node_modules')
					]));
				}

				await this.npmInstall(state.dest, 'npm-install', state);

				await this.gitInit(state);
			})(state);
		} finally {
			await this.hook('cleanup', async state => {
				for (const disposable of state.disposables) {
					if (disposable.startsWith(tmp.tmpdir)) {
						await fs.remove(disposable);
					}
				}
			})(state);
		}
	}

	/**
	 * Copy files from the state source to the destination.
	 *
	 * @param {Object} state - The run state.
	 * @param {Set} [ignore] - A list of files to not copy.
	 * @returns {Promise}
	 * @access private
	 */
	async copy(state, ignore) {
		await this.hook('copy', async (state, ignore) => {
			await fs.copy(state.src, state.dest, {
				filter: (src, dest) => {
					if (!ignore || !ignore.has(src)) {
						log(`Copying ${highlight(src)} => ${highlight(path.relative(src, dest))}`);
						this.emit('copy-file', state, src, dest);
						return true;
					}
				}
			});
		})(state, ignore);
	}

	/**
	 * Download a file to a temp directory.
	 *
	 * @param {Object} state - The run state.
	 * @returns {Promise}
	 * @access private
	 */
	async download(state) {
		await this.hook('download', async state => {
			return new Promise((resolve, reject) => {
				log(`Downloading ${highlight(state.src)}`);
				got.stream(state.src)
					.on('response', response => {
						const { headers } = response;
						const length = headers['content-length'];
						const type = headers['content-type'];
						let filename;
						let m;

						log(headers);

						// try to determine the file extension by the content disposition filename
						// this is likely the most trustworthy option
						if (!filename) {
							const cd = headers['content-disposition'];
							m = cd && cd.match(/filename[^;=\n]*=['"]*(.*?\2|[^'";\n]*)/);
							filename = m && m[1];
						}

						// try to determine the file extension by the filename in the url
						if (!filename && (m = state.src.match(filenameRegExp))) {
							filename = m[0];
						}

						// try to determine the file extension by content type
						// sadly, .zip is pretty much the only extension we can reliably trust
						// the remaining supported archive types are too ambiguous
						if (!filename && (type === 'application/zip' || type === 'application/x-zip-compressed')) {
							filename = `temp-template-${Date.now()}.zip`;
						}

						if (!filename) {
							// we don't know what the filename is, so there's no way to know what the
							// file type is
							return reject(new Error('Unable to determine source file type'));
						}

						state.src = path.join(this.makeTemp(state), filename);
						log(`Writing file to ${highlight(state.src)} (${length || '?'} bytes)`);

						const out = fs.createWriteStream(state.src);
						out.on('close', () => {
							log(`Wrote ${fs.statSync(state.src).size} bytes`);
							resolve(state.src);
						});
						response.pipe(out);
					})
					.on('error', reject);
			});
		})(state);
	}

	/**
	 * Extract an archive to a temp directory.
	 *
	 * @param {Object} state - The run state.
	 * @returns {Promise}
	 * @access private
	 */
	async extract(state) {
		state.extractDest = this.makeTemp(state);
		await this.hook('extract', async state => {
			return new Promise((resolve, reject) => {
				log(`Extracting ${highlight(state.src)} => ${highlight(path.relative(path.dirname(state.src), state.extractDest))}`);
				inly(state.src, state.extractDest)
					.on('file', file => this.emit('extract-file', state, file))
					.on('progress', percent => this.emit('extract-progress', state, percent))
					.on('end', () => resolve(state.src = state.extractDest))
					.on('error', reject);
			});
		})(state);
	}

	/**
	 * Clones a git repo to a temp directory.
	 *
	 * @param {Object} state - The run state.
	 * @returns {Promise}
	 * @access private
	 */
	async gitClone(state) {
		const dir = this.makeTemp(state);
		const { gitInfo } = state;
		const branch = gitInfo.committish;
		const cmd = await this.git();
		const args = [ 'clone', '--depth=1' ];

		if (!cmd) {
			throw new Error('Unable to find "git" executable');
		}

		if (branch) {
			args.push('--branch', branch);
		}

		if (gitInfo.getDefaultRepresentation() === 'sshurl') {
			args.push(gitInfo.ssh({ noCommittish: true }));
		} else {
			args.push(gitInfo.https({ noCommittish: true, noGitPlus: true }));
		}

		try {
			state.src = await this.hook('git-clone', async (state, args, opts) => {
				log(`Cloning repo into ${highlight(opts.cwd)}`);
				await run(cmd, args, opts);
				return path.join(dir, gitInfo.project);
			})(state, args, { cwd: dir });
		} catch (e) {
			const m = e.stderr.match(/^ERROR:\s*(.+)\.?$/m);
			throw m ? new Error(m[1]) : e;
		}
	}

	/**
	 * Attempts to locate the git executable.
	 *
	 * @returns {Promise.<String>} Resolves the path to the git executable.
	 * @access private
	 */
	async git() {
		try {
			return await which('git');
		} catch (e) {
			// squelch
		}
	}

	/**
	 * Initializes a git repo in the destination directory.
	 *
	 * @param {Object} state - The run state.
	 * @returns {Promise}
	 * @access private
	 */
	async gitInit(state) {
		const cmd = await this.git();
		if (cmd && state.git !== false) {
			await this.hook('git-init', async (state, args, opts) => {
				log(`Initializing git repo in ${highlight(opts.cwd)}`);
				await run(cmd, args, opts);
			})(state, [ 'init' ], { cwd: state.dest });
		} else {
			warn('git executable not found, skipping git init');
		}
	}

	/**
	 * Initializes the state prior running.
	 *
	 * @param {Object} opts - Various options.
	 * @returns {Promise}
	 * @access private
	 */
	async init(opts) {
		if (!opts || typeof opts !== 'object') {
			throw new TypeError('Expected options to be an object');
		}

		const state = { ...opts };

		Object.defineProperty(state, 'disposables', { value: [] });

		if (!state.src || typeof state.src !== 'string') {
			throw new TypeError('Expected source to be a path, npm package name, URL, or git repo');
		}

		if (!state.dest || typeof state.dest !== 'string') {
			throw new TypeError('Expected destination to be a path');
		}

		state.dest = expandPath(state.dest);

		let stat;
		try {
			stat = fs.statSync(state.dest);
		} catch (e) {
			// does not exist, continue
		}

		// if file exists and not a dir or is a non-empty dir
		if (stat && !state.force && (!stat.isDirectory() || fs.readdirSync(state.dest).length)) {
			throw new Error('Destination already exists');
		}

		return state;
	}

	/**
	 * Creates a temp directory.
	 *
	 * @param {Object} state - The run state.
	 * @returns {String}
	 * @access private
	 */
	makeTemp(state) {
		const { name } = tmp.dirSync({
			mode: '755',
			unsafeCleanup: true
		});
		state.disposables.push(name);
		return name;
	}

	/**
	 * Downloads and extracts an npm package, then manually renames `.gitignore` files to
	 * workaround bug.
	 *
	 * @param {Object} state - The run state.
	 * @returns {Promise}
	 * @access private
	 */
	async npmDownload(state) {
		state.src = this.makeTemp(state);

		await this.hook('npm-download', async state => {
			log(`Downloading ${highlight(`${state.manifest.name}@${state.manifest.version}`)}`);
			await pacote.extract(`${state.manifest.name}@${state.manifest.version}`, state.src);
		})(state);

		// pacote has a "bug" where .gitignore is renamed to .npmignore and there's nothing we can
		// do about it (https://github.com/npm/pacote/issues/33)
		//
		// as a workaround, if we find any files named `gitignore`, rename them to `.gitignore`
		const walk = dir => {
			const gitIgnore = path.join(dir, 'gitignore');
			const dotGitIgnore = path.join(dir, '.gitignore');

			if (isFile(gitIgnore) && !isFile(dotGitIgnore)) {
				log(`Renaming ${highlight(gitIgnore)} => ${highlight(path.relative(gitIgnore, dotGitIgnore))}`);
				fs.renameSync(gitIgnore, dotGitIgnore);
			}

			for (const name of fs.readdirSync(dir)) {
				const subdir = path.join(dir, name);
				if (isDir(subdir)) {
					walk(subdir);
				}
			}
		};
		walk(state.src);
	}

	/**
	 * Installs template npm dependencies if a `package.json` exists.
	 *
	 * @param {String} dir - The directory to install dependencies in.
	 * @param {String} event - The name of the npm event to emit.
	 * @param {Object} state - The run state.
	 * @returns {Promise}
	 * @access private
	 */
	async npmInstall(dir, event, state) {
		if (!isFile(path.join(dir, 'package.json'))) {
			log('Template does not have a package.json, skipping npm install');
			return;
		}

		const cacheDir = this.makeTemp(state);
		const args = new Set([
			'install',
			'--no-audit',
			'--no-package-lock',
			'--production',
			...(Array.isArray(state.npmArgs) ? state.npmArgs : [])
		]);

		const env = {
			...process.env,
			NO_UPDATE_NOTIFIER: 1,
			npm_config_cache: cacheDir
		};
		let code;

		try {
			code = await this.hook(event, async (state, cmd, args, opts) => {
				log(`Install template dependencies: ${highlight(dir)}`);
				return (await run(cmd, args, opts)).code;
			})(state, 'npm', Array.from(args), { cwd: dir, env });
		} finally {
			(code ? warn : log)(`npm install exited (code ${code})`);
		}
	}
}
