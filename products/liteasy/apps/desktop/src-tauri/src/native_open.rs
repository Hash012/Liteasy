//! Native picker and OS handoff share the same read-only exact-file grants.
#[path = "native-open/files.rs"]
mod files;

use files::{OpenBatch, OpenFile, OpenFiles};
use std::{
    ffi::OsString,
    path::Path,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager};

static FILES: OnceLock<Mutex<OpenFiles>> = OnceLock::new();

fn files() -> &'static Mutex<OpenFiles> {
    FILES.get_or_init(|| Mutex::new(OpenFiles::default()))
}

fn check_scope(scope: &str) -> Result<(), String> {
    if crate::desktop_identity::local_object_scope()? == scope {
        Ok(())
    } else {
        Err("账号已切换，请重新打开原文件。".into())
    }
}

#[tauri::command]
pub async fn choose_native_open_file(scope: String) -> Result<Option<OpenFile>, String> {
    check_scope(&scope)?;
    let selected = rfd::AsyncFileDialog::new()
        .set_title("打开原文件")
        .add_filter("PDF / EPUB", &["pdf", "epub"])
        .pick_file()
        .await;
    check_scope(&scope)?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        check_scope(&scope)?;
        let mut files = files().lock().map_err(|_| "原文件读取授权暂时不可用。")?;
        check_scope(&scope)?;
        files.retain_scope(&scope);
        let descriptor = files.select(&scope, &selected)?;
        if let Err(error) = check_scope(&scope) {
            files.release(&scope, &descriptor.id);
            return Err(error);
        }
        Ok(Some(descriptor))
    })
    .await
    .map_err(|_| "原文件打开任务未完成，请重试。".to_string())?
}

#[tauri::command]
pub async fn read_native_open_file(
    scope: String,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    check_scope(&scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        check_scope(&scope)?;
        let bytes = files()
            .lock()
            .map_err(|_| "原文件读取授权暂时不可用。")?
            .read(&scope, &id)?;
        check_scope(&scope)?;
        // Binary IPC avoids expanding a PDF into a very large JSON number array.
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|_| "原文件读取任务未完成，请重试。".to_string())?
}

#[tauri::command]
pub async fn release_native_open_file(scope: String, id: String) -> Result<(), String> {
    // Releasing an old scope after an account switch returns no private data.
    // The registry still checks the grant's exact scope and opaque ID.
    tauri::async_runtime::spawn_blocking(move || {
        files()
            .lock()
            .map_err(|_| "原文件读取授权暂时不可用。")?
            .release(&scope, &id);
        Ok(())
    })
    .await
    .map_err(|_| "原文件授权释放未完成。".to_string())?
}

#[tauri::command]
pub async fn drain_native_open_requests(scope: String) -> Result<OpenBatch, String> {
    check_scope(&scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = files().lock().map_err(|_| "原文件读取授权暂时不可用。")?;
        check_scope(&scope)?;
        Ok(files.drain(&scope))
    })
    .await
    .map_err(|_| "原文件打开请求未完成，请重试。".to_string())?
}

fn enqueue_paths(app: &AppHandle, paths: Vec<std::path::PathBuf>) {
    if paths.is_empty() {
        return;
    }
    // Ownership is captured on arrival, never reassigned by a later renderer drain.
    let scope = crate::desktop_identity::local_object_scope();
    let state = files();
    focus_main_window(app);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = scope.and_then(|scope| {
            check_scope(&scope)?;
            let mut files = state
                .lock()
                .map_err(|_| "native_open_state_unavailable".to_string())?;
            // A delayed old-scope task must neither publish nor purge the new scope.
            let current_scope = crate::desktop_identity::local_object_scope()?;
            files.enqueue_current(&scope, &current_scope, paths);
            let current_scope = crate::desktop_identity::local_object_scope()?;
            files.retain_scope(&current_scope);
            Ok(())
        });
        if result.is_err() {
            eprintln!("Native file handoff unavailable; reselect the file in Liteasy.");
        }
        // This event carries no paths or grant IDs. Subscribe before the initial drain:
        // queued requests survive a missing listener, and later requests emit a wakeup.
        let _ = app.emit("native-open-files-available", ());
    });
}

pub fn enqueue_argv(app: &AppHandle, argv: impl IntoIterator<Item = OsString>, cwd: &Path) {
    enqueue_paths(app, files::paths_from_argv(argv, cwd));
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub fn enqueue_urls(app: &AppHandle, urls: Vec<url::Url>) {
    enqueue_paths(app, urls.iter().filter_map(files::path_from_url).collect());
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
