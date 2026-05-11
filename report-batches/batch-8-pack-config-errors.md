# Batch 8 — Pack file selection, config plumbing, error message wording, rc aliases

## Synthesis

This batch is overwhelmingly small, scoped, test-driven alignment work: six of the ten commits are one- or two-line tweaks to error wording, schema/serde plumbing, and test paths so that zpm matches berry's observable behavior. The two more substantial commits — `b9c01b3` (folder packing) and `93299d4` (browser-map keys) — are real bug fixes in the pack pipeline, both of which are correct in intent but expose a recurring shape in `pack_list`: each `manifest.<field>.paths()` site repeats the same `format!("!/{}", path)` glob-injection pattern with slightly different inner accessors. The strongest cross-cutting smell is that pattern, plus the embedding of `Usage Error: ` directly inside an error variant's `#[error(...)]` literal in `61b4426`. None of the commits introduces obviously wrong behavior; the only flagged bug is a *latent* one in `ebe53ea` (the derived `cacheFolder` ignores `localCacheFolderName`).

---

### 159a6fe — Aligns pnp test unplugged paths with the zpm/berry convention

**Quality:** Pure test-path search-and-replace from `.yarn/ignore/unplugged` to `.yarn/unplugged`, matching the unplugged location actually used at `packages/zpm/src/project.rs:249` and documented in `packages/zpm/src/commands/rebuild.rs:15`. Mechanical and correct.

**Bugs:** (none)

**Style fit:** Yes; only literal string substitutions across `tests/acceptance-tests/pkg-tests-specs/sources/pnp.test.js`.

**Helper opportunities:** None. The test already uses `xfs.readdirPromise(${path}/.yarn/unplugged)` repeatedly — could be a constant in the test helpers, but that's pre-existing.

**Suggested patch / repro:** N/A.

---

### 7cc699d — Updates patch parse error to mention 'Unable to parse patch file'

**Quality:** One-character-precision wording change at `packages/zpm/src/error.rs:472`, matched by the test at `tests/acceptance-tests/pkg-tests-specs/sources/protocols/patch.test.ts:188`. Trivial.

**Bugs:** (none)

**Style fit:** Yes, identical `#[error(...)]` shape as siblings.

**Helper opportunities:** Several adjacent patch errors (`packages/zpm/src/error.rs:451-488`) share the "<event> in patch file" shape but use inconsistent prefixes ("Unrecognized pragma", "Hunk lines encountered…", "Missing rename target…", and now "Unable to parse patch file: …"). Consolidating these under a single `PatchParseError { detail: String }` variant with a uniform `"Unable to parse patch file: {}"` body would match the new wording and reduce variant proliferation.

**Suggested patch / repro:** N/A.

---

### b9c01b3 — Preserves directory structure when packing folder dependencies

**Quality:** Correct fix. The old code grabbed `entry.file_name()` which dropped subdirectory components; the new code calls `entry_path.relative_to(&base)` where `base = path.clone()`. Both arguments are absolute (callers in `packages/zpm/src/fetchers/folder.rs:56` and `packages/zpm/src/fetchers/patch.rs:134` always pass absolute paths), so the `assert!(self.is_absolute())` inside `Path::relative_to` (`packages/zpm-utils/src/path.rs:1022-1023`) is satisfied.

**Bugs:** (none)

**Style fit:** Yes. The fix renames `path` to `entry_path` to avoid shadowing the outer queue-popped `path`, which is actually clearer than the original.

**Helper opportunities:**
- `packages/zpm-formats/src/lib.rs:142-202` — `entries_from_folder` and `entries_from_files` build the same `Entry { mode, crc: 0, data, compression: None }` triple after the same `fs_read + fs_metadata + 0o111 check`. Extracting a `fn entry_from_file(name: Path, abs_path: &Path) -> Result<Entry, Error>` would deduplicate 8 lines per call site.
- `entries_from_folder` re-clones `path` into both `base` and the initial `process_queue` entry; the first clone is the only one actually needed (`base` could just be the borrow if the helper above were extracted).

