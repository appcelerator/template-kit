# template-kit

[![NPM Version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![Travis CI Build][travis-image]][travis-url]
[![Deps][david-image]][david-url]
[![Dev Deps][david-dev-image]][david-dev-url]

Library for creating projects from templates.

## Features

 * Project generation using local template as a directory, archive file, or globally installed npm package
 * Download templates from git, npm, or a URL to a archive file
 * Support for `.zip`, `.gz`, `.bz2`, `.tar`, `tar.gz`, `tar.bz2`, `.tgz`, and `.tbz2` archives
 * Render text files using [`ejs`][ejs] during file copy
 * JavaScript lifecycle hooks
 * Data-driven destination directories and filenames
 * npm dependency installation
 * git repository initialization

## Installation

    npm install template-kit --save

## Example

```javascript
import TemplateEngine from 'template-kit';

(async () => {
    const engine = new TemplateEngine();

    engine.on('create', async (state, next) => {
        console.log('Creating the project from the template');
        await next();
        console.log('Project created!');
    });

    await engine.run({
        src: 'git@github.com:appcelerator/template-kit-test.git',
        dest: '/path/to/new/project'
    });

    console.log('Project created successfully!');
})();
```

## Template Specification

### Structure

A template can be an empty directory or a massive collection of files and subdirectories. These
files can compressed in an archive file (.zip, .tgz, etc).

Templates do _not_ need to be npm packages and they do _not_ need to have a `package.json`. If they
do, template-kit will happily call `npm install` after generation.

Any file that is _not_ binary will be treated as an [ejs][ejs] template regardless of extension.
ejs templates have access to any variable or function in the `data` object including the `opts.data`
passed into the `TemplateEngine` constructor, the `data` export from the `meta.js`, or any
data that has be injected via a hook.

Directories and filenames may contain a `{{variable}}` sequence which will be replaced with the
corresponding value in the `data` object.

### Metadata

template-kit will load the template's metadata from a `meta.js` file or the package's "main" file.
The metadata can be an object or an async function that returns an object. The object contains the
following properties:

| Property | Type             | Description |
| -------- | ---------------- | ----------- |
| complete | `Function`       | A function to call after the project generation is complete. Useful for displaying post create steps. |
| data     | `Object`         | Arbitrary data to mix in with the `run()` data and pass into `ejs` when copying a text file. |
| filters  | `Array.<String>` | An array of file patterns to copy. The patterns follow the gitignore rules. |
| prompts  | `Object`         | An array of prompt descriptors that is used to select the template and template data. |

## API

### `TemplateEngine`

Resolves a template source, installs the template, and manages the install lifecycle.

 * `new TemplateEngine()`
   * _methods_
     * [`.run(opts)`](#TemplateEngine+run)
   * _inherited from [`HookEmitter`](https://www.npmjs.com/package/hook-emitter)_ ➚
     * [`.on(event, listener)`](https://www.npmjs.com/package/hook-emitter#onevent-listener) ➚
     * [`.once(event, listener)`](https://www.npmjs.com/package/hook-emitter#onceevent-listener) ➚
     * [`.off(event, listener)`](https://www.npmjs.com/package/hook-emitter#offevent-listener) ➚
   * _events_
     * [`#init`](#TemplateEngine+event+init)
     * [`#git-clone`](#TemplateEngine+event+git-clone)
     * [`#download`](#TemplateEngine+event+download)
     * [`#extract`](#TemplateEngine+event+extract)
     * [`#extract-file`](#TemplateEngine+event+extract-file)
     * [`#extract-progress`](#TemplateEngine+event+extract-progress)
     * [`#npm-download`](#TemplateEngine+event+npm-download)
     * [`#create`](#TemplateEngine+event+create)
     * [`#load-meta`](#TemplateEngine+event+load-meta)
     * [`#prompt`](#TemplateEngine+event+prompt)
     * [`#copy`](#TemplateEngine+event+copy)
     * [`#copy-file`](#TemplateEngine+event+copy-file)
     * [`#npm-install`](#TemplateEngine+event+npm-install)
     * [`#git-init`](#TemplateEngine+event+git-init)
     * [`#cleanup`](#TemplateEngine+event+cleanup)

### Methods

<a name="TemplateEngine+run"></a>

#### `.run(opts)` ⇒ `Promise`

Builds a project based on the specified template and options.

| Param             | Type                      | Description     |
| ----------------- | ------------------------- | --------------- |
| opts              | `Object`                  | Various options |
| [opts.data]       | `Object`                  | A data object that is passed into `ejs` when copying template files. |
| opts.dest         | `String`                  | The destination directory to create the project in. |
| [opts.filters]    | `Set` \| `Array.<String>` | A list of file patterns to pass into `micromatch` when copying files. |
| [opts.force]      | `Boolean`                 | When `true`, overrides the destination if it already exists. |
| [opts.git=true]   | `Boolean`                 | When `true` and `git` executable is found, after the the project is generated, initialize a git repo in the project directory. |
| [opts.npmArgs]    | `Array.<String>`          | An array of additional parameters to pass into npm. Useful if you need to add extra arguments for things such as skipping shrinkwrap. |
| opts.src          | `String`                  | The path to a directory, archive file, globally installed npm package, archive URL, npm package name, or git repo. |

##### Run State

Every time `run()` is invoked, a new `state` object is created and passed through the various
stages. The contents of the `state` depends on the Source Type.

| Property    | Type                      | Description                                                  |
| ----------- | ------------------------- | ------------------------------------------------------------ |
| dest        | `String`                  | The destination directory to create the project in.          |
| destFile    | `String`                  | When copying files, this is the destination file path.       |
| disposables | `Array.<String>`          | A list of temp directories to cleanup.                       |
| extractDest | `String`                  | The temporary directory where the archive was extracted to.  |
| filters     | `Set` \| `Array.<String>` | A list of file patterns to copy.                             |
| force       | `Boolean`                 | When `true`, overrides the destination if it already exists. |
| git         | `Boolean`                 | When `true` and `git` executable is found, after the the project is generated, initialize a git repo in the project directory. |
| gitInfo     | `Object`                  | The parsed git repo information.                             |
| npmArgs     | `Array.<String>`          | An array of additional parameters to pass into npm. Useful if you need to add extra arguments for things such as skipping shrinkwrap. |
| npmManifest | `Object`                  | The npm package information                                  |
| prompts     | `Array.<Object>`          | A list of prompt descriptors.                                |
| src         | `String`                  | The path to a directory, archive file, globally installed npm package, archive URL, npm package name, or git repo. |
| srcFile     | `String`                  | When copying files, this is the source file path.            |

### Events

The `TemplateEngine` emits several events. It uses the [hook-emitter][hook-emitter] package which
supports async event listeners.

Some events are only emitted depending on the source type (e.g. the `src` passed into `run()`).

```
Event Flow                   ┌───────┐
                             │ run() │
                             └───┬───┘ ┌───────┐
                                 ├─────┤ #init │
                                 │     └───────┘
      ┌──────────────┬───────────┼────────┬──────────┬──────────┐
     git            URL        Local    Local      Global      npm
      │        ┌─────┴─────┐   File   Directory  npm Package    │
      │        │ #download │     │        │          │          │
      │        └─────┬─────┘     │        │          │          │
┌─────┴──────┐       └─────┬─────┘        │          │  ┌───────┴───────┐
│ #git-clone │   ┌─────────┴─────────┐    │          │  │ #npm-download │
└─────┬──────┘   │ #extract          │    │          │  └───────┬───────┘
      │          │ #extract-file     │    │          │          │
      │          │ #extract-progress │    │          │          │
      │          └─────────┬─────────┘    │          │          │
      └────────────────────┴───────┬──────┴──────────┴──────────┘
                             ┌─────┴──────┐
                             │ #load-meta │
                             └─────┬──────┘ ┌─────────┐
                                   ├────────┤ #prompt │
                              ┌────┴────┐   └─────────┘
                              │ #create │
                              └────┬────┘   ┌───────┐
                                   ├────────┤ #copy │
                                   │        └───┬───┘    ┌────────────┐
                                   │            └────────┤ #copy-file │
                                   │    ┌──────────────┐ └────────────┘
                                   ├────┤ #npm-install │
                                   │    └──────────────┘
                                   │    ┌───────────┐
                                   ├────┤ #git-init │
                                   │    └───────────┘
                              ┌────┴─────┐
                              │ #cleanup │
                              └──────────┘
```

<a name="TemplateEngine+event+init"></a>

#### `#init`

Initialize the run state with the options passed into `run()`.

**Source Type:** Local file, local directory, global npm package, npm, git, URL

| Param              | Type       | Description                      |
| ------------------ | ---------- | -------------------------------- |
| opts               | `Object`   | The options passed into `run()`. |
| [async next(opts)] | `Function` | Continue to next hook.           |

```javascript
engine.on('init', async opts => {
    // before the run state has been initialized
});
```

or

```javascript
engine.on('init', async (opts, next) => {
    // before the run state has been initialized
    await next();
    // after initialization
});
```

<a name="TemplateEngine+event+git-clone"></a>

#### `#git-clone`

Emitted when `git clone` is called.

**Source Type:** git

| Param              | Type             | Description                                  |
| ------------------ | ---------------- | -------------------------------------------- |
| state              | `Object`         | The run state.                               |
| args               | `Array.<String>` | The arguments passed into the `git` command. |
| opts               | `Object`         | `spawn()` options.                           |
| [async next(opts)] | `Function`       | Continue to next hook.                       |

```javascript
engine.on('git-clone', async (state, args, opts, next) => {
    // before the git clone call
    await next();
    // after the clone
});
```

<a name="TemplateEngine+event+download"></a>

#### `#download`

Emitted when downloading a file based on a http/https URL.

**Source Type:** URL

| Param              | Type       | Description            |
| ------------------ | ---------- | ---------------------- |
| state              | `Object`   | The run state.         |
| [async next(opts)] | `Function` | Continue to next hook. |

```javascript
engine.on('download', async (state, next) => {
    // before the download begins
    await next();
    // after the clone
});
```

<a name="TemplateEngine+event+extract"></a>

#### `#extract`

Emitted when extracting the downloaded or local archive file.

**Source Type:** Local directory, URL

| Param              | Type       | Description            |
| ------------------ | ---------- | ---------------------- |
| state              | `Object`   | The run state.         |
| [async next(opts)] | `Function` | Continue to next hook. |

```javascript
engine.on('extract', async (state, next) => {
    // before the archive is extracted
    await next();
    // after extraction
});
```

<a name="TemplateEngine+event+extract-file"></a>

#### `#extract-file`

Emits the current file being extracted from the archive.

**Source Type:** Local directory, URL

| Param              | Type       | Description                           |
| ------------------ | ---------- | ------------------------------------- |
| state              | `Object`   | The run state.                        |
| file               | `String`   | The name of the file being extracted. |

```javascript
engine.on('extract-file', async (state, file) => {
    console.log(`Extracting ${file}`);
});
```

<a name="TemplateEngine+event+extract-progress"></a>

#### `#extract-progress`

Emits the current progress of the file extraction from `0` to `100`.

**Source Type:** Local directory, URL

| Param              | Type       | Description              |
| ------------------ | ---------- | ------------------------ |
| state              | `Object`   | The run state.           |
| percent            | `Number`   | The percentage complete. |

```javascript
engine.on('extract-progress', async (state, percent) => {
    console.log(`Extracted ${percent}%`);
});
```

<a name="TemplateEngine+event+npm-download"></a>

#### `#npm-download`

Emitted when downloading and extracting an npm package.

**Source Type:** npm

| Param              | Type       | Description            |
| ------------------ | ---------- | ---------------------- |
| state              | `Object`   | The run state.         |
| [async next(opts)] | `Function` | Continue to next hook. |

```javascript
engine.on('npm-download', async (state, next) => {
    // before downloading and extracting the npm package
    await next();
    // after extraction
});
```

<a name="TemplateEngine+event+create"></a>

#### `#create`

Emitted when about to populate the destination directory.

**Source Type:** All sources.

| Param              | Type       | Description            |
| ------------------ | ---------- | ---------------------- |
| state              | `Object`   | The run state.         |
| [async next(opts)] | `Function` | Continue to next hook. |

```javascript
engine.on('create', async (state, next) => {
    // before the project is generated
    await next();
    // after project is generated
});
```

<a name="TemplateEngine+event+load-meta"></a>

#### `#load-meta`

Emitted when attempting to load the template's `meta.js` or "main" file.

**Source Type:** Any source with a meta script.

| Param              | Type             | Description              |
| ------------------ | ---------------- | ------------------------ |
| state              | `Object`         | The run state.           |
| [async next(opts)] | `Function`       | Continue to next hook.   |

```javascript
engine.on('load-meta', async (state, next) => {
    // before npm dependencies have been installed
    await next();
    // after installation
});
```

<a name="TemplateEngine+event+prompt"></a>

#### `#prompt`

Allows application opportunity to prompt for missing data, then populate state's `data` property.

**Source Type:** Any source with a meta script.

| Param              | Type       | Description                            |
| ------------------ | ---------- | -------------------------------------- |
| state              | `Object`   | The run state.                         |

```javascript
engine.on('prompt', async state => {
    // prompt for `state.prompts` and store results in `state.data`
});
```

<a name="TemplateEngine+event+copy"></a>

#### `#copy`

Emitted when copying the template files to the destination.

**Source Type:** All sources.

| Param              | Type       | Description                          |
| ------------------ | ---------- | ------------------------------------ |
| state              | `Object`   | The run state.                       |
| [async next(opts)] | `Function` | Continue to next hook.               |

```javascript
engine.on('copy', async (state, next) => {
    // before copying has begun
    await next();
    // after files have been copied
});
```

<a name="TemplateEngine+event+copy-file"></a>

#### `#copy-file`

Emitted for each file copied.

**Source Type:** All sources.

| Param              | Type       | Description                         |
| ------------------ | ---------- | ----------------------------------- |
| state              | `Object`   | The run state.                      |
| [async next(opts)] | `Function` | Continue to next hook.               |

```javascript
engine.on('copy-file', async (state, next) => {
    // before a specific file is to be copied
    await next();
    // file has been copied
});
```

<a name="TemplateEngine+event+npm-install"></a>

#### `#npm-install`

Emitted when installing npm dependencies in the destination directory.

**Source Type:** Any source with a `package.json`.

| Param              | Type             | Description              |
| ------------------ | ---------------- | ------------------------ |
| state              | `Object`         | The run state.           |
| cmd                | `String`         | The path to npm command. |
| args               | `Array.<String>` | The npm arguments.       |
| opts               | `Object`         | `spawn()` options.       |
| [async next(opts)] | `Function`       | Continue to next hook.   |

```javascript
engine.on('npm-install', async (state, cmd, args, opts, next) => {
    // before npm dependencies have been installed
    await next();
    // after installation
});
```

<a name="TemplateEngine+event+git-init"></a>

#### `#git-init`

Emitted when a git repository is being initialized in the project directory.

**Source Type:** Any source.

| Param              | Type             | Description            |
| ------------------ | ---------------- | ---------------------- |
| state              | `Object`         | The run state.         |
| args               | `Array.<String>` | `git` arguments.       |
| opts               | `Object`         | `spawn()` options.     |
| [async next(opts)] | `Function`       | Continue to next hook. |

```javascript
engine.on('git-init`', async (state, args, opts, next) => {
    // before the git repo has been initialized
    await next();
    // after initialization
});
```

<a name="TemplateEngine+event+cleanup"></a>

#### `#cleanup`

Emitted after the project has been created and the temp directories are to be deleted.

**Source Type:** Any source.

| Param              | Type       | Description            |
| ------------------ | ---------- | ---------------------- |
| state              | `Object`   | The run state.         |
| [async next(opts)] | `Function` | Continue to next hook. |

```javascript
engine.on('cleanup`', async (state, next) => {
    // before temp directories have been deleted
    await next();
    // after cleanup
});
```

## Legal

This project is open source under the [Apache Public License v2][1] and is developed by
[Axway, Inc](http://www.axway.com/) and the community. Please read the [`LICENSE`][1] file included
in this distribution for more information.

[1]: https://github.com/appcelerator/template-kit/blob/master/LICENSE
[npm-image]: https://img.shields.io/npm/v/template-kit.svg
[npm-url]: https://npmjs.org/package/template-kit
[downloads-image]: https://img.shields.io/npm/dm/template-kit.svg
[downloads-url]: https://npmjs.org/package/template-kit
[travis-image]: https://img.shields.io/travis/appcelerator/template-kit.svg
[travis-url]: https://travis-ci.org/appcelerator/template-kit
[david-image]: https://img.shields.io/david/appcelerator/template-kit.svg
[david-url]: https://david-dm.org/appcelerator/template-kit
[david-dev-image]: https://img.shields.io/david/dev/appcelerator/template-kit.svg
[david-dev-url]: https://david-dm.org/appcelerator/template-kit#info=devDependencies
[ejs]: https://www.npmjs.com/package/ejs
[hook-emitter]: https://www.npmjs.com/package/hook-emitter
