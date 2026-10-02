#[path = "../headless_cli.rs"]
mod headless_cli;

use crate::note_files::store;
use std::{ffi::OsString, fs, path::PathBuf};
use store::FileStore;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "liteasy-headless-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).unwrap();
        Self(root.canonicalize().unwrap())
    }
    fn selected(&self, scope: &str) -> (FileStore, store::Mount) {
        let vault = self.0.join("vault");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("研究.md"), "# 已授权\nlocal text\n").unwrap();
        let files = FileStore::open(&self.0, scope).unwrap();
        let mount = files.register(&vault, "directory").unwrap();
        (files, mount)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn invoke(root: &std::path::Path, scope: &str, args: &[&str]) -> (i32, String, String) {
    let mut out = Vec::new();
    let mut err = Vec::new();
    let args = args.iter().map(OsString::from).collect::<Vec<_>>();
    let code = headless_cli::run(
        &args,
        || Ok(root.to_path_buf()),
        || Ok(scope.into()),
        &mut out,
        &mut err,
    );
    (
        code,
        String::from_utf8(out).unwrap(),
        String::from_utf8(err).unwrap(),
    )
}

#[test]
fn extracts_the_same_snapshot_as_gui_with_revision_and_no_truncation() {
    let fixture = Fixture::new();
    let (gui, mount) = fixture.selected("local");
    let expected = gui.read(&mount.id, "研究.md").unwrap();
    let (code, out, err) = invoke(
        &fixture.0,
        "local",
        &[
            "extract",
            &mount.id,
            "研究.md",
            "--json",
            "--expected-revision",
            expected.version.as_ref().unwrap(),
        ],
    );
    assert_eq!(code, 0, "{err}");
    assert!(err.is_empty());
    let value: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(value["schema"], "liteasy.local-files-cli/v1");
    assert_eq!(
        value["result"]["snapshot"],
        serde_json::to_value(&expected).unwrap()
    );
    assert_eq!(value["result"]["revision"], expected.version.unwrap());
    assert_eq!(value["result"]["format"], "markdown");
    assert_eq!(value["result"]["bytes"], expected.text.len());
    assert_eq!(value["result"]["truncated"], false);
}

#[test]
fn rejects_account_scopes_before_resolving_data_and_never_opens_credentials() {
    let mut out = Vec::new();
    let mut err = Vec::new();
    let args = [OsString::from("mounts")];
    let code = headless_cli::run(
        &args,
        || panic!("must not resolve account data"),
        || Ok("user:restored-account".into()),
        &mut out,
        &mut err,
    );
    assert_eq!(code, 4);
    assert!(out.is_empty());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&err).unwrap()["error"]["code"],
        "scope_unavailable"
    );
}

#[test]
fn rejects_unknown_grants_absolute_paths_traversal_and_account_grants() {
    let fixture = Fixture::new();
    let (_gui, mount) = fixture.selected("user:private");
    assert_eq!(
        invoke(&fixture.0, "local", &["extract", &mount.id, "研究.md"]).0,
        4
    );
    let (_gui, mount) = fixture.selected("local");
    for path in [
        "/private.md",
        "../private.md",
        "C:\\secret.md",
        "https://example.test/a.md",
    ] {
        assert_eq!(
            invoke(&fixture.0, "local", &["extract", &mount.id, path]).0,
            2
        );
    }
    assert_eq!(
        invoke(
            &fixture.0,
            "local",
            &["extract", "/tmp/authorized.md", "研究.md"]
        )
        .0,
        2
    );
}

#[test]
fn rejects_changed_revision_without_emitting_file_content() {
    let fixture = Fixture::new();
    let (gui, mount) = fixture.selected("local");
    let version = gui.read(&mount.id, "研究.md").unwrap().version.unwrap();
    fs::write(fixture.0.join("vault/研究.md"), "changed private text").unwrap();
    let (code, out, err) = invoke(
        &fixture.0,
        "local",
        &[
            "extract",
            &mount.id,
            "研究.md",
            "--expected-revision",
            &version,
        ],
    );
    assert_eq!(code, 5);
    assert!(out.is_empty());
    assert!(!err.contains("changed private text"));
}

