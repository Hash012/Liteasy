param([string]$OutputPath = "test-results/recommendations-windows-benchmark.json")
$ErrorActionPreference = "Stop"
Push-Location (Join-Path $PSScriptRoot "..")
try {
  $target = [System.IO.Path]::GetFullPath($OutputPath)
  New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($target)) | Out-Null
  $buildLog = "$target.build.log"
  $messages = & cargo test --locked --no-default-features --release --no-run --message-format=json --manifest-path src-tauri/Cargo.toml 2> $buildLog
  if ($LASTEXITCODE -ne 0) { throw "Benchmark build failed; see $buildLog" }
  $artifacts = @($messages | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_.reason -eq "compiler-artifact" -and $_.profile.test -and $_.executable })
  $executable = ($artifacts | Where-Object { $_.target.name -eq "liteasy-desktop" } | Select-Object -Last 1).executable
  if (-not $executable) { throw "Cargo did not produce the desktop test executable." }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $executable
  $info.Arguments = "--exact semantic_index::benchmark::warm_fifty_thousand_vectors --ignored --nocapture --test-threads=1"
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  $process.Start() | Out-Null
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  [long]$peak = 0
  while (-not $process.HasExited) {
    $process.Refresh()
    $peak = [Math]::Max($peak, $process.WorkingSet64)
    Start-Sleep -Milliseconds 50
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw $stderr.Result }
  $native = @($stdout.Result -split "`r?`n" | Where-Object { $_.StartsWith("{") } | ForEach-Object { $_ | ConvertFrom-Json }) | Select-Object -Last 1
  $fusion = (& node ../../../packages/recommendation-core/benchmark.mjs) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $native) { throw "Benchmark did not return measurements." }
  $cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
  $memory = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
  [ordered]@{ capturedAt = [DateTime]::UtcNow.ToString("o"); cpu = $cpu; physicalMemoryBytes = $memory; os = [Environment]::OSVersion.VersionString;
    native = $native; nativeProcessPeakRssBytes = $peak; fusion = $fusion;
    combinedP95UpperEstimateMs = $native.warmP95Ms + $fusion.fusionP95Ms;
    memoryNote = "Whole benchmark process peak, including index creation; compiler memory excluded. This is a conservative bound, not incremental app RSS."
  } | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $target
  Write-Host "Wrote $target"
} finally { Pop-Location }
