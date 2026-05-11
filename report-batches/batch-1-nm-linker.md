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
