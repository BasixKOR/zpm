# Batch 4 — pnpm linker, build script output, install warnings

## Synthesis

The batch wires up four separate YN warning codes (YN0002 peers, YN0004/YN0005
disabled-script meta, YN0007 build start, YN0009 build failure), the
`--inline-builds` log-dump path, a content-addressed file index for the pnpm
linker, the non-workspace-cwd error, and a small offline metadata fallback.
The YN warnings work but are implemented with three different shapes
(`report.warn` directly under an awaited `current_report()`, the more cautious
`try_current_report()` pattern from inside sync code, and a one-off
`emit_yn0009` helper) — there's a clear opportunity to collapse the
`if let Some(report_guard) = try_current_report() { if let Some(report) =
report_guard.as_ref() { ... } }` 4-line dance into a single
`report_if_present(|r| r.warn(...))` helper that all four sites can share.
Two real bugs stand out: (1) the `--inline-builds` path calls `emit_success_log`
on the failure branch too, producing a duplicate-log dump when paired with the
already-emitted `ChildProcessFailedWithLog`; (2) the offline-metadata merge
runs `serde_json::to_vec` on every successful registry response (megabytes for
popular packages) and now blocks the async runtime on the disk write because
`spawn_blocking` was removed. YN0004 / YN0005 are emitted from inside
`get_package_internal_info`, which is called once per virtualized locator
and thus risks duplicate output for peer-virtualized packages. The CAS index
in commit c3c2714 is mostly clean; there's a dead `if/else` branch
(both arms call `fs_write(data)` identically) that just confuses the reader.

---

### 821e27b — Errors out when install is run from a non-workspace package directory

**Quality:** Small, focused, correct. The check is gated on
`!project.package_cwd.is_empty()` so a `yarn install` at the project root still
works, and it only fires when a `package.json` is present in the cwd but the
cwd isn't a declared workspace.

**Bugs:** (none)

**Style fit:** Yes. Builds the `nearest` path the same way it's used in the
adjacent `cwd_manifest_path`, returns a typed `Error` variant matching the
existing pattern in `error.rs`, and the `#[error("...")]` format uses
`to_print_string()` which is consistent with how other `Path`-bearing variants
render. Minor nit: `let nearest = project.project_cwd.with_join(&project.package_cwd);`
recomputes a path that was already partially built three lines above for
`cwd_manifest_path`; could hoist the join.

**Helper opportunities:**
- `packages/zpm/src/commands/install.rs:82-98` — the "if there is a `package.json`
  at cwd but no workspace covers it, error" check is generic enough that a
  `project.ensure_active_workspace()?` on `Project` would let other commands
  (e.g. `yarn add`, `yarn remove`, anything that calls `active_workspace`)
  reuse the same surface. Today `active_package()`
  (`packages/zpm/src/project.rs:468-486`) returns `WorkspaceNotInstalled` or
  `ActivePackageNotFound`, but says nothing about the package-directory case.

**Suggested patch / repro:** None.

---

### bd0fb39 — Emits YN0002 warnings for missing peer dependencies during install

**Quality:** Correct, well-scoped, deduplicates across virtual instances via
the `(physical_locator, peer_ident)` key. The `@types` scope skip matches the
auto-injection logic in `normalize_resolutions` at
`packages/zpm/src/install.rs:1790-1793`.

**Bugs:** (none material).
- (low) `packages/zpm/src/install.rs:809` — `virtual_locator.physical_locator()`
  is computed unconditionally inside the outer loop even when
  `missing_peer_dependencies.is_empty()` is also being checked at line 805.
  Order is fine (the early-continue is before the call), but `parent_locator`
  is then cloned for every `peer` (line 822 — `key = (parent_locator.clone(), peer.clone())`).
  Hoisting the `.clone()` to right before the `warned.insert` would skip the
  clone when the peer is `@types` or optional.

**Style fit:** Yes. Same `let report_guard = current_report().await; let Some(report) = report_guard.as_ref() else { return; };` pattern as
`report_package_extension_diagnostics` directly below it
(`packages/zpm/src/install.rs:836-873`). The `[YN0002]` prefix, the `to_print_string()`,
and the `BTreeSet` for dedup all match the surrounding diagnostic helpers.

