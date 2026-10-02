#[path = "../src/local-recovery/profile.rs"]
mod profile;
use profile::{commit, prepare_backup, prepare_restore, validate_profile};
use rusqlite::{params, Connection};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn fixture() -> (PathBuf, Connection) {
    let root = std::env::temp_dir().join(format!(
        "liteasy-recovery-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(root.join("data/objects")).unwrap();
    fs::create_dir_all(root.join("library/.liteasy/paper-artifacts/paper-hash")).unwrap();
    fs::create_dir_all(root.join("external")).unwrap();
    fs::write(root.join("library/paper.pdf"), b"%PDF-1.7\nfixture").unwrap();
    fs::write(
        root.join("library/.liteasy-library.json"),
        json!({"libraryId":"fixture-library","schemaVersion":1}).to_string(),
    )
    .unwrap();
    fs::write(root.join("library/.liteasy/paper-artifacts/paper-hash/annotations.v1.json"),json!({"version":2,"annotations":[{"id":"annotation-id","kind":"highlight","page":1,"note":"Full annotation body","rects":[{"left":1,"top":2,"width":3,"height":4}]}]}).to_string()).unwrap();
    let root = root.canonicalize().unwrap();
    let db = Connection::open(root.join("data/objects/objects.v1.sqlite3")).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE object_records(scope TEXT,key TEXT,version TEXT,value TEXT,PRIMARY KEY(scope,key)) WITHOUT ROWID;").unwrap();
    for (scope, key, value) in [
        (
            "user:fixture",
            "head/note",
            json!({"schemaVersion":"liteasy.object/v1","scopeId":"user:fixture","objectId":"note","revision":"r1","kind":"content.note","content":{"payload":{"text":"Full note body"}}}),
        ),
        (
            "user:fixture",
            "revision/note/r1",
            json!({"schemaVersion":"liteasy.object/v1","scopeId":"user:fixture","objectId":"note","revision":"r1","kind":"content.note","content":{"payload":{"text":"Full note body"}}}),
        ),
        (
            "user:fixture",
            "relation/note/paper",
            json!({"from":{"objectId":"note","revision":"r1"},"to":{"paperId":"paper"}}),
        ),
        (
            "user:fixture",
            "run/receipt",
            json!({"state":"committed","output":{"objectId":"note","revision":"r1"}}),
        ),
        (
            "user:fixture",
            "extension-grant/private",
            json!({"apiKey":"excluded-secret"}),
        ),
        (
            "user:other",
            "head/private",
            json!({"text":"other-user-private"}),
        ),
    ] {
        db.execute(
            "INSERT INTO object_records VALUES(?1,?2,'version-kept',?3)",
            params![scope, key, value.to_string()],
        )
        .unwrap();
    }
    let scope_hash = hash(b"user:fixture");
    let canvas_path = format!("boards/{scope_hash}/board.canvas");
    fs::create_dir_all(root.join("data").join(format!("boards/{scope_hash}"))).unwrap();
    fs::write(
        root.join("data").join(&canvas_path),
        b"{\"nodes\":[{\"id\":\"n\",\"text\":\"Canvas body\"}],\"edges\":[]}",
    )
    .unwrap();
    fs::write(root.join("external/note.md"), b"External linked note body").unwrap();
    fs::create_dir_all(root.join("data/note-files")).unwrap();
    let grants = Connection::open(root.join("data/note-files/grants.v1.sqlite3")).unwrap();
    grants.execute_batch("CREATE TABLE grants(scope TEXT,id TEXT,path TEXT,kind TEXT,PRIMARY KEY(scope,id),UNIQUE(scope,path,kind));").unwrap();
    for (id, path, key, relative) in [
        (
            "a".repeat(64),
            root.join("data").join(format!("boards/{scope_hash}")),
            "board-file/board",
            "board.canvas",
        ),
        (
            "b".repeat(64),
            root.join("external"),
            "object-file/note",
            "note.md",
        ),
    ] {
        grants
            .execute(
                "INSERT INTO grants VALUES('user:fixture',?1,?2,'directory')",
                params![id, path.to_string_lossy()],
            )
            .unwrap();
        db.execute(
            "INSERT INTO object_records VALUES('user:fixture',?1,'binding-version',?2)",
            params![key, json!({"mountId":id,"path":relative}).to_string()],
        )
        .unwrap();
    }
    (root, db)
}
#[test]
fn logical_wal_snapshot_restores_notes_annotations_relations_receipts_and_canvas_to_new_profile() {
    let (root, live_db) = fixture();
    let backup = root.join("backup");
    let plan = prepare_backup(
        &root.join("data"),
        &root.join("library"),
        "user:fixture",
        &backup,
    )
    .unwrap();
    assert!(!backup.exists());
    commit(plan, || Ok(())).unwrap();
    let snapshot = fs::read_to_string(backup.join("snapshot.json")).unwrap();
    assert!(!snapshot.contains("excluded-secret"));
    assert!(!snapshot.contains("other-user-private"));
    assert!(!snapshot.contains(root.join("external").to_str().unwrap()));
    let restored = root.join("restored");
    let plan = prepare_restore(&backup, &restored).unwrap();
    commit(plan, || Ok(())).unwrap();
    let bootstrap = validate_profile(&restored).unwrap();
    assert_eq!(bootstrap.archived_scope, "user:fixture");
    let db = Connection::open(bootstrap.active_root.join("objects/objects.v1.sqlite3")).unwrap();
    let(value,version):(String,String)=db.query_row("SELECT value,version FROM object_records WHERE scope='user:fixture' AND key='head/note'",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
    assert!(value.contains("Full note body"));
    assert_eq!(version, "version-kept");
    for key in ["revision/note/r1", "relation/note/paper", "run/receipt"] {
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM object_records WHERE key=?1",
                [key],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
    assert!(fs::read_to_string(
        bootstrap
            .active_root
            .join("local-library/library/.liteasy/paper-artifacts/paper-hash/annotations.v1.json")
    )
    .unwrap()
    .contains("Full annotation body"));
    let grants =
        Connection::open(bootstrap.active_root.join("note-files/grants.v1.sqlite3")).unwrap();
    for (id, file, expected) in [
        ("a".repeat(64), "board.canvas", "Canvas body"),
        ("b".repeat(64), "note.md", "External linked note body"),
    ] {
        let path: String = grants
            .query_row("SELECT path FROM grants WHERE id=?1", [id], |r| r.get(0))
            .unwrap();
        assert!(PathBuf::from(&path).starts_with(&bootstrap.active_root));
        assert!(fs::read_to_string(PathBuf::from(path).join(file))
            .unwrap()
            .contains(expected));
    }
    assert!(root.join("external/note.md").is_file());
    drop(live_db);
    drop(db);
    drop(grants);
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn changed_rows_unknown_versions_and_incomplete_profiles_are_not_committed_or_opened() {
    let (root, db) = fixture();
    let backup = root.join("backup");
    let plan = prepare_backup(
        &root.join("data"),
        &root.join("library"),
        "user:fixture",
        &backup,
    )
    .unwrap();
    db.execute(
        "UPDATE object_records SET version='new-version' WHERE key='head/note'",
        [],
    )
    .unwrap();
    assert!(commit(plan, || Ok(())).is_err());
    assert!(!backup.exists());
    commit(
        prepare_backup(
            &root.join("data"),
            &root.join("library"),
            "user:fixture",
            &backup,
        )
        .unwrap(),
        || Ok(()),
    )
    .unwrap();
    let restored = root.join("restored");
    let plan = prepare_restore(&backup, &restored).unwrap();
    let calls = std::cell::Cell::new(0);
    assert!(commit(plan, || {
        calls.set(calls.get() + 1);
        if calls.get() > 4 {
            Err("interrupted".into())
        } else {
            Ok(())
        }
    })
    .is_err());
    assert!(restored.join(".liteasy-recovery-incomplete.json").exists());
    assert!(validate_profile(&restored).is_err());
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(backup.join("manifest.json")).unwrap()).unwrap();
    manifest["schema"] = json!("liteasy.recovery-archive/v999");
    fs::write(backup.join("manifest.json"), manifest.to_string()).unwrap();
    assert!(prepare_restore(&backup, &root.join("unknown")).is_err());
    drop(db);
    fs::remove_dir_all(root).unwrap();
}
#[test]
fn malformed_raw_row_is_retained_but_credential_payloads_are_never_exported() {
    let (root, db) = fixture();
    db.execute("INSERT INTO object_records VALUES('user:fixture','head/broken','original-revision','{raw broken bytes')",[]).unwrap();
    let backup = root.join("backup");
    commit(
        prepare_backup(
            &root.join("data"),
            &root.join("library"),
            "user:fixture",
            &backup,
        )
        .unwrap(),
        || Ok(()),
    )
    .unwrap();
    assert!(fs::read_to_string(backup.join("snapshot.json"))
        .unwrap()
        .contains("{raw broken bytes"));
    db.execute(
        "INSERT INTO object_records VALUES('user:fixture','workflow-run/unsafe','v1',?1)",
        [json!({"apiKey":"never-archive"}).to_string()],
    )
    .unwrap();
    assert!(prepare_backup(
        &root.join("data"),
        &root.join("library"),
        "user:fixture",
        &root.join("unsafe")
    )
    .is_err());
    assert!(!root.join("unsafe").exists());
    drop(db);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn hostile_paths_tampered_profile_and_existing_destination_are_rejected() {
    let (root, db) = fixture();
    let backup = root.join("backup");
    commit(
        prepare_backup(
            &root.join("data"),
            &root.join("library"),
            "user:fixture",
            &backup,
        )
        .unwrap(),
        || Ok(()),
    )
    .unwrap();
    let original = fs::read(backup.join("manifest.json")).unwrap();
    for path in [
        "data/local-library/library/../outside",
        "data/local-library/library/CON.pdf",
        "data/local-library/library/a\\b",
        "/absolute",
    ] {
        let mut manifest: serde_json::Value = serde_json::from_slice(&original).unwrap();
        manifest["files"][0]["path"] = json!(path);
        fs::write(backup.join("manifest.json"), manifest.to_string()).unwrap();
        assert!(prepare_restore(&backup, &root.join("rejected")).is_err());
        assert!(!root.join("rejected").exists());
    }
    fs::write(backup.join("manifest.json"), original).unwrap();
    let restored = root.join("restored");
    commit(prepare_restore(&backup, &restored).unwrap(), || Ok(())).unwrap();
    assert!(prepare_restore(&backup, &restored).is_err());
    let mut marker: serde_json::Value =
        serde_json::from_slice(&fs::read(restored.join("profile.json")).unwrap()).unwrap();
    marker["scope"] = json!("user:other");
    fs::write(restored.join("profile.json"), marker.to_string()).unwrap();
    assert!(validate_profile(&restored).is_err());
    drop(db);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn links_and_oversize_sources_stop_before_output_is_created() {
    use std::os::unix::fs::symlink;
    let (root, db) = fixture();
    let source = root.join("library/paper.pdf");
    fs::remove_file(&source).unwrap();
    symlink(root.join("external/note.md"), &source).unwrap();
    assert!(prepare_backup(
        &root.join("data"),
        &root.join("library"),
        "user:fixture",
        &root.join("unsafe")
    )
    .is_err());
    fs::remove_file(&source).unwrap();
    fs::File::create(&source)
        .unwrap()
        .set_len(1024 * 1024 * 1024 + 1)
        .unwrap();
    assert!(prepare_backup(
        &root.join("data"),
        &root.join("library"),
        "user:fixture",
        &root.join("unsafe")
    )
    .is_err());
    assert!(!root.join("unsafe").exists());
    drop(db);
    fs::remove_dir_all(root).unwrap();
}
