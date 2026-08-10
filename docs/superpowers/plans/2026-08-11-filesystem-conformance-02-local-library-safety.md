# Local Library Safety Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent local-library writes from escaping through links, preserve durable files during Windows replacement, serialize index mutations, and force full validation after application resume.

**Architecture:** Validate every managed directory component before using `.liteasy`, and rebuild restore parents through the existing component-wise safe folder helper. Keep temporary-file durability in `write_bytes_atomically`, delegate publication to a platform-specific atomic replacement primitive, and route command and watcher index work through one mutex stored in `LocalLibraryWatchState`. Resume restarts the watcher and sends an explicit full-validation signal through its channel.

**Tech Stack:** Rust 2021, Tauri 2, `notify` 8, `windows-sys` 0.61, Rust unit tests.

## Global Constraints

- The confirmed source of truth is `docs/design/Liteasy-文件系统与存储边界设计.md`, especially sections 5.5, 6.2, 17.1, 17.3, 18.1, and 19.1.
- Never follow a symbolic link, Windows directory junction, or other reparse point when creating or writing managed library data.
- A failed overwrite must leave the previously durable file available; never delete the destination before publishing the replacement.
- All command and watcher scans that can assign or preserve document IDs use the same process-local transaction lock.
- A `RunEvent::Resumed` event restarts filesystem watching and requests a full scan before incremental events are trusted.
- Preserve existing document IDs, recovery markers, operation echoes, user files, and rollback behavior.

---

### Task 1: Reject linked managed directories and restore parents

**Files:**
- Modify: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:633`
- Test: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:3907`
- Test: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:4873`

**Interfaces:**
- Produces: `ensure_managed_directory(root: &Path, relative: &Path, label: &str) -> Result<PathBuf, String>`.
- Consumes: `ensure_relative_folder(root, requested)` for restoring user-visible parent directories component by component.

- [x] **Step 1: Add failing Unix link-escape tests**

Add tests proving that `migrate_legacy_layout` rejects a linked `.liteasy` directory without creating files outside the root, and that `restore_trash_at_root` rejects an original parent replaced by a symbolic link without moving the payload outside the root.

```rust
#[cfg(unix)]
#[test]
fn rejects_a_symbolic_linked_internal_directory_without_writing_outside() {
    use std::os::unix::fs::symlink;

    let root = temporary_directory("linked-internal-root");
    let outside = temporary_directory("linked-internal-outside");
    symlink(&outside, root.join(INTERNAL_DIRECTORY_NAME)).unwrap();

    let error = migrate_legacy_layout(&root).unwrap_err();

    assert!(error.contains("符号链接") || error.contains("目录联接"));
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    fs::remove_file(root.join(INTERNAL_DIRECTORY_NAME)).unwrap();
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(outside).unwrap();
}
```

```rust
#[cfg(unix)]
#[test]
fn restore_rejects_a_symbolic_linked_original_parent() {
    use std::os::unix::fs::symlink;

    let root = initialized_library("restore-linked-parent");
    let outside = temporary_directory("restore-linked-parent-outside");
    fs::create_dir(root.join("Research")).unwrap();
    let source = root.join("Research/paper.pdf");
    fs::write(&source, b"%PDF-1.7\nbody").unwrap();
    scan_local_library_root(&root).unwrap();
    trash_resource_at_root(&root, &source.to_string_lossy()).unwrap();
    fs::remove_dir(root.join("Research")).unwrap();
    symlink(&outside, root.join("Research")).unwrap();
    let trash_id = list_trash_entries(&root).unwrap()[0].trash_id.clone();

    let error = restore_trash_at_root(&root, &trash_id).unwrap_err();

    assert!(error.contains("冲突") || error.contains("符号链接"));
    assert!(!outside.join("paper.pdf").exists());
    fs::remove_file(root.join("Research")).unwrap();
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(outside).unwrap();
}
```

- [x] **Step 2: Verify the link tests fail against the current implementation**

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test symbolic_linked -- --nocapture`

Expected: the managed-directory test observes files created outside the root or receives no error; the restore test observes a successful restore through the link.

- [x] **Step 3: Add component-wise managed directory validation**

Implement `ensure_managed_directory` using `symlink_metadata`, rejecting link-like entries and non-directories, creating only one missing component at a time, canonicalizing every component, and requiring every canonical directory to remain under `root`. On Windows, treat `FILE_ATTRIBUTE_REPARSE_POINT` as link-like. Use it in `migrate_legacy_layout` for `.liteasy`, `index`, `paper-artifacts`, `metadata-entries`, `import-staging`, `trash`, and `trash-operations`.

- [x] **Step 4: Restore through a checked parent**

Replace `fs::create_dir_all(parent)` in `restore_trash_at_root` with:

```rust
let requested_relative = manifest_relative_path(&manifest.original_relative_path)?;
let file_name = requested_relative
    .file_name()
    .ok_or_else(|| "原始恢复路径无效。".to_string())?;
let parent_relative = requested_relative.parent().unwrap_or_else(|| Path::new(""));
let (parent, _) = ensure_relative_folder(root, parent_relative)?;
let requested = parent.join(file_name);
```

