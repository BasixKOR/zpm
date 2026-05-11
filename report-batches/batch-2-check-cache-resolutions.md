# Batch 2 — cache integrity / resolutions verification

This batch lands two distinct features behind `--check-cache` and `--check-resolutions`, plus a `cache clean` UX split. The check-cache work is the riskiest: it threads a brand-new `cache_checksums` map through `InstallState` (rkyv-archived), force-refetches every cached zip through the registry, and adds tampering detection both at the npm fetcher and at the `InstallManager` finalization step. The check-resolutions work is structurally simpler — a small, range-typed sanity check against the cached locator — but ships with a malformed error message because the `ResolutionMismatch(Descriptor, Locator, Locator)` triple is populated with the same locator twice. The test ports and the `--check-cache` alias are mechanical. The `cache clean` split is fine but has some minor duplication. Overall the implementation reads like Maël's existing style (long `or_else` chains, inline comments explaining intent, `with_join_str` builders). Two real-but-minor regressions land in `DiskCache::upsert_blob_inner` (silent fallback on non-NotFound IO errors) that deserve a look.

### 09fa0af — Ports checkResolutions tests to zpm's JSON lockfile format

**Quality:** Straightforward port. The hand-rolled `parseDescriptor` is sufficient for the test's purposes; the comment block explaining the resolution-rewrite scheme is helpful.

**Bugs:** (none)

**Style fit:** Matches the surrounding tests-as-data style.

**Helper opportunities:** `parseDescriptor` is duplicated in spirit across several zpm test ports; if more land it could go into a tiny shared `tests/support/structUtils.ts` shim that mirrors what berry's `structUtils` offered (parseDescriptor / stringifyIdent). Not worth doing as a one-off.

**Suggested patch / repro:** (n/a)

### 755898e — Looks up the lockfile entry by ident in checkResolutions tests

**Quality:** Pragmatic fix. The matcher accepts either the exact descriptor key or any key starting with `${ident}@`, which is loose but correct given there's exactly one entry per ident in these test cases. The `as [string, any] | undefined` cast is the price of `Object.entries` typing — fine.

**Bugs:** (none, but see note below)

**Style fit:** Matches.

**Helper opportunities:** `Object.entries(lockfileData.entries).find(([key]) => key.startsWith(...))` is going to recur — `tests/acceptance-tests/pkg-tests-specs/sources/features/checkResolutions.test.ts:50-53` reads like a candidate for a `findLockfileEntryByIdent(lockfile, ident)` helper, but again only worth it once a second caller appears.

**Suggested patch / repro:** (n/a)

### caad332 — Implements --check-resolutions structural verification

**Quality:** Sound design. The "intentionally structural" comment justifies why we don't re-resolve; the range-type match on `RegistrySemver` + `Git` is the right shape, and shorting through `Reference::Shorthand` so we read the ident off the locator is exactly the kind of footgun callout you want left in code. Wiring through `set_check_resolutions` on `InstallContext` cleans up an old loose end. The verify call runs from both `CacheHit::Full` and `CacheHit::Pinned` branches — good coverage.

**Bugs:**
- [medium] `packages/zpm/src/install.rs:602-606` — the `mismatch` closure passes `locator.clone()` twice to `Error::ResolutionMismatch(Descriptor, Locator, Locator)`. The `error.rs:496` format string reads `"... would resolve to {.2} on a fresh install, but the lockfile pins it to {.1}"`, so the user-facing message ends up `"foo@x would resolve to LOCATOR on a fresh install, but the lockfile pins it to LOCATOR"` — identical clauses, which is nonsense. The variant arity exists precisely to differentiate "lockfile pin" vs "fresh resolve", but the current call site has only the lockfile pin available, since the function explicitly skipped re-resolution. The struct should probably be collapsed to `ResolutionMismatch(Descriptor, Locator)` with the message reworded ("the lockfile pins it to LOCATOR, but that locator no longer satisfies the descriptor's range"), or the third field genuinely populated with a freshly-resolved locator. As-is, every YN0078 in practice will look broken. Tests don't catch this because they only assert `toThrow(/YN0078/)` (tests/acceptance-tests/pkg-tests-specs/sources/features/checkResolutions.test.ts:85).

**Style fit:** Matches. The `with_context_result(ReportContext::Descriptor(...), ...)` wrap is the codebase's standard error-attribution pattern.