**Helper opportunities:**
- `packages/zpm/src/install.rs:794-834` and `:836-873` — both
  `report_*` helpers have the exact same 4-line "get the report guard or return"
  preamble. A `with_report(|r| ...)` closure-passing helper in `report.rs`
  would let each diagnostic function start with one line.
- The `peer.scope() == Some("@types")` filter is mirrored at
  `packages/zpm/src/install.rs:1790`. If `Ident` grew an `is_types_scope()`
  method (in `packages/zpm-primitives/src/ident.rs:60`), both sites could share
  it (and a few other places that do similar string checks).

**Suggested patch / repro:** None.

---

### 3a439ee — Adds --inline-builds / --json flags to install and YN0004/YN0005 warnings

**Quality:** The new flags are accepted (with `--json` deliberately a no-op,
named `_json` to dodge dead-code) and the YN0004/YN0005 emission distinguishes
the manifest-driven case from the global-`enableScripts` case. The diagnostic
text reuses Yarn berry's exact phrasing.

**Bugs:**
- (medium) `packages/zpm/src/linker/helpers.rs:414-430` — `get_package_internal_info`
  is invoked once per *virtualized* locator by every linker (pnp.rs:321,
  pnpm.rs:125, nm/mod.rs:466). A package that gets virtualized N times will
  therefore emit N identical YN0004 / YN0005 lines. There's no `BTreeSet`
  guard like the YN0002 path uses. Repro: a package with build scripts and a
  peer dependency that's resolved differently across two consumers (e.g. two
  ranges of `react`), under `enableScripts: false`. The existing test in
  `tests/acceptance-tests/pkg-tests-specs/sources/commands/install.test.ts:810`
  uses `no-deps-scripted` (no peers) so it doesn't surface the duplication.
- (low) `packages/zpm/src/report.rs:28-30` — `try_current_report` returns
  `Option<RwLockReadGuard<...>>` via `try_read().ok()`. Any writer-holder
  (only `set_current_report` and the final take inside `with_report`) will
  silently swallow the warning. In practice that's exactly when the report is
  being torn down, but a comment explaining the failure mode would help — the
  current doc-comment just says "use when we're already in a Tokio context".

**Style fit:** Mostly. The new `try_current_report` helper is a clean addition.
One inconsistency: the warning is emitted from inside a *getter* (`get_package_internal_info`)
that is otherwise pure-data; warnings sit alongside the build-info computation,
not in a dedicated `report_*` helper like the peer-dep and extension reporters
in `install.rs`. Moving the emit into `Install::report_disabled_builds()` and
calling it from `link_and_build` (next to `report_missing_peer_dependencies`)
would group all YN diagnostics in one place, dedup naturally over
`physical_locator`, and let the linkers stay pure.

**Helper opportunities:**
- Same 4-line `if let Some(report_guard) = try_current_report() { if let Some(report) = report_guard.as_ref() { ... } }` pattern as in `build.rs:72-79`, `build.rs:466-473`,
  and `build.rs:499-503`. A `report::if_active(|r| { ... })` helper
  in `report.rs` would consolidate ~5 call sites added across this batch.
- The YN0004/YN0005 if/else inside the guard is screaming for a shared
  `report.diag(severity, code, message)` since the message body is identical
  modulo severity.

**Suggested patch / repro:**

```
// repro: tests/acceptance-tests/pkg-tests-specs/sources/commands/install.test.ts
// add a case that virtualises the scripted package:
test(`should only print one YN0004 per package, even when virtualized`,
  makeTemporaryEnv({dependencies: {a: `1.0.0`, b: `1.0.0`}}, async ({path, run}) => {
    // a and b both depend on no-deps-scripted but pin different peers
    await xfs.writeJsonPromise(ppath.join(path, Filename.rc), {enableScripts: false});
    const {stdout} = await run(`install`, `--inline-builds`);
    expect(stdout.match(/YN0004/g)?.length).toEqual(1);
  }));
```

Sketch fix (not applied):

```
--- a/packages/zpm/src/install.rs
+++ b/packages/zpm/src/install.rs
@@ async fn link_and_build(...)
   self.report_missing_peer_dependencies().await;
+  self.report_disabled_builds().await;
   self.report_package_extension_diagnostics(project).await;
```

…and move the YN0004/YN0005 emission out of
`packages/zpm/src/linker/helpers.rs:414-430` into the new helper with a
`BTreeSet<Locator>` keyed on `physical_locator()`.

