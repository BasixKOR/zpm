use zpm_macro_enum::zpm_enum;

use crate::{
    DescriptorError,
    IdentGlob, Locator, Reference,
};

#[zpm_enum(error = DescriptorError, or_else = |s| Err(DescriptorError::SyntaxError(s.to_string())))]
#[derive(Debug, Clone,)]
#[derive_variants(Debug, Clone)]
pub enum ReferenceFilter {
    #[pattern("(?<ident>@?[^@]+)")]
    #[to_file_string(|params| params.ident.to_file_string())]
    #[to_print_string(|params| params.ident.to_print_string())]
    Ident {
        ident: IdentGlob,
    },

    #[pattern("(?<ident>@?[^@]+)@(?<reference>.*)")]
    #[to_file_string(|params| format!("{}@{}", params.ident.to_file_string(), params.reference.to_file_string()))]
    #[to_print_string(|params| format!("{}@{}", params.ident.to_print_string(), params.reference.to_print_string()))]
    Pinned {
        ident: IdentGlob,
        reference: Reference,
    },
}

impl ReferenceFilter {
    pub fn check(&self, locator: &Locator) -> bool {
        match self {
            ReferenceFilter::Ident(params) => {
                params.ident.check(&locator.ident)
            },

            ReferenceFilter::Pinned(params) => {
                params.ident.check(&locator.ident) && params.reference == locator.reference
            },
        }
    }
}
