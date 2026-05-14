use std::collections::{BTreeMap, BTreeSet};

use zpm_primitives::{Descriptor, Ident, Range};

use crate::project::{Project, Workspace};

/// How a descriptor relates to a candidate workspace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceMatch {
    /// The descriptor points at the workspace and the range is compatible.
    Matches,
    /// The descriptor points at the workspace but the version doesn't satisfy.
    Mismatch,
    /// The descriptor doesn't point at this workspace at all.
    Unrelated,
}

impl Project {
    /// Returns the workspaces that declare `ident` as a direct dependency
    /// (any hard kind, plus peerDependencies). Order matches declaration
    /// order across workspaces; duplicates are deduped via a set.
    pub fn workspaces_depending_on(&self, ident: &Ident) -> Vec<&Ident> {
        let mut out = Vec::new();
        let mut seen = BTreeSet::new();

        for workspace in &self.workspaces {
            let mut depends = false;

            for hard in workspace.manifest.iter_hard_dependencies() {
                if hard.ident == ident {
                    depends = true;
                    break;
                }
            }

            if !depends {
                for peer in workspace.manifest.iter_peer_dependencies() {
                    if peer.ident == ident {
                        depends = true;
                        break;
                    }
                }
            }

            if depends && seen.insert(&workspace.name) {
                out.push(&workspace.name);
            }
        }

        out
    }

    /// BFS from `roots` over the workspace dep graph (hard + peer), returning
    /// every workspace ident reachable as a dependent (including the roots).
    pub fn workspaces_with_dependents(&self, roots: &BTreeSet<Ident>) -> BTreeSet<Ident> {
        let dependent_map = self.build_workspace_dependent_map();

        let mut seen = roots.clone();
        let mut queue: Vec<Ident> = roots.iter().cloned().collect();

        while let Some(next) = queue.pop() {
            let Some(dependents) = dependent_map.get(&next) else {
                continue;
            };

            for dependent in dependents {
                if seen.insert(dependent.clone()) {
                    queue.push(dependent.clone());
                }
            }
        }

        seen
    }

    /// `Ident → workspaces that depend on it (any hard or peer dep, only
    /// considering deps that target a workspace ident)`. Cached form of the
    /// "reverse workspace edges" map.
    pub fn build_workspace_dependent_map(&self) -> BTreeMap<Ident, BTreeSet<Ident>> {
        let workspace_idents: BTreeSet<&Ident> = self.workspaces.iter()
            .map(|w| &w.name)
            .collect();

        let mut map: BTreeMap<Ident, BTreeSet<Ident>> = BTreeMap::new();

        for workspace in &self.workspaces {
            for hard in workspace.manifest.iter_hard_dependencies() {
                if workspace_idents.contains(hard.ident) {
                    map.entry(hard.ident.clone())
                        .or_default()
                        .insert(workspace.name.clone());
                }
            }

            for peer in workspace.manifest.iter_peer_dependencies() {
                if workspace_idents.contains(peer.ident) {
                    map.entry(peer.ident.clone())
                        .or_default()
                        .insert(workspace.name.clone());
                }
            }
        }

        map
    }

    /// Classifies whether `descriptor` resolves to `target` and, if so,
    /// whether the range satisfies the workspace's manifest version.
    /// Mirrors the workspaces-list `-v` classifier.
    pub fn workspace_satisfies(&self, target: &Workspace, descriptor: &Descriptor) -> WorkspaceMatch {
        if &descriptor.ident != &target.name {
            return WorkspaceMatch::Unrelated;
        }

        let target_version = target.manifest.remote.version.as_ref();

        let satisfies = match &descriptor.range {
            Range::WorkspaceMagic(_) => true,
            Range::WorkspacePath(_) => true,
            Range::WorkspaceIdent(_) => true,
            Range::WorkspaceSemver(params) => {
                target_version.map_or(true, |v| params.range.check(v))
            },
            Range::AnonymousSemver(params) => {
                target_version.map_or(true, |v| params.range.check(v))
            },
            Range::RegistrySemver(params) => {
                target_version.map_or(true, |v| params.range.check(v))
            },
            _ => return WorkspaceMatch::Unrelated,
        };

        if satisfies {
            WorkspaceMatch::Matches
        } else {
            WorkspaceMatch::Mismatch
        }
    }
}
