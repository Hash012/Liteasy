//! One deterministic operation over existing picker grants. The GUI sends plan IDs,
//! never file bodies, absolute paths, shell commands, or an alternate capability.
use super::{hash, link_like, nonce, FileStore, MAX_BYTES};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, fs, path::Path};

const ACTION: &str = "local_files.copy";
const MAX_ITEMS: usize = 100;
const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItem {
    source_path: String,
    output_path: String,
    source_revision: String,
    source_identity: String,
    byte_length: u64,
    status: String,
    attempts: u32,
    receipt_revision: Option<String>,
    receipt_identity: Option<String>,
    backup_path: Option<String>,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyTask {
    id: String,
    action_id: String,
    idempotency_key: String,
    request_digest: String,
    plan_digest: String,
    source_mount_id: String,
    destination_mount_id: String,
    source_root: String,
    destination_root: String,
    source_root_identity: String,
    destination_root_identity: String,
    output_directory: String,
    output_identity: Option<String>,
    confirmed: bool,
    cancelled: bool,
    paused_on_failure: bool,
    undo_requested: bool,
    status: String,
    total_bytes: u64,
    items: Vec<CopyItem>,
}

fn text<'a>(request: &'a Value, key: &str) -> Result<&'a str, String> {
    request[key]
        .as_str()
        .ok_or_else(|| format!("缺少文件任务参数：{key}"))
}

fn identity(path: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if link_like(&metadata) {
        return Err("拒绝符号链接或重解析路径，请重新选择普通文件夹。".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
    }
    #[cfg(windows)]
    {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(0x02000000 | 0x00200000) // BACKUP_SEMANTICS | OPEN_REPARSE_POINT
            .open(path)
            .map_err(|e| e.to_string())?;
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        // SAFETY: a live owned handle and writable exact Win32 structure.
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err("无法确认文件身份，请重新选择。".into());
        }
        if info.dwFileAttributes & 0x400 != 0 {
            return Err("拒绝重解析路径。".into());
        }
        Ok(format!(
            "{}:{}:{}",
            info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
        ))
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err("此平台尚不支持受控文件复制。".into())
    }
}

