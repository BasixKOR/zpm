use std::collections::BTreeMap;

use rkyv::Archive;
use serde_with::serde_as;
use zpm_utils::RawPath;
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
    pub fn paths(&self) -> Box<dyn Iterator<Item = &str> + '_> {
        match self {
            BrowserField::String(path)
                => Box::new(std::iter::once(path.path.as_str())),

            BrowserField::Map(map)
                => Box::new(map.iter().flat_map(|(key, entry)| {
                    let extra = if let BrowserFieldEntry::Path(path) = entry {
                        Some(path.path.as_str())
                    } else {
                        None
                    };

                    std::iter::once(key.as_str()).chain(extra)
                })),
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
