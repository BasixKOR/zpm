use std::collections::BTreeMap;

use zpm_utils::{Glob, Hash64, Hash64Writer, Path, ToFileString};

use crate::error::Error;

/// Hash whatever the user has pinned via `immutablePatterns` so the
/// install command can compare before/after and fail with YN0036 if a
/// pinned path moved.
///
/// Matched files contribute their content; matched directories
/// contribute a deterministic hash of every file inside (skipping
/// `.git` and `.yarn` at the project root so we don't drown in cache
/// contents the user never put under that pattern's purview anyway).
pub fn snapshot_pattern(project_cwd: &Path, pattern: &Glob) -> Result<Hash64, Error> {
    let mut entries: BTreeMap<String, Hash64> = BTreeMap::new();
    let mut stack: Vec<Path> = vec![Path::new()];

    while let Some(rel) = stack.pop() {
        let abs = project_cwd.with_join(&rel);
        let Ok(metadata) = abs.fs_symlink_metadata() else {
            continue;
        };

        let rel_str = rel.to_file_string();

        if !rel_str.is_empty() && pattern.is_match(&rel_str) {
            let content_hash = if metadata.is_dir() {
                hash_dir_tree(&abs)?
            } else if metadata.is_file() {
                Hash64::from_data(&abs.fs_read()?)
            } else {
                Hash64::from_data(&[])
            };
            entries.insert(rel_str, content_hash);
            // We've folded the entire subtree into one entry — don't
            // also walk into it, that would double-count.
            continue;
        }

        if !metadata.is_dir() {
            continue;
        }

        for entry in abs.fs_read_dir()? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            // We never want immutablePatterns to surf into the
            // user's git history or zpm's own scratch space —
            // those churn for unrelated reasons.
            if rel.is_empty() && matches!(name.as_str(), ".git" | ".yarn") {
                continue;
            }
            stack.push(rel.with_join_str(&name));
        }
    }

    // Record "missing" patterns deterministically so create/delete
    // counts as a change.
    if entries.is_empty() {
        return Ok(Hash64::from_data(b"<missing>"));
    }

    let mut writer = Hash64Writer::new();
    for (path, hash) in entries {
        writer.update(path.as_bytes());
        writer.update([0u8]);
        writer.update(hash.to_file_string().as_bytes());
    }
    Ok(writer.finalize())
}

fn hash_dir_tree(dir: &Path) -> Result<Hash64, Error> {
    let mut entries: BTreeMap<String, Hash64> = BTreeMap::new();
    let mut stack: Vec<Path> = vec![Path::new()];

    while let Some(rel) = stack.pop() {
        let abs = dir.with_join(&rel);
        let Ok(metadata) = abs.fs_symlink_metadata() else {
            continue;
        };

        if metadata.is_dir() {
            for entry in abs.fs_read_dir()? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                stack.push(rel.with_join_str(&name));
            }
        } else if metadata.is_file() {
            let data = abs.fs_read()?;
            entries.insert(rel.to_file_string(), Hash64::from_data(&data));
        } else if metadata.is_symlink() {
            let target = abs.fs_read_link()?;
            entries.insert(rel.to_file_string(), Hash64::from_data(target.as_str().as_bytes()));
        }
    }

    let mut writer = Hash64Writer::new();
    for (path, hash) in entries {
        writer.update(path.as_bytes());
        writer.update([0u8]);
        writer.update(hash.to_file_string().as_bytes());
    }
    Ok(writer.finalize())
}
