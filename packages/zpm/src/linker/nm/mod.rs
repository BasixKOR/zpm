use std::collections::{BTreeMap, BTreeSet};

use zpm_primitives::{FilterDescriptor, Ident, Locator, Reference};
use zpm_sync::{SyncItem, SyncTemplate, SyncTree};
use zpm_utils::{FromFileString, Path, ToFileString, ToHumanString};

use crate::{
    build::{self, BuildRequest, BuildRequests}, content_flags, error::Error, fetchers::PackageData, install::Install, linker::{self, LinkResult, helpers::PackageMeta, nm::hoist::{Hoister, WorkTree}}, project::Project
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
    canonical_build_locations: &mut BTreeMap<Locator, Path>,
    force_rebuild_locators: &mut BTreeSet<Locator>,
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
        // Nested workspaces (those living inside another workspace's
        // directory) resolve their peer dependencies through their
        // parent's node_modules, so surfacing them at the project root
        // would point consumers at a sibling subtree that doesn't share
        // the same parent context. Restrict the root self-references
        // to top-level workspaces.
        let non_root_workspace_paths: std::collections::BTreeSet<&Path> = project.workspaces.iter()
            .map(|ws| &ws.rel_path)
            .filter(|rel_path| !rel_path.is_empty())
            .collect();

        let candidate_workspaces: Vec<(Ident, Path)> = project.workspaces.iter()
            .filter(|ws| {
                ws.rel_path.iter_path().rev()
                    .skip(1)
                    .all(|ancestor| !non_root_workspace_paths.contains(&ancestor))
            })
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

            // Symlinked children (portals, links, file:) can't host a
            // nested `node_modules` in the sync tree — the sync layer
            // refuses to descend through a Symlink node. The
            // dependencies of those packages either hoisted to the
            // current node already or will be reported as a conflict
            // by the post-hoist portal check.
            let is_symlinked
                = matches!(package_data, Some(PackageData::Local { .. }))
                    || matches!(child_node.locator.reference.physical_reference(), Reference::Link(_) | Reference::Portal(_));

            if !is_symlinked {
                workspace_queue.push((child_rel_path.with_join_str("node_modules"), *child_idx));
            }

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

                    canonical_build_locations
                        .entry(child_node.locator.clone())
                        .or_insert_with(|| package_directory.relative_to(&project.project_cwd));
                },

                Some(PackageData::Zip {archive_path, package_directory, ..}) => {
                    // The SyncTree only re-extracts when the destination
                    // is missing. A user-deleted package therefore gets
                    // re-extracted automatically; we just need to flag
                    // it for rebuild so the build cache doesn't short-
                    // circuit the matching tree-hash entry.
                    let dest_abs_path
                        = workspace_abs_path
                            .with_join(&node_rel_path)
                            .with_join(&child_rel_path);

                    if !dest_abs_path.fs_exists() {
                        force_rebuild_locators.insert(child_node.locator.clone());
                    }

                    workspace_nm_tree.register_entry(child_rel_path, SyncItem::Folder {
                        template: Some(SyncTemplate::Zip {
                            archive_path: archive_path.clone(),
                            inner_path: package_directory.relative_to(&archive_path),
                        }),
                    })?;

                    canonical_build_locations
                        .entry(child_node.locator.clone())
                        .or_insert_with(|| dest_abs_path.relative_to(&project.project_cwd));
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
        .run(workspace_abs_path.clone())?;

    // Tests (and tools) reach for `workspace/node_modules` without
    // checking that it exists. Make sure we always materialize the
    // directory, even when the workspace has no deps or symlinks.
    workspace_abs_path.fs_create_dir_all()?;

    Ok(())
}

