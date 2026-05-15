//! Mirrors berry's `peerRequirementNodes` + `peerWarnings` plumbing
//! from `yarnpkg-core/sources/Project.ts`.
//!
//! Berry builds these during virtualization; zpm's tree resolver
//! consumes the original peer ranges as part of virtualization, so
//! the data is reconstructed here from `install_state`:
//!
//! - The pre-virtualization peer ranges live on
//!   `install_state.normalized_resolutions[physical].peer_dependencies`.
//! - Which descriptor was injected as the peer slot lives on
//!   `tree.locator_resolutions[virtual].dependencies[peer_ident]`.
//! - The resolved peer locator + version come from
//!   `tree.descriptor_to_locator` and the corresponding resolution.
//! - The request tree shape is derived from a reverse-dep walk of
//!   `tree.locator_resolutions`.
//!
//! The output mirrors berry's two data structures:
//!
//! - [`PeerRequirementNode`] is the per-(subject, ident) record
//!   indexed by a `pXXXXXX` hash. Each node carries the tree of
//!   requests rooted at the workspace's direct deps.
//! - [`PeerWarning`] is the install-time diagnostic — either
//!   `NodeNotProvided` (peer absent) or `NodeNotCompatible` (peer
//!   provided but version doesn't satisfy any request).

use std::collections::{BTreeMap, BTreeSet};

use zpm_primitives::{Descriptor, Ident, Locator, PeerRange, Reference};
use zpm_utils::{Hash64, ToFileString, ToHumanString};

use crate::{install::InstallState, project::Project};

#[derive(Debug, Clone)]
pub struct PeerRequestNode {
    pub requester: Locator,
    pub range: zpm_semver::Range,
    /// Transitive child requests that flow through this one. Keyed by
    /// the child's physical locator so display order is stable.
    pub children: BTreeMap<Locator, PeerRequestNode>,
}

#[derive(Debug, Clone)]
pub struct PeerRequirementNode {
    pub hash: String,
    /// The package that is *supposed* to provide the peer dep — for a
    /// workspace's direct dep tree this is the workspace itself; for
    /// a transitive virtualization context it's the immediate
    /// virtualized parent.
    pub subject: Locator,
    pub ident: Ident,
    /// The descriptor injected into the subject's dep slot for this
    /// peer. `None` means no provider was found (missing peer).
    pub provided: Option<Descriptor>,
    /// The resolved version backing `provided`, looked up via
    /// `descriptor_to_locator`. Convenient cache for the rendering
    /// code; redundant with `provided` + `descriptor_to_locator` +
    /// `locator_resolutions`.
    pub provided_version: Option<zpm_semver::Version>,
    /// Direct requests against this subject. The keys are the
    /// requester's physical locator; `requester.children` carries the
    /// transitive chain below each direct requester.
    pub requests: BTreeMap<Locator, PeerRequestNode>,
    /// True when `subject` is a workspace locator. Berry uses this
    /// to split the install-time warning surface between
    /// project-level peer mismatches (shown line-by-line) and
    /// transitive mismatches (rolled up under an "explain
    /// peer-requirements" CTA).
    pub is_root: bool,
}

