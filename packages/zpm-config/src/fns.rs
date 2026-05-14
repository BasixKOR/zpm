use zpm_utils::Path;

use crate::ConfigurationContext;

pub fn compute_cache_folder(context: &ConfigurationContext) -> Path {
    context.preferred_cwd()
        .map(|cwd| cwd.with_join_str(".yarn").with_join_str("cache"))
        .unwrap_or_else(Path::new)
}

pub fn check_tsconfig(context: &ConfigurationContext) -> bool {
    let Some(cwd) = context.preferred_cwd() else {
        return false;
    };

    cwd.with_join_str("tsconfig.json").fs_exists()
}

