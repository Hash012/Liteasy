//! User-selected grants and UTF-8 files. No renderer-provided absolute path is accepted.
#[path = "operations.rs"]
pub(crate) mod operations;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_BYTES: u64 = 8 * 1024 * 1024;
static NONCE: AtomicU64 = AtomicU64::new(0);
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mount {
    pub id: String,
    pub name: String,
    pub location: String,
    pub kind: String,
    #[serde(default)]
    pub managed: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub mount_id: String,
    pub path: String,
    pub name: String,
    pub kind: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot {
    #[serde(flatten)]
    pub entry: Entry,
    pub text: String,
    pub version: Option<String>,
}
pub struct FileStore {
    connection: Connection,
    scope: String,
    managed_root: PathBuf,
    mirrored_root: PathBuf,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn nonce() -> String {
    format!(
        "{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NONCE.fetch_add(1, Ordering::Relaxed)
    )
}
pub fn validate_path(path: &str, file: bool) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 8192
        || path
            .chars()
            .any(|c| c.is_control() || "\\:*?\"<>|".contains(c))
        || path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == ".." || p.ends_with('.') || p.ends_with(' '))
    {
        return Err("文件路径无效，请使用所选文件夹内的相对路径。".into());
    }
    if file && !supported(Path::new(path)) {
        return Err("仅支持 Markdown 和 Canvas 文件。".into());
    }
    Ok(())
}
fn supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md" | "markdown" | "canvas")
    )
}
fn link_like(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Includes junctions and other reparse points, not only symbolic links.
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}
fn read_text(path: &Path) -> Result<String, String> {
    let selected = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if link_like(&selected) || !selected.is_file() {
        return Err("仅支持普通笔记文件，不读取链接、设备或管道。".into());
    }
    let file = fs::File::open(path).map_err(|e| format!("无法读取笔记文件：{e}"))?;
    let opened = file.metadata().map_err(|e| e.to_string())?;
    if !opened.is_file() || opened.len() > MAX_BYTES {
        return Err("单个笔记文件不能超过 8 MB。".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("单个笔记文件不能超过 8 MB。".into());
    }
    String::from_utf8(bytes).map_err(|_| "笔记文件不是 UTF-8，请先转换编码。".into())
}
#[cfg(not(windows))]
fn replace(temp: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temp, target).map_err(|e| e.to_string())
}
#[cfg(windows)]
fn replace(temp: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let dest: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            dest.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}
impl FileStore {
    /// Only application-owned Canvas grants follow an approved data-root migration.
    /// External selections keep their original exact path and authorization.
    pub fn remap_managed_grants(&self, remap: impl Fn(&Path) -> PathBuf) -> Result<(), String> {
        for mount in self.mounts()? {
            let old = Path::new(&mount.location);
            let next = remap(old);
            if next == old
                || !(next.starts_with(&self.managed_root) || next.starts_with(&self.mirrored_root))
            {
                continue;
            }
            if next
                .canonicalize()
                .map_err(|_| "迁移后的白板文件不可用。")?
                != next
            {
                return Err("迁移后的白板授权路径不能经过符号链接。".into());
            }
            self.connection
                .execute(
                    "UPDATE grants SET path=?1 WHERE scope=?2 AND id=?3 AND path=?4",
                    params![next.to_string_lossy(), self.scope, mount.id, mount.location],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn open(app_data: &Path, scope: &str) -> Result<Self, String> {
        let root = app_data.join("note-files");
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let connection =
            Connection::open(root.join("grants.v1.sqlite3")).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS grants(scope TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(scope,id), UNIQUE(scope,path,kind));").map_err(|e| e.to_string())?;
        Ok(Self {
            connection,
            scope: scope.into(),
            managed_root: app_data.join("boards").join(hash(scope.as_bytes())),
            mirrored_root: app_data.join("synced-boards").join(hash(scope.as_bytes())),
        })
    }
    pub fn workspace_state(&self, id: &str) -> Result<serde_json::Value, String> {
        let mount = self.mount(id)?;
        if mount.kind != "directory" {
            return Ok(serde_json::Value::Null);
        }
        let root = fs::canonicalize(&mount.location).map_err(|e| e.to_string())?;
        let path = root.join(".obsidian").join("workspace.json");
        if !path.exists() {
            return Ok(serde_json::Value::Null);
        }
        let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
        if !path.starts_with(&root) {
            return Err("工作区记录不在所选文件夹内。".into());
        }
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 1024 * 1024 {
            return Ok(serde_json::Value::Null);
        }
        // Obsidian may be in the middle of saving the advisory workspace record.
        Ok(serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null))
    }
    pub fn mounts(&self) -> Result<Vec<Mount>, String> {
        let mut query = self
            .connection
            .prepare("SELECT id,path,kind FROM grants WHERE scope=?1 ORDER BY path")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map(params![self.scope], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.map(|row| {
            let (id, location, kind) = row.map_err(|e| e.to_string())?;
            let name = Path::new(&location)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            Ok(Mount {
                managed: fs::canonicalize(&self.managed_root)
                    .is_ok_and(|root| Path::new(&location).starts_with(&root))
                    || fs::canonicalize(&self.mirrored_root)
                        .is_ok_and(|root| Path::new(&location).starts_with(&root)),
                id,
                location,
                kind,
                name,
            })
        })
        .collect()
    }
    fn mount(&self, id: &str) -> Result<Mount, String> {
        self.mounts()?
            .into_iter()
            .find(|m| m.id == id)
            .ok_or_else(|| "找不到已连接的文件夹，请重新连接。".into())
    }
    pub fn register(&self, selected: &Path, kind: &str) -> Result<Mount, String> {
        if kind != "file" && kind != "directory" {
            return Err("文件授权类型无效。".into());
        }
        let absolute = if selected.exists() {
            fs::canonicalize(selected).map_err(|e| e.to_string())?
        } else {
            fs::canonicalize(selected.parent().ok_or("文件缺少父目录")?)
                .map_err(|e| e.to_string())?
                .join(selected.file_name().ok_or("文件名称无效")?)
        };
        if kind == "directory" && !absolute.is_dir() {
            return Err("请选择文件夹。".into());
        }
        if kind == "file" && (!supported(&absolute) || absolute.is_dir()) {
            return Err("请选择 Markdown 或 Canvas 文件。".into());
        }
        let location = absolute
            .to_str()
            .ok_or("路径不是有效的 Unicode")?
            .to_owned();
        let mounts = self.mounts()?;
        if let Some(existing) = mounts
            .into_iter()
            .find(|m| m.location == location && m.kind == kind)
        {
            return Ok(existing);
        }
        let mount = Mount {
            managed: fs::canonicalize(&self.managed_root)
                .is_ok_and(|root| absolute.starts_with(&root)),
            id: hash(nonce().as_bytes()),
            name: absolute
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            location,
            kind: kind.into(),
        };
        self.connection
            .execute(
                "INSERT INTO grants(scope,id,path,kind) VALUES(?1,?2,?3,?4)",
                params![self.scope, mount.id, mount.location, mount.kind],
            )
            .map_err(|e| e.to_string())?;
        Ok(mount)
    }
    /// Application-owned Canvas files live under the configured data root and
    /// account. The renderer cannot nominate an absolute path or another account.
    pub fn managed_canvas(&self, object_id: &str) -> Result<Snapshot, String> {
        if object_id.is_empty() || object_id.len() > 512 {
            return Err("白板标识无效。".into());
        }
        fs::create_dir_all(&self.managed_root).map_err(|e| e.to_string())?;
        let mount = self.register(&self.managed_root, "directory")?;
        let path = format!("{}.canvas", hash(object_id.as_bytes()));
        let target = self.resolve(&mount.id, &path, true)?;
        if target.exists() {
            self.read(&mount.id, &path)
        } else {
            Ok(Snapshot {
                entry: Entry {
                    mount_id: mount.id,
                    name: path.clone(),
                    path,
                    kind: "file".into(),
                },
                text: String::new(),
                version: None,
            })
        }
    }
    pub fn location(&self, id: &str, path: &str) -> Result<PathBuf, String> {
        let result = self.resolve(id, path, true)?;
        if !result.is_file() {
            return Err("文件已移动或不可用。".into());
        }
        Ok(result)
    }
    fn resolve(&self, id: &str, path: &str, file: bool) -> Result<PathBuf, String> {
        validate_path(path, file)?;
        let grant = self.mount(id)?;
        let root = PathBuf::from(&grant.location);
        let authority = if grant.kind == "file" {
            root.parent().ok_or("文件缺少父目录")?
        } else {
            root.as_path()
        };
        if fs::canonicalize(authority).map_err(|e| format!("连接的路径不可用：{e}"))? != authority
        {
            return Err("授权路径已移动或变为符号链接，请重新连接。".into());
        }
        if grant.kind == "file" {
            if path != grant.name || !file {
                return Err("请选择此文件所在的 Vault 文件夹，以读取其中的引用。".into());
            }
            if fs::symlink_metadata(&root).is_ok_and(|m| link_like(&m)) {
                return Err("授权文件已变为符号链接，请重新选择。".into());
            }
            return Ok(root);
        }
        if !root.is_dir() || link_like(&fs::symlink_metadata(&root).map_err(|e| e.to_string())?) {
            return Err("连接的文件夹已移动，请重新连接。".into());
        }
        let mut target = root;
        for part in path.split('/') {
            target.push(part);
            match fs::symlink_metadata(&target) {
                Ok(metadata) if link_like(&metadata) => {
                    return Err("不读取或写入文件夹内的符号链接。".into())
                }
                Ok(_) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(target)
    }
    pub fn entries(&self, id: &str) -> Result<Vec<Entry>, String> {
        self.asset_entries(id, false)
    }
    pub fn asset_entries(&self, id: &str, include_images: bool) -> Result<Vec<Entry>, String> {
        let mount = self.mount(id)?;
        if mount.kind == "file" {
            return Ok(vec![Entry {
                mount_id: id.into(),
                path: mount.name.clone(),
                name: mount.name,
                kind: "file".into(),
            }]);
        }
        let root = Path::new(&mount.location);
        if fs::canonicalize(root).map_err(|e| e.to_string())? != root {
            return Err("授权路径已移动或变为符号链接，请重新连接。".into());
        }
        if fs::symlink_metadata(root)
            .map_err(|e| format!("无法读取文件夹：{e}"))?
            .file_type()
            .is_symlink()
        {
            return Err("连接的文件夹已移动，请重新连接。".into());
        }
        let mut result = Vec::new();
        fn walk(
            root: &Path,
            directory: &Path,
            id: &str,
            depth: usize,
            out: &mut Vec<Entry>,
            include_images: bool,
        ) -> Result<(), String> {
            if depth > 64 {
                return Err("文件夹层级超过 64 层，请连接较小的子目录。".into());
            }
            for item in fs::read_dir(directory).map_err(|e| format!("无法读取文件夹：{e}"))?
            {
                let item = item.map_err(|e| e.to_string())?;
                let name = item.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                let file_type = item.file_type().map_err(|e| e.to_string())?;
                if file_type.is_symlink()
                    || !(file_type.is_dir()
                        || file_type.is_file()
                            && (supported(&item.path())
                                || include_images
                                    && matches!(
                                        item.path()
                                            .extension()
                                            .and_then(|value| value.to_str())
                                            .map(str::to_ascii_lowercase)
                                            .as_deref(),
                                        Some("png" | "jpg" | "jpeg" | "gif" | "webp")
                                    )))
                {
                    continue;
                }
                if out.len() >= 10000 {
                    return Err("文件夹超过 10000 个条目，请连接较小的子目录。".into());
                }
                let path = item
                    .path()
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(Entry {
                    mount_id: id.into(),
                    path,
                    name,
                    kind: if file_type.is_dir() {
                        "directory"
                    } else {
                        "file"
                    }
                    .into(),
                });
                if file_type.is_dir() {
                    walk(root, &item.path(), id, depth + 1, out, include_images)?;
                }
            }
            Ok(())
        }
        walk(root, root, id, 0, &mut result, include_images)?;
        result.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(result)
    }
    pub fn read_image(&self, id: &str, path: &str) -> Result<serde_json::Value, String> {
        let media_type = match Path::new(path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => return Err("仅支持 PNG、JPEG、GIF 和 WebP 图片。".into()),
        };
        // Directory grants only. Reuse canonical-root and symlink checks; never expand a file grant to siblings.
        let target = self.resolve(id, path, false)?;
        let file = fs::File::open(target).map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() > MAX_BYTES {
            return Err("图片不能超过 8 MB。".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("图片不能超过 8 MB。".into());
        }
        let valid = match media_type {
            "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            "image/jpeg" => bytes.starts_with(&[255, 216, 255]),
            "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
            "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
            _ => false,
        };
        if !valid {
            return Err("图片格式与内容不一致。".into());
        }
        Ok(
            serde_json::json!({ "mediaType": media_type, "base64": STANDARD.encode(&bytes), "byteLength": bytes.len() }),
        )
    }
    pub fn read(&self, id: &str, path: &str) -> Result<Snapshot, String> {
        let target = self.resolve(id, path, true)?;
        let text = read_text(&target)?;
        Ok(Snapshot {
            entry: Entry {
                mount_id: id.into(),
                path: path.into(),
                name: target
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                kind: "file".into(),
            },
            version: Some(hash(text.as_bytes())),
            text,
        })
    }
    pub fn selected_file(&self, selected: &Path) -> Result<Snapshot, String> {
        let canonical = if selected.exists() {
            fs::canonicalize(selected).map_err(|e| e.to_string())?
        } else {
            fs::canonicalize(selected.parent().ok_or("文件缺少父目录")?)
                .map_err(|e| e.to_string())?
                .join(selected.file_name().ok_or("文件名称无效")?)
        };
        let matching = self
            .mounts()?
            .into_iter()
            .filter(|m| m.kind == "directory" && canonical.starts_with(&m.location))
            .max_by_key(|m| m.location.len());
        let (mount, path) = if let Some(mount) = matching {
            let path = canonical
                .strip_prefix(&mount.location)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            (mount, path)
        } else {
            let mount = self.register(&canonical, "file")?;
            let path = mount.name.clone();
            (mount, path)
        };
        if canonical.exists() {
            self.read(&mount.id, &path)
        } else {
            Ok(Snapshot {
                entry: Entry {
                    mount_id: mount.id,
                    path,
                    name: canonical
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    kind: "file".into(),
                },
                text: String::new(),
                version: None,
            })
        }
    }
    pub fn write(
        &self,
        id: &str,
        path: &str,
        text: &str,
        expected: Option<&str>,
    ) -> Result<Snapshot, String> {
        if text.len() as u64 > MAX_BYTES {
            return Err("单个笔记文件不能超过 8 MB。".into());
        }
        let target = self.resolve(id, path, true)?;
        let before = if target.exists() {
            Some(hash(read_text(&target)?.as_bytes()))
        } else {
            None
        };
        if before.as_deref() != expected {
            return Err("文件已在其他应用中修改，请重新打开后再保存；本次修改尚未写入。".into());
        }
        let parent = target.parent().ok_or("文件缺少父目录")?;
        if !parent.is_dir() {
            return Err("目标文件夹不存在，请先创建文件夹。".into());
        }
        let temp = parent.join(format!(".liteasy-{}.tmp", nonce()));
        let result = (|| {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|e| e.to_string())?;
            if let Ok(metadata) = fs::metadata(&target) {
                output
                    .set_permissions(metadata.permissions())
                    .map_err(|e| e.to_string())?;
            }
            output
                .write_all(text.as_bytes())
                .and_then(|_| output.sync_all())
                .map_err(|e| e.to_string())?;
            drop(output);
            self.resolve(id, path, true)?;
            if before.is_none() {
                // Atomic create-if-absent: another application cannot be overwritten by a new note.
                match fs::hard_link(&temp, &target) {
                    Ok(()) => (),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                        return Err("同名文件已存在，请重新选择文件名。".into())
                    }
                    Err(_) => {
                        // Removable/FAT filesystems may not support hard links.
                        // Exclusive creation still never overwrites another file.
                        let mut created = OpenOptions::new()
                            .write(true)
                            .create_new(true)
                            .open(&target)
                            .map_err(|e| format!("无法创建文件，目标可能已存在：{e}"))?;
                        if let Err(error) = created
                            .write_all(text.as_bytes())
                            .and_then(|_| created.sync_all())
                        {
                            drop(created);
                            let _ = fs::remove_file(&target);
                            return Err(format!("无法写入新文件：{error}"));
                        }
                    }
                }
                fs::remove_file(&temp).map_err(|e| e.to_string())?;
            } else {
                if Some(hash(read_text(&target)?.as_bytes())).as_deref() != expected {
                    return Err("文件已在其他应用中修改，请重新打开后再保存。".into());
                }
                replace(&temp, &target)?;
            }
            #[cfg(unix)]
            {
                fs::File::open(parent)
                    .and_then(|file| file.sync_all())
                    .map_err(|e| e.to_string())?;
            }
            self.read(id, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
    pub fn create_directory(&self, id: &str, path: &str) -> Result<(), String> {
        let target = self.resolve(id, path, false)?;
        fs::create_dir_all(&target).map_err(|e| format!("无法创建文件夹：{e}"))
    }
    pub fn import_file(selected: &Path) -> Result<serde_json::Value, String> {
        if !supported(selected) {
            return Err("仅支持 Markdown 和 Canvas 文件。".into());
        }
        let name = selected
            .file_name()
            .ok_or("文件名称无效")?
            .to_string_lossy();
        Ok(serde_json::json!({"name":name,"path":name,"text":read_text(selected)?}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn workspace() -> PathBuf {
        let root = std::env::temp_dir().join(format!("liteasy-notefiles-{}", nonce()));
        fs::create_dir_all(root.join("vault")).unwrap();
        root
    }
    #[test]
    fn managed_canvas_grant_follows_approved_root_migration_but_external_selection_does_not() {
        let root = workspace().canonicalize().unwrap();
        let old = root.join("old");
        let new = root.join("new");
        let store = FileStore::open(&old, "local").unwrap();
        let canvas = store.managed_canvas("board-id").unwrap();
        store
            .write(
                &canvas.entry.mount_id,
                &canvas.entry.path,
                "{\"nodes\":[],\"edges\":[]}",
                None,
            )
            .unwrap();
        let external = store.register(&root.join("vault"), "directory").unwrap();
        drop(store);
        fs::create_dir_all(new.join("note-files")).unwrap();
        fs::copy(
            old.join("note-files/grants.v1.sqlite3"),
            new.join("note-files/grants.v1.sqlite3"),
        )
        .unwrap();
        let managed = PathBuf::from("boards").join(hash(b"local"));
        fs::create_dir_all(new.join(&managed)).unwrap();
        fs::copy(
            old.join(&managed).join(&canvas.entry.path),
            new.join(&managed).join(&canvas.entry.path),
        )
        .unwrap();
        let moved = FileStore::open(&new, "local").unwrap();
        moved
            .remap_managed_grants(|path| {
                path.strip_prefix(&old)
                    .map(|p| new.join(p))
                    .unwrap_or_else(|_| path.to_path_buf())
            })
            .unwrap();
        assert_eq!(
            moved
                .read(&canvas.entry.mount_id, &canvas.entry.path)
                .unwrap()
                .text,
            "{\"nodes\":[],\"edges\":[]}"
        );
        assert!(moved
            .location(&canvas.entry.mount_id, &canvas.entry.path)
            .unwrap()
            .starts_with(&new));
        assert_eq!(
            moved.mount(&external.id).unwrap().location,
            external.location
        );
        assert!(old.join(&managed).join(&canvas.entry.path).is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn images_require_directory_grants_valid_content_and_bounded_paths() {
        let root = workspace();
        let files = FileStore::open(&root, "image-user").unwrap();
        fs::write(root.join("vault/figure.png"), b"\x89PNG\r\n\x1a\nimage").unwrap();
        fs::write(root.join("vault/invalid.png"), b"not an image").unwrap();
        fs::write(root.join("vault/note.md"), "a note").unwrap();
        let directory = files.register(&root.join("vault"), "directory").unwrap();
        assert_eq!(
            files.read_image(&directory.id, "figure.png").unwrap()["mediaType"],
            "image/png"
        );
        assert!(files.read_image(&directory.id, "invalid.png").is_err());
        assert!(files.read_image(&directory.id, "../figure.png").is_err());
        assert!(files.read_image(&directory.id, "note.md").is_err());
        let single = files.register(&root.join("vault/note.md"), "file").unwrap();
        assert!(files.read_image(&single.id, "figure.png").is_err());
        fs::remove_dir_all(root).ok();
    }
    #[test]
    fn sync_restores_external_hierarchy_and_managed_canvas_without_original_paths() {
        let a = workspace();
        let b = workspace();
        let source = FileStore::open(&a, "alice").unwrap();
        let target = FileStore::open(&b, "alice").unwrap();
        fs::create_dir_all(a.join("vault/research/deep")).unwrap();
        fs::create_dir_all(a.join("vault/.obsidian")).unwrap();
        fs::write(a.join("vault/research/deep/CicN.md"), "# A note").unwrap();
        fs::write(a.join("vault/research/figure.png"), b"image").unwrap();
        fs::write(a.join("vault/.obsidian/workspace.json"), b"private state").unwrap();
        let mount = source.register(&a.join("vault"), "directory").unwrap();
        let snapshot = source.sync_export(&mount.id).unwrap();
        assert!(!snapshot.to_string().contains(&mount.location));
        assert!(!snapshot.to_string().contains(".obsidian"));
        target.sync_import(&b, &snapshot, None).unwrap();
        assert_eq!(
            target
                .read(&mount.id, "research/deep/CicN.md")
                .unwrap()
                .text,
            "# A note"
        );
        assert_eq!(target.sync_export(&mount.id).unwrap(), snapshot);
        let mirrored = target.mount(&mount.id).unwrap();
        assert!(Path::new(&mirrored.location).starts_with(b.canonicalize().unwrap()));
        assert!(!mirrored.managed);
        let board = source.managed_canvas("board").unwrap();
        source
            .write(
                &board.entry.mount_id,
                &board.entry.path,
                "{\"nodes\":[],\"edges\":[]}",
                None,
            )
            .unwrap();
        // A device with its own managed root can also register the remote grant.
        target.managed_canvas("local board").unwrap();
        let canvas = source.sync_export(&board.entry.mount_id).unwrap();
        target.sync_import(&b, &canvas, None).unwrap();
        assert!(target.mount(&board.entry.mount_id).unwrap().managed);
        assert_eq!(target.sync_export(&board.entry.mount_id).unwrap(), canvas);
        fs::remove_file(a.join("vault/research/figure.png")).unwrap();
        fs::write(a.join("vault/research/deep/CicN.md"), "# Updated").unwrap();
        let updated = source.sync_export(&mount.id).unwrap();
        target.sync_import(&b, &updated, Some(&snapshot)).unwrap();
        assert_eq!(target.sync_export(&mount.id).unwrap(), updated);
        fs::write(
            Path::new(&mirrored.location).join("research/deep/CicN.md"),
            "local Obsidian edit",
        )
        .unwrap();
        assert!(target.sync_import(&b, &snapshot, Some(&updated)).is_err());
        assert_eq!(
            target
                .read(&mount.id, "research/deep/CicN.md")
                .unwrap()
                .text,
            "local Obsidian edit"
        );
        let mut hostile = snapshot.clone();
        hostile["files"]["../escape.md"] = serde_json::json!("eA==");
        assert!(target.sync_import(&b, &hostile, None).is_err());
        assert!(!b.join("escape.md").exists());
        drop(source);
        drop(target);
        fs::remove_dir_all(a).unwrap();
        fs::remove_dir_all(b).unwrap();
    }
    #[test]
    fn managed_canvas_is_durable_scope_isolated_and_checks_external_edits() {
        let root = workspace();
        let store = FileStore::open(&root, "alice").unwrap();
        let initial = store.managed_canvas("board-id").unwrap();
        assert!(initial.version.is_none());
        let saved = store
            .write(
                &initial.entry.mount_id,
                &initial.entry.path,
                "{\"nodes\":[],\"edges\":[]}\n",
                None,
            )
            .unwrap();
        assert!(store.mounts().unwrap()[0].managed);
        let path = store
            .location(&saved.entry.mount_id, &saved.entry.path)
            .unwrap();
        assert!(path.starts_with(fs::canonicalize(root.join("boards")).unwrap()));
        drop(store);
        let store = FileStore::open(&root, "alice").unwrap();
        assert_eq!(
            store.managed_canvas("board-id").unwrap().version,
            saved.version
        );
        let other = FileStore::open(&root, "bob").unwrap();
        assert!(other
            .read(&saved.entry.mount_id, &saved.entry.path)
            .is_err());
        assert!(other.managed_canvas("board-id").unwrap().version.is_none());
        fs::write(path, "{\"nodes\":[],\"edges\":[],\"external\":true}").unwrap();
        assert!(store
            .write(
                &saved.entry.mount_id,
                &saved.entry.path,
                "{}",
                saved.version.as_deref()
            )
            .is_err());
        drop(other);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn workspace_probe_is_bounded_and_scope_isolated() {
        let root = workspace();
        let store = FileStore::open(&root, "a").unwrap();
        let mount = store.register(&root.join("vault"), "directory").unwrap();
        assert!(store.workspace_state(&mount.id).unwrap().is_null());
        let config = root.join("vault/.obsidian");
        fs::create_dir(&config).unwrap();
        let json = r#"{"main":{"type":"markdown","state":{"file":"paper.md","mode":"source"}}}"#;
        fs::write(config.join("workspace.json"), json).unwrap();
        assert_eq!(
            store.workspace_state(&mount.id).unwrap()["main"]["state"]["file"],
            "paper.md"
        );
        assert!(FileStore::open(&root, "b")
            .unwrap()
            .workspace_state(&mount.id)
            .is_err());
        fs::write(config.join("workspace.json"), vec![b' '; 1024 * 1024 + 1]).unwrap();
        assert!(store.workspace_state(&mount.id).unwrap().is_null());
        fs::write(config.join("workspace.json"), b"{partial").unwrap();
        assert!(store.workspace_state(&mount.id).unwrap().is_null());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn workspace_probe_rejects_symlinks_outside_vault() {
        let root = workspace();
        let store = FileStore::open(&root, "a").unwrap();
        let mount = store.register(&root.join("vault"), "directory").unwrap();
        fs::create_dir(root.join("private-config")).unwrap();
        fs::write(root.join("private-config/workspace.json"), "{}").unwrap();
        std::os::unix::fs::symlink(root.join("private-config"), root.join("vault/.obsidian"))
            .unwrap();
        assert!(store.workspace_state(&mount.id).is_err());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn grants_and_utf8_files_survive_reopen_and_are_scope_isolated() {
        let root = workspace();
        let store = FileStore::open(&root, "a").unwrap();
        let mount = store.register(&root.join("vault"), "directory").unwrap();
        store.create_directory(&mount.id, "paper").unwrap();
        let saved = store
            .write(&mount.id, "paper/我的笔记.md", "# 原文\n\nReview", None)
            .unwrap();
        drop(store);
        let restored = FileStore::open(&root, "a").unwrap();
        assert_eq!(
            restored.read(&mount.id, &saved.entry.path).unwrap().text,
            saved.text
        );
        assert!(FileStore::open(&root, "b")
            .unwrap()
            .read(&mount.id, &saved.entry.path)
            .is_err());
        // Windows cannot remove SQLite files while a connection is open.
        drop(restored);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn nested_directories_can_be_ensured_for_multiple_imports() {
        let root = workspace();
        let store = FileStore::open(&root, "a").unwrap();
        let mount = store.register(&root.join("vault"), "directory").unwrap();
        for name in ["one.md", "two.md"] {
            store.create_directory(&mount.id, "Imported/sub").unwrap();
            store
                .write(&mount.id, &format!("Imported/sub/{name}"), name, None)
                .unwrap();
        }
        assert_eq!(store.entries(&mount.id).unwrap().len(), 4);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn replacing_an_ancestor_cannot_redirect_a_grant() {
        let root = workspace();
        fs::create_dir_all(root.join("original/vault")).unwrap();
        fs::create_dir_all(root.join("replacement/vault")).unwrap();
        fs::write(root.join("replacement/vault/note.md"), "outside").unwrap();
        let store = FileStore::open(&root, "a").unwrap();
        let mount = store
            .register(&root.join("original/vault"), "directory")
            .unwrap();
        fs::rename(root.join("original"), root.join("moved")).unwrap();
        std::os::unix::fs::symlink(root.join("replacement"), root.join("original")).unwrap();
        assert!(store.read(&mount.id, "note.md").is_err());
        assert!(store.write(&mount.id, "new.md", "wrong", None).is_err());
        assert!(store.entries(&mount.id).is_err());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn stale_writes_and_duplicate_creates_preserve_external_content() {
        let root = workspace();
        let store = FileStore::open(&root, "a").unwrap();
        let mount = store.register(&root.join("vault"), "directory").unwrap();
        let saved = store.write(&mount.id, "note.md", "first", None).unwrap();
        fs::write(root.join("vault/note.md"), "Obsidian edit").unwrap();
        assert!(store
            .write(&mount.id, "note.md", "stale", saved.version.as_deref())
            .is_err());
        assert!(store
            .write(&mount.id, "note.md", "duplicate", None)
            .is_err());
        assert_eq!(
            store.read(&mount.id, "note.md").unwrap().text,
            "Obsidian edit"
        );
        assert_eq!(fs::read_dir(root.join("vault")).unwrap().count(), 1);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn paths_cannot_escape_and_file_grants_are_limited() {
        let root = workspace();
        fs::write(root.join("vault/board.canvas"), "{}").unwrap();
        let store = FileStore::open(&root, "a").unwrap();
        let selected = store
            .selected_file(&root.join("vault/board.canvas"))
            .unwrap();
        assert!(store
            .write(&selected.entry.mount_id, "other.md", "bad", None)
            .is_err());
        for path in [
            "../out.md",
            "/tmp/out.md",
            "a/../out.md",
            "C:/out.md",
            "a\\out.md",
        ] {
            assert!(store.read(&selected.entry.mount_id, path).is_err());
        }
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn vault_grant_is_reused_and_lists_only_notes() {
        let root = workspace();
        let store = FileStore::open(&root, "a").unwrap();
        let mount = store.register(&root.join("vault"), "directory").unwrap();
        fs::write(root.join("vault/a.md"), "a").unwrap();
        fs::write(root.join("vault/.secret.md"), "hidden").unwrap();
        fs::write(root.join("vault/image.png"), "image").unwrap();
        assert_eq!(
            store
                .selected_file(&root.join("vault/a.md"))
                .unwrap()
                .entry
                .mount_id,
            mount.id
        );
        assert_eq!(store.entries(&mount.id).unwrap().len(), 1);
        assert_eq!(store.asset_entries(&mount.id, true).unwrap().len(), 2);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_cross_grants() {
        let root = workspace();
        let store = FileStore::open(&root, "a").unwrap();
        let mount = store.register(&root.join("vault"), "directory").unwrap();
        fs::write(root.join("outside.md"), "outside").unwrap();
        std::os::unix::fs::symlink(root.join("outside.md"), root.join("vault/link.md")).unwrap();
        assert!(store.read(&mount.id, "link.md").is_err());
        assert!(store.write(&mount.id, "link.md", "bad", None).is_err());
        assert!(store.entries(&mount.id).unwrap().is_empty());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
}

impl FileStore {
    /// Export a grant without its machine-specific location or Obsidian state.
    pub(crate) fn sync_export(&self, id: &str) -> Result<serde_json::Value, String> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let mount = self.mount(id)?;
        let mut files = std::collections::BTreeMap::new();
        let mut total = 0usize;
        fn walk(
            root: &Path,
            dir: &Path,
            files: &mut std::collections::BTreeMap<String, String>,
            total: &mut usize,
        ) -> Result<(), String> {
            for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                let path = entry.path();
                let relative = path
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace(std::path::MAIN_SEPARATOR, "/");
                // This also rejects symlinks and Windows reparse points, including directories.
                let checked = crate::webdav::local::checked_path(root, &relative)?;
                if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                    walk(root, &checked, files, total)?;
                } else if crate::webdav::model::allowed_path(&relative) {
                    let bytes =
                        crate::webdav::local::read_file(&checked)?.ok_or("笔记已移除，请重试")?;
                    *total += bytes.len() * 4 / 3;
                    if *total > 128 * 1024 * 1024 || files.len() >= 100_000 {
                        return Err("单个外部目录同步内容超过 128 MiB，请拆分目录。".into());
                    }
                    files.insert(relative, STANDARD.encode(bytes));
                }
            }
            Ok(())
        }
        let location = Path::new(&mount.location);
        if fs::canonicalize(location).map_err(|e| e.to_string())? != location {
            return Err("连接目录位置已变化，请重新连接后同步。".into());
        }
        if mount.kind == "directory" {
            walk(location, location, &mut files, &mut total)?;
        } else if let Some(bytes) = crate::webdav::local::read_file(location)? {
            files.insert(mount.name.clone(), STANDARD.encode(bytes));
        }
        Ok(
            serde_json::json!({"version":1,"id":mount.id,"name":if mount.managed {"Boards"} else {&mount.name},"kind":mount.kind,"managed":mount.managed,"files":files}),
        )
    }
    pub(crate) fn sync_import(
        &self,
        app_data: &Path,
        value: &serde_json::Value,
        previous: Option<&serde_json::Value>,
    ) -> Result<(), String> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let id = value["id"].as_str().ok_or("缺少笔记目录标识")?;
        let name = value["name"].as_str().ok_or("缺少笔记目录名称")?;
        let kind = value["kind"].as_str().ok_or("缺少目录类型")?;
        if value["version"] != 1
            || id.len() != 64
            || !id.bytes().all(|b| b.is_ascii_hexdigit())
            || !matches!(kind, "file" | "directory")
        {
            return Err("笔记目录同步格式无效。".into());
        }
        validate_path(name, false)?;
        if name.contains('/') {
            return Err("笔记目录名称无效。".into());
        }
        let files = value["files"].as_object().ok_or("缺少笔记文件")?;
        let managed = value["managed"].as_bool().ok_or("缺少目录来源")?;
        let existing = self.mounts()?.into_iter().find(|m| m.id == id);
        let target = existing
            .as_ref()
            .map(|m| PathBuf::from(&m.location))
            .unwrap_or_else(|| {
                if managed {
                    self.mirrored_root.join(id)
                } else {
                    app_data
                        .join("synced-external")
                        .join(hash(self.scope.as_bytes()))
                        .join(id)
                        .join(name)
                }
            });
        if existing
            .as_ref()
            .is_some_and(|m| m.kind != kind || m.managed != managed)
        {
            return Err("笔记同步目录类型冲突。".into());
        }
        if existing.is_some() {
            if fs::canonicalize(&target).map_err(|e| e.to_string())? != target {
                return Err("连接目录位置已变化，请重新连接后同步。".into());
            }
        } else {
            let relative = target
                .strip_prefix(app_data)
                .map_err(|_| "恢复目录必须位于 Liteasy 数据目录")?
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/");
            crate::webdav::local::checked_path(app_data, &relative)?;
        }
        // Validate the entire payload before touching any user file.
        if files.len() > 100_000 {
            return Err("笔记同步文件过多".into());
        }
        let mut names = std::collections::HashSet::new();
        let mut decoded = Vec::new();
        for (path, encoded) in files {
            if !crate::webdav::model::allowed_path(path)
                || path.starts_with('.')
                || !names.insert(path.to_lowercase())
                || (kind == "file" && path != name)
            {
                return Err("笔记同步路径无效。".into());
            }
            let bytes = STANDARD
                .decode(encoded.as_str().ok_or("笔记编码无效")?)
                .map_err(|_| "笔记编码无效")?;
            let destination = if kind == "file" {
                target.clone()
            } else {
                crate::webdav::local::safe_path(&target, path)?
            };
            let actual = crate::webdav::local::read_file(&destination)?;
            let expected = previous
                .and_then(|p| p["files"].get(path))
                .and_then(|v| v.as_str())
                .map(|s| STANDARD.decode(s).map_err(|_| "旧笔记编码无效"))
                .transpose()?;
            if actual != expected && actual.as_deref() != Some(bytes.as_slice()) {
                return Err(format!("笔记在恢复期间被编辑，已保留：{path}"));
            }
            decoded.push((destination, bytes));
        }
        if kind == "directory" {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(target.parent().ok_or("笔记路径无效")?)
                .map_err(|e| e.to_string())?;
        }
        for (path, bytes) in decoded {
            crate::local_library::write_bytes_atomically(&path, &bytes)?;
        }
        if let Some(old_files) = previous.and_then(|p| p["files"].as_object()) {
            for (path, encoded) in old_files
                .iter()
                .filter(|(path, _)| !files.contains_key(*path))
            {
                if !crate::webdav::model::allowed_path(path) || path.starts_with('.') {
                    return Err("旧笔记路径无效".into());
                }
                let destination = if kind == "file" {
                    target.clone()
                } else {
                    crate::webdav::local::safe_path(&target, path)?
                };
                if let Some(actual) = crate::webdav::local::read_file(&destination)? {
                    let expected = STANDARD
                        .decode(encoded.as_str().ok_or("旧笔记编码无效")?)
                        .map_err(|_| "旧笔记编码无效")?;
                    if actual != expected {
                        return Err(format!("笔记删除前被编辑，已保留：{path}"));
                    }
                    fs::remove_file(destination).map_err(|e| e.to_string())?;
                }
            }
        }
        // Register only our restored location; never trust an absolute path from a peer.
        let location = fs::canonicalize(&target)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
        self.connection.execute("INSERT INTO grants(scope,id,path,kind) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,id) DO UPDATE SET path=excluded.path,kind=excluded.kind",params![self.scope,id,location,kind]).map_err(|e| e.to_string())?;
        Ok(())
    }
}
