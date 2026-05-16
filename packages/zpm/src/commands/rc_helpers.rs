use std::sync::Arc;

use zpm_config::{Configuration, ConfigurationContext};
use zpm_utils::{LastModifiedAt, Path};

use crate::error::Error;

const DEFAULT_RC_FILENAME: &str = ".yarnrc.yml";

/// Returns the configured rc filename (honoring `YARN_RC_FILENAME`),
/// defaulting to `.yarnrc.yml`.
pub fn rc_filename() -> String {
    std::env::var("YARN_RC_FILENAME")
        .unwrap_or_else(|_| DEFAULT_RC_FILENAME.to_string())
}

/// Path to the user's home rc file.
pub fn home_rc_path() -> Result<Path, Error> {
    let home = Path::home_dir()?
        .ok_or(Error::HomeDirectoryNotFound)?;

    Ok(home.with_join_str(&rc_filename()))
}

/// Loads a `Configuration` rooted at the user's home directory, with
/// no project rc layered on top.
pub fn load_home_config() -> Result<Configuration, Error> {
    let user_cwd = Path::home_dir()?
        .ok_or(Error::HomeDirectoryNotFound)?;

    let context = ConfigurationContext {
        env: std::env::vars().collect(),
        user_cwd: Some(user_cwd),
        project_cwd: None,
        package_cwd: None,
    };

    let mut last_modified_at = LastModifiedAt::new();

    Configuration::load(&context, &mut last_modified_at)
        .map_err(|e| Error::ConfigurationParseError(Arc::new(e)))
}

/// Builds a YAML rc body for an ephemeral project (e.g. `dlx`) from
/// the caller's rc. Drops keys whose targets aren't in the ephemeral
/// project (`packageExtensions`, `plugins`, `enableGlobalCache`).
pub fn build_inherited_rc(calling_cwd: &Path) -> String {
    let base: serde_json::Value = serde_json::json!({
        "enableGlobalCache": false,
    });

    let calling_rc = calling_cwd.with_join_str(&rc_filename());

    let parsed = calling_rc.fs_read_text()
        .ok()
        .and_then(|content| zpm_parsers::YamlDocument::hydrate_from_str::<serde_json::Value>(&content).ok());

    let mut merged = base;

    if let Some(mut parsed) = parsed {
        if let Some(map) = parsed.as_object_mut() {
            // Targets these keys reference aren't in the ephemeral
            // project; user-set values would surface as YN0068 or
            // override our forced `enableGlobalCache: false`.
            map.remove("packageExtensions");
            map.remove("plugins");
            map.remove("enableGlobalCache");
        }

        if let (serde_json::Value::Object(entries), serde_json::Value::Object(target))
            = (parsed, &mut merged)
        {
            for (key, value) in entries {
                target.insert(key, value);
            }
        }
    }

    serde_yaml::to_string(&merged).unwrap_or_else(|_| "enableGlobalCache: false\n".to_string())
}
