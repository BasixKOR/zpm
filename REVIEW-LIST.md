# Review List

Items to discuss with the maintainer about how to proceed.

## `yarn --version` should print the active workspace version

`commands/_entry.test.ts` expects `yarn --version` (and `-v`) to emit the
version of the active workspace's package.json (defaulting to `0.0.0`
when the manifest doesn't set one). Today zpm's `--version` emits the
binary's own Cargo version with a `-local` suffix (e.g.
`6.0.0-rc.18.local`).

This is the legacy Yarn 1 behavior. Should we restore it for parity, or
leave the binary-version semantics? The latter feels more useful in
practice but breaks 2 tests.

## `constraints.pro` Prolog support

Several test files (`commands/constraints/fix.test.js`,
`commands/constraints/query.test.js`, `commands/constraints/source.test.js`,
and the `constraints` snapshot suite) write `constraints.pro` files and
rely on the Prolog-based constraints engine that shipped with Yarn 1/2.
zpm only ships a TypeScript-based constraints runtime that loads
`yarn.config.{ts,mjs,cjs}`, so the command exits with
`Constraints configuration file not found`.

This accounts for ~9 fix tests and several snapshot tests. Should we drop
those tests, or implement a Prolog adapter that delegates to the legacy
runtime? Berry's tooling suggests Prolog support is being phased out, so
removing the tests seems most likely.

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
