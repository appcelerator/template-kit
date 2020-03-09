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
 * Generator API for dynamic filenames and file content
 * Template metadata
 * JavaScript lifecycle hooks
 * npm dependency installation
 * git repository initialization

## Installation

    npm install template-kit

## Examples

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