---

### 5965d29 — Streams build script output under --inline-builds

**Quality:** The plumbing (threading `inline_builds` through `RunInstallOptions`
→ `InstallContext` → `Install` → each `BuildRequest`) is consistent and
mechanical. The virtual-locator skip for build-entry construction is the
right semantic fix and now lives in all three linkers (pnp.rs:393-396,
pnpm.rs:131-133, nm/mod.rs:452-454). One mismatch with the commit message:
the implementation is *not* streaming — it buffers each script's stdout/stderr
in `Vec<u8>` and dumps the combined log file at the end of the install via
`StreamReport::add_log_file` (which is processed in `Reporter::on_end`,
`packages/zpm/src/report.rs:316-322`). That's "captured + dumped at finish",
not "streamed". For long-running build scripts users won't see output until
the entire install finishes — surprising under `--inline-builds`.

**Bugs:**
- (medium) `packages/zpm/src/build.rs:133-148` — on failed build runs, the
  inline_builds path calls `emit_success_log(...)` *and* the script's
  `ScriptResult::Failure → ChildProcessFailedWithLog(...)` path also writes
  its own `error.log` via `script.rs:312-330`, which gets added as a LogFile
  by `StreamReport::error()` (`report.rs:547-555`). End result: the same
  failing build's stdout appears twice in the dump under `--inline-builds`.
  The `emit_success_log` helper name is also a tell that it's being used on a
  branch it shouldn't be. Repro: the existing
  "should not continue running build scripts if one of them fails" test
  (`install.test.ts:602-618`) — would fail an additional assertion
  `expect(stdout.match(/=== STDOUT ===/g)?.length).toBeLessThanOrEqual(1);`.
- (low) `packages/zpm/src/build.rs:480-504` — `emit_success_log` calls
  `Path::temp_dir()` per build, which goes through `temp_dir_pattern("temp-<>")`
  and `fs_create_dir()` for a unique nonce-suffixed folder
  (`packages/zpm-utils/src/path.rs:100-143`). Each build thus creates a
  separate temp directory it doesn't clean up; over many installs in a
  single `tmp` this leaks dirs. Yarn berry holds a single per-install temp
  dir and drops files into it. Trivial fix.
- (low) `packages/zpm/src/build.rs:74-77` — YN0007 is emitted unconditionally
  at the top of `BuildRequest::run`, but the message wording is
  "must be built because it never has been before", which only matches the
  case where `build_state` had no prior hash. For `force_rebuild=true` (freshly
  unplugged, pnp.rs:431) or "hash changed since last build", the same string
  is misleading. Yarn berry distinguishes "for the first time" vs "again, the
  digest of <X> changed" — the latter is its own message id.
- (low) `packages/zpm/src/build.rs:81-82` — `let locator = self.locator.clone();`
  creates a separate clone purely so it can be captured by the inner async
  closure. The `with_context_result(ReportContext::Locator(self.locator.clone()), ...)`
  call on line 84 also clones the locator. Two clones for one logical use is
  noisy.

**Style fit:** Mostly. The "try_current_report → guard → ref" 4-line dance
appears three times in this single file (build.rs:72-79 for YN0007,
build.rs:466-473 for YN0009, build.rs:499-503 for log-file emission). That's
the strongest case in this batch for the shared helper.

**Helper opportunities:**
- `packages/zpm/src/build.rs:72-79`, `:466-473`, `:499-503` — three identical
  scaffolds. A `report::if_active(|r| r.info(format!(...)))` helper in
  `report.rs` would compress each to a single line.
- `packages/zpm/src/linker/pnp.rs:391-432` and
  `packages/zpm/src/linker/pnpm.rs:130-152` and
  `packages/zpm/src/linker/nm/mod.rs:450-489` — every linker builds a
  `BuildRequest` from `(locator, build_cwd, package_build_info, install_state.optional_builds, install.inline_builds, force_rebuild)`. Extracting a
  `linker::helpers::build_request_for(...)` constructor would deduplicate
  ~12 lines × 3 sites.

**Suggested patch / repro:** For the duplicate-log bug:

```
--- a/packages/zpm/src/build.rs
+++ b/packages/zpm/src/build.rs
@@ -132,9 +132,6 @@ impl BuildRequest {
                 if !script_result.success() {
-                    if inline_builds {
-                        emit_success_log(&locator, &combined_stdout, &combined_stderr);
-                    }
-
                     return match self.allowed_to_fail {
```

