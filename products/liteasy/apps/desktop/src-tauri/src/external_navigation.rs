fn website_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "网站地址无效。")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("只能打开 HTTP 或 HTTPS 网站。".into());
    }
    Ok(url)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    webbrowser::open(website_url(&url)?.as_str())
        .map_err(|_| "无法启动系统浏览器，请复制链接后打开。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_websites_but_never_local_files_or_command_schemes() {
        assert!(website_url("https://doi.org/10.1000/example").is_ok());
        for url in [
            "file:///C:/Windows/a.exe",
            "javascript:alert(1)",
            "cmd:foo",
            "https://user:secret@example.com",
        ] {
            assert!(website_url(url).is_err());
        }
    }
}
