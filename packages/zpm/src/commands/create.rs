use std::process::ExitStatus;

use clipanion::cli;
use zpm_primitives::{split_ident_and_selector, AnonymousSemverRange, Descriptor, Ident, Range, RegistryTagRange};
use zpm_semver::RangeKind;
use zpm_utils::{FromFileString, Path, ToFileString};

use crate::{
    commands::dlx,
    descriptor_loose::{self, DescriptorLooseDescriptor, IdentLooseDescriptor, LooseDescriptor},
    error::Error,
    install::InstallContext,
};

/// Create a new package from a starter kit
///
/// This command will use `dlx` to fetch a package referenced as `create-<name>` (or `@<scope>/create-<name>` for scoped packages), then run its bin.
///
/// For example:
///
///   - `yarn create react-app`  →  `yarn dlx create-react-app`
///   - `yarn create @scope/app` →  `yarn dlx @scope/create-app`
///
#[cli::command(proxy)]
#[cli::path("create")]
#[cli::category("Scripting commands")]
pub struct Create {
    /// Suppress the install unless it errors
    #[cli::option("-q,--quiet", default = false)]
    quiet: bool,

    /// Name of the starter kit (e.g. `react-app`, `@scope/app`)
    starter: String,

    /// Arguments to pass to the starter kit's binary
    args: Vec<String>,
}

impl Create {
    pub async fn execute(&self) -> Result<ExitStatus, Error> {
        let (initializer_ident, range_part) = rewrite_starter(&self.starter)?;

        let parsed_range = range_part.as_deref().map(parse_range);

        let descriptor_print
            = format!(
                "{}@{}",
                initializer_ident.to_file_string(),
                parsed_range
                    .as_ref()
                    .map(|range| range.to_file_string())
                    .unwrap_or_else(|| "unknown".to_string()),
            );

        println!("➤ YN0000: Installing {}...", descriptor_print);

        let loose_descriptor = match parsed_range {
            Some(range) => LooseDescriptor::Descriptor(DescriptorLooseDescriptor {
                descriptor: Descriptor::new(initializer_ident.clone(), range),
            }),
            None => LooseDescriptor::Ident(IdentLooseDescriptor {
                ident: initializer_ident.clone(),
            }),
        };

        let dlx_project
            = dlx::setup_project().await?;

        let package_cache
            = dlx_project.package_cache()?;

        let install_context = InstallContext::default()
            .with_package_cache(Some(&package_cache))
            .with_project(Some(&dlx_project));

        let resolve_options = descriptor_loose::ResolveOptions {
            active_workspace_ident: dlx_project.active_workspace()?.name.clone(),
            range_kind: RangeKind::Exact,
            resolve_tags: true,
            allow_reuse: true,
        };

        let resolution
            = loose_descriptor.resolve(&install_context, &resolve_options).await?;

        let preferred_name
            = resolution.descriptor.ident.name().to_string();

        let dlx_project
            = dlx::install_dependencies(&dlx_project.project_cwd, vec![resolution], self.quiet).await?;
        let bin
            = dlx::find_binary(&dlx_project, &preferred_name, true)?;

        let run_cwd
            = Path::current_dir()?;

        dlx::run_binary(&dlx_project, bin, self.args.clone(), run_cwd).await
    }
}

fn rewrite_starter(input: &str) -> Result<(Ident, Option<String>), Error> {
    let (selector, range_part) = split_ident_and_selector(input);
    let range_part = range_part.map(str::to_string);

    let new_ident_str = if let Some(stripped) = selector.strip_prefix('@') {
        if let Some((scope, rest)) = stripped.split_once('/') {
            format!("@{}/create-{}", scope, rest)
        } else {
            format!("@{}/create", stripped)
        }
    } else {
        format!("create-{}", selector)
    };

    let ident = Ident::from_file_string(&new_ident_str)
        .map_err(|_| Error::InvalidIdent(new_ident_str.clone()))?;

    Ok((ident, range_part))
}

fn parse_range(range_str: &str) -> Range {
    if let Ok(semver_range) = zpm_semver::Range::from_file_string(range_str) {
        return Range::AnonymousSemver(AnonymousSemverRange { range: semver_range });
    }

    Range::RegistryTag(RegistryTagRange { ident: None, tag: range_str.into() })
}
