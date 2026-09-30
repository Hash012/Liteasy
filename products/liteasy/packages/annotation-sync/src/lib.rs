//! The same loss-preserving annotation merge is used by desktop and Android workers.
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const LIMIT: usize = 32 * 1024 * 1024;
const MAX_REVISION: u64 = 9_007_199_254_740_990;
type Records = BTreeMap<String, Value>;
type Deletions = BTreeMap<String, u64>;

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(entries) => Value::Object(
            entries
                .iter()
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .map(|(k, v)| (k.clone(), canonical(v)))
                .collect(),
        ),
        Value::Array(entries) => Value::Array(entries.iter().map(canonical).collect()),
        _ => value.clone(),
    }
}

fn decode(bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() > LIMIT {
        return Err("批注文件超过容量限制。".into());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| "批注文件格式损坏。")?;
    Ok(canonical(&value))
}
fn parts(value: &Value, legacy: bool) -> Result<(Records, Deletions), String> {
    if value["version"] != 2 && !(legacy && (value["version"] == 1 || value["version"].is_null())) {
        return Err("批注版本不受支持，原始数据已保留。".into());
    }
    let entries = value["annotations"].as_array().ok_or("批注记录损坏。")?;
    if entries.len() > 100_000 {
        return Err("批注数量超过限制。".into());
    }
    let mut records = Records::new();
    for entry in entries {
        let id = entry["id"]
            .as_str()
            .filter(|v| !v.is_empty() && v.len() <= 512)
            .ok_or("批注标识无效。")?;
        let revision = entry["revision"]
            .as_u64()
            .or(if legacy && value["version"] != 2 {
                Some(1)
            } else {
                None
            })
            .ok_or("批注修订号无效。")?;
        if revision == 0
            || revision > MAX_REVISION
            || !entry.is_object()
            || records.insert(id.into(), entry.clone()).is_some()
        {
            return Err("批注标识重复或修订号无效。".into());
        }
        if value["version"] == 2
            && (entry["page"].as_u64().filter(|v| *v > 0).is_none()
                || !entry["rects"].is_array()
                || !entry["text"].is_string()
                || !matches!(
                    entry["kind"].as_str(),
                    Some("highlight" | "underline" | "note" | "text" | "ink")
                ))
        {
            return Err("批注内容损坏。".into());
        }
    }
    let mut deleted = Deletions::new();
    if let Some(sync) = value.get("sync") {
        if sync["version"] != 1 {
            return Err("批注同步版本不受支持。".into());
        }
        let tombstones = sync["tombstones"].as_object().ok_or("批注删除记录损坏。")?;
        if tombstones.len() > 100_000 {
            return Err("批注删除记录超过限制。".into());
        }
        for (id, revision) in tombstones {
            let revision = revision
                .as_u64()
                .filter(|r| *r > 0 && *r <= MAX_REVISION)
                .ok_or("批注删除修订号无效。")?;
            deleted.insert(id.clone(), revision);
        }
    }
    Ok((records, deleted))
}

/// Validate an imported snapshot without interpreting its presence as a user's edit or undo.
pub fn validate_import(bytes: &[u8], document_id: &str, content_hash: &str) -> Result<(), String> {
    let value = decode(bytes)?;
    identity(&value, document_id, Some(content_hash))?;
    let (records, deleted) = parts(&value, value["version"] != 2)?;
    if records.iter().any(|(id, record)| {
        deleted
            .get(id)
            .is_some_and(|revision| *revision >= record["revision"].as_u64().unwrap_or(1))
    }) {
        return Err("批注包含已删除的旧修订，原始数据已保留。".into());
    }
    Ok(())
}
fn identity(value: &Value, document_id: &str, content_hash: Option<&str>) -> Result<(), String> {
    if document_id.is_empty()
        || value
            .get("documentId")
            .is_some_and(|id| id.as_str() != Some(document_id))
    {
        return Err("批注对应另一份文献。".into());
    }
    if let (Some(expected), Some(actual)) = (content_hash, value.get("contentHash")) {
        if actual.as_str() != Some(expected) {
            return Err("PDF 文件版本不同，批注未自动合并。".into());
        }
    }
    if value["annotations"].as_array().is_some_and(|entries| {
        entries.iter().any(|e| {
            e["paperIdentity"]["paperId"]
                .as_str()
                .is_some_and(|id| id != document_id)
        })
    }) {
        return Err("批注包含其他文献的记录。".into());
    }
    Ok(())
}
fn finish(
    mut root: Value,
    records: Records,
    deleted: Deletions,
    document_id: &str,
    hash: Option<&str>,
) -> Result<Vec<u8>, String> {
    root["version"] = json!(2);
    root["documentId"] = json!(document_id);
    if let Some(hash) = hash {
        root["contentHash"] = json!(hash);
    }
    root["annotations"] = Value::Array(records.into_values().collect());
    root["sync"] = json!({"version": 1, "tombstones": deleted});
    let bytes = serde_json::to_vec(&root).map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("合并后的批注超过容量限制，原始数据已保留。".into());
    }
    Ok(bytes)
}

