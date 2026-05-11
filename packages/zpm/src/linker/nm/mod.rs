use std::collections::BTreeMap;

use zpm_primitives::{Ident, Reference};
use zpm_sync::{SyncItem, SyncTemplate, SyncTree};
use zpm_utils::{FromFileString, Path, ToHumanString};

use crate::{
    build::BuildRequests, content_flags, error::Error, fetchers::PackageData, install::Install, linker::{LinkResult, nm::hoist::{Hoister, WorkTree}}, project::Project
};

pub mod hoist;

const EXPECT_CHILDREN: &str = "All nodes should be expanded by the end of the hoisting process";

fn collect_binaries_from_dependencies(install: &Install, children: &BTreeMap<Ident, usize>, work_tree: &WorkTree) -> BTreeMap<String, (Ident, Path)> {
    let mut binaries
        = BTreeMap::new();

    for (ident, child_idx) in children {
        let child_node
            = &work_tree.nodes[*child_idx];

        let physical_locator
            = child_node.locator.physical_locator();

        if let Some(content_flags) = install.install_state.content_flags.get(&physical_locator) {
            for (bin_name, binary) in &content_flags.binaries {
                if let content_flags::Binary::Node(bin_path) = binary {
                    binaries.insert(bin_name.clone(), (ident.clone(), bin_path.clone()));
                }
            }
        }
    }

    binaries
}

fn collect_workspace_binaries(install: &Install, workspace_node: &hoist::WorkNode) -> BTreeMap<String, (Ident, Path)> {
    let mut binaries
        = BTreeMap::new();

    let physical_locator
        = workspace_node.locator.physical_locator();

    if let Some(content_flags) = install.install_state.content_flags.get(&physical_locator) {
        for (bin_name, binary) in &content_flags.binaries {
            if let content_flags::Binary::Node(bin_path) = binary {
                binaries.insert(bin_name.clone(), (workspace_node.locator.ident.clone(), bin_path.clone()));
            }
        }
    }

    binaries
}

/// Registers bin symlinks in the sync tree for a given node_modules subfolder.
/// `node_rel_path` is the path within node_modules where dependencies are located
/// (e.g., "" for top-level, or "foo/node_modules" for nested).
fn register_bin_symlinks_at_path(workspace_nm_tree: &mut SyncTree, node_rel_path: &Path, binaries: &BTreeMap<String, (Ident, Path)>) -> Result<(), Error> {
    for (bin_name, (dep_ident, bin_path)) in binaries {
        // The symlink will be at <node_rel_path>/.bin/<bin_name>
        // It needs to point to ../<dep_name>/<bin_path>
        let bin_symlink_path = node_rel_path
            .with_join_str(".bin")
            .with_join_str(bin_name);

        let target_path = Path::new()
            .with_join_str("..")
            .with_join_str(&dep_ident.as_str())
            .with_join(bin_path);

        workspace_nm_tree.register_entry(bin_symlink_path, SyncItem::Symlink {
            target_path,
        })?;
    }

    Ok(())
}

