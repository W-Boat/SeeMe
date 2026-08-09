# SeeMe Windows 采集端 - 开机自启注册（schtasks）
# 以管理员 PowerShell 运行：powershell -ExecutionPolicy Bypass -File install_autostart.ps1

$ErrorActionPreference = "Stop"
$TaskName = "SeeMeClient"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $scriptDir "seeme_client.py"

if (-not (Test-Path $scriptPath)) {
    Write-Host "✗ 找不到 $scriptPath" -ForegroundColor Red
    exit 1
}

# 优先使用 pythonw（无窗口），找不到退回 python
$pythonw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue)
if ($pythonw) {
    $launcher = $pythonw.Source
} else {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $python) {
        Write-Host "✗ 未找到 pythonw/python，请先安装 Python" -ForegroundColor Red
        exit 1
    }
    $launcher = $python.Source
}

$action = New-ScheduledTaskAction -Execute $launcher -Argument "`"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "SeeMe Windows 采集端（开机自启）" -Force | Out-Null

Write-Host "✔ 已注册开机自启任务: $TaskName" -ForegroundColor Green
Write-Host "  启动器: $launcher"
Write-Host "  脚本:   $scriptPath"
Write-Host ""
Write-Host "验证: schtasks /Query /TN $TaskName"
Write-Host "卸载: schtasks /Delete /TN $TaskName /F"
