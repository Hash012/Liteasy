use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const MAX_ARTIFACT_CATALOG_BYTES: u64 = 64 * 1024 * 1024;

fn find_legacy_catalog(app_data: &Path, path: &Path) -> Result<Option<PathBuf>, String> {
    if path.exists() {
        return Ok(None);
    }
    let directory = app_data.join("artifact-catalog");
    let mut candidates = Vec::new();
    let legacy_unscoped_path = app_data.join("artifact-catalog.v1.json");
    if legacy_unscoped_path.is_file() {
        return Ok(Some(legacy_unscoped_path));
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

fn catalog_path(app: &AppHandle, load_legacy: bool) -> Result<PathBuf, String> {
    let app_data = crate::data_location::root(&app)
        .map_err(|error| format!("Could not resolve artifact catalog directory: {error}"))?;
    if load_legacy {
        catalog_path_at(&app_data)
    } else {
        Ok(app_data.join("artifact-catalog/catalog.v1.json"))
    }
}

#[tauri::command]
pub fn load_artifact_catalog_state(app: AppHandle) -> Result<Option<Value>, String> {
    let path = catalog_path(&app, true)?;
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

    let path = catalog_path(&app, false)?;
    write_catalog_at(&path, &serialized, publish_catalog)
}

fn write_catalog_at<F>(path: &Path, serialized: &[u8], publish: F) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> std::io::Result<()>,
{
    let parent = path.parent().ok_or("Artifact catalog path has no parent")?;
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
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut temporary = options
        .open(&temporary_path)
        .map_err(|error| format!("Could not create temporary artifact catalog: {error}"))?;
    temporary
        .write_all(serialized)
        .and_then(|_| temporary.sync_all())
        .map_err(|error| format!("Could not write artifact catalog: {error}"))?;
    drop(temporary);
    // Never unlink the only published copy. A failed publication leaves both
    // the previous catalog and the complete synced temporary file for recovery.
    publish(&temporary_path, path)
        .map_err(|error| format!("Could not publish artifact catalog; previous catalog and recovery file retained: {error}"))?;
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Could not sync artifact catalog directory: {error}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn publish_catalog(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temporary, destination)
}

#[cfg(windows)]
fn publish_catalog(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    // Same-volume replacement, matching local_library's established Windows
    // strategy. Canonical parents preserve long-path support for new files.
    let temporary = fs::canonicalize(temporary)?;
    let parent = destination.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing catalog parent")
    })?;
    let name = destination.file_name().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "missing catalog filename")
    })?;
    let destination = fs::canonicalize(parent)?.join(name);
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{catalog_path_at, publish_catalog, write_catalog_at};
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
    fn keeps_even_one_legacy_account_catalog_separate_without_verified_ownership() {
        let root = temporary_directory("single");
        let legacy = root
            .join("artifact-catalog")
            .join("old-account")
            .join("catalog.v1.json");
        fs::create_dir_all(legacy.parent().expect("legacy parent")).expect("legacy directory");
        fs::write(&legacy, b"{\"artifacts\":[]}").expect("legacy catalog");

        let error = catalog_path_at(&root).expect_err("account ownership must not be guessed");
        assert!(error.contains("1 legacy account-scoped artifact catalogs"));
        assert!(!root.join("artifact-catalog/catalog.v1.json").exists());
        assert!(legacy.is_file());
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
    fn recovery_files(root: &std::path::Path) -> Vec<PathBuf> {
        fs::read_dir(root)
            .unwrap()
            .filter_map(|entry| {
                let path = entry.unwrap().path();
                (path.extension().is_some_and(|extension| extension == "tmp")).then_some(path)
            })
            .collect()
    }

    #[test]
    fn failed_publication_retains_old_catalog_and_complete_recovery_copy() {
        let root = temporary_directory("publish-failure");
        let path = root.join("catalog.v1.json");
        fs::write(&path, br#"{"artifacts":["old"]}"#).unwrap();
        let new = br#"{"artifacts":["new"]}"#;
        let result = write_catalog_at(&path, new, |temporary, destination| {
            assert_eq!(fs::read(destination).unwrap(), br#"{"artifacts":["old"]}"#);
            assert_eq!(fs::read(temporary).unwrap(), new);
            Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), br#"{"artifacts":["old"]}"#);
        assert_eq!(recovery_files(&root).len(), 1);
        assert_eq!(fs::read(&recovery_files(&root)[0]).unwrap(), new);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn successful_publication_reopens_complete_new_json() {
        let root = temporary_directory("publish-success");
        let path = root.join("catalog.v1.json");
        write_catalog_at(&path, br#"{"artifacts":["old"]}"#, publish_catalog).unwrap();
        write_catalog_at(&path, br#"{"artifacts":["new"]}"#, publish_catalog).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["artifacts"][0], "new");
        assert!(recovery_files(&root).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_publication_child() {
        let Some(root) = std::env::var_os("LITEASY_ARTIFACT_CATALOG_ABORT_TEST_ROOT") else {
            return;
        };
        let path = PathBuf::from(root).join("catalog.v1.json");
        write_catalog_at(&path, br#"{"artifacts":["new"]}"#, |_, _| {
            std::process::exit(73)
        })
        .unwrap();
    }

    #[test]
    fn process_exit_before_publication_keeps_both_complete_copies() {
        let root = temporary_directory("process-exit");
        let path = root.join("catalog.v1.json");
        fs::write(&path, br#"{"artifacts":["old"]}"#).unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "artifact_catalog_state::tests::interrupted_publication_child",
                "--nocapture",
            ])
            .env("LITEASY_ARTIFACT_CATALOG_ABORT_TEST_ROOT", &root)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(73));
        assert_eq!(fs::read(&path).unwrap(), br#"{"artifacts":["old"]}"#);
        assert_eq!(recovery_files(&root).len(), 1);
        assert_eq!(
            fs::read(&recovery_files(&root)[0]).unwrap(),
            br#"{"artifacts":["new"]}"#
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_sharing_lock_preserves_catalog_and_recovery_copy() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = temporary_directory("sharing-lock");
        let path = root.join("catalog.v1.json");
        fs::write(&path, br#"{"artifacts":["old"]}"#).unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(write_catalog_at(&path, br#"{"artifacts":["new"]}"#, publish_catalog).is_err());
        drop(lock);
        assert_eq!(fs::read(&path).unwrap(), br#"{"artifacts":["old"]}"#);
        assert_eq!(recovery_files(&root).len(), 1);
        assert_eq!(
            fs::read(&recovery_files(&root)[0]).unwrap(),
            br#"{"artifacts":["new"]}"#
        );
        fs::remove_dir_all(root).unwrap();
    }
}