**Helper opportunities:** The two `if ctx.check_resolutions { ... verify ... }` blocks at `install.rs:297-301` and `install.rs:306-311` are near-identical (only the locator source differs). Could be hoisted into a single `verify_cache_hit(&ctx, &descriptor, &locator)` helper that internally checks the flag, but the saving is six lines.

**Suggested patch / repro:**
```diff
-    #[error("[YN0078] {} would resolve to {} on a fresh install, but the lockfile pins it to {}", .0.to_print_string(), .2.to_print_string(), .1.to_print_string())]
-    ResolutionMismatch(Descriptor, Locator, Locator),
+    #[error("[YN0078] The lockfile pins {} to {}, but that locator no longer satisfies the descriptor", .0.to_print_string(), .1.to_print_string())]
+    ResolutionMismatch(Descriptor, Locator),
```
and at the call site:
```diff
-    let mismatch = || Error::ResolutionMismatch(
-        descriptor.clone(),
-        locator.clone(),
-        locator.clone(),
-    );
+    let mismatch = || Error::ResolutionMismatch(descriptor.clone(), locator.clone());
```
A test that would fail today (i.e. would surface the duplicated-locator string) doesn't yet exist; the closest is `checkResolutions.test.ts`'s "should prevent resolving 'no-deps@npm:^1.0.0' with 'no-deps@npm:2.0.0'" — extending it with `await expect(check).rejects.toThrow(/lockfile pins it to.*but/)` would catch the structural form, and the current build would emit `would resolve to X on a fresh install, but the lockfile pins it to X` (same X), which is easy to detect with a regex requiring two distinct locator strings.

### 89c5b4e — Detects cache tampering of conditional native packages under --check-cache

**Quality:** Subtle but correct in intent. The flow — stash a `cache_checksums` map on `InstallState` _before_ the conditional-locator scrub clears the lockfile field, then compare against the previous install state under `--check-cache` — is the right approach to staying lockfile-arch-stable while still detecting tampering. The added re-hash-everything pass under `--check-cache` (forcing `missing_checksums` to include every entry) is also necessary so the comparison value is fresh. Adds `archive_path.fs_exists()` guard at `install.rs:1216-1218` so a missing zip just gets skipped — nice.

**Bugs:**
- [low] `packages/zpm/src/install.rs:1284-1307` — the quarantine-and-fail block for conditional locators duplicates the non-conditional block at `install.rs:1310-1330` almost verbatim (only the comparison source differs). The duplication is harmless but if either ever changes, the other will drift. See helper note.
- [low] `packages/zpm/src/install.rs:1253-1260` — the new `or_else` chain has `late_checksums.get(...)` twice. Under `check_checksums = true`, the first `late_checksums.get()` runs; if absent, falls through to `previous_checksum` (which under `--check-cache` is also what we want to override, not fall back to), then to `late_checksums.get()` again. The chain happens to do the right thing because `late_checksums` is populated for every entry under `--check-cache`, but the structure is fragile — if `missing_checksums` ever stopped covering an entry the lockfile-checksum-trust regression would silently come back.

**Style fit:** Matches. The "Stash the (possibly fresh) checksum in install state…" comment block is exactly the style this codebase uses for tricky ordering invariants. `serde(default, skip_serializing_if = ...)` on the new field is consistent with `nm_mode` right below.

**Helper opportunities:** Pulling the quarantine sequence (`PackageData::Zip` match → `project.ignore_path().with_join_str("quarantine")...` → `fs_read_prealloc` → `fs_create_parent`/`fs_write` → `Err(ChecksumMismatch)`) into a `quarantine_and_fail(project, locator, archive_path)` helper would deduplicate `install.rs:1288-1304` and `install.rs:1312-1328`. Worth doing.

**Suggested patch / repro:** For the `late_checksums` chain:
```diff
-            let mut checksum = package_data.checksum()
-                .or_else(|| if self.context.check_checksums {
-                    late_checksums.get(&entry.resolution.locator).cloned()
-                } else {
-                    None
-                })
-                .or_else(|| previous_checksum.cloned())
-                .or_else(|| late_checksums.get(&entry.resolution.locator).cloned());
+            let fresh_checksum = late_checksums.get(&entry.resolution.locator).cloned();
+            let mut checksum = if self.context.check_checksums {
+                package_data.checksum()
+                    .or_else(|| fresh_checksum.clone())
+                    .or_else(|| previous_checksum.cloned())
+            } else {
+                package_data.checksum()
+                    .or_else(|| previous_checksum.cloned())
+                    .or_else(|| fresh_checksum.clone())
+            };
```
No new repro needed; existing prunedNativeDeps tamper test exercises this path.

