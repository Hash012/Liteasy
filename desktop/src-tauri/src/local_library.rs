use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibraryEntry {
    pub id: String,
    pub path: String,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalLibrarySnapshot {
    pub entries: Vec<LocalLibraryEntry>,
    pub root_path: String,
}

#[tauri::command]
pub fn load_local_library_snapshot() -> Result<LocalLibrarySnapshot, String> {
    let home = std::env::var("HOME").map_err(|error| error.to_string())?;
    let root = PathBuf::from(home).join("LiteasyLibrary");
    fs::create_dir_all(root.join("papers")).map_err(|error| error.to_string())?;

    Ok(LocalLibrarySnapshot {
        entries: vec![],
        root_path: root.display().to_string(),
    })
}
