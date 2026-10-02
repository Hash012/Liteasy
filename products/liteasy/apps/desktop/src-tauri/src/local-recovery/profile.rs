//! Private offline recovery profiles use the existing object/grant SQLite schemas.
//! Credentials, external authorizations and executable extension activation are excluded.
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions as FsOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_FILE: u64 = 1024 * 1024 * 1024;
const MAX_TOTAL: u64 = 16 * 1024 * 1024 * 1024;
const MAX_JSON: u64 = 128 * 1024 * 1024;
const MARKER: &str = ".liteasy-recovery-incomplete.json";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Row {
    pub key: String,
    pub version: String,
    pub value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant {
    pub id: String,
    pub relative: String,
    pub kind: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub version: u32,
    pub scope: String,
    pub rows: Vec<Row>,
    pub grants: Vec<Grant>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema: String,
    pub scope: String,
    pub files: Vec<Entry>,
    pub exclusions: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub schema: String,
    pub id: String,
    pub scope: String,
    pub root: String,
    pub local_only: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub profile_root: PathBuf,
    pub active_root: PathBuf,
    pub archived_scope: String,
}
enum Payload {
    Source(PathBuf, String),
    Bytes(Vec<u8>),
}
pub struct Plan {
    pub manifest: Manifest,
    pub target: PathBuf,
    pub restore: bool,
    files: BTreeMap<String, Payload>,
    source_state: Option<(PathBuf, String)>,
    inventories: Vec<(PathBuf, String, BTreeSet<String>)>,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn scope_valid(scope: &str) -> bool {
    scope == "local"
        || (scope.starts_with("user:")
            && scope.len() > 5
            && scope.len() <= 512
            && !scope.chars().any(char::is_control))
}
fn link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}
fn relative(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 2048
        && !path.contains(['\\', ':', '\0'])
        && path.split('/').all(|part| {
            let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty()
                && !matches!(part, "." | "..")
                && !part.ends_with([' ', '.'])
                && !part
                    .chars()
                    .any(|c| c.is_control() || "<>\"|?*".contains(c))
                && !matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                && !(base.len() == 4
                    && (base.starts_with("COM") || base.starts_with("LPT"))
                    && base.as_bytes()[3].is_ascii_digit())
        })
}
fn checked(root: &Path, path: &str) -> Result<PathBuf, String> {
    if !relative(path) || !root.is_absolute() {
        return Err("恢复路径无效。".into());
    }
    let root_meta = fs::symlink_metadata(root).map_err(|e| e.to_string())?;
    if link(&root_meta) || !root_meta.is_dir() {
        return Err("恢复根目录不能是链接。".into());
    }
    let mut next = root.to_path_buf();
    for part in path.split('/') {
        next.push(part);
        match fs::symlink_metadata(&next) {
            Ok(meta) if link(&meta) => return Err("恢复文件不能经过符号链接或目录联接。".into()),
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(next)
}
fn read(root: &Path, path: &str, limit: u64) -> Result<Vec<u8>, String> {
    let path = checked(root, path)?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("恢复文件类型或大小不受支持。".into());
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("恢复文件过大。".into());
    }
    Ok(bytes)
}
fn fingerprint(root: &Path, path: &str) -> Result<(u64, String), String> {
    let path = checked(root, path)?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_FILE {
        return Err("单文件超过 1 GiB 或不是普通文件。".into());
    }
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > MAX_FILE {
            return Err("单文件超过 1 GiB。".into());
        }
        hash.update(&buffer[..count]);
    }
    Ok((size, format!("{:x}", hash.finalize())))
}
fn admitted(key: &str) -> bool {
    [
        "head/",
        "revision/",
        "title/",
        "asset/",
        "relation/",
        "edge/",
        "placement/",
        "block-presentation/",
        "board-layout-history/",
        "visual-block/",
        "visual-block-type/",
        "legacy/",
        "migration/",
        "operation/",
        "run/",
        "snapshot/",
        "agent-state/",
        "object-file/",
        "board-file/",
        "object-attachment/",
        "workflow-run/",
        "workflow-snapshot/",
        "reader-state/",
        "extension-operation/",
    ]
    .iter()
    .any(|prefix| key.starts_with(prefix))
}
fn contains_credential(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, value)| {
            ([
                "apikey",
                "api_key",
                "accesstoken",
                "access_token",
                "refreshtoken",
                "refresh_token",
                "authorization",
                "password",
                "clientsecret",
                "client_secret",
            ]
            .contains(&key.to_ascii_lowercase().as_str())
                && value.as_str().is_some_and(|v| !v.is_empty()))
                || contains_credential(value)
        }),
        Value::Array(values) => values.iter().any(contains_credential),
        _ => false,
    }
}
pub fn logical_snapshot(data: &Path, scope: &str) -> Result<Snapshot, String> {
    if !scope_valid(scope) {
        return Err("恢复账户分区无效。".into());
    }
    let path = checked(data, "objects/objects.v1.sqlite3")?;
    let mut rows = Vec::new();
    if path.exists() {
        let mut db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut query = tx
            .prepare("SELECT key,version,value FROM object_records WHERE scope=?1 ORDER BY key")
            .map_err(|e| e.to_string())?;
        let records = query
            .query_map([scope], |row| {
                Ok(Row {
                    key: row.get(0)?,
                    version: row.get(1)?,
                    value: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut total = 0usize;
        for row in records {
            let row = row.map_err(|e| e.to_string())?;
            if !admitted(&row.key) {
                continue;
            }
            total += row.value.len();
            if rows.len() >= 100_000 || total as u64 > MAX_JSON {
                return Err("本次恢复快照超过 100000 条或 128 MiB。".into());
            }
            // Preserve malformed raw values for diagnosis rather than replacing them with emptiness.
            if let Ok(value) = serde_json::from_str::<Value>(&row.value) {
                if contains_credential(&value) {
                    return Err(format!(
                        "记录 {} 包含凭据字段，未导出；请先移除该记录中的凭据。",
                        row.key
                    ));
                }
            }
            rows.push(row);
        }
    }
    Ok(Snapshot {
        version: 1,
        scope: scope.into(),
        rows,
        grants: vec![],
    })
}
fn append(plan: &mut Plan, path: String, payload: Payload) -> Result<(), String> {
    if !relative(&path)
        || plan
            .files
            .keys()
            .any(|key| key.to_lowercase() == path.to_lowercase())
    {
        return Err("备份含重复或不兼容的文件路径。".into());
    }
    let (size, sha256) = match &payload {
        Payload::Source(root, relative) => fingerprint(root, relative)?,
        Payload::Bytes(bytes) => (bytes.len() as u64, digest(bytes)),
    };
    if size > MAX_FILE
        || plan.files.len() >= 100_000
        || plan.manifest.files.iter().map(|f| f.size).sum::<u64>() + size > MAX_TOTAL
    {
        return Err("本次备份超过 16 GiB 或 100000 个文件。".into());
    }
    plan.manifest.files.push(Entry {
        path: path.clone(),
        size,
        sha256,
    });
    plan.files.insert(path, payload);
    Ok(())
}
fn tree(plan: &mut Plan, root: &Path, source: &str, prefix: &str) -> Result<(), String> {
    let path = if source.is_empty() {
        root.to_path_buf()
    } else {
        checked(root, source)?
    };
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if link(&metadata) {
        return Err("备份不读取符号链接或目录联接。".into());
    }
    if metadata.is_file() {
        return append(
            plan,
            prefix.into(),
            Payload::Source(root.into(), source.into()),
        );
    }
    if !metadata.is_dir() {
        return Err("备份不读取特殊文件。".into());
    }
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "文件名必须是 Unicode。")?;
        let relative = if source.is_empty() {
            name.clone()
        } else {
            format!("{source}/{name}")
        };
        tree(plan, root, &relative, &format!("{prefix}/{name}"))?;
    }
    Ok(())
}
fn inventory(root: &Path, relative: &str) -> Result<BTreeSet<String>, String> {
    fn visit(root: &Path, relative: &str, entries: &mut BTreeSet<String>) -> Result<(), String> {
        let path = if relative.is_empty() {
            root.to_path_buf()
        } else {
            checked(root, relative)?
        };
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        if link(&metadata) {
            return Err("备份期间目录变为链接。".into());
        }
        if metadata.is_file() {
            entries.insert(relative.into());
        } else if metadata.is_dir() {
            for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
                let name = entry
                    .map_err(|e| e.to_string())?
                    .file_name()
                    .into_string()
                    .map_err(|_| "备份文件名无效。")?;
                visit(
                    root,
                    &if relative.is_empty() {
                        name
                    } else {
                        format!("{relative}/{name}")
                    },
                    entries,
                )?;
            }
        } else {
            return Err("备份含特殊文件。".into());
        }
        if entries.len() > 100_000 {
            return Err("备份文件超过数量限制。".into());
        }
        Ok(())
    }
    let mut entries = BTreeSet::new();
    visit(root, relative, &mut entries)?;
    Ok(entries)
}
fn new_target(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || fs::symlink_metadata(path).is_ok() {
        return Err("恢复只写入尚不存在的新目录。".into());
    }
    let parent = path.parent().ok_or("恢复目录无父目录。")?;
    if parent.canonicalize().map_err(|e| e.to_string())? != parent || !parent.is_dir() {
        return Err("恢复父目录必须是普通目录。".into());
    }
    Ok(())
}
pub fn prepare_backup(
    data: &Path,
    library: &Path,
    scope: &str,
    target: &Path,
) -> Result<Plan, String> {
    new_target(target)?;
    if target.starts_with(data) || target.starts_with(library) {
        return Err("备份不能保存在原数据目录内部。".into());
    }
    let mut snapshot = logical_snapshot(data, scope)?;
    let source_revision = digest(&serde_json::to_vec(&snapshot.rows).map_err(|e| e.to_string())?);
    let mut plan = Plan {
        manifest: Manifest {
            schema: "liteasy.recovery-archive/v1".into(),
            scope: scope.into(),
            files: vec![],
            exclusions: vec![
                "账号凭据与应用配置".into(),
                "外部目录授权".into(),
                "插件安装、授权与触发器".into(),
                "未关联的外部文件".into(),
            ],
        },
        target: target.into(),
        restore: false,
        files: BTreeMap::new(),
        source_state: Some((data.to_path_buf(), source_revision)),
        inventories: vec![(
            library.to_path_buf(),
            String::new(),
            inventory(library, "")?,
        )],
    };
    tree(&mut plan, library, "", "data/local-library/library")?;
    let scope_hash = digest(scope.as_bytes());
    for folder in ["objects/assets", "boards", "synced-boards"] {
        let path = format!("{folder}/{scope_hash}");
        plan.inventories
            .push((data.to_path_buf(), path.clone(), inventory(data, &path)?));
        if checked(data, &path)?.exists() {
            tree(&mut plan, data, &path, &format!("data/{path}"))?;
        }
    }
    // Read grants only to resolve persisted bindings. No old absolute grant path is exported.
    let grant_db = checked(data, "note-files/grants.v1.sqlite3")?;
    let mut grants = BTreeMap::<String, (PathBuf, String)>::new();
    if grant_db.exists() {
        let db = Connection::open_with_flags(grant_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        let mut query = db
            .prepare("SELECT id,path,kind FROM grants WHERE scope=?1")
            .map_err(|e| e.to_string())?;
        for row in query
            .query_map([scope], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?
        {
            let (id, path, kind) = row.map_err(|e| e.to_string())?;
            grants.insert(id, (path.into(), kind));
        }
    }
    let mut needed = BTreeMap::<String, BTreeSet<String>>::new();
    for row in &snapshot.rows {
        if ["object-file/", "board-file/", "object-attachment/"]
            .iter()
            .any(|prefix| row.key.starts_with(prefix))
        {
            let binding: Value = serde_json::from_str(&row.value)
                .map_err(|_| "文件关联已损坏，不能制作完整恢复副本。")?;
            let id = binding["mountId"]
                .as_str()
                .ok_or("关联缺少文件授权标识。")?;
            let path = binding["path"].as_str().ok_or("关联缺少相对路径。")?;
            if !relative(path) {
                return Err("关联文件路径无效。".into());
            }
            needed.entry(id.into()).or_default().insert(path.into());
        }
    }
    // Managed grants are owned content even if the current workbench has no binding row yet.
    for (id, (path, _)) in &grants {
        if ["boards", "synced-boards"]
            .iter()
            .any(|folder| path.starts_with(data.join(folder).join(&scope_hash)))
        {
            needed.entry(id.clone()).or_default();
        }
    }
    for (id, paths) in needed {
        let (location, kind) = grants
            .get(&id)
            .ok_or("关联文件授权丢失，未创建不完整恢复副本。")?;
        if id.len() != 64
            || !id.bytes().all(|b| b.is_ascii_hexdigit())
            || !matches!(kind.as_str(), "file" | "directory")
        {
            return Err("文件授权格式不兼容。".into());
        }
        if location
            .canonicalize()
            .map_err(|_| "关联的外部文件不可用，未创建不完整备份。")?
            != *location
        {
            return Err("关联授权位置已改变，请重新连接。".into());
        }
        let owned = ["boards", "synced-boards"]
            .iter()
            .any(|folder| location.starts_with(data.join(folder).join(&scope_hash)));
        let grant_relative = if owned {
            location
                .strip_prefix(data)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/")
        } else {
            format!("restored-files/{scope_hash}/{id}")
        };
        if !owned {
            for path in paths {
                let (root, relative) = if kind == "file" {
                    if location.file_name().and_then(|v| v.to_str()) != Some(path.as_str()) {
                        return Err("单文件授权不能读取其他文件。".into());
                    }
                    (
                        location.parent().ok_or("文件位置无效。")?.to_path_buf(),
                        path.clone(),
                    )
                } else {
                    (location.clone(), path.clone())
                };
                let source = checked(&root, &relative)?;
                if source.is_dir() {
                    return Err("关联附件目录暂不支持完整恢复；请先将附件导入笔记对象。".into());
                }
                // Copies become owned files. The original external root and authority are absent.
                append(
                    &mut plan,
                    format!("data/{grant_relative}/{path}"),
                    Payload::Source(root, relative),
                )?;
            }
        }
        snapshot.grants.push(Grant {
            id,
            relative: grant_relative,
            kind: if owned {
                kind.clone()
            } else {
                "directory".into()
            },
        });
    }
    let serialized = serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?;
    if serialized.len() as u64 > MAX_JSON {
        return Err("序列化后的恢复快照超过 128 MiB，请分批整理后备份。".into());
    }
    append(
        &mut plan,
        "snapshot.json".into(),
        Payload::Bytes(serialized),
    )?;
    plan.manifest.files.sort_by(|a, b| a.path.cmp(&b.path));
    validate_manifest(&plan.manifest)?;
    if serde_json::to_vec_pretty(&plan.manifest)
        .map_err(|e| e.to_string())?
        .len() as u64
        > MAX_JSON
    {
        return Err("恢复文件清单超过 128 MiB。".into());
    }
    Ok(plan)
}
fn validate_manifest(manifest: &Manifest) -> Result<(), String> {
    if manifest.schema != "liteasy.recovery-archive/v1"
        || !scope_valid(&manifest.scope)
        || manifest.files.is_empty()
        || manifest.files.len() > 100_000
    {
        return Err("恢复归档版本或分区不兼容。".into());
    }
    let scope_hash = digest(manifest.scope.as_bytes());
    let mut paths = BTreeSet::new();
    let mut total = 0u64;
    for entry in &manifest.files {
        let allowed = entry.path == "snapshot.json"
            || entry.path.starts_with("data/local-library/library/")
            || [
                "objects/assets",
                "boards",
                "synced-boards",
                "restored-files",
            ]
            .iter()
            .any(|folder| {
                entry
                    .path
                    .starts_with(&format!("data/{folder}/{scope_hash}/"))
            });
        if !allowed
            || !relative(&entry.path)
            || !paths.insert(entry.path.to_lowercase())
            || entry.size > MAX_FILE
            || (entry.path == "snapshot.json" && entry.size > MAX_JSON)
            || entry.sha256.len() != 64
            || !entry.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("恢复归档文件清单包含非法或重复路径。".into());
        }
        total = total.checked_add(entry.size).ok_or("恢复容量无效。")?;
    }
    if total > MAX_TOTAL
        || !paths.contains("snapshot.json")
        || !paths.contains("data/local-library/library/.liteasy-library.json")
    {
        return Err("恢复容量超限或缺少对象快照。".into());
    }
    Ok(())
}
fn validate_snapshot(snapshot: &Snapshot, manifest: &Manifest) -> Result<(), String> {
    if snapshot.version != 1 || snapshot.scope != manifest.scope || snapshot.rows.len() > 100_000 {
        return Err("恢复对象快照版本或分区不兼容。".into());
    }
    let mut keys = BTreeSet::new();
    for row in &snapshot.rows {
        if !admitted(&row.key)
            || row.key.len() > 2048
            || row.version.is_empty()
            || !keys.insert(&row.key)
        {
            return Err("恢复对象记录类型、版本或标识无效。".into());
        }
        if let Ok(value) = serde_json::from_str::<Value>(&row.value) {
            if contains_credential(&value) {
                return Err("恢复对象快照包含凭据字段。".into());
            }
            if row.key.starts_with("head/") || row.key.starts_with("revision/") {
                if value["schemaVersion"] != "liteasy.object/v1"
                    || value["scopeId"] != snapshot.scope
                    || value["objectId"].as_str() != row.key.split('/').nth(1)
                {
                    return Err("对象版本、账户或标识不兼容。".into());
                }
                if row.key.starts_with("revision/")
                    && value["revision"].as_str() != row.key.split('/').nth(2)
                {
                    return Err("不可变对象版本标识不匹配。".into());
                }
                if let Some(assets) = value["assets"].as_array() {
                    for asset in assets {
                        let hash = asset["sha256"].as_str().ok_or("对象附件缺少指纹。")?;
                        let path = format!(
                            "data/objects/assets/{}/{}",
                            digest(snapshot.scope.as_bytes()),
                            hash
                        );
                        if !manifest.files.iter().any(|file| {
                            file.path == path
                                && file.sha256 == hash
                                && Some(file.size) == asset["byteLength"].as_u64()
                        }) {
                            return Err("对象引用附件缺失或已损坏，未恢复不完整内容。".into());
                        }
                    }
                }
            }
            if row.key.starts_with("asset/") {
                let hash = value["sha256"].as_str().ok_or("附件缺少校验值。")?;
                let path = format!(
                    "data/objects/assets/{}/{}",
                    digest(snapshot.scope.as_bytes()),
                    hash
                );
                if row.key != format!("asset/{hash}")
                    || !manifest.files.iter().any(|file| {
                        file.path == path
                            && file.sha256 == hash
                            && Some(file.size) == value["byteLength"].as_u64()
                    })
                {
                    return Err("对象附件不存在或指纹不匹配。".into());
                }
            }
        }
    }
    let hash = digest(snapshot.scope.as_bytes());
    let mut grants = BTreeSet::new();
    for grant in &snapshot.grants {
        if grant.id.len() != 64
            || !grant.id.bytes().all(|b| b.is_ascii_hexdigit())
            || !grants.insert(&grant.id)
            || !relative(&grant.relative)
            || !matches!(grant.kind.as_str(), "file" | "directory")
            || !["boards", "synced-boards", "restored-files"]
                .iter()
                .any(|folder| {
                    grant.relative == format!("{folder}/{hash}")
                        || grant.relative.starts_with(&format!("{folder}/{hash}/"))
                })
        {
            return Err("恢复文件授权超出新配置拥有的资料。".into());
        }
    }
    for row in &snapshot.rows {
        if ["object-file/", "board-file/", "object-attachment/"]
            .iter()
            .any(|prefix| row.key.starts_with(prefix))
        {
            let value: Value =
                serde_json::from_str(&row.value).map_err(|_| "恢复文件关联损坏。")?;
            let grant = snapshot
                .grants
                .iter()
                .find(|grant| Some(grant.id.as_str()) == value["mountId"].as_str())
                .ok_or("恢复文件关联缺少拥有的副本。")?;
            let path = value["path"]
                .as_str()
                .filter(|path| relative(path))
                .ok_or("恢复文件关联路径无效。")?;
            let expected = if grant.kind == "directory" {
                format!("data/{}/{path}", grant.relative)
            } else {
                format!("data/{}", grant.relative)
            };
            if !manifest.files.iter().any(|entry| entry.path == expected) {
                return Err("恢复文件关联缺少内容。".into());
            }
        }
    }
    Ok(())
}
pub fn prepare_restore(root: &Path, target: &Path) -> Result<Plan, String> {
    new_target(target)?;
    if target.starts_with(root) || root.join(MARKER).exists() {
        return Err("未完成归档或恢复目录位于原归档内。".into());
    }
    let bytes = read(root, "manifest.json", MAX_JSON)?;
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| "恢复 manifest 损坏。")?;
    validate_manifest(&manifest)?;
    let mut files = BTreeMap::new();
    for entry in &manifest.files {
        let (size, hash) = fingerprint(root, &entry.path)?;
        if size != entry.size || hash != entry.sha256 {
            return Err(format!("恢复文件校验失败：{}", entry.path));
        }
        files.insert(
            entry.path.clone(),
            Payload::Source(root.into(), entry.path.clone()),
        );
    }
    let snapshot: Snapshot = serde_json::from_slice(&read(root, "snapshot.json", MAX_JSON)?)
        .map_err(|_| "恢复快照损坏。")?;
    validate_snapshot(&snapshot, &manifest)?;
    let library_marker: Value = serde_json::from_slice(&read(
        root,
        "data/local-library/library/.liteasy-library.json",
        16 * 1024,
    )?)
    .map_err(|_| "恢复文献库标记损坏。")?;
    if library_marker["schemaVersion"] != 1
        || !library_marker["libraryId"]
            .as_str()
            .is_some_and(|id| !id.trim().is_empty())
    {
        return Err("文献库版本不兼容；未创建恢复配置。".into());
    }
    // Retain raw manifest bytes as a condition without exporting an extra file.
    files.insert("manifest.json".into(), Payload::Bytes(bytes));
    Ok(Plan {
        manifest,
        target: target.into(),
        restore: true,
        files,
        source_state: None,
        inventories: vec![],
    })
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = FsOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}
fn mkdir(path: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|e| e.to_string())
}
fn restore_database(root: &Path, snapshot: &Snapshot) -> Result<(), String> {
    mkdir(&root.join("objects"))?;
    let path = root.join("objects/objects.v1.sqlite3");
    if path.exists() {
        return Err("新配置对象数据库已存在，未覆盖。".into());
    }
    write_new(&path, b"")?;
    let mut db = Connection::open(path).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA synchronous=FULL;CREATE TABLE object_records(scope TEXT NOT NULL,key TEXT NOT NULL,version TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,key)) WITHOUT ROWID;").map_err(|e|e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for row in &snapshot.rows {
        tx.execute(
            "INSERT INTO object_records(scope,key,version,value) VALUES(?1,?2,?3,?4)",
            params![snapshot.scope, row.key, row.version, row.value],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    drop(db);
    mkdir(&root.join("note-files"))?;
    let path = root.join("note-files/grants.v1.sqlite3");
    write_new(&path, b"")?;
    let mut db = Connection::open(path).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA synchronous=FULL;CREATE TABLE grants(scope TEXT NOT NULL,id TEXT NOT NULL,path TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(scope,id),UNIQUE(scope,path,kind));").map_err(|e|e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    for grant in &snapshot.grants {
        let path = checked(root, &grant.relative)?;
        if grant.kind == "directory" {
            mkdir(&path)?;
        }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO grants(scope,id,path,kind) VALUES(?1,?2,?3,?4)",
            params![snapshot.scope, grant.id, path.to_string_lossy(), grant.kind],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
pub fn commit(plan: Plan, guard: impl Fn() -> Result<(), String>) -> Result<PathBuf, String> {
    guard()?;
    new_target(&plan.target)?;
    let check_source = || -> Result<(), String> {
        for (root, path, expected) in &plan.inventories {
            if inventory(root, path)? != *expected {
                return Err("预览后资料文件清单已改变，请重新备份。".into());
            }
        }
        if let Some((data, expected)) = &plan.source_state {
            let current = logical_snapshot(data, &plan.manifest.scope)?;
            if digest(&serde_json::to_vec(&current.rows).map_err(|e| e.to_string())?) != *expected {
                return Err("预览后笔记、关联或任务回执已改变，请重新备份。".into());
            }
        }
        Ok(())
    };
    check_source()?;
    for entry in &plan.manifest.files {
        if let Payload::Source(root, path) = &plan.files[&entry.path] {
            if fingerprint(root, path) != (Ok((entry.size, entry.sha256.clone()))) {
                return Err(format!("预览后源文件已改变：{}", entry.path));
            }
        }
    }
    if plan.restore {
        if let Some(Payload::Bytes(expected)) = plan.files.get("manifest.json") {
            if let Some(Payload::Source(root, _)) = plan.files.get("snapshot.json") {
                if read(root, "manifest.json", MAX_JSON)? != *expected {
                    return Err("预览后 manifest 已改变。".into());
                }
            }
        }
    }
    guard()?;
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&plan.target).map_err(|e| e.to_string())?;
    write_new(
        &plan.target.join(MARKER),
        b"{\"status\":\"incomplete\",\"version\":1}",
    )?;
    let result = (|| {
        for entry in &plan.manifest.files {
            guard()?;
            let destination = checked(&plan.target, &entry.path)?;
            mkdir(destination.parent().ok_or("恢复路径无效。")?)?;
            checked(&plan.target, &entry.path)?;
            match &plan.files[&entry.path] {
                Payload::Bytes(bytes) => write_new(&destination, bytes)?,
                Payload::Source(root, path) => {
                    let source = checked(root, path)?;
                    if !fs::symlink_metadata(&source)
                        .map_err(|e| e.to_string())?
                        .is_file()
                    {
                        return Err("源文件已改变类型。".into());
                    }
                    let mut input = File::open(source).map_err(|e| e.to_string())?;
                    let mut options = FsOptions::new();
                    options.create_new(true).write(true);
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::OpenOptionsExt;
                        options.mode(0o600);
                    }
                    let mut output = options.open(destination).map_err(|e| e.to_string())?;
                    let mut hash = Sha256::new();
                    let mut size = 0u64;
                    let mut buffer = [0u8; 65536];
                    loop {
                        guard()?;
                        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
                        if count == 0 {
                            break;
                        }
                        size += count as u64;
                        if size > entry.size {
                            return Err("复制期间源文件改变。".into());
                        }
                        hash.update(&buffer[..count]);
                        output
                            .write_all(&buffer[..count])
                            .map_err(|e| e.to_string())?;
                    }
                    output.sync_all().map_err(|e| e.to_string())?;
                    if size != entry.size || format!("{:x}", hash.finalize()) != entry.sha256 {
                        return Err("复制期间源文件改变。".into());
                    }
                }
            }
        }
        guard()?;
        check_source()?;
        for entry in &plan.manifest.files {
            if let Payload::Source(root, path) = &plan.files[&entry.path] {
                guard()?;
                if fingerprint(root, path)? != (entry.size, entry.sha256.clone()) {
                    return Err(format!("备份完成前源文件已改变：{}", entry.path));
                }
            }
        }
        let manifest = serde_json::to_vec_pretty(&plan.manifest).map_err(|e| e.to_string())?;
        let mut profile_hash = None;
        if plan.restore {
            let snapshot: Snapshot =
                serde_json::from_slice(&read(&plan.target, "snapshot.json", MAX_JSON)?)
                    .map_err(|_| "恢复快照损坏。")?;
            validate_snapshot(&snapshot, &plan.manifest)?;
            restore_database(&plan.target.join("data"), &snapshot)?;
            let profile = Profile {
                schema: "liteasy.recovery-profile/v1".into(),
                id: digest(format!("{}:{}", plan.target.display(), digest(&manifest)).as_bytes())
                    [..32]
                    .into(),
                scope: plan.manifest.scope.clone(),
                root: "data".into(),
                local_only: true,
            };
            let bytes = serde_json::to_vec_pretty(&profile).map_err(|e| e.to_string())?;
            write_new(&plan.target.join("profile.json"), &bytes)?;
            profile_hash = Some(digest(&bytes));
        }
        guard()?;
        write_new(&plan.target.join("manifest.json"), &manifest)?;
        write_new(&plan.target.join("recovery-receipt.json"),json!({"version":1,"status":"committed","manifestHash":digest(&manifest),"profileHash":profile_hash}).to_string().as_bytes())?;
        fs::remove_file(plan.target.join(MARKER)).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        File::open(&plan.target)
            .and_then(|file| file.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(plan.target.clone())
    })();
    result.map_err(|error: String| {
        format!(
            "{error} 未完成副本保留于 {}；原配置未覆盖。",
            plan.target.display()
        )
    })
}
pub fn validate_profile(path: &Path) -> Result<Bootstrap, String> {
    if !path.is_absolute()
        || path.canonicalize().map_err(|e| e.to_string())? != path
        || path.join(MARKER).exists()
    {
        return Err("恢复配置位置无效或尚未完成。".into());
    }
    let bytes = read(path, "profile.json", 16 * 1024)?;
    let profile: Profile = serde_json::from_slice(&bytes).map_err(|_| "恢复配置标记损坏。")?;
    if profile.schema != "liteasy.recovery-profile/v1"
        || !scope_valid(&profile.scope)
        || profile.root != "data"
        || !profile.local_only
        || profile.id.len() != 32
        || !profile.id.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("恢复配置标记不兼容。".into());
    }
    let receipt: Value = serde_json::from_slice(&read(path, "recovery-receipt.json", 16 * 1024)?)
        .map_err(|_| "恢复完成回执损坏。")?;
    let manifest_bytes = read(path, "manifest.json", MAX_JSON)?;
    let manifest: Manifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| "恢复 manifest 损坏。")?;
    validate_manifest(&manifest)?;
    if receipt["version"] != 1
        || receipt["status"] != "committed"
        || receipt["profileHash"] != digest(&bytes)
        || receipt["manifestHash"] != digest(&manifest_bytes)
        || manifest.scope != profile.scope
    {
        return Err("恢复完成回执或分区不匹配。".into());
    }
    let active_root = checked(path, "data")?;
    checked(&active_root, "objects/objects.v1.sqlite3")?;
    let db = Connection::open_with_flags(
        active_root.join("objects/objects.v1.sqlite3"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;
    let result: String = db
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if result != "ok" {
        return Err("恢复数据库检查未通过。".into());
    }
    Ok(Bootstrap {
        profile_root: path.into(),
        active_root,
        archived_scope: profile.scope,
    })
}
