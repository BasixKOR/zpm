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
