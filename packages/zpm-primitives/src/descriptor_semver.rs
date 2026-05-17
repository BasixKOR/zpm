use colored::Colorize;
use zpm_utils::{impl_file_string_from_str, impl_file_string_serialization, FromFileString, ToFileString, ToHumanString};

use crate::{DescriptorError, RangeError};

use super::{Ident, split_ident_and_selector};

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SemverDescriptor {
    pub ident: Ident,
    pub range: zpm_semver::Range,
}

impl SemverDescriptor {
    pub fn new(ident: Ident, range: zpm_semver::Range) -> SemverDescriptor {
        SemverDescriptor {
            ident,
            range,
        }
    }
}

impl FromFileString for SemverDescriptor {
    type Error = DescriptorError;

    fn from_file_string(src: &str) -> Result<Self, Self::Error> {
        let (ident_str, range_str) = split_ident_and_selector(src);
        let range_str = range_str
            .ok_or_else(|| DescriptorError::SyntaxError(src.to_string()))?;

        let ident
            = Ident::from_file_string(ident_str)?;

        let range
            = zpm_semver::Range::from_file_string(range_str)
                .map_err(|err| -> RangeError {err.into()})?;

        Ok(SemverDescriptor::new(ident, range))
    }
}

impl ToFileString for SemverDescriptor {
    fn to_file_string(&self) -> String {
        format!("{}@{}", self.ident.to_file_string(), self.range.to_file_string())
    }
}

impl ToHumanString for SemverDescriptor {
    fn to_print_string(&self) -> String {
        format!("{}{}{}",
            self.ident.to_print_string(),
            "@".truecolor(0, 175, 175),
            self.range.to_print_string()
        )
    }
}

impl_file_string_from_str!(SemverDescriptor);
impl_file_string_serialization!(SemverDescriptor);
