# Review List

Items to discuss with the maintainer about how to proceed.

## `config get cacheFolder` (Commands config get > it should print native paths)

The test `commands/config/get.test.js > it should print native paths` calls
`yarn config get cacheFolder --no-redacted`. Berry exposed `cacheFolder` as a
top-level configuration key (defaulting to `./.yarn/cache`), but in zpm the
cache directory is computed from `globalFolder` (when `enableGlobalCache` is
true) or from `localCacheFolderName` inside `.yarn/`. There is no stored
`cacheFolder` setting.

Should we expose `cacheFolder` as a virtual / computed setting accessible via
`config get`, or update the test to use `globalFolder` (or another existing
key)? The user instructed not to modify tests, so the suggested path is to add
a computed getter for `cacheFolder` that resolves to `preferred_cache_path()`.

## `set version`: yarnPath / --yarn-path / --no-yarn-path / --only-if-needed / `self`

The `commands/set/version.test.ts` suite expects the legacy yarnPath workflow:
8 tests cover combinations of `set version 3.0.0` (with or without
COREPACK_ROOT), `set version self`, `--yarn-path`, `--no-yarn-path`,
`--only-if-needed`, and arbitrary file paths. They expect a release binary to
be written under `.yarn/releases/`, the `yarnPath` rc entry to be set
accordingly, and several new flags on the command.

zpm's `set_version.rs` documents that the command "will never set the
deprecated yarnPath field" and only updates `packageManager`. None of the
listed flags or the `self` selector are implemented today.

Should we restore yarnPath emission and the related flags so these tests
can pass, or update the tests / documentation? Given the explicit "never"
statement in the command's doc comment, the answer is probably to drop these
tests, but that needs the maintainer's call.
