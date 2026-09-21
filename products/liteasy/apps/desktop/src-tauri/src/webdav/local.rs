use super::model::{allowed_path, digest, FileVersion, Files, MAX_FILE_BYTES};
use crate::local_library::write_bytes_atomically;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

pub fn safe_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !allowed_path(relative) {
        return Err("同步文件路径不安全。".into());
    }
    checked_path(root, relative)
}

fn checked_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(metadata) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err("同步路径包含目录联接。".into());
                    }
                }
                if metadata.file_type().is_symlink() {
                    return Err("同步路径包含符号链接。".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(path)
}

pub fn read_file(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => return Err("同步目标不是普通文件。".into()),
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    }
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("同步目标不是普通文件。".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("同步文件超过 256 MiB。".into());
    }
    Ok(Some(bytes))
}
pub fn current_hash(root: &Path, relative: &str) -> Result<Option<String>, String> {
    Ok(read_file(&safe_path(root, relative)?)?.map(|b| digest(&b)))
}
pub fn collect(root: &Path, directory: &Path, files: &mut Files) -> Result<(), String> {
    match fs::symlink_metadata(directory) {
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    }
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_str()
            .ok_or("同步文件名不是 UTF-8。")?
            .replace(std::path::MAIN_SEPARATOR, "/");
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            // Only authoritative library records. Never traverse credentials, cache, trash or sync state.
            if relative == ".liteasy"
                || relative == ".liteasy/metadata-entries"
                || relative == ".liteasy/paper-artifacts"
                || relative.starts_with(".liteasy/paper-artifacts/")
                || relative.split('/').all(|p| !p.starts_with('.'))
            {
                checked_path(root, &relative)?;
                collect(root, &path, files)?;
            }
        } else if allowed_path(&relative) {
            let bytes = read_file(&safe_path(root, &relative)?)?
                .ok_or("扫描时文件已被移除，请重新同步。")?;
            files.insert(
                relative,
                Some(FileVersion {
                    hash: digest(&bytes),
                    size: bytes.len() as u64,
                    document_id: None,
                }),
            );
        } else if relative.to_ascii_lowercase().ends_with(".pdf")
            && !relative.starts_with(".liteasy/")
        {
            return Err(format!("文件名不适合跨设备同步：{relative}"));
        }
    }
    Ok(())
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyJournal {
    pub path: String,
    pub version: Option<FileVersion>,
    pub previous_hash: Option<String>,
}
pub fn state_directory(root: &Path) -> Result<PathBuf, String> {
    let directory = root.join(".liteasy/webdav");
    for path in [root.join(".liteasy"), directory.clone()] {
        if let Ok(m) = fs::symlink_metadata(&path) {
            if m.file_type().is_symlink() || !m.is_dir() {
                return Err("同步状态目录不安全。".into());
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if m.file_attributes() & 0x400 != 0 {
                    return Err("同步状态目录包含目录联接。".into());
                }
            }
        }
    }
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_escape() {
        let root = std::env::temp_dir().join(format!("liteasy-webdav-link-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(std::env::temp_dir(), root.join("outside")).unwrap();
        assert!(safe_path(&root, "outside/file.pdf").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

pub fn save_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    write_bytes_atomically(path, &serde_json::to_vec(value).map_err(|e| e.to_string())?)
}
