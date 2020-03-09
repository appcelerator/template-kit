/* eslint-disable quote-props */

import fs from 'fs-extra';
import http from 'http';
import path from 'path';
import TemplateEngine from '../dist/index';
import tmp from 'tmp';

import { execSync } from 'child_process';

const tmpDir = tmp.dirSync({
	mode: '755',
	prefix: 'template-kit-test-',
	unsafeCleanup: true
}).name;

function makeTempName() {
	return path.join(tmpDir, Math.random().toString(36).substring(7));
}

function makeTempDir() {
	const dir = makeTempName();
	fs.mkdirsSync(dir);
	return dir;
}

let closeHttpServer = null;

let hasGit = false;
try {
	execSync('git --version');
	hasGit = true;
} catch (e) {
	// squelch
}

describe('template-kit', function () {
	this.timeout(10000);
	this.slow(5000);

	after(async () => {
		await fs.remove(tmpDir);

		if (closeHttpServer) {
			await closeHttpServer();
		}
	});

	describe('General Errors', () => {
		it('should error if options is not an object', async () => {
			const engine = new TemplateEngine();
			await expect(engine.run()).to.be.rejectedWith(TypeError, 'Expected options to be an object');
			await expect(engine.run(null)).to.be.rejectedWith(TypeError, 'Expected options to be an object');
			await expect(engine.run('foo')).to.be.rejectedWith(TypeError, 'Expected options to be an object');
		});

		it('should error if source is invalid', async () => {
			const engine = new TemplateEngine();

			await expect(engine.run({})).to.be.rejectedWith(TypeError, 'Expected source to be a path, npm package name, URL, or git repo');
			await expect(engine.run({ src: 123 })).to.be.rejectedWith(TypeError, 'Expected source to be a path, npm package name, URL, or git repo');

			engine.on('init', opts => {
				opts.src = 123;
			});
			await expect(engine.run({ src: __dirname })).to.be.rejectedWith(TypeError, 'Expected source to be a path, npm package name, URL, or git repo');
		});

		it('should error if destination is invalid', async () => {
			const engine = new TemplateEngine();

			await expect(engine.run({
				src: 'foo'
			})).to.be.rejectedWith(TypeError, 'Expected destination to be a path');

			await expect(engine.run({
				dest: 123,
				src: 'foo'
			})).to.be.rejectedWith(TypeError, 'Expected destination to be a path');

			engine.on('init', opts => {
				opts.dest = 123;
			});

			await expect(engine.run({
				dest: makeTempName(),
				src: 'foo'
			})).to.be.rejectedWith(TypeError, 'Expected destination to be a path');
		});

		it('should error if the template cannot be found', async () => {
			const engine = new TemplateEngine();

			await expect(engine.run({
				src: `template-kit-test-not-found-${Date.now()}`,
				dest: makeTempName()
			})).to.be.rejectedWith(Error, 'Unable to determine template source');
		});
	});

	describe('Force', () => {
		it('should error if destination already exists', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempDir();

			fs.writeFileSync(path.join(dest, 'test.txt'), 'this is a test');

			await expect(engine.run({
				dest,
				src: 'foo'
			})).to.be.rejectedWith(Error, 'Destination already exists');
		});

		it('should force install over existing project', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempDir();

			fs.writeFileSync(path.join(dest, 'test.txt'), 'this is a test');

			await engine.run({
				dest,
				force: true,
				src: path.join(__dirname, 'fixtures', 'basic')
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json',
				'test.txt'
			]);
		});
	});

	(hasGit ? describe : describe.skip)('git', () => {
		it('should resolve a git source', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				src: 'git@github.com:appcelerator/template-kit-test.git'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'README.md',
				'gitignore',
				'package.json'
			]);
		});

		it('should resolve a git source with branch', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				src: 'git@github.com:appcelerator/template-kit-test.git#foo'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'README.md',
				'foo.txt',
				'gitignore',
				'package.json'
			]);
		});

		it('should resolve a git source over https', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				src: 'https://github.com/appcelerator/template-kit-test.git'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'README.md',
				'gitignore',
				'package.json'
			]);
		});

		it('should error if git source does not exist', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await expect(engine.run({
				dest,
				src: 'git@github.com:appcelerator/template-kit-test-does-not-exist.git'
			})).to.be.rejectedWith(Error, 'Repository not found');
		});

		it('should fail if git executable not found', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();
			const origPath = process.env.PATH;

			try {
				process.env.PATH = __dirname;
				await expect(engine.run({
					dest,
					src: 'git@github.com:appcelerator/template-kit-test.git'
				})).to.be.rejectedWith(Error, 'Unable to find "git" executable');
			} finally {
				process.env.PATH = origPath;
			}
		});

		it('should not git init', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				git: false,
				src: path.join(__dirname, 'fixtures', 'basic')
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.gitignore',
				'README.md',
				'package.json'
			]);
		});
	});

	describe('Local Directory', () => {
		it('should resolve a local directory source - vanilla', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				src: path.join(__dirname, 'fixtures', 'vanilla')
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'README.md'
			]);
		});

		it('should resolve a local directory source - basic', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				src: path.join(__dirname, 'fixtures', 'basic')
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);
		});

		it('should resolve a local directory source - advanced', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				src: path.join(__dirname, 'fixtures', 'advanced')
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git'
				// TODO: Add other files
			]);
		});
	});

	describe('Local file', () => {
		it('should resolve a local zip archive source', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				src: path.join(__dirname, 'fixtures', 'basic.zip')
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);
		});

		it('should resolve a local tarball archive source', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				src: path.join(__dirname, 'fixtures', 'basic.tar.gz')
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);
		});
	});

	describe('Remote zip', () => {
		it('should resolve a remote zip archive with a content type', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await createServer();

			await engine.run({
				dest,
				src: 'http://127.0.0.1:1337/ct-header'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);
		});

		it('should resolve a remote zip archive with a content disposition filename', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await createServer();

			await engine.run({
				dest,
				src: 'http://127.0.0.1:1337/cd-header'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);
		});

		it('should resolve a remote zip archive with filename in url', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await createServer();

			await engine.run({
				dest,
				src: 'http://127.0.0.1:1337/basic.zip'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);
		});

		it('should error if file type cannot be determined', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await createServer();

			await expect(engine.run({
				dest,
				src: 'http://127.0.0.1:1337/basic'
			})).to.be.rejectedWith(Error, 'Unable to determine source file type');
		});

		it('should error if url returns 404', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await createServer();

			await expect(engine.run({
				dest,
				src: 'http://127.0.0.1:1337/does-not-exist'
			})).to.be.rejectedWith(Error, 'Response code 404 (Not Found)');
		});
	});

	describe('Global npm Package', () => {
		it('should resolve a global npm package', async () => {
			try {
				process.env.GLOBAL_NPM_MODULES_DIR = path.join(__dirname, 'fixtures');
				const engine = new TemplateEngine();
				const dest = makeTempName();

				await engine.run({
					dest,
					src: 'basic-template'
				});

				expect(fs.readdirSync(dest)).to.have.members([
					'.git',
					'.gitignore',
					'README.md',
					'package.json'
				]);
			} finally {
				delete process.env.GLOBAL_NPM_MODULES_DIR;
			}
		});
	});

	describe('npm Package', () => {
		it('should resolve an npm package', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();

			await engine.run({
				dest,
				src: 'template-kit-test@1.0.6'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);
		});
	});

	describe('Hooks', () => {
		it('should emit events for local basic template with multiple listeners', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();
			const src = path.join(__dirname, 'fixtures', 'basic');

			const initSpy = sinon.spy();

			engine.on('init', async (opts, next) => {
				expect(opts).to.deep.equal({ a: 'b', dest, src });
				initSpy();
				opts.c = 'd';
				await next();
				expect(opts).to.deep.equal({ a: 'b', c: 'd', e: 'f', dest, src });
			});

			engine.on('init', opts => {
				expect(opts).to.deep.equal({ a: 'b', c: 'd', dest, src });
				initSpy();
				opts.e = 'f';
			});

			await engine.run({ a: 'b', dest, src });

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);

			expect(initSpy).to.be.calledTwice;
		});

		it('should error if init hook tries to change options date type', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();
			const src = path.join(__dirname, 'fixtures', 'basic');

			engine.on('init', async function (opts, next) {
				this.args[0] = 'foo';
				await next();
			});

			await expect(engine.run({ dest, src })).to.be.rejectedWith(TypeError, 'Expected options to be an object');
		});

		it('should emit events for local basic template', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();
			const src = path.join(__dirname, 'fixtures', 'basic');
			const check = createSpies(engine);

			await engine.run({ a: 'b', dest, src });

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);

			check({
				'init': 1,
				'git-clone': 0,
				'download': 0,
				'extract': 0,
				'extract-file': 0,
				'extract-progress': 0,
				'npm-download': 0,
				'npm-install': 1,
				'npm-install-generator': 0,
				'create': 1,
				'generate': 0,
				'copy': 1,
				'copy-file': 5,
				'git-init': 1,
				'cleanup': 1
			});
		});

		(hasGit ? it : it.skip)('should emit events for git source', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();
			const check = createSpies(engine);

			await engine.run({
				dest,
				src: 'git@github.com:appcelerator/template-kit-test.git'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'README.md',
				'gitignore',
				'package.json'
			]);

			check({
				'init': 1,
				'git-clone': 1,
				'download': 0,
				'extract': 0,
				'extract-file': 0,
				'extract-progress': 0,
				'npm-download': 0,
				'npm-install': 1,
				'npm-install-generator': 0,
				'create': 1,
				'generate': 0,
				'copy': 1,
				'copy-file': 5,
				'git-init': 1,
				'cleanup': 1
			});
		});

		it('should emit events for remote zip source', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();
			const check = createSpies(engine);

			await createServer();

			await engine.run({
				dest,
				src: 'http://127.0.0.1:1337/ct-header'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);

			check({
				'init': 1,
				'git-clone': 0,
				'download': 1,
				'extract': 1,
				'extract-file': 3,
				'extract-progress': -1,
				'npm-download': 0,
				'npm-install': 1,
				'npm-install-generator': 0,
				'create': 1,
				'generate': 0,
				'copy': 1,
				'copy-file': 5,
				'git-init': 1,
				'cleanup': 1
			});
		});

		it('should emit events for npm package', async () => {
			const engine = new TemplateEngine();
			const dest = makeTempName();
			const check = createSpies(engine);

			await engine.run({
				dest,
				src: 'template-kit-test@1.0.6'
			});

			expect(fs.readdirSync(dest)).to.have.members([
				'.git',
				'.gitignore',
				'README.md',
				'package.json'
			]);

			check({
				'init': 1,
				'git-clone': 0,
				'download': 0,
				'extract': 0,
				'extract-file': 0,
				'extract-progress': 0,
				'npm-download': 1,
				'npm-install': 1,
				'npm-install-generator': 0,
				'create': 1,
				'generate': 0,
				'copy': 1,
				'copy-file': 5,
				'git-init': 1,
				'cleanup': 1
			});
		});
	});
});