/// When a workspace's effective `selfReferences` setting is `true`,
/// register a `<host>/node_modules/<workspace-name>` symlink pointing at
/// that workspace's source dir, so dependents (and the workspace
/// itself, when `host` is the workspace) can require it by name.
///
/// Skipped when the workspace name collides with one of `host`'s
/// direct hoisted children (the dependency wins), when the workspace
/// is anonymous, or when its resolution was dropped from the tree
/// (e.g. `yarn workspaces focus` exclusions).
fn register_workspace_symlinks_at(
    project: &Project,
    install: &Install,
    workspace_nm_tree: &mut SyncTree,
    host_node: &hoist::WorkNode,
    host_abs_path: &Path,
    candidate_workspaces: impl IntoIterator<Item = (Ident, Path)>,
) -> Result<(), Error> {
    let global_default = project.config.settings.nm_self_references.value;
    let host_children = host_node.children.as_ref();

    for (workspace_ident, workspace_dir) in candidate_workspaces {
        if host_children.map_or(false, |children| children.contains_key(&workspace_ident)) {
            continue;
        }

        let target_workspace = project.workspace_by_ident(&workspace_ident).ok();

        let Some(target_workspace) = target_workspace else {
            continue;
        };

        if target_workspace.manifest.name.is_none() {
            continue;
        }

        // Workspaces excluded from a `workspaces focus` run don't have
        // an entry in the resolution tree; we don't symlink them so
        // their incomplete state doesn't leak into the project root.
        // Note that `project.install_state` isn't attached yet at link
        // time, so we look the resolution tree up via the Install we
        // were handed.
        let target_locator = target_workspace.locator();
        if !install.install_state.resolution_tree.locator_resolutions.contains_key(&target_locator) {
            continue;
        }

        let per_workspace = target_workspace.manifest.install_config
            .as_ref()
            .and_then(|cfg| cfg.self_references);

        if !per_workspace.unwrap_or(global_default) {
            continue;
        }

        // A workspace whose effective hoistingLimits says "stay inside
        // your own border" also doesn't want its locator surfaced in
        // the project root's node_modules.
        let install_limit = target_workspace.manifest.install_config
            .as_ref()
            .and_then(|cfg| cfg.hoisting_limits)
            .map(zpm_config::NmHoistingLimits::from)
            .unwrap_or(project.config.settings.nm_hoisting_limits.value);

        if install_limit != zpm_config::NmHoistingLimits::None
            && target_workspace.rel_path != Path::new()
        {
            continue;
        }

        let symlink_path
            = Path::new()
                .with_join_str(workspace_ident.as_str());

        let target_path
            = workspace_dir
                .relative_to(&host_abs_path.with_join(&symlink_path).dirname().unwrap_or_default());

        workspace_nm_tree.register_entry(symlink_path, SyncItem::Symlink {
            target_path,
        })?;
    }

    Ok(())
}

fn register_workspace_bin_symlinks(workspace_nm_tree: &mut SyncTree, workspace_path: &Path, binaries: &BTreeMap<String, (Ident, Path)>) -> Result<(), Error> {
    for (bin_name, (_ident, bin_path)) in binaries {
        let target_abs_path
            = workspace_path
                .with_join(bin_path);

        if !target_abs_path.fs_exists() {
            continue;
        }

        let bin_symlink_path = Path::new()
            .with_join_str(".bin")
            .with_join_str(bin_name);

        let target_path = Path::new()
            .with_join_str("..")
            .with_join_str("..")
            .with_join(bin_path);

        workspace_nm_tree.register_entry(bin_symlink_path, SyncItem::Symlink {
            target_path,
        })?;
    }

    Ok(())
}

