mod engine;
pub(crate) mod local;
pub(crate) mod model;
mod transport;

use engine::sync_library;
use model::{Files, Manifest};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, path::Path};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use transport::Remote;

static OPERATION: Mutex<()> = Mutex::const_new(());
pub(crate) fn lock_library_location_change() -> Result<tokio::sync::MutexGuard<'static, ()>, String>
{
    OPERATION
        .try_lock()
        .map_err(|_| "WebDAV 操作正在进行，请完成后再移动或备份文献库。".into())
}

static OPEN_DOCUMENTS: std::sync::Mutex<Option<BTreeSet<String>>> = std::sync::Mutex::new(None);

#[tauri::command]
pub fn set_webdav_open_documents(app: AppHandle, document_ids: Vec<String>) -> Result<(), String> {
    crate::local_library::with_local_library_index_transaction(&app, || {
        *OPEN_DOCUMENTS
            .lock()
            .map_err(|_| "无法更新打开的文献状态。")? = Some(document_ids.into_iter().collect());
        Ok(())
    })
}

pub(crate) fn document_is_open(id: &str) -> bool {
    OPEN_DOCUMENTS
        .lock()
        .map(|ids| ids.as_ref().map(|ids| ids.contains(id)).unwrap_or(true))
        .unwrap_or(true)
}
pub(crate) fn artifact_is_open(relative: &str) -> bool {
    OPEN_DOCUMENTS
        .lock()
        .map(|ids| {
            ids.as_ref()
                .map(|ids| {
                    ids.iter().any(|id| {
                        crate::user_paper_store::paper_artifact_directory_name(id).is_ok_and(
                            |directory| {
                                relative
                                    .starts_with(&format!(".liteasy/paper-artifacts/{directory}/"))
                            },
                        )
                    })
                })
                .unwrap_or(true)
        })
        .unwrap_or(true)
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub endpoint: String,
    pub username: String,
    pub collection: String,
    #[serde(default)]
    pub auto_sync: bool,
}
impl Settings {
    fn validate(&mut self) -> Result<(), String> {
        self.endpoint = transport::endpoint(&self.endpoint)?.to_string();
        self.username = self.username.trim().into();
        if self.username.is_empty() || self.username.len() > 256 {
            return Err("请输入 WebDAV 用户名。".into());
        }
        if self.collection.is_empty()
            || self.collection.len() > 64
            || !self
                .collection
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("同步库名称须为 1–64 位英文字母、数字、短横线或下划线。".into());
        }
        Ok(())
    }
    fn key(&self) -> String {
        model::digest(
            format!("{}\n{}\n{}", self.endpoint, self.username, self.collection).as_bytes(),
        )
    }
    fn credential(&self, root: &Path) -> Result<keyring::Entry, String> {
        keyring::Entry::new(
            "Liteasy.WebDAV",
            &format!(
                "{}-{}",
                crate::local_library::webdav_library_id(root)?,
                self.key()
            ),
        )
        .map_err(|_| "系统凭据存储不可用。".into())
    }
    fn remote(&self, root: &Path) -> Result<Remote, String> {
        let password = self
            .credential(&root)?
            .get_password()
            .map_err(|_| "无法读取 WebDAV 密码，请重新保存连接配置。")?;
        Remote::new(&self.endpoint, &self.collection, &self.username, &password)
    }
}
fn settings_path(root: &Path) -> Result<std::path::PathBuf, String> {
    Ok(local::state_directory(root)?.join("settings.json"))
}
fn load_settings(root: &Path) -> Result<Settings, String> {
    let path = settings_path(root)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let mut settings: Settings =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|_| "WebDAV 配置损坏。")?;
    settings.validate()?;
    Ok(settings)
}

