/* istanbul ignore if */
if (!Error.prepareStackTrace) {
	require('source-map-support/register');
}

import ejs from 'ejs';
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
import validatePackageName from 'validate-npm-package-name';

import { expandPath } from 'appcd-path';
import { glob } from 'glob-gitignore';
import { isBinaryFile } from 'isbinaryfile';
import { isDir, isFile } from 'appcd-fs';
import { promisify } from 'util';
import { run, which } from 'appcd-subprocess';

const { log, warn } = snooplogg('template-kit');
const { highlight } = snooplogg.styles;

const archiveRegExp = /[^\\/]+(\.zip|\.tgz|\.tbz2|\.tar\.gz|\.tar\.bz2|(?<!\.tar)\.gz|(?<!\.tar)\.bz2)$/;
const fileRegExp = /\{\{(\w+?)\}\}/g;

export class TemplateEngine extends HookEmitter {
	/**
	 * The list of default `multimatch` patterns.
	 *
	 * @type {Array.<String>}
	 * @access public
	 */
	static DefaultFilters = [
		'!.git',
		'!node_modules'
	];

	/**
	 * Builds a project based on the specified template and options.
	 *
	 * @param {Object} opts - Various options.
	 * @param {Object} [opts.data] - A data object that is passed into `ejs` when copying template
	 * files.
	 * @param {String} opts.dest - The destination directory to create the project in.
	 * @param {Set|Array.<String>} [opts.filters] - A list of file patterns to pass into
	 * `micromatch` when copying files.
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
			if (state.gitInfo = hostedGitInfo.fromUrl(state.src)) {
				await this.gitClone(state);
			} else if (/^https?:\/\//.test(state.src)) {
				await this.download(state);
			}

			// if the source is a file, then it's an archive and it must be extracted
			if (isFile(state.src)) {
				await this.extract(state);
			}

			if (isDir(state.src)) {
				// pre-existing local directory or result of git clone, file download, or extracted
				// archive
			} else {
				const globalDir = process.env.GLOBAL_NPM_MODULES_DIR || globalModules;
				let globalPackageDir;
				for (const name of fs.readdirSync(globalDir)) {
					const pkg = await this.loadPackage(path.join(globalDir, name));
					if (pkg && pkg.name === state.src) {
						globalPackageDir = path.join(globalDir, name);
						state.pkg = pkg;
						break;
					}
				}

				if (globalPackageDir) {
					// global npm package
					log(`Found global npm package: ${highlight(globalPackageDir)}`);
					state.src = globalPackageDir;

				} else {
					// remote npm package
					try {
						const result = validatePackageName(state.src.split('@')[0]);
						if (!result.validForNewPackages && !result.validForOldPackages) {
							throw new Error('Definitely not a valid npm package name');
						}

						state.npmManifest = await pacote.manifest(state.src, { fullMetadata: true });
					} catch (e) {
						throw new Error('Unable to determine template source');
					}

					await this.npmDownload(state);
				}
			}

			// load the package.json, if exists
			if (state.pkg === undefined) {
				state.pkg = await this.loadPackage(state.src);
			}

			// try to determine meta file
			let metaFile = state.pkg && state.pkg.main && path.resolve(state.src, state.pkg.main);
			if (isFile(metaFile) || isFile(metaFile = path.join(state.src, 'meta.js'))) {
				state.metaFile = metaFile;
				state.filters.add(`!${path.relative(state.src, metaFile)}`);
			}

			await this.loadMeta(state);

			/* istanbul ignore else */
			if (state.template) {
				state.src = path.resolve(state.src, state.template);
			}

			await this.hook('create', async state => {
				await this.copy(state);

				await this.npmInstall(state);

				await this.gitInit(state);
			})(state);