### a17014a — Re-fetches cached zips through the registry under --check-cache

**Quality:** Largest change in the batch and the most surface-area. The two new entry points (`CompositeCache::refetch_blob`, `DiskCache::refetch_blob`/`refetch_blob_data`) are clean factorings of the existing `ensure_blob`/`upsert_blob` over a shared `_inner` body. The npm fetcher reads pre-existing on-disk bytes _before_ the refetch so the atomic rename can't destroy the evidence — exactly the right ordering. Forcing `is_mock_request = false` for cached off-arch packages under `--check-cache` (`install.rs:444-450`) is the linchpin for the third fixed test.

**Bugs:**
- [medium] `packages/zpm/src/cache.rs:364-377` — `upsert_blob_inner` silently swallows _all_ IO errors from `tokio::fs::read(key_path_buf)`, not just `NotFound`. The original code at this site read `if err.kind() != std::io::ErrorKind::NotFound { return Err(err)?; }`; the new code is `if let Ok(data) = read { return Ok(...) }`. So a permission error, an interrupted I/O, etc., now silently triggers a refetch+overwrite instead of propagating. For a user who happens to have a chmod-protected mirror cache, this manifests as `cache.rs` quietly re-downloading and (under non-immutable mode) overwriting the locked file. Restore the explicit `NotFound`-only fallthrough.
- [low] `packages/zpm/src/cache.rs:306-314` — the `match exists { true if !force_refetch => ..., true | false => ... }` is awkward; `true | false` is exhaustive but reads strangely (a clippy lint will probably flag it). Prefer `_ =>` or restructure as an `if exists && !force_refetch { ... } else { ... }`.

**Style fit:** Matches. The `if !force_refetch { ... }` early-return shape mirrors how `ensure_blob_inner` already worked. The comments on `refetch_blob`, `refetch_blob_data`, and the `is_mock_request` override are good.

**Helper opportunities:** `CompositeCache::ensure_blob` and `CompositeCache::refetch_blob` (`cache.rs:142-188`) are now structurally identical except for the inner method name — the same pattern repeats in `upsert_blob` vs `refetch_blob_data`. Could collapse with a `force_refetch: bool` boolean carried through, the same way `DiskCache::ensure_blob_inner` already does. Saves ~30 lines.

**Suggested patch / repro:** For the IO-error regression:
```diff
-        if !force_refetch {
-            let read
-                = tokio::fs::read(key_path_buf.clone()).await;
-
-            if let Ok(data) = read {
-                return Ok(DataCacheEntry {
-                    info: InfoCacheEntry {
-                        path: key_path,
-                        checksum: None,
-                    },
-                    data,
-                });
-            }
-        }
+        if !force_refetch {
+            match tokio::fs::read(key_path_buf.clone()).await {
+                Ok(data) => return Ok(DataCacheEntry {
+                    info: InfoCacheEntry { path: key_path, checksum: None },
+                    data,
+                }),
+                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {},
+                Err(err) => return Err(err)?,
+            }
+        }
```
A targeted repro: a unit-ish integration test that pre-creates an unreadable cache entry (`chmod 000`) and runs a plain `install` (no `--check-cache`), expecting the install to fail with a PermissionDenied-style error rather than re-downloading. No existing test currently covers this — it'd be a defensive add rather than fixing a regression visible in CI.

### 99f7bfa — Merges workspaces map into entries for prunedNativeDeps lockfile assertion

**Quality:** Trivial test port. Switching from strict-array equality to `arrayContaining` + `toHaveLength(7)` loses positional ordering but keeps the membership-and-cardinality guarantee, which is the right shape for a JSON object whose keys aren't guaranteed-ordered.

**Bugs:** (none)

**Style fit:** Matches.

**Helper opportunities:** (none)

**Suggested patch / repro:** (n/a)

### e34f7a6 — Aliases --check-cache to --check-checksums on install

