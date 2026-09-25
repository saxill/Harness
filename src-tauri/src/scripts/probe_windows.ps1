# Status probe for Windows (channa). Prints one JSON object. Also reads Hermes'
# job records straight from his cron file: last status, error, next run.
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$out = [ordered]@{
  hostname = $env:COMPUTERNAME
  os = 'Windows'
  os_pretty = $os.Caption
  uptime_s = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds
  cpu_percent = [int](Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
  mem_total_mb = [int]($os.TotalVisibleMemorySize / 1024)
  mem_avail_mb = [int]($os.FreePhysicalMemory / 1024)
}
$out.disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  [ordered]@{ name = $_.DeviceID; total_gb = [math]::Round($_.Size / 1GB, 1); free_gb = [math]::Round($_.FreeSpace / 1GB, 1);
              used_percent = [int](100 * ($_.Size - $_.FreeSpace) / [math]::Max($_.Size, 1)) } })
$b = Get-CimInstance Win32_Battery | Select-Object -First 1
if ($b) { $out.battery = [ordered]@{ percent = [int]$b.EstimatedChargeRemaining; state = $(if ($b.BatteryStatus -eq 2) { 'charging' } else { 'discharging' }) } }
$w = (netsh wlan show interfaces) -join "`n"
if ($w -match '(?m)^\s*State\s*:\s*(.+)$') {
  $wifi = [ordered]@{ state = $matches[1].Trim() }
  if ($w -match '(?m)^\s*SSID\s*:\s*(.+)$') { $wifi.ssid = $matches[1].Trim() }
  if ($w -match '(?m)^\s*Signal\s*:\s*(\d+)') { $wifi.signal = [int]$matches[1] }
  $out.wifi = $wifi
}
# The gateway is a Python process (`hermes_cli.main gateway run`), not hermes.exe.
$h = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'hermes_cli\.main gateway' } | Sort-Object CreationDate | Select-Object -First 1
$out.hermes = [ordered]@{ running = [bool]$h; since = $(if ($h) { $h.CreationDate.ToString('s') } else { $null }); jobs = @() }
$jf = 'D:\hermes\cron\jobs.json'
if (Test-Path $jf) {
  $jobs = (Get-Content $jf -Raw -Encoding UTF8 | ConvertFrom-Json).jobs
  $out.hermes.jobs = @($jobs | ForEach-Object {
    [ordered]@{ id = $_.id; name = $_.name; enabled = [bool]$_.enabled; schedule = $_.schedule_display
                last_status = $_.last_status; last_run_at = $_.last_run_at; next_run_at = $_.next_run_at
                last_error = $(if ($_.last_error) { ([string]$_.last_error).Substring(0, [math]::Min(200, ([string]$_.last_error).Length)) } else { $null })
                failure_streak = $_.failure_streak } })
}
$out | ConvertTo-Json -Depth 5 -Compress