fn generate_workspace_node_modules(
    project: &Project,
    install: &Install,
    work_tree: &WorkTree,
    workspace_node_idx: usize,
    packages_by_location: &mut BTreeMap<Path, zpm_primitives::Locator>,
) -> Result<(), Error> {
    let workspace_node
        = &work_tree.nodes[workspace_node_idx];

    let workspace
        = project.workspace_by_locator(&workspace_node.locator)?;

    packages_by_location.insert(workspace.rel_path.clone(), workspace_node.locator.clone());

    let workspace_dir
        = project.project_cwd
            .with_join(&workspace.rel_path);

    let workspace_abs_path
        = workspace_dir
            .with_join_str("node_modules");

    let mut workspace_nm_tree
        = SyncTree::new();

    workspace_nm_tree.dry_run = false;

    let workspace_binaries
        = collect_workspace_binaries(install, &work_tree.nodes[workspace_node_idx]);

    register_workspace_bin_symlinks(&mut workspace_nm_tree, &workspace_dir, &workspace_binaries)?;

    // Berry's `nmSelfReferences` puts every workspace into the project
    // root's node_modules so that any code in the project can require
    // it by name. Nested workspaces don't get a self-symlink in their
    // own node_modules (the "no circular self-references" rule).
    let is_root_workspace
        = workspace.rel_path == Path::new();

    if is_root_workspace {
        let candidate_workspaces: Vec<(Ident, Path)> = project.workspaces.iter()
            .map(|ws| (ws.name.clone(), project.project_cwd.with_join(&ws.rel_path)))
            .collect();

        register_workspace_symlinks_at(
            project,
            install,
            &mut workspace_nm_tree,
            &work_tree.nodes[workspace_node_idx],
            &workspace_abs_path,
            candidate_workspaces,
        )?;
    }

    let mut workspace_queue
        = vec![(Path::new(), workspace_node_idx)];

    while let Some((node_rel_path, node_idx)) = workspace_queue.pop() {
        let node
            = &work_tree.nodes[node_idx];

        let children
            = node.children.as_ref()
                .expect(EXPECT_CHILDREN);

        for (ident, child_idx) in children {
            let child_node
                = &work_tree.nodes[*child_idx];

            let child_rel_path
                = node_rel_path.with_join_str(&ident.as_str());

            workspace_queue.push((child_rel_path.with_join_str("node_modules"), *child_idx));

            let abs_path
                = workspace_abs_path
                    .with_join(&node_rel_path)
                    .with_join(&child_rel_path);

            let rel_path
                = abs_path
                    .relative_to(&project.project_cwd);

            packages_by_location.insert(rel_path, child_node.locator.clone());

            let package_data
                = install.package_data.get(&child_node.locator.physical_locator());

            match package_data {
                Some(PackageData::Abstract) => {
                    return Err(Error::Unsupported);
                },

                Some(PackageData::Local {package_directory, ..}) => {
                    let child_abs_path
                        = workspace_abs_path.with_join(&child_rel_path);

                    let target_path
                        = package_directory.relative_to(&child_abs_path.dirname().unwrap());

                    workspace_nm_tree.register_entry(child_rel_path, SyncItem::Symlink {
                        target_path: target_path.clone(),
                    })?;
                },

                Some(PackageData::Zip {archive_path, package_directory, ..}) => {
                    workspace_nm_tree.register_entry(child_rel_path, SyncItem::Folder {
                        template: Some(SyncTemplate::Zip {
                            archive_path: archive_path.clone(),
                            inner_path: package_directory.relative_to(&archive_path),
                        }),
                    })?;
                },

                Some(PackageData::MissingZip {..}) => {
                    // Nothing to do here
                },

                None => match &child_node.locator.reference {
                    Reference::Link(params) if params.path.starts_with('/') => {
                        let target_path
                            = Path::from_file_string(&params.path)?;

                        workspace_nm_tree.register_entry(child_rel_path, SyncItem::Symlink {
                            target_path,
                        })?;
                    },

                    _ => {
                        unreachable!("Expected package data for {}", ToHumanString::to_print_string(&child_node.locator.physical_locator()));
                    },
                },
            }
        }

        // Register bin symlinks for all direct dependencies of this node
        // Skip any bins that conflict with workspace binaries (workspace takes precedence)
        let mut binaries
            = collect_binaries_from_dependencies(install, children, &work_tree);

        // For root level, filter out bins that conflict with workspace binaries
        if node_rel_path.is_empty() {
            for bin_name in workspace_binaries.keys() {
                binaries.remove(bin_name);
            }
        }

        register_bin_symlinks_at_path(&mut workspace_nm_tree, &node_rel_path, &binaries)?;
    }

    workspace_nm_tree
        .run(workspace_abs_path)?;

    Ok(())
}

pub async fn link_island_nm(
    project: &Project,
    install: &Install,
    island: &crate::island::ResolvedIsland,
) -> Result<LinkResult, Error> {
    let mut packages_by_location
        = BTreeMap::new();

    for workspace_ident in &island.workspace_idents {
        let workspace = project.workspace_by_ident(workspace_ident)?;
        let workspace_locator = workspace.locator();

        let mut work_tree = WorkTree::new_for_island_workspace(
            project,
            &install.install_state,
            workspace_locator,
        );

        let mut hoister
            = Hoister::new(&mut work_tree);

        hoister.hoist();

        generate_workspace_node_modules(
            project,
            install,
            &work_tree,
            0,
            &mut packages_by_location,
        )?;
    }

    Ok(LinkResult {
        packages_by_location,
        build_requests: BuildRequests {
            entries: vec![],
            dependencies: BTreeMap::new(),
        },
    })
}

pub async fn link_project_nm(project: &Project, install: &Install) -> Result<LinkResult, Error> {
    let mut work_tree
        = WorkTree::new(project, &install.install_state);

    let mut hoister
        = Hoister::new(&mut work_tree);

    let mut packages_by_location
        = BTreeMap::new();

    hoister.hoist();

    let mut project_queue
        = vec![0usize];

    while let Some(workspace_node_idx) = project_queue.pop() {
        generate_workspace_node_modules(
            project,
            install,
            &work_tree,
            workspace_node_idx,
            &mut packages_by_location,
        )?;

        project_queue.extend_from_slice(&work_tree.nodes[workspace_node_idx].workspaces_idx);
    }

    Ok(LinkResult {
        packages_by_location,
        build_requests: BuildRequests {
            entries: vec![],
            dependencies: BTreeMap::new(),
        },
    })
}
