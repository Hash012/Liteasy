#[path = "local-recovery/profile.rs"]
pub(crate) mod profile;
pub(crate) use profile::validate_profile;
use profile::Plan;
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::AppHandle;

struct Pending {
    scope: String,
    created: Instant,
    plan: Plan,
    library_root: Option<PathBuf>,
}
struct Saved {
    scope: String,
    path: PathBuf,
    restored: bool,
}
#[derive(Default)]
struct State {
    plans: BTreeMap<String, Pending>,
    receipts: BTreeMap<String, Saved>,
}
static STATE: OnceLock<Mutex<State>> = OnceLock::new();
fn state() -> &'static Mutex<State> {
    STATE.get_or_init(|| Mutex::new(State::default()))
}
fn check(scope: &str) -> Result<(), String> {
    if crate::desktop_identity::local_object_scope()? == scope {
        Ok(())
    } else {
        Err("账户已切换，请重新预览恢复操作。".into())
    }
}
fn id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| "无法创建恢复计划标识。")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    plan_id: String,
    target_path: String,
    restored: bool,
    scope_id: String,
    file_count: usize,
    total_bytes: u64,
    exclusions: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    receipt_id: String,
    path: String,
    restored: bool,
    scope_id: String,
}
fn store(
    scope: String,
    plan: Plan,
    library_root: Option<PathBuf>,
) -> Result<Option<Preview>, String> {
    check(&scope)?;
    let id = id()?;
    let preview = Preview {
        plan_id: id.clone(),
        target_path: plan.target.to_string_lossy().into_owned(),
        restored: plan.restore,
        scope_id: plan.manifest.scope.clone(),
        file_count: plan.manifest.files.len(),
        total_bytes: plan.manifest.files.iter().map(|file| file.size).sum(),
        exclusions: plan.manifest.exclusions.clone(),
    };
    let mut state = state().lock().map_err(|_| "恢复计划不可用。")?;
    check(&scope)?;
    state
        .plans
        .retain(|_, p| p.scope == scope && p.created.elapsed() < Duration::from_secs(600));
    state.receipts.retain(|_, r| r.scope == scope);
    if state.plans.len() >= 2 {
        return Err("请先取消旧恢复预览。".into());
    }
    state.plans.insert(
        id,
        Pending {
            scope,
            created: Instant::now(),
            plan,
            library_root,
        },
    );
    Ok(Some(preview))
}
#[tauri::command]
pub async fn local_recovery_prepare_backup(
    app: AppHandle,
    scope: String,
) -> Result<Option<Preview>, String> {
    check(&scope)?;
    let Some(parent) = rfd::AsyncFileDialog::new()
        .set_title("选择本地资料恢复备份的保存位置")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    check(&scope)?;
    let parent = parent.path().canonicalize().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        check(&scope)?;
        let data = crate::data_location::root(&app)?;
        let library = crate::local_library::library_root(&app)?;
        let target = parent.join(format!("Liteasy-Recovery-Backup-{}", &id()?[..12]));
        let plan = profile::prepare_backup(&data, &library, &scope, &target)?;
        store(scope, plan, Some(library))
    })
    .await
    .map_err(|_| "恢复备份预览任务中断。".to_string())?
}
#[tauri::command]
pub async fn local_recovery_prepare_restore(scope: String) -> Result<Option<Preview>, String> {
    check(&scope)?;
    let Some(root) = rfd::AsyncFileDialog::new()
        .set_title("选择本地资料恢复备份")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    check(&scope)?;
    let Some(parent) = rfd::AsyncFileDialog::new()
        .set_title("选择隔离恢复配置的保存位置")
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    check(&scope)?;
    let root = root.path().canonicalize().map_err(|e| e.to_string())?;
    let parent = parent.path().canonicalize().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        check(&scope)?;
        let target = parent.join(format!("Liteasy-Recovered-{}", &id()?[..12]));
        let plan = profile::prepare_restore(&root, &target)?;
        store(scope, plan, None)
    })
    .await
    .map_err(|_| "恢复校验任务中断。".to_string())?
}
#[tauri::command]
pub async fn local_recovery_commit(
    app: AppHandle,
    scope: String,
    plan_id: String,
) -> Result<Receipt, String> {
    check(&scope)?;
    tauri::async_runtime::spawn_blocking(move || {
        check(&scope)?;
        let pending = {
            let mut state = state().lock().map_err(|_| "恢复计划不可用。")?;
            if !state.plans.get(&plan_id).is_some_and(|p| p.scope == scope) {
                return Err("恢复预览已失效。".into());
            }
            state.plans.remove(&plan_id).unwrap()
        };
        if pending.created.elapsed() > Duration::from_secs(600) {
            return Err("恢复预览已过期，请重新预览。".into());
        }
        if pending
            .library_root
            .as_ref()
            .is_some_and(|root| crate::local_library::library_root(&app).as_ref() != Ok(root))
        {
            return Err("预览后文献库位置已改变，请重新备份。".into());
        }
        let restored = pending.plan.restore;
        let archived_scope = pending.plan.manifest.scope.clone();
        let path = profile::commit(pending.plan, || check(&scope))?;
        check(&scope)?;
        let id = id()?;
        let mut state = state().lock().map_err(|_| "恢复回执不可用。")?;
        state.receipts.retain(|_, r| r.scope == scope);
        if state.receipts.len() >= 4 {
            if let Some(key) = state.receipts.keys().next().cloned() {
                state.receipts.remove(&key);
            }
        }
        let receipt = Receipt {
            receipt_id: id.clone(),
            path: path.to_string_lossy().into_owned(),
            restored,
            scope_id: archived_scope,
        };
        state.receipts.insert(
            id,
            Saved {
                scope,
                path,
                restored,
            },
        );
        Ok(receipt)
    })
    .await
    .map_err(|_| "恢复任务中断，请保留诊断副本。".to_string())?
}
#[tauri::command]
pub fn local_recovery_cancel(scope: String, plan_id: String) -> Result<(), String> {
    let mut state = state().lock().map_err(|_| "恢复计划不可用。")?;
    if state.plans.get(&plan_id).is_some_and(|p| p.scope == scope) {
        state.plans.remove(&plan_id);
    }
    Ok(())
}
#[tauri::command]
pub async fn local_recovery_open_profile(scope: String, receipt_id: String) -> Result<(), String> {
    check(&scope)?;
    let path = {
        let state = state().lock().map_err(|_| "恢复回执不可用。")?;
        state
            .receipts
            .get(&receipt_id)
            .filter(|r| r.scope == scope && r.restored)
            .ok_or("只能打开已完成的隔离恢复配置。")?
            .path
            .clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let profile = validate_profile(&path)?;
        check(&scope)?;
        std::process::Command::new(std::env::current_exe().map_err(|e| e.to_string())?)
            .env_remove("LITEASY_LOCAL_DEV_PROFILE")
            .arg("--recovery-profile")
            .arg(profile.profile_root)
            .spawn()
            .map_err(|e| format!("无法打开恢复配置：{e}"))?;
        Ok(())
    })
    .await
    .map_err(|_| "打开恢复配置任务中断。".to_string())?
}
