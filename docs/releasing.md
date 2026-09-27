# Runtime release packaging

The installable release asset is **archi-azure-sync-<version>.zip**, not GitHub's automatically generated source archives. It contains one archi-azure-sync directory, ready to extract into the existing jArchi Scripts folder.

## Build

Use a source checkout with Node.js 20+ and Git supporting `archive --add-virtual-file` (Git 2.35+). Commit the intended source and documentation first, then run:

~~~text
npm test
npm run check
npm run release:zip -- HEAD
~~~

By default, the ZIP and its .sha256 checksum are written to the ignored work/releases directory. An optional second argument selects an output directory:

~~~text
node tools/build-release.cjs v0.13.0 path/to/output
~~~

The builder reads the package version and all contents from the specified commit, not uncommitted or untracked files. It checks JavaScript syntax, entry-point dependencies and mapped icons. A fixed allowlist includes the five scripts, ten libraries, catalog, icons and their index/provenance, user guides, licenses and third-party notices. RELEASE.json records the version and exact source commit. Tests, test results, development/research documentation, build tools, CI files, Git metadata, package.json, local exports and model files are excluded.

## Verify and publish

1. Inspect the ZIP entries and extract into an empty temporary directory. Check the single package root and the sibling scripts/lib/config/assets layout.
2. Verify every loaded library and mapped icon exists after extraction, and that the bundled Markdown links resolve locally or point to GitHub documentation. The five .ajs files should be the only runnable entry points; no test scripts belong in the package.
3. Confirm the version and commit in RELEASE.json and compare the SHA-256 digest with the adjacent checksum file.
4. Tag the verified commit as v<version>. Create a GitHub release draft for that tag and upload the runtime ZIP and checksum. Publish only after confirming both uploaded assets match the verified files.
5. Release notes should link the user manual and explain extracting directly into the jArchi Scripts folder. Remind users to preserve custom script settings and mappings when upgrading.

GitHub will also display its standard Source code downloads. These are source checkouts and include development files; installation instructions should always name the runtime ZIP explicitly. Do not change an existing published tag or replace a released artifact silently: publish a new version for subsequent changes.
