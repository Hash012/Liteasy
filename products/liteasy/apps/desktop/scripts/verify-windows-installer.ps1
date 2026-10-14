$ErrorActionPreference = "Stop"
# Installation and uninstallation must only touch a disposable Windows runner.
if ($env:GITHUB_ACTIONS -ne "true" -or -not $env:RUNNER_TEMP) {
  throw "Run installer smoke verification on a disposable GitHub Actions runner."
}
Push-Location (Join-Path $PSScriptRoot "..")
try {
  $output = [System.IO.Path]::GetFullPath("test-results/windows-installer-smoke")
  New-Item -ItemType Directory -Force -Path $output | Out-Null
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
  $installer = [System.IO.Path]::GetFullPath("src-tauri/target/release/bundle/nsis/Liteasy_${version}_x64-setup.exe")
  $release = [System.IO.Path]::GetFullPath("src-tauri/target/release/liteasy-desktop.exe")
  $installDirectory = Join-Path $env:RUNNER_TEMP "liteasy-installer-smoke-$([Guid]::NewGuid())"
  $installed = Join-Path $installDirectory "liteasy-desktop.exe"
  $report = [ordered]@{ version = $version; commit = $env:GITHUB_SHA; installerSha256 = (Get-FileHash $installer -Algorithm SHA256).Hash; installerBytes = (Get-Item $installer).Length }
  try {
    # NSIS requires /D last, without quoting, even when the directory has spaces.
    $setup = Start-Process -FilePath $installer -ArgumentList "/S /D=$installDirectory" -PassThru
    if (-not $setup.WaitForExit(180000)) { $setup.Kill(); throw "Silent installation timed out." }
    if ($setup.ExitCode -ne 0) { throw "Silent installation failed: $($setup.ExitCode)" }
    $report.installExitCode = $setup.ExitCode
    # Tauri restores the unpatched Release file after packaging. Verify the
    # installed bytes against precisely its NSIS marker patch, not a raw hash.
    $payload = & node scripts/verify-windows-payload.mjs $release $installed
    if ($LASTEXITCODE -ne 0) { throw "Installed executable differs from the expected NSIS payload." }
    $report.payload = $payload | ConvertFrom-Json
    $report.executableBytes = (Get-Item $installed).Length
    $report.fileVersion = (Get-Item $installed).VersionInfo.FileVersion
    if (([Version]$report.fileVersion).ToString(3) -ne $version) { throw "Installed executable has the wrong version: $($report.fileVersion)" }
    & node scripts/verify-windows-startup.mjs $installed $output
    if ($LASTEXITCODE -ne 0) { throw "Installed application failed the WebView2 startup check." }
    $report.startup = Get-Content (Join-Path $output "startup.json") -Raw | ConvertFrom-Json
  } finally {
    $uninstaller = Join-Path $installDirectory "uninstall.exe"
    if (Test-Path $uninstaller) {
      $remove = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru
      if (-not $remove.WaitForExit(60000)) { $remove.Kill(); throw "Silent uninstallation timed out." }
      # NSIS can hand off to a temporary uninstaller before the parent exits.
      $deadline = [DateTime]::UtcNow.AddSeconds(30)
      while ((Test-Path $installed) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
      $report.uninstalled = -not (Test-Path $installed)
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $output "installer.json")
  }
  if (-not $report.uninstalled) { throw "Installed executable remained after uninstallation." }
  "Installed v$version, verified bundled UI and native IPC, then uninstalled successfully." >> $env:GITHUB_STEP_SUMMARY
} finally { Pop-Location }
