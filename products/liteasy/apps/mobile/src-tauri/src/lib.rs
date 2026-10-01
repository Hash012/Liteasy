#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
mod reading_core;

#[cfg(target_os = "android")]
struct MobileHandle(tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
async fn mobile_dispatch(
    app: tauri::AppHandle,
    request: serde_json::Value,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        app.state::<MobileHandle>()
            .0
            .run_mobile_plugin("dispatch", serde_json::json!({ "request": request }))
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, request);
        Err("此操作需要 Android 应用。浏览器预览使用独立的本地资料库。".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("mobile")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    _app.manage(MobileHandle(
                        _api.register_android_plugin("com.liteasy.mobile", "MobilePlugin")?,
                    ));
                    Ok(())
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![mobile_dispatch])
        .run(tauri::generate_context!())
        .expect("Unable to start Liteasy");
}
