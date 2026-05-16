use std::collections::BTreeMap;

use zpm_utils::{Glob, Hash64, Hash64Writer, Path, ToFileString};

use crate::error::Error;

/// Hashes the paths matched by an `immutablePatterns` entry so
/// install can compare before/after and raise YN0036 on drift.
/// Files hash to their content; directories hash to a deterministic
/// digest of their tree, with `.git`/`.yarn` at the project root
/// excluded.
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
            // Subtree folded into one entry; don't double-count it.
            continue;
        }

        if !metadata.is_dir() {
            continue;
        }

        for entry in abs.fs_read_dir()? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip git history and zpm's scratch space at the root —
            // they churn for unrelated reasons.
            if rel.is_empty() && matches!(name.as_str(), ".git" | ".yarn") {
                continue;
            }
            stack.push(rel.with_join_str(&name));
        }
    }

    // Deterministic "missing" marker so create/delete shows as drift.
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
