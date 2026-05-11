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
