#[cfg(test)]
#[path = "headless-cli/tests.rs"]
mod headless_cli_tests;
#[path = "note-files/store.rs"]
pub(crate) mod store;
use rfd::FileDialog;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::AppHandle;
static FILE_LOCK: Mutex<()> = Mutex::new(());

// A workspace file can outlive Obsidian. Combine it with a best-effort process
// probe; inability to inspect processes is unknown, never proof that editing stopped.
fn obsidian_running() -> Option<bool> {
    use std::process::Command;
    #[cfg(windows)]
    let output = {
        use std::os::windows::process::CommandExt;
        let system = std::env::var_os("SystemRoot")?;
        Command::new(std::path::PathBuf::from(system).join("System32/tasklist.exe"))
            .args(["/FI", "IMAGENAME eq Obsidian.exe", "/FO", "CSV", "/NH"])
            .creation_flags(0x08000000)
            .output()
            .ok()?
    };
    #[cfg(not(windows))]
    let output = Command::new("pgrep")
        .args(["-i", "-x", "obsidian"])
        .output()
        .ok()?;
    #[cfg(windows)]
    {
        output.status.success().then(|| {
            String::from_utf8_lossy(&output.stdout)
                .to_ascii_lowercase()
                .contains("obsidian.exe")
        })
    }
    #[cfg(not(windows))]
    {
        match output.status.code() {
            Some(0) => Some(true),
            Some(1) => Some(false),
            _ => None,
        }
    }
}

#[tauri::command]
pub fn note_files_dispatch(app: AppHandle, scope: String, request: Value) -> Result<Value, String> {
    let check = || {
        if crate::desktop_identity::local_object_scope()? == scope {
            Ok(())
        } else {
            Err("账号已切换，请重新打开笔记。".to_string())
        }
    };
    check()?;
    let action = request["action"].as_str().ok_or("文件操作无效")?;
    // External paths require a system picker; managed Canvas stays in app data.
    let selected = match action {
        "chooseFolder" => FileDialog::new()
            .set_title("连接笔记文件夹 / Obsidian Vault")
            .pick_folder(),
        "chooseFile" => {
            let extension = request["extension"]
                .as_str()
                .filter(|ext| matches!(*ext, "canvas" | "md"))
                .ok_or("文件类型无效")?;
            let mut dialog = FileDialog::new().add_filter("Notes", &[extension]);
            if let Some(name) = request["suggestedName"].as_str() {
                dialog = dialog.set_file_name(name);
            }
            match request["mode"].as_str() {
                Some("open") => dialog.pick_file(),
                Some("save") => dialog.save_file().map(|path| {
                    if path.extension().and_then(|s| s.to_str()) == Some(extension) {
                        path
                    } else {
                        path.with_extension(extension)
                    }
                }),
                _ => return Err("文件选择方式无效".into()),
            }
        }
        "pickFiles" => {
            let paths = FileDialog::new()
                .add_filter("Markdown", &["md", "markdown"])
                .pick_files()
                .unwrap_or_default();
            check()?;
            if paths.len() > 1000 {
                return Err("请每次导入不超过 1000 个文件。".into());
            }
            let values: Result<Vec<_>, _> = paths
                .iter()
                .map(|path| store::FileStore::import_file(path))
                .collect();
            return Ok(Value::Array(values?));
        }
        _ => None,
    };
    check()?;
    let _guard = FILE_LOCK
        .lock()
        .map_err(|_| "笔记文件存储正在恢复，请重试。")?;
    check()?;
    let app_data = crate::data_location::root(&app).map_err(|e| e.to_string())?;
    let files = store::FileStore::open(&app_data, &scope)?;
    files.remap_managed_grants(crate::data_location::remap_path)?;
    let value = |key: &str| {
        request[key]
            .as_str()
            .ok_or_else(|| format!("缺少文件参数：{key}"))
    };
    match action {
        "operations" => files.file_operations(&request, &check),
        "managedCanvas" => Ok(json!(files.managed_canvas(value("objectId")?)?)),
        "chooseFolder" => selected
            .map(|path| {
                files
                    .register(&path, "directory")
                    .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
            })
            .unwrap_or(Ok(Value::Null)),
        "chooseFile" => selected
            .map(|path| {
                files
                    .selected_file(&path)
                    .and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string()))
            })
            .unwrap_or(Ok(Value::Null)),
        "workspaceState" => Ok(
            json!({ "workspace": files.workspace_state(value("mountId")?)?, "running": obsidian_running() }),
        ),
        "listMounts" => Ok(json!(files.mounts()?)),
        "listEntries" => Ok(json!(files.asset_entries(
            value("mountId")?,
            request["includeImages"].as_bool().unwrap_or(false)
        )?)),
        "readImage" => files.read_image(value("mountId")?, value("path")?),
        "readFile" => Ok(json!(files.read(value("mountId")?, value("path")?)?)),
        "locateFile" | "revealFile" => {
            let path = files.location(value("mountId")?, value("path")?)?;
            if action == "revealFile" {
                crate::data_location::reveal(&path)?;
            }
            Ok(json!({ "path": path }))
        }
        "writeFile" => {
            let expected = match &request["expectedVersion"] {
                Value::Null => None,
                Value::String(s) => Some(s.as_str()),
                _ => return Err("缺少文件版本。".into()),
            };
            check()?;
            Ok(json!(files.write(
                value("mountId")?,
                value("path")?,
                value("text")?,
                expected
            )?))
        }
        "createDirectory" => {
            check()?;
            files.create_directory(value("mountId")?, value("path")?)?;
            Ok(Value::Null)
        }
        _ => Err("不支持的笔记文件操作。".into()),
    }
}

pub(crate) fn sync_managed_mounts(
    app: &AppHandle,
    scope: &str,
) -> Result<std::collections::HashSet<String>, String> {
    let root = crate::data_location::root(app).map_err(|e| e.to_string())?;
    let files = store::FileStore::open(&root, scope)?;
    files.remap_managed_grants(crate::data_location::remap_path)?;
    Ok(files
        .mounts()?
        .into_iter()
        .filter(|m| m.managed)
        .map(|m| m.id)
        .collect())
}
