//! Native-selected local archive plans. Renderer parameters contain IDs, never arbitrary paths.
#[path = "local-archive/archive.rs"]
mod archive;
use archive::{DocumentInput, Manifest, Plan, Receipt, SourceInput};
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;

struct Pending {
    scope: String,
    created: Instant,
    plan: Plan,
    versions: Vec<(String, String)>,
    library_root: Option<PathBuf>,
}
struct Completed {
    scope: String,
    path: PathBuf,
    manifest: Manifest,
}
#[derive(Default)]
struct State {
    plans: BTreeMap<String, Pending>,
    receipts: BTreeMap<String, Completed>,
}
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
fn state() -> &'static Mutex<State> {
    STATE.get_or_init(|| Mutex::new(State::default()))
}
fn check(scope: &str) -> Result<(), String> {
    if crate::desktop_identity::local_object_scope()? == scope {
        Ok(())
    } else {
        Err("账号已切换，请重新预览归档。".into())
    }
}
fn token() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "无法生成归档计划标识。")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn output_path(parent: &Path, operation: &str) -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(parent.join(format!(
        "Liteasy-{}-{now}-{}",
        if operation == "restore" {
            "Restored"
        } else {
            "Archive"
        },
        &token()?[..8]
    )))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    id: String,
    title: String,
    available: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    plan_id: String,
    operation: String,
    target_path: String,
    manifest: Manifest,
    total_bytes: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReceipt {
    receipt_id: String,
    #[serde(flatten)]
    receipt: Receipt,
    manifest: Manifest,
}

fn store_plan(
    scope: String,
    plan: Plan,
    versions: Vec<(String, String)>,
    library_root: Option<PathBuf>,
) -> Result<Preview, String> {
    check(&scope)?;
    let id = token()?;
    let preview = Preview {
        plan_id: id.clone(),
        operation: plan.operation.clone(),
        target_path: plan.target.to_string_lossy().into_owned(),
        total_bytes: plan.manifest.files.iter().map(|file| file.size).sum(),
        manifest: plan.manifest.clone(),
    };
    let mut state = state().lock().map_err(|_| "归档计划暂时不可用。")?;
    state.plans.retain(|_, pending| {
        pending.scope == scope && pending.created.elapsed() < Duration::from_secs(600)
    });
    state.receipts.retain(|_, receipt| receipt.scope == scope);
    if state.plans.len() >= 4 {
        return Err("已有多个未确认归档，请先取消旧预览。".into());
    }
    state.plans.insert(
        id,
        Pending {
            scope,
            created: Instant::now(),
            plan,
            versions,
            library_root,
        },
    );
    Ok(preview)
}

#[tauri::command]
pub async fn local_archive_catalog(
    app: AppHandle,
    scope: String,
) -> Result<Vec<CatalogEntry>, String> {
    check(&scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        check(&scope)?;
        let snapshot = crate::local_library::load_local_library_snapshot(app)?;
        check(&scope)?;
        Ok(snapshot
            .entries
            .into_iter()
            .map(|entry| CatalogEntry {
                id: entry.id,
                title: entry.title,
                available: entry.relative_path.is_some(),
            })
            .collect())
    })
    .await
    .map_err(|_| "读取资料列表失败。".to_string())?
}

fn selected_records(
    app: &AppHandle,
    scope: &str,
    selected: &HashSet<String>,
) -> Result<(Value, Vec<(String, String)>), String> {
    let mut records = Vec::new();
    let mut versions = Vec::new();
    let mut after = String::new();
    let mut read_count = 0;
    let mut total = 0;
    loop {
        let rows = crate::object_store::object_store_list(
            app.clone(),
            scope.into(),
            "title/".into(),
            after.clone(),
            100,
        )?;
        if rows.is_empty() {
            break;
        }
        let rows = serde_json::to_value(rows).map_err(|e| e.to_string())?;
        for row in rows.as_array().ok_or("笔记索引格式无效。")? {
            after = row["key"].as_str().ok_or("笔记索引缺少键。")?.into();
            let value = &row["value"];
            let Some(object) = value["objectId"].as_str() else {
                continue;
            };
            if value["kind"] == "source.document"
                && value["paperId"]
                    .as_str()
                    .is_some_and(|id| selected.contains(id))
            {
                records.push(json!({"key":format!("head/{object}"),"value":{"objectId":object,"kind":"source.document","content":{"payload":{"paperId":value["paperId"]}}}}));
            } else if value["kind"] == "content.note" && value["lifecycle"] == "active" {
                read_count += 1;
                if read_count > 512 {
                    return Err("当前账户笔记超过本次归档范围上限，请先整理后分批导出。".into());
                }
                if let Some(row) = crate::object_store::object_store_get(
                    app.clone(),
                    scope.into(),
                    format!("head/{object}"),
                )? {
                    let row = serde_json::to_value(row).map_err(|e| e.to_string())?;
                    total += row.to_string().len();
                    if total > 16 * 1024 * 1024 {
                        return Err("笔记正文超过 16 MiB，请分批归档。".into());
                    }
                    versions.push((
                        row["key"].as_str().ok_or("笔记缺少键。")?.into(),
                        row["version"].as_str().ok_or("笔记缺少版本。")?.into(),
                    ));
                    records.push(row);
                }
            }
        }
    }
    let runs: HashSet<String> = records
        .iter()
        .filter_map(|row| {
            row["value"]["provenance"]["runId"]
                .as_str()
                .map(str::to_string)
        })
        .collect();
    for id in runs {
        let key = format!("workflow-run/{id}");
        if let Some(row) =
            crate::object_store::object_store_get(app.clone(), scope.into(), key.clone())?
        {
            let row = serde_json::to_value(row).map_err(|e| e.to_string())?;
            versions.push((
                key,
                row["version"].as_str().ok_or("运行记录缺少版本。")?.into(),
            ));
            records.push(row);
        }
    }
    Ok((Value::Array(records), versions))
}