#[test]
fn missing_database_is_not_created_and_writes_flags_or_credentials_are_rejected() {
    let fixture = Fixture::new();
    assert_eq!(invoke(&fixture.0, "local", &["mounts"]).0, 3);
    assert!(!fixture.0.join("note-files").exists());
    for args in [
        vec!["copy", "grant", "a.md"],
        vec!["mounts", "--scope", "local"],
        vec!["mounts", "--api-key", "secret"],
        vec!["mounts", "--output", "leak.json"],
        vec!["mounts", "--json", "--json"],
    ] {
        let (code, out, err) = invoke(&fixture.0, "local", &args);
        assert_eq!(code, 2);
        assert!(out.is_empty());
        assert!(!err.contains("secret"));
    }
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
}

#[test]
fn read_only_connection_sees_committed_gui_grants_but_cannot_modify_them() {
    let fixture = Fixture::new();
    let (gui, first) = fixture.selected("local");
    let readonly = FileStore::open_read_only(&fixture.0, "local").unwrap();
    assert_eq!(readonly.mounts().unwrap().len(), 1);
    assert!(readonly
        .register(&fixture.0.join("vault"), "directory")
        .is_err());
    assert!(readonly.managed_canvas("must-not-create").is_err());
    assert!(!fixture.0.join("boards").exists());
    let snapshot = readonly.read(&first.id, "研究.md").unwrap();
    assert!(readonly
        .write(
            &first.id,
            "研究.md",
            "forbidden",
            snapshot.version.as_deref()
        )
        .is_err());
    assert_eq!(
        readonly.read(&first.id, "研究.md").unwrap().text,
        snapshot.text
    );
    let second_path = fixture.0.join("second.canvas");
    fs::write(&second_path, "{}").unwrap();
    let second = gui.register(&second_path, "file").unwrap();
    assert_eq!(readonly.mounts().unwrap().len(), 2);
    assert_eq!(invoke(&fixture.0, "local", &["list", &first.id]).0, 0);
    let (code, out, err) = invoke(
        &fixture.0,
        "local",
        &["extract", &second.id, "second.canvas"],
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&out).unwrap()["result"]["format"],
        "canvas"
    );
    drop(readonly);
    drop(gui);
    let before = fs::read(fixture.0.join("note-files/grants.v1.sqlite3")).unwrap();
    assert_eq!(invoke(&fixture.0, "local", &["mounts"]).0, 0);
    assert_eq!(
        fs::read(fixture.0.join("note-files/grants.v1.sqlite3")).unwrap(),
        before
    );
}

#[test]
fn rejects_oversized_and_non_utf8_sources_without_partial_stdout() {
    let fixture = Fixture::new();
    let (_gui, mount) = fixture.selected("local");
    fs::File::create(fixture.0.join("vault/huge.md"))
        .unwrap()
        .set_len(8 * 1024 * 1024 + 1)
        .unwrap();
    fs::write(fixture.0.join("vault/binary.md"), [0xff, 0xfe]).unwrap();
    for path in ["huge.md", "binary.md"] {
        let (code, out, _) = invoke(&fixture.0, "local", &["extract", &mount.id, path]);
        assert_eq!(code, 6);
        assert!(out.is_empty());
    }
}

#[cfg(unix)]
#[test]
fn rejects_redirected_grants_and_symlink_database() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let (gui, mount) = fixture.selected("local");
    fs::write(fixture.0.join("private.md"), "private").unwrap();
    symlink(
        fixture.0.join("private.md"),
        fixture.0.join("vault/link.md"),
    )
    .unwrap();
    assert_eq!(
        invoke(&fixture.0, "local", &["extract", &mount.id, "link.md"]).0,
        6
    );
    drop(gui);
    let database = fixture.0.join("note-files/grants.v1.sqlite3");
    fs::rename(&database, fixture.0.join("other.sqlite3")).unwrap();
    symlink(fixture.0.join("other.sqlite3"), &database).unwrap();
    assert_eq!(invoke(&fixture.0, "local", &["mounts"]).0, 3);
}
