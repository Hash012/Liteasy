use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
pub type Files = BTreeMap<String, Option<FileVersion>>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileVersion {
    pub hash: String,
    pub size: u64,
    pub document_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    pub files: Files,
}
impl Default for Manifest {
    fn default() -> Self {
        Self {
            schema_version: 1,
            files: Files::new(),
        }
    }
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

// Portable names also prevent traversal on Windows when a manifest was produced on Unix.
pub fn allowed_path(path: &str) -> bool {
    if path.len() > 1024
        || path.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part.ends_with(['.', ' '])
                || part
                    .chars()
                    .any(|c| c.is_control() || "\\:*?\"<>|".contains(c))
                || matches!(
                    part.split('.')
                        .next()
                        .unwrap_or("")
                        .to_ascii_uppercase()
                        .as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
    {
        return false;
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts[0] == ".liteasy" {
        return (parts.len() == 3 && parts[1] == "metadata-entries" && path.ends_with(".json"))
            || (parts.len() == 4 && parts[1] == "paper-artifacts" && path.ends_with(".v1.json"));
    }
    parts.iter().all(|p| !p.starts_with('.')) && path.to_ascii_lowercase().ends_with(".pdf")
}

impl Manifest {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.files.len() > 100_000 {
            return Err("不支持的同步清单版本或清单过大。".into());
        }
        let mut names = std::collections::HashSet::new();
        let mut ids = std::collections::HashSet::new();
        for (path, version) in &self.files {
            if !allowed_path(path) || !names.insert(path.to_lowercase()) {
                return Err("同步清单包含不安全或大小写冲突的路径。".into());
            }
            if let Some(v) = version {
                if v.hash.len() != 64
                    || !v
                        .hash
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    || v.size > MAX_FILE_BYTES
                {
                    return Err("同步文件校验信息无效或文件超过 256 MiB。".into());
                }
                let pdf = path.to_ascii_lowercase().ends_with(".pdf");
                if pdf != v.document_id.is_some() {
                    return Err("同步文件缺少文献身份信息。".into());
                }
                if let Some(id) = &v.document_id {
                    if id.is_empty()
                        || id.len() > 128
                        || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                        || !ids.insert(id)
                    {
                        return Err("同步文献身份信息无效或重复。".into());
                    }
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Action {
    Equal,
    Upload,
    Download,
    Conflict,
}
pub fn action(
    base: Option<&FileVersion>,
    local: Option<&FileVersion>,
    remote: Option<&FileVersion>,
) -> Action {
    if local == remote {
        Action::Equal
    } else if local == base {
        Action::Download
    } else if remote == base {
        Action::Upload
    } else {
        Action::Conflict
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(n: u8) -> FileVersion {
        FileVersion {
            hash: digest(&[n]),
            size: 1,
            document_id: Some("doc-1".into()),
        }
    }
    #[test]
    fn three_way_merge_handles_edits_deletes_and_first_sync() {
        let a = v(1);
        let b = v(2);
        let c = v(3);
        for (base, local, remote, expected) in [
            (None, Some(&a), None, Action::Upload),
            (None, None, Some(&a), Action::Download),
            (Some(&a), Some(&b), Some(&a), Action::Upload),
            (Some(&a), Some(&a), Some(&b), Action::Download),
            (Some(&a), None, Some(&a), Action::Upload),
            (Some(&a), Some(&a), None, Action::Download),
            (Some(&a), None, Some(&b), Action::Conflict),
            (Some(&a), Some(&b), None, Action::Conflict),
            (Some(&a), Some(&b), Some(&c), Action::Conflict),
            (None, Some(&a), Some(&b), Action::Conflict),
            (Some(&a), Some(&b), Some(&b), Action::Equal),
            (Some(&a), None, None, Action::Equal),
        ] {
            assert_eq!(action(base, local, remote), expected);
        }
    }
    #[test]
    fn paths_exclude_private_data_and_traversal() {
        for p in [
            "../x.pdf",
            "/x.pdf",
            "a\\b.pdf",
            "a//b.pdf",
            "C:/x.pdf",
            "NUL.pdf",
            "a./x.pdf",
            ".liteasy/index/x.json",
            ".liteasy/webdav/state.json",
            ".secret/x.pdf",
        ] {
            assert!(!allowed_path(p), "{p}");
        }
        for p in [
            "中文目录/文章.pdf",
            ".liteasy/metadata-entries/doc-1.json",
            ".liteasy/paper-artifacts/doc-1/annotations.v1.json",
        ] {
            assert!(allowed_path(p), "{p}");
        }
    }
    #[test]
    fn manifest_rejects_unsafe_hash_version_and_duplicate_identity() {
        let mut m = Manifest::default();
        m.files.insert("a.pdf".into(), Some(v(1)));
        assert!(m.validate().is_ok());
        m.files.insert("b.pdf".into(), Some(v(2)));
        assert!(m.validate().is_err());
        m.files.remove("b.pdf");
        m.files.get_mut("a.pdf").unwrap().as_mut().unwrap().hash = "../x".into();
        assert!(m.validate().is_err());
        m.schema_version = 2;
        assert!(m.validate().is_err());
    }
}