/// Track deletions at the native persistence boundary, including writers unaware of sync metadata.
pub fn prepare(previous: Option<&[u8]>, next: &[u8], document_id: &str) -> Result<Vec<u8>, String> {
    let mut next = decode(next)?;
    let (mut records, mut deleted) = parts(&next, false)?;
    identity(&next, document_id, None)?;
    let previous = previous.map(decode).transpose()?;
    if let Some(previous) = &previous {
        let (old_records, old_deleted) = parts(previous, true)?;
        identity(previous, document_id, next["contentHash"].as_str())?;
        for (id, revision) in old_deleted {
            deleted
                .entry(id)
                .and_modify(|r| *r = (*r).max(revision))
                .or_insert(revision);
        }
        for (id, record) in old_records {
            if !records.contains_key(&id) {
                let revision = record["revision"].as_u64().unwrap_or(1) + 1;
                deleted
                    .entry(id)
                    .and_modify(|r| *r = (*r).max(revision))
                    .or_insert(revision);
            }
        }
        // Preserve extensions that an older foreground editor did not serialize.
        for (key, value) in previous.as_object().ok_or("批注文件结构无效。")? {
            if !next
                .as_object()
                .ok_or("批注文件结构无效。")?
                .contains_key(key)
            {
                next[key] = value.clone();
            }
        }
    }
    for (id, record) in &mut records {
        if let Some(deletion) = deleted.get(id) {
            if record["revision"].as_u64().unwrap() <= *deletion {
                record["revision"] = json!(deletion + 1);
            }
        }
    }
    let hash = next["contentHash"].as_str().map(str::to_owned);
    finish(next, records, deleted, document_id, hash.as_deref())
}

fn visible<'a>(records: &'a Records, deleted: &Deletions, id: &str) -> Option<&'a Value> {
    records.get(id).filter(|record| {
        record["revision"].as_u64().unwrap_or(1) > deleted.get(id).copied().unwrap_or(0)
    })
}
fn copy_conflict(record: &Value, original: &str, reason: &str) -> Value {
    let mut copy = record.clone();
    let digest = Sha256::digest(serde_json::to_vec(record).expect("JSON value"));
    copy["id"] = json!(format!("conflict-{:x}", digest));
    copy["conflictOf"] = json!(original);
    copy["conflictReason"] = json!(reason);
    // A duplicate must never replay publication under the original annotation's remote identity.
    copy["publication"] = json!({"desiredVisibility": "private", "state": "not_published"});
    copy
}

