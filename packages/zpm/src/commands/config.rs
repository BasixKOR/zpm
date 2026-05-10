use clipanion::cli;
use zpm_config::{Settings, Source};
use zpm_utils::set_redacted;

use crate::{error::Error, project::Project};

fn source_label(source: &Source) -> &'static str {
    match source {
        Source::Default => "<default>",
        Source::User => "<user>",
        Source::Project => "<project>",
        Source::Environment => "<environment>",
        Source::Cli => "<cli>",
        Source::Mixed => "<mixed>",
    }
}

/// List the project's configuration values
#[cli::command]
#[cli::path("config")]
#[cli::path("config", "get")]
#[cli::category("Configuration commands")]
pub struct Config {
    /// Format the output as a NDJSON stream
    #[cli::option("--json", default = false)]
    json: bool,

    /// Show secrets instead of redacting them
    #[cli::option("--no-redacted")]
    no_redacted: Option<bool>,
}

impl Config {
    pub async fn execute(&self) -> Result<(), Error> {
        let project
            = Project::new(None).await?;

        if self.no_redacted == Some(false) || self.no_redacted.is_none() {
            set_redacted(true);
        }

        if !self.json {
            let tree
                = project.config.tree_node();

            print!("{}", tree.to_string());

            return Ok(());
        }

        for name in Settings::setting_names() {
            let entry = match project.config.get(&[name]) {
                Ok(entry) => entry,
                Err(_) => continue,
            };

            let json_str = entry.value.export(true);
            let value: serde_json::Value = serde_json::from_str(&json_str)
                .unwrap_or_else(|_| serde_json::Value::String(json_str.clone()));

            let line = serde_json::json!({
                "key": name,
                "effective": value,
                "source": source_label(&entry.source),
            });

            println!("{}", serde_json::to_string(&line).unwrap());
        }

        Ok(())
    }
}
