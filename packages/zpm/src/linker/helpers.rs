use std::{collections::{BTreeMap, BTreeSet}, fs::Permissions, os::unix::fs::PermissionsExt, vec};

use zpm_formats::iter_ext::IterExt;
use zpm_parsers::JsonDocument;
use zpm_primitives::{Descriptor, FilterDescriptor, Locator, Reference};
use zpm_utils::{Path, PathError, System, ToHumanString};
use serde::{Deserialize, Serialize};
use serde_with::serde_as;

use crate::{
    build,
    error::Error,
    fetchers::PackageData,
    install::Install,
    project::Project,
    resolvers::Resolution,
};

#[derive(Debug, Default, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageMeta {
    #[serde(default, skip_serializing_if = "zpm_utils::is_default")]
    pub built: Option<bool>,

    #[serde(default, skip_serializing_if = "zpm_utils::is_default")]
    pub unplugged: Option<bool>,
}

#[serde_as]
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopLevelConfiguration {
    #[serde(default)]
    #[serde_as(as = "BTreeMap<_, _>")]
    dependencies_meta: Vec<(FilterDescriptor, PackageMeta)>,
}

impl TopLevelConfiguration {
    pub fn from_project(project: &Project) -> Vec<(FilterDescriptor, PackageMeta)> {
        project.manifest_path()
            .if_exists()
            .and_then(|path| path.fs_read_text().ok()).map(|data| JsonDocument::hydrate_from_str::<TopLevelConfiguration>(&data).unwrap().dependencies_meta)
            .unwrap_or_default()
    }
}

pub fn fs_remove_nm(nm_path: Path) -> Result<(), Error> {
    let entries = nm_path.fs_read_dir();

    match entries {
        Err(PathError::IoError {inner, ..}) if inner.kind() == std::io::ErrorKind::NotFound
            => Ok(()),

        Err(error)
            => Err(error.into()),

        Ok(entries) => {
            let mut has_dot_entries = false;

            for entry in entries.flatten() {
                let path
                    = Path::try_from(entry.path())?;

                let basename = path.basename()
                    .unwrap();

                if basename.starts_with(".") && basename != ".bin" && path.fs_is_dir() {
                    has_dot_entries = true;
                    continue;
                }

                path.fs_rm()
                    .unwrap();
            }

            if !has_dot_entries {
                nm_path.fs_rm()?;
            }

            Ok(())
        },
    }
}

pub fn fs_extract_archive(destination: &Path, package_data: &PackageData) -> Result<bool, Error> {
    fs_extract_archive_impl(destination, package_data, ExtractMode::Classic)
}

/// Same as [`fs_extract_archive`], but routes every extracted file
/// through a content-addressed index stored at `index_root`. Identical
/// file contents (across packages or projects) share one inode, and
/// modifications to any hardlinked copy are detected on the next install
/// and repaired in place — matching berry's pnpm content-addressed
/// store (PR yarnpkg/berry#4586).
pub fn fs_extract_archive_with_cas(destination: &Path, package_data: &PackageData, index_root: &Path) -> Result<bool, Error> {
    fs_extract_archive_impl(destination, package_data, ExtractMode::Cas { index_root })
}

/// Project-local dedup: like CAS but without a side-channel index
/// file. The first destination that asks for a given content is
/// written normally and stashed in `local_index`; later destinations
/// asking for the same hash are hardlinked to that first path
/// instead. That matches berry's `nmMode: hardlinks-local`, where the
/// inode count reflects only the on-disk consumers (no extra index
/// file to inflate it).
pub fn fs_extract_archive_with_local_dedup(
    destination: &Path,
    package_data: &PackageData,
    local_index: &mut BTreeMap<zpm_utils::Hash64, Path>,
) -> Result<bool, Error> {
    fs_extract_archive_impl(destination, package_data, ExtractMode::LocalDedup { local_index })
}

