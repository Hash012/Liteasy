#[cfg(test)]
use super::transport;
use super::transport::Remote;
use super::{local, model, Choice, Conflict, Progress, Resolution, SyncResult};
use model::{action, Action, Files, Manifest};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

type DocumentVersion = (String, model::FileVersion);

async fn merge_annotations(
    root: &Path,
    path: &str,
    current: &Manifest,
    remote_manifest: &Manifest,
    base: Option<&model::FileVersion>,
    left: Option<&model::FileVersion>,
    right: Option<&model::FileVersion>,
    remote: &Remote,
) -> Result<Option<Vec<u8>>, String> {
    if !path.starts_with(".liteasy/paper-artifacts/") || !path.ends_with("/annotations.v1.json") {
        return Ok(None);
    }
    let (Some(left), Some(right)) = (left, right) else {
        return Ok(None);
    };
    let source = current.files.values().flatten().find(|version| {
        version.document_id.as_ref().is_some_and(|id| {
            crate::user_paper_store::paper_artifact_directory_name(id).is_ok_and(|directory| {
                path == format!(".liteasy/paper-artifacts/{directory}/annotations.v1.json")
            })
        })
    });
    let Some(source) = source else {
        return Ok(None);
    };
    let other = remote_manifest
        .files
        .values()
        .flatten()
        .find(|v| v.document_id == source.document_id);
    if other.is_none_or(|v| v.hash != source.hash)
        || [Some(left), Some(right), base]
            .into_iter()
            .flatten()
            .any(|v| v.size > 32 * 1024 * 1024)
    {
        return Ok(None);
    }
    let local_bytes = local::read_file(&local::safe_path(root, path)?)?
        .ok_or("批注文件已被移除，请重新同步。")?;
    if model::digest(&local_bytes) != left.hash {
        return Err("同步期间批注发生变化，请重试。".into());
    }
    let remote_bytes = remote.download(&right.hash, right.size).await?;
    let base_bytes = match base {
        Some(v) => Some(remote.download(&v.hash, v.size).await?),
        None => None,
    };
    Ok(liteasy_annotation_sync::merge(
        base_bytes.as_deref(),
        &local_bytes,
        &remote_bytes,
        source.document_id.as_deref().expect("PDF identity"),
        &source.hash,
    )
    .ok())
}
struct IdentityConflict {
    conflict: Conflict,
    paths: BTreeSet<String>,
    local: Option<DocumentVersion>,
    remote: Option<DocumentVersion>,
}
fn documents(manifest: &Manifest) -> BTreeMap<String, DocumentVersion> {
    manifest
        .files
        .iter()
        .filter_map(|(path, version)| {
            let version = version.as_ref()?;
            Some((
                version.document_id.clone()?,
                (path.clone(), version.clone()),
            ))
        })
        .collect()
}
fn identity_conflicts(
    base: &Manifest,
    local: &Manifest,
    remote: &Manifest,
) -> Result<Vec<IdentityConflict>, String> {
    let base_docs = documents(base);
    let local_docs = documents(local);
    let remote_docs = documents(remote);
    let ids: BTreeSet<_> = base_docs
        .keys()
        .chain(local_docs.keys())
        .chain(remote_docs.keys())
        .collect();
    let mut conflicts = Vec::new();
    for id in ids {
        let b = base_docs.get(id);
        let l = local_docs.get(id);
        let r = remote_docs.get(id);
        if l == r || l == b || r == b {
            continue;
        }
        let paths: BTreeSet<String> = [b, l, r]
            .into_iter()
            .flatten()
            .map(|(path, _)| path.clone())
            .collect();
        if paths.len() < 2 {
            continue;
        }
        // Never let a rename choice overwrite an unrelated document occupying its target.
        if paths.iter().any(|path| {
            [local, remote].iter().any(|m| {
                m.files
                    .get(path)
                    .and_then(Option::as_ref)
                    .is_some_and(|v| v.document_id.as_ref() != Some(id))
            })
        }) {
            return Err("重命名目标已被其他文献占用，请先在本地调整为不同路径后重试。".into());
        }
        conflicts.push(IdentityConflict {
            conflict: Conflict {
                path: l.or(b).or(r).expect("document exists").0.clone(),
                remote_path: r.map(|(path, _)| path.clone()),
                local: l.map(|(_, version)| version.clone()),
                remote: r.map(|(_, version)| version.clone()),
            },
            paths,
            local: l.cloned(),
            remote: r.cloned(),
        });
    }
    Ok(conflicts)
}

