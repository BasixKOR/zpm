# Review List

Items to discuss with the maintainer about how to proceed.

## `YARN_CACHE_FOLDER` should override the cache path

`commands/add.test.ts: "it should not clean the cache when cache lives
outside the project"` (and `features/cache.test.ts: "it should detect
when the files checksum is incorrect"` and several similar) set
`YARN_CACHE_FOLDER` and expect package zips to live there. zpm
currently splits the cache into:

- `global_folder/cache` (`enableGlobalCache=true`, the default)
- `cache_folder` (`enableGlobalCache=false`)

`YARN_CACHE_FOLDER` maps to the `cacheFolder` setting, which is only
used as the local cache — so the env var has no effect when the
default global cache is enabled. Tests then read `.yarn/cache`,
expecting to find the zips there, and don't.

Berry has a single `cacheFolder` (no global/local split), so the env
var simply works. Should we collapse the two caches, or have an
explicit `cacheFolder` override take precedence over
`enableGlobalCache`?

Blocks ~10 tests in `features/cache.test.ts`,
`features/mirror.test.js`, `features/enableOfflineMode.test.ts`, and
the `commands/add.test.ts` shared-cache test.

## `immutablePatterns` not implemented

`features/immutablePatterns.test.ts` (~6 tests) wants the
`immutablePatterns` config setting to take a list of glob patterns;
during a `--immutable` install, zpm should checksum the matching files
before and after the install and fail with
`The checksum for <pattern> has been modified by this install` if any
of them changed.

Today the setting is not parsed and no comparison happens. The feature
is invasive — it has to hook the install lifecycle to snapshot the
file tree, then re-hash after linking — but it's a self-contained
addition (one config setting + one pre/post hook).

## `logFilters` not implemented

`features/logFilter.test.ts` (~7 tests) wants a `logFilters` config —
a list of rules matching on YN0xxx code, exact text, or glob pattern,
with a `level` of `discard`/`info`/`warning`/`error`. Matching messages
should be suppressed or upgraded/downgraded, and sections whose only
contents got discarded should not render their header/footer at all.

This requires changes deep in the report writer (`packages/zpm/src/
report.rs`): match-and-rewrite at emission time, plus a "did this
section emit anything" tracking to suppress empty sections.

## PnP file portability (relative paths)

`pnp.test.js: "should make it possible to copy the pnp file and cache
from one place to another"` expects `.pnp.cjs` to use paths relative
to the project root so the install artifacts are portable across
checkout locations.

Today zpm bakes absolute paths into `.pnp.cjs`. Fixing this means
rewriting the path-emission step in `packages/zpm/src/linker/pnp.rs`
so every recorded path is relative to `__dirname` and resolved with
`path.resolve(__dirname, ...)` at runtime. Cross-cutting but
mechanical.

## `install --json` NDJSON output

`it should print regular messages as JSON items when using --json`
expects the install report to emit one NDJSON object per message
(`{data, displayName, indent, name, type}`). The flag is currently
accepted as a no-op. Implementing it requires the report writer to
support a JSON sink in addition to the human one (parallel to
`logFilters` — both touch the same code path).

## `npmMinimalAgeGate` recursive up

`features/npmMinimalAgeGate.test.ts: "up > recursive should update to
the latest version allowed by the minimum release age"` does:

1. `yarn install`
2. `yarn set resolution release-date@npm:^1.0.0 npm:1.0.0`
3. `yarn up --recursive`

…and then expects `require('release-date-transitive/package.json')` to
work in PnP. zpm errors with `UNDECLARED_DEPENDENCY` for
`release-date-transitive`, suggesting `set resolution` isn't
propagating its forced version through transitive deps when followed
by an `up --recursive`. Worth tracing rather than deferring, but
non-trivial.

## Collapsed peer-dependency warnings

`features/peerDependenciesMeta.test.ts` (2 tests) and
`pnp.test.js: "should warn when the peer dependency resolution is
incompatible"` (YN0060) want grouped peer-dep warnings of the form
`no-deps is listed by your project with version 1.1.0 (p123456),
which doesn't satisfy what mismatched-peer-deps-lvl1 and other
dependencies request (1.0.0)`.