#[tauri::command]
pub async fn local_archive_prepare_export(
    app: AppHandle,
    scope: String,
    document_ids: Vec<String>,
) -> Result<Option<Preview>, String> {
    check(&scope)?;
    if document_ids.is_empty() || document_ids.len() > 256 {
        return Err("请选择 1 至 256 篇文献。".into());
    }
    let Some(parent) = rfd::AsyncFileDialog::new()
        .set_title("选择资料归档的保存位置")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    check(&scope)?;
    let parent = parent
        .path()
        .canonicalize()
        .map_err(|_| "归档保存位置不可用。")?;
    tauri::async_runtime::spawn_blocking(move || {
        check(&scope)?;
        let root = crate::local_library::library_root(&app)?;
        if parent.starts_with(&root) {
            return Err("归档保存位置不能位于当前文献库内。".into());
        }
        let snapshot = crate::local_library::load_local_library_snapshot(app.clone())?;
        let mut selected = HashSet::new();
        let mut documents = Vec::new();
        let mut conditions = Vec::new();
        for id in document_ids {
            if !selected.insert(id.clone()) {
                return Err("不能重复选择文献。".into());
            }
            let entry = snapshot
                .entries
                .iter()
                .find(|entry| entry.id == id)
                .ok_or("所选文献已移除，请刷新列表。")?;
            let relative = entry
                .relative_path
                .clone()
                .ok_or("所选文献没有本地原文。")?;
            let artifact_path = crate::user_paper_store::location(&app, &id, "annotations")?;
            let annotation_source = SourceInput {
                root: root.clone(),
                relative: artifact_path
                    .strip_prefix(&root)
                    .map_err(|_| "批注位于当前文献库之外。")?
                    .to_string_lossy()
                    .replace(std::path::MAIN_SEPARATOR, "/"),
            };
            let annotations = if artifact_path.exists() {
                let bytes = archive::metadata_bytes(&annotation_source)?;
                conditions.push((annotation_source, Some(archive::digest(&bytes))));
                Some(
                    serde_json::from_slice(&bytes)
                        .map_err(|_| "所选文献的批注损坏；未创建归档。")?,
                )
            } else {
                conditions.push((annotation_source, None));
                None
            };
            documents.push(DocumentInput {
                private_id: id,
                title: entry.title.clone(),
                source: SourceInput {
                    root: root.clone(),
                    relative,
                },
                annotations,
            });
        }
        let (records, versions) = selected_records(&app, &scope, &selected)?;
        let mut plan =
            archive::prepare_export(documents, &records, &output_path(&parent, "export")?)?;
        for (source, hash) in conditions {
            match hash {
                Some(hash) => plan.bind_condition(source, hash),
                None => plan.bind_absence(source),
            }
        }
        store_plan(scope, plan, versions, Some(root)).map(Some)
    })
    .await
    .map_err(|_| "归档预览未完成。".to_string())?
}

#[tauri::command]
pub async fn local_archive_prepare_restore(scope: String) -> Result<Option<Preview>, String> {
    check(&scope)?;
    let Some(root) = rfd::AsyncFileDialog::new()
        .set_title("选择含 manifest.json 的资料归档目录")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    check(&scope)?;
    let Some(parent) = rfd::AsyncFileDialog::new()
        .set_title("选择恢复副本的保存位置（将创建新目录）")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    check(&scope)?;
    let root = root.path().canonicalize().map_err(|_| "归档位置不可用。")?;
    let parent = parent
        .path()
        .canonicalize()
        .map_err(|_| "恢复位置不可用。")?;
    tauri::async_runtime::spawn_blocking(move || {
        check(&scope)?;
        if parent.starts_with(&root) {
            return Err("恢复位置不能位于所选归档内。".into());
        }
        let plan = archive::prepare_restore(&root, &output_path(&parent, "restore")?)?;
        store_plan(scope, plan, vec![], None).map(Some)
    })
    .await
    .map_err(|_| "归档校验未完成。".to_string())?
}

