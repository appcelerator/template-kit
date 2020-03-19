# v1.0.0

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
