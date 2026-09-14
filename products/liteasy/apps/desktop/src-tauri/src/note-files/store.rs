//! User-selected grants and UTF-8 files. No renderer-provided absolute path is accepted.
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
fn read_text(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| format!("无法读取笔记文件：{e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_BYTES {
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
        })
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
            if fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err("授权文件已变为符号链接，请重新选择。".into());
            }
            return Ok(root);
        }
        if !root.is_dir()
            || fs::symlink_metadata(&root)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
        {
            return Err("连接的文件夹已移动，请重新连接。".into());
        }
        let mut target = root;
        for part in path.split('/') {
            target.push(part);
            match fs::symlink_metadata(&target) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
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
                    || !(file_type.is_dir() || file_type.is_file() && supported(&item.path()))
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
                    walk(root, &item.path(), id, depth + 1, out)?;
                }
            }
            Ok(())
        }
        walk(root, root, id, 0, &mut result)?;
        result.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(result)
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
