#[path = "../src/local-archive/archive.rs"]
mod archive;

use archive::{commit, prepare_export, prepare_restore, DocumentInput, SourceInput};
use serde_json::json;
use std::{fs, path::PathBuf};

fn fixture() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "liteasy-archive-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&root).unwrap();
    root.canonicalize().unwrap()
}

fn document(root: &std::path::Path) -> DocumentInput {
    fs::write(root.join("中文 原文.pdf"), b"%PDF-1.7\nsynthetic source").unwrap();
    DocumentInput {
        private_id: "private-paper-id".into(),
        title: "中文研究".into(),
        source: SourceInput {
            root: root.to_path_buf(),
            relative: "中文 原文.pdf".into(),
        },
        annotations: Some(json!({"version":2,"autoPublic":true,"annotations":[{
            "id":"private-annotation","page":2,"kind":"highlight","excerpt":"Evidence excerpt","note":"My annotation note",
            "text":"quote","rects":[{"left":0.1,"top":0.2,"width":0.3,"height":0.1,"accessToken":"nested-secret"}],
            "review":{"text":"Full review body","generatedAt":"2026-10-02","updatedAt":"2026-10-02","sourceRevision":1,"apiKey":"nested-secret"},
            "quickAsk":{"question":"Full question","answer":"Full answer","pageText":"Page context","abstractText":"Abstract context","authorization":"nested-secret"},
            "ink":{"points":[{"x":10,"y":20,"token":"nested-secret"}],"color":"#123456","width":1,"password":"nested-secret"},
            "publication":{"remoteAnnotationId":"private-remote-id"},"apiKey":"never-export"
        }]})),
    }
}

fn records() -> serde_json::Value {
    json!([
        {"key":"head/source-private","value":{"objectId":"source-private","kind":"source.document","lifecycle":"active","content":{"payload":{"paperId":"private-paper-id"}}}},
        {"key":"head/note-private","value":{"objectId":"note-private","kind":"content.note","lifecycle":"active","title":"Research note","scopeId":"user:private","content":{"payload":{"text":"A linked note","origin":"user"}},"provenance":{"sourceRefs":[{"objectId":"source-private"}],"runId":"private-run"}}},
        {"key":"head/unselected","value":{"objectId":"unselected","kind":"conversation.message","content":{"payload":{"text":"unselected private conversation"}}}},
        {"key":"workflow-run/private-run","value":{"status":"completed","apiKey":"secret-key","accessToken":"secret-token","outputPath":"/home/private/path"}}
    ])
}

