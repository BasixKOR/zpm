use clipanion::cli;
use zpm_parsers::{Document, JsonDocument, Value};
use zpm_switch::{PackageManagerField, PackageManagerReference, VersionPackageManagerReference};
use zpm_utils::{Path, ToFileString, ToHumanString};

use crate::error::Error;

/// Set the version of Yarn to use with the local project
///
/// This command will update the `packageManager` field in the local project's top-level `package.json` file to the specified version.
///
/// Unlike in Yarn 2 to 4, it will never set the deprecated `yarnPath` field.
///
#[cli::command]
#[cli::path("set", "version")]
#[cli::category("Configuration commands")]
pub struct SetVersion {
    /// The version of Yarn to use with the local project
    version: zpm_switch::Selector,
}

impl SetVersion {
    pub async fn execute(&self) -> Result<(), Error> {
        let detected_root_path = match std::env::var("YARNSW_DETECTED_ROOT") {
            Ok(switch_detected_root) => Path::try_from(&switch_detected_root)?,
            Err(_) => {
                let cwd = Path::current_dir()?;
                let find_result
                    = zpm_switch::find_closest_package_manager(&cwd)?;

                find_result.detected_root_path
                    .ok_or(Error::FailedToGetSwitchDetectedRoot)?
            }
        };

        let manifest_path = detected_root_path
            .with_join_str("package.json");

        let manifest_content = manifest_path
            .fs_read_prealloc()?;

        let mut document
            = JsonDocument::new(manifest_content)?;

        let resolved_version
            = zpm_switch::resolve_selector(&self.version).await?;

        let reference: PackageManagerReference = VersionPackageManagerReference {
            version: resolved_version.clone(),
        }.into();

        let package_manager
            = PackageManagerField::new_yarn(reference);

        document.set_path(
            &zpm_parsers::Path::from_segments(vec!["packageManager".to_string()]),
            Value::String(package_manager.to_file_string()),
        )?;

        manifest_path
            .fs_change(&document.input, false)?;

        println!("Switching to {}", resolved_version.to_print_string());
        println!("Saved into {}", manifest_path.to_print_string());

        Ok(())
    }
}
