//! Process-local, exact-file read grants issued only from trusted native selections.
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::OsString,
    fs::{self, File, Metadata},
    io::{Read, Seek},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_OPEN_FILES: usize = 256;
const MAX_PENDING_FILES: usize = 32;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFile {
    pub id: String,
    pub path: String,
    pub file_name: String,
    pub format: String,
    pub size_bytes: u64,
    pub modified_unix_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct OpenError {
    pub code: String,
    pub message: String,
}

#[derive(Default, Serialize)]
pub struct OpenBatch {
    pub files: Vec<OpenFile>,
    pub errors: Vec<OpenError>,
}

struct Grant {
    scope: String,
    path: PathBuf,
    file: File,
    selected_metadata: Metadata,
    #[cfg(windows)]
    selected_identity: (u32, u64),
    descriptor: OpenFile,
}

#[derive(Default)]
pub struct OpenFiles {
    grants: HashMap<String, Grant>,
    pending: HashMap<String, OpenBatch>,
}

fn link_like(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn unchanged(left: &Metadata, right: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if left.dev() != right.dev() || left.ino() != right.ino() {
            return false;
        }
    }
    left.len() == right.len() && left.modified().ok() == right.modified().ok()
}

#[cfg(windows)]
fn file_identity(file: &File) -> Result<(u32, u64), String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: File owns a live handle and information points to writable storage
    // of the exact Win32 structure type for the duration of this synchronous call.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) } == 0 {
        return Err("无法确认原文件身份，请重新选择。".into());
    }
    Ok((
        information.dwVolumeSerialNumber,
        (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow),
    ))
}

#[cfg(windows)]
fn verify_path_identity(path: &Path, selected_identity: (u32, u64)) -> Result<(), String> {
    // A fresh handle detects atomic replacement even when size and mtime match.
    // Never fall back to metadata equality if the identity API is unavailable.
    let current = File::open(path).map_err(|_| "原文件不可用，请重新选择。")?;
    if file_identity(&current)? != selected_identity {
        return Err("原文件已更改或移动，请重新选择。".into());
    }
    Ok(())
}

fn file_metadata(path: &Path) -> Result<Metadata, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "原文件不可用，请重新选择。")?;
    if link_like(&metadata) || !metadata.is_file() {
        return Err("请选择普通文件，不能直接打开文件夹或符号链接。".into());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err("直接打开的文件不能超过 100 MiB。".into());
    }
    Ok(metadata)
}

impl OpenFiles {
    pub fn retain_scope(&mut self, scope: &str) {
        self.grants.retain(|_, grant| grant.scope == scope);
        self.pending.retain(|owner, _| owner == scope);
    }

    pub fn enqueue_current(
        &mut self,
        scope: &str,
        current_scope: &str,
        paths: Vec<PathBuf>,
    ) -> bool {
        if scope != current_scope {
            return false;
        }
        self.retain_scope(scope);
        self.enqueue(scope, paths);
        true
    }