**Suggested patch / repro:** N/A.

---

### 93299d4 — Includes browser field map keys in pack file selection

**Quality:** Correct in spirit: berry's pack walker emits browser keys as well as values, because both can be file paths (`{"./ok1.js": false, "./ok2.js": "./ok3.js"}` is the test case at `tests/acceptance-tests/pkg-tests-specs/sources/commands/pack.test.js:107-130`). However the return-type churn is invasive (see Style fit below) and over-emits when keys are bare module names (e.g. `{"react": false}` would now feed `!/react` to the glob, which simply never matches — harmless but wasteful).

**Bugs:** (none, behavioral). The "keys may be bare module names" case is silently no-op as discussed; no functional bug.

**Style fit:** **No.** `BrowserField::paths()` now returns `impl Iterator<Item = String>`, whereas peer accessors `ExportsField::paths()` (`packages/zpm/src/manifest/exports.rs:19`), `ImportsField::paths()` and `BinField::paths()` (`packages/zpm/src/manifest/bin.rs:36`) all return `Iterator<Item = &Path>` or `Iterator<Item = &RawPath>`. The downstream loop in `packages/zpm/src/pack.rs:636-638` consequently writes `format!("!/{}", import_path)` while the surrounding exports/imports/bin loops write `format!("!/{}", path.to_file_string())`. The simpler fix would have been to make `paths()` return `impl Iterator<Item = &Path>` by allocating a `Vec<&Path>` of borrows to the map keys (parsed as `RawPath` ahead of time) plus the existing values.

**Helper opportunities:**
- `packages/zpm/src/pack.rs:619-657` repeats the `format!("!/{}", X.to_file_string())` shape eight times across `main`, `exports`, `imports`, `browser`, `module`, `bin`, `types`, `typings`. A helper `fn add_pack_root_paths<'a>(glob_ignore: &mut Glob, paths: impl IntoIterator<Item = &'a str>)` consuming a uniform string iterator would let each manifest accessor expose `paths(&self) -> impl Iterator<Item = &str>` and collapse the eight blocks into eight one-liners.

**Suggested patch / repro:** No bug filed; style smell only.

---

### 5a6543c — Aligns the constraints-check failure message with the documented wording

**Quality:** One-line wording fix at `packages/zpm/src/error.rs:349`. Matches `tests/acceptance-tests/pkg-tests-specs/sources/features/constraintsChecks.test.ts:18`.

**Bugs:** (none)

**Style fit:** Yes; same `DataType::Code.colorize("yarn constraints")` pattern used in 4 other variants at `packages/zpm/src/error.rs:418/559/562`.

**Helper opportunities:** None new.

**Suggested patch / repro:** N/A.

---

### 61b4426 — Reformats the script-not-found error to surface as a usage error

**Quality:** Single-variant wording change at `packages/zpm/src/error.rs:367` to satisfy `tests/acceptance-tests/pkg-tests-specs/sources/commands/exec.test.ts:11`. Functionally fine.

**Bugs:** (none)

**Style fit:** **Borderline.** The `"Usage Error: "` prefix is now baked into the `#[error(...)]` literal for exactly *one* `Error` variant. Berry surfaces "Usage Error" via clipanion's error class, not via the message body. The neighbor variant `GlobalScriptNotFound` (line 371) stays "Global script not found ({0})", so the pair is now stylistically inconsistent. If more tests expect the same prefix on other variants, this will fan out into ten more one-off literals.

**Helper opportunities:** If clipanion-rs (`packages/clipanion`) exposes a usage-error wrapper trait, mapping `ScriptNotFound` through it at the print site (rather than encoding "Usage Error: " in the variant) would be more in line with how berry handles the same wording. Worth checking before more variants accumulate the prefix.

**Suggested patch / repro:** N/A (not a bug).

---

### d9e80f0 — Honors property aliases when deserializing rc files