(The `ChildProcessFailedWithLog` log already covers stdout for the
failure case.) Repro test sketch:

```ts
test(`should not double-log on failed inline-builds`, makeTemporaryEnv({
  scripts: {postinstall: `echo FOO && exit 1`},
}, async ({path, run}) => {
  const {stdout} = await run(`install`, `--inline-builds`).catch(e => e);
  expect(stdout.match(/FOO/g)?.length).toEqual(1);
}));
```

---

### c3c2714 — Implements content-addressed index for the pnpm linker

**Quality:** Good port of berry's PR #4586 semantics — SHA-1 keyed entries,
SAFE_TIME mtime sentinel for tamper detection, in-place `fs_write` to
preserve the inode across hardlinks. The `ExtractMode` enum (later
refactored in this batch by the surrounding nm-mode commit?) cleanly unifies
classic / CAS / local-dedup behind one `fs_extract_archive_impl`.

**Bugs:**
- (low) `packages/zpm/src/linker/helpers.rs:288-298` — the
  `if index_path.fs_exists() { index_path.fs_write(data)?; } else { index_path.fs_write(data)?; }`
  branches are functionally identical (both call
  `std::fs::write` which truncates-in-place on existing files,
  preserving the inode for all hardlinks). The comment about
  "Truncate in place so existing hardlinks inherit the repair" is correct
  but the if/else is dead — collapsing it to a single
  `index_path.fs_write(data)?;` would be clearer and matches what the
  comment is documenting.
- (low) `packages/zpm/src/linker/helpers.rs:322-330` — `set_safe_mtime`
  opens the index file `OpenOptions::new().write(true).open(...)` solely
  to call `file.set_modified`. On Linux this acquires the file lock and
  may race with concurrent installs on the same global folder (two
  concurrent `zpm install` runs touching the same CAS entry). A
  `filetime::set_file_mtime(path, FileTime::from_unix_time(CAS_SAFE_TIME_SECS, 0))`
  via the already-pulled-in `filetime` workspace dep (or `std::fs::File::open` with
  `OpenOptions::new().read(true)` followed by `set_modified`) would avoid
  needing write permission.
- (low) `packages/zpm/src/linker/helpers.rs:120-177` — `fs_extract_archive_impl`
  with CAS *always* re-walks the zip even when `.ready` exists, by design.
  But the bool returned (`Ok(!already_extracted)`) is `false` whenever the
  package was already extracted, which masks the "we performed a repair"
  case from callers that key off the return value (e.g. `is_freshly_unplugged`
  in pnp.rs). Pnp doesn't use the CAS variant so this is currently moot, but
  if pnp ever does the semantics will mislead.
- (low) `packages/zpm/src/linker/helpers.rs:298` — `set_safe_mtime` is called
  inside `if needs_rewrite { ... }`, but it's not called on the "first time
  we land here" branch where `!index_path.fs_exists()` — wait, it *is*, because
  `needs_rewrite` was set to `!index_path.fs_exists()` at line 274. OK.
  However, if an index entry happens to be created out-of-band with
  `mtime == CAS_SAFE_TIME_SECS` (e.g. tar restoration), zpm will *not*
  rewrite it even if its content differs from the zip. The mtime sentinel
  is a heuristic, but the SHA-1 of the contents could be (cheaply) checked
  against the index filename to harden this; the existing test
  (`tests/acceptance-tests/pkg-tests-specs/sources/features/contentAddressedIndex.test.ts:92`)
  only exercises mtime-based detection.

**Style fit:** Yes. Uses the workspace `sha1` crate alongside the existing
`sha2`, returns the typed `PathError`, follows the convention of
`fs_<verb>` methods on `Path`. The new `ExtractMode<'a>` enum matches the
shape used for `ProgressBarMode` / etc. elsewhere.

**Helper opportunities:**
- `packages/zpm/src/linker/helpers.rs:194-217` (link_into_local_index) and
  `:303-317` (link_into_cas tail) — both end with a
  `(dest_meta, source_meta) → (dev, ino) match → already_linked?` check
  followed by an `fs_rm_file + hard_link`. Factor into
  `helpers::ensure_hardlink(target, source)` to remove ~16 duplicated lines.
