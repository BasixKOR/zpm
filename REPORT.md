# Branch Review — `mael/e2e-fixes`

This report covers the 87 commits on `mael/e2e-fixes` vs `main`. Eight review agents each took a thematic batch of related commits; this document collates their findings, adds short coverage for the trivial cleanup commits, and closes with a prioritised set of helper recommendations distilled from the cross-cutting observations.

For each non-trivial commit you'll find:

- **Quality** — terse assessment of the implementation.
- **Bugs** — bug severity is `[low | medium | high]`; "(none)" if clean.
- **Style fit** — does this look like code you'd have written?
- **Helper opportunities** — concrete extractable helpers.
- **Suggested patch / repro** — present only for flagged bugs.

## Bug summary

### High severity

| Hash | Subject | Issue |
|---|---|---|
| `48fae58` | `yarn info` descriptor filter | `raw.find('@')` returns 0 for scoped names → `@scoped/foo@npm:2.0.0` silently matches nothing. Protocol allowlist also incomplete. |
| `5277002` | Daemon `--start` banner | Moved WS URL below the "Started daemon…" lines, breaking `start_daemon`'s `next_line()`-driven URL discovery. Recovered by `2bc3864`, but in isolation this commit was a wide regression. |
| `883a2df` / `ea66ccf` | nm linker `dest_abs_path` | Reuses the pre-existing `workspace_abs_path.with_join(&node_rel_path).with_join(&child_rel_path)` formula which double-prepends `node_rel_path`. Feeds wrong cwd into `canonical_build_locations` and wrong destination into the CAS extractor under `nmHoistingLimits: dependencies`. |

### Medium severity

| Hash | Subject | Issue |
|---|---|---|
| `caad332` | `--check-resolutions` | `ResolutionMismatch(Descriptor, Locator, Locator)` is populated with the same `locator.clone()` twice → user-facing YN0078 prints identical "would resolve to X / pins it to X". |
| `a17014a` | `--check-cache` refetch | `DiskCache::upsert_blob_inner` swallows all IO errors (not just `NotFound`) → permission errors silently re-download and overwrite. |
| `32d94ea` | `--refresh-lockfile` in PR CI | Auto-flip forces `enable_immutable_installs = true` even when user explicitly passed `--immutable=false`. |
| `6cd002e` | resolution selector parser | Asymmetrically-parenthesised boolean (`A && !B \|\| C && D`) at `resolutions.rs:205` — works today, fragile to future edits. |
| `5965d29` | `--inline-builds` | `emit_success_log` is called on the failure branch too — output appears twice alongside `ChildProcessFailedWithLog`. |
| `3a439ee` | YN0004/YN0005 | Emitted from inside `get_package_internal_info`, which runs once per virtualised locator — no dedup (the YN0002 path does dedup). |
| `b3ef25a` | offline registry merge | Runs `serde_json::from_slice/to_vec` on every 200 response with no early-out for matching version sets. `write_cache_to_disk` now does sync I/O on the async runtime. |
| `0012db7` | `yarn config --json` | `--no-redacted` has inverted polarity — it's a silent no-op; redaction stays on. |
| `ea6ae68` | `init initFields` | Hand-rolled RC walk returns on first match, breaking the user-rc + project-rc cascade. |
| `802a106` | `version` bump report | Only matches `RangeKind::Exact`, skips `workspace:^` / `workspace:~`; also skips peer dependencies; message drops the `workspace:` prefix. |
| `67df59a` | `workspaces list -v` | Manifest-only classifier `_ => false` drops `Range::WorkspaceIdent` and `Range::WorkspaceSemver`. |
| `012144e` | `--cwd` arg parser | Silently consumes the next flag as the path; silently no-ops on a missing value. |
| `48fae58` | `yarn info` filter | Protocol allowlist is hardcoded; any unrecognised protocol bypasses descriptor filtering. |
| `93299d4` | pack browser-keys | `BrowserField::paths()` returns `Iterator<Item = String>` while peers return `Iterator<Item = &Path>` — call site at `pack.rs:636` diverges from the surrounding loops. |

(See per-commit sections for low-severity findings.)

---

## Batch 1 — nm linker

This batch builds out node-modules linker parity with berry across eight incremental commits. It plumbs the four nm-related yarnrc settings, teaches the hoister about `installConfig.hoistingLimits` borders and workspace-backed Link locators, adds berry's two non-classic `nmMode` paths through a CAS-style extractor, makes portals first-class (transparent for hoisting, conflict-checked for external targets), wires `BuildRequests` into the nm linker (which until now silently dropped them), and patches up several smaller corners (workspace-focus exclusions, root-level self-reference symlinks, always-materialized `workspace/node_modules`). Most changes are idiomatic for the codebase, the comments are dense and explain the *why*, and individual diffs are reasonably sized — the main quality risks are (a) a pre-existing `node_rel_path` double-join bug that 883a2df and ea66ccf now propagate into `canonical_build_locations` and `cas_extractions`, and (b) some duplication between the hoist-limit lookup path in `mod.rs` and the `effective_hoisting_limit` method in `hoist.rs`.

### 7e5c45a — Adds nm linker config, workspace self-references, and excluded-focus guards (fixes ~8 tests)

**Quality:** Solid foundational commit. The four new enums, schema entries, and `MergeSettings`/`merge_optional_settings` impls follow the existing pattern in `zpm-config/src/types.rs` letter for letter. The `WorkspacesField` deserializer with `#[serde(untagged)]` Either is exactly how `BinField` and other dual-form manifest fields are handled in this repo. The focus-exclusion guards in `create_node`/`expand_node` are minimal and well-scoped.

**Bugs:**
- (none)