Today zpm emits YN0002 for missing peers but doesn't collapse
multi-dependent mismatches nor compute the parent hash marker
(`p123456`).

## node-modules linker edge cases

`node-modules.test.ts` has ~30 failures across hoisting (workspace
hoist borders, `nmHoistingLimits: dependencies`, nested
`nohoist`/`workspaces.nohoist`, portal hoisting, self-references,
scoped workspaces, `nmMode: hardlinks{,-global}`, `winLinkType`,
`supportedArchitectures`, etc.). These are all individual edge cases
of `linker/node_modules.rs`.

Worth a focused pass; each one is small but together they're large.
Most depend on either the hoist algorithm understanding new
`workspaces` shapes (object form with `nohoist`) or on portal-specific
isolation logic.

## `nohoist` deprecation warning

`node-modules.test.ts: "should warn about 'nohoist' usage and retain
nohoist field in the manifest"` (and several other workspace-shape
tests) needs the `workspaces` manifest field to accept both the array
shape (today) and the legacy object shape `{packages, nohoist}`. zpm's
deserializer is `Option<Vec<String>>` and rejects the object form
outright, so the install fails with a manifest parse error before any
warning could fire.

Adding a custom deserializer that accepts either shape unlocks the
`nohoist` warning plus several node-modules tests that use the object
shape just to declare nested workspace globs.

## `version major --deferred` + `decline`

`commands/version.test.ts: 'it should successfully apply "decline" on
top of the stored version'` defers a major bump, then runs `version
decline --deferred`, and expects the manifest version to become
`2.0.0`. zpm leaves it at `1.0.0` (because nothing has been applied).

Either berry's `decline` after a stored bump implicitly applies the
stored strategy, or the test expectation is wrong. Worth checking
against berry source before either porting the behavior or marking
the test obsolete.

## Dragon test 13 — optional/non-optional dep coexistence

`dragon.test.js: "it should pass the dragon test 13"` puts the same
package (`no-deps-failing`) as an optional dep in one workspace and a
regular dep in another, and expects the install to fail because the
regular-dep workspace requires it. Today zpm reports the build error
but exits 0 — meaning the locator is still flagged as in
`optional_builds` after the traversal even though pkg-b's traversal
should have removed it.

The static reading of `tree_resolver.rs` says `optional_builds.remove`
runs before the early return at line 133, but the observed behavior
says otherwise. Needs instrumented tracing to confirm; likely a
subtle issue with virtualization or root-iteration order.

## JSR protocol not implemented

`protocols/jsr.test.ts` (4 tests) wants the `jsr:` protocol for
adding, installing, renaming, and the publish-time rewrite to `npm:`.
No `jsr` resolver/fetcher exists in `packages/zpm/src/resolvers/` or
`fetchers/`.

## `--check-resolutions` validator not implemented

The tests under `features/checkResolutions.test.ts` were ported to
zpm's JSON lockfile shape, but the flag is still wired in as a no-op.
Expected behaviour: re-resolve each lockfile entry's descriptor and
fail with YN0078 when the recorded `resolution` would not be picked
again (e.g. someone hand-edited the lockfile to point a known
descriptor at an unrelated locator).

## `prunedNativeDeps` (os/cpu/libc filtering)

`features/prunedNativeDeps.test.ts` (4 tests) wants the install
plan's `--mode=update-lockfile` or `supportedArchitectures` to filter
packageTarball entries by `os`/`cpu`/`libc`, removing unsupported
variants from the lockfile/cache.

## Pack `**` gitignore — intentional bug parity

`commands/pack.test.js: "should support gitignore patterns (**)"`
encodes berry's *known* bug (yarnpkg/berry#5872) where a `**/x.js`
pattern in `.gitignore` excludes nested `x.js` files but leaves the
root `x.js` in the pack list. zpm's gitignore implementation is
correct (root `x.js` is excluded) and the test fails as a result.
Decide: replicate the bug for compatibility, or update the expected
output once berry is fixed upstream.