    pub fn select(&mut self, scope: &str, selected: &Path) -> Result<OpenFile, String> {
        file_metadata(selected)?;
        let path = selected
            .canonicalize()
            .map_err(|_| "原文件不可用，请重新选择。")?;
        let metadata = file_metadata(&path)?;
        let format = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(format.as_str(), "pdf" | "epub") {
            return Err("直接打开支持 PDF 和 EPUB；Markdown 请使用打开 Markdown。".into());
        }
        let mut file = File::open(&path).map_err(|_| "无法读取原文件，请检查权限后重新选择。")?;
        let opened_metadata = file.metadata().map_err(|_| "无法读取原文件信息。")?;
        #[cfg(windows)]
        let selected_identity = file_identity(&file)?;
        #[cfg(windows)]
        verify_path_identity(&path, selected_identity)?;
        if !unchanged(&metadata, &opened_metadata) {
            return Err("原文件在打开时发生变化，请重新选择。".into());
        }
        let mut signature = [0_u8; 1024];
        let count = file.read(&mut signature).map_err(|_| "无法读取原文件。")?;
        if (format == "pdf" && !signature[..count].windows(5).any(|bytes| bytes == b"%PDF-"))
            || (format == "epub" && !signature[..count].starts_with(b"PK\x03\x04"))
        {
            return Err("文件内容与扩展名不符，无法打开。".into());
        }
        if let Some(existing) = self.grants.values().find(|grant| {
            #[cfg(windows)]
            if grant.selected_identity != selected_identity {
                return false;
            }
            grant.scope == scope
                && grant.path == path
                && unchanged(&grant.selected_metadata, &opened_metadata)
        }) {
            return Ok(existing.descriptor.clone());
        }
        if self.grants.len() >= MAX_OPEN_FILES {
            return Err("本次会话已打开过多原文件，请关闭部分文件后重试。".into());
        }
        let mut random = [0_u8; 16];
        SystemRandom::new()
            .fill(&mut random)
            .map_err(|_| "无法创建文件读取授权。")?;
        let id = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let descriptor = OpenFile {
            id: id.clone(),
            path: path
                .to_str()
                .ok_or("文件路径不是有效的 Unicode。")?
                .to_string(),
            file_name: path
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or("文件名称无效。")?
                .to_string(),
            format,
            size_bytes: opened_metadata.len(),
            modified_unix_ms: opened_metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0),
        };
        self.grants.insert(
            id,
            Grant {
                scope: scope.to_string(),
                path,
                file,
                selected_metadata: opened_metadata,
                #[cfg(windows)]
                selected_identity,
                descriptor: descriptor.clone(),
            },
        );
        Ok(descriptor)
    }

    pub fn read(&mut self, scope: &str, id: &str) -> Result<Vec<u8>, String> {
        let grant = self
            .grants
            .get_mut(id)
            .filter(|grant| grant.scope == scope)
            .ok_or("原文件读取授权已失效，请重新选择。")?;
        let current = file_metadata(&grant.path)?;
        if grant.path.canonicalize().ok().as_ref() != Some(&grant.path)
            || !unchanged(&grant.selected_metadata, &current)
        {
            return Err("原文件已更改或移动，请重新选择。".into());
        }
        #[cfg(windows)]
        verify_path_identity(&grant.path, grant.selected_identity)?;
        grant.file.rewind().map_err(|_| "无法读取原文件。")?;
        let mut bytes = Vec::with_capacity(grant.descriptor.size_bytes as usize);
        Read::by_ref(&mut grant.file)
            .take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "无法读取原文件。")?;
        let after = grant.file.metadata().map_err(|_| "无法读取原文件信息。")?;
        if bytes.len() as u64 != grant.descriptor.size_bytes
            || !unchanged(&grant.selected_metadata, &after)
        {
            return Err("原文件在读取时发生变化，请重新选择。".into());
        }
        #[cfg(windows)]
        verify_path_identity(&grant.path, grant.selected_identity)?;
        Ok(bytes)
    }

    pub fn release(&mut self, scope: &str, id: &str) {
        if self
            .grants
            .get(id)
            .is_some_and(|grant| grant.scope == scope)
        {
            self.grants.remove(id);
            if let Some(batch) = self.pending.get_mut(scope) {
                batch.files.retain(|file| file.id != id);
            }
        }
    }

    pub fn enqueue(&mut self, scope: &str, paths: Vec<PathBuf>) {
        for (index, path) in paths.into_iter().take(MAX_PENDING_FILES + 1).enumerate() {
            let pending = self.pending.entry(scope.to_string()).or_default();
            if index >= MAX_PENDING_FILES
                || pending.files.len() + pending.errors.len() >= MAX_PENDING_FILES
            {
                if pending
                    .errors
                    .last()
                    .is_none_or(|error| error.code != "native_open_queue_full")
                {
                    pending.errors.push(OpenError {
                        code: "native_open_queue_full".into(),
                        message: "一次最多打开 32 个文件，其余文件请重新选择。".into(),
                    });
                }
                break;
            }
            let result = self.select(scope, &path);
            let pending = self.pending.entry(scope.to_string()).or_default();
            match result {
                Ok(file) => {
                    if !pending.files.iter().any(|queued| queued.id == file.id) {
                        pending.files.push(file);
                    }
                }
                Err(message) => pending.errors.push(OpenError {
                    code: "native_open_rejected".into(),
                    message,
                }),
            }
        }
    }

    pub fn drain(&mut self, scope: &str) -> OpenBatch {
        // Only the verified current native principal may call this boundary.
        // Retire undisplayed grants too, so returning to an old scope cannot reopen them.
        self.retain_scope(scope);
        self.pending.remove(scope).unwrap_or_default()
    }
}

/// argv[0] is the executable. An unknown option stops positional parsing until `--`.
/// OAuth/HTTP URLs belong to their existing handlers and never become file grants.
pub fn paths_from_argv(argv: impl IntoIterator<Item = OsString>, cwd: &Path) -> Vec<PathBuf> {
    let mut positional = true;
    let mut after_separator = false;
    argv.into_iter()
        .skip(1)
        .filter_map(|argument| {
            if argument == "--" {
                positional = true;
                after_separator = true;
                return None;
            }
            if !after_separator
                && argument
                    .to_str()
                    .is_some_and(|value| value.starts_with('-'))
            {
                positional = false;
                return None;
            }
            if !positional {
                return None;
            }
            if let Some(value) = argument.to_str().filter(|value| value.contains("://")) {
                return path_from_url(&url::Url::parse(value).ok()?);
            }
            let path = PathBuf::from(argument);
            if path.as_os_str().is_empty() {
                return None;
            }
            Some(if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            })
        })
        .take(MAX_PENDING_FILES + 1)
        .collect()
}

pub fn path_from_url(url: &url::Url) -> Option<PathBuf> {
    (url.scheme() == "file"
        && url.host_str().is_none_or(|host| host == "localhost")
        && url.query().is_none()
        && url.fragment().is_none())
    .then(|| url.to_file_path().ok())
    .flatten()
}
