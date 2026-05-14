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

