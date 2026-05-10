use std::sync::Arc;

use clipanion::cli;
use zpm_config::{Configuration, ConfigurationContext};
use zpm_parsers::{DataDocument, JsonDocument, Value};
use zpm_utils::{IoResultExt, LastModifiedAt, Path, ToFileString};

use crate::{
    error::Error,
    project::Project,
};

fn path_exists<'a>(value: &serde_json::Value, mut segments: impl Iterator<Item = &'a str>) -> bool {
    match segments.next() {
        None => true,
        Some(segment) => {
            match value {
                serde_json::Value::Object(map) => match map.get(segment) {
                    Some(child) => path_exists(child, segments),
                    None => false,
                },
                _ => false,
            }
        }
    }
}

/// Unset a configuration value
///
/// This command will remove a configuration setting, by default in the project configuration file
/// unless the `-H,--home` flag is set, in which case it will be removed from the home
/// configuration file.
///
#[cli::command]
#[cli::path("config", "unset")]
#[cli::category("Configuration commands")]
pub struct ConfigUnset {
    /// If set, the configuration will be unset in the home configuration file
    #[cli::option("-H,--home", default = false)]
    home: bool,

    /// The name of the configuration value to unset
    name: zpm_parsers::Path,
}

impl ConfigUnset {
    pub async fn execute(&self) -> Result<(), Error> {
        let document_path = if self.home {
            let user_cwd = Path::home_dir()?
                .ok_or(Error::HomeDirectoryNotFound)?;

            let rc_filename = std::env::var("YARN_RC_FILENAME")
                .unwrap_or_else(|_| ".yarnrc.yml".to_string());

            user_cwd.with_join_str(&rc_filename)
        } else {
            let project = Project::new(None).await?;

            project.config.project_config_path
                .clone()
                .ok_or(Error::HomeDirectoryNotFound)?
        };

        let document
            = document_path
                .fs_read_text()
                .ok_missing()?
                .unwrap_or_default();

        let already_present = if document.trim().is_empty() {
            false
        } else {
            let parsed: serde_json::Value = JsonDocument::hydrate_from_str(&document)
                .or_else(|_| zpm_parsers::YamlDocument::hydrate_from_str(&document))?;

            path_exists(&parsed, self.name.segments().iter().map(|s| s.as_str()))
        };

        if !already_present {
            println!("Configuration doesn't contain setting {}; there is nothing to unset", self.name.to_file_string());
            return Ok(());
        }

        let updated_document = DataDocument::update_document_field(
            &document,
            self.name.clone(),
            Value::Undefined,
        )?;

        Configuration::validate(&updated_document)
            .map_err(|e| Error::ConfigurationParseError(Arc::new(e)))?;

        document_path
            .fs_change(&updated_document, false)?;

        let _config: Configuration = if self.home {
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
                .map_err(|e| Error::ConfigurationParseError(Arc::new(e)))?
        } else {
            Project::new(None).await?.config
        };

        println!("Successfully unset {}", self.name.to_file_string());

        Ok(())
    }
}