**Style fit:** Matches well. The mirror `HoistingLimitsValue` enum with a `From` to the zpm-config one (because zpm-config can't depend on rkyv) is exactly the seam the rest of `manifest/mod.rs` uses — and the comment at /Users/maeln/Repositories/zpm/packages/zpm/src/manifest/mod.rs:86 names that constraint explicitly. The `WorkspacesField::serialize` choosing to drop `nohoist` is the maintainer's voice: drop the deprecated shape silently while warning, don't pin it back. The `[YN0058]` warning in install.rs follows the exact pattern used at /Users/maeln/Repositories/zpm/packages/zpm/src/install.rs:1043 for `[YN0057]`.

One small stylistic snag: `register_workspace_symlinks_at` is parameterised over `host_node`, `host_abs_path`, and an iterator of candidates as if it were a reusable building block, but the only caller is the root-workspace branch in `generate_workspace_node_modules`. The `host_*` framing is YAGNI given the caller — the rest of the file tends to favor inlined helpers tied to the single call site.

**Helper opportunities:**
- The two-line "look up effective hoistingLimits for this workspace" pattern at /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs:137-141 is duplicated by `WorkTree::effective_hoisting_limit` in /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/hoist.rs:205-217 (added in the next commit). Once both are in place, pulling them into a free helper `fn effective_hoisting_limit(project: &Project, workspace: &Workspace) -> NmHoistingLimits` in `linker/nm/mod.rs` would let `hoist.rs` and the symlink registrar share one source of truth.
- Similarly, the "look up effective self-references" pattern at lines 126-130 is unique here, but if/when berry adds more per-workspace install-config knobs it'll be the second instance of the same `manifest.install_config.as_ref().and_then(...).unwrap_or(global)` shape — worth noting but not yet worth a helper.

### 0183cf7 — Enforces `nmHoistingLimits` workspace/dependencies borders (fixes 5+ tests)

**Quality:** Clean refactor. Splitting the border decision into outbound/inbound predicates is the right vocabulary — it reads exactly like berry's hoister, and the docstrings make the asymmetry obvious (workspaces only act as outbound borders under `workspaces`, but everyone is an inbound *and* outbound border under `dependencies`). The new `effective_hoisting_limit` method properly threads per-workspace overrides over the project-wide default.

**Bugs:**
- (none)

**Style fit:** Idiomatic. The methods on `WorkTree` are documented in the same comment-block style as the existing ones (e.g. the cycle-detection comment in `expand_node`). The `process_node` call-site picks up `host_blocks_inbound` once outside the loop and `blocks_outbound_hoisting` per child — exactly how the maintainer separates loop invariants from per-iteration checks elsewhere in the file (see /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/hoist.rs:482).

**Helper opportunities:**
- See the prior commit: `effective_hoisting_limit` is currently a private method on `WorkTree` (/Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/hoist.rs:205) and the same logic is open-coded in `register_workspace_symlinks_at` (mod.rs:137). Lifting it to a free function on a `Workspace` reference would unify the two call sites.

### 0695298 — Always materializes `workspace/node_modules` (fixes 1 test)

**Quality:** Trivial — one `fs_create_dir_all` after the sync tree finishes, with a docstring naming the motivating scenario. Fine.

**Bugs:**
- (none)

**Style fit:** Fine. `workspace_abs_path.clone()` for the `.run()` call is a touch annoying (the sync tree consumes the path by value), but that's the existing API's fault, not the commit's.

**Helper opportunities:** None.

### 70c34be — Lets workspace deps in the parent chain through as terminal Link nodes (fixes 1 test)

**Quality:** Surgical one-line change with an excellent comment explaining the invariant (workspace deps become Link nodes downstream and Link nodes short-circuit `create_node`, so the loop terminates anyway). Reads like a maintainer's own fix.

**Bugs:**
- (none)

**Style fit:** The inline comment style and the choice to extend the existing `.filter(...)` chain rather than re-shape the function matches the maintainer's preference for incremental edits to long chained iterators (see the rest of `expand_node`).

**Helper opportunities:** None.

### 883a2df — Generates build requests for the nm linker (fixes 3 tests)

**Quality:** Right design — the pnp and pnpm linkers both funnel through `linker::helpers::get_package_internal_info` and `populate_build_entry_dependencies`, so this brings the nm linker in line. Picking the first-encountered hoisted location as the canonical build cwd via `.entry(...).or_insert_with(...)` is the obvious choice. The deletion detection (`!dest_abs_path.fs_exists()` → `force_rebuild_locators.insert`) is well-explained in the inline comment.

**Bugs:**
- [medium] `dest_abs_path` in /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs:348-351 reuses the pre-existing buggy formula `workspace_abs_path.with_join(&node_rel_path).with_join(&child_rel_path)`. Because `child_rel_path = node_rel_path.with_join_str(ident)` (line 290-291), joining `node_rel_path` a second time double-prepends it for any non-root nested entry. The bug originally exists at line 293-296 for the `abs_path`/`packages_by_location` insert (introduced by 2ba6195, not this commit). But 883a2df now feeds the same wrong path into `canonical_build_locations` (line 385) and `force_rebuild_locators` (line 362-363) — so for any nested-conflict package with build scripts, the build will run with `cwd` pointing at e.g. `foo/node_modules/foo/node_modules/bar` instead of `foo/node_modules/bar`. Either the build will fail (path doesn't exist) or, worse, skip silently. The simplest fix is `let dest_abs_path = workspace_abs_path.with_join(&child_rel_path);` (and the same correction at line 293 to also fix `packages_by_location`).

**Style fit:** Mostly idiomatic. The `let Some(...) else { continue; }` cascade in `build_requests_from_locations` reads exactly like the pnpm linker's equivalent block at /Users/maeln/Repositories/zpm/packages/zpm/src/linker/pnpm.rs:78-153. One nit: the doc comment on the new `dest_abs_path` (lines 343-347) talks about the sync tree's behavior re missing destinations and `force_rebuild`, but doesn't mention that this code path is also where the eventual hardlinks-mode branch will hand the same `dest_abs_path` to the CAS extractor — that's added in ea66ccf with a fresh comment, so the layering is fine commit-by-commit but a reader of the final file might want the two notes together.

**Helper opportunities:**
- `build_requests_from_locations` is now the third near-identical "iterate locator→cwd map, call `get_package_internal_info`, push BuildRequest, then `populate_build_entry_dependencies`" copy alongside `link_project_pnpm` (pnpm.rs:78-153 + ~321) and the pnp linker's equivalent. Extracting `linker::helpers::build_requests_from_locations(project, install, locator_cwd_map, force_rebuild, deps_meta) -> Result<BuildRequests>` would centralize the optional/virtual/abstract handling. Worth doing once the pnp linker is refactored to fit too — at two call sites today it's borderline; with three it crosses the threshold.

**Suggested patch / repro:**

```diff
--- a/packages/zpm/src/linker/nm/mod.rs
+++ b/packages/zpm/src/linker/nm/mod.rs
@@ -290,11 +290,8 @@ fn generate_workspace_node_modules(
             let child_rel_path
                 = node_rel_path.with_join_str(&ident.as_str());

-            let abs_path
-                = workspace_abs_path
-                    .with_join(&node_rel_path)
-                    .with_join(&child_rel_path);
+            let abs_path
+                = workspace_abs_path.with_join(&child_rel_path);

             let rel_path
                 = abs_path
@@ -345,11 +342,8 @@ fn generate_workspace_node_modules(
                     // re-extracted automatically; we just need to flag
                     // it for rebuild so the build cache doesn't short-
                     // circuit the matching tree-hash entry.
-                    let dest_abs_path
-                        = workspace_abs_path
-                            .with_join(&node_rel_path)
-                            .with_join(&child_rel_path);
+                    let dest_abs_path = abs_path.clone();
```

A repro would be a workspace with `nmHoistingLimits: dependencies` (so transitives stay nested) where the transitive package has a `postinstall` script — e.g. extend the existing test `tests/acceptance-tests/pkg-tests-specs/sources/node-modules.test.ts:1124` ("should still hoist direct dependencies from portal target to parent with nmHoistingLimits: dependencies") with a `postinstall` on the nested dep, then assert the script actually ran (e.g. via a sentinel file). The current code would either fail or skip the build, depending on the build manager's handling of a missing cwd.

### a283a73 — Keeps workspace-backed link nodes pinned at their parent (fixes 1 test)

**Quality:** Good catch and the right fix. The comment block on `is_workspace_backed_locator` is generous (5+ lines explaining *why* we have a synthetic Link). The exclusion of nested workspaces from root self-references is the necessary companion fix, also well-commented.

**Bugs:**
- (none)

**Style fit:** The `let Reference::Link(params) = &locator.reference else { return false };` cascade is idiomatic Rust 2024-style let-else, used elsewhere in this file. Iterating `project.workspaces.iter().any(|ws| ws.path == link_path)` is fine for typical workspace counts (a dozen or so) but is O(W) per SCC scan during hoisting — see the helper opportunity below.

**Helper opportunities:**
- `is_workspace_backed_locator` does a linear scan of `project.workspaces` per call, and the hoister calls it inside its SCC loop. The `Project` already keeps a `workspaces_by_rel_path: BTreeMap<Path, usize>` (/Users/maeln/Repositories/zpm/packages/zpm/src/project.rs:608ish), but that's keyed on `rel_path`, not absolute `path`. A `workspaces_by_path` (absolute) map on `Project` would let this function be O(log W), which matters more once a real monorepo with hundreds of workspaces hits the path. Low priority — flag it for when somebody else also wants absolute-path workspace lookup.
- The nested-workspace exclusion at /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs:251-263 builds a `BTreeSet<&Path>` of non-root workspace paths and then does an ancestor scan via `iter_path().rev().skip(1)`. The same "find the nearest containing workspace" walk already exists in `import_workspaces` at /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/hoist.rs:118-126. Worth lifting to a `Project::nearest_workspace_ancestor(rel_path)` method later.

### 31135c0 — Implements portal handling for the nm linker (fixes 6 tests)

**Quality:** Big commit but tightly themed. Each of the five portal behaviors is in its own section with a docstring. Treating portals as transparent in `blocks_outbound_hoisting` and as portal-aware in the inbound check is the cleanest expression of berry's semantics. The `check_external_portal_conflicts` post-pass produces three distinct error messages (sibling-portal, parent-dep, none) which matches the test expectations at tests/.../node-modules.test.ts:1188 and 1216-style cases.

**Bugs:**
- [low] In `check_external_portal_conflicts` at /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs:709-715, `is_internal` only returns true when the portal's package data is `PackageData::Local { package_directory, ... }` with `package_directory` inside `project_cwd`. If the portal points at a relative path inside the project but is wrapped in a `Virtual` reference (the comment at line 676-679 notes that's possible) and goes through any other `PackageData` variant, `is_internal` defaults to `false` and the conflict gets reported. This is probably rare since portals to internal paths should always show up as `Local`, but the fallback is silent.
- [low] The "skip workspace_queue push for symlinked children" change at lines 313-319 keys off `PackageData::Local { .. }` *or* `Reference::Link(_) | Reference::Portal(_)`. A `Reference::Link` whose `package_data` is missing entirely would still be skipped (good), but the `unreachable!` at line 403 would only fire after this check — so if for some reason a portal-or-link gets registered with `None` package data and ALSO has no `Reference::Link/Portal` (impossible by construction, but the chain is brittle), we'd hit `unreachable!`. Cosmetic — the existing guard makes the impossible state impossible.

**Style fit:** Very much in the maintainer's voice. The "we surface conflict and fail the install" / "Internal portals are skipped — the user owns those directories" comment block (lines 660-667) reads like the existing rationale comments in `project.rs` and `install.rs`. The sibling-portal lookup via `parent_children.iter().filter_map(...).next()` is more verbose than `.find_map(...)` would be, but matches the style used elsewhere in this file.

**Helper opportunities:**
- The repeated `matches!(node.locator.reference.physical_reference(), Reference::Portal(_))` check appears at lines 230, 498, 647, 680, 738. A `Reference::is_portal()` (or `Locator::is_portal()`) helper alongside the existing `is_workspace_reference`/`is_virtual_reference` (used in hoist.rs:165, 287, 645) would clean those up — it's the same pattern berry has on `structUtils`. Low effort, ~5 call sites cleaned up.
- The `if let Some(report_guard) = crate::report::try_current_report() { if let Some(report) = report_guard.as_ref() { ... } }` ladder at lines 651-657 and 753-783 is the standard report-warn dance, but it's also used in install.rs in slightly different shape (using `current_report().await`). Not worth a helper unless `try_current_report` evolves to return `&Option<...>` directly.

### ea66ccf — Implements nmMode hardlinks-local and hardlinks-global for the nm linker (fixes 4 tests)

**Quality:** Implementation is sound. Replacing the `Option<&Path>` extractor parameter with a proper `ExtractMode` enum is the right move — adding a third mode would have been ugly otherwise. The `SyncItem::Any` placeholder is a small, well-scoped addition to zpm-sync and integrates cleanly (the existing `SyncNode::Any` path in `check` and `process_node` already handles "do nothing"). Tracking the previous install's `nm_mode` in `InstallState` to drive the force-wipe on transition is the correct trigger.

**Bugs:**
- [medium] (Propagation of the bug from 883a2df.) The `cas_extractions.push((dest_abs_path.clone(), child_node.locator.clone()))` at /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs:373 reuses the doubled-prefix `dest_abs_path`. The CAS/local-dedup extractors then write into the wrong path for any nested-conflict package. Same fix as 883a2df above. Repro: `hardlinks-local` + nmHoistingLimits:dependencies + a transitive dep with content that should dedupe — the dedupe would silently fail because the destination path doesn't match where the sync tree actually placed the package.
- [low] `link_into_local_index` at /Users/maeln/Repositories/zpm/packages/zpm/src/linker/helpers.rs:194-216 has two near-identical "write canonical and stash" branches (the "first time we see this content" arm and the "canonical got blown away" fallback). The duplication is benign but the two branches could share a closure or a small `write_canonical(...)` helper.
- [low] The "swap nmMode mid-flight" force-wipe at /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs:358-360 uses `let _ = dest_abs_path.fs_rm().ok_missing();` — `.ok_missing()` returns `Result<Option<T>, _>`, so the `let _ =` discards both the missing case and any actual I/O error. If `fs_rm` fails for an unrelated reason (permission denied), the subsequent SyncTree extraction may overwrite the hardlinked inodes in place and defeat the wipe. Berry handles this by failing the install. Probably worth an explicit `if let Err(e) = ... { return Err(e.into()) }` (filtering out NotFound).

**Style fit:** The `ExtractMode` enum + `&mut mode` threading through `fs_extract_archive_impl` is idiomatic. The `nm_mode_token` helper at /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs:564-570 is duplicated by an inline match at /Users/maeln/Repositories/zpm/packages/zpm/src/install.rs:902-907 (where `install_state.nm_mode` is stored) — both produce identical strings. The maintainer typically extracts that kind of mapping into the `zpm_config::NmMode` impl itself (cf. `NodeLinker::to_file_string`).

**Helper opportunities:**
- Move `nm_mode_token` onto `zpm_config::NmMode` as `pub fn token(self) -> &'static str` (or rely on the existing `ToFileString` impl from the `zpm_enum` macro — the literal strings already round-trip there). Then both /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs:564-570 and /Users/maeln/Repositories/zpm/packages/zpm/src/install.rs:902-907 collapse into one call.
- `link_into_local_index` and `link_into_cas` share the "compare dev/ino with `fs_symlink_metadata`/`fs_metadata`, hardlink if not already linked, with a pre-rm of the target" tail — see helpers.rs:222-237 and helpers.rs:301-317. About 15 lines each. Worth pulling into `fn link_into(target: &Path, canonical: &Path) -> Result<(), Error>`.

**Suggested patch / repro:** See the suggested patch under 883a2df — `dest_abs_path` should be `workspace_abs_path.with_join(&child_rel_path)`.

### Cross-cutting observations

- **The `node_rel_path` double-join is the most material bug in the batch.** It predates the batch (2ba6195), but commits 883a2df and ea66ccf now feed the bogus path into `canonical_build_locations`, `force_rebuild_locators`, and `cas_extractions`. Fixing it in one place (the `abs_path` derivation around line 293 of /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs) fixes both new derivations. The reason the existing tests don't catch it is that almost every test relies on hoisting to flatten transitives to the root, so `node_rel_path` stays empty. The targeted scenario is `nmHoistingLimits: dependencies` (or `workspaces` with a conflict), plus a build script, plus `hardlinks-local`.
- **Duplicated "effective per-workspace install-config" lookups.** Three call sites (`WorkTree::effective_hoisting_limit`, the `install_limit` block in `register_workspace_symlinks_at`, the `self_references` lookup in the same function) all repeat `manifest.install_config.as_ref().and_then(|c| c.field).unwrap_or(global)`. Worth a `Workspace::effective_install_config(&self, project: &Project) -> EffectiveInstallConfig` accessor returning a struct of resolved values.
- **`nm_mode` token mapping duplicated.** The string mapping for `zpm_config::NmMode` is hand-rolled in two places (nm/mod.rs:564 and install.rs:902). The `zpm_enum` macro already generates a `ToFileString` impl that produces these literals — those two sites should both use it.
- **`Reference::Portal(_)` matched five times** in /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/mod.rs and /Users/maeln/Repositories/zpm/packages/zpm/src/linker/nm/hoist.rs. Adding `Reference::is_portal(&self) -> bool` next to `is_workspace_reference` / `is_virtual_reference` (the maintainer's existing pattern) would be the minimal cleanup.
- **Portal handling is the most architecturally interesting part of the batch.** It splits cleanly into "transparency in the hoister" (hoist.rs changes) and "post-hoist diagnostics" (`check_external_portal_conflicts`). The split mirrors how berry's nm linker is organized in TS, which makes the file legible to anyone porting test expectations across. Good layering.

---

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

---

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

---

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

---

# Batch 5 — CLI commands: info, create, init, config, yarn-why, dedupe, @types

## Synthesis

These 11 commits shore up surface-level commands by either adding missing ones (`create`, `npm info`, `config unset`, `config --json`) or by fixing output / filter / matching bugs in existing ones (`yarn why`, `yarn info`, `yarn dedupe`, `yarn add` @types path). Most patches are small and surgical, and the test-driven nature of the batch shows: each commit closes a specific yarn-berry test suite. The dominant recurring pattern is **rc-file / configuration glue done inline in command files** (`init.rs::apply_init_fields`, `config_unset.rs` home-vs-project path branching, `dlx.rs`'s own yarnrc copy, `config.rs::source_label`), as well as **ad-hoc string parsing of `ident@reference` and `name@selector`** in three different commands using three slightly different algorithms (`add.rs`, `info.rs::get_filter`, `create.rs::rewrite_starter`, `npm/info.rs::parse_package_arg`). Several commits also reach for `set_redacted(...)` global mutable state, which is fragile and one of them gets the polarity wrong (see `0012db7`).

---

### 510a422 — Writes the real secret to disk in `config set` before applying redaction

**Quality:** Correct, minimal, addresses a real ordering bug. The fix is to call `set_redacted(false)` before serializing the value into the YAML document and restore `set_redacted(true)` before reading back for the success line.

**Bugs:**
- (none) — but see the cross-cutting note about `set_redacted` global state.

**Style fit:** Matches surrounding code; the pair of `set_redacted(false)` / `set_redacted(true)` calls bracket the disk write the same way `config_get.rs:34` toggles redaction once for output.

**Helper opportunities:** `config_set.rs` `Self::load_home_config()` (`packages/zpm/src/commands/config_set.rs:139-156`) is duplicated almost verbatim in `config_unset.rs:96-110`. Extract a `home_config()` or `home_rc_path()` helper into a shared module under `commands/`.

**Suggested patch / repro:** N/A.

---

### ea6ae68 — Applies initFields config to the manifest generated by `init`

**Quality:** Functionally correct against the four targeted tests, but the implementation reinvents configuration loading (own RC file walk, own RC filename env-var fallback, own YAML parse) and silently swallows errors. Order of application is also slightly questionable.

**Bugs:**
- [medium] `packages/zpm/src/commands/init.rs:195` — `apply_init_fields` `return Ok(())` on the FIRST RC found while ascending. Yarn berry merges the configuration cascade (project rc overrides user rc), so any user-level `initFields` is dropped as soon as a project-level rc exists, even when the user rc had a non-conflicting key.
- [low] `packages/zpm/src/commands/init.rs:186-196` — parse errors are silently dropped (`if let Ok(...) = ...`). A malformed `.yarnrc.yml` will be ignored without warning, masking config issues.
- [low] `packages/zpm/src/commands/init.rs:208` — `serde_json::Value::Number` is round-tripped via `n.to_string()` into `Value::Number(...)`. Large or float numbers may render with different precision than expected. Likely benign for typical initFields (version, license), but worth a test.
- [low] `packages/zpm/src/commands/init.rs:255` — `apply_init_fields` is called AFTER `packageManager` is set. The doc says initFields are initial settings, but here they can override `packageManager` (probably fine — matches berry) while `--private` written later can still override initFields (also probably fine). Document the precedence.

**Style fit:** The new functions are placed between `InitParams` and `init_project`, which is acceptable. But the manual RC walk diverges sharply from how everywhere else in the codebase obtains configuration (`Configuration::load`, `RcFile::try_read`). `packages/zpm-config/src/lib.rs:994` already implements user+project RC merging — we should reuse it.

**Helper opportunities:** Add `init_fields` to `Settings` in `packages/zpm-config/schema.json` (mirror the `preferInteractive` addition from `0012db7`) and read it via `project.config.settings.init_fields.value`. That replaces all 51 lines added here with ~5 lines and gives the correct cascade for free.

**Suggested patch / repro:** Add a test that places `initFields: {version: "1.0.0"}` in `~/.yarnrc.yml` and `initFields: {license: "MIT"}` in the project rc — current code will only apply `license`, dropping `version`.

```diff
- fn apply_init_fields(document: &mut JsonDocument, init_cwd: &Path) -> ... {
-     // 25 lines of walking + parsing
- }
+ // Use Configuration::load(...) cascade (project_cwd=init_cwd) and read
+ // project.config.settings.init_fields after registering it in schema.json.
```

---

### b33c198 — Adds the `create` command

**Quality:** Solid first cut. The `rewrite_starter` parsing covers all four documented cases (`foo`, `@scope`, `@scope/app`, `*@range`). Code is well structured and uses the existing `dlx` helpers properly.

**Bugs:**
- (none observed for the documented cases). Manual trace through `rewrite_starter` confirms scoped + range, scoped no range, bare, and bare + range all parse correctly.

**Style fit:** Matches `dlx.rs` cleanly. Re-uses `dlx::setup_project`, `dlx::install_dependencies`, `dlx::find_binary`, `dlx::run_binary`.

**Helper opportunities:**
- `Create::execute` (`packages/zpm/src/commands/create.rs:39-99`) is nearly identical to `Dlx::execute` (`packages/zpm/src/commands/dlx.rs:90-125`). The only differences are (a) computing `loose_descriptor` from a rewritten starter vs reading it directly, and (b) the leading "Installing ..." print. A helper like `dlx::install_and_run_single(loose: LooseDescriptor, args: Vec<String>, quiet: bool, banner: Option<String>) -> Result<ExitStatus>` would deduplicate both commands plus `InitWithTemplate::execute` (`init.rs:60-118`) which performs the same dance.
- The hardcoded `"➤ YN0000: Installing ..."` prefix (`create.rs:55`) appears throughout the codebase as a literal. A `report::yn0000(...)` helper would centralize the format.

**Suggested patch / repro:** N/A — no bug.

---

### 413d74c — Adds the `npm info` command

**Quality:** Workable but visibly minimal. Output is always JSON regardless of the `--json` flag, which is acknowledged in the doc ("(the default)"), but the field is named `_json` to suppress unused warnings — a smell.

**Bugs:**
- [low] `packages/zpm/src/commands/npm/info.rs:35-37` — `_json: bool` is parsed but never read. A user passing `--no-json` to get a different format will get JSON anyway, with no error. Either drop the flag entirely or honor it (yarn berry prints a YAML-ish key:value dump when `--json` is absent).
- [low] `packages/zpm/src/commands/npm/info.rs:104-108` — `Selector::Range` is preferred whenever `zpm_semver::Range::from_file_string(range_str)` succeeds. For inputs like `npm info pkg@1.0.0` this is correct, but for protocol-shaped selectors (`npm info pkg@npm:1.0.0`) the parser will fall through to `Selector::Tag("npm:1.0.0")` and report "tag not found". Yarn berry trims the `npm:` prefix here. Probably out of test scope.
- [low] The error variant `Error::TagNotFound("latest")` (`npm/info.rs:84`) prints just `"latest"` — fine for tags the user typed, but for the synthesized "Latest" case the message will look like `"latest"` came from the user. Minor cosmetic.

**Style fit:** Uses the same `http_npm::get_registry` / `get_authorization` / `get_package_metadata` pipeline as `npm::audit::Audit`, so the registry plumbing is consistent.

**Helper opportunities:**
- `parse_package_arg` (`npm/info.rs:120-148`) is structurally a third copy of the same `name@selector` splitter that lives in `create.rs::rewrite_starter:101-108` and (partially) `info.rs::get_filter:469-487`. Extract `parse_ident_and_selector(input: &str) -> Result<(Ident, Option<&str>), ...>` into `zpm_primitives` or a shared CLI util.
- `RegistryMetadata` (`npm/info.rs:75-81`) defines a local struct used only by this command. Yarn npm operations across the codebase will eventually need to read `dist-tags` + `versions`; pull this into `http_npm` once `npm dist-tag` lands.

**Suggested patch / repro:** Repro for the `_json` issue: `yarn npm info no-deps --no-json` produces JSON. Test: `commands/npm/info.test.ts` snapshots could exercise this.

---

### 66de29c — Skips @types add when the registry can't actually serve it

**Quality:** Pragmatic safety net. The implementation does a full `resolve` per Algolia hit, which is correct but could be expensive — every false-positive @types entry now causes an extra network round-trip.

**Bugs:**
- (none, but see perf note).

**Style fit:** Fits the surrounding loop; the comment is clear about intent.

**Helper opportunities:**
- `packages/zpm/src/commands/add.rs:25` — `_resolve_options` keeps its underscore prefix even though it is now used (line 126). Rename to `resolve_options` for clarity.
- Bulk-resolving the candidate descriptors via `LooseDescriptor::resolve_all` (`add.rs:249` pattern) would parallelize the checks. Currently each candidate is sequential.

**Suggested patch / repro:** N/A.

---

### 5072729 — Regenerates the @types entry when adding a new major version

**Quality:** Correct logic; the major-comparison via `to_semver_range().and_then(...).zip(...)` is concise and reads well. Falling through to Algolia when either side isn't a semver range is a reasonable default.

**Bugs:**
- [low] `packages/zpm/src/commands/add.rs:81-85` — `range_min` is used as the version reference, but for a range like `>=1.0.0 <3.0.0` `range_min` is `1.0.0` and `existing` is `1.x`, so a manual jump to `^2 || ^3` would be classified as same-major (because min=1) and the old @types entry would be (incorrectly) reused. Probably rare; mention it.

**Style fit:** Restructures the loop cleanly. Pre-existing `iter_hard_dependencies()` pattern is preserved.

**Helper opportunities:** None specific to this commit.

**Suggested patch / repro:** N/A.

---

### 0012db7 — Adds --json output to yarn config

**Quality:** Useful addition. Codegen `Settings::setting_names()` is the right approach for enumerating top-level settings. Adding `preferInteractive` to the schema is correct.

**Bugs:**
- [medium] `packages/zpm/src/commands/config.rs:38-40` — `--no-redacted` polarity is inverted/broken. With `#[cli::option("--no-redacted")] no_redacted: Option<bool>`, clipanion gives `None` if absent, `Some(true)` on `--no-redacted`, `Some(false)` on `--no-no-redacted`. The current condition `if self.no_redacted == Some(false) || self.no_redacted.is_none() { set_redacted(true); }` therefore enables redaction when the user passes `--no-no-redacted` or nothing, and leaves the global default (also redacted) unchanged on `--no-redacted` — so `--no-redacted` is a silent no-op. Compare to `config_get.rs:22-23` which uses `#[cli::option("--redacted", default = true)]` and gives clipanion the standard `--no-` flip semantics for free.
- [low] `packages/zpm/src/commands/config.rs:51-68` — iterates `Settings::setting_names()` and `match project.config.get(...) { Err(_) => continue, ... }`. Errors are silently ignored; settings that fail validation will just disappear from the JSON output without telling the user. Probably want to surface those.
- [low] No `set_redacted(true)` reset after the function returns. Since this is global state, a subsequent in-process call (e.g. from tests or daemon) could see redaction stuck. (Not a bug for the CLI process model, but worth noting.)

**Style fit:** `source_label` (`config.rs:7-16`) is a helper that mirrors the strings yarn berry emits — fine. The match on `Source` is exhaustive.

**Helper opportunities:**
- `source_label` should probably live next to `Source` in `zpm-config` (or `impl Source { fn cli_label(&self) -> &'static str }`) so `config get --json`, `config set`, and any future commands all stay in sync.
- The "parse value or fall back to string" snippet (`config.rs:58-59`) recurs whenever we re-derive a `serde_json::Value` from `AbstractValue::export(true)`. Promote to a method on `AbstractValue` (e.g. `to_json_value()`).
- The `--no-redacted` / `--redacted` polarity should be standardized across `config`, `config get`, and `config unset` (the last one doesn't expose redaction at all currently).

**Suggested patch / repro:**

```diff
- /// Show secrets instead of redacting them
- #[cli::option("--no-redacted")]
- no_redacted: Option<bool>,
+ /// Redact sensitive values
+ #[cli::option("--redacted", default = true)]
+ redacted: bool,
...
-     if self.no_redacted == Some(false) || self.no_redacted.is_none() {
-         set_redacted(true);
-     }
+     set_redacted(self.redacted);
```

Test: `yarn config --json --no-redacted` should print `npmAuthToken` values verbatim; current code redacts them.

---

### 5846ce7 — Adds yarn config unset command

**Quality:** Solid scaffold. The "is the setting actually present" pre-check (`path_exists`) is a nice touch.

**Bugs:**
- [low] `packages/zpm/src/commands/config_unset.rs:61` — when the project has no project config path, the error returned is `Error::HomeDirectoryNotFound`. That's misleading — it should be a "project not found" / "no project config" variant.
- [low] `packages/zpm/src/commands/config_unset.rs:96-113` — `let _config: Configuration = ...` is computed, never used. Looks like a copy-paste leftover from `config_set.rs:108-115` (which uses the reload to render the new value). Either remove or use it to print a verification message like `config_set.rs:134` does.
- [low] `packages/zpm/src/commands/config_unset.rs:13-26` — `path_exists` only handles object descent; if `name.segments()` walks into an array index (e.g. `npmRegistries[0]`), it returns false immediately. Probably out of scope for the tests in this batch, but worth a note.

**Style fit:** Mirrors `config_set.rs` reasonably well, but inverts the home/project handling into a single ternary instead of the cleaner tuple-destructure pattern from `config_set.rs:50-69`.

**Helper opportunities:**
- `home_rc_path()` / `(rc_path, config)` resolution is now duplicated three times: `config.rs`, `config_set.rs`, `config_unset.rs`. Extract a helper module `commands::config_common` with `fn resolve_rc_path(home: bool) -> Result<Path, Error>` and `fn reload_config(home: bool) -> Result<Configuration, Error>`.
- The "print the new value back" pattern in `config_set.rs:108-134` can become a shared `print_setting(config, name, json)` helper to feed `set`, `unset` (after-state), and `get`.

**Suggested patch / repro:** Drop the dead `_config` block; replace `Error::HomeDirectoryNotFound` on line 61 with a project-config-missing variant.

---

### 48fae58 — Lets yarn info filter by descriptor (ident@reference)

**Quality:** Works for the two targeted tests (`no-deps@npm:2.0.0`, `*@npm:2.0.0`) but the implementation has a significant correctness gap for scoped packages.

**Bugs:**
- [high] `packages/zpm/src/commands/info.rs:467-487` — `raw.find('@')` returns the FIRST `@`. For scoped patterns like `@scoped/foo@npm:2.0.0`, that index is 0, `rest = "@scoped/foo@npm:2.0.0"`, and `rest.starts_with("@npm:")` is false. The reference part is never split out and the matcher attempts to treat the entire `@scoped/foo@npm:2.0.0` string as an `IdentGlob`, which won't match any locator. So users cannot filter scoped + reference. Fix: peek for a leading `@`, search from index 1 in that case, mirroring the parsing in `create.rs::rewrite_starter:101-108` and `npm/info.rs::parse_package_arg:122-127`.
- [medium] `packages/zpm/src/commands/info.rs:471-477` — the protocol prefix list is hardcoded and incomplete. Any reference protocol added later (e.g. `tarball:`, `npm-alias:`, `cargo:`) silently bypasses the descriptor filter and the pattern falls through to "ident-only" match. The protocol set should be derived from `Reference`'s variants (or expressed as: "anything followed by `:`").
- [low] `info.rs:480` — `IdentGlob::new(ident_part).unwrap_or_else(|_| matcher.clone())` falls back to the ORIGINAL `matcher`, which is the full unparsed `name@ref` string treated as a glob. This silently masks invalid glob parts (e.g. extra `@`) by reusing the broken matcher.

**Style fit:** Inline closure with a sizable protocol list is awkward inside `get_filter`. The other commands (`add.rs`, `create.rs`, `npm/info.rs`) all do similar splitting independently — this is the strongest helper-extraction candidate in the batch.

**Helper opportunities:**
- Add a shared parser in `zpm_primitives` (next to `Descriptor::from_file_string` or `IdentGlob`): `fn split_ident_glob_and_reference(input: &str) -> (IdentGlob, Option<Reference>)`, with proper scope handling and a definitive protocol list. Then `add.rs`, `create.rs`, `npm/info.rs`, `info.rs` all consume the same parser.
- Consider replacing the protocol allowlist with `Reference::parse(rest[1..])` — a successful parse is the definitive "this is a reference" check.

**Suggested patch / repro:**

```diff
- if let Some(at_idx) = raw.find('@') {
+ let search_from = if raw.starts_with('@') { 1 } else { 0 };
+ if let Some(at_idx) = raw[search_from..].find('@').map(|i| i + search_from) {
      let (ident_part, rest) = raw.split_at(at_idx);
```

Test: `yarn info '@scoped/no-deps@npm:1.0.0' --json --recursive` against a fixture where the scoped package has multiple versions. Today the output is empty; with the fix it should match.

---

### 7c18aa1 — Renders workspace locators with their relative path in yarn why

**Quality:** Correct for the targeted tests. The helper `display_locator_for` is clear and small.

**Bugs:**
- [low] `packages/zpm/src/commands/why.rs:94-106` — in `why_simple`, the inner `dep_locator` rendered for children (`dep_locator.to_file_string()` and `DescriptorResolution::new(descriptor, dep_locator)`) is NOT converted via `display_locator_for`. So if a workspace appears as a dependency under another node, it still renders as `name@workspace:name` instead of `name@workspace:path/to/ws`. The recursive code path (`why.rs:264-289`) handles this because each child recurses through `print_all_dependents`, which always converts. Inconsistent between modes.
- [low] `packages/zpm/src/commands/why.rs:293-298` — `display_locator_for` does a linear scan through `project.workspaces` for every locator it sees. For projects with hundreds of workspaces and a `--recursive` why, this is O(n*m). A `BTreeMap<Locator, Locator>` precomputed once would be cheap.

**Style fit:** Matches the surrounding code; uses `AbstractValue::new` consistently.

**Helper opportunities:**
- `display_locator_for` is exactly the same conversion any output renderer needs whenever it surfaces a workspace locator. Move it onto `Project` (e.g. `Project::displayable_locator(&self, locator: &Locator) -> Locator`) and precompute the lookup, then call from `info.rs`, `dedupe.rs::report_dedupe_needed` (which also surfaces locators), and `workspaces_list.rs`.

**Suggested patch / repro:** Patch `why_simple` to convert children:

```diff
  if self.pattern.check(&dep_locator.ident) {
+     let dep_display = display_locator_for(project, dep_locator);
      let descriptor_resolution
-         = DescriptorResolution::new(descriptor.clone(), dep_locator.clone());
+         = DescriptorResolution::new(descriptor.clone(), dep_display.clone());
      children_map.insert(
-         dep_locator.to_file_string(),
+         dep_display.to_file_string(),
          tree::Node::new_value(descriptor_resolution),
      );
  }
```

Test: a workspace `b` depending on workspace `a`, then `yarn why a --json` (without `-R`) — current output keys `a` as `a@workspace:a` rather than `a@workspace:packages/a`.

---

### fcf35db — Flattens dedupe --json output to match the documented schema

**Quality:** Clean fix. Short-circuits to the flat NDJSON shape before the tree builder runs, and the cleanup of the conditional around the trailing "{n} packages can be deduped" line is appropriate.

**Bugs:**
- (none observed).

**Style fit:** Matches the NDJSON pattern used in `config.rs` (after `0012db7`). One direct `serde_json::json!` block per record.

**Helper opportunities:**
- The same flat-vs-tree dichotomy exists in `info.rs::execute` (uses the tree-renderer's JSON shape) and is potentially wrong for the same reason. `info.rs:166-169` may need a similar audit (its JSON output is consumed by tests that match on `{value, children}` shape, so probably OK for now). Worth grepping for `render(&root_node, self.json)` to find other commands that may be exposing the tree wrapping in NDJSON unintentionally.
- `serde_json::to_string(&entry).unwrap()` followed by `println!` shows up in `dedupe.rs:131`, `config.rs:67`. Tiny helper `print_ndjson(value: &serde_json::Value)` would standardize trailing-newline behavior.

**Suggested patch / repro:** N/A.

---

## Cross-cutting observations

1. **Three independent `name@selector` / `ident@reference` parsers.** `info.rs::get_filter:466-487`, `create.rs::rewrite_starter:101-123`, `npm/info.rs::parse_package_arg:122-148`, and parts of `add.rs` all implement subtly different versions of the same split. The `info.rs` version has a scoped-package bug; the others handle scoping but not protocol detection. **Strongest helper opportunity in the batch**: extract `split_ident_and_selector` (and possibly `split_ident_glob_and_reference`) into `zpm_primitives`.

2. **Inline RC-file plumbing scattered across commands.** `init.rs::apply_init_fields`, `config_unset.rs`, `config_set.rs`, `config.rs`, and `dlx.rs::setup_project` each do their own version of "find the rc filename via env var, read it, parse it". `packages/zpm-config/src/lib.rs:994` already has `Configuration::load` and `RcFile::try_read`. A small `commands::rc_helpers` module with `home_rc_path()`, `project_rc_path(project)`, and `home_only_config()` would deduplicate and ensure consistency (especially for the `YARN_RC_FILENAME` fallback).

3. **`set_redacted` is global mutable state.** Used by `config.rs` (with inverted polarity!), `config_get.rs`, `config_set.rs`. A scoped guard (`Redactor::scope(false)` returning an RAII handle) would eliminate the polarity confusion in `config.rs` and prevent state leakage across calls in long-running processes (daemon, tests).

4. **`Settings::setting_names()` codegen is generally useful** beyond `config --json` — anywhere we currently grep / enumerate config keys. Consider extending it to expose `(name, kind)` pairs for type-aware JSON value emission, replacing the "parse-or-fall-back-to-string" pattern at `config.rs:58-59`.

5. **`dlx::install_dependencies` + `find_binary` + `run_binary` is now invoked from three commands** (`dlx::Dlx`, `dlx::DlxWithPackages`, `create::Create`, `init::InitWithTemplate`). The orchestration that calls all three back-to-back should become a single helper `dlx::install_and_run_single(install_context, loose_descriptor, args, quiet, banner)`.

6. **Tree-renderer JSON shape leaks into commands that need NDJSON.** Fixed in `dedupe.rs` here; potentially still applies elsewhere. `info.rs` uses the tree-renderer JSON output and its consumers expect the wrapped shape — but it's worth a deliberate audit (`grep "render(&root_node, self.json)"`).

7. **Locator display normalization.** `display_locator_for` in `why.rs` is one of several places where workspace locators are converted to their path-based form for output. The same conversion is needed for `info.rs` and `dedupe.rs` outputs (currently they print `name@workspace:name`). Move to `Project::displayable_locator(&Locator) -> Locator` with a precomputed map.

---

# Batch 6 — Workspace behavior, install validation, cwd handling, foreach

## Synthesis

Nine targeted commits that close test-parity gaps around the yarn entry, the `version`/`up`/`run`/`workspaces *` commands, and workspace-level install diagnostics. Most fixes are small and well-scoped; a few introduce parallel paths that could be folded into existing helpers (`Manifest::iter_hard_dependencies`, `build_dependent_map`, `ScriptEnvironment` cwd defaults). The biggest correctness risk is in the new `--cwd` argv preprocessor (`packages/zpm-switch/src/yarn.rs`), which silently ignores malformed input and can consume the next flag as a path; secondary risks are dropped range kinds in `workspaces list -v`'s manifest-only classifier and an ad-hoc dep traversal in the version bump reporter that bypasses the canonical iterator.

---

### e743243 — Returns the active workspace's version for `--version` / `-v`

**Quality:** Pragmatic short-circuit before the clipanion environment is built; bypasses full project loading. Resolved correctly via `Path::current_dir()`+`package.json` read. Acceptable.

**Bugs:**
- (low) `packages/zpm/src/commands/mod.rs:160` — the test that triggers this path is `args.len() == 1 && (args[0] == "--version" || ...)`. If a user passes a no-op flag combo such as `yarn --version --json` or `yarn -v --json`, the binary version path (clipanion) will be taken instead, so behavior is brittle. Berry honors `--version` regardless of position. Low because not currently tested.
- (low) `packages/zpm/src/commands/mod.rs:175-189` — on a malformed `package.json`, the JSON parse silently falls back to `"0.0.0"` instead of erroring. Berry surfaces the parse error. Probably a non-issue in practice.

**Style fit:** Matches the file's free-function style. `use zpm_utils::Path` localized inside the function is a touch unusual but mirrors the workspace-localized `extract_bin_meta` flow.

**Helper opportunities:** `workspace_version()` re-parses the manifest with a private `VersionField` struct; could lean on the already-deserialized `Project::active_workspace().manifest.remote.version`. The reason it doesn't is presumably to avoid Project::new() cost on every `yarn --version`. Leave as-is, but consider exposing a `RemoteManifest::version_from_disk(path) -> Option<Version>` helper alongside the existing manifest types so this isn't a one-off `VersionField` struct.

**Suggested patch / repro:** none (not a bug).

---

### 1a36ee2 — Sets PWD env var to preserve the symlink --cwd path

**Quality:** Two-liner with an accurate safety comment; the unsafe block is justified (pre-thread startup). Sound.

**Bugs:** (none)

**Style fit:** Yes — matches the surrounding `cwd.sys_set_current_dir()` block. The `// SAFETY:` comment is well-placed.

**Helper opportunities:** The pair (`sys_set_current_dir`, `set_var("PWD", …)`) is the canonical "go to a logical cwd" operation. Worth wrapping as `Path::sys_set_current_dir_with_pwd()` in `zpm-utils` so callers (and future ones) can't forget the second step. Currently this is the only place that does it, but `--cwd` parsing inside scripts that spawn nested yarns will rely on this invariant.

**Suggested patch / repro:** none.

---

### 802a106 — Reports workspaces that pin a bumped dep with `workspace:*`

**Quality:** Single new free function `report_non_upgradeable_dependents` called from `Version::execute`. Output format matches `version/check.rs`'s message (`Couldn't auto-upgrade range * (in ...)`).

**Bugs:**
- (medium) `packages/zpm/src/commands/version/immediate.rs:153-156` — the `{}` for the range only prints `params.magic.to_file_string()` (i.e. `*`, `^`, or `~`), not the full `workspace:*` form, so the message reads "range *" rather than e.g. "range workspace:*". The test only matches on `range * (in ...)`, so it passes. Once berry-parity tests for `^`/`~` ever land, this format will probably look wrong. Match-arm is also gated on `RangeKind::Exact` only, so `workspace:^` and `workspace:~` against a bumped dep are silently ignored — and berry warns for all three.
- (low) `packages/zpm/src/commands/version/immediate.rs:139-148` — only iterates `dependencies`, `optional_dependencies`, `dev_dependencies` but skips `peer_dependencies`. A peer dep declared `workspace:*` would also need a manual bump but isn't reported.

**Style fit:** The dependency-iteration chain duplicates `Manifest::iter_hard_dependencies()` at `packages/zpm/src/manifest/mod.rs:322-343` — they yield the same three maps in the same order. Reusing that helper would also keep the per-kind list in one place.

**Helper opportunities:**
- Replace the ad-hoc iterator with `workspace.manifest.iter_hard_dependencies()` (which yields a `HardDependency<'_>` carrying `descriptor`; you can read `descriptor.ident` directly).
- `version/check.rs` already has `build_dependent_map(project) -> BTreeMap<Ident, Vec<Ident>>` (`packages/zpm/src/commands/version/check.rs:138`). A shared helper in `project.rs` (e.g. `Project::workspaces_depending_on(ident)`) would let `immediate.rs`, `check.rs`, and `workspaces_foreach`'s topo logic share a single lookup table — see "Cross-cutting" below.

**Suggested patch / repro:** Bug — wider range-kind coverage. Test: `version.test.ts` "it should correctly report a dependent workspace when unable to upgrade its version" with `workspace:^` instead of `workspace:*`.

```diff
- if let Range::WorkspaceMagic(params) = &descriptor.range {
-     if matches!(params.magic, zpm_semver::RangeKind::Exact) {
-         println!(
-             "Couldn't auto-upgrade range {} (in {})",
-             params.magic.to_file_string(),
-             workspace.locator_path().to_print_string(),
-         );
-     }
- }
+ if let Range::WorkspaceMagic(params) = &descriptor.range {
+     println!(
+         "Couldn't auto-upgrade range workspace:{} (in {})",
+         params.magic.to_file_string(),
+         workspace.locator_path().to_print_string(),
+     );
+ }
```

---

### 60c2874 — Validates workspace bin field has an attached package name

**Quality:** Adds a `Workspace::pretty_name()` helper, modeled after berry's `prettyWorkspace`, and a check inside `InstallManager::resolve_and_fetch`. Sha512-prefix-of-rel-path is a reasonable port. Good.

**Bugs:**
- (low) `packages/zpm/src/install.rs:1043-1067` — `current_report().await` is re-acquired inside each per-workspace branch (legacy `legacy_key`, new `has_string_bin`, existing `nohoist`). Three awaits inside a tight `for workspace in &project.workspaces` loop. Hoist a single `let Some(report) = current_report().await.as_ref() else { return Ok(()); };` outside the loop (or at least outside the inner branches).
- (low) `packages/zpm/src/project.rs:1081` — uses `self.rel_path == Path::new()` to detect the root. Other places in the codebase do `rel_path.as_str().is_empty()` or `rel_path.basename().is_none()` — pick one. Cosmetic.

**Style fit:** Yes; new function lives next to other workspace accessors (`descriptor`, `locator`, `locator_path`, `manifest_path`).

**Helper opportunities:** `pretty_name()` is now general; reuse it everywhere a diagnostic prints a workspace name. The neighboring `nohoist` warning at `install.rs:1063` already uses it (existing call site). Good.

**Suggested patch / repro:** none for the warning itself; the inner triple-`current_report().await` is a minor cleanup, no test affected.

---

### 67df59a — Computes workspace dependency classification without install in `workspaces list -v`

**Quality:** Solid pivot from install-state lookups to a direct manifest walk so `-v` works without a successful install. Output shape matches `mismatchedWorkspaceDependencies: ["workspace-b@2.0.0"]`.

**Bugs:**
- (medium) `packages/zpm/src/commands/workspaces_list.rs:222-233` — the explicit `_ => false` arm drops `Range::WorkspaceIdent` and `Range::WorkspaceSemver`. `workspace:^1.0.0` (WorkspaceSemver) and `workspace:foo` (WorkspaceIdent) should both be treated as "matches" (or, for WorkspaceSemver, semver-checked) but instead get classified as mismatched. No test covers them today, but it's berry-divergent.
- (low) `packages/zpm/src/commands/workspaces_list.rs:212-214` — re-implements the three-map dep chain; same dup as the previous commit. Use `workspace.manifest.iter_hard_dependencies()`.
- (low) `packages/zpm/src/commands/workspaces_list.rs:218` — `workspace_by_ident` errors are mapped to `continue`, which silently drops resolution failures even when the ident *is* one of the project's workspaces but lookup blew up for a different reason. In practice `WorkspaceNotFound` is the only error path, so this is fine — just worth a `try_workspace_by_ident` for clarity.

**Style fit:** Same outer structure preserved; the json `Payload` struct is intact. Switching `Vec<&'a str>` to `Vec<String>` is appropriate since the formatted ident@range needs ownership.

**Helper opportunities:**
- Lift the "does this dep range satisfy this workspace's version" predicate into `project.rs` as `Workspace::satisfies(descriptor) -> bool`. Today the same shape exists in `project.rs:559-617` (`try_workspace_by_descriptor`) but with a slightly different policy (transparent workspaces). A canonical "descriptor would resolve to this workspace" helper that distinguishes "matches" vs "mismatch" would unblock `workspaces list -v`, `up -R`, and `set_resolution`.
- Reuse `Manifest::iter_hard_dependencies()`.

**Suggested patch / repro:** Bug — handle `WorkspaceIdent` / `WorkspaceSemver`.

```diff
  let matches = match &descriptor.range {
      zpm_primitives::Range::WorkspaceMagic(_) => true,
+     zpm_primitives::Range::WorkspaceIdent(_) => true,
      zpm_primitives::Range::WorkspacePath(_) => true,
+     zpm_primitives::Range::WorkspaceSemver(params) => {
+         target_version.map_or(true, |v| params.range.check(v))
+     },
      zpm_primitives::Range::AnonymousSemver(params) => {
          target_version.map_or(true, |v| params.range.check(v))
      },
      zpm_primitives::Range::RegistrySemver(params) => {
          target_version.map_or(true, |v| params.range.check(v))
      },
      _ => false,
  };
```

Test name: extend `tests/.../workspaces/list.test.js` "workspace-a requires mismatched version of workspace-b" with a `workspace:^1.0.0` sibling.

---

### 442bad9 — Lists workspace scripts when `yarn run` is invoked without arguments

**Quality:** Clean: turns `name` into `Option<String>` and short-circuits to a script listing. JSON and human formats both supported. Snapshot updated to drop the `YN0000` framing, matching the new direct `println!`.

**Bugs:**
- (low) `packages/zpm/src/commands/run.rs:122-126` — `--json` detection scans `self.args` with `iter().any(|a| a == "--json")`. Because the command is `#[cli::command(default, proxy)]`, anything after the (now-optional) `name` lands in `args` verbatim, so this works for the test (`yarn run --json`). But if a future caller writes `yarn run -- --json arg`, `args` still contains `--json` and the listing path fires unexpectedly. Minor; a clipanion `--json` boolean option would be cleaner.
- (low) `packages/zpm/src/commands/run.rs:82-84` — `fs_read_text().unwrap_or_default()` silently swallows real I/O errors (vs. ENOENT). If the manifest is unreadable due to permissions, the listing prints nothing instead of erroring.
- (low) `packages/zpm/src/commands/run.rs:111-116` — `list_scripts` runs only after `lazy_install().await?`. For a pure listing operation that doesn't matter, but it does slow down `yarn run` with no args. Berry's equivalent listing is install-free.
- (very low) `packages/zpm/src/commands/workspaces_foreach.rs:512` — `if let Some(Some(name))` looks right (the outer Option comes from clipanion's `PartialYarnCli`, the inner from the new `Option<String>`). No bug.

**Style fit:** Mostly fine; the new `ScriptsManifest` private struct is the typical pattern. Order preservation via `IndexMap` is required since `Manifest::scripts: BTreeMap<String, String>` re-sorts (the manifest model loses script ordering on first load — see Cross-cutting).

**Helper opportunities:**
- The structural problem: `Manifest::scripts` is `BTreeMap` (`packages/zpm/src/manifest/mod.rs:280`). Anyone wanting insertion order has to re-read. Consider making it an `IndexMap` (or a separate `pub scripts_ordered: IndexMap<...>` view loaded once) so this becomes a `workspace.manifest.scripts.iter()`.
- `read manifest -> serde struct -> iter scripts` is also done elsewhere (e.g. the new `workspace_version()` from commit e743243). A `ManifestSlice<T>` reader that takes a path + field selector would dedupe both.

**Suggested patch / repro:** none required for the test; the `--json` proxy detection is fragile, see above.

---

### 012144e — Adds --cwd flag to the yarn entry, creates missing target directories

**Quality:** Threads `--cwd` and `--cwd=` parsing into `extract_bin_meta` and auto-creates the target directory in `run_default`. `exec.rs` overrides `with_cwd` so a script invoked via `--cwd=foo exec` runs from `foo` rather than the workspace root. Conceptually right.

**Bugs:**
- (medium) `packages/zpm-switch/src/yarn.rs:149` — `if first_arg == "--cwd" && args.len() >= 2`. If a user runs `yarn --cwd`, the length check fails and the token falls through to `ExplicitPath::from_str("--cwd")` (which will fail to parse), then `break`. Result: `--cwd` with no value is silently swallowed as no-cwd and clipanion later complains about a missing command. Berry errors at parse time. Should be: explicit error when `--cwd` is followed by nothing.
- (medium) `packages/zpm-switch/src/yarn.rs:149-154` — when the next token starts with `-` (e.g. `yarn --cwd --version`), it is unconditionally consumed as the path argument, so `--cwd` swallows the next flag. Berry treats `--cwd --version` as an error or as `--cwd=--version` only if the user uses the bound form. Recommend rejecting `args[1]` starting with `--` unless `args[1] == "--"` (or explicitly).
- (low) `packages/zpm-switch/src/yarn.rs:151,158,167` — `Path::current_dir().unwrap()` thrice; the original (line 167) also unwraps. Hoist once at the top of the function.
- (low) `packages/zpm/src/commands/mod.rs:146-149` — auto-create-dir is silent and irreversible. `expect("Failed to create the requested working directory")` panics on the unhappy path with a permissions error instead of returning an exit code. Acceptable for berry parity (which does the same), but the panic-vs-error story is inconsistent with how the rest of the binary surfaces I/O failures.
- (low) `packages/zpm/src/commands/exec.rs:37` — `with_cwd(Path::current_dir()?)` is mostly redundant with `ScriptEnvironment::new()` (which already sets cwd to `current_dir`), but `with_package(...)` between them overwrites cwd. Worth a comment so the next maintainer doesn't strip the call.

**Style fit:** `yarn.rs` already uses `ExplicitPath`-style parsing for path-shaped first args; the new branches are a natural addition. The new `while let Some(first_arg) = args.first() { ... break; }` shape is odd — only `--cwd` / `--cwd=` `continue`s; everything else falls through to a single `break`. A flatter "match the first arg, drain, recheck" loop would be clearer.

**Helper opportunities:** Inline a `fn parse_cwd_arg(args: &mut Vec<String>) -> Option<Path>` so the explicit-path fallthrough is the only thing left in `extract_bin_meta`. Also: hoist `let pwd = Path::current_dir().expect(...)` once and pass it down.

**Suggested patch / repro:**

```diff
- if first_arg == "--cwd" && args.len() >= 2 {
-     let raw = args[1].clone();
-     cwd = Some(Path::current_dir().unwrap().with_join_str(&raw));
-     args.drain(0..2);
-     continue;
- }
+ if first_arg == "--cwd" {
+     let raw = args.get(1)
+         .filter(|next| !next.starts_with("--"))
+         .cloned()
+         .expect("--cwd requires a value");
+     cwd = Some(pwd.with_join_str(&raw));
+     args.drain(0..2);
+     continue;
+ }
```

Tests to add (none currently): `_entry.test.ts` "should error if --cwd has no value", "should error if --cwd is followed by a flag".

---

### b5cc9a5 — Merges up -R into yarn up --recursive

**Quality:** Right call to consolidate; removes the standalone `UpRecursive` command and adds `--recursive` to `Up`. Behavior is forwarded to `execute_recursive` early in `execute`. Reasonable.

**Bugs:**
- (low) `packages/zpm/src/commands/up.rs:185-187` — `IdentGlob::new(&descriptor.to_file_string())` round-trips a `LooseDescriptor` through its file string. For a `LooseDescriptor::Descriptor` with a non-trivial range (e.g. `foo@1.0.0`), `to_file_string()` includes the `@1.0.0`, which `IdentGlob::new` won't accept as a pure ident pattern. Berry's `up -R` matches by ident only. Likely fine for the most common `up -R 'lodash*'` invocation but breaks `up -R 'lodash@1.x'`.
- (low) `packages/zpm/src/commands/up.rs:72-74` — under recursive mode, the `-F/-E/-T/-C` flags and per-workspace manifest writing are silently ignored. The doc comment in lines 22-25 says "no other switch will be allowed", so an explicit rejection would be friendlier. Berry actually errors.
- (low) `packages/zpm/src/commands/up.rs:183` — `use zpm_utils::ToFileString;` inside the function body, even though the same trait is already imported at the top of the file (line 7). Drop the local re-import.

**Style fit:** `execute_recursive` lives in the same `impl`, mirroring berry's class structure. Good.

**Helper opportunities:** None local; the previously-separate command file is gone. The two `Project::new(None).await?` + `run_install(...)` calls inside `execute` and `execute_recursive` could share a small "open project + apply enforced resolutions" helper, but it's only two callers.

**Suggested patch / repro:**

```diff
-         let patterns = self.descriptors.iter()
-             .map(|descriptor| IdentGlob::new(&descriptor.to_file_string()))
-             .collect::<Result<Vec<_>, _>>()?;
+         let patterns = self.descriptors.iter()
+             .map(|d| match d {
+                 LooseDescriptor::Ident(p) => IdentGlob::new(p.ident.as_str()),
+                 LooseDescriptor::Descriptor(p) => IdentGlob::new(&p.descriptor.ident.to_file_string()),
+                 LooseDescriptor::Range(_) => Err(/* error */),
+             })
+             .collect::<Result<Vec<_>, _>>()?;
```

(Sketch only — actual `IdentGlob::new` signature/error type unverified.)

---

### 16ff329 — Validates that workspaces foreach --jobs is at least 1

**Quality:** Trivial guard; new `Error::InvalidOptionMin` variant is generic and reusable. Good.

**Bugs:** (none).

**Style fit:** Matches the surrounding error enum style. The cast `params.limit as i64` is safe for any realistic value.

**Helper opportunities:** `Error::InvalidOptionMin` (and a future `Max`/`Range`) is exactly the right shape for reuse across command argument validation. Two near-term candidates: `cache_clear`/`workspaces_focus` lack numeric validators today, but if any future `--depth N`/`--parallelism N` flags arrive, route them through this variant.

**Suggested patch / repro:** none.

---

## Cross-cutting observations

### Workspace-dep iteration

`workspace.manifest.iter_hard_dependencies()` exists at `packages/zpm/src/manifest/mod.rs:322-343` but two new sites bypass it:

- `packages/zpm/src/commands/version/immediate.rs:141-148` (added in 802a106)
- `packages/zpm/src/commands/workspaces_list.rs:212-214` (added in 67df59a)

Both manually `dependencies.iter().chain(optional_dependencies.iter()).chain(dev_dependencies.iter())`. They need the `(ident, descriptor)` pair, whereas the existing helper yields just a `descriptor`. Quick fix: change `HardDependency` to also carry `ident` (or yield from the manifest iterator as `(&Ident, HardDependency<'_>)` directly — the maps are keyed by ident). Until then, every new command rolls its own.

There's also a separate `version/check.rs::build_dependent_map` (`packages/zpm/src/commands/version/check.rs:138`) that builds a reverse index `ident -> Vec<Ident>`. `immediate.rs` could have used this directly instead of an O(workspaces × deps) scan; promoting it to `Project::workspaces_depending_on(ident)` (or a cached lookup table on `Project`) would also serve `workspaces foreach --recursive` and `workspaces list --recursive --since`.

### Argument validation idioms

Pre-commit: validation happened either via clipanion option types or by panicking. 16ff329 introduces `Error::InvalidOptionMin { option, min, value }` — adopt this consistently. The `--cwd` parsing in 012144e (`packages/zpm-switch/src/yarn.rs:148-172`) is the next place a structured error should land: `Error::OptionMissingValue { option }` and `Error::OptionInvalidValue { option, value, reason }` would let `--cwd` (and any future bin-meta flag) report cleanly instead of silently no-op'ing.

The `cli::option` types could grow numeric validators on the clipanion side so commands don't need an explicit early `if` (e.g. `#[cli::option("-j,--jobs", min = 1)]`), but pending that, the new `InvalidOptionMin` variant is fine.

### cwd / path canonicalization

Three orthogonal cwd concepts coexist:

1. **Process cwd** (`std::env::current_dir`) — what new spawns inherit.
2. **Logical cwd** (`PWD` env var) — preserves the symlinked path the user typed.
3. **Workspace cwd** (`Project::project_cwd` / `ScriptEnvironment::cwd`) — where scripts run by default.

This batch adds plumbing for all three: 1a36ee2 sets `PWD` alongside `sys_set_current_dir` so child `pwd` sees the symlink; 012144e sets the *script* cwd in `exec` to the logical `current_dir` so `yarn --cwd=packages exec pwd` works; 012144e also creates the target dir if it doesn't exist.

Recommendations:

- Wrap `(sys_set_current_dir + set PWD)` as a single helper on `zpm-utils`. Today it's a hand-rolled pair in one location (`commands/mod.rs:151-157`), but the moment a second caller needs to chdir for a logical path (e.g. `workspaces foreach` running inside symlinked workspaces) the pair will be forgotten.
- `Path::current_dir().unwrap()` is repeated three times within `extract_bin_meta` alone (`yarn.rs:151,158,167`). Hoist once.
- `ScriptEnvironment::new()` already initializes `cwd = current_dir`, but `with_package` overwrites it (`script.rs:592`). The recent `exec.rs` change re-establishes cwd via an explicit `with_cwd(current_dir)` call (`commands/exec.rs:37`). A `ScriptEnvironment::with_logical_cwd()` shortcut, or making `with_package` take an `Option<Path> cwd_override`, would make the dependency between the two calls explicit.
- The auto-create-dir-on-`--cwd` behavior (`commands/mod.rs:146-149`) silently does what berry does; ensure no other code path relies on "if `--cwd` exists, it points at a real dir already".

### Manifest re-reads for non-default iteration

`Manifest::scripts` is a `BTreeMap` and `Workspace::pretty_name` synthesizes a stable id from `rel_path`. Both of these are workarounds for the in-memory manifest being lossy compared to the JSON source. The `Run::list_scripts` re-read (442bad9) and `workspace_version()` re-read (e743243) are two new examples. Consider switching `Manifest::scripts` to `IndexMap` (or adding a parallel `scripts_ordered` view) so insertion order survives — this would let `list_scripts` use `workspace.manifest.scripts` directly and eliminate a `ScriptsManifest` private struct.

---

# Batch 7 — Daemon, dlx, version check, constraints, npm login

## Synthesis

This batch is a grab-bag of test-driven fixes across mostly unrelated subsystems. Quality is generally good and the changes are appropriately scoped: every fix has a one-line root-cause description and a corresponding test gate. The strongest commits are the linker artifact cleanup (3f8ed39, surgical and well-justified) and the version check implementation (beecebc, complete with dependent propagation). The weakest are the two daemon commits (5277002 then 2bc3864), which together describe a temporary regression-and-recovery loop on the same lines — the human banner from 5277002 broke the IPC contract that 2bc3864 then had to restore. That sequence also leaves duplicated IPC envelope handling between `daemon_open.rs::DaemonSendCommand` and `daemon.rs::request_auth_url` that should be consolidated.

---

### 3f8ed39 — Cleans up stale PnP artifacts when the active linker isn't PnP

**Quality:** Tight, single-purpose change. The new `cleanup_inactive_linker_artifacts` helper is invoked once at the top of `link_project` and only fires for non-PnP linkers, which is the right place. The relocation of `unplugged_path` from `.yarn/ignore/unplugged` to `.yarn/unplugged` matches berry and is the location everyone else in the file already expects.

**Bugs:**
- (none) — but see notes. The cleanup is best-effort and silently propagates any `fs_rm` error via `?`. That's consistent with the rest of `link_project` so probably fine.

**Style fit:** Good. Function naming matches the `link_project_*` neighbors. `path.fs_exists()` then `path.fs_rm()` is a tiny TOCTOU window but the same idiom is used throughout the codebase.

**Helper opportunities:** None — this *is* the helper. A future cleanup could fold the four PnP-related path methods (`pnp_path`, `pnp_data_path`, `pnp_loader_path`, plus the constants `PNP_CJS_NAME`/`PNP_DATA_NAME`/`PNP_ESM_NAME`) into a single `pnp_artifact_paths() -> [Path; 4]` that returns the set being cleaned at `packages/zpm/src/linker/mod.rs:64-69`. That would also help any other code that needs to enumerate "all PnP outputs".

**Suggested patch / repro:** n/a.

---

### 0e69242 — Improves npm login error reporting and adds --always-auth flag

**Quality:** Both halves are self-contained and small. The `--always-auth` field plumbs through cleanly. The 401-username remap is narrow (only rewrites `AuthenticationError` whose message starts with `"Invalid authentication"`).

**Bugs:**
- **[low]** `packages/zpm/src/commands/npm/login.rs:321` — the match is string-prefixed (`message.starts_with("Invalid authentication")`). If the source error wording in `http_npm.rs` ever changes, this remap silently stops firing and we revert to the generic message with no compile-time signal. Worth either matching against a structured variant or extracting the prefix into a `const`.
- **[low]** The OTP-notice snapshot (`it should print the npm-notice when an OTP is requested 2`) no longer contains the `You're looking handsome today` line. That's consistent with `render_otp_notice` only being called from `ask_for_otp`, which short-circuits when `YARN_IS_TEST_ENV` is set (`packages/zpm/src/http_npm.rs:792-796`). The test still passes but the assertion is now empty — the OTP notice is functionally untested in zpm. Severity is low because the test compares against the snapshot and not a notice string, but the regression is silent.

**Style fit:** Matches the surrounding `update_document_field` chaining pattern. The two `if let Some(scope)` arms mirror each other (auth_token vs always_auth) — see helper note.

**Helper opportunities:** The four path constructions in `login.rs:126-138` and `:147-159` follow the exact same pattern `[npmScopes|npmRegistries, key, leaf]`. A small helper `fn npm_credential_path(scope: Option<&str>, registry: &str, leaf: &str) -> zpm_parsers::Path` (placed in this file or alongside `get_registry` in `http_npm.rs`) would deduplicate both pairs. That's also where any future `npmAuthIdent` etc. will land.

**Suggested patch / repro:** n/a.

---

### 55bfb9c — Lets constraints --fix actually loop until convergence

**Quality:** Correct fix for the immediate bug — the old condition stopped on `operations.is_empty() OR errors.is_empty()`, which was wrong: `--fix` produces operations but not errors, so a successful fix-pass with more work queued would exit on iteration 1. The new condition stops only when both are empty.

**Bugs:**
- **[low]** `packages/zpm/src/commands/constraints.rs:81-83` — the new condition does not terminate early when there are *only* errors and no operations (e.g. unfixable conflicts). The loop will then spin through the full `max_loops` (10) iterations recomputing the same unfixable errors before reporting them. Final outcome is correct (`ExitCode::FAILURE`) but it's wasted work and slow when constraints are expensive. The intuitively correct stop condition is `output.all_workspace_operations.is_empty()` regardless of errors: if no progress can be made this iteration, none can be made next iteration either.
- **[low]** `ConstraintsOutput::is_empty()` already exists at `packages/zpm/src/constraints/structs.rs:144-148` and is exactly the expression being inlined. The condition should be `output.is_empty()`.

**Style fit:** Matches the local style. The `let should_break = false || X || Y` pattern is unusual but pre-existing.

**Helper opportunities:** Use `ConstraintsOutput::is_empty()` instead of the inlined `is_empty() && is_empty()` at `packages/zpm/src/commands/constraints.rs:82`.

**Suggested patch / repro:** Not strictly a bug — perf-only nit. Test name `Commands constraints --fix shouldn't crash due to an unending fix loop` already exercises the convergence path.

```diff
-            let should_break = false
-                || (output.all_workspace_operations.is_empty() && output.all_workspace_errors.is_empty())
-                || loop_idx == max_loops;
+            let should_break = output.all_workspace_operations.is_empty()
+                || loop_idx == max_loops;
```

---

### eb77afe — Inherits the calling cwd's rc for dlx projects

**Quality:** Solves the right problem (auth scopes from the caller's project rc) but the implementation reaches for `serde_json::Value` ad-hoc inside a YAML-hydrate-then-merge dance. It works, but is the only place in the codebase that builds an rc by mutating a `serde_json::Value` object and then handing it to `serde_yaml::to_string`. Compare with `commands/config_set.rs:122-129`, which goes through `JsonDocument::hydrate_from_str` into `serde_yaml::Value` directly.

**Bugs:**
- **[low]** `packages/zpm/src/commands/dlx.rs:140-141` — the calling rc is read from `Path::current_dir().join(".yarnrc.yml")` only. Yarn's actual rc-resolution walks the project hierarchy (`.yarnrc.yml` in the project root, plus user/home rc), so dlx still drops rc keys defined further up the tree (e.g. monorepo root rc when dlx is invoked from a workspace subdir). The fix as-is solves the test case (which writes `.yarnrc.yml` directly into the cwd) but is incomplete for real users.
- **[low]** Line 162 — the fallback on `serde_yaml::to_string` failure writes only `enableGlobalCache: false`, silently discarding the inherited rc keys. For a serializable `serde_json::Value` this realistically never trips, but if it ever does the failure is invisible.
- **[low]** The hard-coded drop-list `["packageExtensions", "plugins"]` lives only here. If new "ephemeral-unfriendly" keys (e.g. `injectEnvironmentFiles`, project-relative `cacheFolder`) appear, this list silently rots. Worth a comment pointing to the YN0068 warning source so future authors know what to add.

**Style fit:** Mixed. The mutation-via-`as_object_mut` then `if let Object(...)` re-pattern-match is two-step where one would do. Compare to the `Document` / `JsonDocument` / `YamlDocument` abstractions used elsewhere — those are the project's preferred way to mutate rc-like documents.

**Helper opportunities:** Strong candidate. The "build an ephemeral rc by inheriting from a parent rc, minus ephemeral-unfriendly keys" pattern is reusable for any in-tree spawn (think future `yarn exec --isolated`, or scripted dry-run installs). A `fn build_inherited_rc(calling_cwd: &Path, base: serde_json::Value) -> Result<String, Error>` placed alongside `setup_project` would isolate the YAML/JSON round-trip and the drop-list.

**Suggested patch / repro:** Not a hard bug; the parent-rc-walk would be a feature improvement. Existing test `dlx it should respect locally configured registry scopes` exercises the happy path.

---

### beecebc — Implements yarn version check

**Quality:** Complete implementation matching what the test file (`commands/version/check.test.js`) asserts. Five concerns split cleanly: filter changed files outside `.yarn/versions`, propagate dirtiness through dependents, collect releases/declines from versioning files changed *on this branch*, intersect, error with the expected wording. The `versioning_path()` side-fix (relative → absolute path via `versioning_path.contains(file)` filter) is a real correctness improvement and is correctly justified in the commit body.

**Bugs:**
- **[low]** `packages/zpm/src/commands/version/check.rs:138-155` — `build_dependent_map` walks `iter_hard_dependencies` (dependencies + optionalDependencies + devDependencies, per `manifest/mod.rs:322-343`). Peer dependencies are excluded, so a workspace that peer-depends on a changed workspace won't be flagged. Berry's `version check` propagates through peer deps too. Likely a small undertest area.
- **[low]** `:32` and `:111` — both `fetch_changed_workspaces(&project, None)` and `collect_versioning_state` call `fetch_branch_base` internally. That's two `git merge-base` invocations per `version check`. Cheap individually, but threading the resolved base through `collect_versioning_state` as a parameter would avoid the duplicate spawn.
- **[low]** `:84-88` — `Couldn't auto-upgrade range *` wording is single-quoted in tests but only as a fragment; if multiple workspaces are missing bumps they're newline-joined into one `Error::VersionCheckFailed` payload (`error.rs` adds a `:\n` prefix). Likely fine for the tests but the user-facing rendering is `…:\nCouldn't…\nCouldn't…` which is unusual.

**Style fit:** Good. Imports/structure match `version/apply.rs` and `version/deferred.rs`.

**Helper opportunities:**
- The `build_dependent_map` helper is genuinely reusable: anywhere we need "workspaces that hard-depend on X" (e.g. workspaces foreach --topological, deferred-version propagation in `versioning.rs`), this is the same map. Worth promoting to `project.rs` or a `workspace_graph.rs` module.
- The "BFS over dependent_map starting from initial set" at `:56-67` is a classic transitive-closure walk. A `fn workspaces_with_dependents(project: &Project, roots: BTreeSet<Ident>) -> BTreeSet<Ident>` would encapsulate it.

**Suggested patch / repro:** None — the missing-peer-deps case is not exercised by any test in `check.test.js` (per the snippet read), so it's a latent gap rather than an active bug.

---

### 2bc3864 — Keeps the WS URL on the first stdout line of switch daemon --open

**Quality:** Correct fix for a regression introduced two commits earlier (5277002, see below). The fix is minimal: print the URL first, then the human banner. The comment at `daemon_open.rs:152-153` ("The first line must remain the WS URL") is essential — it's the only thing protecting the next maintainer from re-breaking this.

**Bugs:**
- (none directly) — but see the cross-cutting observation. The "first line is the URL" contract is enforced only by a comment on the producer side and an implicit `next_line()` on the consumer side (`daemon/client.rs:514`). No structured handshake.

**Style fit:** Good. Matches the existing `println!` style.

**Helper opportunities:** Worth introducing a small `print_daemon_handshake(port, token, label, pid)` helper used by both the "already running" branch (`:52-56`) and the "freshly started" branch (`:152-156`). Those two `println!` blocks are now almost identical and will drift if the format ever changes again.

**Suggested patch / repro:** n/a — fix is correct. The "fixes ~35 tests" claim suggests the regression was wide; no new test was added to lock in the contract.

---

### 18b3eab — Adds `switch daemon --send` for sending IPC payloads

**Quality:** Implementation is straightforward and matches the existing `request_auth_url` (`daemon.rs:62-112`) pattern. The new struct lives in the same file as `DaemonOpenCommand` even though it's semantically separate — slightly odd but the file is small.

**Bugs:**
- **[low]** `packages/zpm-switch/src/commands/switch/daemon_open.rs:308` — `serde_json::to_string(&resp).unwrap_or_default()` silently prints an empty string on serialization failure but still returns `Ok(())`. For a `serde_json::Value` round-trip this is essentially unreachable, but if it ever trips the caller sees exit code 0 with no output. Promote to a `?` via a proper error variant.
- **[low]** `:286` — the 5-second timeout is hard-coded and shared with `DaemonStartTimeout`, but the failure-mode wording ("Daemon failed to start within timeout") is misleading when in fact the daemon was reached but didn't reply in time. A new variant like `DaemonResponseTimeout` would be clearer.
- **[low]** `:270` — `request_id: u64 = 1` is a constant. Fine in practice (one request per process), but it means a stale response from a previous interaction could be mis-matched if the daemon ever buffered one. UUID or process-PID would harden it.
- **[low]** Trailing blank line inside the impl block at `:227-228` (extra `\n` between the closing `}` of `check_daemon_ready` and the closing `}` of `impl DaemonOpenCommand`).

**Style fit:** Good — copies the `daemon.rs::request_auth_url` shape almost verbatim.

**Helper opportunities:** This is the big one. `daemon_open.rs::DaemonSendCommand::execute` (`:241-313`) and `daemon.rs::request_auth_url` (`:62-112`) are nearly identical:
- both build the same WS URL,
- both `connect_async`,
- both build the same `{requestId, request}` envelope (different inner `request` shape),
- both filter on `kind == "response"` and matching `requestId`,
- both use a 5-second timeout,
- both error with `DaemonStartTimeout`.

Worth extracting `async fn send_daemon_request(detected_root: &Path, request: serde_json::Value) -> Result<serde_json::Value, Error>` into a shared module (e.g. a new `packages/zpm-switch/src/daemons/ipc.rs`). Then:
- `request_auth_url` becomes one call with `{type: "getAuthUrl"}`,
- `DaemonSendCommand::execute` becomes one call with the user-supplied JSON,
- a future "kill" / "status" IPC reuses the same plumbing.

**Suggested patch / repro:** Not a bug. Test names: `switch daemon it should send ping and receive pong` and `… it should error when sending to non-running daemon` at `daemon.test.ts:149,173`.

---

### 5277002 — Adds --start alias for switch daemon and prints PID/URL on launch

**Quality:** The `--open,--start` alias is a clean one-line change and the right call. The accompanying human-readable banner change, however, broke `daemon/client.rs::start_daemon` (which reads the URL from the first line of stdout) and had to be partially reverted three commits later by 2bc3864. As a self-contained commit it represents a regression; reading the two together resolves the issue, but the intermediate state was broken for any consumer that spawned the wrapper to discover the URL.

**Bugs:**
- **[high]** `packages/zpm-switch/src/commands/switch/daemon_open.rs:147-150` (at this commit) — moves the WS URL below `Started daemon…` / `PID:` / `Port:` lines, breaking `start_daemon` in `packages/zpm/src/daemon/client.rs:514-521` which calls `reader.next_line()` expecting the URL. The commit claims "Fixes 4 tests" but the description doesn't acknowledge that ~35 other tests are simultaneously broken (those failures are listed against 2bc3864). Fixed downstream by 2bc3864 but the regression should ideally have been caught in this commit by either (a) keeping the URL first, or (b) updating `start_daemon` to parse a different line in the same change.
- **[low]** The "Daemon already running" branch (`:51-55` at this commit) now prints `Daemon already running for project … / PID: …` without the URL, leaving the `start_daemon` consumer with no URL at all on the warm-path. 2bc3864 also fixes this.

**Style fit:** Good for the surface change; the breakage is semantic, not stylistic.

**Helper opportunities:** Same as 2bc3864 — a `print_daemon_handshake` helper would have made the contract obvious and harder to break.

**Suggested patch / repro:** The bug here is fully fixed by 2bc3864; flagging only because reviewing this commit in isolation reads as introducing the regression. No new diff needed; the tests `tasks list/run` and `daemon ping/pong` cover the URL-first contract once 2bc3864 is applied.

---

## Cross-cutting observations

**Daemon IPC plumbing is screaming for a shared helper.** The same envelope handling — connect, send `{requestId, request}`, await a matching `kind: "response"` for 5 seconds, close, propagate timeout — now exists twice:

- `packages/zpm-switch/src/commands/daemon.rs:62-112` (`request_auth_url`)
- `packages/zpm-switch/src/commands/switch/daemon_open.rs:241-313` (`DaemonSendCommand::execute`)

And there will be a third the next time someone wants to talk to the daemon. Extract into `packages/zpm-switch/src/daemons/` (alongside `is_process_alive`, `get_daemon`, etc.):

```rust
pub async fn send_request(entry: &DaemonEntry, request: serde_json::Value)
    -> Result<serde_json::Value, Error>;
```

Returning the inner `response` value lets each caller `serde_json::from_value` it into a typed struct. Move the 5s timeout and `DaemonStartTimeout`/`DaemonResponseTimeout` decision into the helper. Both call sites collapse to ~5 lines.

**The `--open` stdout contract should be structured, not positional.** Right now the "first stdout line must be the WS URL" rule is enforced only by:
- a `// The first line must remain the WS URL` comment in two places in `daemon_open.rs`,
- an implicit `reader.next_line()` in `daemon/client.rs:514`.

Nothing prevents a third producer location, or a future `eprintln!` debug aid, from breaking this again. Options that survive refactors:
- Emit a single line of structured JSON (`{"url":"…","pid":…,"port":…}`) as the first line and parse it on the consumer side. Human-readable lines can follow freely.
- Or route via the existing daemon registry (`daemons::get_daemon` already returns `port` + `auth_token`) — the wrapper writes the entry before it prints anything, so the consumer could just read the registry once spawned. The current stdout-handshake exists because the wrapper waits for "ready" via stdout closing, but that signal could move to a sentinel line like `READY` while the URL is read from the registry.

**Rc filtering for ephemeral projects (dlx) deserves its own helper.** The drop-list of "ephemeral-unfriendly" keys (`packageExtensions`, `plugins`) is hard-coded in `dlx.rs:147-148`. The same list will be needed by any future ephemeral-environment command (e.g. `yarn exec --isolated`, plugin sandboxing, version-bumping dry-runs). Lift to a `build_ephemeral_rc(inherit_from: &Path, base: serde_json::Value) -> Result<String, Error>` and unit-test it.

**Two transitive-closure walks over the workspace graph in this batch.** `version/check.rs:56-67` BFS over dependents, and `versioning.rs` likely has a similar walk for release propagation. A `workspace_graph` module on `Project` (forward and reverse dependency maps, plus a `transitive_closure(roots)` helper) would clean up both. Bonus: it would let `fetch_changed_workspaces` propagate through the graph in one place rather than each command rolling its own.

**The 'first line must remain the WS URL' commit pair (5277002 + 2bc3864) is a cautionary tale.** A small refactor (banner reordering) silently broke a load-bearing positional protocol that wasn't asserted by any test the refactor author would have run. Suggests adding a regression test that boots a daemon via the wrapper and asserts `start_daemon`'s URL-discovery succeeds — i.e. exercising the bridge between `zpm-switch` and `zpm/daemon/client.rs`, not just the daemon itself.

---

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

---

## Cleanup / housekeeping commits

These 18 commits are tracked here for completeness; none warrants per-commit analysis. They fall into three buckets:

**REVIEW-LIST.md upkeep** — strictly documentation churn tracking what the branch resolved and what's still open. Each refreshes the maintainer's running TODO list against the work just landed.

- `ea83fe1` — Expands REVIEW-LIST with remaining architectural gaps.
- `6727a4f` — Trims REVIEW-LIST after Prolog/yarnPath items resolved.
- `04836f0` — Trims REVIEW-LIST for items addressed in this batch.
- `5eb9f46` — Updates REVIEW-LIST with what remains after the nm linker pass.
- `7d46363` — Updates REVIEW-LIST for completed / partial work.
- `97eeaf1` — Removes resolved cacheFolder item.
- `0242c4c` — Refreshes REVIEW-LIST for prunedNativeDeps / `--check-resolutions` / immutablePatterns / nmMode.

**Test-suite deletions** — features zpm has decided not to port (V1 lockfile migration, the Yarn-1 stage, the legacy plugin architecture, the editor SDKs, the Prolog DSL, `yarnPath`, pnpLoose). Removing the tests is the right move; the alternative is keeping permanently-red `xtest`s that obscure regressions in the real work. The commit messages on each are self-explanatory.

- `48915b1` — Removes `init --install` / V1 migration tests.
- `0c80eba` — Removes plugin-architecture test coverage.
- `f160e86` — Removes `yarnPath`-specific test coverage.
- `2b52a4e` — Removes Prolog-based constraints tests.
- `08d2f8a` — Removes Yarn-1 lockfile-migration test from merge-conflict suite.
- `c63eb7b` — Drops `stage` and `pnpLoose` test files.
- `0bada28` — Drops `editorSdks` tests and notes cacheFolder issue in REVIEW-LIST.
- `41bc0a1` — Drops the manifest-reformatting `immutablePatterns` test (zpm deliberately doesn't canonicalise empty `{}` blocks).

**Snapshot refreshes / serde toggle** — fall-out from features in this branch. `139aa01` flips on `serde_json/preserve_order` (required by `--json` outputs that match berry's documented key order); `8b8e421` and `1454ab9` regenerate snapshots that depended on the prior alphabetical order or that picked up the new `preferInteractive` / `cacheFolder` settings.

- `139aa01` — Enables `serde_json/preserve_order`.
- `8b8e421` — Refreshes a constraints snapshot after preserving JSON key order.
- `1454ab9` — Refreshes config snapshots after `preferInteractive` / `cacheFolder` additions.
- `905a2c0` — Refreshes config-test snapshots for zpm's report formatting.

No bugs flagged in this set.

---

## Conclusion — recommended helpers

Aggregating the eight batches, a handful of helpers come up repeatedly and would deliver the largest readability/correctness payoff. Roughly ordered by impact:

### 1. `report::if_active(impl FnOnce(&StreamReport))` — collapse the YN-emit dance

The single highest-yield cleanup. The 4-line scaffolding

```rust
if let Some(report_guard) = try_current_report() {
    if let Some(report) = report_guard.as_ref() {
        report.warn(format!("[YN…] …"));
    }
}
```

and its sync sibling (`current_report().await.as_ref().map(|r| r.warn(...))`) appear:

- 5× in this batch alone in `build.rs` and `linker/helpers.rs` (batch 4: YN0004/0005/0007/0009 + inline-builds log).
- ~10× in `install.rs` (batch 3: YN0057, YN0058, YN0068, the legacy-glob and nohoist warnings, peer-dep reporter).
- 2× in the nm linker (batch 1: portal conflicts, deletion-detect).
- 3× more under construction in batches 6 and 8 (bin warning, constraints).

A single `report::if_active(|r| r.warn(format!(...)))` (sync) plus its `async` companion would compress every site to one line and centralise the `try_read()` / awaited-guard difference. Pair it with a `report.diag(MessageName, Severity, ...)` API and severity discipline (currently `info` for YN0005/0007, `warn` for YN0002/0004/0009 — pattern correct, surface noisy) gets enforced in one place.

### 2. `workspace_graph` module on `Project` — forward + reverse dep maps, transitive closure

Three new sites compute "workspaces depending on X" each their own way:

- `version/check.rs::build_dependent_map` (batch 7) is the canonical-looking one — already a `BTreeMap<Ident, Vec<Ident>>`.
- `version/immediate.rs::report_non_upgradeable_dependents` (batch 6) re-scans `workspaces × hard-deps` and would benefit from the same map.
- `workspaces_list.rs::compute_dep_classification` (batch 6) reimplements the descriptor-vs-workspace satisfiability check.

Lift `build_dependent_map` to `project::workspace_graph` and add:

```rust
impl Project {
    pub fn workspaces_depending_on(&self, ident: &Ident) -> &[Ident];
    pub fn workspaces_with_dependents(&self, roots: &BTreeSet<Ident>) -> BTreeSet<Ident>; // BFS
    pub fn workspace_satisfies(&self, descriptor: &Descriptor) -> WorkspaceMatch;
}
```

The BFS in batch 7 (version/check.rs:56-67), the dependent scan in batch 6, and any future `workspaces foreach --topological --since` all collapse to a single call.

### 3. `split_ident_and_selector` in `zpm_primitives`

Three independent parsers for `name@selector` (or `ident@reference`) exist in commands added this branch — each with a different bug:

- `info.rs::get_filter` (batch 5, `48fae58`) — scoped names hit `find('@') == 0` and the descriptor filter silently bypasses; protocol allowlist is hardcoded.
- `create.rs::rewrite_starter` (batch 5, `b33c198`) — correct for scoped names, but not symmetric.
- `npm/info.rs::parse_package_arg` (batch 5, `413d74c`) — third copy.
- `add.rs` — has its own variant when accepting `@scope/foo@range`.

Extract `fn split_ident_and_selector(input: &str) -> Result<(Ident, Option<&str>), ParseError>` (scope-aware) plus `fn split_ident_glob_and_reference(...)` for the glob+reference variant. Place next to `Descriptor::from_file_string` / `IdentGlob` in `zpm_primitives`. Fixes the `48fae58` scoped-package bug for free.

### 4. `send_daemon_request(entry, request) -> Result<Value, Error>`

The envelope handling is duplicated point-for-point between `daemon.rs::request_auth_url` and `daemon_open.rs::DaemonSendCommand::execute` (batch 7): same WS URL build, `connect_async`, `{requestId, request}` body, `kind == "response"` filter, 5s timeout, and (misleading) `DaemonStartTimeout` on failure. A third caller is inevitable.

Suggested home: `packages/zpm-switch/src/daemons/ipc.rs`. Returning the inner `response: Value` lets each caller `serde_json::from_value` into a typed shape. Also a good moment to split `DaemonStartTimeout` from a new `DaemonResponseTimeout` so the wording matches the failure.

### 5. `commands::rc_helpers` (and let `Configuration::load` do its job)

Inline RC plumbing is scattered across at least five commands:

- `init.rs::apply_init_fields` (batch 5) — reinvents user→project rc cascade, ignoring the cascade in `Configuration::load`.
- `config_set.rs::load_home_config`, `config_unset.rs::load_home_config` (batch 5) — duplicated verbatim.
- `dlx.rs::setup_project` (batch 7) — reads only `current_dir/.yarnrc.yml`, missing monorepo-root rc.
- `config.rs::source_label` (batch 5) — duplicates strings that ought to live on `Source`.

Minimum viable: `commands::rc_helpers::{home_rc_path, project_rc_path, build_inherited_rc}`. Better: register `initFields` in `Settings`/`schema.json` and read via `project.config.settings.init_fields.value`, deleting `apply_init_fields` entirely. The `dlx.rs` ephemeral-rc drop-list (`packageExtensions`, `plugins`) belongs in `build_inherited_rc` with a comment pointing at YN0068.

### 6. `Manifest::iter_hard_dependencies` should yield `(ident, descriptor)`

The iterator exists but two new sites bypass it (batch 6: `version/immediate.rs:141-148` and `workspaces_list.rs:212-214`) because they need the ident as well as the descriptor. Until the iterator yields both, every new dep-traversal call site will copy-paste the three-map chain. Make `HardDependency<'_>` carry the ident (or change the iterator type to `Iterator<Item = (&Ident, HardDependency<'_>)>`). Also: extend it to cover `peerDependencies` for callers that need them (batch 6 `802a106`, batch 7 `beecebc` both miss peers).

### 7. `Project::displayable_locator(&Locator) -> Locator`

`display_locator_for` in `commands/why.rs` (batch 5, `7c18aa1`) is one of multiple places that turn a workspace locator (`name@workspace:name`) into its path-based form (`name@workspace:packages/foo`) for output. The same conversion is needed by `info.rs`, `dedupe.rs::report_dedupe_needed`, and `workspaces_list.rs`. Inside `why.rs` it's currently O(n*m) (linear scan per locator); the same routine on `Project`, backed by a precomputed `BTreeMap<Path, Locator>`, lets all four commands share one source of truth.

Bonus: the inconsistency in `why_simple` (batch 5) — children rendered without the conversion while parents are — disappears.

### 8. `Reference::is_portal()` (and similar tiny predicates)

`matches!(reference, Reference::Portal(_))` appears five times across `linker/nm/mod.rs` and `linker/nm/hoist.rs` (batch 1, `31135c0`). The maintainer already maintains `is_virtual_reference` and `is_workspace_reference`, so the pattern is established. Add `is_portal` next to them; mechanical replace.

### 9. `helpers::ensure_hardlink(target, source)` and a single `ExtractMode` extraction tail

`link_into_local_index` (batch 4, `c3c2714`) and `link_into_cas` (batch 1, `ea66ccf`) both end with the same `(dest_meta, source_meta) → (dev, ino) match → already_linked? → fs_rm + hard_link` tail (~16 lines each in `linker/helpers.rs`). Likewise, `link_into_local_index` has a dead `if/else` whose two arms write the same bytes — collapsing both via one `ensure_hardlink(target, source)` helper plus a `helpers::repair_in_place(path, data)` for the in-place index rewrite removes both smells.

### 10. `pack_path_glob_pattern` — uniform `format!("!/{}", path)` glob injection

`pack.rs:619-657` (batch 8) repeats the same `format!("!/{}", X.to_file_string())` shape **eight times** across `main / exports / imports / browser / module / bin / types / typings`, with inconsistent inner accessors (`to_file_string()` for some, raw `String` for `browser` after `93299d4`, the value itself for `main`/`module`/`types`/`typings`). Two parts:

1. Land an `Iterator<Item = &str>` accessor on every manifest field that contributes paths (uniform return type — this is what `93299d4` got wrong by returning `String` while peers return `&Path`).
2. Replace the eight blocks with a single table-driven loop that calls one shared `add_pack_root_paths(&mut glob_ignore, paths)`.

This also resolves the `93299d4` style smell without any behaviour change.

### 11. `dlx::install_and_run_single(loose_descriptor, args, banner, quiet)`

Four commands now orchestrate `install_dependencies` + `find_binary` + `run_binary` back-to-back: `Dlx`, `DlxWithPackages`, `Create` (batch 5, `b33c198`), and `InitWithTemplate` (batch 5, `ea6ae68`). The "Installing …" banner format is also a literal in each. One shared helper plus a `report::yn0000(...)` for the banner cuts each `execute` to ~10 lines.

### 12. Smaller, targeted helpers

These are each one or two call sites today but are clearly next-on-the-list:

- **`force_setting(&mut config_field, source)`** — the four near-identical `if self.X == Some(true) { settings.Y.value = true; settings.Y.source = Source::Cli; }` blocks in `commands/install.rs:104-122` (batch 3).
- **`Path::sys_set_current_dir_with_pwd(path)`** in `zpm-utils` — the (`sys_set_current_dir`, `set_var("PWD", …)`) pair is currently a single inline use in `commands/mod.rs:151-157` (batch 6) but is load-bearing for symlinked `--cwd`; whoever forgets the second call will reintroduce a regression.
- **`fs_expect_with::<E>(expected, build_err)`** — generalise `fs_expect` to take an error-builder closure so callers (lockfile YN0028 in batch 3 `fa8535d`, manifest sort-check in `commands/install.rs:244`) can supply structured variants without re-implementing the read-and-compare.
- **`ConfigurationContext::preferred_cwd()`** — `project_cwd.or(package_cwd)` is open-coded twice in `packages/zpm-config/src/fns.rs` (batch 8 `ebe53ea`). While there, thread `localCacheFolderName` through the context so `compute_cache_folder` stops lying about the cache path.
- **`npm_credential_path(scope, registry, leaf)`** for the four duplicated path builders in `commands/npm/login.rs` (batch 7 `0e69242`).
- **RAII `RedactionScope`** — replace `set_redacted(bool)` global state with a guard returned by `RedactionScope::new(false)` that restores on drop (batch 5 `510a422`, `0012db7`). Would also have caught the `0012db7` polarity bug at the type level.
- **`zpm_switch::resolve_detected_root() -> Result<Path, Error>`** — `env::var("YARNSW_DETECTED_ROOT").ok().or(find_closest_package_manager(cwd)?…)` exists in two places now (batch 8 `00d14bf` + `proxy.rs`).
- **`tree::iter_physical()`** on `ResolutionTree` — three sites in batch 4 dedupe virtualised locators three different ways (`BTreeSet<Locator>` for YN0002, `physical_locator()` skip-list for `BuildRequest`, no dedup for YN0004/0005).

### Layering note

Almost every helper above lives in one of three target homes — they line up cleanly with the existing crate split:

- **`zpm_primitives` / `zpm-config`** — pure data + parsing (`split_ident_and_selector`, `Reference::is_portal`, `ConfigurationContext::preferred_cwd`).
- **`zpm-utils`** — filesystem and process primitives (`sys_set_current_dir_with_pwd`, `fs_expect_with`, `ensure_hardlink`).
- **`packages/zpm/src/` modules** — domain orchestration (`report::if_active`, `workspace_graph`, `commands::rc_helpers`, `dlx::install_and_run_single`, `Project::displayable_locator`, `send_daemon_request`).

None of them is large; the report scaffolding helper (#1) and the workspace-graph module (#2) are the two that, if landed first, would simplify several of the remaining ones (because today's call sites are tangled with the YN-emit ceremony or the manual dep-traversal).
