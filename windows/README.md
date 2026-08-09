# SeeMe Windows 采集端（托盘版）

后台采集 Windows 的前台窗口、电量、输入状态并上报到 SeeMe 服务端。运行后**仅显示在系统托盘**（无控制台窗口）。

## 安装

```powershell
pip install -r requirements.txt
```

## 配置

编辑 `config.json`：

```json
{
  "server_url": "https://seeme.xxx.workers.dev",
  "auth_token": "与 Workers 服务端一致的共享密钥",
  "device_name": "可选，默认取计算机名",
  "idle_seconds": 10,
  "poll_interval": 1.0,
  "heartbeat_interval": 60,
  "battery_report_delta": 5
}
```

首次运行会自动生成 `device_id`（UUID）写回 config.json。

## 运行（托盘）

```powershell
python seeme_client.py          # 带控制台调试
pythonw seeme_client.py         # 无窗口，仅托盘
```

托盘图标菜单：电量 / 前台应用 / 输入状态（实时）、打开仪表盘、退出。

## 开机自启（无窗口）

以管理员 PowerShell 运行：

```powershell
powershell -ExecutionPolicy Bypass -File install_autostart.ps1
```

注册 `schtasks` 开机任务，用 `pythonw` 无窗口后台运行。卸载：

```powershell
schtasks /Delete /TN SeeMeClient /F
```
