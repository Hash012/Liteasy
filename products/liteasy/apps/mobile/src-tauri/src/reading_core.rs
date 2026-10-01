use jni::{
    objects::{JClass, JString},
    sys::jstring,
    JNIEnv,
};
use serde_json::{json, Value};

// A worker can load this library without constructing an Activity or Tauri WebView.
#[no_mangle]
pub extern "system" fn Java_com_liteasy_mobile_ReadingCore_process(
    mut env: JNIEnv,
    _class: JClass,
    request: JString,
) -> jstring {
    let result =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<Value, String> {
            let request: String = env.get_string(&request).map_err(|e| e.to_string())?.into();
            let request: Value =
                serde_json::from_str(&request).map_err(|_| "批注请求格式无效。")?;
            let id = request["documentId"].as_str().ok_or("缺少文献标识。")?;
            let prior = request
                .get("previous")
                .filter(|v| !v.is_null())
                .map(serde_json::to_vec)
                .transpose()
                .map_err(|e| e.to_string())?;
        let bytes = match request["operation"].as_str() {
            Some("validate") => {
                let bytes = serde_json::to_vec(&request["next"]).map_err(|e| e.to_string())?;
                liteasy_annotation_sync::validate_import(&bytes, id, request["contentHash"].as_str().ok_or("缺少文献指纹。")?)?;
                bytes
            },
                Some("prepare") => liteasy_annotation_sync::prepare(
                    prior.as_deref(),
                    &serde_json::to_vec(&request["next"]).map_err(|e| e.to_string())?,
                    id,
                )?,
                Some("merge") => liteasy_annotation_sync::merge(
                    prior.as_deref(),
                    &serde_json::to_vec(&request["local"]).map_err(|e| e.to_string())?,
                    &serde_json::to_vec(&request["remote"]).map_err(|e| e.to_string())?,
                    id,
                    request["contentHash"].as_str().ok_or("缺少文献指纹。")?,
                )?,
                _ => return Err("不支持的批注操作。".into()),
            };
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())
        }));
    let response = match result {
        Ok(Ok(value)) => json!({"value": value}),
        Ok(Err(error)) => json!({"error": error}),
        Err(_) => json!({"error": "批注处理失败，原记录已保留。"}),
    };
    env.new_string(response.to_string())
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}
