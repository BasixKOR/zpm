use clipanion::cli;
use zpm_macro_enum::zpm_enum;
use zpm_primitives::Range;
use zpm_utils::{ToFileString, ToHumanString};

use crate::{error::Error, project, versioning::{ExactReleaseStrategy, ReleaseStrategy, Versioning}};

#[zpm_enum(error = zpm_utils::EnumError, or_else = |s| Err(zpm_utils::EnumError::NotFound(s.to_string())))]
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[derive_variants(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ImmediateStrategy {
    #[literal("major")]
    Major,

    #[literal("minor")]
    Minor,

    #[literal("patch")]
    Patch,

    #[literal("premajor")]
    Premajor,

    #[literal("preminor")]
    Preminor,

    #[literal("prepatch")]
    Prepatch,

    #[literal("rc")]
    #[literal("pre")]
    #[literal("prerelease")]
    Pre,

    #[literal("decline")]
    Decline,

    #[pattern(r"(?<version>.*)")]
    #[to_file_string(|params| params.version.to_file_string())]
    #[to_print_string(|params| params.version.to_print_string())]
    Exact {
        version: zpm_semver::Version,
    },
}

impl TryFrom<ImmediateStrategy> for Option<ReleaseStrategy> {
    type Error = Error;

    fn try_from(version_bump: ImmediateStrategy) -> Result<Self, Self::Error> {
        match version_bump {
            ImmediateStrategy::Major
                => Ok(Some(ReleaseStrategy::Major)),
            ImmediateStrategy::Minor
                => Ok(Some(ReleaseStrategy::Minor)),
            ImmediateStrategy::Patch
                => Ok(Some(ReleaseStrategy::Patch)),
            ImmediateStrategy::Decline
                => Ok(None),
            ImmediateStrategy::Exact(params)
                => Ok(Some(ExactReleaseStrategy {version: params.version}.into())),

            _ => {
                Err(Error::InvalidDeferredVersionBump(version_bump.to_print_string()))
            },
        }
    }
}

#[cli::command]
#[cli::path("version")]
#[cli::category("Project management")]
pub struct Version {
    #[cli::option("-i,--immediate", default = false)]
    immediate: bool,

    version_bump: ImmediateStrategy,
}

impl Version {
    pub async fn execute(&self) -> Result<(), Error> {
        let project
            = project::Project::new(None).await?;

        let deferred
            = !self.immediate && project.config.settings.prefer_deferred_versions.value;

        let versioning
            = Versioning::new(&project);

        let active_workspace
            = project.active_workspace()?;

        if deferred {
            versioning.set_workspace_release_strategy(
                &active_workspace.name,
                self.version_bump.clone().try_into()?,
            ).await?;

            return Ok(());
        }

        let current_version
            = active_workspace.manifest.remote.version.as_ref()
                .ok_or(Error::NoVersionFoundForActiveWorkspace)?;

        let new_version = match &self.version_bump {
            ImmediateStrategy::Major => current_version.next_major(),
            ImmediateStrategy::Minor => current_version.next_minor(),
            ImmediateStrategy::Patch => current_version.next_patch(),

            ImmediateStrategy::Premajor => current_version.next_major_rc(),
            ImmediateStrategy::Preminor => current_version.next_minor_rc(),
            ImmediateStrategy::Prepatch => current_version.next_patch_rc(),

            ImmediateStrategy::Pre => current_version.next_rc(),

            ImmediateStrategy::Exact(params) => {
                params.version.clone()
            },

            ImmediateStrategy::Decline => {
                return Err(Error::VersionDeclineNotAllowed);
            },
        };

        versioning.apply_version(
            &active_workspace.name,
            &new_version,
        )?;

        println!("Bumped from {} to {}", current_version.to_print_string(), new_version.to_print_string());

        report_non_upgradeable_dependents(&project, &active_workspace.name);

        Ok(())
    }
}

fn report_non_upgradeable_dependents(project: &project::Project, bumped_ident: &zpm_primitives::Ident) {
    for workspace in project.workspaces.iter() {
        for hard in workspace.manifest.iter_hard_dependencies() {
            if hard.ident != bumped_ident {
                continue;
            }

            if let Range::WorkspaceMagic(params) = &hard.descriptor.range {
                if matches!(params.magic, zpm_semver::RangeKind::Exact) {
                    println!(
                        "Couldn't auto-upgrade range {} (in {})",
                        params.magic.to_file_string(),
                        workspace.locator_path().to_print_string(),
                    );
                }
            }
        }
    }
}