			if (typeof state.complete === 'function') {
				await state.complete(state);
			}
		} finally {
			await this.hook('cleanup', async state => {
				for (const disposable of state.disposables) {
					/* istanbul ignore else */
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
	 * @returns {Promise}
	 * @access private
	 */
	async copy(state) {
		await this.hook('copy', async state => {
			const copyFile = promisify(fs.copyFile);
			const readFile = promisify(fs.readFile);
			const writeFile = promisify(fs.writeFile);

			// separate positive from negative paths
			let patterns = [];
			const ignore = [];
			for (const pattern of Array.from(state.filters)) {
				if (pattern[0] === '!') {
					ignore.push(pattern.substring(1));
				} else {
					patterns.push(pattern);
				}
			}

			if (!patterns.length) {
				patterns = [ '**' ];
			}

			log('Building template file list...');
			log(patterns);

			// if there's no patterns, then match everything
			const files = await glob(patterns, {
				cwd: state.src,
				dot: true,
				ignore
			});

			await fs.mkdirs(state.dest);

			for (const file of files) {
				state.srcFile = path.join(state.src, file);
				state.destFile = path.join(state.dest, this.renderFilename(file, state.data));

				if (isDir(state.srcFile)) {
					log(`Creating directory ${highlight(state.destFile)}`);
					await fs.mkdirs(state.destFile);
					continue;
				}

				await this.hook('copy-file', async state => {
					if (await isBinaryFile(state.srcFile)) {
						// copy
						log(`Copying ${highlight(state.srcFile)} => ${highlight(path.relative(state.srcFile, state.destFile))}`);
						await copyFile(state.srcFile, state.destFile);
					} else {
						// render
						log(`Copying ${highlight(state.srcFile)} => ${highlight(path.relative(state.srcFile, state.destFile))}`);
						let contents = await readFile(state.srcFile);
						contents = await ejs.render(contents.toString(), state.data, {
							async: true,
							root: state.src
						});
						await writeFile(state.destFile, contents);
					}
				})(state);
			}

			delete state.srcFile;
			delete state.destFile;
		})(state);
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
						/* istanbul ignore else */
						if (!filename) {
							const cd = headers['content-disposition'];
							m = cd && cd.match(/filename[^;=\n]*=['"]*(.*?\2|[^'";\n]*)/);
							filename = m && m[1];
						}

						// try to determine the file extension by the filename in the url
						if (!filename && (m = state.src.match(archiveRegExp))) {
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
			throw m ? new Error(m[1]) : /* istanbul ignore next */ e;
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
	 * @returns {Object}
	 * @access private
	 */
	init(opts) {
		if (!opts || typeof opts !== 'object') {
			throw new TypeError('Expected options to be an object');
		}

		const state = {
			template:    '.',
			...opts,
			disposables: [],
			extractDest: undefined,
			gitInfo:     undefined,
			meta:        {},
			metaFile:    undefined,
			npmManifest: undefined,
			pkg:         undefined,
			prompts:     {}
		};

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

		/* istanbul ignore else */
		if (!state.data) {
			state.data = {};
		} else if (typeof state.data !== 'object') {
			throw new TypeError('Expected data to be an object');
		}

		if (!state.filters) {
			state.filters = new Set(TemplateEngine.DefaultFilters);
		} else if (Array.isArray(state.filters) || state.filters instanceof Set) {
			state.filters = new Set([ ...state.filters ]);
		} else {
			throw new TypeError('Expected filters to be an array or set of file patterns');
		}

		return state;
	}

	/**
	 * Loads and validates the template's metadata.
	 *
	 * @param {Object} state - The run state.
	 * @returns {Promise}
	 * @access private
	 */
	async loadMeta(state) {
		// load the template meta
		const meta = await this.hook('load-meta', async state => {
			let meta;

			if (state.metaFile) {
				log(`Loading metadata: ${highlight(state.metaFile)}`);
				meta = require(state.metaFile);
			}

			// if this is an ES6 module, grab the default export
			if (meta && typeof meta === 'object' && meta.__esModule) {
				meta = meta.default;
			}

			return (typeof meta === 'function' ? await meta(state) : meta) || {};
		})(state);

		if (typeof meta !== 'object') {
			throw new TypeError('Expected template meta export to be an object or function');
		}

		if (meta.complete) {
			if (typeof meta.complete !== 'function') {
				throw new TypeError('Expected template meta complete callback to be a function');
			}
			state.complete = meta.complete;
		}

		if (meta.data) {
			if (typeof meta.data !== 'object') {
				throw new TypeError('Expected template meta data to be an object');
			}
			state.data = {
				...meta.data,
				...state.data
			};
		}

		if (meta.filters) {
			if (!Array.isArray(meta.filters) && !(meta.filters instanceof Set)) {
				throw new TypeError('Expected template meta filters to be an array or set of file patterns');
			}

			for (const filter of meta.filters) {
				let op = filter[0] === '!' ? filter.substring(1) : `!${filter}`;
				if (state.filters.has(op)) {
					state.filters.delete(op);
				}
				state.filters.add(filter);
			}
		}

		if (meta.prompts) {
			if (typeof meta.prompts !== 'object') {
				throw new TypeError('Expected template meta prompts to be an object');
			}

			const prompts = {};

			// validate the prompt descriptors and copy them into a clean object
			for (const [ name, descriptor ] of Object.entries(meta.prompts)) {
				if (!descriptor || typeof descriptor !== 'object') {
					throw new TypeError(`Expected meta prompt descriptor for "${name}" to be an object`);
				}
				prompts[name] = descriptor;
			}

			// if we have any prompts, then set the state and emit the `prompt` event
			if (Object.keys(prompts).length) {
				state.prompts = prompts;
				await this.emit('prompt', state);

				// populate any default values
				for (const [ name, descriptor ] of Object.entries(state.prompts)) {
					if (descriptor.default !== undefined && state.data[name] === undefined) {
						state.data[name] = descriptor.default;
					}
				}
			}
		}
	}

	/**
	 * Attempt to load the `package.json`, if it exists.
	 *
	 * @param {String} dir - The path of the package to load the `package.json` from.
	 * @returns {Promise<Object>} Resolves the parsed contents or `null`.
	 * @access private
	 */
	async loadPackage(dir) {
		try {
			return await fs.readJson(path.join(dir, 'package.json'));
		} catch (e) {
			return null;
		}
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
			log(`Downloading ${highlight(`${state.npmManifest.name}@${state.npmManifest.version}`)}`);
			await pacote.extract(`${state.npmManifest.name}@${state.npmManifest.version}`, state.src);
		})(state);

		// pacote has a "feature" where .gitignore is renamed to .npmignore and there's nothing we
		// can do about it (https://github.com/npm/pacote/issues/33)
		// as a workaround, if we find any files named `gitignore`, rename them to `.gitignore`
		const walk = dir => {
			const gitIgnore = path.join(dir, 'gitignore');
			const dotGitIgnore = path.join(dir, '.gitignore');

			/* istanbul ignore else */
			if (isFile(gitIgnore) && !isFile(dotGitIgnore)) {
				log(`Renaming ${highlight(gitIgnore)} => ${highlight(path.relative(gitIgnore, dotGitIgnore))}`);
				fs.renameSync(gitIgnore, dotGitIgnore);
			}

			for (const name of fs.readdirSync(dir)) {
				const subdir = path.join(dir, name);
				/* istanbul ignore if */
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
	 * @param {Object} state - The run state.
	 * @returns {Promise}
	 * @access private
	 */
	async npmInstall(state) {
		if (!isFile(path.join(state.dest, 'package.json'))) {
			log('Template does not have a package.json, skipping npm install');
			return;
		}

		const cacheDir = this.makeTemp(state);
		const args = new Set([
			'install',
			'--no-audit',
			'--no-package-lock',
			'--production',
			...(Array.isArray(state.npmArgs) ? /* istanbul ignore next */ state.npmArgs : [])
		]);

		const env = {
			...process.env,
			NO_UPDATE_NOTIFIER: 1,
			npm_config_cache: cacheDir
		};
		let code;

		try {
			code = await this.hook('npm-install', async (state, cmd, args, opts) => {
				log(`Install template dependencies: ${highlight(state.dest)}`);
				return (await run(cmd, args, opts)).code;
			})(state, 'npm', Array.from(args), { cwd: state.dest, env });
		} finally {
			(code ? /* istanbul ignore next */ warn : log)(`npm install exited (code ${code})`);
		}
	}

	/**
	 * Replaces variables in a path.
	 *
	 * @param {String} file - A file path that contains the `{{variable}}` tokens.
	 * @param {Object} data - An object with data to populate the filename.
	 * @returns {String}
	 * @access private
	 */
	renderFilename(file, data) {
		if (typeof file !== 'string' || !data) {
			return file;
		}

		return file.replace(fileRegExp, (match, name) => {
			return Object.prototype.hasOwnProperty.call(data, name) ? String(data[name]) : match;
		});
	}
}

export default TemplateEngine;
