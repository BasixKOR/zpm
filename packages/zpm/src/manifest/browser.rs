use std::collections::BTreeMap;

use rkyv::Archive;
use serde_with::serde_as;
use zpm_utils::{Path, RawPath};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Archive, rkyv::Serialize, rkyv::Deserialize)]
#[serde(untagged)]
pub enum BrowserFieldEntry {
    Ignore(bool),
    Path(RawPath),
}

#[serde_as]
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Archive, rkyv::Serialize, rkyv::Deserialize)]
#[serde(untagged)]
pub enum BrowserField {
    String(RawPath),
    Map(BTreeMap<String, BrowserFieldEntry>),
}

impl BrowserField {
    pub fn paths(&self) -> impl Iterator<Item = String> {
        match self {
            BrowserField::String(path)
                => vec![path.path.as_str().to_string()].into_iter(),

            BrowserField::Map(map)
                => map.iter()
                    .flat_map(|(key, entry)| {
                        let mut paths = vec![key.clone()];
                        if let BrowserFieldEntry::Path(path) = entry {
                            paths.push(path.path.as_str().to_string());
                        }
                        paths
                    })
                    .collect::<Vec<_>>()
                    .into_iter(),
        }
    }
}

impl Iterator for BrowserField {
    type Item = (String, bool);

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            BrowserField::String(_)
                => None,

            BrowserField::Map(map)
                => map.iter()
                    .next()
                    .map(|(k, v)| (k.clone(), match v {
                        BrowserFieldEntry::Ignore(ignore) => *ignore,
                        BrowserFieldEntry::Path(_) => false,
                    })),
        }
    }
}