- [x] **Step 5: Run the local path tests**

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test local_library::tests`

Expected: PASS with all local-library tests successful.

---

### Task 2: Replace durable files atomically on Windows

**Files:**
- Modify: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:1211`
- Test: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:3725`

**Interfaces:**
- Produces: `write_bytes_atomically_with_publisher(path, bytes, publisher)` and `publish_atomic_file(temporary_path, path)`.
- Windows implementation consumes `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH`.

- [x] **Step 1: Add a failing orchestration test**

Add a test that calls the new injectable writer and asserts the old destination still exists with its old bytes when the publisher closure begins; the closure then replaces it and the final bytes equal the new content.

- [x] **Step 2: Verify the test fails because the injectable writer does not exist**

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test keeps_existing_file_until_atomic_publish -- --nocapture`

Expected: compile failure naming `write_bytes_atomically_with_publisher` as missing.

- [x] **Step 3: Extract durable temporary writing and platform publication**

Move the existing temporary create/write/sync logic into `write_bytes_atomically_with_publisher`. Remove the Windows `remove_file(path)` branch. Implement `publish_atomic_file` with `fs::rename` on non-Windows and `MoveFileExW` replacement with write-through on Windows. Keep temporary cleanup on publication failure and keep parent-directory sync after success.

- [x] **Step 4: Run atomic write tests and a Windows target check when available**

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test keeps_existing_file_until_atomic_publish -- --nocapture`

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo check --target x86_64-pc-windows-msvc`

Expected: unit test PASS; Windows check PASS when the target is installed, otherwise report the missing target and retain the existing Windows acceptance script as required staging evidence.

Verification note: the unit test passed. `cargo check --target x86_64-pc-windows-msvc` downloaded the target-specific crates but stopped because the Rust target is not installed; the `MoveFileExW` signature and flag types were checked against the downloaded `windows-sys 0.61.2` source. Windows Tauri acceptance remains required.

---

### Task 3: Serialize command and watcher index transactions

**Files:**
- Modify: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:292`
- Modify: every Tauri command in `local_library.rs` that performs a full scan directly or through `load_local_library_snapshot`.
- Test: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:4168`

**Interfaces:**
- Produces: `LocalLibraryWatchState::run_index_transaction` and `with_local_library_index_transaction(app, operation)`.
- Consumers: snapshot load, command scans after library mutations, and watcher incremental/full scans.

- [x] **Step 1: Add a failing serialization test**

Use `Arc<LocalLibraryWatchState>`, channels, and two threads. Hold the first transaction open, start the second after an explicit “attempting” signal, assert the second has not entered, release the first, then assert the second completes.

- [x] **Step 2: Verify the test fails because the transaction API does not exist**

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test serializes_watcher_and_command_index_transactions -- --nocapture`

Expected: compile failure naming `run_index_transaction` as missing.

- [x] **Step 3: Add one state-owned index transaction mutex**

Add `index_transaction: Mutex<()>` to `LocalLibraryWatchState`. `run_index_transaction` locks it, maps poisoning to the stable local-library state error, and executes exactly one closure while holding the guard. `with_local_library_index_transaction` resolves app state and delegates.

- [x] **Step 4: Route all scanning index transactions through the mutex**

Wrap `load_local_library_snapshot`, direct command scans after trash/restore, and the watcher scan block. Commands that already return through `load_local_library_snapshot` inherit the same lock without recursive acquisition.

- [x] **Step 5: Run serialization and local-library regression tests**

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test local_library::tests`

Expected: PASS with zero failures.

---

### Task 4: Force a full validation after application resume

**Files:**
- Modify: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:292`
- Modify: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:3583`
- Modify: `products/liteasy/apps/desktop/src-tauri/src/main.rs:17`
- Test: `products/liteasy/apps/desktop/src-tauri/src/local_library.rs:4168`

**Interfaces:**
- Produces: `LocalLibraryWatchSignal::FullValidation`, retained `rescan_sender`, and `resume_local_library_watcher(app)`.
- Consumes: `tauri::RunEvent::Resumed`.

- [x] **Step 1: Extend the watcher batch test with a failing full-validation assertion**

Merge `LocalLibraryWatchSignal::FullValidation` and assert the batch requires a full rescan even without a watcher error.

- [x] **Step 2: Verify the test fails because the signal and batch flag do not exist**

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test merges_watcher_bursts_and_preserves_error_rescan_signals -- --nocapture`

Expected: compile failure naming `FullValidation` or the full-validation flag as missing.

- [x] **Step 3: Retain the watcher sender and handle full validation**

Store a clone of the current sender in `LocalLibraryWatchState`. A full-validation signal sets a batch flag, disables incremental scanning, scans the entire root under the shared index transaction lock, and emits `full_rescan: true`.

- [x] **Step 4: Wire Tauri resume to restart and validate**

Build the Tauri app, call `App::run`, and on `RunEvent::Resumed` invoke `resume_local_library_watcher`. That function restarts the watcher, sends `FullValidation`, and emits the existing safe watcher error event if either step fails.

- [x] **Step 5: Run Rust regression tests and desktop build**

Run: `cd products/liteasy/apps/desktop/src-tauri && cargo test`

Run: `cd products/liteasy/apps/desktop && npm run build`

Expected: all Rust tests PASS and the production desktop build exits successfully.

- [x] **Step 6: Commit the focused local-library repair**

```bash
git add docs/superpowers/plans/2026-08-11-filesystem-conformance-02-local-library-safety.md products/liteasy/apps/desktop/src-tauri/src/local_library.rs products/liteasy/apps/desktop/src-tauri/src/main.rs
git commit -m "fix: harden local library storage transactions"
```
