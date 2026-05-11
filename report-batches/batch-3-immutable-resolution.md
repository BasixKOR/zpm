# Batch 3 — Immutable installs, refresh-lockfile, resolution syntax, packageExtensions

## Synthesis

This batch is generally well-targeted: each commit addresses a specific failing-test
class and stays within a self-consistent code locale (resolutions.rs, install.rs,
project.rs, commands/install.rs). The three immutable-install commits combined now
produce a coherent error surface — `ImmutableWithUpdateLockfile` for CLI conflict,
`ImmutableLockfile` (YN0028) for lockfile drift, and `ImmutablePatternViolation`
(YN0036) for pattern drift. Two real bugs surfaced: (1) auto-flipping
`enable_immutable_installs` in public-PR CI overrides an explicit `--immutable=false`
opt-out, and (2) `parse_selector` in `resolutions.rs` has a precedence-leaning
boolean expression and a fallthrough path that silently drops non-semver parent
ranges. The packageExtensions tracking is mostly clean but its `Mutex` is held
across an inner loop in a hot `normalize_resolutions` call and re-emits the same
warning text twice for monorepo workspaces.

---

### dfe9bb6 — Warns on unused/redundant packageExtensions rules

**Quality:** Solid feature. Adds tracking state, threads it through `InstallContext`,
and emits diagnostics post-install. Reasoning of "matched / applied / redundant" is
sound.