- The `mode_bits = mode & 0o777` masking is duplicated in both link helpers;
  a tiny `fn perm_bits(mode: u32) -> u32` would document intent.

**Suggested patch / repro:** None — bugs are stylistic / latent.

---

### 9c6b634 — Emits YN0009 warnings on build failures

**Quality:** Tiny, surgical. The dedup is correct: `build_errors.insert(...)`
returns `true` only on the first insert per `(locator, cwd)` key, so the
YN0009 line is emitted at most once per failing package even if both the
`Ok(failed_status)` and `Err(error)` arms fire for it. The error-arm
de-dup against the record-arm is also handled by sharing the same
`BTreeSet<(Locator, Path)>`.

**Bugs:** (none)

**Style fit:** Yes — same `try_current_report` 4-line scaffold as
build.rs:72-79 and :499-503 (the third inhabitant of "we need a helper").

**Helper opportunities:** Same `report_if_active` consolidation as called
out elsewhere. The `emit_yn0009` function is itself a tiny local helper;
once a generic `report.warn_if_present(...)` exists, this 11-line function
becomes 3 lines inline at each call site.

**Suggested patch / repro:** None.

---

### b3ef25a — Merges stale registry metadata for offline resolution fallback

**Quality:** The intent is good and the test that motivated it
(an unpublished-but-cached version) is a real-world scenario. The commit
also picks up two genuine adjacent fixes (parent-dir creation,
spawn_blocking → inline). The merge implementation, however, has two
correctness/perf concerns and a robustness gap.

**Bugs:**
- (medium) `packages/zpm/src/http_npm.rs:565-568` — the merge runs on **every**
  successful 200-response of the metadata cache pathway, not just when the
  fresh response is "newer than" the cache or when versions were actually
  removed. For a popular package (lodash, react, etc.) with thousands of
  versions, this means parsing both bodies (multi-MB each) as
  `serde_json::Value`, performing a per-version `entry().or_insert_with(clone)`
  on a `Map<String, Value>` of thousands of entries, and re-serializing —
  on every cold/warm metadata fetch. Cheap escape: skip the merge entirely
  when `stale_versions.is_empty()` or when
  `stale_versions.keys().all(|v| fresh_versions.contains_key(v))`.
- (medium) `packages/zpm/src/http_npm.rs:579` — `write_cache_to_disk` is
  now called inline, removing the previous `tokio::task::spawn_blocking`.
  The commit message rationale (tokio::main drops orphan tasks at exit) is
  legitimate, but inlining a synchronous `serde_json::from_slice +
  fs_write_atomic` on a multi-MB body blocks the Tokio worker. The correct
  fix is `spawn_blocking(...).await` (not `spawn_blocking(...)` with a
  dropped JoinHandle); that both keeps the work off the reactor and ensures
  it completes before the future resolves.
- (low) `packages/zpm/src/http_npm.rs:588-616` — `merge_versions_into_fresh`
  only merges the `versions` object. The `time` object (Yarn berry uses
  it for `versions list --since`, `npm unpublish` detection, and similar)
  is left fresh-authoritative. That's *technically* consistent with
  "fresh wins on conflict", but for a version that was unpublished, the
  fresh metadata won't have a `time` entry for that version either, and
  resolution may downstream proceed to install a tarball whose `time` was
  invalidated. Not a regression vs. pre-commit behavior, but the merge
  scope feels incomplete.
- (low) `packages/zpm/src/http_npm.rs:543-547` — the 304 path returns the
  raw cached body without invoking `merge_versions_into_fresh`. That's
  correct (304 = body unchanged) but it means the merge only ever runs on
  full responses. If a registry returns a *narrower* full response that
  happens to match the etag of an older wider cached one, the merge fires;
  fine, but again worth a comment.

**Style fit:** The `match cached { Some(c) => merge(...), None => fresh }`
shape is idiomatic. The `let Ok(...) = ... else { return fresh.to_vec(); };`
chain follows the codebase's `let-else` pattern. One minor inconsistency:
the `unwrap_or_else(|_| fresh.to_vec())` fallback returns the *unmerged*
fresh body even after possibly mutating `fresh_json` — a partial merge
that fails to reserialize would be silently dropped.

