use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

fn families(text: &str) -> Vec<String> {
    let mut names: Vec<String> = text
        .lines()
        .flat_map(|line| line.split(','))
        .map(str::trim)
        .filter(|name| !name.is_empty() && name.len() <= 256 && !name.chars().any(char::is_control))
        .map(str::to_owned)
        .collect();
    names.sort();
    names.dedup();
    names
}

fn enumerate() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let root = std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?;
        let mut cmd = Command::new(
            std::path::PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
        );
        cmd.creation_flags(0x08000000).args(["-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName PresentationCore; [System.Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source }"]);
        cmd
    };
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("fc-list");
        cmd.args(["--format", "%{family}\n"]);
        cmd
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("/usr/bin/osascript");
        cmd.args(["-l", "JavaScript", "-e", "ObjC.import('AppKit'); ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies).join('\\n')"]);
        cmd
    };
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or("Font output unavailable")?;
    // Drain concurrently so a large installed collection cannot fill the pipe.
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        stdout
            .take(2 * 1024 * 1024)
            .read_to_string(&mut text)
            .map(|_| text)
    });
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            if !status.success() {
                return Err("系统字体读取失败，请输入字体名称或稍后重试。".into());
            }
            break;
        }
        if started.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("系统字体读取超时，请稍后重试。".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    let text = reader
        .join()
        .map_err(|_| "Font reader stopped")?
        .map_err(|error| error.to_string())?;
    Ok(families(&text))
}

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(enumerate)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_family_aliases() {
        assert_eq!(
            families("宋体,SimSun\nArial\nArial\n\n"),
            vec!["Arial", "SimSun", "宋体"]
        );
    }
}
