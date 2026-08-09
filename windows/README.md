# SeeMe Windows 采集端

后台采集 Windows 的前台窗口、电量、输入状态并上报到 SeeMe 服务端。

## 安装

```powershell
pip install -r requirements.txt
```

## 配置

编辑 `config.json`：

```json
{
  "server_url": "https://seeme.你的子域.workers.dev",
  "auth_token": "与 Workers 服务端一致的共享密钥",
  "device_name": "可选，默认取计算机名",
  "idle_seconds": 10,
  "poll_interval": 1.0,
  "heartbeat_interval": 60,
  "battery_report_delta": 5
}
```

首次运行会自动生成 `device_id`（UUID）写回 config.json。

## 运行

```powershell
python seeme_client.py
```

## 开机自启

以管理员 PowerShell 运行：

```powershell
powershell -ExecutionPolicy Bypass -File install_autostart.ps1
```

注册 `schtasks` 开机任务，用 `pythonw` 无窗口后台运行。卸载：

```powershell
schtasks /Delete /TN SeeMeClient /F
```
