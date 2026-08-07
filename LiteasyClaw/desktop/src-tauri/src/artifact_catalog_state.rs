use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_ARTIFACT_CATALOG_BYTES: u64 = 64 * 1024 * 1024;

fn find_legacy_catalog(app_data: &Path, path: &Path) -> Result<Option<PathBuf>, String> {
    if path.exists() {
        return Ok(None);
    }
    let directory = app_data.join("artifact-catalog");
    let mut candidates = Vec::new();
    let legacy_unscoped_path = app_data.join("artifact-catalog.v1.json");
    if legacy_unscoped_path.is_file() {
        candidates.push(legacy_unscoped_path);
    }
    if directory.is_dir() {
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("Could not inspect legacy artifact catalogs: {error}"))?
        {
            let entry = entry
                .map_err(|error| format!("Could not inspect legacy artifact catalog: {error}"))?;
            let candidate = entry.path().join("catalog.v1.json");
            let Ok(metadata) = fs::symlink_metadata(&candidate) else {
                continue;
            };
            if metadata.file_type().is_file() {
                candidates.push(candidate);
            }
        }
    }
    candidates.sort();
    candidates.dedup();
    match candidates.len() {
        0 => Ok(None),
        1 => Ok(candidates.pop()),
        count => Err(format!(
            "Found {count} legacy account-scoped artifact catalogs; refusing to choose or merge them automatically"
        )),
    }
}

fn catalog_path_at(app_data: &Path) -> Result<PathBuf, String> {
    let directory = app_data.join("artifact-catalog");
    let path = directory.join("catalog.v1.json");
    if let Some(source) = find_legacy_catalog(app_data, &path)? {
        let parent = path
            .parent()
            .ok_or_else(|| "Artifact catalog path has no parent".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create artifact catalog directory: {error}"))?;
        fs::rename(&source, &path)
            .or_else(|_| {
                fs::copy(&source, &path)?;
                fs::remove_file(&source)
            })
            .map_err(|error| format!("Could not migrate artifact catalog: {error}"))?;
    }
    Ok(path)
}

fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve artifact catalog directory: {error}"))?;
    catalog_path_at(&app_data)
}

#[tauri::command]
pub fn load_artifact_catalog_state(app: AppHandle) -> Result<Option<Value>, String> {
    let path = catalog_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect artifact catalog: {error}"))?;
    if metadata.len() > MAX_ARTIFACT_CATALOG_BYTES {
        return Err(format!(
            "Artifact catalog exceeds the {} byte limit",
            MAX_ARTIFACT_CATALOG_BYTES
        ));
    }
    let serialized =
        fs::read(&path).map_err(|error| format!("Could not read artifact catalog: {error}"))?;
    serde_json::from_slice(&serialized)
        .map(Some)
        .map_err(|error| format!("Stored artifact catalog is invalid JSON: {error}"))
}

#[tauri::command]
pub fn save_artifact_catalog_state(app: AppHandle, snapshot: Value) -> Result<(), String> {
    let serialized = serde_json::to_vec(&snapshot)
        .map_err(|error| format!("Could not encode artifact catalog: {error}"))?;
    if serialized.len() as u64 > MAX_ARTIFACT_CATALOG_BYTES {
        return Err(format!(
            "Artifact catalog exceeds the {} byte limit",
            MAX_ARTIFACT_CATALOG_BYTES
        ));
    }

    let path = catalog_path(&app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Artifact catalog path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create artifact catalog directory: {error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path = parent.join(format!(
        ".artifact-catalog.v1.{}.{nonce}.tmp",
        std::process::id()
    ));

    let save_result = (|| -> Result<(), String> {
        let mut temporary = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .map_err(|error| format!("Could not create temporary artifact catalog: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("Could not secure temporary artifact catalog: {error}"))?;
        }
        temporary
            .write_all(&serialized)
            .and_then(|_| temporary.sync_all())
            .map_err(|error| format!("Could not write artifact catalog: {error}"))?;

        #[cfg(windows)]
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("Could not replace old artifact catalog: {error}"))?;
        }
        fs::rename(&temporary_path, &path)
            .map_err(|error| format!("Could not publish artifact catalog: {error}"))?;
        Ok(())
    })();

    if save_result.is_err() && temporary_path.exists() {
        let _ = fs::remove_file(&temporary_path);
    }
    save_result
}

#[cfg(test)]
mod tests {
    use super::catalog_path_at;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "liteasy-artifact-catalog-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temporary directory");
        path
    }

    #[test]
    fn migrates_the_only_legacy_account_catalog_without_an_account_identity() {
        let root = temporary_directory("single");
        let legacy = root
            .join("artifact-catalog")
            .join("old-account")
            .join("catalog.v1.json");
        fs::create_dir_all(legacy.parent().expect("legacy parent")).expect("legacy directory");
        fs::write(&legacy, b"{\"artifacts\":[]}").expect("legacy catalog");

        let current = catalog_path_at(&root).expect("catalog path");

        assert_eq!(current, root.join("artifact-catalog/catalog.v1.json"));
        assert!(current.is_file());
        assert!(!legacy.exists());
        fs::remove_dir_all(root).expect("remove temporary directory");
    }

    #[test]
    fn refuses_to_choose_between_multiple_legacy_account_catalogs() {
        let root = temporary_directory("multiple");
        for account in ["old-account-a", "old-account-b"] {
            let legacy = root
                .join("artifact-catalog")
                .join(account)
                .join("catalog.v1.json");
            fs::create_dir_all(legacy.parent().expect("legacy parent")).expect("legacy directory");
            fs::write(legacy, b"{\"artifacts\":[]}").expect("legacy catalog");
        }

        let error = catalog_path_at(&root).expect_err("migration must be ambiguous");

        assert!(error.contains("2 legacy account-scoped artifact catalogs"));
        assert!(root
            .join("artifact-catalog/old-account-a/catalog.v1.json")
            .is_file());
        assert!(root
            .join("artifact-catalog/old-account-b/catalog.v1.json")
            .is_file());
        fs::remove_dir_all(root).expect("remove temporary directory");
    }

    #[test]
    fn leaves_legacy_catalogs_untouched_after_the_device_catalog_exists() {
        let root = temporary_directory("current");
        let current = root.join("artifact-catalog/catalog.v1.json");
        let legacy = root.join("artifact-catalog/old-account/catalog.v1.json");
        fs::create_dir_all(legacy.parent().expect("legacy parent")).expect("legacy directory");
        fs::write(&current, b"{\"artifacts\":[1]}").expect("current catalog");
        fs::write(&legacy, b"{\"artifacts\":[2]}").expect("legacy catalog");

        assert_eq!(catalog_path_at(&root).expect("catalog path"), current);
        assert!(legacy.is_file());
        fs::remove_dir_all(root).expect("remove temporary directory");
    }
}