#[tauri::command]
pub async fn get_webdav_settings(app: AppHandle) -> Result<Settings, String> {
    let _guard = OPERATION.lock().await;
    load_settings(&crate::local_library::library_root(&app)?)
}
#[tauri::command]
pub async fn save_webdav_settings(
    app: AppHandle,
    mut settings: Settings,
    password: Option<String>,
) -> Result<(), String> {
    let _guard = OPERATION.try_lock().map_err(|_| "WebDAV 操作正在进行。")?;
    settings.validate()?;
    let root = crate::local_library::library_root(&app)?;
    let old = load_settings(&root)?;
    if let Some(password) = password.filter(|p| !p.is_empty()) {
        if password.len() > 8192 {
            return Err("WebDAV 密码过长。".into());
        }
        settings
            .credential(&root)?
            .set_password(&password)
            .map_err(|_| "无法安全保存 WebDAV 密码。")?;
    } else {
        settings
            .credential(&root)?
            .get_password()
            .map_err(|_| "首次连接或更换连接时请输入密码。")?;
    }
    local::save_json(&settings_path(&root)?, &settings)?;
    if !old.endpoint.is_empty() && old.key() != settings.key() {
        old.credential(&root)?
            .delete_credential()
            .map_err(|_| "新配置已保存，但旧密码清理失败。")?;
    }
    Ok(())
}
#[tauri::command]
pub async fn disconnect_webdav(app: AppHandle) -> Result<(), String> {
    let _guard = OPERATION.try_lock().map_err(|_| "WebDAV 操作正在进行。")?;
    let root = crate::local_library::library_root(&app)?;
    let path = settings_path(&root)?;
    if path.exists() {
        match load_settings(&root)?.credential(&root)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => (),
            Err(_) => return Err("无法移除系统中保存的 WebDAV 密码。".into()),
        }
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    // Baselines and recovery copies remain available on reconnection; no remote deletion.
    Ok(())
}
#[tauri::command]
pub async fn verify_webdav(app: AppHandle) -> Result<(), String> {
    let _guard = OPERATION.try_lock().map_err(|_| "WebDAV 操作正在进行。")?;
    let root = crate::local_library::library_root(&app)?;
    load_settings(&root)?.remote(&root)?.verify().await
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub uploaded: usize,
    pub downloaded: usize,
    pub deleted: usize,
    pub conflicts: Vec<Conflict>,
    pub deferred: Vec<String>,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conflict {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_path: Option<String>,
    pub local: Option<model::FileVersion>,
    pub remote: Option<model::FileVersion>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resolution {
    pub conflict: Conflict,
    pub choice: Choice,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Choice {
    Local,
    Remote,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: &'static str,
    completed: usize,
    total: usize,
}

#[tauri::command]
pub async fn sync_webdav(
    app: AppHandle,
    resolutions: Option<Vec<Resolution>>,
) -> Result<SyncResult, String> {
    let _guard = OPERATION.try_lock().map_err(|_| "WebDAV 操作正在进行。")?;
    let root = crate::local_library::library_root(&app)?;
    let settings = load_settings(&root)?;
    let remote = settings.remote(&root)?;
    let _ = app.emit(
        "webdav-progress",
        Progress {
            phase: "verify",
            completed: 0,
            total: 0,
        },
    );
    // Verify conditional requests on every run: a changed server/proxy must not bypass CAS.
    remote.verify().await?;
    let snapshot = crate::local_library::load_local_library_snapshot(app.clone())?;
    if Path::new(&snapshot.root_path) != root {
        return Err("文献库位置已改变，请重新同步。".into());
    }
    let mut files = Files::new();
    local::collect(&root, &root, &mut files)?;
    for entry in snapshot.entries {
        if let Some(path) = entry.relative_path {
            if let Some(Some(version)) = files.get_mut(&path) {
                version.document_id = Some(entry.id);
            }
        }
    }
    let current = Manifest {
        schema_version: 1,
        files,
    };
    current.validate()?;
    sync_library(
        &root,
        &settings.key(),
        &remote,
        current,
        resolutions,
        |path, expected, version, bytes| {
            crate::local_library::apply_webdav_file(&app, &root, path, expected, version, bytes)
        },
        |value| {
            let _ = app.emit("webdav-progress", value);
        },
    )
    .await
}