impl FileStore {
    fn operation_schema(&self) -> Result<(), String> {
        self.connection.execute_batch("CREATE TABLE IF NOT EXISTS file_operation_tasks(scope TEXT NOT NULL, id TEXT NOT NULL, idempotency_key TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(scope,id), UNIQUE(scope,idempotency_key));").map_err(|e| e.to_string())
    }
    fn save_operation(&self, task: &CopyTask) -> Result<(), String> {
        // Each intent/receipt is an independent synchronous=FULL SQLite commit.
        // A transaction spanning filesystem I/O would roll back the crash intent.
        self.connection.execute("INSERT INTO file_operation_tasks(scope,id,idempotency_key,document) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,id) DO UPDATE SET document=excluded.document", params![self.scope, task.id, task.idempotency_key, serde_json::to_string(task).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(())
    }
    fn load_operation(&self, id: &str) -> Result<CopyTask, String> {
        let raw: String = self
            .connection
            .query_row(
                "SELECT document FROM file_operation_tasks WHERE scope=?1 AND id=?2",
                params![self.scope, id],
                |row| row.get(0),
            )
            .map_err(|_| "文件任务不存在或不属于当前账号。")?;
        serde_json::from_str(&raw).map_err(|_| "文件任务日志损坏，未执行任何写入。".into())
    }
    fn operation_roots(&self, task: &CopyTask) -> Result<(), String> {
        for (id, expected_path, expected_identity) in [
            (
                &task.source_mount_id,
                &task.source_root,
                &task.source_root_identity,
            ),
            (
                &task.destination_mount_id,
                &task.destination_root,
                &task.destination_root_identity,
            ),
        ] {
            let mount = self.mount(id)?;
            if mount.kind != "directory"
                || &mount.location != expected_path
                || identity(Path::new(&mount.location))? != *expected_identity
            {
                return Err("授权文件夹已替换或移动，请重新生成计划。".into());
            }
            // Reuse grant/path validation, including canonical authority checks.
            self.resolve(id, &task.output_directory, false)?;
        }
        Ok(())
    }
    fn refresh_operation_status(task: &mut CopyTask) {
        task.status = if task.undo_requested && task.cancelled {
            "cancelled"
        } else if task.undo_requested {
            if task
                .items
                .iter()
                .any(|item| matches!(item.status.as_str(), "committed" | "undoing"))
            {
                "undoing"
            } else if task
                .items
                .iter()
                .any(|item| matches!(item.status.as_str(), "undo_conflict" | "uncertain"))
            {
                "partial"
            } else {
                "undone"
            }
        } else if !task.confirmed {
            "preview"
        } else if task.items.iter().all(|item| item.status == "committed") {
            "completed"
        } else if task.cancelled {
            "cancelled"
        } else if task.paused_on_failure {
            "partial"
        } else if task
            .items
            .iter()
            .any(|item| matches!(item.status.as_str(), "pending" | "committing"))
        {
            "running"
        } else {
            "partial"
        }
        .into();
    }
    fn recover_operation(&self, task: &mut CopyTask) -> Result<(), String> {
        let mut changed = false;
        for item in &mut task.items {
            if item.status == "committing" {
                let output = self.resolve(&task.destination_mount_id, &item.output_path, true);
                item.status = match output {
                    Ok(path)
                        if fs::symlink_metadata(&path)
                            .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound) =>
                    {
                        "pending"
                    }
                    _ => "uncertain",
                }
                .into();
                item.message = Some(
                    "上次提交中断。已存在的输出保留且不会重复写入或自动撤销；请核对输出。".into(),
                );
                changed = true;
            }
            if item.status == "undoing" {
                // Never guess that a moved file is still ours after a process exit.
                item.status = "undo_conflict".into();
                item.message =
                    Some("撤销中断；原位置和回执中的备份位置均保留，请手动核对。".into());
                changed = true;
            }
        }
        if changed {
            // Loading a task never resumes writes automatically.
            task.cancelled = true;
            Self::refresh_operation_status(task);
            self.save_operation(task)?;
        }
        Ok(())
    }
    fn plan_copy(&self, request: &Value) -> Result<CopyTask, String> {
        let key = text(request, "idempotencyKey")?;
        if key.is_empty() || key.len() > 128 {
            return Err("幂等键无效。".into());
        }
        let source = self.mount(text(request, "sourceMountId")?)?;
        let destination = self.mount(text(request, "destinationMountId")?)?;
        if source.kind != "directory"
            || destination.kind != "directory"
            || source.managed
            || destination.managed
        {
            return Err("请通过文件夹选择器授权普通来源和输出文件夹。".into());
        }
        let paths: Vec<String> =
            serde_json::from_value(request["paths"].clone()).map_err(|_| "文件列表无效。")?;
        if paths.is_empty() || paths.len() > MAX_ITEMS {
            return Err("每个任务请选择 1–100 个文件。".into());
        }
        let request_digest = hash(
            serde_json::to_string(&json!([source.id, destination.id, paths]))
                .map_err(|e| e.to_string())?
                .as_bytes(),
        );
        let existing: Option<String> = self
            .connection
            .query_row(
                "SELECT id FROM file_operation_tasks WHERE scope=?1 AND idempotency_key=?2",
                params![self.scope, key],
                |row| row.get(0),
            )
            .ok();
        if let Some(id) = existing {
            let task = self.load_operation(&id)?;
            return if task.request_digest == request_digest {
                Ok(task)
            } else {
                Err("此幂等键已绑定另一份计划。".into())
            };
        }
        let id = format!("copy-{}", nonce());
        let directory = format!("Liteasy-{id}");
        let mut task = CopyTask {
            id,
            action_id: ACTION.into(),
            idempotency_key: key.into(),
            request_digest,
            plan_digest: String::new(),
            source_mount_id: source.id,
            destination_mount_id: destination.id,
            source_root_identity: identity(Path::new(&source.location))?,
            destination_root_identity: identity(Path::new(&destination.location))?,
            source_root: source.location,
            destination_root: destination.location,
            output_directory: directory,
            output_identity: None,
            confirmed: false,
            cancelled: false,
            paused_on_failure: false,
            undo_requested: false,
            status: "preview".into(),
            total_bytes: 0,
            items: vec![],
        };
        self.operation_roots(&task)?;
        let mut names = HashSet::new();
        for path in paths {
            let location = self.resolve(&task.source_mount_id, &path, true)?;
            let selected_identity = identity(&location)?;
            let snapshot = self.read(&task.source_mount_id, &path)?;
            if identity(&location)? != selected_identity {
                return Err("来源文件正在变化，请重新生成计划。".into());
            }
            let name = snapshot.entry.name;
            if !names.insert(name.to_lowercase()) {
                return Err("所选文件有同名输出，请分开复制。".into());
            }
            task.total_bytes += snapshot.text.len() as u64;
            if task.total_bytes > MAX_TOTAL_BYTES {
                return Err("每个任务的文件内容总计不能超过 32 MiB。".into());
            }
            task.items.push(CopyItem {
                source_path: path,
                output_path: format!("{}/{name}", task.output_directory),
                source_revision: snapshot.version.ok_or("来源文件不存在。")?,
                source_identity: selected_identity,
                byte_length: snapshot.text.len() as u64,
                status: "pending".into(),
                attempts: 0,
                receipt_revision: None,
                receipt_identity: None,
                backup_path: None,
                message: None,
            });
        }
        task.plan_digest = hash(
            serde_json::to_string(&task)
                .map_err(|e| e.to_string())?
                .as_bytes(),
        );
        self.save_operation(&task)?;
        Ok(task)
    }
    fn ensure_copy_directory(&self, task: &mut CopyTask) -> Result<(), String> {
        self.operation_roots(task)?;
        let directory = self.resolve(&task.destination_mount_id, &task.output_directory, false)?;
        if let Some(expected) = &task.output_identity {
            if identity(&directory)? != *expected {
                return Err("输出文件夹已被替换，本次未写入。".into());
            }
        } else {
            // Never adopt a pre-existing directory, including one left by an
            // interrupted create-before-receipt window.
            fs::create_dir(&directory)
                .map_err(|e| format!("无法新建输出文件夹（不会复用已有目录）：{e}"))?;
            task.output_identity = Some(identity(&directory)?);
            self.save_operation(task)?;
        }
        Ok(())
    }
    fn copy_one(
        &self,
        task: &mut CopyTask,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<(), String> {
        if task.status != "running" || task.cancelled || task.undo_requested {
            return Ok(());
        }
        let Some(index) = task.items.iter().position(|item| item.status == "pending") else {
            return Ok(());
        };
        let result = (|| {
            check()?;
            self.ensure_copy_directory(task)?;
            let item = &task.items[index];
            let location = self.resolve(&task.source_mount_id, &item.source_path, true)?;
            if identity(&location)? != item.source_identity {
                return Err("conflict: 来源文件已被替换，请重新生成计划。".into());
            }
            let snapshot = self.read(&task.source_mount_id, &item.source_path)?;
            if snapshot.version.as_deref() != Some(&item.source_revision)
                || identity(&location)? != item.source_identity
            {
                return Err("conflict: 来源文件已修改，请重新生成计划。".into());
            }
            // Record durable intent before FileStore stages and atomically creates
            // the output. Existing files are never overwritten (expected=None).
            task.items[index].attempts += 1;
            task.items[index].status = "committing".into();
            self.save_operation(task)?;
            check()?;
            self.operation_roots(task)?;
            self.ensure_copy_directory(task)?;
            if self
                .read(&task.source_mount_id, &task.items[index].source_path)?
                .version
                .as_deref()
                != Some(&task.items[index].source_revision)
            {
                return Err("conflict: 来源文件在暂存前发生变化，请重新生成计划。".into());
            }
            let output = self.write(
                &task.destination_mount_id,
                &task.items[index].output_path,
                &snapshot.text,
                None,
            )?;
            if output.version.as_deref() != Some(&task.items[index].source_revision) {
                return Err("输出在提交时发生变化，请核对文件。".into());
            }
            let item = &mut task.items[index];
            item.receipt_revision = output.version;
            item.receipt_identity = Some(identity(&self.resolve(
                &task.destination_mount_id,
                &item.output_path,
                true,
            )?)?);
            item.status = "committed".into();
            item.message = None;
            Ok::<_, String>(())
        })();
        if let Err(error) = result {
            let item = &mut task.items[index];
            // If a failed write left any output, ownership is ambiguous. Preserve
            // it and don't permit automatic undo of an unacknowledged write.
            let exists = self
                .resolve(&task.destination_mount_id, &item.output_path, true)
                .map(|path| fs::symlink_metadata(path).is_ok())
                .unwrap_or(true);
            item.status = if item.status == "committing" && exists {
                "uncertain"
            } else if error.starts_with("conflict:") {
                "conflict"
            } else {
                "failed"
            }
            .into();
            item.message = Some(error);
            task.paused_on_failure = true;
        }
        Self::refresh_operation_status(task);
        self.save_operation(task)
    }
    fn undo_one(
        &self,
        task: &mut CopyTask,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<(), String> {
        if !task.undo_requested {
            return Err("请先确认撤销计划。".into());
        }
        if task.cancelled {
            return Ok(());
        }
        let Some(index) = task
            .items
            .iter()
            .rposition(|item| item.status == "committed")
        else {
            return Ok(());
        };
        let result = (|| {
            check()?;
            self.operation_roots(task)?;
            self.ensure_copy_directory(task)?;
            let item = &task.items[index];
            let target = self.resolve(&task.destination_mount_id, &item.output_path, true)?;
            let current = self.read(&task.destination_mount_id, &item.output_path)?;
            if current.version != item.receipt_revision
                || Some(identity(&target)?) != item.receipt_identity
            {
                return Err("输出已被人工修改或替换，已保留，未撤销。".into());
            }
            let backup_path = format!(
                "{}/.liteasy-undo-{}-{}",
                task.output_directory,
                nonce(),
                current.entry.name
            );
            let backup = self.resolve(&task.destination_mount_id, &backup_path, true)?;
            if backup.exists() {
                return Err("撤销备份路径已存在。".into());
            }
            task.items[index].backup_path = Some(backup_path.clone());
            task.items[index].status = "undoing".into();
            self.save_operation(task)?;
            check()?;
            self.operation_roots(task)?;
            self.ensure_copy_directory(task)?;
            let current = self.read(&task.destination_mount_id, &task.items[index].output_path)?;
            if current.version != task.items[index].receipt_revision
                || Some(identity(&target)?) != task.items[index].receipt_identity
            {
                return Err("输出已被人工修改或替换，已保留，未撤销。".into());
            }
            // Archive rather than delete: even an external edit racing the last
            // check is retained in the recorded backup. No irreversible unlink.
            fs::rename(&target, &backup).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            fs::File::open(backup.parent().ok_or("备份缺少父目录。")?)
                .and_then(|directory| directory.sync_all())
                .map_err(|e| e.to_string())?;
            let archived = self.read(&task.destination_mount_id, &backup_path)?;
            if archived.version != task.items[index].receipt_revision {
                return Err(format!(
                    "撤销时检测到并发修改，内容保留于 {backup_path}；请手动核对。"
                ));
            }
            task.items[index].status = "undone".into();
            task.items[index].message = Some("输出已移入回执所列备份，未永久删除。".into());
            Ok::<_, String>(())
        })();
        if let Err(error) = result {
            task.items[index].status = "undo_conflict".into();
            task.items[index].message = Some(error);
        }
        Self::refresh_operation_status(task);
        self.save_operation(task)
    }
    /// FILE_LOCK in the existing native dispatch serializes all task mutations.
    /// One call commits at most one item so cancel/account checks run between items.
    pub fn file_operations(
        &self,
        request: &Value,
        check: &dyn Fn() -> Result<(), String>,
    ) -> Result<Value, String> {
        self.require_writable()?;
        check()?;
        self.operation_schema()?;
        let operation = text(request, "operation")?;
        if operation == "capabilities" {
            return Ok(
                json!({"actionId": ACTION, "formats": ["md", "markdown", "canvas"], "maxItems": MAX_ITEMS, "maxFileBytes": MAX_BYTES, "maxTotalBytes": MAX_TOTAL_BYTES, "concurrency": 1, "modelCalls": 0, "networkCalls": 0}),
            );
        }
        if operation == "plan" {
            return Ok(json!(self.plan_copy(request)?));
        }
        if operation == "list" {
            let mut statement = self.connection.prepare("SELECT id FROM file_operation_tasks WHERE scope=?1 ORDER BY rowid DESC LIMIT 50").map_err(|e| e.to_string())?;
            let ids: Vec<String> = statement
                .query_map([&self.scope], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;
            let mut tasks = Vec::new();
            for id in ids {
                let mut task = self.load_operation(&id)?;
                self.recover_operation(&mut task)?;
                tasks.push(task);
            }
            return Ok(json!(tasks));
        }
        let mut task = self.load_operation(text(request, "taskId")?)?;
        self.recover_operation(&mut task)?;
        match operation {
            "get" => (),
            "confirm" | "retry" | "confirmUndo" => {
                if text(request, "planDigest")? != task.plan_digest {
                    return Err("确认与当前计划不匹配，请重新预览。".into());
                }
                if operation == "confirmUndo" {
                    task.undo_requested = true;
                    task.cancelled = false;
                } else {
                    if task.undo_requested {
                        return Err("已进入撤销阶段，请新建复制计划。".into());
                    }
                    self.operation_roots(&task)?;
                    task.confirmed = true;
                    task.cancelled = false;
                    task.paused_on_failure = false;
                    if operation == "retry" {
                        for item in &mut task.items {
                            // A revision conflict needs a fresh preview, never
                            // silently reauthorize it while retrying other items.
                            if item.status == "failed" {
                                item.status = "pending".into();
                                item.message = None;
                            }
                        }
                    }
                }
                Self::refresh_operation_status(&mut task);
                self.save_operation(&task)?;
            }
            "cancel" => {
                task.cancelled = true;
                Self::refresh_operation_status(&mut task);
                self.save_operation(&task)?;
            }
            "step" => self.copy_one(&mut task, check)?,
            "undoStep" => self.undo_one(&mut task, check)?,
            _ => return Err("未注册的文件任务操作。".into()),
        }
        Ok(json!(task))
    }
}

#[cfg(test)]
#[path = "operations-tests.rs"]
mod tests;