fn build_requests_from_locations(
    project: &Project,
    install: &Install,
    canonical_build_locations: &BTreeMap<Locator, Path>,
    force_rebuild_locators: &BTreeSet<Locator>,
    dependencies_meta: &Vec<(FilterDescriptor, PackageMeta)>,
) -> Result<BuildRequests, Error> {
    let tree
        = &install.install_state.resolution_tree;

    let mut all_build_entries
        = Vec::<BuildRequest>::new();
    let mut package_build_entries
        = BTreeMap::<Locator, usize>::new();

    for (locator, build_cwd) in canonical_build_locations {
        // Virtual locators share their build with the physical one.
        if locator.reference.is_virtual_reference() {
            continue;
        }

        let physical = locator.physical_locator();

        let Some(physical_package_data) = install.package_data.get(&physical) else {
            continue;
        };

        let Some(resolution) = tree.locator_resolutions.get(locator) else {
            continue;
        };

        let info = linker::helpers::get_package_internal_info(
            project,
            install,
            dependencies_meta,
            locator,
            resolution,
            physical_package_data,
        );

        let Some(build_commands) = info.build_commands else {
            continue;
        };

        package_build_entries.insert(locator.clone(), all_build_entries.len());

        all_build_entries.push(build::BuildRequest {
            cwd: build_cwd.clone(),
            locator: locator.clone(),
            commands: build_commands,
            allowed_to_fail: tree.optional_builds.contains(locator),
            force_rebuild: force_rebuild_locators.contains(locator),
            inline_builds: install.inline_builds,
        });
    }

    let dependencies = linker::helpers::populate_build_entry_dependencies(
        &package_build_entries,
        &tree.locator_resolutions,
        &tree.descriptor_to_locator,
    )?;

    Ok(BuildRequests {
        entries: all_build_entries,
        dependencies,
    })
}

pub async fn link_island_nm(
    project: &Project,
    install: &Install,
    island: &crate::island::ResolvedIsland,
) -> Result<LinkResult, Error> {
    let mut packages_by_location
        = BTreeMap::new();

    let mut canonical_build_locations
        = BTreeMap::new();
    let mut force_rebuild_locators
        = BTreeSet::new();

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
            &mut canonical_build_locations,
            &mut force_rebuild_locators,
        )?;
    }

    let dependencies_meta
        = linker::helpers::TopLevelConfiguration::from_project(project);

    let build_requests = build_requests_from_locations(
        project,
        install,
        &canonical_build_locations,
        &force_rebuild_locators,
        &dependencies_meta,
    )?;

    Ok(LinkResult {
        packages_by_location,
        build_requests,
    })
}

/// When any locator in the resolution uses a portal protocol, the
/// node-modules linker emits a warning telling the user to launch Node
/// with `--preserve-symlinks` (or the per-module variant). Without it,
/// dependencies hoisted into the parent's node_modules wouldn't be
/// reachable from the portal target — Node walks up from the symlink's
/// resolved location, not from where the symlink was instantiated.
fn warn_about_portals_if_any(install: &Install) {
    let has_portal = install.install_state
        .resolution_tree
        .locator_resolutions
        .keys()
        .any(|locator| matches!(locator.reference.physical_reference(), Reference::Portal(_)));

    if !has_portal {
        return;
    }

    if let Some(report_guard) = crate::report::try_current_report() {
        if let Some(report) = report_guard.as_ref() {
            report.warn(
                "[YN0066] Portals are in use. Make sure to set --preserve-symlinks (or NODE_PRESERVE_SYMLINKS_MAIN=1) so node can resolve hoisted dependencies through the portal symlink.".to_string(),
            );
        }
    }
}

