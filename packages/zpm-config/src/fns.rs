use zpm_utils::Path;

use crate::ConfigurationContext;

pub fn compute_cache_folder(context: &ConfigurationContext) -> Path {
    if let Some(project_cwd) = &context.project_cwd {
        return project_cwd
            .with_join_str(".yarn")
            .with_join_str("cache");
    }

    if let Some(package_cwd) = &context.package_cwd {
        return package_cwd
            .with_join_str(".yarn")
            .with_join_str("cache");
    }

    Path::new()
}

pub fn check_tsconfig(context: &ConfigurationContext) -> bool {
    if let Some(project_cwd) = &context.project_cwd {
        let root_has_tsconfig = project_cwd
            .with_join_str("tsconfig.json")
            .fs_exists();

        if root_has_tsconfig {
            return true;
        }
    }

    if let Some(package_cwd) = &context.package_cwd {
        let package_has_tsconfig = package_cwd
            .with_join_str("tsconfig.json")
            .fs_exists();

        if package_has_tsconfig {
            return true;
        }
    }

    false
}

