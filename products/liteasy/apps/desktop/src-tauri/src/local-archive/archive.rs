//! Local, selected-resource interchange. No account database, credentials or live-root mutation.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_FILE: u64 = 256 * 1024 * 1024;
const MAX_TOTAL: u64 = 1024 * 1024 * 1024;
const MAX_METADATA: u64 = 8 * 1024 * 1024;
const MAX_FILES: usize = 4096;
const MANIFEST: &str = "manifest.json";
const INCOMPLETE: &str = ".liteasy-archive-incomplete.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveFile {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub source: String,
    pub annotations: String,
    pub note: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub path: String,
    pub document_ids: Vec<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Relation {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub page: Option<u64>,
    pub quote: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub documents: Vec<Document>,
    pub notes: Vec<Note>,
    pub relations: Vec<Relation>,
    pub files: Vec<ArchiveFile>,
    pub exclusions: Vec<String>,
}
#[derive(Clone)]
pub struct SourceInput {
    pub root: PathBuf,
    pub relative: String,
}
pub struct DocumentInput {
    pub private_id: String,
    pub title: String,
    pub source: SourceInput,
    pub annotations: Option<Value>,
}
enum Payload {
    Source(SourceInput),
    Generated(Vec<u8>),
}
pub struct Plan {
    pub manifest: Manifest,
    pub target: PathBuf,
    pub operation: String,
    files: BTreeMap<String, Payload>,
    conditions: Vec<(SourceInput, Option<String>)>,
}
impl Plan {
    pub fn bind_condition(&mut self, source: SourceInput, expected: String) {
        self.conditions.push((source, Some(expected)));
    }
    pub fn bind_absence(&mut self, source: SourceInput) {
        self.conditions.push((source, None));
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub status: String,
    pub path: String,
    pub manifest_hash: String,
    pub file_count: usize,
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn link_like(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}
pub fn valid_relative(value: &str) -> bool {
    if value.is_empty()
        || value.len() > 240
        || value.contains(['\\', ':', '\0'])
        || value.starts_with('/')
    {
        return false;
    }
    value.split('/').all(|part| {
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
pub fn checked(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if !valid_relative(relative) {
        return Err("归档路径不安全或不能跨平台使用。".into());
    }
    let root_meta = fs::symlink_metadata(root).map_err(|_| "所选目录不可用。")?;
    if link_like(&root_meta) || !root_meta.is_dir() {
        return Err("所选根目录不能是符号链接或特殊文件。".into());
    }
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if link_like(&meta) => return Err("归档包含符号链接或目录联接。".into()),
            Ok(_) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("无法检查归档路径。".into()),
        }
    }
    Ok(path)
}
fn read_source(input: &SourceInput, limit: u64) -> Result<Vec<u8>, String> {
    let path = checked(&input.root, &input.relative)?;
    if !fs::symlink_metadata(&path)
        .map_err(|_| "归档源文件不可用。")?
        .is_file()
    {
        return Err("归档源文件必须是普通文件。".into());
    }
    let file = File::open(&path).map_err(|_| "归档源文件已丢失或不可读。")?;
    let metadata = file.metadata().map_err(|_| "无法读取源文件信息。")?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("归档文件超过大小限制或不是普通文件。".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取源文件失败。")?;
    if bytes.len() as u64 > limit {
        return Err("归档文件超过大小限制。".into());
    }
    Ok(bytes)
}
fn hash_source(input: &SourceInput) -> Result<(u64, String), String> {
    let path = checked(&input.root, &input.relative)?;
    if !fs::symlink_metadata(&path)
        .map_err(|_| "归档源文件不可用。")?
        .is_file()
    {
        return Err("归档源文件必须是普通文件。".into());
    }
    let mut file = File::open(path).map_err(|_| "源文件已丢失或不可读。")?;
    let metadata = file.metadata().map_err(|_| "无法读取源文件信息。")?;
    if !metadata.is_file() || metadata.len() > MAX_FILE {
        return Err("单个文件超过 256 MiB 或不是普通文件。".into());
    }
    let mut hash = Sha256::new();
    let mut length = 0;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "读取源文件失败。")?;
        if count == 0 {
            break;
        }
        length += count as u64;
        if length > MAX_FILE {
            return Err("单个文件超过 256 MiB。".into());
        }
        hash.update(&buffer[..count]);
    }
    Ok((length, format!("{:x}", hash.finalize())))
}
pub fn metadata_bytes(source: &SourceInput) -> Result<Vec<u8>, String> {
    read_source(source, MAX_METADATA)
}
fn new_target(path: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or("恢复目录缺少父目录。")?;
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("恢复目录名称无效。")?;
    if !path.is_absolute() || !valid_relative(name) || fs::symlink_metadata(path).is_ok() {
        return Err("请使用尚不存在的新目录；现有目录不会覆盖。".into());
    }
    let metadata = fs::symlink_metadata(parent).map_err(|_| "保存位置不可用。")?;
    if !metadata.is_dir()
        || link_like(&metadata)
        || parent.canonicalize().map_err(|_| "保存位置不可用。")? != parent
    {
        return Err("保存位置必须是已解析的普通目录。".into());
    }
    Ok(())
}
fn append_file(plan: &mut Plan, relative: String, payload: Payload) -> Result<(), String> {
    if !valid_relative(&relative) || plan.files.contains_key(&relative) {
        return Err("重复或无效的归档路径。".into());
    }
    let (size, sha256) = match &payload {
        Payload::Generated(bytes) => (bytes.len() as u64, digest(bytes)),
        Payload::Source(source) => hash_source(source)?,
    };
    if size > MAX_FILE
        || (matches!(&payload, Payload::Generated(_)) && size > MAX_METADATA)
        || plan.manifest.files.iter().map(|f| f.size).sum::<u64>() + size > MAX_TOTAL
        || plan.files.len() >= MAX_FILES
    {
        return Err("归档超过 1 GiB 或 4096 个文件，请减少选择。".into());
    }
    plan.manifest.files.push(ArchiveFile {
        path: relative.clone(),
        size,
        sha256,
    });
    plan.files.insert(relative, payload);
    Ok(())
}
fn generated(plan: &mut Plan, relative: String, value: &Value) -> Result<(), String> {
    append_file(
        plan,
        relative,
        Payload::Generated(serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?),
    )
}
fn portable_text(value: &str) -> String {
    // Machine-specific links cannot work elsewhere and must not reveal their paths/scope IDs.
    value
        .split_inclusive(char::is_whitespace)
        .map(|part| {
            if part.contains("liteasy://") || part.contains("file://") {
                "〔本地链接未携带，请查看来源说明〕 ".to_string()
            } else {
                part.to_string()
            }
        })
        .collect()
}
fn text(value: &Value, key: &str) -> String {
    portable_text(value[key].as_str().unwrap_or(""))
}
fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn number_fields(value: &Value, keys: &[&str]) -> Result<Value, String> {
    let mut result = json!({});
    for key in keys {
        if !value[*key].is_number() {
            return Err("批注几何数据损坏；原数据保留，未创建归档。".into());
        }
        result[*key] = value[*key].clone();
    }
    Ok(result)
}
fn ink(value: &Value) -> Result<Value, String> {
    let points = value["points"].as_array().ok_or("绘图缺少点数据。")?;
    let color = value["color"].as_str().ok_or("绘图颜色无效。")?;
    let width = value["width"].as_f64().ok_or("绘图宽度无效。")?;
    if points.is_empty()
        || points.len() > 12_000
        || color.len() != 7
        || !color.starts_with('#')
        || !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
        || width <= 0.0
        || width > 3.0
    {
        return Err("绘图数据不兼容。".into());
    }
    let points = points
        .iter()
        .map(|point| {
            let projected = number_fields(point, &["x", "y"])?;
            if ["x", "y"].iter().any(|key| {
                !projected[*key]
                    .as_f64()
                    .is_some_and(|v| (0.0..=100.0).contains(&v))
            }) {
                return Err("绘图坐标无效。".into());
            }
            Ok(projected)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(json!({"color": color, "width": width, "points":points}))
}
fn annotation_body(original: &Value, target: &mut Value) -> Result<(), String> {
    for key in [
        "color",
        "createdAt",
        "excerpt",
        "note",
        "text",
        "updatedAt",
        "inkLastStrokeAt",
    ] {
        if let Some(value) = original.get(key) {
            target[key] = json!(portable_text(value.as_str().ok_or("批注文字格式无效。")?));
        }
    }
    for key in ["normalizedStart", "opacity"] {
        if let Some(value) = original.get(key) {
            if !value.is_number() {
                return Err("批注位置或透明度无效。".into());
            }
            target[key] = value.clone();
        }
    }
    if let Some(value) = original.get("manualSize") {
        if !value.is_boolean() {
            return Err("批注尺寸设置无效。".into());
        }
        target["manualSize"] = value.clone();
    }
    if let Some(value) = original.get("rects") {
        target["rects"] = json!(value
            .as_array()
            .ok_or("批注位置格式无效。")?
            .iter()
            .map(|rect| number_fields(rect, &["left", "top", "width", "height"]))
            .collect::<Result<Vec<_>, _>>()?);
    }
    if let Some(value) = original.get("ink") {
        target["ink"] = ink(value)?;
    }
    if let Some(value) = original.get("inkStrokes") {
        let strokes = value.as_array().ok_or("绘图组合格式无效。")?;
        if strokes.is_empty()
            || strokes.len() > 256
            || strokes
                .iter()
                .map(|stroke| array(&stroke["points"]).len())
                .sum::<usize>()
                > 48_000
        {
            return Err("绘图组合超过大小限制。".into());
        }
        target["inkStrokes"] = json!(strokes.iter().map(ink).collect::<Result<Vec<_>, _>>()?);
    }
    if let Some(value) = original.get("images") {
        let images = value.as_object().ok_or("批注图片格式无效。")?;
        if images.len() > 16 {
            return Err("批注图片过多。".into());
        }
        let mut projected = json!({});
        for (key, value) in images {
            let data = value.as_str().ok_or("批注图片格式无效。")?;
            let prefix = [
                "data:image/png;base64,",
                "data:image/jpeg;base64,",
                "data:image/gif;base64,",
                "data:image/webp;base64,",
            ]
            .into_iter()
            .find(|prefix| data.starts_with(prefix))
            .ok_or("批注图片不是受支持的内嵌图片。")?;
            if key.is_empty()
                || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                || data.len() > 3_000_000
                || data.len() == prefix.len()
                || !data[prefix.len()..]
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
            {
                return Err("批注图片格式无效。".into());
            }
            projected[key] = value.clone();
        }
        target["images"] = projected;
    }
    for (key, fields) in [
        ("review", &["text", "generatedAt", "updatedAt"][..]),
        (
            "quickAsk",
            &["question", "answer", "pageText", "abstractText"][..],
        ),
        ("aiGuide", &["mode", "level", "category"][..]),
    ] {
        if let Some(value) = original.get(key) {
            let mut projected = json!({});
            for field in fields {
                projected[*field] = json!(portable_text(
                    value[*field].as_str().ok_or("批注附加文字格式无效。")?
                ));
            }
            if key == "review" && value["sourceRevision"].is_u64() {
                projected["sourceRevision"] = value["sourceRevision"].clone();
            }
            target[key] = projected;
        }
    }
    Ok(())
}

pub fn prepare_export(
    documents: Vec<DocumentInput>,
    records: &Value,
    target: &Path,
) -> Result<Plan, String> {
    new_target(target)?;
    if documents.is_empty() || documents.len() > 256 {
        return Err("请选择 1 至 256 篇带原文的文献。".into());
    }
    let mut plan = Plan {
        manifest: Manifest {
            format: "liteasy-local-archive".into(),
            version: 1,
            documents: vec![],
            notes: vec![],
            relations: vec![],
            files: vec![],
            exclusions: vec![
                "账号凭据与配置".into(),
                "未选择的文献与私人会话".into(),
                "设备路径、授权与远端发布状态".into(),
            ],
        },
        target: target.to_path_buf(),
        operation: "export".into(),
        files: BTreeMap::new(),
        conditions: vec![],
    };
    let mut papers = BTreeMap::new();
    for (index, input) in documents.into_iter().enumerate() {
        if papers.contains_key(&input.private_id) {
            return Err("不能重复选择同一文献。".into());
        }
        let id = format!("document-{:04}", index + 1);
        papers.insert(input.private_id, id.clone());
        let extension = Path::new(&input.source.relative)
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(extension.as_str(), "pdf" | "epub") {
            return Err("所选原文仅支持 PDF 和 EPUB。".into());
        }
        let source = format!("sources/{id}.{extension}");
        append_file(&mut plan, source.clone(), Payload::Source(input.source))?;
        let title = portable_text(&input.title);
        let mut markdown = format!("# {title}\n\n[原文](../{source})\n\n");
        let mut annotations = Vec::new();
        if let Some(state) = input.annotations {
            if state["version"] != 2 || !state["annotations"].is_array() {
                return Err("批注格式不兼容；原数据保留，未创建归档。".into());
            }
            for (annotation_index, original) in array(&state["annotations"]).iter().enumerate() {
                let page = original["page"]
                    .as_u64()
                    .filter(|page| *page > 0)
                    .ok_or("批注缺少有效页码，请先修复后导出。")?;
                let kind = original["kind"]
                    .as_str()
                    .filter(|kind| {
                        matches!(*kind, "highlight" | "underline" | "note" | "text" | "ink")
                    })
                    .ok_or("批注类型不兼容，未创建归档。")?;
                let mut annotation = json!({"id":format!("annotation-{:04}", annotation_index+1),"documentId":id,"page":page,"kind":kind});
                // Project nested fields too: unknown identity/credential fields never travel.
                annotation_body(original, &mut annotation)?;
                markdown.push_str(&format!(
                    "## 第 {page} 页 · {kind}\n\n{}\n\n{}\n\n{}\n\n{}\n\n{}\n\n{}\n\n",
                    text(&annotation, "excerpt"),
                    text(&annotation, "text"),
                    text(&annotation, "note"),
                    text(&annotation["review"], "text"),
                    text(&annotation["quickAsk"], "question"),
                    text(&annotation["quickAsk"], "answer")
                ));
                annotations.push(annotation);
            }
        }
        let annotations_path = format!("annotations/{id}.json");
        generated(
            &mut plan,
            annotations_path.clone(),
            &json!({"format":"liteasy-portable-annotations","version":1,"documentId":id,"annotations":annotations}),
        )?;
        let note = format!("notes/{id}.md");
        append_file(
            &mut plan,
            note.clone(),
            Payload::Generated(markdown.into_bytes()),
        )?;
        plan.manifest.documents.push(Document {
            id,
            title,
            source,
            annotations: annotations_path,
            note,
        });
    }
    let mut source_objects = BTreeMap::new();
    for row in array(records) {
        let value = &row["value"];
        if row["key"]
            .as_str()
            .is_some_and(|key| key.starts_with("head/"))
            && value["kind"] == "source.document"
        {
            if let (Some(object), Some(document)) = (
                value["objectId"].as_str(),
                value["content"]["payload"]["paperId"]
                    .as_str()
                    .and_then(|id| papers.get(id)),
            ) {
                source_objects.insert(object.to_string(), document.clone());
            }
        }
    }
    let mut runs = BTreeMap::new();
    for row in array(records) {
        let value = &row["value"];
        if !row["key"]
            .as_str()
            .is_some_and(|key| key.starts_with("head/"))
            || value["kind"] != "content.note"
            || value["lifecycle"] != "active"
        {
            continue;
        }
        let mut linked = BTreeMap::<String, Vec<(Option<u64>, Option<String>)>>::new();
        for reference in array(&value["provenance"]["sourceRefs"]) {
            if let Some(document) = reference["objectId"]
                .as_str()
                .and_then(|id| source_objects.get(id))
            {
                linked
                    .entry(document.clone())
                    .or_insert_with(|| vec![(None, None)]);
            }
        }
        for anchor in array(&value["paperAnchors"]) {
            if let Some(document) = anchor["source"]["paperId"]
                .as_str()
                .and_then(|id| papers.get(id))
            {
                let anchors = linked.entry(document.clone()).or_default();
                if anchors.as_slice() == [(None, None)] {
                    anchors.clear();
                }
                anchors.push((
                    anchor["locator"]["page"].as_u64(),
                    anchor["snapshot"]["quote"].as_str().map(portable_text),
                ));
            }
        }
        if linked.is_empty() {
            continue;
        }
        if !array(&value["assets"]).is_empty() {
            return Err("关联笔记含独立附件，本次归档尚不支持；未创建不完整副本。".into());
        }
        let id = format!("note-{:04}", plan.manifest.notes.len() + 1);
        let path = format!("notes/{id}.md");
        let title = text(value, "title");
        let body = text(&value["content"]["payload"], "text");
        let mut markdown = format!("# {title}\n\n{body}\n\n## 来源\n\n");
        for (document_id, anchors) in &linked {
            let document = plan
                .manifest
                .documents
                .iter()
                .find(|doc| &doc.id == document_id)
                .unwrap();
            for (page, quote) in anchors {
                markdown.push_str(&format!(
                    "- [{}](../{}){}{}\n",
                    document.title,
                    document.source,
                    page.map(|p| format!(" · 第 {p} 页")).unwrap_or_default(),
                    quote.as_ref().map(|q| format!("：{q}")).unwrap_or_default()
                ));
                plan.manifest.relations.push(Relation {
                    from: id.clone(),
                    to: document_id.clone(),
                    kind: "note-source".into(),
                    page: *page,
                    quote: quote.clone(),
                });
            }
        }
        if let Some(run) = value["provenance"]["runId"].as_str() {
            runs.entry(run.to_string())
                .or_insert_with(Vec::new)
                .extend(linked.keys().cloned());
        }
        append_file(
            &mut plan,
            path.clone(),
            Payload::Generated(markdown.into_bytes()),
        )?;
        plan.manifest.notes.push(Note {
            id,
            title,
            path,
            document_ids: linked.into_keys().collect(),
        });
    }
    for (index, (run, documents)) in runs.into_iter().enumerate() {
        if let Some(row) = array(records)
            .iter()
            .find(|row| row["key"] == format!("workflow-run/{run}"))
        {
            let value = &row["value"];
            let mut receipt =
                json!({"version":1,"id":format!("run-{:04}",index+1),"documentIds":documents});
            for key in ["status", "state", "createdAt", "updatedAt", "completedAt"] {
                if let Some(value) = value.get(key).filter(|value| value.is_string()) {
                    receipt[key] = value.clone();
                }
            }
            generated(
                &mut plan,
                format!("receipts/run-{:04}.json", index + 1),
                &receipt,
            )?;
        }
    }
    let readme = "# Liteasy 本地资料归档\n\n原文位于 sources/；完整笔记与批注文字位于 notes/；批注的本地几何与绘图数据位于 annotations/。manifest.json 用相对路径、SHA-256 和归档内标识关联资料。账号凭据、应用设置、远端发布状态与未选择会话不在归档中。\n\n在 Liteasy 的文献库与备份中选择“校验归档并恢复”，预览后确认，恢复到新的目录。恢复结果可直接打开原文；笔记也可通过“打开 Markdown”阅读。归档不会自动覆盖当前库，或自动重发任何发布任务。\n";
    append_file(
        &mut plan,
        "README.md".into(),
        Payload::Generated(readme.as_bytes().to_vec()),
    )?;
    plan.manifest.files.sort_by(|a, b| a.path.cmp(&b.path));
    validate_manifest(&plan.manifest)?;
    Ok(plan)
}

fn validate_manifest(manifest: &Manifest) -> Result<(), String> {
    if manifest.format != "liteasy-local-archive" || manifest.version != 1 {
        return Err("归档版本不兼容；未写入任何资料。".into());
    }
    if manifest.documents.is_empty()
        || manifest.documents.len() > 256
        || manifest.files.len() > MAX_FILES
    {
        return Err("归档条目数无效。".into());
    }
    let mut paths = HashSet::new();
    let mut total = 0_u64;
    for file in &manifest.files {
        if !valid_relative(&file.path)
            || !paths.insert(file.path.to_lowercase())
            || file.size > MAX_FILE
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("归档包含重复、超大或无效文件。".into());
        }
        let allowed = file.path == "README.md"
            || (file.path.starts_with("sources/")
                && (file.path.ends_with(".pdf") || file.path.ends_with(".epub")))
            || (file.path.starts_with("notes/") && file.path.ends_with(".md"))
            || (["annotations/", "receipts/"]
                .iter()
                .any(|prefix| file.path.starts_with(prefix))
                && file.path.ends_with(".json"));
        if !allowed || (!file.path.starts_with("sources/") && file.size > MAX_METADATA) {
            return Err("归档文件不在允许的资料目录中。".into());
        }
        total = total.checked_add(file.size).ok_or("归档容量无效。")?;
    }
    if total > MAX_TOTAL {
        return Err("归档超过 1 GiB。".into());
    }
    let file_exists = |path: &str| manifest.files.iter().any(|file| file.path == path);
    let mut ids = HashSet::new();
    for doc in &manifest.documents {
        if !doc.id.starts_with("document-")
            || !ids.insert(doc.id.clone())
            || doc.title.len() > 8192
            || !file_exists(&doc.source)
            || !file_exists(&doc.annotations)
            || !file_exists(&doc.note)
        {
            return Err("归档原文或批注映射不完整。".into());
        }
        if !(doc.source.starts_with("sources/")
            && (doc.source.ends_with(".pdf") || doc.source.ends_with(".epub")))
            || !doc.annotations.starts_with("annotations/")
            || !doc.annotations.ends_with(".json")
            || !doc.note.starts_with("notes/")
            || !doc.note.ends_with(".md")
        {
            return Err("归档文献路径类型无效。".into());
        }
    }
    let doc_ids = ids.clone();
    for note in &manifest.notes {
        if !note.id.starts_with("note-")
            || !ids.insert(note.id.clone())
            || !note.path.starts_with("notes/")
            || !note.path.ends_with(".md")
            || note.title.len() > 8192
            || note.document_ids.is_empty()
            || !file_exists(&note.path)
            || note.document_ids.iter().any(|id| !doc_ids.contains(id))
        {
            return Err("归档笔记来源映射无效。".into());
        }
    }
    if manifest.relations.iter().any(|relation| {
        !ids.contains(&relation.from)
            || !doc_ids.contains(&relation.to)
            || relation.kind != "note-source"
    }) {
        return Err("归档关联引用无效。".into());
    }
    Ok(())
}

pub fn prepare_restore(root: &Path, target: &Path) -> Result<Plan, String> {
    new_target(target)?;
    if fs::symlink_metadata(root.join(INCOMPLETE)).is_ok() {
        return Err("此目录保留了未完成操作，请先处理恢复诊断；未作为完整归档导入。".into());
    }
    let source = SourceInput {
        root: root.to_path_buf(),
        relative: MANIFEST.into(),
    };
    let bytes = read_source(&source, MAX_METADATA)?;
    let manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| "归档 manifest 格式损坏或包含未知字段。")?;
    validate_manifest(&manifest)?;
    let mut files = BTreeMap::new();
    for entry in &manifest.files {
        let source = SourceInput {
            root: root.to_path_buf(),
            relative: entry.path.clone(),
        };
        let (size, hash) = hash_source(&source)?;
        if size != entry.size || hash != entry.sha256 {
            return Err(format!("归档文件校验失败：{}", entry.path));
        }
        files.insert(entry.path.clone(), Payload::Source(source));
    }
    Ok(Plan {
        manifest,
        target: target.to_path_buf(),
        operation: "restore".into(),
        files,
        conditions: vec![(source, Some(digest(&bytes)))],
    })
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|_| "目标已存在或无法写入；未覆盖原文件。")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "保存失败；新目录保留未完成标记，原资料未改变。".into())
}
pub fn commit(plan: Plan) -> Result<Receipt, String> {
    commit_checked(plan, || Ok(()))
}

