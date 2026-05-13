use serde::Serialize;

#[derive(Serialize)]
pub struct ImportResponse {
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub status: String,
}

#[tauri::command]
pub fn mock_import(source_path: String) -> ImportResponse {
    let sanitized = source_path
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .collect::<String>();

    let suffix = if sanitized.is_empty() {
        "job1".to_string()
    } else {
        sanitized
    };

    ImportResponse {
        job_id: format!("job-{}", suffix),
        status: "queued".to_string(),
    }
}
