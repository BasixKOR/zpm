use zpm_utils::Path;

use crate::ConfigurationContext;

pub fn compute_cache_folder(context: &ConfigurationContext) -> Path {
    context.preferred_cwd()
        .map(|cwd| cwd.with_join_str(".yarn").with_join_str("cache"))
        .unwrap_or_else(Path::new)
}

pub fn check_tsconfig(context: &ConfigurationContext) -> bool {
    // We probe both the project root and the active package: in a
    // monorepo, only the workspace under operation typically owns a
    // `tsconfig.json`, while the project root often has none.
    // Collapsing to `preferred_cwd()` (project-first, single dir)
    // would miss the workspace-level config.
    context.project_cwd.iter()
        .chain(context.package_cwd.iter())
        .any(|cwd| cwd.with_join_str("tsconfig.json").fs_exists())
}

/// Returns true when zpm is running in a GitHub Actions pull-request
/// workflow for a *public* repository. Used as the default for
/// `enableImmutableInstalls` (so contributors can't sneak in lockfile
/// changes during install) and to auto-enable `--refresh-lockfile`.
///
/// Reads from `context.env` rather than `std::env::var` so test
/// harnesses can stub the value without globally mutating the
/// process environment.
pub fn is_public_pr_ci(context: &ConfigurationContext) -> bool {
    if context.env.get("GITHUB_ACTIONS").map(String::as_str) != Some("true") {
        return false;
    }

    if context.env.get("GITHUB_EVENT_NAME").map(String::as_str) != Some("pull_request") {
        return false;
    }

    let Some(event_path) = context.env.get("GITHUB_EVENT_PATH") else {
        return false;
    };

    #[derive(serde::Deserialize)]
    struct Event {
        repository: Option<Repository>,
    }

    #[derive(serde::Deserialize)]
    struct Repository {
        private: Option<bool>,
    }

    let Ok(text) = std::fs::read_to_string(event_path) else {
        return false;
    };

    let Ok(event) = zpm_parsers::JsonDocument::hydrate_from_str::<Event>(&text) else {
        return false;
    };

    event.repository.and_then(|r| r.private) == Some(false)
}

