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
