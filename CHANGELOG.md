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