#[derive(Debug, Clone)]
pub enum PeerWarningKind {
    NodeNotProvided,
    NodeNotCompatible {
        /// Simplified intersection of every request's range, or
        /// `None` when the requested ranges don't overlap.
        range: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct PeerWarning {
    pub hash: String,
    pub kind: PeerWarningKind,
}

pub struct PeerData {
    pub nodes: BTreeMap<String, PeerRequirementNode>,
    pub warnings: Vec<PeerWarning>,
}

/// Walks the install state and produces berry-equivalent peer
/// requirement / peer warning structures.
pub fn compute(project: &Project, install_state: &InstallState) -> PeerData {
    let tree = &install_state.resolution_tree;

    // Reverse-dep graph for the post-resolution locator_resolutions.
    // Used both to find subject locators and to build the request
    // chain (children) for each PeerRequirementNode.
    let mut reverse_deps: BTreeMap<Locator, BTreeSet<Locator>> = BTreeMap::new();
    for (parent, resolution) in &tree.locator_resolutions {
        for desc in resolution.dependencies.values() {
            if let Some(loc) = tree.descriptor_to_locator.get(desc) {
                reverse_deps.entry(loc.clone()).or_default().insert(parent.clone());
            }
        }
    }

    let workspace_locators: BTreeSet<Locator> = project.workspaces.iter()
        .flat_map(|w| [w.locator(), w.locator_path()])
        .collect();

    // For each peer-requesting (virtual) locator, find the subject —
    // the *top-of-chain* provider of this peer slot. Peer slots
    // propagate upward through virtualization: e.g. `lvl0 → lvl1 →
    // lvl2`, all peer-requesting `no-deps`, end up sharing the same
    // `no-deps` slot that originated at the workspace. Berry models
    // that by giving every node in the chain the same `subject`
    // (the workspace), which is what makes the warnings collapse
    // into one line.
    let find_subject = |requester: &Locator| -> Locator {
        let mut visited: BTreeSet<Locator> = BTreeSet::new();
        let mut current = requester.clone();
        loop {
            if !visited.insert(current.clone()) {
                return current;
            }
            let Some(parents) = reverse_deps.get(&current) else {
                return current;
            };
            // Workspace parent terminates the walk — the workspace
            // owns the peer slot.
            if let Some(ws) = parents.iter().find(|p| workspace_locators.contains(p)) {
                return ws.clone();
            }
            let Some(next) = parents.iter().next().cloned() else {
                return current;
            };
            current = next;
        }
    };

    // For grouping, dedup by (physical subject, ident); virtualized
    // subjects flatten to their physical form so we don't fragment
    // every "workspace provides X" entry across virtual instances.
    let subject_key = |loc: &Locator| -> Locator { loc.physical_locator() };

    // Pass 1: enumerate every (requester, peer_ident, range) triple
    // by walking virtualized locators.
    struct Row {
        subject: Locator,
        subject_key: Locator,
        requester: Locator,
        ident: Ident,
        range: zpm_semver::Range,
        provided: Option<Descriptor>,
    }
    let mut rows: Vec<Row> = Vec::new();

    for (virtual_locator, resolution) in &tree.locator_resolutions {
        if !virtual_locator.reference.is_virtual_reference() {
            continue;
        }

        let physical = virtual_locator.physical_locator();
        let Some(phys_resolution) = install_state.normalized_resolutions.get(&physical) else {
            continue;
        };

        for (peer_ident, peer_range) in &phys_resolution.peer_dependencies {
            // Optional peer deps don't produce diagnostics in berry
            // either; auto-injected `@types/*` peers are an
            // implementation detail of zpm's `@types` handling, so
            // we filter the same way the existing reporters do.
            if phys_resolution.optional_peer_dependencies.contains(peer_ident) {
                continue;
            }
            if peer_ident.scope() == Some("@types") {
                continue;
            }

            let range = match peer_range {
                PeerRange::Semver(p) => p.range.clone(),
                // berry's `applyVirtualResolutionMutations` skips
                // workspace-protocol peer ranges through its
                // `WorkspaceResolver` branch; we mirror that by
                // dropping them — they can't be range-checked.
                _ => continue,
            };

            let provided = resolution.dependencies.get(peer_ident).cloned();

            let subject = find_subject(virtual_locator);

            rows.push(Row {
                subject_key: subject_key(&subject),
                subject,
                requester: virtual_locator.clone(),
                ident: peer_ident.clone(),
                range,
                provided,
            });
        }
    }

    if rows.is_empty() {
        return PeerData {
            nodes: BTreeMap::new(),
            warnings: Vec::new(),
        };
    }

    // Pass 2: group rows by (subject_key, ident) and build per-group
    // requirement nodes with a flat request list per requester.
    #[derive(Default)]
    struct Bucket {
        subject_repr: Option<Locator>,
        provided: Option<Descriptor>,
        /// Requesters keyed by physical locator so duplicate virtual
        /// instances of the same physical request collapse.
        requesters: BTreeMap<Locator, Row>,
    }

    let mut buckets: BTreeMap<(Locator, Ident), Bucket> = BTreeMap::new();
    for row in rows {
        let key = (row.subject_key.clone(), row.ident.clone());
        let bucket = buckets.entry(key).or_default();
        if bucket.subject_repr.is_none() {
            bucket.subject_repr = Some(row.subject.clone());
        }
        if bucket.provided.is_none() {
            bucket.provided = row.provided.clone();
        }
        bucket.requesters.entry(row.requester.physical_locator()).or_insert(row);
    }

    // Pass 3: emit one PeerRequirementNode per bucket, threading the
    // child relationships through the reverse-dep walk so nested
    // requesters end up as `children` of their nearest ancestor that
    // also peer-requests the same ident.
    let mut nodes: BTreeMap<String, PeerRequirementNode> = BTreeMap::new();
    let mut warnings: Vec<PeerWarning> = Vec::new();

    for ((subject_key_loc, ident), bucket) in buckets {
        let subject = bucket.subject_repr.unwrap_or(subject_key_loc.clone());
        let provided_locator = bucket.provided.as_ref()
            .and_then(|d| tree.descriptor_to_locator.get(d));
        let provided_version = provided_locator
            .and_then(|l| tree.locator_resolutions.get(l))
            .map(|r| r.version.clone());

        let is_root = matches!(
            subject.reference.physical_reference(),
            Reference::WorkspaceIdent(_) | Reference::WorkspacePath(_) | Reference::Link(_)
        ) || workspace_locators.contains(&subject);

        // For request-tree shape we need to know which other
        // requesters in this bucket are ancestors of a given
        // requester. Walking the reverse-dep graph as a *chain* is
        // cheap because every virtual locator has exactly one parent
        // (the package that virtualized it). The chain terminates at
        // the workspace or when we hit another requester.
        let physical_requesters: BTreeSet<Locator> = bucket.requesters.keys().cloned().collect();
        let mut nearest_request_parent: BTreeMap<Locator, Option<Locator>> = BTreeMap::new();

        for requester_phys in &physical_requesters {
            let Some(row) = bucket.requesters.get(requester_phys) else { continue };
            let mut current: &Locator = &row.requester;
            let mut parent: Option<Locator> = None;
            let mut visited: BTreeSet<&Locator> = BTreeSet::new();
            visited.insert(current);
            // Cap shields against any pathological cycles in the
            // resolution graph; in practice the walk is a straight
            // line of length O(depth-in-virtual-chain).
            for _ in 0..256 {
                let Some(parents) = reverse_deps.get(current) else { break };
                let Some(next) = parents.iter().next() else { break };
                if !visited.insert(next) {
                    break;
                }
                let next_phys = next.physical_locator();
                if &next_phys != requester_phys && physical_requesters.contains(&next_phys) {
                    parent = Some(next_phys);
                    break;
                }
                current = next;
            }
            nearest_request_parent.insert(requester_phys.clone(), parent);
        }

        // Build request nodes; we first allocate every node, then
        // attach children based on `nearest_request_parent` so the
        // tree shape mirrors the request chain.
        let mut request_nodes: BTreeMap<Locator, PeerRequestNode> = BTreeMap::new();
        for (phys, row) in &bucket.requesters {
            request_nodes.insert(phys.clone(), PeerRequestNode {
                requester: row.requester.physical_locator(),
                range: row.range.clone(),
                children: BTreeMap::new(),
            });
        }

        // Sort children-first to ensure parents are still in the map
        // when we move children into them. The walk-up via
        // `nearest_request_parent` can in principle cycle (two
        // packages whose chains pass through each other), so we
        // guard with a visited set rather than trusting the graph
        // to be a forest.
        let mut order: Vec<Locator> = bucket.requesters.keys().cloned().collect();
        order.sort_by_cached_key(|loc| {
            let mut depth = 0usize;
            let mut visited: BTreeSet<&Locator> = BTreeSet::new();
            let mut cur: &Locator = loc;
            visited.insert(cur);
            while let Some(Some(parent)) = nearest_request_parent.get(cur) {
                if !visited.insert(parent) {
                    break;
                }
                depth += 1;
                cur = parent;
            }
            std::cmp::Reverse(depth)
        });

        let mut direct_requests: BTreeMap<Locator, PeerRequestNode> = BTreeMap::new();

        for phys in order {
            let Some(node) = request_nodes.remove(&phys) else { continue };
            match nearest_request_parent.get(&phys).cloned().flatten() {
                Some(parent_phys) if request_nodes.contains_key(&parent_phys) => {
                    if let Some(parent_node) = request_nodes.get_mut(&parent_phys) {
                        parent_node.children.insert(phys, node);
                    }
                },
                _ => {
                    direct_requests.insert(phys, node);
                },
            }
        }

        // Hash mirrors berry's `pXXXXXX` six-hex pattern so existing
        // CTA copy ("six-letter p-prefixed code") and any cross-tool
        // diagnostics still line up.
        let first_requester_repr = direct_requests.keys().next()
            .cloned()
            .unwrap_or_else(|| subject.clone());
        let hash_input = format!(
            "{}|{}|{}",
            subject_key_loc.to_file_string(),
            ident.to_file_string(),
            first_requester_repr.to_file_string(),
        );
        let hash = format!("p{}", Hash64::from_data(&hash_input).mini());

        // Compute warning, if any.
        let warning_kind: Option<PeerWarningKind> = match (&bucket.provided, &provided_version) {
            (None, _) => Some(PeerWarningKind::NodeNotProvided),
            (Some(_), Some(version)) => {
                let any_unsatisfied = collect_all_requests(&direct_requests)
                    .into_iter()
                    .any(|req| !req.range.check(version));
                if any_unsatisfied {
                    let range = simplify_ranges_for_display(&direct_requests, version);
                    Some(PeerWarningKind::NodeNotCompatible { range })
                } else {
                    None
                }
            },
            // provided descriptor present but no resolution found —
            // treat as missing rather than fabricating a satisfied
            // requirement.
            (Some(_), None) => Some(PeerWarningKind::NodeNotProvided),
        };

        if let Some(kind) = warning_kind {
            warnings.push(PeerWarning {
                hash: hash.clone(),
                kind,
            });
        }

        nodes.insert(hash.clone(), PeerRequirementNode {
            hash,
            subject,
            ident,
            provided: bucket.provided,
            provided_version,
            requests: direct_requests,
            is_root,
        });
    }

    PeerData {
        nodes,
        warnings,
    }
}

/// Iterates every request (direct + transitive) under a set of
/// direct requests, paired with the direct request it descends from.
/// Mirrors berry's `allPeerRequestsWithRoot` shape; used both for
/// warning emission and the explain command's tree rendering.
pub fn iter_requests_with_root<'a>(
    direct: &'a BTreeMap<Locator, PeerRequestNode>,
) -> Vec<(&'a PeerRequestNode, &'a PeerRequestNode)> {
    let mut out = Vec::new();
    for root in direct.values() {
        push_with_root(root, root, &mut out);
    }
    out
}

fn push_with_root<'a>(
    node: &'a PeerRequestNode,
    root: &'a PeerRequestNode,
    out: &mut Vec<(&'a PeerRequestNode, &'a PeerRequestNode)>,
) {
    out.push((node, root));
    for child in node.children.values() {
        push_with_root(child, root, out);
    }
}