#[test]
fn export_preview_then_restore_preserves_sources_notes_annotations_and_relations() {
    let root = fixture();
    let source = root.join("source");
    fs::create_dir(&source).unwrap();
    let doc = document(&source);
    let target = root.join("export");
    let plan = prepare_export(vec![doc], &records(), &target).unwrap();
    assert!(
        !target.exists(),
        "preview must not create its output directory"
    );
    assert_eq!(plan.manifest.documents.len(), 1);
    assert_eq!(plan.manifest.notes.len(), 1);
    assert!(!plan.manifest.relations.is_empty());
    let manifest_text = serde_json::to_string(&plan.manifest).unwrap();
    assert!(!manifest_text.contains("private-paper-id"));
    let result = commit(plan).unwrap();
    assert_eq!(result.status, "committed");
    let text_files = fs::read_to_string(target.join("manifest.json")).unwrap()
        + &fs::read_to_string(target.join("annotations/document-0001.json")).unwrap()
        + &fs::read_to_string(target.join("notes/note-0001.md")).unwrap()
        + &fs::read_to_string(target.join("receipts/run-0001.json")).unwrap();
    for private in [
        "private-paper-id",
        "private-annotation",
        "private-remote-id",
        "user:private",
        "secret-key",
        "secret-token",
        "nested-secret",
        "/home/private/path",
        "unselected private conversation",
    ] {
        assert!(!text_files.contains(private), "leaked {private}");
    }
    let restore = root.join("restore");
    let plan = prepare_restore(&target, &restore).unwrap();
    assert!(!restore.exists());
    commit(plan).unwrap();
    assert_eq!(
        fs::read(restore.join("sources/document-0001.pdf")).unwrap(),
        fs::read(source.join("中文 原文.pdf")).unwrap()
    );
    assert!(fs::read_to_string(restore.join("notes/note-0001.md"))
        .unwrap()
        .contains("A linked note"));
    assert!(fs::read_to_string(restore.join("notes/document-0001.md"))
        .unwrap()
        .contains("第 2 页"));
    assert!(fs::read_to_string(restore.join("notes/document-0001.md"))
        .unwrap()
        .contains("My annotation note"));
    for body in ["Full review body", "Full question", "Full answer"] {
        assert!(fs::read_to_string(restore.join("notes/document-0001.md"))
            .unwrap()
            .contains(body));
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn interrupted_write_keeps_diagnostic_directory_without_committed_manifest() {
    use std::cell::Cell;
    let root = fixture();
    let source = root.join("source");
    fs::create_dir(&source).unwrap();
    let target = root.join("interrupted");
    let plan = prepare_export(vec![document(&source)], &json!([]), &target).unwrap();
    let calls = Cell::new(0);
    let result = archive::commit_checked(plan, || {
        calls.set(calls.get() + 1);
        if calls.get() >= 4 {
            Err("模拟账号切换或任务中断".into())
        } else {
            Ok(())
        }
    });
    assert!(result.is_err());
    assert!(target.join(".liteasy-archive-incomplete.json").is_file());
    assert!(!target.join("manifest.json").exists());
    assert!(!target.join("receipt.json").exists());
    assert!(prepare_restore(&target, &root.join("unsafe-retry")).is_err());
    assert_eq!(
        fs::read(source.join("中文 原文.pdf")).unwrap(),
        b"%PDF-1.7\nsynthetic source"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn new_annotation_after_preview_and_unsupported_note_attachments_do_not_silently_disappear() {
    let root = fixture();
    let source = root.join("source");
    fs::create_dir(&source).unwrap();
    let target = root.join("export");
    let mut plan = prepare_export(vec![document(&source)], &json!([]), &target).unwrap();
    plan.bind_absence(SourceInput {
        root: source.clone(),
        relative: "new-annotations.json".into(),
    });
    fs::write(source.join("new-annotations.json"), b"new edits").unwrap();
    assert!(commit(plan).is_err());
    assert!(!target.exists());
    let mut rows = records();
    rows[1]["value"]["assets"] = json!([{"assetId":"attachment"}]);
    assert!(prepare_export(vec![document(&source)], &rows, &target).is_err());
    assert!(!target.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn changed_source_invalidates_preview_and_existing_directory_is_never_overwritten() {
    let root = fixture();
    let source = root.join("source");
    fs::create_dir(&source).unwrap();
    let target = root.join("export");
    let plan = prepare_export(vec![document(&source)], &json!([]), &target).unwrap();
    fs::write(source.join("中文 原文.pdf"), b"external edit").unwrap();
    assert!(commit(plan).is_err());
    assert!(
        !target.exists(),
        "preconditions must be checked before starting output"
    );
    fs::create_dir(&target).unwrap();
    fs::write(target.join("keep.txt"), b"user content").unwrap();
    assert!(prepare_export(vec![document(&source)], &json!([]), &target).is_err());
    assert_eq!(fs::read(target.join("keep.txt")).unwrap(), b"user content");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn restore_rejects_corruption_unknown_version_and_preview_revision_change() {
    let root = fixture();
    let source = root.join("source");
    fs::create_dir(&source).unwrap();
    let exported = root.join("export");
    commit(prepare_export(vec![document(&source)], &json!([]), &exported).unwrap()).unwrap();
    let manifest_path = exported.join("manifest.json");
    let original = fs::read(&manifest_path).unwrap();
    let plan = prepare_restore(&exported, &root.join("restored")).unwrap();
    fs::write(&manifest_path, [original.as_slice(), b"\n"].concat()).unwrap();
    assert!(commit(plan).is_err());
    assert!(!root.join("restored").exists());
    let mut manifest: serde_json::Value = serde_json::from_slice(&original).unwrap();
    manifest["version"] = json!(999);
    fs::write(&manifest_path, manifest.to_string()).unwrap();
    assert!(prepare_restore(&exported, &root.join("unknown")).is_err());
    fs::write(&manifest_path, original).unwrap();
    fs::write(exported.join("sources/document-0001.pdf"), b"corrupt").unwrap();
    assert!(prepare_restore(&exported, &root.join("corrupt")).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn hostile_manifest_paths_and_case_collisions_are_rejected() {
    let root = fixture();
    let source = root.join("source");
    fs::create_dir(&source).unwrap();
    let exported = root.join("export");
    commit(prepare_export(vec![document(&source)], &json!([]), &exported).unwrap()).unwrap();
    let original: serde_json::Value =
        serde_json::from_slice(&fs::read(exported.join("manifest.json")).unwrap()).unwrap();
    for hostile in [
        "../outside.pdf",
        "/absolute.pdf",
        "C:/private.pdf",
        "sources/../private.pdf",
        "sources\\private.pdf",
        "sources/CON.pdf",
    ] {
        let mut value = original.clone();
        value["files"][0]["path"] = json!(hostile);
        fs::write(exported.join("manifest.json"), value.to_string()).unwrap();
        assert!(
            prepare_restore(&exported, &root.join("restore")).is_err(),
            "accepted {hostile}"
        );
    }
    let mut value = original.clone();
    let mut duplicate = value["files"][0].clone();
    duplicate["path"] = json!(value["files"][0]["path"].as_str().unwrap().to_uppercase());
    value["files"].as_array_mut().unwrap().push(duplicate);
    fs::write(exported.join("manifest.json"), value.to_string()).unwrap();
    assert!(prepare_restore(&exported, &root.join("restore")).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn source_or_archive_symlink_cannot_escape_the_selected_root() {
    use std::os::unix::fs::symlink;
    let root = fixture();
    let source = root.join("source");
    fs::create_dir(&source).unwrap();
    let doc = document(&source);
    fs::write(root.join("private.pdf"), b"%PDF-1.7\nprivate").unwrap();
    fs::remove_file(source.join("中文 原文.pdf")).unwrap();
    symlink(root.join("private.pdf"), source.join("中文 原文.pdf")).unwrap();
    assert!(prepare_export(vec![doc], &json!([]), &root.join("export")).is_err());
    fs::remove_file(source.join("中文 原文.pdf")).unwrap();
    let exported = root.join("export");
    commit(prepare_export(vec![document(&source)], &json!([]), &exported).unwrap()).unwrap();
    fs::remove_file(exported.join("sources/document-0001.pdf")).unwrap();
    symlink(
        root.join("private.pdf"),
        exported.join("sources/document-0001.pdf"),
    )
    .unwrap();
    assert!(prepare_restore(&exported, &root.join("restored")).is_err());
    fs::remove_dir_all(root).unwrap();
}
