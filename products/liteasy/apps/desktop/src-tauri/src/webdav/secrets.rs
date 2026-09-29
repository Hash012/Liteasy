//! Keys leave the OS credential store only inside an authenticated encrypted envelope.
use super::{local, model, Settings};
use base64::{engine::general_purpose::STANDARD, Engine};
use ring::{
    aead, pbkdf2,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{num::NonZeroU32, path::Path};
const ROUNDS: u32 = 210_000;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    version: u32,
    salt: String,
    nonce: String,
    ciphertext: String,
}
fn password_entry(settings: &Settings, root: &Path) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        "Liteasy.WebDAV.Encryption",
        &format!(
            "{}-{}",
            crate::local_library::webdav_library_id(root)?,
            settings.key()
        ),
    )
    .map_err(|_| "系统凭据存储不可用".into())
}
pub fn save_password(
    settings: &Settings,
    root: &Path,
    password: Option<String>,
) -> Result<(), String> {
    if let Some(password) = password.filter(|p| !p.is_empty()) {
        if password.len() < 12 || password.len() > 8192 {
            return Err("密钥同步口令至少需要 12 个字符。".into());
        }
        password_entry(settings, root)?
            .set_password(&password)
            .map_err(|_| "无法保存密钥同步口令")?;
    }
    if settings.sync.api_keys {
        password_entry(settings, root)?
            .get_password()
            .map_err(|_| "请设置密钥同步口令；各设备须使用相同口令。")?;
    }
    Ok(())
}
fn cipher(password: &str, salt: &[u8]) -> Result<aead::LessSafeKey, String> {
    let mut bytes = [0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        NonZeroU32::new(ROUNDS).unwrap(),
        salt,
        password.as_bytes(),
        &mut bytes,
    );
    Ok(aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &bytes).map_err(|_| "无法初始化密钥加密")?,
    ))
}
fn encrypt(password: &str, plain: &[u8]) -> Result<Vec<u8>, String> {
    let random = SystemRandom::new();
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    random
        .fill(&mut salt)
        .and_then(|_| random.fill(&mut nonce))
        .map_err(|_| "安全随机数不可用")?;
    let mut bytes = plain.to_vec();
    cipher(password, &salt)?
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(b"Liteasy API keys v1"),
            &mut bytes,
        )
        .map_err(|_| "密钥加密失败")?;
    serde_json::to_vec(&Envelope {
        version: 1,
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(bytes),
    })
    .map_err(|e| e.to_string())
}
fn decrypt(password: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let envelope: Envelope = serde_json::from_slice(bytes).map_err(|_| "密钥同步数据格式无效")?;
    if envelope.version != 1 || envelope.ciphertext.len() > 2 * 1024 * 1024 {
        return Err("密钥同步数据版本或大小无效。".into());
    }
    let salt = STANDARD.decode(envelope.salt).map_err(|_| "密钥盐值无效")?;
    let nonce: [u8; 12] = STANDARD
        .decode(envelope.nonce)
        .map_err(|_| "密钥随机值无效")?
        .try_into()
        .map_err(|_| "密钥随机值长度无效")?;
    if salt.len() != 16 {
        return Err("密钥盐值长度无效".into());
    }
    let mut data = STANDARD
        .decode(envelope.ciphertext)
        .map_err(|_| "密钥编码无效")?;
    let key = cipher(password, &salt)?;
    let plain = key
        .open_in_place(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(b"Liteasy API keys v1"),
            &mut data,
        )
        .map_err(|_| "密钥同步口令不匹配，或加密数据已损坏。")?;
    Ok(plain.to_vec())
}
fn entry(kind: &str, config: &Value) -> Result<keyring::Entry, String> {
    match kind {
        "model" => crate::direct_model::credential(
            &serde_json::from_value(config.clone()).map_err(|_| "模型配置无效")?,
        ),
        "paper" => crate::paper_services::credential(
            &serde_json::from_value(config.clone()).map_err(|_| "论文服务配置无效")?,
        ),
        _ => Err("密钥类型无效".into()),
    }
}
pub fn export(
    settings: &Settings,
    root: &Path,
    descriptors: &[Value],
    previous: Option<&[u8]>,
) -> Result<Option<Vec<u8>>, String> {
    if descriptors.len() > 100 {
        return Err("同步模型配置过多".into());
    }
    let password = password_entry(settings, root)?
        .get_password()
        .map_err(|_| "无法读取密钥同步口令")?;
    let mut items = Vec::new();
    for descriptor in descriptors {
        let kind = descriptor["kind"].as_str().ok_or("密钥类型缺失")?;
        let config = &descriptor["config"];
        match entry(kind, config)?.get_password() {
            Ok(key) if !key.is_empty() => {
                items.push(json!({"kind":kind,"config":config,"key":key}))
            }
            Ok(_) | Err(keyring::Error::NoEntry) => (),
            Err(_) => return Err("无法读取 API key".into()),
        }
    }
    if items.is_empty() && previous.is_none() {
        return Ok(None);
    }
    let plain =
        serde_json::to_vec(&json!({"version":1,"items":items})).map_err(|e| e.to_string())?;
    if let Some(previous) = previous {
        if decrypt(&password, previous).is_ok_and(|old| old == plain) {
            return Ok(Some(previous.to_vec()));
        }
    }
    encrypt(&password, &plain).map(Some)
}
fn validated_entries(
    settings: &Settings,
    root: &Path,
    bytes: &[u8],
) -> Result<Vec<(keyring::Entry, String)>, String> {
    let password = password_entry(settings, root)?
        .get_password()
        .map_err(|_| "无法读取密钥同步口令")?;
    let value: Value =
        serde_json::from_slice(&decrypt(&password, bytes)?).map_err(|_| "密钥内容格式无效")?;
    if value["version"] != 1 {
        return Err("密钥内容版本无效".into());
    }
    let items = value["items"]
        .as_array()
        .filter(|a| a.len() <= 100)
        .ok_or("密钥条目无效")?;
    let mut validated = Vec::new();
    for item in items {
        let key = item["key"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 8192)
            .ok_or("API key 内容无效")?;
        validated.push((
            entry(item["kind"].as_str().unwrap_or(""), &item["config"])?,
            key.to_owned(),
        ));
    }
    Ok(validated)
}
pub fn verify(settings: &Settings, root: &Path, bytes: &[u8]) -> Result<(), String> {
    validated_entries(settings, root, bytes).map(|_| ())
}
pub fn import(settings: &Settings, root: &Path, bytes: &[u8]) -> Result<(), String> {
    let validated = validated_entries(settings, root, bytes)?;
    let password = password_entry(settings, root)?
        .get_password()
        .map_err(|_| "无法读取密钥同步口令")?;
    let value: Value =
        serde_json::from_slice(&decrypt(&password, bytes)?).map_err(|_| "密钥内容格式无效")?;
    let descriptors = value["items"]
        .as_array()
        .ok_or("密钥条目无效")?
        .iter()
        .map(|item| json!({"kind":item["kind"],"config":item["config"]}))
        .collect::<Vec<_>>();
    merge_descriptors(
        root,
        &crate::desktop_identity::local_object_scope()?,
        &descriptors,
    )?;
    // Missing entries are deliberately not credential deletions.
    for (entry, key) in validated {
        entry
            .set_password(&key)
            .map_err(|_| "无法保存同步的 API key")?;
    }
    Ok(())
}
pub fn merge_descriptors(
    root: &Path,
    scope: &str,
    incoming: &[Value],
) -> Result<Vec<Value>, String> {
    let path = local::state_directory(root)?.join(format!(
        "key-configs-{}.json",
        model::digest(scope.as_bytes())
    ));
    let old: Vec<Value> = if path.exists() {
        serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|_| "模型同步配置损坏")?
    } else {
        Vec::new()
    };
    let mut descriptors = std::collections::BTreeMap::new();
    for descriptor in old.iter().chain(incoming) {
        // Only configuration descriptors, never renderer-supplied credential values.
        let config = &descriptor["config"];
        if entry(descriptor["kind"].as_str().unwrap_or(""), config).is_err() {
            continue;
        }
        let kind = descriptor["kind"].as_str().unwrap_or("");
        let clean_config = if kind == "model" {
            json!({"provider":config["provider"],"endpoint":config["endpoint"],"model":config["model"],"protocol":config["protocol"]})
        } else {
            json!({"provider":config["provider"],"endpoint":config["endpoint"]})
        };
        let clean = json!({"kind":kind,"config":clean_config});
        descriptors.insert(clean.to_string(), clean);
    }
    if descriptors.len() > 100 {
        return Err("同步模型配置过多".into());
    }
    let descriptors = descriptors.into_values().collect::<Vec<_>>();
    local::save_json(&path, &descriptors)?;
    Ok(descriptors)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_keys_reject_wrong_password_and_tampering() {
        let encrypted = encrypt("test password 123", b"secret api key").unwrap();
        assert!(!String::from_utf8_lossy(&encrypted).contains("secret api key"));
        assert_eq!(
            decrypt("test password 123", &encrypted).unwrap(),
            b"secret api key"
        );
        assert!(decrypt("different password", &encrypted).is_err());
        let mut value: Value = serde_json::from_slice(&encrypted).unwrap();
        value["ciphertext"] = json!(STANDARD.encode([0u8; 32]));
        assert!(decrypt("test password 123", &serde_json::to_vec(&value).unwrap()).is_err());
    }
}