#[cfg(test)]
pub(super) async fn sync_library(
    root: &Path,
    connection_key: &str,
    remote: &Remote,
    current: Manifest,
    resolutions: Option<Vec<Resolution>>,
    apply: impl Fn(&str, Option<&str>, Option<&model::FileVersion>, Option<&[u8]>) -> Result<(), String>,
    progress: impl Fn(Progress),
) -> Result<SyncResult, String> {
    sync_selected(
        root,
        connection_key,
        remote,
        current,
        resolutions,
        |_| true,
        apply,
        progress,
    )
    .await
}

pub(super) async fn sync_selected(
    root: &Path,
    connection_key: &str,
    remote: &Remote,
    mut current: Manifest,
    resolutions: Option<Vec<Resolution>>,
    includes: impl Fn(&str) -> bool,
    apply: impl Fn(&str, Option<&str>, Option<&model::FileVersion>, Option<&[u8]>) -> Result<(), String>,
    progress: impl Fn(Progress),
) -> Result<SyncResult, String> {
    current.files.retain(|path, _| includes(path));
    let checkpoint =
        local::state_directory(&root)?.join(format!("baseline-{}.json", connection_key));
    let mut baseline: Manifest = if checkpoint.exists() {
        Manifest::from_bytes(&fs::read(&checkpoint).map_err(|e| e.to_string())?)?
    } else {
        Manifest::default()
    };
    baseline.validate()?;
    let (mut manifest, etag) = remote.manifest().await?;
    manifest.schema_version = manifest.schema_version.max(current.schema_version);
    baseline.schema_version = baseline.schema_version.max(current.schema_version);
    // Once a device has synced, a missing manifest is an error, never a mass deletion.
    if etag.is_none() && checkpoint.exists() {
        return Err("远端同步清单已丢失，已停止同步以保护本地数据。".into());
    }
    if etag.is_some()
        && baseline
            .files
            .keys()
            .any(|path| !manifest.files.contains_key(path))
    {
        return Err("远端清单缺少已同步的记录，已停止同步以保护数据。".into());
    }
    // Disabled categories retain their remote records and previous baseline; absence
    // from today's scan is never a deletion. Re-enabling resumes the three-way merge.
    let selected_base = Manifest {
        schema_version: baseline.schema_version,
        files: baseline
            .files
            .iter()
            .filter(|(path, _)| includes(path))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    };
    let selected_remote = Manifest {
        schema_version: manifest.schema_version,
        files: manifest
            .files
            .iter()
            .filter(|(path, _)| includes(path))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    };
    let keys: BTreeSet<String> = baseline
        .files
        .keys()
        .chain(current.files.keys())
        .chain(manifest.files.keys())
        .filter(|path| includes(path))
        .cloned()
        .collect();
    let resolutions: BTreeMap<_, _> = resolutions
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.conflict.path.clone(), r))
        .collect();
    let mut result = SyncResult::default();
    let mut downloads = Vec::new();
    let mut acknowledgements = Files::new();
    let mut changed = false;
    let mut identity_paths = BTreeSet::new();
    for group in identity_conflicts(&selected_base, &current, &selected_remote)? {
        identity_paths.extend(group.paths.iter().cloned());
        let resolution = resolutions
            .get(&group.conflict.path)
            .filter(|resolution| resolution.conflict == group.conflict);
        let Some(resolution) = resolution else {
            result.conflicts.push(group.conflict);
            continue;
        };
        let selected = match resolution.choice {
            Choice::Local => group.local,
            Choice::Remote => group.remote,
        };
        if matches!(resolution.choice, Choice::Local) {
            if let Some((path, version)) = &selected {
                let bytes = local::read_file(&local::safe_path(root, path)?)?
                    .ok_or("上传文件已被移除，请重新同步。")?;
                remote.upload(&version.hash, bytes).await?;
                result.uploaded += 1;
            }
        }
        for path in group.paths {
            let target = selected
                .as_ref()
                .filter(|(selected_path, _)| selected_path == &path)
                .map(|(_, v)| v.clone());
            if manifest.files.get(&path) != Some(&target) {
                if target.is_none() && manifest.files.get(&path).is_some_and(Option::is_some) {
                    result.deleted += 1;
                }
                manifest.files.insert(path.clone(), target.clone());
                changed = true;
            }
            let previous = current.files.get(&path).and_then(Option::as_ref).cloned();
            if matches!(resolution.choice, Choice::Remote) && previous != target {
                downloads.push((path, previous, target));
            } else {
                acknowledgements.insert(path, target);
            }
        }
    }
    for (completed, path) in keys.iter().enumerate() {
        if identity_paths.contains(path) {
            continue;
        }
        let local_version = current.files.get(path).and_then(Option::as_ref);
        let remote_version = manifest.files.get(path).and_then(Option::as_ref);
        let base = baseline.files.get(path).and_then(Option::as_ref);
        let mut decision = if !baseline.files.contains_key(path)
            && manifest.files.contains_key(path)
            && remote_version.is_none()
            && local_version.is_some()
        {
            // An unpaired device must not silently resurrect another device's deletion.
            Action::Conflict
        } else {
            action(base, local_version, remote_version)
        };
        if decision == Action::Conflict {
            if let Some(resolution) = resolutions.get(path) {
                if resolution.conflict.remote_path.is_none()
                    && resolution.conflict.local.as_ref() == local_version
                    && resolution.conflict.remote.as_ref() == remote_version
                {
                    decision = match resolution.choice {
                        Choice::Local => Action::Upload,
                        Choice::Remote => Action::Download,
                    };
                }
            }
        }
        progress(Progress {
            phase: "sync",
            completed,
            total: keys.len(),
        });
        match decision {
            Action::Conflict => {
                if let Some(bytes) = merge_annotations(
                    root,
                    path,
                    &current,
                    &manifest,
                    base,
                    local_version,
                    remote_version,
                    remote,
                )
                .await?
                {
                    let version = model::FileVersion {
                        hash: model::digest(&bytes),
                        size: bytes.len() as u64,
                        document_id: None,
                    };
                    remote.upload(&version.hash, bytes).await?;
                    downloads.push((path.clone(), local_version.cloned(), Some(version.clone())));
                    manifest.files.insert(path.clone(), Some(version));
                    result.uploaded += 1;
                    changed = true;
                } else {
                    result.conflicts.push(Conflict {
                        path: path.clone(),
                        remote_path: None,
                        local: local_version.cloned(),
                        remote: remote_version.cloned(),
                    });
                }
            }
            Action::Equal => {
                acknowledgements.insert(path.clone(), local_version.cloned());
            }
            Action::Upload => {
                if let Some(version) = local_version {
                    let bytes = local::read_file(&local::safe_path(&root, path)?)?
                        .ok_or("上传文件已被移除，请重新同步。")?;
                    remote.upload(&version.hash, bytes).await?;
                    result.uploaded += 1;
                } else {
                    result.deleted += 1;
                }
                manifest.files.insert(path.clone(), local_version.cloned());
                acknowledgements.insert(path.clone(), local_version.cloned());
                changed = true;
            }
            Action::Download => {
                downloads.push((
                    path.clone(),
                    local_version.cloned(),
                    remote_version.cloned(),
                ));
            }
        }
    }
    // Publish references only after all uploads finish. 412 aborts before any local replacement.
    if changed || etag.is_none() {
        remote.publish(&manifest, etag.as_deref()).await?;
    }
    for (path, version) in acknowledgements {
        baseline.files.insert(path, version);
    }
    // Deletions precede creations so renames preserve document IDs.
    downloads.sort_by_key(|(_, _, version)| version.is_some());
    for (path, previous, version) in downloads {
        let bytes = if let Some(v) = &version {
            Some(remote.download(&v.hash, v.size).await?)
        } else {
            None
        };
        if let Err(error) = apply(
            &path,
            previous.as_ref().map(|v| v.hash.as_str()),
            version.as_ref(),
            bytes.as_deref(),
        ) {
            if error == "webdav_document_open" {
                result.deferred.push(path);
                continue;
            }
            return Err(error);
        }
        if version.is_some() {
            result.downloaded += 1;
        } else {
            result.deleted += 1;
        }
        baseline.files.insert(path, version);
        local::save_json(&checkpoint, &baseline)?;
    }
    local::save_json(&checkpoint, &baseline)?;
    progress(Progress {
        phase: "complete",
        completed: keys.len(),
        total: keys.len(),
    });
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use transport::test_server::{runtime, Server};
    struct Library(std::path::PathBuf);
    impl Library {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "liteasy-webdav-engine-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            // Match library_root(), including the Windows verbatim path prefix.
            Self(path.canonicalize().unwrap())
        }
        fn current(&self) -> Manifest {
            let snapshot = crate::local_library::webdav_snapshot_at(&self.0).unwrap();
            let mut files = Files::new();
            local::collect(&self.0, &self.0, &mut files).unwrap();
            for entry in snapshot.entries {
                if let Some(path) = entry.relative_path {
                    files.get_mut(&path).unwrap().as_mut().unwrap().document_id = Some(entry.id);
                }
            }
            let manifest = Manifest {
                schema_version: 1,
                files,
            };
            manifest.validate().unwrap();
            manifest
        }
        async fn sync(
            &self,
            server: &Server,
            resolutions: Vec<Resolution>,
        ) -> Result<SyncResult, String> {
            sync_library(
                &self.0,
                "test",
                &server.remote,
                self.current(),
                Some(resolutions),
                |path, expected, version, bytes| {
                    crate::local_library::apply_webdav_file_at(
                        &self.0, path, expected, version, bytes,
                    )
                },
                |_| {},
            )
            .await
        }
    }
    impl Drop for Library {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn annotations_merge_on_two_devices_and_keep_concurrent_variants() {
        let server = Server::start();
        let a = Library::new();
        let b = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-test-document").unwrap();
        runtime().block_on(async {
            a.sync(&server, vec![]).await.unwrap(); b.sync(&server, vec![]).await.unwrap();
            let id = a.current().files["paper.pdf"].as_ref().unwrap().document_id.clone().unwrap();
            let directory = crate::user_paper_store::paper_artifact_directory_name(&id).unwrap();
            let path = format!(".liteasy/paper-artifacts/{directory}/annotations.v1.json");
            let snapshot = |text: &str, revision: u64| serde_json::to_vec(&serde_json::json!({"version":2,"autoPublic":false,"annotations":[{
                "id":"note","kind":"note","page":1,"rects":[],"text":text,"revision":revision,"paperIdentity":{"paperId":id},
                "publication":{"desiredVisibility":"private","state":"not_published"}
            }]})).unwrap();
            crate::local_library::write_bytes_atomically(&a.0.join(&path), &snapshot("original",1)).unwrap();
            a.sync(&server, vec![]).await.unwrap(); b.sync(&server, vec![]).await.unwrap();
            fs::write(a.0.join(&path),snapshot("desktop edit",2)).unwrap();
            fs::write(b.0.join(&path),snapshot("phone edit",2)).unwrap();
            a.sync(&server, vec![]).await.unwrap();
            let result = b.sync(&server, vec![]).await.unwrap(); assert!(result.conflicts.is_empty());
            a.sync(&server, vec![]).await.unwrap();
            let bytes = fs::read(a.0.join(&path)).unwrap(); assert_eq!(bytes,fs::read(b.0.join(&path)).unwrap());
            let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(value["annotations"].as_array().unwrap().len(),2);
            assert!(value["annotations"].as_array().unwrap().iter().any(|v| v["conflictOf"] == "note"));
            let result = b.sync(&server, vec![]).await.unwrap(); assert_eq!(result.uploaded + result.downloaded,0);
        });
    }
    #[test]
    fn disabled_categories_are_never_deleted_and_resume_three_way_conflicts() {
        let server = Server::start();
        let a = Library::new();
        let b = Library::new();
        let path = ".liteasy/sync-data/objects/guest/records.json";
        crate::local_library::write_bytes_atomically(&a.0.join(path), b"native note").unwrap();
        fs::write(a.0.join("book.epub"), b"ebook").unwrap();
        let generated = ".liteasy/paper-artifacts/workspace-artifacts/agent-results/slides.json";
        crate::local_library::write_bytes_atomically(&a.0.join(generated),br#"{"version":"liteasy.agent-artifact/v1","artifactId":"slides","agent":{"status":"completed"},"papers":[]}"#).unwrap();
        runtime().block_on(async {
            assert_eq!(a.sync(&server, vec![]).await.unwrap().uploaded, 3);
            assert_eq!(b.sync(&server, vec![]).await.unwrap().downloaded, 3);
            assert!(b.0.join(generated).is_file());
            fs::remove_file(a.0.join(path)).unwrap();
            let result = sync_selected(
                &a.0,
                "test",
                &server.remote,
                a.current(),
                None,
                |p| !p.starts_with(".liteasy/sync-data/objects/"),
                |p, e, v, b| crate::local_library::apply_webdav_file_at(&a.0, p, e, v, b),
                |_| {},
            )
            .await
            .unwrap();
            assert_eq!(result.deleted + result.uploaded + result.downloaded, 0);
            assert!(server.remote.manifest().await.unwrap().0.files[path].is_some());
            crate::local_library::write_bytes_atomically(&a.0.join(path), b"device A edit")
                .unwrap();
            crate::local_library::write_bytes_atomically(&b.0.join(path), b"device B edit")
                .unwrap();
            b.sync(&server, vec![]).await.unwrap();
            let result = a.sync(&server, vec![]).await.unwrap();
            assert_eq!(result.conflicts.len(), 1);
            assert_eq!(fs::read(a.0.join(path)).unwrap(), b"device A edit");
        });
    }
    #[test]
    fn webdav_two_devices_preserve_document_identity_annotations_and_incremental_sync() {
        let server = Server::start();
        let a = Library::new();
        let b = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
        let id = a.current().files["paper.pdf"]
            .as_ref()
            .unwrap()
            .document_id
            .clone()
            .unwrap();
        let artifact = format!(
            ".liteasy/paper-artifacts/{}/annotations.v1.json",
            crate::user_paper_store::paper_artifact_directory_name(&id).unwrap()
        );
        crate::local_library::write_bytes_atomically(&a.0.join(&artifact), b"{\"highlights\":[1]}")
            .unwrap();
        runtime().block_on(async {
            assert_eq!(a.sync(&server, vec![]).await.unwrap().uploaded, 2);
            assert_eq!(b.sync(&server, vec![]).await.unwrap().downloaded, 2);
            assert_eq!(
                b.current().files["paper.pdf"]
                    .as_ref()
                    .unwrap()
                    .document_id
                    .as_deref(),
                Some(id.as_str())
            );
            assert_eq!(
                fs::read(a.0.join(&artifact)).unwrap(),
                fs::read(b.0.join(&artifact)).unwrap()
            );
            let result = b.sync(&server, vec![]).await.unwrap();
            assert_eq!(result.uploaded + result.downloaded + result.deleted, 0);
            fs::rename(a.0.join("paper.pdf"), a.0.join("renamed.pdf")).unwrap();
            a.sync(&server, vec![]).await.unwrap();
            b.sync(&server, vec![]).await.unwrap();
            assert!(!b.0.join("paper.pdf").exists());
            assert_eq!(
                b.current().files["renamed.pdf"]
                    .as_ref()
                    .unwrap()
                    .document_id
                    .as_deref(),
                Some(id.as_str())
            );
        });
    }
    #[test]
    fn webdav_class_one_server_syncs_without_etags_or_conditional_puts() {
        let server = Server::start();
        {
            let mut state = server.state.lock().unwrap();
            state.no_etag = true;
            state.ignore_conditions = true;
            state.existing_collection_status = Some(201);
        }
        let a = Library::new();
        let b = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
        runtime().block_on(async {
            server.remote.verify().await.unwrap();
            assert_eq!(a.sync(&server, vec![]).await.unwrap().uploaded, 1);
            assert_eq!(b.sync(&server, vec![]).await.unwrap().downloaded, 1);
            fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 updated").unwrap();
            a.sync(&server, vec![]).await.unwrap();
            b.sync(&server, vec![]).await.unwrap();
            assert_eq!(
                fs::read(b.0.join("paper.pdf")).unwrap(),
                b"%PDF-1.7 updated"
            );
            fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 device A edit").unwrap();
            fs::write(b.0.join("paper.pdf"), b"%PDF-1.7 device B edit").unwrap();
            a.sync(&server, vec![]).await.unwrap();
            assert_eq!(b.sync(&server, vec![]).await.unwrap().conflicts.len(), 1);
            assert_eq!(
                fs::read(b.0.join("paper.pdf")).unwrap(),
                b"%PDF-1.7 device B edit"
            );
        });
    }

    #[test]
    fn webdav_edit_delete_conflicts_require_current_explicit_resolution() {
        let server = Server::start();
        let a = Library::new();
        let b = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
        runtime().block_on(async {
            a.sync(&server, vec![]).await.unwrap();
            b.sync(&server, vec![]).await.unwrap();
            fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 remote edit").unwrap();
            a.sync(&server, vec![]).await.unwrap();
            fs::remove_file(b.0.join("paper.pdf")).unwrap();
            let result = b.sync(&server, vec![]).await.unwrap();
            assert_eq!(result.conflicts.len(), 1);
            assert!(!b.0.join("paper.pdf").exists());
            let stale = result.conflicts.into_iter().next().unwrap();
            fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 newer remote edit").unwrap();
            a.sync(&server, vec![]).await.unwrap();
            let result = b
                .sync(
                    &server,
                    vec![Resolution {
                        conflict: stale,
                        choice: Choice::Local,
                    }],
                )
                .await
                .unwrap();
            assert_eq!(result.conflicts.len(), 1);
            let current = result.conflicts.into_iter().next().unwrap();
            assert!(b
                .sync(
                    &server,
                    vec![Resolution {
                        conflict: current,
                        choice: Choice::Remote
                    }]
                )
                .await
                .unwrap()
                .conflicts
                .is_empty());
            assert_eq!(
                fs::read(b.0.join("paper.pdf")).unwrap(),
                b"%PDF-1.7 newer remote edit"
            );
        });
    }
    #[test]
    fn webdav_cas_failure_and_missing_manifest_never_replace_local_files() {
        let server = Server::start();
        let a = Library::new();
        let b = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
        runtime().block_on(async {
            a.sync(&server, vec![]).await.unwrap();
            b.sync(&server, vec![]).await.unwrap();
            fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 remote edit").unwrap();
            a.sync(&server, vec![]).await.unwrap();
            fs::write(b.0.join("second.pdf"), b"%PDF-1.7 local addition").unwrap();
            server.state.lock().unwrap().fail_manifest_put = true;
            assert!(b.sync(&server, vec![]).await.is_err());
            assert_eq!(
                fs::read(b.0.join("paper.pdf")).unwrap(),
                b"%PDF-1.7 original"
            );
            server.state.lock().unwrap().fail_manifest_put = false;
            b.sync(&server, vec![]).await.unwrap();
            server
                .state
                .lock()
                .unwrap()
                .objects
                .remove("/liteasy/test/manifest.v1.json");
            assert!(b.sync(&server, vec![]).await.is_err());
            assert_eq!(
                fs::read(b.0.join("paper.pdf")).unwrap(),
                b"%PDF-1.7 remote edit"
            );
        });
    }
    #[test]
    fn webdav_interrupted_local_apply_retries_without_losing_uploads() {
        let server = Server::start();
        let a = Library::new();
        let b = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 remote file").unwrap();
        runtime().block_on(async {
            a.sync(&server, vec![]).await.unwrap();
            fs::write(b.0.join("second.pdf"), b"%PDF-1.7 local file").unwrap();
            assert!(sync_library(
                &b.0,
                "test",
                &server.remote,
                b.current(),
                None,
                |_, _, _, _| Err("simulated interruption".into()),
                |_| {}
            )
            .await
            .is_err());
            let result = b.sync(&server, vec![]).await.unwrap();
            assert_eq!(result.downloaded, 1);
            assert_eq!(result.uploaded, 0);
            assert!(result.conflicts.is_empty());
            assert_eq!(
                fs::read(b.0.join("second.pdf")).unwrap(),
                b"%PDF-1.7 local file"
            );
        });
    }
    #[test]
    fn webdav_new_device_does_not_resurrect_remote_tombstone() {
        let server = Server::start();
        let a = Library::new();
        let b = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
        fs::write(b.0.join("paper.pdf"), b"%PDF-1.7 old copy").unwrap();
        runtime().block_on(async {
            a.sync(&server, vec![]).await.unwrap();
            fs::remove_file(a.0.join("paper.pdf")).unwrap();
            a.sync(&server, vec![]).await.unwrap();
            let result = b.sync(&server, vec![]).await.unwrap();
            assert_eq!(result.conflicts.len(), 1);
            assert_eq!(result.uploaded, 0);
            assert!(server.remote.manifest().await.unwrap().0.files["paper.pdf"].is_none());
        });
    }
    #[test]
    fn webdav_defers_open_documents_without_advancing_their_baseline() {
        let server = Server::start();
        let a = Library::new();
        let b = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
        runtime().block_on(async {
            a.sync(&server, vec![]).await.unwrap();
            b.sync(&server, vec![]).await.unwrap();
            fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 remote edit").unwrap();
            a.sync(&server, vec![]).await.unwrap();
            let result = sync_library(
                &b.0,
                "test",
                &server.remote,
                b.current(),
                None,
                |_, _, _, _| Err("webdav_document_open".into()),
                |_| {},
            )
            .await
            .unwrap();
            assert_eq!(result.deferred, vec!["paper.pdf"]);
            assert_eq!(
                fs::read(b.0.join("paper.pdf")).unwrap(),
                b"%PDF-1.7 original"
            );
            assert_eq!(b.sync(&server, vec![]).await.unwrap().downloaded, 1);
        });
    }
    #[test]
    fn webdav_missing_historical_manifest_entry_is_not_a_delete() {
        let server = Server::start();
        let a = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
        runtime().block_on(async {
            a.sync(&server, vec![]).await.unwrap();
            let (_, etag) = server.remote.manifest().await.unwrap();
            server
                .remote
                .publish(&Manifest::default(), etag.as_deref())
                .await
                .unwrap();
            assert!(a.sync(&server, vec![]).await.is_err());
            assert_eq!(
                fs::read(a.0.join("paper.pdf")).unwrap(),
                b"%PDF-1.7 original"
            );
        });
    }
    #[test]
    fn webdav_concurrent_renames_resolve_as_one_document() {
        for choice in [Choice::Local, Choice::Remote] {
            let keep_local = matches!(choice, Choice::Local);
            let server = Server::start();
            let a = Library::new();
            let b = Library::new();
            fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
            runtime().block_on(async {
                a.sync(&server, vec![]).await.unwrap();
                b.sync(&server, vec![]).await.unwrap();
                fs::rename(a.0.join("paper.pdf"), a.0.join("remote.pdf")).unwrap();
                a.sync(&server, vec![]).await.unwrap();
                fs::rename(b.0.join("paper.pdf"), b.0.join("local.pdf")).unwrap();
                assert_eq!(b.sync(&server, vec![]).await.unwrap().conflicts.len(), 1);
                let result = b.sync(&server, vec![]).await.unwrap();
                assert_eq!(result.conflicts.len(), 1);
                let conflict = result.conflicts.into_iter().next().unwrap();
                assert_eq!(conflict.remote_path.as_deref(), Some("remote.pdf"));
                b.sync(&server, vec![Resolution { conflict, choice }])
                    .await
                    .unwrap();
                a.sync(&server, vec![]).await.unwrap();
                let target = if keep_local {
                    "local.pdf"
                } else {
                    "remote.pdf"
                };
                assert!(a.0.join(target).exists());
                assert!(b.0.join(target).exists());
                assert_eq!(a.current().files, b.current().files);
                assert_eq!(
                    a.current().files.values().filter(|v| v.is_some()).count(),
                    1
                );
            });
        }
    }
    #[test]
    fn webdav_delete_versus_rename_stays_in_conflict_until_resolved() {
        for choice in [Choice::Local, Choice::Remote] {
            let keep_local = matches!(choice, Choice::Local);
            let server = Server::start();
            let a = Library::new();
            let b = Library::new();
            fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
            runtime().block_on(async {
                a.sync(&server, vec![]).await.unwrap();
                b.sync(&server, vec![]).await.unwrap();
                fs::rename(a.0.join("paper.pdf"), a.0.join("remote.pdf")).unwrap();
                a.sync(&server, vec![]).await.unwrap();
                fs::remove_file(b.0.join("paper.pdf")).unwrap();
                assert_eq!(b.sync(&server, vec![]).await.unwrap().conflicts.len(), 1);
                let conflict = b
                    .sync(&server, vec![])
                    .await
                    .unwrap()
                    .conflicts
                    .into_iter()
                    .next()
                    .unwrap();
                b.sync(&server, vec![Resolution { conflict, choice }])
                    .await
                    .unwrap();
                a.sync(&server, vec![]).await.unwrap();
                assert_eq!(b.0.join("remote.pdf").exists(), !keep_local);
                assert_eq!(a.current().files, b.current().files);
            });
        }
    }
    #[test]
    fn webdav_edit_versus_rename_keeps_selected_content_and_identity() {
        let server = Server::start();
        let a = Library::new();
        let b = Library::new();
        fs::write(a.0.join("paper.pdf"), b"%PDF-1.7 original").unwrap();
        runtime().block_on(async {
            a.sync(&server, vec![]).await.unwrap();
            b.sync(&server, vec![]).await.unwrap();
            fs::rename(a.0.join("paper.pdf"), a.0.join("remote.pdf")).unwrap();
            a.sync(&server, vec![]).await.unwrap();
            fs::write(b.0.join("paper.pdf"), b"%PDF-1.7 edited").unwrap();
            let conflict = b
                .sync(&server, vec![])
                .await
                .unwrap()
                .conflicts
                .into_iter()
                .next()
                .unwrap();
            b.sync(
                &server,
                vec![Resolution {
                    conflict,
                    choice: Choice::Local,
                }],
            )
            .await
            .unwrap();
            a.sync(&server, vec![]).await.unwrap();
            assert_eq!(fs::read(a.0.join("paper.pdf")).unwrap(), b"%PDF-1.7 edited");
            assert_eq!(a.current().files, b.current().files);
        });
    }
}