#[tauri::command]
pub async fn local_archive_commit(
    app: AppHandle,
    scope: String,
    plan_id: String,
) -> Result<ArchiveReceipt, String> {
    check(&scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        check(&scope)?;
        let pending = {
            let mut state = state().lock().map_err(|_| "归档计划暂时不可用。")?;
            if !state.plans.get(&plan_id).is_some_and(|p| p.scope == scope) {
                return Err("归档预览已失效，请重新选择。".into());
            }
            state.plans.remove(&plan_id).unwrap()
        };
        if pending.created.elapsed() > Duration::from_secs(600) {
            return Err("归档预览已过期，请重新选择。".into());
        }
        if let Some(root) = pending.library_root {
            if crate::local_library::library_root(&app)? != root {
                return Err("预览后文献库位置已更改，请重新预览。".into());
            }
        }
        for (key, version) in pending.versions {
            let row = crate::object_store::object_store_get(app.clone(), scope.clone(), key)?;
            let row = serde_json::to_value(row).map_err(|e| e.to_string())?;
            if row["version"] != version {
                return Err("预览后笔记或运行记录已更改，请重新预览。".into());
            }
        }
        let manifest = pending.plan.manifest.clone();
        let path = pending.plan.target.clone();
        let receipt = archive::commit_checked(pending.plan, || check(&scope))?;
        check(&scope)?;
        let id = token()?;
        let mut state = state().lock().map_err(|_| "归档回执暂时不可用。")?;
        state.receipts.retain(|_, r| r.scope == scope);
        if state.receipts.len() >= 8 {
            if let Some(key) = state.receipts.keys().next().cloned() {
                state.receipts.remove(&key);
            }
        }
        state.receipts.insert(
            id.clone(),
            Completed {
                scope,
                path,
                manifest: manifest.clone(),
            },
        );
        Ok(ArchiveReceipt {
            receipt_id: id,
            receipt,
            manifest,
        })
    })
    .await
    .map_err(|_| "归档写入任务中断，请检查保存位置。".to_string())?
}

#[tauri::command]
pub fn local_archive_cancel(scope: String, plan_id: String) -> Result<(), String> {
    let mut state = state().lock().map_err(|_| "归档计划暂时不可用。")?;
    if state.plans.get(&plan_id).is_some_and(|p| p.scope == scope) {
        state.plans.remove(&plan_id);
    }
    Ok(())
}

fn completed(scope: &str, id: &str) -> Result<(PathBuf, Manifest), String> {
    check(scope)?;
    let state = state().lock().map_err(|_| "归档回执暂时不可用。")?;
    let receipt = state
        .receipts
        .get(id)
        .filter(|r| r.scope == scope)
        .ok_or("归档回执已失效，请重新校验归档。")?;
    Ok((receipt.path.clone(), receipt.manifest.clone()))
}
#[tauri::command]
pub async fn local_archive_open_restored(
    app: AppHandle,
    scope: String,
    receipt_id: String,
    document_id: String,
) -> Result<(), String> {
    let (root, manifest) = completed(&scope, &receipt_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = archive::verify_document(&root, &manifest, &document_id)?;
        check(&scope)?;
        crate::native_open::enqueue_argv(
            &app,
            [std::ffi::OsString::from("Liteasy"), path.into_os_string()],
            &root,
        );
        Ok(())
    })
    .await
    .map_err(|_| "无法打开恢复后的原文。".to_string())?
}
#[tauri::command]
pub fn local_archive_reveal(scope: String, receipt_id: String) -> Result<(), String> {
    let (root, _) = completed(&scope, &receipt_id)?;
    crate::data_location::reveal(&root)
}
#[tauri::command]
pub async fn local_archive_read_note(
    scope: String,
    receipt_id: String,
    note_id: String,
) -> Result<String, String> {
    let (root, manifest) = completed(&scope, &receipt_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = manifest
            .notes
            .iter()
            .find(|note| note.id == note_id)
            .map(|note| &note.path)
            .or_else(|| {
                manifest
                    .documents
                    .iter()
                    .find(|doc| doc.id == note_id)
                    .map(|doc| &doc.note)
            })
            .ok_or("归档笔记不存在。")?;
        let entry = manifest
            .files
            .iter()
            .find(|file| &file.path == path)
            .ok_or("归档笔记没有校验信息。")?;
        let bytes = archive::metadata_bytes(&SourceInput {
            root,
            relative: path.clone(),
        })?;
        if archive::digest(&bytes) != entry.sha256 {
            return Err("恢复后的笔记已外部修改，请通过打开 Markdown 阅读当前版本。".into());
        }
        check(&scope)?;
        String::from_utf8(bytes).map_err(|_| "归档笔记不是有效的 UTF-8 文本。".into())
    })
    .await
    .map_err(|_| "归档笔记读取未完成。".to_string())?
}