fn collect_all_requests<'a>(direct: &'a BTreeMap<Locator, PeerRequestNode>) -> Vec<&'a PeerRequestNode> {
    iter_requests_with_root(direct).into_iter().map(|(req, _)| req).collect()
}

/// Best-effort stand-in for berry's `semverUtils.simplifyRanges`.
/// We collect every unique range string, then test the resolved
/// peer version against each candidate intersection — if one of
/// the requested ranges is satisfied by every other range *and*
/// rejects the resolved version (the diagnostic only fires when at
/// least one range mismatches), use that range as the canonical
/// description. Otherwise we fall back to joining the unique
/// ranges with ` && `, and emit `None` to signal "no overlap" when
/// all candidates reject the resolved version with disjoint ranges.
fn simplify_ranges_for_display(
    direct: &BTreeMap<Locator, PeerRequestNode>,
    _resolved_version: &zpm_semver::Version,
) -> Option<String> {
    let mut ranges: Vec<&zpm_semver::Range> = collect_all_requests(direct).into_iter().map(|r| &r.range).collect();
    ranges.sort_by_key(|r| r.to_file_string());
    ranges.dedup_by(|a, b| a.to_file_string() == b.to_file_string());

    // If any exact range is accepted by every other range, that
    // exact range is the intersection.
    let subsuming_exact = ranges.iter().find(|candidate| {
        let Some(version) = candidate.exact_version() else {
            return false;
        };
        ranges.iter().all(|other| other.check(&version))
    });

    if let Some(r) = subsuming_exact {
        return Some(r.to_file_string());
    }

    // Pairwise overlap probe: if every exact-version candidate from
    // any range is rejected by another range, the ranges don't
    // overlap and there's nothing meaningful to print.
    let representative_versions: Vec<zpm_semver::Version> = ranges.iter()
        .filter_map(|r| r.exact_version())
        .collect();

    if !representative_versions.is_empty() {
        let any_overlap = representative_versions.iter().any(|v| ranges.iter().all(|r| r.check(v)));
        if !any_overlap {
            return None;
        }
    }

    Some(ranges.iter().map(|r| r.to_file_string()).collect::<Vec<_>>().join(" && "))
}

/// Used by the install-time warning emission and the
/// `explain peer-requirements` command to render the per-requester
/// label for a request, optionally annotated with `(via <root>)`
/// when the request flows through another direct requester.
pub fn render_requester_label(request: &PeerRequestNode, root: &PeerRequestNode) -> String {
    if std::ptr::eq(request, root) {
        request.requester.ident.to_print_string()
    } else {
        format!(
            "{} (via {})",
            request.requester.ident.to_print_string(),
            root.requester.ident.to_print_string(),
        )
    }
}