**Quality:** Two correct, surgical fixes. The build-script change at `packages/zpm-config/build.rs:296-301` mirrors the existing alias emission for the public struct (`packages/zpm-config/build.rs:324-329`) — emitting `#[serde(alias = "<aliasCamelCase>")]` on the Partial fields. Verified in the regenerated `target/release/build/zpm-config-a7c628b798fb325c/out/schema.rs:63-64` where `enable_auto_types: Partial<…>` now carries `#[serde(alias = "tsEnableAutoTypes")]`. The companion `config_set` change at `packages/zpm/src/commands/config_set.rs:78-86` re-parses the hydrated value as JSON so booleans/numbers reach `.yarnrc.yml` as real literals instead of strings, with a graceful string fallback on parse failure.

**Bugs:** (none)

**Style fit:** Yes. The build-script loop is copy-pasted from the public-struct loop two scopes down; identical indentation and casing.

**Helper opportunities:**
- `packages/zpm-config/build.rs:296-301` and `packages/zpm-config/build.rs:324-329` are now byte-identical alias-emission loops. Extracting a `fn write_aliases<W: Write>(writer: &mut W, indent: &str, aliases: &[String])` would eliminate one of them and cut a future drift hazard. (The same alias list is also walked at `:361`, `:390`, and `:426`, but those use different output shapes — hydrate/get match arms — so they're not directly merge-able.)
- The `match JsonDocument::hydrate_from_str(...)` + `Value::String` fallback pattern in `config_set.rs:82-85` mirrors the `--json` branch above (line 73-77). A small helper `fn to_yaml_value(literal: &str) -> Value` collapsing both branches would localize the json/string coercion logic.

**Suggested patch / repro:** N/A.

---

### ebe53ea — Exposes cacheFolder as a derived configuration setting

**Quality:** Adds a `cacheFolder` schema entry (`packages/zpm-config/schema.json:133-137`) whose default is computed by `compute_cache_folder` in the new `packages/zpm-config/src/fns.rs:5-19`. Function shape mirrors the existing `check_tsconfig` at `:21-43`. Behaviorally correct as a *read-only inspection* knob, but see bug below.

**Bugs:**
- [low] `packages/zpm-config/src/fns.rs:5-19` — `compute_cache_folder` hardcodes the path component `"cache"`, ignoring the `localCacheFolderName` setting (`packages/zpm-config/schema.json:186-190`, default `"cache"`) that `Project::local_cache_path()` actually uses at `packages/zpm/src/project.rs:265-269`. It also ignores `enableGlobalCache` (which would route the cache through `globalFolder`), so `yarn config get cacheFolder` will report `<cwd>/.yarn/cache` even when the real cache directory lives somewhere else. No test currently exercises a non-default `localCacheFolderName` for this command, hence "low" severity — but the contract advertised by the schema description ("the folder where the cache files for the active install will be stored") is broken in those cases.

**Style fit:** Yes — function placement and naming match `check_tsconfig`.

**Helper opportunities:** The duplicated `if let Some(...) = &context.project_cwd / package_cwd { ... }` shape in both functions (`fns.rs:5-19` and `:21-43`) could be folded into a `context.preferred_cwd() -> Option<&Path>` accessor on `ConfigurationContext`.

**Suggested patch / repro:**
```diff
 pub fn compute_cache_folder(context: &ConfigurationContext) -> Path {
-    if let Some(project_cwd) = &context.project_cwd {
-        return project_cwd
-            .with_join_str(".yarn")
-            .with_join_str("cache");
-    }
-
-    if let Some(package_cwd) = &context.package_cwd {
-        return package_cwd
-            .with_join_str(".yarn")
-            .with_join_str("cache");
-    }
-
-    Path::new()
+    let cwd = context.project_cwd.as_ref()
+        .or(context.package_cwd.as_ref());
+    let Some(cwd) = cwd else { return Path::new() };
+    // TODO: thread localCacheFolderName through ConfigurationContext so we
+    // honor a user override here.
+    cwd.with_join_str(".yarn").with_join_str("cache")
 }
```
Repro: `commands/config/get.test.js` with an added case setting `localCacheFolderName: "foo"` — `yarn config get cacheFolder` would still report `.yarn/cache`.

---

### 00d14bf — Falls back to find_closest_package_manager for yarn set version

**Quality:** Correct: the new fallback at `packages/zpm/src/commands/set_version.rs:24-34` mirrors `zpm-switch`'s own proxy logic at `packages/zpm-switch/src/commands/proxy.rs:11-19` (`find_closest_package_manager(&cwd)?.detected_root_path`), so the command now works when invoked directly (e.g. from the test runner) without the switch wrapper having set `YARNSW_DETECTED_ROOT`.

**Bugs:** (none)

**Style fit:** Yes; same `match env::var(...)` shape used in a few other commands. The added REVIEW-LIST.md entries are appropriate given the doc comment at `set_version.rs:12` explicitly says "it will never set the deprecated `yarnPath` field" — a real maintainer call.

**Helper opportunities:**
- `packages/zpm/src/commands/set_version.rs:24-34` and `packages/zpm-switch/src/commands/proxy.rs:11-19` both implement "resolve detected root with env override then fallback". A `zpm_switch::resolve_detected_root() -> Result<Path, Error>` helper would centralize the env-var name and the `find_closest_package_manager` plumbing.

**Suggested patch / repro:** N/A.

---

### 7fc824b — Updates pack ** gitignore test for correct glob semantics

**Quality:** Test-only update: removes the stale `x.js`-at-root expectation and replaces the TODO referencing yarnpkg/berry#5872 with an explanatory comment. Mechanical.

**Bugs:** (none)

**Style fit:** Yes; the new comment block at `tests/acceptance-tests/pkg-tests-specs/sources/commands/pack.test.js:411-413` matches other inline rationale comments in the same file.

**Helper opportunities:** None.

**Suggested patch / repro:** N/A.

---

## Cross-cutting observations

- **Manifest-traversal duplication in `pack_list` (`packages/zpm/src/pack.rs:619-657`).** The block has eight near-identical `format!("!/{}", path)` calls walking `main / exports / imports / browser / module / bin / types / typings`. Each branch hand-rolls the iteration with subtly different inner accessors (`to_file_string()` for `exports`/`imports`/`bin`, raw `String` for `browser` after `93299d4`, the underlying value itself for `main`/`module`/`types`/`typings`). Consolidating around an `Iterator<Item = &str>` accessor on each manifest field would let this become a 8-line table-driven loop and remove the `93299d4` style inconsistency.
- **Error-message construction.** `7cc699d`, `5a6543c`, and `61b4426` are all "fix one literal to match the test runner's expectation". The patch-error family (`packages/zpm/src/error.rs:451-488`) could collapse into a single `PatchParseError { detail: String }` variant with a uniform `"Unable to parse patch file: {}"` body — that would have absorbed `7cc699d` and prevented future one-shot wording fixes. The `"Usage Error: "` prefix introduced in `61b4426` is structurally out-of-place inside an `#[error(...)]` literal; if more variants need it, route them through a clipanion-style wrapper instead.
- **`entries_from_folder` and `entries_from_files`** in `packages/zpm-formats/src/lib.rs:142-202` now both contain the same `fs_read + fs_metadata + 0o111 → mode + Entry { ... }` body. A `entry_from_file(name, abs_path)` helper would deduplicate this and would have made `b9c01b3` a one-line change.
- **`ConfigurationContext.project_cwd / package_cwd` fallback** is open-coded twice in `packages/zpm-config/src/fns.rs` (`compute_cache_folder`, `check_tsconfig`). A `preferred_cwd()` accessor on the context would shorten both. While there, threading `localCacheFolderName` through the context would also fix the `ebe53ea` low-severity bug.
- **`d9e80f0` build-script copy/paste.** The two alias-emission loops at `packages/zpm-config/build.rs:296-301` and `:324-329` are now byte-identical. They should share a helper to prevent the *next* commit that touches alias rendering from missing one of the two sites — which is exactly the bug `d9e80f0` itself was fixing.
