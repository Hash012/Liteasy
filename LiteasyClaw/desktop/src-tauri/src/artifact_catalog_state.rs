use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_ARTIFACT_CATALOG_BYTES: u64 = 64 * 1024 * 1024;

fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("artifact-catalog.v1.json"))
        .map_err(|error| format!("Could not resolve artifact catalog directory: {error}"))
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
    let serialized = fs::read(&path)
        .map_err(|error| format!("Could not read artifact catalog: {error}"))?;
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
