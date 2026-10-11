use super::{
    local,
    model::{FileVersion, Files, Manifest},
    transport::Remote,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::Path};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PendingFile {
    pub version: FileVersion,
    pub cached_hash: Option<String>,
    #[serde(default)]
    pub cached_version: Option<FileVersion>,
}
pub(super) type Pending = BTreeMap<String, PendingFile>;

pub(super) fn is_attachment(path: &str) -> bool {
    !path.starts_with('.')
        || (path.starts_with(".liteasy/sync-data/objects/")
            && path.split('/').nth(4) == Some("assets"))
        || (path.starts_with(".liteasy/paper-artifacts/")
            && ![
                "/annotations.v1.json",
                "/file-metadata.v1.json",
                "/bibliographic-identity.v1.json",
                "/literature-resolution.v1.json",
            ]
            .iter()
            .any(|suffix| path.ends_with(suffix)))
}
fn state_path(root: &Path, key: &str) -> Result<std::path::PathBuf, String> {
    Ok(local::state_directory(root)?.join(format!("pending-{key}.json")))
}
pub(super) fn load(root: &Path, key: &str) -> Result<Pending, String> {
    let path = state_path(root, key)?;
    if !path.exists() {
        return Ok(Pending::new());
    }
    let pending: Pending = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "附件下载状态损坏。")?;
    Manifest {
        schema_version: 2,
        files: pending
            .iter()
            .map(|(p, v)| (p.clone(), Some(v.version.clone())))
            .collect(),
    }
    .validate()?;
    for path in pending.keys() {
        local::safe_path(root, path)?;
    }
    Ok(pending)
}
pub(super) fn save(root: &Path, key: &str, pending: &Pending) -> Result<(), String> {
    local::save_json(&state_path(root, key)?, pending)
}
// A remote-only attachment is a known version, not a locally deleted file.
// Keep actual local edits in the three-way comparison instead of hiding them.
pub(super) fn overlay(root: &Path, files: &mut Files, pending: &Pending) -> Result<(), String> {
    for (path, entry) in pending {
        if local::current_hash(root, path)? == entry.cached_hash {
            files.insert(path.clone(), Some(entry.version.clone()));
        }
    }
    Ok(())
}
pub(crate) fn library_entries(
    root: &Path,
) -> Result<Vec<crate::local_library::LocalLibraryEntry>, String> {
    let key = if root.join(".liteasy/webdav/settings.json").exists() {
        super::load_settings(root)?.key()
    } else {
        let last = root.join(".liteasy/webdav/last-connection.json");
        if !last.exists() {
            return Ok(Vec::new());
        }
        let key: String = serde_json::from_slice(&fs::read(last).map_err(|e| e.to_string())?)
            .map_err(|_| "同步库状态损坏")?;
        if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("同步库状态无效".into());
        }
        key
    };
    let mut entries = Vec::new();
    for (relative, pending) in load(root, &key)? {
        let Some(id) = pending.version.document_id else {
            continue;
        };
        if local::current_hash(root, &relative)? != pending.cached_hash {
            continue;
        }
        let path = local::safe_path(root, &relative)?;
        entries.push(crate::local_library::LocalLibraryEntry {
            id,
            content_hash: Some(pending.version.hash),
            path: Some(path.to_string_lossy().into()),
            title: path
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("文献")
                .into(),
            relative_path: Some(relative),
        });
    }
    Ok(entries)
}
pub(super) async fn download(
    root: &Path,
    key: &str,
    remote: &Remote,
    relative: &str,
    apply: impl Fn(&str, Option<&str>, &FileVersion, &[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let mut pending = load(root, key)?;
    let paths = paths(root, key, relative)?;
    for path in paths {
        let entry = pending[&path].clone();
        let actual = local::current_hash(root, &path)?;
        if actual.as_deref() != Some(&entry.version.hash) {
            if actual != entry.cached_hash {
                return Err("本地附件已修改，请先同步并处理冲突。".into());
            }
            let bytes = remote
                .download(&entry.version.hash, entry.version.size)
                .await?;
            apply(&path, entry.cached_hash.as_deref(), &entry.version, &bytes)?;
        }
        pending.remove(&path);
        save(root, key, &pending)?;
    }
    Ok(())
}

pub(super) fn paths(root: &Path, key: &str, relative: &str) -> Result<Vec<String>, String> {
    let pending = load(root, key)?;
    let mut document_id = pending
        .get(relative)
        .and_then(|p| p.version.document_id.clone());
    let baseline = local::state_directory(root)?.join(format!("baseline-{key}.json"));
    if document_id.is_none() && baseline.exists() {
        document_id = Manifest::from_bytes(&fs::read(baseline).map_err(|e| e.to_string())?)?
            .files
            .get(relative)
            .and_then(Option::as_ref)
            .and_then(|v| v.document_id.clone());
    }
    let prefix = document_id
        .as_deref()
        .map(crate::user_paper_store::paper_artifact_directory_name)
        .transpose()?
        .map(|directory| format!(".liteasy/paper-artifacts/{directory}/"));
    Ok(pending
        .keys()
        .filter(|p| {
            p.as_str() == relative || prefix.as_ref().is_some_and(|prefix| p.starts_with(prefix))
        })
        .cloned()
        .collect())
}

pub(crate) fn attachment_version(
    root: &Path,
    relative: &str,
) -> Result<Option<FileVersion>, String> {
    if !root.join(".liteasy/webdav/settings.json").exists() {
        return Ok(None);
    }
    let settings = super::load_settings(root)?;
    Ok(load(root, &settings.key())?
        .get(relative)
        .map(|entry| entry.version.clone()))
}
