//! Data-root changes are applied before stores and background workers start.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};

const MIGRATION_MARKER: &str = ".liteasy-migration-source.json";
const CONFIG: &str = "data-location.v1.json";
const MANAGED: &[&str] = &[
    "objects",
    "note-files",
    "local-library",
    "library-profiles",
    "user-library",
    "artifact-catalog",
    "artifact-exports",
    "artifact-catalog.v1.json",
    "agent-state.v1.json",
    "assistant-history.v1.json",
    "artifact-tasks-checkpoints.v1.json",
    "thin-reading-checkpoints.v1.json",
    "paper-services-checkpoints.v1.json",
];
#[derive(Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    root: Option<PathBuf>,
    pending: Option<PathBuf>,
    #[serde(default)]
    previous_roots: Vec<PathBuf>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLocation {
    current_path: PathBuf,
    pending_path: Option<PathBuf>,
    migration_error: Option<String>,
}
struct Active {
    root: PathBuf,
    previous: Vec<PathBuf>,
    error: Option<String>,
}
static ACTIVE: OnceLock<Active> = OnceLock::new();
static CONFIG_LOCK: Mutex<()> = Mutex::new(());
fn bootstrap(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}
fn read_config(base: &Path) -> Result<Config, String> {
    let path = base.join(CONFIG);
    if !path.exists() {
        return Ok(Config::default());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("数据目录设置损坏，未切换目录：{e}"))
}
fn save_config(base: &Path, config: &Config) -> Result<(), String> {
    crate::local_library::write_bytes_atomically(
        &base.join(CONFIG),
        &serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?,
    )
}
fn link_like(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}
fn digest(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut bytes = [0_u8; 65536];
    loop {
        let count = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    Ok(hash.finalize().to_vec())
}
fn private_directory(path: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|e| e.to_string())
}
fn private_file(path: &Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|e| e.to_string())
}
fn manifest(root: &Path) -> Result<std::collections::BTreeMap<PathBuf, Option<Vec<u8>>>, String> {
    fn visit(
        root: &Path,
        path: &Path,
        result: &mut std::collections::BTreeMap<PathBuf, Option<Vec<u8>>>,
    ) -> Result<(), String> {
        let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
        if link_like(&metadata) {
            return Err("迁移校验发现符号链接，原数据保留。".into());
        }
        let key = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_path_buf();
        if metadata.is_dir() {
            result.insert(key, None);
            for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
                visit(root, &entry.map_err(|e| e.to_string())?.path(), result)?;
            }
        } else if metadata.is_file() {
            result.insert(key, Some(digest(path)?));
        } else {
            return Err("数据目录包含不支持的文件类型。".into());
        }
        Ok(())
    }
    let mut result = std::collections::BTreeMap::new();
    for name in MANAGED {
        let path = root.join(name);
        match fs::symlink_metadata(&path) {
            Ok(_) => visit(root, &path, &mut result)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(result)
}
fn copy_verified(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if link_like(&metadata) {
        return Err("数据中含符号链接或目录联接，未迁移，请先整理数据。".into());
    }
    if metadata.is_dir() {
        private_directory(target)?;
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_verified(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else if metadata.is_file() {
        let before = digest(source)?;
        let mut output = private_file(target)?;
        std::io::copy(
            &mut fs::File::open(source).map_err(|e| e.to_string())?,
            &mut output,
        )
        .map_err(|e| e.to_string())?;
        output.flush().map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        if digest(target)? != before || digest(source)? != before {
            return Err("迁移校验失败，原数据保留。".into());
        }
    } else {
        return Err("数据目录包含不支持的文件类型。".into());
    }
    Ok(())
}
fn validate_destination(source: &Path, target: &Path) -> Result<(), String> {
    if !target.is_absolute() || target.exists() {
        return Err("请选择尚不存在的数据目录，已有目录不会被覆盖。".into());
    }
    let parent = target.parent().ok_or("保存目录无效")?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("保存目录不可用：{e}"))?;
    if canonical_parent != parent {
        return Err("保存目录不能经过符号链接。".into());
    }
    if source.exists() {
        let source = source.canonicalize().map_err(|e| e.to_string())?;
        if target.starts_with(&source) || source.starts_with(target) {
            return Err("新旧数据目录不能互相包含。".into());
        }
    }
    Ok(())
}
fn migrate(source: &Path, target: &Path) -> Result<(), String> {
    // A crash after publishing the copy but before updating the pointer can resume only
    // if the marker AND every managed byte still match the old active directory.
    if target.exists() {
        if link_like(&fs::symlink_metadata(target).map_err(|e| e.to_string())?) {
            return Err("迁移目标不能是符号链接。".into());
        }
        let marker = target.join(MIGRATION_MARKER);
        if !marker.is_file()
            || link_like(&fs::symlink_metadata(&marker).map_err(|e| e.to_string())?)
        {
            return Err("迁移目标已存在，原数据保留。".into());
        }
        let recorded: PathBuf =
            serde_json::from_slice(&fs::read(marker).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if recorded != source || manifest(source)? != manifest(target)? {
            return Err("旧副本与当前数据不一致，请取消更改并选择新的保存位置。".into());
        }
        return Ok(());
    }
    validate_destination(source, target)?;
    let before = manifest(source)?;
    let stage = target.with_file_name(format!(
        ".liteasy-migrate-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    private_directory(&stage)?;
    let result = (|| {
        for name in MANAGED {
            let path = source.join(name);
            if fs::symlink_metadata(&path).is_ok() {
                copy_verified(&path, &stage.join(name))?;
            }
        }
        if manifest(source)? != before || manifest(&stage)? != before {
            return Err("复制期间数据发生变化，未切换目录，原数据保留。".into());
        }
        let mut marker = private_file(&stage.join(MIGRATION_MARKER))?;
        marker
            .write_all(&serde_json::to_vec(source).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        marker.sync_all().map_err(|e| e.to_string())?;
        // Never replace another directory created while the copy was in progress.
        if target.exists() {
            return Err("迁移目标已存在，原数据保留。".into());
        }
        fs::rename(&stage, target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}
pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let base = bootstrap(app)?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let mut config = read_config(&base)?;
    let mut root = config.root.clone().unwrap_or_else(|| base.clone());
    if !root.is_dir() {
        return Err("数据目录不可用；请连接原磁盘后重启，未创建空库。".into());
    }
    let original_root = root.clone();
    root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut error = None;
    if let Some(target) = config.pending.clone() {
        match migrate(&root, &target) {
            Ok(()) => {
                let mut next = config.clone();
                next.previous_roots.push(root.clone());
                // Older Windows records use ordinary drive paths rather than the
                // verbatim prefix returned by canonicalize. Preserve both aliases.
                if original_root != root {
                    next.previous_roots.push(original_root.clone());
                }
                next.root = Some(target.clone());
                next.pending = None;
                match save_config(&base, &next) {
                    Ok(()) => {
                        let _ = fs::remove_file(target.join(MIGRATION_MARKER));
                        root = target;
                        config = next;
                    }
                    Err(e) => {
                        error = Some(format!("副本已复制，但设置保存失败，继续使用原目录：{e}"))
                    }
                }
            }
            Err(e) => error = Some(format!("迁移未完成，继续使用原目录：{e}")),
        }
    }
    ACTIVE
        .set(Active {
            root,
            previous: config.previous_roots,
            error,
        })
        .map_err(|_| "数据目录已初始化".to_string())
}
pub fn root(app: &AppHandle) -> Result<PathBuf, String> {
    ACTIVE
        .get()
        .map(|a| a.root.clone())
        .ok_or_else(|| "数据目录尚未就绪".to_string())
        .or_else(|e| {
            // No fallback when a configured root is unavailable.
            if read_config(&bootstrap(app)?)?.root.is_some() {
                Err(e)
            } else {
                bootstrap(app)
            }
        })
}
pub fn remap_path(path: &Path) -> PathBuf {
    if let Some(active) = ACTIVE.get() {
        for old in active.previous.iter().rev() {
            if let Ok(relative) = path.strip_prefix(old) {
                if relative.components().next().is_some_and(|c| {
                    MANAGED
                        .iter()
                        .any(|name| c.as_os_str() == std::ffi::OsStr::new(name))
                }) {
                    return active.root.join(relative);
                }
            }
        }
    }
    path.to_path_buf()
}
#[tauri::command]
pub fn get_data_location(app: AppHandle) -> Result<DataLocation, String> {
    Ok(DataLocation {
        current_path: root(&app)?,
        pending_path: read_config(&bootstrap(&app)?)?.pending,
        migration_error: ACTIVE.get().and_then(|a| a.error.clone()),
    })
}
#[tauri::command]
pub fn choose_data_location(app: AppHandle) -> Result<Option<DataLocation>, String> {
    let Some(parent) = rfd::FileDialog::new()
        .set_title("选择数据保存位置（将创建 LiteasyData 子目录）")
        .pick_folder()
    else {
        return Ok(None);
    };
    let target = parent
        .canonicalize()
        .map_err(|e| e.to_string())?
        .join("LiteasyData");
    validate_destination(&root(&app)?, &target)?;
    let _lock = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let base = bootstrap(&app)?;
    let mut config = read_config(&base)?;
    config.pending = Some(target);
    save_config(&base, &config)?;
    get_data_location(app).map(Some)
}
#[tauri::command]
pub fn cancel_data_location_change(app: AppHandle) -> Result<DataLocation, String> {
    let _lock = CONFIG_LOCK.lock().map_err(|e| e.to_string())?;
    let base = bootstrap(&app)?;
    let mut config = read_config(&base)?;
    config.pending = None;
    save_config(&base, &config)?;
    get_data_location(app)
}
pub fn reveal(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("文件位置不可用。".into());
    }
    #[cfg(target_os = "windows")]
    let result = if path.is_file() {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
    } else {
        std::process::Command::new("explorer").arg(path).spawn()
    };
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result = std::process::Command::new("xdg-open")
        .arg(if path.is_file() {
            path.parent().ok_or("文件位置无效")?
        } else {
            path
        })
        .spawn();
    result.map(|_| ()).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn reveal_data_location(app: AppHandle) -> Result<(), String> {
    reveal(&root(&app)?)
}

#[tauri::command]
pub fn restart_for_data_location(app: AppHandle) -> Result<(), String> {
    if read_config(&bootstrap(&app)?)?.pending.is_none() {
        return Err("没有待应用的数据目录更改。".into());
    }
    app.restart();
}

#[tauri::command]
pub fn resource_location(
    app: AppHandle,
    scope: String,
    request: serde_json::Value,
    reveal_in_folder: bool,
) -> Result<serde_json::Value, String> {
    if crate::desktop_identity::local_object_scope()? != scope {
        return Err("账号已切换，请重新打开资源。".into());
    }
    let path = match request["kind"].as_str() {
        Some("object") => root(&app)?.join("objects/objects.v1.sqlite3"),
        Some("paper") => {
            let path = remap_path(Path::new(request["path"].as_str().ok_or("缺少论文位置")?));
            let canonical = path.canonicalize().map_err(|e| e.to_string())?;
            let library = crate::local_library::library_root(&app)?;
            let cache = app
                .path()
                .app_cache_dir()
                .map_err(|e| e.to_string())?
                .join("paper-cache");
            if !canonical.starts_with(&library)
                && !cache.canonicalize().is_ok_and(|c| canonical.starts_with(c))
            {
                return Err("文件不属于当前文献库或论文缓存。".into());
            }
            canonical
        }
        Some("artifact") => {
            crate::agent_artifacts::locate(&app, request["id"].as_str().ok_or("缺少产物标识")?)?
        }
        Some("pdf-annotation") => crate::user_paper_store::location(
            &app,
            request["paperId"].as_str().ok_or("缺少论文标识")?,
            "annotations",
        )?,
        _ => return Err("此资源没有可定位的本机文件。".into()),
    };
    if !path.is_file() {
        return Err("本机文件尚未保存或已不可用。".into());
    }
    if reveal_in_folder {
        reveal(&path)?;
    }
    Ok(serde_json::json!({ "path": path }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "liteasy-data-root-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(path.join("source/objects")).unwrap();
        path.canonicalize().unwrap()
    }
    #[test]
    fn copies_and_verifies_managed_data_without_removing_original_or_browser_profile() {
        let root = fixture();
        fs::write(root.join("source/objects/data"), "原数据").unwrap();
        fs::write(root.join("source/browser-settings"), "browser").unwrap();
        migrate(&root.join("source"), &root.join("target")).unwrap();
        assert_eq!(
            fs::read(root.join("target/objects/data")).unwrap(),
            "原数据".as_bytes()
        );
        assert!(root.join("source/objects/data").exists());
        assert!(!root.join("target/browser-settings").exists());
        // Resume a fully copied migration if pointer persistence was interrupted.
        migrate(&root.join("source"), &root.join("target")).unwrap();
        fs::write(
            root.join("source/objects/data"),
            "new edit after failed migration",
        )
        .unwrap();
        assert!(migrate(&root.join("source"), &root.join("target")).is_err());
        assert_eq!(
            fs::read(root.join("target/objects/data")).unwrap(),
            "原数据".as_bytes()
        );
        assert!(migrate(&root.join("source"), &root.join("source/nested")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn copied_data_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let root = fixture();
        fs::write(root.join("source/objects/data"), "private").unwrap();
        migrate(&root.join("source"), &root.join("target")).unwrap();
        assert_eq!(
            fs::metadata(root.join("target"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(root.join("target/objects/data"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn refuses_links_without_publishing_partial_target() {
        let root = fixture();
        std::os::unix::fs::symlink("/tmp", root.join("source/objects/link")).unwrap();
        assert!(migrate(&root.join("source"), &root.join("target")).is_err());
        assert!(!root.join("target").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
