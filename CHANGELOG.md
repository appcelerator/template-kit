# v2.1.0 (Oct 2, 2020)

 * feat: Added HTTP proxy support.
 * chore: Updated npm dependencies.

# v2.0.0 (Jun 26, 2020)

 * BREAKING CHANGE: Dropped support for Node 10.12.0 and older. Please use 10.13.0 LTS or newer.
 * fix: Rename `gitignore` and `npmignore` to dot files when copying local files.
 * fix: Fixed incorrect use of `got` library when streaming downloaded files to disk.
 * chore: Updated npm dependencies.

# v1.1.1 (Apr 12, 2020)

 * fix: Install all dependencies, not just production dependencies.

# v1.1.0 (Apr 10, 2020)

 * feat: Added `template` option to `TemplateEngine()` constructor.
 * feat: Added `template` property to `meta.js`.
 * chore: Updated npm dependencies.

# v1.0.1 (Mar 19, 2020)

 * Initial release with support for:
   - Project generation using local template as a directory, archive file, or globally installed
     npm package
   - Download templates from git, npm, or a URL to a archive file
   - Support for `.zip`, `.gz`, `.bz2`, `.tar`, `tar.gz`, `tar.bz2`, `.tgz`, and `.tbz2` archives
   - Run text files through [`ejs`][ejs] during file copy
   - JavaScript lifecycle hooks
   - User-defined copy file inclusion/exclusion filters
   - Data-driven destination directory and filenames
   - npm dependency installation
   - git repository initialization