function createSpies(engine) {
	const spies = {};
	const evts = [
		'init',
		'git-clone',
		'download',
		'extract',
		'extract-file',
		'extract-progress',
		'npm-download',
		'npm-install',
		'npm-install-generator',
		'create',
		'generate',
		'copy',
		'copy-file',
		'git-init',
		'cleanup'
	];

	for (const evt of evts) {
		spies[evt] = sinon.spy();
		engine.on(evt, () => spies[evt]());
	}

	return counts => {
		for (const evt of evts) {
			if (Object.prototype.hasOwnProperty.call(counts, evt)) {
				const n = counts[evt];
				if (n === -1) {
					expect(spies[evt]).to.be.called;
				} else {
					expect(spies[evt]).to.have.callCount(n);
				}
			}
		}
	};
}

async function createServer() {
	if (closeHttpServer) {
		return;
	}

	await new Promise(resolve =>  {
		const connections = {};
		const server = http.createServer((req, res) => {
			switch (req.url) {
				case '/basic.zip':
				case '/basic':
					res.writeHead(200);
					fs.createReadStream(path.join(__dirname, 'fixtures', 'basic.zip')).pipe(res);
					break;

				case '/cd-header':
				{
					const file = path.join(__dirname, 'fixtures', 'basic.zip');
					res.writeHead(200, {
						'Content-Disposition': 'attachment; filename="foo.zip"',
						'Content-Length': fs.statSync(file).size
					});
					fs.createReadStream(file).pipe(res);
					break;
				}

				case '/ct-header':
				{
					const file = path.join(__dirname, 'fixtures', 'basic.zip');
					res.writeHead(200, {
						'Content-Type': 'application/zip',
						'Content-Length': fs.statSync(file).size
					});
					fs.createReadStream(file).pipe(res);
					break;
				}

				default:
					res.writeHead(404);
					res.end('Not found');
			}
		}).on('connection', conn => {
			const key = conn.remoteAddress + ':' + conn.remotePort;
			connections[key] = conn;
			conn.on('close', () => {
				delete connections[key];
			});
		}).listen(1337, () => {
			closeHttpServer = async () => {
				for (const key of Object.keys(connections)) {
					connections[key].destroy();
					delete connections[key];
				}
				await new Promise(resolve => server.close(resolve));
				closeHttpServer = null;
			};

			resolve();
		});
	});
}
