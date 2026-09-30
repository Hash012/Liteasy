use serde::{Deserialize, Serialize};

fn enabled() -> bool {
    true
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncOptions {
    #[serde(default = "enabled")]
    pub library: bool,
    #[serde(default = "enabled")]
    pub annotations: bool,
    #[serde(default = "enabled")]
    pub workspace: bool,
    #[serde(default = "enabled")]
    pub history: bool,
    #[serde(default = "enabled")]
    pub preferences: bool,
    #[serde(default)]
    pub external_folders: bool,
    #[serde(default)]
    pub api_keys: bool,
    #[serde(default)]
    pub extension_packages: bool,
    #[serde(default)]
    pub extension_configuration: bool,
    #[serde(default)]
    pub extension_workflows: bool,
    #[serde(default)]
    pub extension_runs: bool,
    #[serde(default)]
    pub extension_snapshots: bool,
}
impl Default for SyncOptions {
    fn default() -> Self {
        Self {
            library: true,
            annotations: true,
            workspace: true,
            history: true,
            preferences: true,
            external_folders: false,
            api_keys: false,
            extension_packages: false,
            extension_configuration: false,
            extension_workflows: false,
            extension_runs: false,
            extension_snapshots: false,
        }
    }
}
impl SyncOptions {
    pub fn includes(&self, path: &str) -> bool {
        if let Some(path) = path.strip_prefix(".liteasy/sync-data/") {
            return match path.split('/').next().unwrap_or("") {
                "extension-packages" => self.extension_packages,
                "extension-configuration" => self.extension_configuration,
                "extension-workflows" => self.extension_workflows,
                "extension-runs" => self.extension_runs,
                "extension-snapshots" => self.extension_snapshots,
                "objects" | "boards" => self.workspace,
                "external" => self.external_folders,
                "history" => self.history,
                "preferences" => self.preferences,
                "keys" => self.api_keys,
                _ => false,
            };
        }
        if path.starts_with(".liteasy/paper-artifacts/") {
            if path.split('/').nth(3) == Some("agent-results") {
                self.workspace
            } else {
                self.annotations
            }
        } else {
            self.library
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_settings_include_native_data_but_not_external_files_or_keys() {
        let options: SyncOptions = serde_json::from_str("{}").unwrap();
        for path in [
            "book.epub",
            "note.md",
            ".liteasy/sync-data/objects/guest/records.json",
            ".liteasy/sync-data/boards/guest/canvas.json",
            ".liteasy/sync-data/history/guest/assistant.json",
            ".liteasy/sync-data/preferences/guest/settings.json",
        ] {
            assert!(options.includes(path), "{path}");
        }
        for path in [
            ".liteasy/sync-data/external/guest/vault.json",
            ".liteasy/sync-data/keys/guest/encrypted.json",
        ] {
            assert!(!options.includes(path), "{path}");
        }
    }
}
