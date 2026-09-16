#[path = "note-files/store.rs"]
mod store;
use rfd::FileDialog;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::AppHandle;
static FILE_LOCK: Mutex<()> = Mutex::new(());

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
    // A system picker is the only operation that grants a new absolute path.
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
    let app_data = crate::data_location::root(&app).map_err(|e| e.to_string())?;
    let files = store::FileStore::open(&app_data, &scope)?;
    let value = |key: &str| {
        request[key]
            .as_str()
            .ok_or_else(|| format!("缺少文件参数：{key}"))
    };
    match action {
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
        "listMounts" => Ok(json!(files.mounts()?)),
        "listEntries" => Ok(json!(files.entries(value("mountId")?)?)),
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
