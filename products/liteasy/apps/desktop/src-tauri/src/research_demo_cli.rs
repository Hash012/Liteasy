//! Explicit synthetic QA. Requires a separate development profile; no account/model access.
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
pub struct ResearchDemoState {
    pub output: PathBuf,
    finished: Mutex<bool>,
}
impl ResearchDemoState {
    pub fn new(output: PathBuf) -> Self {
        Self {
            output,
            finished: Mutex::new(false),
        }
    }
}
pub fn parse(args: &[String]) -> Result<Option<PathBuf>, String> {
    if args.first().map(String::as_str) != Some("--research-demo") {
        return Ok(None);
    }
    if args.len() != 3 || args[1] != "--output" {
        return Err("--research-demo --output <new-directory>".into());
    }
    if crate::local_dev::profile_root().is_none() || crate::local_dev::recovery_scope().is_some() {
        return Err("research_demo_requires_isolated_development_profile".into());
    }
    let path = PathBuf::from(&args[2]);
    if path.exists() {
        return Err("research_demo_output_must_be_new".into());
    }
    Ok(Some(path))
}
#[tauri::command]
pub fn research_demo_authorize(window: tauri::WebviewWindow, app: AppHandle) -> Result<(), String> {
    if window.label() != "research-demo"
        || app.try_state::<ResearchDemoState>().is_none()
        || crate::local_dev::profile_root().is_none()
        || crate::local_dev::recovery_scope().is_some()
    {
        return Err("research_demo_not_authorized".into());
    }
    Ok(())
}
#[tauri::command]
pub fn research_demo_complete(
    app: AppHandle,
    state: State<'_, ResearchDemoState>,
    result: Option<Value>,
    exports: Option<Vec<crate::artifact_export::ArtifactExportInput>>,
    error: Option<String>,
) -> Result<(), String> {
    let mut finished = state
        .finished
        .lock()
        .map_err(|_| "demo_state_unavailable")?;
    if *finished {
        return Err("demo_already_finished".into());
    }
    *finished = true;
    if let Some(error) = error {
        eprintln!("{}", json!({"ok":false,"error":error}));
        app.exit(1);
        return Ok(());
    }
    let result = result.ok_or("demo_result_missing")?;
    std::fs::create_dir(&state.output).map_err(|_| "demo_output_unavailable")?;
    for (name, value) in [
        ("evidence.json", result.clone()),
        (
            "environment.json",
            json!({"host":std::env::consts::OS,"arch":std::env::consts::ARCH,"profile":"isolated_synthetic","models":"NOT_RUN","validatorVersion":crate::research_runner::VALIDATOR_VERSION,"codeSnapshot":crate::research_runner::code_digest()}),
        ),
    ] {
        std::fs::write(
            state.output.join(name),
            serde_json::to_vec_pretty(&value).map_err(|_| "demo_invalid_result")?,
        )
        .map_err(|_| "demo_output_failed")?;
    }
    std::fs::write(
        state.output.join("runner-source.rs"),
        include_bytes!("research_runner.rs"),
    )
    .map_err(|_| "demo_output_failed")?;
    for run in result["runs"].as_array().ok_or("demo_runs_missing")? {
        let rid = run["runId"].as_str().ok_or("demo_run_invalid")?;
        if !rid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        {
            return Err("demo_run_invalid".into());
        }
        std::fs::write(
            state.output.join(format!("{rid}.json")),
            serde_json::to_vec_pretty(run).map_err(|_| "demo_invalid_result")?,
        )
        .map_err(|_| "demo_output_failed")?;
    }
    let mut receipts = Vec::new();
    for input in exports.unwrap_or_default() {
        let ext = match input.format {
            crate::artifact_export::ArtifactExportFormat::Markdown => "zip",
            crate::artifact_export::ArtifactExportFormat::Html => "html",
            crate::artifact_export::ArtifactExportFormat::Docx => "docx",
            crate::artifact_export::ArtifactExportFormat::Pdf => "pdf",
            _ => return Err("demo_format_invalid".into()),
        };
        receipts.push(crate::artifact_export::save_export_at(
            app.clone(),
            input,
            state.output.join(format!("research-report.{ext}")),
        )?);
    }
    std::fs::write(
        state.output.join("export-receipts.json"),
        serde_json::to_vec_pretty(&receipts).map_err(|_| "demo_invalid_result")?,
    )
    .map_err(|_| "demo_output_failed")?;
    println!(
        "{}",
        json!({"ok":true,"runs":result["runs"].as_array().map(Vec::len),"negativeCases":result["negativeCases"],"exported":receipts.len()})
    );
    app.exit(0);
    Ok(())
}