/// Merge independent edits; preserve concurrent variants as deterministic, private conflict copies.
/// The caller supplies the common PDF fingerprint verified from both file manifests.
pub fn merge(
    base: Option<&[u8]>,
    local: &[u8],
    remote: &[u8],
    document_id: &str,
    content_hash: &str,
) -> Result<Vec<u8>, String> {
    if content_hash.len() != 64 || !content_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("PDF 指纹无效。".into());
    }
    let local = decode(local)?;
    let remote = decode(remote)?;
    let base = base
        .map(decode)
        .transpose()?
        .unwrap_or_else(|| json!({"version":2,"annotations":[],"autoPublic":false}));
    for value in [&base, &local, &remote] {
        identity(value, document_id, Some(content_hash))?;
    }
    let (b, bd) = parts(&base, false)?;
    let (l, ld) = parts(&local, false)?;
    let (r, rd) = parts(&remote, false)?;
    let mut deleted = bd.clone();
    for (id, revision) in ld.iter().chain(&rd) {
        deleted
            .entry(id.clone())
            .and_modify(|v| *v = (*v).max(*revision))
            .or_insert(*revision);
    }
    let keys: BTreeSet<_> = b
        .keys()
        .chain(l.keys())
        .chain(r.keys())
        .chain(deleted.keys())
        .cloned()
        .collect();
    let mut records = Records::new();
    let mut copies = Vec::new();
    for id in keys {
        let before = visible(&b, &bd, &id);
        let left = visible(&l, &ld, &id);
        let right = visible(&r, &rd, &id);
        let chosen = if left == right {
            left
        } else if left == before
            && !(before.is_none()
                && ld.contains_key(&id)
                && ld.get(&id) != bd.get(&id)
                && right.is_some())
        {
            right
        } else if right == before
            && !(before.is_none()
                && rd.contains_key(&id)
                && rd.get(&id) != bd.get(&id)
                && left.is_some())
        {
            left
        } else {
            match (left, right) {
                (Some(a), Some(z)) => {
                    let (first, second) = if a.to_string() <= z.to_string() {
                        (a, z)
                    } else {
                        (z, a)
                    };
                    copies.push(copy_conflict(second, &id, "concurrent-edit"));
                    Some(first)
                }
                (Some(record), None) | (None, Some(record)) => {
                    let revision = record["revision"].as_u64().unwrap() + 1;
                    deleted
                        .entry(id.clone())
                        .and_modify(|v| *v = (*v).max(revision))
                        .or_insert(revision);
                    copies.push(copy_conflict(record, &id, "delete-edit"));
                    None
                }
                _ => None,
            }
        };
        if let Some(record) = chosen {
            // A tombstone never silently resurrects its original ID after concurrent delete/edit.
            if deleted
                .get(&id)
                .is_some_and(|d| *d >= record["revision"].as_u64().unwrap())
            {
                if left != before || right != before {
                    copies.push(copy_conflict(record, &id, "delete-edit"));
                }
            } else {
                records.insert(id.clone(), record.clone());
            }
        } else if let Some(record) = before {
            let rev = record["revision"].as_u64().unwrap() + 1;
            deleted
                .entry(id.clone())
                .and_modify(|v| *v = (*v).max(rev))
                .or_insert(rev);
        }
    }
    let had_conflicts = !copies.is_empty();
    for copy in copies {
        let id = copy["id"].as_str().unwrap().to_owned();
        if !deleted.contains_key(&id) {
            records.entry(id).or_insert(copy);
        }
    }
    // Preserve extension fields; ambiguous extensions require an explicit file-level choice.
    let mut root = Map::new();
    let keys: BTreeSet<_> = local
        .as_object()
        .unwrap()
        .keys()
        .chain(remote.as_object().unwrap().keys())
        .collect();
    for key in keys {
        if matches!(
            key.as_str(),
            "annotations" | "sync" | "version" | "documentId" | "contentHash" | "autoPublic"
        ) {
            continue;
        }
        let a = local.get(key);
        let z = remote.get(key);
        let old = base.get(key);
        let value = if a == z || z == old {
            a
        } else if a == old {
            z
        } else if a.is_none() {
            z
        } else if z.is_none() {
            a
        } else {
            return Err("批注扩展内容存在冲突，请选择保留的文件版本。".into());
        };
        if let Some(value) = value {
            root.insert(key.clone(), value.clone());
        }
    }
    root.insert(
        "autoPublic".into(),
        json!(!had_conflicts && local["autoPublic"] == true && remote["autoPublic"] == true),
    );
    finish(
        Value::Object(root),
        records,
        deleted,
        document_id,
        Some(content_hash),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(id: &str, text: &str, revision: u64) -> Value {
        json!({"id":id,"text":text,"revision":revision,"kind":"note","page":1,"rects":[],"paperIdentity":{"paperId":"paper"},"publication":{"desiredVisibility":"private","state":"not_published"}})
    }
    fn snapshot(entries: Vec<Value>) -> Vec<u8> {
        serde_json::to_vec(&json!({"version":2,"autoPublic":false,"annotations":entries})).unwrap()
    }
    fn read(bytes: &[u8]) -> Value {
        serde_json::from_slice(bytes).unwrap()
    }
    fn merged(base: Option<&[u8]>, a: &[u8], b: &[u8]) -> Vec<u8> {
        merge(base, a, b, "paper", &"a".repeat(64)).unwrap()
    }
    #[test]
    fn independent_edits_merge_and_concurrent_edits_converge() {
        let base = snapshot(vec![entry("a", "old", 1)]);
        let left = snapshot(vec![entry("a", "left", 2), entry("b", "new", 1)]);
        let right = snapshot(vec![entry("a", "right", 2), entry("c", "new", 1)]);
        let result = merged(Some(&base), &left, &right);
        assert_eq!(result, merged(Some(&base), &right, &left));
        assert_eq!(read(&result)["annotations"].as_array().unwrap().len(), 4);
        assert_eq!(result, merged(Some(&result), &result, &result));
        assert!(read(&result)["annotations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["conflictOf"] == "a"));
    }
    #[test]
    fn delete_edit_preserves_edit_without_resurrecting_deleted_id() {
        let base = snapshot(vec![entry("a", "old", 1)]);
        let deleted = prepare(Some(&base), &snapshot(vec![]), "paper").unwrap();
        let edited = snapshot(vec![entry("a", "edited", 2)]);
        let result = merged(Some(&base), &deleted, &edited);
        let value = read(&result);
        let entries = value["annotations"].as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["text"], "edited");
        assert_ne!(entries[0]["id"], "a");
        assert_eq!(result, merged(Some(&base), &edited, &deleted));
        let stale = merged(None, &base, &deleted);
        assert_ne!(read(&stale)["annotations"][0]["id"], "a");
    }
    #[test]
    fn deletion_and_explicit_undo_survive_reopen() {
        let base = snapshot(vec![entry("a", "old", 1)]);
        let deleted = prepare(Some(&base), &snapshot(vec![]), "paper").unwrap();
        assert!(read(&merged(Some(&base), &base, &deleted))["annotations"]
            .as_array()
            .unwrap()
            .is_empty());
        let undone = prepare(Some(&deleted), &base, "paper").unwrap();
        assert_eq!(read(&undone)["annotations"][0]["revision"], 3);
        assert_eq!(
            read(&merged(Some(&deleted), &undone, &deleted))["annotations"][0]["id"],
            "a"
        );
    }
    #[test]
    fn wrong_document_future_version_and_duplicate_ids_stop_merge() {
        let valid = snapshot(vec![entry("a", "old", 1)]);
        for invalid in [
            json!({"version":99,"annotations":[]}),
            json!({"version":2,"documentId":"other","annotations":[]}),
            json!({"version":2,"contentHash":"b".repeat(64),"annotations":[]}),
        ] {
            assert!(merge(
                None,
                &valid,
                &serde_json::to_vec(&invalid).unwrap(),
                "paper",
                &"a".repeat(64)
            )
            .is_err());
        }
        assert!(prepare(
            None,
            &snapshot(vec![entry("a", "x", 1), entry("a", "y", 1)]),
            "paper"
        )
        .is_err());
    }
    #[test]
    fn imported_tombstones_are_not_interpreted_as_explicit_undo() {
        let mut value = read(&snapshot(vec![entry("a", "stale", 1)]));
        value["sync"] = json!({"version":1,"tombstones":{"a":2}});
        assert!(validate_import(
            &serde_json::to_vec(&value).unwrap(),
            "paper",
            &"a".repeat(64)
        )
        .is_err());
        value["sync"]["version"] = json!(7);
        assert!(prepare(None, &serde_json::to_vec(&value).unwrap(), "paper").is_err());
    }
    #[test]
    fn native_save_preserves_unknown_extensions_and_deletion_history() {
        let mut value = read(&snapshot(vec![entry("a", "old", 1)]));
        value["extension"] = json!({"opaque":"preserved"});
        let saved = prepare(
            Some(&serde_json::to_vec(&value).unwrap()),
            &snapshot(vec![]),
            "paper",
        )
        .unwrap();
        assert_eq!(read(&saved)["extension"], value["extension"]);
        let reopened = prepare(Some(&saved), &snapshot(vec![]), "paper").unwrap();
        assert_eq!(read(&reopened)["sync"]["tombstones"]["a"], 2);
    }
}