**Helper opportunities:**
- `packages/zpm/src/http_npm.rs:447-475` (`trim_metadata`) and
  `:588-616` (`merge_versions_into_fresh`) both do
  "parse → mutate `versions` map → reserialize" on the same data. A
  single `with_metadata_versions(raw, |versions_map| { ... })` helper
  would avoid one full deserialize/serialize round-trip when both run.
- The `etag` / `last_modified` header extraction at `:549-556` is the
  shape Yarn uses for response caching elsewhere. Worth pulling into
  `fn extract_cache_headers(&response) -> (Option<String>, Option<String>)`.

**Suggested patch / repro:** Sketch for the spawn_blocking + early-return:

```
--- a/packages/zpm/src/http_npm.rs
+++ b/packages/zpm/src/http_npm.rs
@@
-    let merged_body = match &cached {
-        Some(cached) => Bytes::from(merge_versions_into_fresh(&cached.metadata, &fresh_body)),
-        None => fresh_body,
-    };
+    let merged_body = match &cached {
+        Some(cached) if needs_merge(&cached.metadata, &fresh_body) => {
+            Bytes::from(merge_versions_into_fresh(&cached.metadata, &fresh_body))
+        },
+        _ => fresh_body,
+    };
@@
-    write_cache_to_disk(&cache_file_for_disk, &body_for_disk, etag, last_modified);
+    tokio::task::spawn_blocking(move || {
+        write_cache_to_disk(&cache_file_for_disk, &body_for_disk, etag, last_modified);
+    }).await.ok();
```

Repro test: install a project that depends on a previously-cached version
which the registry no longer advertises; the merge currently fires correctly
(test was added to the suite — search for "fixes 1 test" in the commit
message). A perf regression test would need a custom 1000-version mock
registry.

---

## Cross-cutting observations

**YN warning emission pattern.** This batch introduces four new YN codes
and uses three different code patterns to emit them:

1. `current_report().await.as_ref()` + early-return guard, used for
   YN0002 (`install.rs:794-834`) and the pre-existing YN0068 / YN0057 /
   YN0058 sites in `install.rs`. Used when we're already on an `.await`-able
   call stack.
2. `try_current_report() → Option<RwLockReadGuard>` + `if let Some(g) = ...`
   double-let dance, used for YN0004/YN0005 (`linker/helpers.rs:415-429`),
   YN0007 (`build.rs:72-79`), YN0009 (`build.rs:466-473`), and the
   inline-builds success/failure log emit (`build.rs:499-503`). Used from
   sync helpers.
3. Standalone `emit_yn0009(&locator)` function (`build.rs:465-474`) as a
   thin wrapper around (2).

(2) appears five times across this batch alone with byte-for-byte identical
4-line scaffolding. The single highest-value cleanup in this batch would be
a `report::if_active(impl FnOnce(&StreamReport))` helper in `report.rs`
that internally calls `try_read().ok()` and bridges the guard. Every YN
emission site would collapse to one line.

**Severity discipline.** YN0005 uses `report.info`, YN0007 uses `report.info`,
YN0002/YN0004/YN0009 use `report.warn`. The pattern is intentional (matches
berry), but the call sites would benefit from a `report.diag(MessageName,
Severity, ...)` API rather than open-coding the prefix and the choice of
`info`/`warn` in 5 different files.

**Virtual-locator handling around builds.** Three commits (3a439ee, 5965d29,
bd0fb39) all wrestle with "do I see a virtual locator or its physical here?":
the YN0004/YN0005 emission lives inside `get_package_internal_info` and
will fire per-virtual; the BuildRequest construction now uniformly skips
virtuals (`pnp.rs:393-396`, `pnpm.rs:131-133`, `nm/mod.rs:452-454`); the
YN0002 reporter dedups across virtuals via `physical_locator()` + BTreeSet.
That's three different opinions on how to collapse virtuals. A
`tree.iter_physical_resolutions()` iterator (yielding distinct
`physical_locator → resolution` pairs) on `ResolutionTree` would centralize
the rule and let each consumer drop its own dedup logic.

**Build-output capture vs streaming.** The commit message for 5965d29 says
"streams build script output", but the implementation buffers to `Vec<u8>`
and only emits via `add_log_file` at install end. If real streaming is
desired (matching berry under `--inline-builds`), `script.rs` would need a
`TargetOutput::Piped { on_stdout: F, on_stderr: G }` mode that writes through
to the report as lines arrive. As-is, users of `--inline-builds` see nothing
during a slow build.