**Quality:** One-line change, well-justified by the commit message. Confirmed the `--name-a,--name-b` syntax is used elsewhere in the CLI (`commands/up.rs:57`, `commands/remove.rs:36`).

**Bugs:** (none)

**Style fit:** Matches.

**Helper opportunities:** (none)

**Suggested patch / repro:** (n/a)

### ca6e718 — Splits cache clean into local cache / mirror via --mirror / --all

**Quality:** Clean split. The `(clean_local, clean_mirror)` tuple computed once at `cache_clear.rs:77-83` is readable and the iteration loop at `cache_clear.rs:89` is symmetric. The new `enableCacheClean` setting + `CacheCleanDisabled` error round out the feature parity. Test coverage in `tests/acceptance-tests/pkg-tests-specs/sources/commands/cache/clean.test.js` validates each combination.

**Bugs:**
- [low] `packages/zpm/src/commands/cache_clear.rs:108-114` — under `!old` the inner `for entry in &entries { entry.fs_rm() }` is then followed by `cache_path.fs_rm()` on the parent. `fs_rm` of a directory is `remove_dir_all` (`packages/zpm-utils/src/path.rs:869`), so the parent `fs_rm` would already cover all children — the per-entry loop is redundant in the `!old` branch. Under `old` the per-entry loop is correct and the parent rm is skipped. Worth simplifying to:
  ```rust
  if old {
      for entry in &entries { entry.fs_rm().ok_missing()?; }
  } else if cache_path.fs_exists() {
      cache_path.fs_rm().ok_missing()?;
  }
  ```
- [low] `packages/zpm/src/commands/cache_clear.rs:106` — `cleared_entries += entries.len()` counts before any rm runs; if any `fs_rm` partially fails (each is `ok_missing()?`, so a non-missing failure does bubble — but missing files are counted as "cleared") the report can over-state. Pre-existing.

**Style fit:** Matches. Reusing the `CacheClear` / `CacheClear2` twin-struct pattern from earlier code is appropriate.

**Helper opportunities:** `CacheClear` and `CacheClear2` share four out of five fields and the same `execute` body. A small `CacheClearOpts { old, mirror, all }` struct shared between the two `cli::command` shells (with a thin `_clear: bool` adapter for `CacheClear2`) would deduplicate the option list — minor.

**Suggested patch / repro:** (n/a — the redundancy is cosmetic; tests pass.)

## Cross-cutting observations

- **Error-type symmetry**: both `caad332` (new `ResolutionMismatch` taking `(Descriptor, Locator, Locator)`) and existing `BadResolution(Descriptor, Locator)` describe similar conditions; the new error's triple is currently unused (two of the three slots collapse). Worth a pass to either populate the third field correctly (running a fresh resolve when `--check-resolutions` fails to find a match) or reducing the variant to a pair.
- **Quarantine duplication**: `89c5b4e` introduces a second copy of the quarantine-then-`ChecksumMismatch` sequence right next to the existing one. Together with the round-trip work in `a17014a`, there are now three near-identical "found tampering → quarantine → bail" sites (two in `install.rs`, one structurally implied in `fetchers/npm.rs:135-140`). Factoring this into one helper would also make it easier to add a unified `report.error("YN…")` line later.
- **Cache abstraction parallelism**: `a17014a` doubles the surface of `CompositeCache` (`ensure_blob`+`refetch_blob`, `upsert_blob`+`refetch_blob_data`). The two new methods are mechanical copies of the originals with a different inner call. Folding `force_refetch` into the `CompositeCache` methods (the same way `DiskCache` already does internally) would halve this layer.
- **IO error tolerance**: the `upsert_blob_inner` change in `a17014a` quietly relaxed error tolerance. Worth a codebase-wide grep for similar "explicit NotFound check became `if let Ok(...)`" patterns in this branch — the look of the diff suggests it was easier to ignore the error than to thread it through the new `force_refetch` early-exit.
- **Test-port hygiene**: `09fa0af`/`755898e`/`99f7bfa` collectively show the friction of porting berry's syml-based test scaffolding to zpm's JSON shape. A tiny `tests/support/lockfile.ts` exposing `findEntryByIdent(lockfile, ident)`, `mergeAllEntries(lockfile)`, and the local `parseDescriptor` would pay for itself over the next handful of ports.
