#[path = "../src/native-open/files.rs"]
mod files;

use files::{paths_from_argv, OpenFiles};
use std::{ffi::OsString, fs, path::PathBuf};

fn fixture() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "liteasy-native-open-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap()
}

#[test]
fn argv_retains_multiple_unicode_files_and_resolves_sender_cwd() {
    let root = fixture();
    let first = root.join("中文 空格 #1.pdf");
    let second = root.join("book.epub");
    let url = url::Url::from_file_path(&second).unwrap();
    let argv = [
        "Liteasy",
        "中文 空格 #1.pdf",
        url.as_str(),
        "--flag",
        "liteasy://oauth/callback",
        "https://example.test/a.pdf",
    ]
    .into_iter()
    .map(OsString::from)
    .collect::<Vec<_>>();
    assert_eq!(paths_from_argv(argv, &root), vec![first, second]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn argv_requires_separator_for_dash_filename_and_ignores_option_values() {
    let root = fixture();
    let argv = ["Liteasy", "--unknown", "secret.pdf", "--", "-paper.pdf"]
        .into_iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
    assert_eq!(paths_from_argv(argv, &root), vec![root.join("-paper.pdf")]);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn exact_file_grants_are_read_only_scope_bound_and_survive_queue_drain() {
    let root = fixture();
    let path = root.join("论文.PDF");
    fs::write(&path, b"%PDF-1.7\nfixture").unwrap();
    let mut files = OpenFiles::default();
    files.enqueue("local", vec![path.clone(), path.clone()]);
    let queued = files.drain("local");
    assert_eq!(queued.files.len(), 1);
    let grant = &queued.files[0];
    assert_eq!(grant.file_name, "论文.PDF");
    assert_eq!(grant.format, "pdf");
    assert_eq!(
        files.read("local", &grant.id).unwrap(),
        b"%PDF-1.7\nfixture"
    );
    assert!(files.read("user:other", &grant.id).is_err());
    assert!(files.read("local", &path.to_string_lossy()).is_err());
    assert!(files.drain("local").files.is_empty());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_inputs_do_not_drop_other_files_and_changed_sources_require_reselection() {
    let root = fixture();
    let path = root.join("good.pdf");
    fs::write(&path, b"%PDF-1.7\nfixture").unwrap();
    fs::write(root.join("bad.txt"), b"private").unwrap();
    let mut files = OpenFiles::default();
    files.enqueue(
        "local",
        vec![
            root.clone(),
            root.join("bad.txt"),
            root.join("gone.pdf"),
            path.clone(),
        ],
    );
    let queued = files.drain("local");
    assert_eq!(queued.files.len(), 1);
    assert_eq!(queued.errors.len(), 3);
    fs::write(&path, b"changed source content").unwrap();
    assert!(files.read("local", &queued.files[0].id).is_err());
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn oversized_files_and_non_document_content_are_rejected_without_copying() {
    let root = fixture();
    let huge = root.join("huge.pdf");
    fs::File::create(&huge)
        .unwrap()
        .set_len(100 * 1024 * 1024 + 1)
        .unwrap();
    let wrong = root.join("wrong.pdf");
    fs::write(&wrong, b"not a document").unwrap();
    let mut files = OpenFiles::default();
    assert!(files.select("local", &huge).is_err());
    assert!(files.select("local", &wrong).is_err());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn queue_overflow_is_explicit_even_when_earlier_paths_are_duplicates() {
    let root = fixture();
    let source = root.join("selected.pdf");
    fs::write(&source, b"%PDF-1.7\nfixture").unwrap();
    let mut files = OpenFiles::default();
    files.enqueue("local", vec![source; 40]);
    let queued = files.drain("local");
    assert_eq!(queued.files.len(), 1);
    assert_eq!(queued.errors.len(), 1);
    assert_eq!(queued.errors[0].code, "native_open_queue_full");
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn releasing_a_grant_closes_only_its_own_scope_and_removes_pending_delivery() {
    let root = fixture();
    let source = root.join("selected.pdf");
    fs::write(&source, b"%PDF-1.7\nfixture").unwrap();
    let mut files = OpenFiles::default();
    let selected = files.select("local", &source).unwrap();
    files.enqueue("local", vec![source]);
    files.release("user:other", &selected.id);
    assert!(files.read("local", &selected.id).is_ok());
    files.release("local", &selected.id);
    assert!(files.read("local", &selected.id).is_err());
    assert!(files.drain("local").files.is_empty());
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn file_url_handoff_rejects_remote_hosts_queries_and_fragments() {
    for input in [
        "https://example.test/a.pdf",
        "file://remote/a.pdf",
        "file:///a.pdf?query",
        "file:///a.pdf#fragment",
        "liteasy://oauth/callback",
    ] {
        assert!(files::path_from_url(&url::Url::parse(input).unwrap()).is_none());
    }
}

#[test]
fn scope_switch_discards_undrained_files_and_rejects_late_old_scope_enqueue() {
    let root = fixture();
    let path = root.join("old.pdf");
    fs::write(&path, b"%PDF-1.7\nfixture").unwrap();
    let mut files = OpenFiles::default();
    let old = files.select("local", &path).unwrap();
    files.enqueue("local", vec![path.clone()]);
    assert!(files.drain("user:b").files.is_empty());
    assert!(files.read("local", &old.id).is_err());
    let current = files.select("user:b", &path).unwrap();
    assert!(!files.enqueue_current("local", "user:b", vec![path.clone()]));
    assert!(files.read("user:b", &current.id).is_ok());
    assert!(files.drain("local").files.is_empty());
    assert!(files.read("user:b", &current.id).is_err());
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn replacing_a_file_with_same_length_and_mtime_requires_new_selection() {
    let root = fixture();
    let path = root.join("selected.pdf");
    let replacement = root.join("replacement.pdf");
    fs::write(&path, b"%PDF-1.7\noriginal").unwrap();
    fs::write(&replacement, b"%PDF-1.7\nreplaced").unwrap();
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&replacement)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    let mut files = OpenFiles::default();
    let old = files.select("local", &path).unwrap();
    // Move the selected inode aside so Windows sharing permits replacement too.
    fs::rename(&path, root.join("previous.pdf")).unwrap();
    fs::rename(&replacement, &path).unwrap();
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), modified);
    assert!(files.read("local", &old.id).is_err());
    let selected = files.select("local", &path).unwrap();
    assert_ne!(selected.id, old.id);
    assert_eq!(
        files.read("local", &selected.id).unwrap(),
        b"%PDF-1.7\nreplaced"
    );
    drop(files);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn symlink_selection_and_replacement_cannot_redirect_a_grant() {
    use std::os::unix::fs::symlink;
    let root = fixture();
    let source = root.join("selected.pdf");
    let private = root.join("private.pdf");
    fs::write(&source, b"%PDF-1.7\nselected").unwrap();
    fs::write(&private, b"%PDF-1.7\nprivate").unwrap();
    symlink(&private, root.join("link.pdf")).unwrap();
    let mut files = OpenFiles::default();
    assert!(files.select("local", &root.join("link.pdf")).is_err());
    let selected = files.select("local", &source).unwrap();
    fs::remove_file(&source).unwrap();
    symlink(&private, &source).unwrap();
    assert!(files.read("local", &selected.id).is_err());
    drop(files);
    fs::remove_dir_all(root).unwrap();
}
