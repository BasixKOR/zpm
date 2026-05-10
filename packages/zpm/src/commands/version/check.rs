use std::collections::{BTreeMap, BTreeSet};

use clipanion::cli;
use zpm_parsers::JsonDocument;
use zpm_primitives::Ident;
use zpm_utils::ToHumanString;

use crate::{
    error::Error,
    git_utils::{fetch_branch_base, fetch_changed_files, fetch_changed_workspaces},
    project::{self, Project},
    versioning::VersioningFile,
};

/// Check that all the relevant packages have been bumped
///
/// This command will check that all the workspaces that have been modified
/// (compared to the branch base) have been declared (or declined) in the
/// versioning file (`.yarn/versions`).
///
#[cli::command]
#[cli::path("version", "check")]
#[cli::category("Project management")]
pub struct VersionCheck {
}

impl VersionCheck {
    pub async fn execute(&self) -> Result<(), Error> {
        let project
            = project::Project::new(None).await?;

        let raw_changed_workspaces = fetch_changed_workspaces(&project, None).await?;
        let versioning_dir = project.versioning_path();

        // Exclude workspaces whose only changes are inside the versioning
        // folder (those changes are bookkeeping for version bumps themselves).
        let mut changed_workspaces = BTreeMap::new();
        for (ident, paths) in raw_changed_workspaces {
            let project_paths: BTreeSet<_> = paths.iter()
                .filter(|file| !versioning_dir.contains(file))
                .cloned()
                .collect();

            if !project_paths.is_empty() {
                changed_workspaces.insert(ident, project_paths);
            }
        }

        if changed_workspaces.is_empty() {
            return Ok(());
        }

        let versioning_state = collect_versioning_state(&project).await?;

        let dependent_map = build_dependent_map(&project);
        let mut workspaces_to_check: BTreeSet<Ident> = changed_workspaces.keys().cloned().collect();
        let mut queue: Vec<Ident> = workspaces_to_check.iter().cloned().collect();

        while let Some(ident) = queue.pop() {
            if let Some(dependents) = dependent_map.get(&ident) {
                for dep in dependents {
                    if workspaces_to_check.insert(dep.clone()) {
                        queue.push(dep.clone());
                    }
                }
            }
        }

        let mut missing_bumps = Vec::new();

        for workspace_ident in &workspaces_to_check {
            if versioning_state.releases.contains(workspace_ident) {
                continue;
            }

            if versioning_state.declined.contains(workspace_ident) {
                continue;
            }

            missing_bumps.push(workspace_ident.clone());
        }

        if !missing_bumps.is_empty() {
            let message = missing_bumps
                .iter()
                .map(|ident| format!("Couldn't auto-upgrade range * (in {})", ident.to_print_string()))
                .collect::<Vec<_>>()
                .join("\n");

            return Err(Error::VersionCheckFailed(message));
        }

        Ok(())
    }
}

struct VersioningState {
    releases: BTreeSet<Ident>,
    declined: BTreeSet<Ident>,
}

async fn collect_versioning_state(project: &Project) -> Result<VersioningState, Error> {
    let versioning_dir = project.versioning_path();

    let mut releases = BTreeSet::new();
    let mut declined = BTreeSet::new();

    // Only consider versioning files that were added/changed on this branch.
    // Files committed on the base branch shouldn't satisfy bumps required
    // by the current branch's changes.
    let base = match fetch_branch_base(project).await {
        Ok(base) => base,
        Err(_) => return Ok(VersioningState { releases, declined }),
    };

    let changed_files = fetch_changed_files(project, Some(&base)).await?;
    let relevant_files: Vec<zpm_utils::Path> = changed_files.into_iter()
        .filter(|file| versioning_dir.contains(file) && file.extname() == Some(".json"))
        .collect();

    for path in relevant_files {
        let Ok(content) = path.fs_read_text_prealloc() else {
            continue;
        };

        let data: VersioningFile = match JsonDocument::hydrate_from_str(&content) {
            Ok(data) => data,
            Err(_) => continue,
        };

        releases.extend(data.releases.into_keys());
        declined.extend(data.declined);
    }

    Ok(VersioningState { releases, declined })
}

fn build_dependent_map(project: &Project) -> BTreeMap<Ident, Vec<Ident>> {
    let mut map: BTreeMap<Ident, Vec<Ident>> = BTreeMap::new();
    let workspace_idents: BTreeSet<Ident> = project.workspaces.iter()
        .map(|w| w.name.clone())
        .collect();

    for workspace in &project.workspaces {
        for hard in workspace.manifest.iter_hard_dependencies() {
            if workspace_idents.contains(&hard.descriptor.ident) {
                map.entry(hard.descriptor.ident.clone())
                    .or_default()
                    .push(workspace.name.clone());
            }
        }
    }

    map
}