pub fn commit_checked(
    plan: Plan,
    guard: impl Fn() -> Result<(), String>,
) -> Result<Receipt, String> {
    guard()?;
    new_target(&plan.target)?;
    for (source, expected) in &plan.conditions {
        let unchanged = match expected {
            Some(expected) => hash_source(source)?.1 == *expected,
            None => match fs::symlink_metadata(checked(&source.root, &source.relative)?) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
                _ => false,
            },
        };
        if !unchanged {
            return Err("预览后归档元数据已改变，请重新预览。".into());
        }
    }
    for entry in &plan.manifest.files {
        if let Payload::Source(source) = &plan.files[&entry.path] {
            let (size, hash) = hash_source(source)?;
            if size != entry.size || hash != entry.sha256 {
                return Err(format!("预览后源文件已改变，请重新预览：{}", entry.path));
            }
        }
    }
    guard()?;
    fs::create_dir(&plan.target).map_err(|_| "目标已存在或无法创建；原目录未覆盖。")?;
    let marker = json!({"format":"liteasy-archive-operation","version":1,"operation":plan.operation,"status":"incomplete"});
    write_new(&plan.target.join(INCOMPLETE), marker.to_string().as_bytes())?;
    let result = (|| {
        for entry in &plan.manifest.files {
            guard()?;
            let output = checked(&plan.target, &entry.path)?;
            fs::create_dir_all(output.parent().ok_or("归档输出路径无效。")?)
                .map_err(|_| "无法创建归档目录。")?;
            checked(&plan.target, &entry.path)?;
            match &plan.files[&entry.path] {
                Payload::Generated(bytes) => write_new(&output, bytes)?,
                Payload::Source(source) => {
                    let mut input = File::open(checked(&source.root, &source.relative)?)
                        .map_err(|_| "源文件不可读。")?;
                    let mut output = OpenOptions::new()
                        .create_new(true)
                        .write(true)
                        .open(&output)
                        .map_err(|_| "归档输出已存在或不可写。")?;
                    let mut hash = Sha256::new();
                    let mut size = 0_u64;
                    let mut buffer = [0_u8; 64 * 1024];
                    loop {
                        guard()?;
                        let count = input.read(&mut buffer).map_err(|_| "复制原文失败。")?;
                        if count == 0 {
                            break;
                        }
                        size += count as u64;
                        if size > entry.size {
                            return Err("复制期间源文件已改变。".to_string());
                        }
                        output
                            .write_all(&buffer[..count])
                            .map_err(|_| "保存原文失败。")?;
                        hash.update(&buffer[..count]);
                    }
                    if size != entry.size || format!("{:x}", hash.finalize()) != entry.sha256 {
                        return Err("复制期间源文件已改变。".into());
                    }
                    output.sync_all().map_err(|_| "无法将原文写入磁盘。")?;
                }
            }
        }
        guard()?;
        let manifest = serde_json::to_vec_pretty(&plan.manifest).map_err(|e| e.to_string())?;
        write_new(&plan.target.join(MANIFEST), &manifest)?;
        write_new(&plan.target.join("receipt.json"),json!({"version":1,"operation":plan.operation,"status":"committed","manifestHash":digest(&manifest)}).to_string().as_bytes())?;
        fs::remove_file(plan.target.join(INCOMPLETE))
            .map_err(|_| "资料已写入，但无法清除未完成标记，请保留目录并重试校验。")?;
        #[cfg(unix)]
        File::open(&plan.target)
            .and_then(|file| file.sync_all())
            .map_err(|_| "目录写入确认失败，请保留恢复目录。")?;
        Ok(Receipt {
            status: "committed".into(),
            path: plan.target.to_string_lossy().into_owned(),
            manifest_hash: digest(&manifest),
            file_count: plan.manifest.files.len(),
        })
    })();
    result.map_err(|error: String| {
        format!(
            "{error} 未完成副本保留在 {}，原资料未覆盖。",
            plan.target.display()
        )
    })
}

pub fn verify_document(root: &Path, manifest: &Manifest, id: &str) -> Result<PathBuf, String> {
    validate_manifest(manifest)?;
    let document = manifest
        .documents
        .iter()
        .find(|doc| doc.id == id)
        .ok_or("归档文献不存在。")?;
    let entry = manifest
        .files
        .iter()
        .find(|entry| entry.path == document.source)
        .ok_or("归档原文未登记。")?;
    let source = SourceInput {
        root: root.to_path_buf(),
        relative: entry.path.clone(),
    };
    let (size, hash) = hash_source(&source)?;
    if size != entry.size || hash != entry.sha256 {
        return Err("恢复后的原文已改变，请从系统选择器重新打开。".into());
    }
    checked(root, &entry.path)
}