/// Walks the post-hoist work tree to find external portals whose
/// direct dependencies couldn't hoist into the portal's immediate
/// parent (the parent already had a conflicting locator under that
/// name). Berry refuses to silently lose those resolutions on disk —
/// the portal target is read-only by convention — so we surface the
/// conflict and fail the install. Internal portals (relative paths
/// that resolve inside the project) are exempt: the user owns those
/// directories and we can let the dep stay nested under the symlink.
fn check_external_portal_conflicts(
    project: &Project,
    install: &Install,
    work_tree: &hoist::WorkTree,
) -> Result<(), Error> {
    let mut has_conflict = false;

    for node in &work_tree.nodes {
        // A portal with peer deps gets wrapped in a Virtual reference;
        // `physical_reference()` unwraps that for the type check while
        // we keep the original `node.locator` around for printing the
        // user-facing context.
        if !matches!(node.locator.reference.physical_reference(), Reference::Portal(_)) {
            continue;
        }

        let Some(children) = &node.children else {
            continue;
        };

        if children.is_empty() {
            continue;
        }

        let Some(parent_idx) = node.parent_idx else {
            continue;
        };

        let parent_node = &work_tree.nodes[parent_idx];

        let Some(parent_children) = parent_node.children.as_ref() else {
            continue;
        };

        let package_directory = install.package_data
            .get(&node.locator.physical_locator())
            .and_then(|pd| match pd {
                PackageData::Local { package_directory, .. } => Some(package_directory),
                _ => None,
            });

        let is_internal = package_directory
            .map(|pd| project.project_cwd.contains(pd))
            .unwrap_or(false);

        if is_internal {
            continue;
        }

        for (child_ident, &child_idx) in children {
            let child_locator
                = &work_tree.nodes[child_idx].locator;

            let parent_locator = parent_children.get(child_ident)
                .map(|&idx| &work_tree.nodes[idx].locator);

            // Look for a sibling portal under the same parent whose
            // original dependency map already declared the conflicting
            // version — that means the hoister picked the sibling's
            // copy first, and the user gets a clearer error pointing
            // at which sibling caused it.
            let sibling_portal = parent_locator
                .and_then(|parent_loc| {
                    parent_children.iter()
                        .filter_map(|(_, &sibling_idx)| {
                            let sibling = &work_tree.nodes[sibling_idx];
                            if sibling_idx == child_idx {
                                return None;
                            }
                            let sibling_is_portal = matches!(
                                sibling.locator.reference.physical_reference(),
                                Reference::Portal(_),
                            );
                            if !sibling_is_portal {
                                return None;
                            }
                            let original = sibling.dependencies.get(child_ident)?;
                            if original == parent_loc {
                                Some(&sibling.locator)
                            } else {
                                None
                            }
                        })
                        .next()
                });

            if let Some(report_guard) = crate::report::try_current_report() {
                if let Some(report) = report_guard.as_ref() {
                    match (parent_locator, sibling_portal) {
                        (Some(parent_locator), Some(sibling_locator)) => {
                            report.warn(format!(
                                "[YN0067] {}: dependency {} conflicts with dependency {} from sibling portal {}",
                                node.locator.to_file_string(),
                                child_locator.to_file_string(),
                                parent_locator.to_file_string(),
                                sibling_locator.ident.as_str(),
                            ));
                        },
                        (Some(parent_locator), None) => {
                            report.warn(format!(
                                "[YN0067] {}: dependency {} conflicts with parent dependency {}",
                                node.locator.to_file_string(),
                                child_locator.to_file_string(),
                                parent_locator.to_file_string(),
                            ));
                        },
                        (None, _) => {
                            report.warn(format!(
                                "[YN0067] {}: dependency {} can't be hoisted into the parent and the portal target is external",
                                node.locator.to_file_string(),
                                child_locator.to_file_string(),
                            ));
                        },
                    }
                }
            }

            has_conflict = true;
        }
    }

    if has_conflict {
        return Err(Error::SilentError);
    }

    Ok(())
}

pub async fn link_project_nm(project: &Project, install: &Install) -> Result<LinkResult, Error> {
    warn_about_portals_if_any(install);

    let mut work_tree
        = WorkTree::new(project, &install.install_state);

    let mut hoister
        = Hoister::new(&mut work_tree);

    let mut packages_by_location
        = BTreeMap::new();

    let mut canonical_build_locations
        = BTreeMap::new();
    let mut force_rebuild_locators
        = BTreeSet::new();

    hoister.hoist();

    check_external_portal_conflicts(project, install, &work_tree)?;

    let mut project_queue
        = vec![0usize];

    while let Some(workspace_node_idx) = project_queue.pop() {
        generate_workspace_node_modules(
            project,
            install,
            &work_tree,
            workspace_node_idx,
            &mut packages_by_location,
            &mut canonical_build_locations,
            &mut force_rebuild_locators,
        )?;

        project_queue.extend_from_slice(&work_tree.nodes[workspace_node_idx].workspaces_idx);
    }

    let dependencies_meta
        = linker::helpers::TopLevelConfiguration::from_project(project);

    let build_requests = build_requests_from_locations(
        project,
        install,
        &canonical_build_locations,
        &force_rebuild_locators,
        &dependencies_meta,
    )?;

    Ok(LinkResult {
        packages_by_location,
        build_requests,
    })
}