enum ExtractMode<'a> {
    Classic,
    Cas { index_root: &'a Path },
    LocalDedup { local_index: &'a mut BTreeMap<zpm_utils::Hash64, Path> },
}

fn fs_extract_archive_impl(destination: &Path, package_data: &PackageData, mut mode: ExtractMode<'_>) -> Result<bool, Error> {
    let ready_path = destination
        .with_join_str(".ready");

    let already_extracted = ready_path.fs_exists();

    // Without CAS, the .ready marker is enough — we trust the
    // extraction was correct and skip the (expensive) zip walk.
    // With CAS or local-dedup, we still re-walk so we can repair
    // any index entry whose mtime drifted from SAFE_TIME (CAS) or
    // re-hardlink any destination that's been overwritten in place.
    let skip_for_classic = matches!(mode, ExtractMode::Classic) && already_extracted;
    if skip_for_classic || matches!(package_data, &PackageData::MissingZip {..}) {
        return Ok(false);
    }

    let package_subpath
        = package_data.package_subpath();

    let package_bytes = match package_data {
        PackageData::Zip {archive_path, ..} => archive_path.fs_read()?,
        _ => panic!("Expected a zip archive"),
    };

    let entries
        = zpm_formats::zip::entries_from_zip(&package_bytes)?
            .into_iter()
            .strip_path_prefix(&package_subpath)
            .collect::<Vec<_>>();

    for entry in entries {
        let target_path = destination
            .with_join(&entry.name);

        target_path.fs_create_parent()?;

        match &mut mode {
            ExtractMode::Cas { index_root } => {
                link_into_cas(&target_path, &entry.data, entry.mode as u32, index_root)?;
            },
            ExtractMode::LocalDedup { local_index } => {
                link_into_local_index(&target_path, &entry.data, entry.mode as u32, local_index)?;
            },
            ExtractMode::Classic => {
                target_path
                    .fs_write(&entry.data)?
                    .fs_set_permissions(Permissions::from_mode(entry.mode as u32))?;
            },
        }
    }

    if !already_extracted {
        ready_path
            .fs_write(vec![])?;
    }

    Ok(!already_extracted)
}

fn link_into_local_index(
    target_path: &Path,
    data: &[u8],
    mode: u32,
    local_index: &mut BTreeMap<zpm_utils::Hash64, Path>,
) -> Result<(), Error> {
    use std::os::unix::fs::MetadataExt;

    let mode_bits = mode & 0o777;
    let hash = zpm_utils::Hash64::from_data(data);

    // First time we see this content: write it normally and stash
    // the location so siblings can hardlink to it later. We also
    // remember the path so we can short-circuit subsequent writes
    // even if they target a different folder.
    let Some(canonical_path) = local_index.get(&hash).cloned() else {
        if target_path.fs_exists() {
            target_path.fs_rm_file().ok();
        }
        target_path
            .fs_write(data)?
            .fs_set_permissions(Permissions::from_mode(mode_bits))?;
        local_index.insert(hash, target_path.clone());
        return Ok(());
    };

    // If the canonical path got blown away between installs (user
    // deleted node_modules, say), fall back to a fresh write at the
    // target and treat that as the new canonical copy.
    if !canonical_path.fs_exists() {
        if target_path.fs_exists() {
            target_path.fs_rm_file().ok();
        }
        target_path
            .fs_write(data)?
            .fs_set_permissions(Permissions::from_mode(mode_bits))?;
        local_index.insert(hash, target_path.clone());
        return Ok(());
    }

    // Skip the hardlink if the target already shares an inode with
    // the canonical path — repeated runs on an unchanged tree are
    // a no-op.
    let dest_meta = target_path.fs_symlink_metadata().ok();
    let canonical_meta = canonical_path.fs_metadata().ok();

    let already_linked = match (&dest_meta, &canonical_meta) {
        (Some(d), Some(c)) => d.dev() == c.dev() && d.ino() == c.ino(),
        _ => false,
    };

    if !already_linked {
        if target_path.fs_exists() {
            target_path.fs_rm_file().ok();
        }
        std::fs::hard_link(canonical_path.to_path_buf(), target_path.to_path_buf())
            .map_err(zpm_utils::PathError::from)?;
    }

    Ok(())
}

/// Time marker we set on every index entry so that a later
/// `os.stat().mtime != SAFE_TIME` reading flags the entry as having
/// been modified out-of-band — at which point we restore its contents
/// from the (still trusted) source zip.
const CAS_SAFE_TIME_SECS: i64 = 456_789_000;

const CAS_DEFAULT_MODE: u32 = 0o644;

fn link_into_cas(target_path: &Path, data: &[u8], mode: u32, index_root: &Path) -> Result<(), Error> {
    use sha1::{Digest, Sha1};
    use std::os::unix::fs::MetadataExt;

    let mode_bits = mode & 0o777;

    let hash = {
        let mut hasher = Sha1::new();
        hasher.update(data);
        hex::encode(hasher.finalize())
    };

    let index_filename = if mode_bits == CAS_DEFAULT_MODE {
        format!("{}.dat", hash)
    } else {
        format!("{}{:o}.dat", hash, mode_bits)
    };

    let index_dir = index_root
        .with_join_str(&hash[..2]);
    let index_path = index_dir
        .with_join_str(&index_filename);

    index_dir.fs_create_dir_all()?;

    let mut needs_rewrite = !index_path.fs_exists();

    if !needs_rewrite {
        // mtime invariant: a fresh index entry is stamped at
        // SAFE_TIME, so anything else means an external write since
        // the last install and we should restore the canonical
        // contents.
        if let Ok(metadata) = index_path.fs_metadata() {
            if metadata.mtime() != CAS_SAFE_TIME_SECS {
                needs_rewrite = true;
            }
        }
    }

    if needs_rewrite {
        if index_path.fs_exists() {
            // Truncate in place so existing hardlinks (other projects'
            // node_modules) inherit the repair without breaking their
            // inode identity.
            index_path.fs_write(data)?;
        } else {
            index_path.fs_write(data)?;
        }
        index_path.fs_set_permissions(Permissions::from_mode(mode_bits))?;
        set_safe_mtime(&index_path)?;
    }

    // Decide whether to link or skip: if the destination already
    // shares an inode with the index entry, there's nothing to do.
    let dest_meta = target_path.fs_symlink_metadata().ok();
    let index_meta = index_path.fs_metadata().ok();

    let already_linked = match (&dest_meta, &index_meta) {
        (Some(d), Some(i)) => d.dev() == i.dev() && d.ino() == i.ino(),
        _ => false,
    };

    if !already_linked {
        if target_path.fs_exists() {
            target_path.fs_rm_file().ok();
        }
        std::fs::hard_link(index_path.to_path_buf(), target_path.to_path_buf())
            .map_err(zpm_utils::PathError::from)?;
    }

    Ok(())
}

fn set_safe_mtime(path: &Path) -> Result<(), Error> {
    let safe_time = std::time::UNIX_EPOCH + std::time::Duration::from_secs(CAS_SAFE_TIME_SECS as u64);

    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(path.to_path_buf())
        .map_err(zpm_utils::PathError::from)?;
    file.set_modified(safe_time).map_err(zpm_utils::PathError::from)?;
    Ok(())
}

pub fn populate_build_entry_dependencies(package_build_entries: &BTreeMap<Locator, usize>, locator_resolutions: &BTreeMap<Locator, Resolution>, descriptor_to_locator: &BTreeMap<Descriptor, Locator>) -> Result<BTreeMap<usize, BTreeSet<usize>>, Error> {
    let mut package_build_dependencies
        = BTreeMap::new();

    for locator in package_build_entries.keys() {
        let mut build_dependencies
            = BTreeSet::new();

        let mut queue
            = vec![locator.clone()];
        let mut seen
            = BTreeSet::new();

        seen.insert(locator.clone());

        while let Some(locator) = queue.pop() {
            let resolution = locator_resolutions.get(&locator)
                .expect("Failed to find locator resolution");

            for dependency in resolution.dependencies.values() {
                let dependency_locator = descriptor_to_locator.get(dependency)
                    .expect("Failed to find dependency locator");

                if !seen.insert(dependency_locator.clone()) {
                    continue;
                }

                if let Some(dependency_entry_idx) = package_build_entries.get(dependency_locator) {
                    build_dependencies.insert(*dependency_entry_idx);
                }

                queue.push(dependency_locator.clone());
            }
        }

        let entry_idx = package_build_entries.get(locator)
            .expect("Failed to find build entry index");

        package_build_dependencies.insert(*entry_idx, build_dependencies);
    }

    Ok(package_build_dependencies)
}
pub struct PackageBuildInfo {
    pub must_extract: bool,
    pub build_commands: Option<Vec<build::Command>>,
}

pub fn get_package_internal_info(project: &Project, install: &Install, dependencies_meta: &Vec<(FilterDescriptor, PackageMeta)>, locator: &Locator, resolution: &Resolution, physical_package_data: &PackageData) -> PackageBuildInfo {
    // The package meta is based on the top-level configuration extracted
    // from the `dependenciesMeta` field.
    //
    let package_ident = match &locator.reference {
        Reference::Registry(params) => &params.ident,
        _ => &locator.ident,
    };

    let package_meta
        = dependencies_meta.iter()
            .find(|(selector, _)| selector.check(package_ident, &resolution.version))
            .map(|(_, meta)| meta)
            .cloned()
            .unwrap_or_default();

    // The package flags are based on the actual package content. The flags
    // should always be the same for the same package, so we keep them in
    // the install state so we don't have to recompute them at every install.
    //
    let package_flags = &install.install_state.content_flags
        .get(&locator.physical_locator())
        .expect("Expected package flags to be set");

    // We don't take into account `is_compatible` here, as it may change
    // depending on the system and we don't want the paths encoded in the
    // .pnp.cjs file to change depending on the system.
    let has_build_commands = package_flags.build_commands.len() > 0;
    let scripts_allowed_by_meta = package_meta.built.unwrap_or(project.config.settings.enable_scripts.value);
    let should_build_if_compatible
        = has_build_commands
            && (locator.reference.is_workspace_reference() || scripts_allowed_by_meta);

    if has_build_commands && !locator.reference.is_workspace_reference() && !scripts_allowed_by_meta {
        if let Some(report_guard) = crate::report::try_current_report() {
            if let Some(report) = report_guard.as_ref() {
                if package_meta.built == Some(false) {
                    report.info(format!(
                        "[YN0005] {} lists build scripts, but its build has been explicitly disabled through configuration.",
                        locator.to_print_string(),
                    ));
                } else {
                    report.warn(format!(
                        "[YN0004] {} lists build scripts, but its build has been explicitly disabled through configuration.",
                        locator.to_print_string(),
                    ));
                }
            }
        }
    }

    // Optional dependencies baked by zip archives are always extracted,
    // as we have no way to know whether they would be extracted if we
    // were to download them (this may change depending on the package's
    // files).
    let is_optional
        = install.install_state.resolution_tree.optional_builds.contains(locator);

    let is_baked_by_zip
        = matches!(physical_package_data, PackageData::Zip {..} | PackageData::MissingZip {..});

    let must_extract =
        (is_optional && is_baked_by_zip) || package_meta.unplugged.or(package_flags.prefer_extracted)
            .unwrap_or_else(|| should_build_if_compatible || package_flags.suggest_extracted);

    // We don't need to run the build if the package was marked as
    // incompatible with the current system (even if the package isn't
    // marked as optional).
    let is_compatible = resolution.requirements
        .validate_system(&System::from_current());

    let must_build
        = should_build_if_compatible && is_compatible;

    let build_commands
        = must_build.then_some(package_flags.build_commands.clone());

    PackageBuildInfo {
        must_extract,
        build_commands,
    }
}