**Bugs:**
- (low) `packages/zpm/src/install.rs:1722` — `let mut tracking = context.extension_tracking.lock().unwrap();` is acquired *inside* the loop body of `normalize_resolutions` once per matching extension descriptor, then held through three inner field loops. Hot path; if `normalize_resolutions` is ever called concurrently across resolutions (it's invoked from many tasks), this will serialize them. Lock per insertion would be cleaner; even better, collect locally and bulk-merge at the end.
- (low) `packages/zpm/src/install.rs:836-873` — `report_package_extension_diagnostics` walks **all** extensions and emits one warning per subfield. If the same extension is declared in two workspaces (which won't happen in practice because extensions live in the project config, not the workspace manifests), no dedup; for builtin extensions stored in `BUILTIN_EXTENSIONS`, the diagnostic correctly only fires for `project.config.settings.package_extensions` (user-configured), so that's fine.
- (low) `packages/zpm/src/install.rs:1745-1758` — the `PeerDependencyMetaOptional` path checks `resolution.optional_peer_dependencies.contains(peer_dependency)`. The comment says the set "is not mutable through this code path"; thus `applied` is set even though nothing was actually applied. This will under-report redundancy: a rule whose peer-meta-optional was already declared by the manifest will be classed as `applied`, not `redundant`, because the condition is `resolution.optional_peer_dependencies.contains(...)` rather than checking what the original manifest declared. Probably fine for the tests it's solving, but the diagnostic text "may have been applied upstream" never fires for this subfield in practice.

**Style fit:** Yes. Matches surrounding patterns: `current_report().await.as_ref()` guard, `[YN####]` prefix, the `➤` separator used elsewhere in zpm output, `to_print_string` on idents. The new `ExtensionFieldKey` enum and its `render()` method match how other enums in the codebase produce display strings (manifest field formatting).

**Helper opportunities:**
- `packages/zpm/src/install.rs:860-871` — two `report.warn(format!("[YN0068] {} ➤ {}: ...", parent, key.render(), ...))` calls. A small helper `fn warn_extension(report, parent, key, msg)` would eliminate the duplicated `[YN0068] {} ➤ {}:` prefix.
- The `current_report().await.as_ref().map(|r| r.warn(...))` pattern recurs across `install.rs` (peer-dep warnings, legacy-glob warnings, nohoist warnings, bin warnings). A `warn_if_reporting(format!(...))` helper in `report.rs` would tidy ~8 call sites in this file.
- The `peer_dependencies_meta.iter().filter(|(_, m)| m.optional.value == Some(true))` predicate appears in both the tracking (line 852) and the application (line 1746); extracting `extension.iter_keys()` returning `Iterator<ExtensionFieldKey>` would keep the two in sync and avoid drift.

**Suggested patch / repro:** None — the mutex-scope and PeerDependencyMetaOptional concerns are stylistic / latent.

---

### 32d94ea — Wires up --refresh-lockfile and auto-enables it for public PR CI

**Quality:** Clean and pragmatic. The `is_public_pr_ci()` helper is well-isolated,
with local serde structs and explicit `Ok(...) != ...` checks.

**Bugs:**
- (medium) `packages/zpm/src/commands/install.rs:118-123` — when running in a public-PR CI, the code unconditionally sets `enable_immutable_installs.value = true`, even if the user explicitly passed `--immutable=false`. The `immutable: Option<bool>` field allows the user to opt out, but that opt-out is never honored in this branch. Berry treats CLI `--immutable=false` as authoritative. Repro: in the test environment matching the existing PR-CI tests, add `--no-immutable` (or equivalent `--immutable=false`) and observe that the install still fails with YN0028 when the lockfile is drifted.
- (low) `packages/zpm/src/commands/install.rs:201` — `std::fs::read_to_string(&event_path)` will read arbitrarily-large event JSON without a size cap. GitHub event files are small in practice; not worth fixing, but worth noting.

**Style fit:** Yes. `let Ok(...) else { return false; }` is the prevailing early-exit pattern used in this codebase. The two `#[derive(serde::Deserialize)]` inline structs match the project's habit of doing local serde shapes (cf. http.rs, github.rs).

**Helper opportunities:**
- `packages/zpm/src/commands/install.rs:104-122` — four near-identical blocks (`if self.X == Some(true) { project.config.settings.Y.value = true; ... source = Source::Cli; }`). A `force_setting(&mut config.settings.Y, true)` helper would deduplicate this and the PR-CI branch.

**Suggested patch / repro:**
```diff
- let mut refresh_lockfile = self.refresh_lockfile;
- if !refresh_lockfile && is_public_pr_ci() {
-     refresh_lockfile = true;
+ let mut refresh_lockfile = self.refresh_lockfile;
+ if !refresh_lockfile && self.immutable != Some(false) && is_public_pr_ci() {
+     refresh_lockfile = true;
      project.config.settings.enable_immutable_installs.value = true;
      project.config.settings.enable_immutable_installs.source = Source::Cli;
  }
```
Test: extend `should not enable --refresh-lockfile --immutable in private PR CIs` style block with a public-PR env + `--no-immutable` and assert install succeeds.

---

### 22f9e35 — Accepts the legacy '**/<ident>' resolution syntax with a YN0057 warning

**Quality:** Minimal and targeted. Storing the original key on the field for later
warning emission is the right shape.

**Bugs:**
- (low) `packages/zpm/src/install.rs:1042-1047` — emits one warning per `legacy_key` per workspace inside `for workspace in &project.workspaces`. If a monorepo has the legacy `**/foo` declared in two workspaces' manifests (unusual but legal — Yarn 1 monorepos sometimes copy this around), the same `**/foo` text gets warned twice with no workspace disambiguation. The other warnings in this loop (`String bin field`, `nohoist`) prefix with `workspace.pretty_name()`. The legacy-glob warning should match: `[YN0057] {workspace}: Legacy glob syntax ...`.

**Style fit:** Mostly. The new warning lacks the `workspace.pretty_name()` prefix that its loop-mates use. The `legacy_glob_keys: Vec<String>` matches existing patterns.

**Helper opportunities:**
- `packages/zpm/src/manifest/resolutions.rs:249-253` — the prefix-stripping pattern is small enough to inline, but if you ever add another legacy prefix you'd want a `strip_legacy_prefix(key) -> (effective, Option<original>)` helper.

**Suggested patch / repro:** No bug-fix needed unless you want the workspace prefix. Test name: extend `resolutions.test.js:194` to a `workspaces`-based env and assert warning contains the workspace name.

---

### 6cd002e — Parses resolution selectors structurally

**Quality:** Good direction (hand-walking the key avoids the Range parser misclassifying
slash-bearing tails as Git). However the parsing logic has a couple of rough edges
worth tidying.

**Bugs:**
- (medium) `packages/zpm/src/manifest/resolutions.rs:205` — the boolean is `parent_part.contains('@') && !parent_part.starts_with('@') || (parent_part.starts_with('@') && parent_part[1..].contains('@'))`. With Rust precedence (`&&` binds tighter than `||`), this evaluates as `(A && !B) || (C && D)`, which is correct, but it relies on the reader to know precedence and the asymmetric parenthesization invites a future edit to break it. Wrap both sides for safety.
- (low) `packages/zpm/src/manifest/resolutions.rs:196-203` — `make_anonymous` silently no-ops if the range failed to reparse as semver. The caller validates with `is_valid_resolution_descriptor` downstream so an invalid form errors, but the *error message* will then be "the range must be an anonymous semver range" instead of a more specific "the parent of a resolution selector must be a semver range". Mild UX issue.
- (low) `packages/zpm/src/manifest/resolutions.rs:212-216` — `parent_ident` is computed by `Ident::from_file_string(parent_part).ok()?`. If `parent_part` parses neither as a Descriptor (no `@`) nor as an Ident, we return `None` — which becomes `de::Error::custom("invalid resolution selector")` upstream. Fine, but the message doesn't tell the user *why* (vs. e.g. Berry, which says "invalid character in name"). Minor UX.

**Style fit:** Decent. The `use zpm_primitives::AnonymousSemverRange;` is local-scoped, matching some other helpers in the file. Using a closure for `make_anonymous` is a stylistic outlier (the rest of the codebase prefers free functions when the body is non-trivial), but acceptable.

**Helper opportunities:**
- `packages/zpm/src/manifest/resolutions.rs:183-194` — the scope-aware slash-finding (skip the first `/` of `@scope/`) is the kind of logic that lives in `zpm_primitives` next to `Ident::from_file_string`. If `Ident` already knows how to find its terminating slash given a scope-aware key, you could call into that and avoid re-implementing the rule.
- The `(parent_descriptor, parent_ident, child_part)` match (lines 218-230) is fine, but `(Some(d), Some(i), _)` is unreachable by construction; `(None, None, _)` is the catch-all. An `enum Parent { Descriptor(Descriptor), Ident(Ident) }` would model this without the impossible state.

**Suggested patch / repro:**
```diff
- let parent_descriptor = if parent_part.contains('@') && !parent_part.starts_with('@') || (parent_part.starts_with('@') && parent_part[1..].contains('@')) {
+ let has_inner_at = if let Some(stripped) = parent_part.strip_prefix('@') {
+     stripped.contains('@')
+ } else {
+     parent_part.contains('@')
+ };
+ let parent_descriptor = if has_inner_at {
```
No new test needed; the existing `resolutions.test.js:113` "package@version/child" path covers the regression.

---

### 9417a4b — Combines the immutable+update-lockfile error message

**Quality:** Trivial and correct. Collapses two near-identical `IncompatibleOptions`
calls into one `ImmutableWithUpdateLockfile` variant with a fixed message.

**Bugs:** (none)

**Style fit:** Yes. The new variant matches the convention of putting human-readable
text directly in `#[error("...")]`.

**Helper opportunities:**
- `packages/zpm/src/error.rs:284-285` — `IncompatibleOptions(Vec<String>)` is still around for other call sites. Worth checking whether any of its remaining users could also be lifted to dedicated variants for testability; not in scope of this commit, just noting.

**Suggested patch / repro:** None.

---

### fa8535d — Raises YN0028 instead of generic immutable error on lockfile changes

**Quality:** Direct fix; reads the current file, compares to the would-be content,
emits a YN0028. Replaces the previous reliance on `fs_expect`'s generic
`PathError::ImmutableData`.

**Bugs:**
- (low) `packages/zpm/src/project.rs:406` — reads the current lockfile as UTF-8 (`fs_read_text`) and compares strings. If the on-disk lockfile has a stray non-UTF-8 byte (corruption / a manual `printf '\xff'` injection), `fs_read_text` errors instead of triggering YN0028 — i.e. the immutable check leaks an unexpected error type. Comparing bytes (`fs_read`) and the contents-as-bytes would be more robust. The pre-fix `fs_expect` was byte-based.
- (low) — the previous `fs_expect` path provided a diff via `PathError::ImmutableData::diff`. The new path drops that diff context, so users no longer see *what* changed in the lockfile, only that it changed. Berry's YN0028 doesn't include a diff either, so this matches berry; mention only.

**Style fit:** Yes. Early-return-on-condition matches surrounding `project.rs` code.

**Helper opportunities:**
- The pre/post `if !lockfile_path.fs_exists() { ... } let current = ... if current != contents { ... }` block is exactly the "compare-or-fail-with-X" pattern that `fs_expect` already implements — just with a different error type. A `fs_expect_with::<E>(...)` taking a closure-to-build-error would unify this with the manifest sort-check in `commands/install.rs:244`.

**Suggested patch / repro:**
```diff
- let current = lockfile_path.fs_read_text()?;
- if current != contents {
+ let current = lockfile_path.fs_read()?;
+ if current.as_slice() != contents.as_bytes() {
      return Err(Error::ImmutableLockfile);
  }
```
No new test name; existing `should block invalid lockfiles when using --refresh-lockfile with --immutable` covers it.

---

### 13c6577 — Implements immutablePatterns

**Quality:** Tidy, well-scoped module. The "hash before / hash after" approach is
simple to reason about and correctly accounts for create/delete via the
`<missing>` sentinel.

**Bugs:**
- (low) `packages/zpm/src/commands/install.rs:157-167` — for each `(pattern_raw, pre_hash)` in `pre_snapshot`, the code does a linear search through `immutable_patterns` by `raw()` to find the matching glob. O(N²). Trivially fixable by storing `Vec<(&Glob, Hash64)>` (or just iterating over `immutable_patterns.iter().zip(pre_snapshot)`).
- (low) `packages/zpm/src/commands/install.rs:162` — `.expect("immutable pattern vanished mid-install")` — a panic-on-cosmic-event message. Either the lookup-by-string-equality is overkill (see above) or the panic message should at least name the missing pattern for forensic purposes.
- (low) `packages/zpm/src/immutable.rs:51` — root-only skip of `.git` and `.yarn`. If the user has a workspace at e.g. `packages/foo` with its own `.git` (rare, but a vendored submodule could trigger this), we walk into it. For the patterns this feature targets (`.pnp.cjs`, `**/node_modules`, `package.json`) it doesn't matter in practice. Worth noting.
- (low) `packages/zpm/src/immutable.rs:73-104` — `hash_dir_tree` walks symlinks via their target string but never dereferences them. Two different symlinks pointing to different data with the same target *string* would hash identically. That's *probably* the desired behavior for nm-linker style trees (where same target = same install) but is inconsistent with the file branch (which hashes contents).
- (low) `packages/zpm/src/immutable.rs:60-62` — `"<missing>"` sentinel is hashable but indistinguishable from a real file whose contents happen to be `<missing>`. Extremely unlikely collision; could prefix with a non-printable byte to be safe (e.g. `Hash64::from_data(b"\x00<missing>")`).

**Style fit:** Yes. Uses `Hash64Writer`, `BTreeMap` for deterministic ordering, `Path::with_join_str`, all consistent with the existing codebase. The module sits alongside other top-level utilities (e.g. `pack.rs`, `prepare.rs`) appropriately.

**Helper opportunities:**
- `packages/zpm/src/immutable.rs:64-70` and `:98-104` — identical finalization loops (`for (path, hash) in entries { writer.update(path.as_bytes()); writer.update([0u8]); writer.update(hash.to_file_string().as_bytes()); }`). Extract `fn finalize_entries(entries: BTreeMap<String, Hash64>) -> Hash64`.
- `snapshot_pattern` and `hash_dir_tree` both maintain `let mut entries: BTreeMap<String, Hash64> = ...; let mut stack: Vec<Path> = vec![Path::new()];` and walk via stack. The two could share a single `walk_with(project_cwd, predicate, on_match) -> Hash64` helper, with the only difference being the per-entry predicate (match-pattern vs. always-include).
- The "skip `.git` and `.yarn` at root" guard is also implemented inline; codebase has similar workspace-walking elsewhere (cf. `pack.rs`, `workspace_glob.rs`) that may already have a "skip-set" mechanism worth reusing.

**Suggested patch / repro:**
```diff
- let pre_snapshot = if pattern_check_enabled {
-     Some(immutable_patterns
-         .iter()
-         .map(|pattern| -> Result<_, Error> {
-             Ok((pattern.raw().to_string(), immutable::snapshot_pattern(&project.project_cwd, pattern)?))
-         })
-         .collect::<Result<Vec<_>, Error>>()?)
- } else { None };
- ...
- for (pattern_raw, pre_hash) in pre_snapshot {
-     let glob = immutable_patterns.iter().find(|p| p.raw() == pattern_raw).expect(...);
-     let post_hash = immutable::snapshot_pattern(&project.project_cwd, glob)?;
-     if post_hash != pre_hash { return Err(Error::ImmutablePatternViolation(pattern_raw)); }
- }
+ let pre_snapshots = if pattern_check_enabled {
+     immutable_patterns.iter().map(|pattern| {
+         immutable::snapshot_pattern(&project.project_cwd, pattern).map(|h| (pattern, h))
+     }).collect::<Result<Vec<_>, _>>()?
+ } else { Vec::new() };
+ ...
+ for (glob, pre_hash) in pre_snapshots {
+     let post_hash = immutable::snapshot_pattern(&project.project_cwd, glob)?;
+     if post_hash != pre_hash {
+         return Err(Error::ImmutablePatternViolation(glob.raw().to_string()));
+     }
+ }
```
No new test; existing immutablePatterns.test.ts suite covers the behavior.

---

### 41bc0a1 — Drops the manifest-reformatting immutablePatterns test

**Quality:** Acceptable. The test specifically depended on zpm rewriting empty
`dependencies: {}` blocks on install — a manifest-canonicalization behavior zpm
deliberately doesn't do. The commit message correctly identifies this as
out-of-scope.

**Bugs:** (none)

**Style fit:** Yes. REVIEW-LIST is being kept in sync.

**Helper opportunities:** (none)

**Suggested patch / repro:** None.

---

## Cross-cutting observations

**Immutable-install error reporting (commits 9417a4b, fa8535d, 13c6577).** The
three immutable-related error variants (`ImmutableWithUpdateLockfile`,
`ImmutableLockfile`, `ImmutablePatternViolation`) now form a coherent group at
`packages/zpm/src/error.rs:91-100` and `:296` and `:499`. They should probably be
co-located (move `ImmutableWithUpdateLockfile` next to `ImmutableLockfile`) and
share a comment block tying the YN codes together (YN0028 for lockfile, YN0036 for
patterns, no YN code for the CLI conflict). Doing so would help future readers
understand which case maps to which yarn error code at a glance.

**Public-PR CI auto-flip vs. user opt-out (commit 32d94ea).** The current logic
honors `--immutable=true` but ignores `--immutable=false` in public-PR CI. If this
is intentional (a security-hardening default contributors can't disable), it
should be documented in the help text and on `Error::ImmutableWithUpdateLockfile`.
If unintentional, see the suggested patch under 32d94ea.

**`current_report().await.as_ref()` repetition (commits dfe9bb6, 22f9e35).** Both
commits add new warning emissions wrapped in the same `current_report().await.as_ref().map(|r| r.warn(...))` or `if let Some(report) = current_report().await.as_ref()` boilerplate. A `report::warn_if(format!(...))` or `report::warnln(...)` helper would
deduplicate ~10 sites across `install.rs` alone (lines 516, 827, 860, 866, 1044,
1052, 1061 + the existing peer/checksum sites).

**Pattern/glob matching has multiple homes.** `immutable.rs` uses `zpm_utils::Glob`
with manual filesystem walking; `pack.rs` uses `globset::GlobBuilder` with
`GlobMatcher`; the workspace walker uses yet another approach. A shared
`walk_with_glob(root, glob, &skips) -> impl Iterator<...>` would help future glob
features (e.g. `immutablePatterns` walking up to two workspaces deep, or a future
`logFilters`) stay consistent.

**`legacy_glob_keys` warning convention drift (commit 22f9e35).** The new YN0057
warning at `install.rs:1045` doesn't prefix with `workspace.pretty_name()`, but its
loop-mates at `:1053` and `:1062` do. Worth aligning if a future PR touches this
loop.
