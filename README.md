# SeeMe — 实时视奸自己的每一台设备

跨设备状态监控：实时采集**电量、前台应用/Activity、输入状态、在线状态**，事件驱动上传到 Cloudflare Workers，在精心设计的 Web 仪表盘上实时查看。

```
┌─ Android (Kotlin) ─┐   ┌─ Windows (Python) ─┐
│ 电量/前台Activity/   │   │ 电量/前台窗口/输入   │
│ 输入状态/心跳        │   │ 状态/心跳            │
└────────┬───────────┘   └──────────┬─────────┘
         │  POST /api/report        │
         ▼                          ▼
   Cloudflare Workers（API + KV 存储 + 前端托管）
                    ▲
                    │  GET /api/status（2.5s 轮询）
         ┌──────────┴──────────┐
         │  Web 仪表盘（多设备卡片）│
         └─────────────────────┘
```

## 仓库结构

- **SeeMe**（本仓库）
  - `workers/` — Cloudflare Workers 后端（TypeScript）
  - `web/` — Web 仪表盘（Vite + TS 静态单页）
  - `windows/` — Windows 采集端（Python）
- **SeeMe-Android**（独立仓库，[github.com/W-Boat/SeeMe-Android](https://github.com/W-Boat/SeeMe-Android)）— Android 采集端（Kotlin），GitHub Actions 自动打包 APK

## 快速开始

### 1. 部署 Workers 后端

```bash
cd workers
npm install
wrangler secret put AUTH_TOKEN   # 设置共享密钥（客户端/前端都要用它）
wrangler deploy                  # 部署，得到 https://seeme.xxx.workers.dev
```

> 首次需要：`wrangler kv namespace create devices`（把返回的 id 填入 `wrangler.toml` 的 `kv_namespaces`）。

### 2. 部署前端

前端由 Workers 静态 assets 托管，`web/dist` 构建产物在 `wrangler deploy` 时自动上传：

```bash
cd web
npm install && npm run build     # 产物输出到 dist/
```

### 3. 使用仪表盘

打开 `https://seeme.xxx.workers.dev`，首次访问会提示输入 Token（存于 localStorage）。

## Windows 采集端

```powershell
cd windows
pip install -r requirements.txt
# 编辑 config.json：server_url / auth_token
python seeme_client.py
```

开机自启（管理员 PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File install_autostart.ps1
schtasks /Delete /TN SeeMeClient /F   # 卸载
```

## Android 采集端

1. 推送到 SeeMe-Android 仓库，GitHub Actions 自动构建，APK 在 Actions 页面的 **seeme-debug-apk** artifact 下载
2. 安装后打开 App：填服务器地址 + Token → 保存 → 启动服务
3. 授予权限：
   - **无障碍服务**（采集前台应用/键盘状态，主力）
   - **使用情况访问**（兜底）
   - **忽略电池优化**（保活）
4. root 保活（可选）：见 `android/root/` — priv-app 安装脚本 或 Magisk 模块

## 上报数据格式

`POST /api/report`（增量合并，字段可省略）：

```json
{
  "deviceId": "uuid",
  "deviceName": "Pixel 7 / DESKTOP-ABC",
  "platform": "android | windows",
  "battery": { "level": 87, "charging": false },
  "foregroundApp": "微信",
  "foregroundActivity": "com.tencent.mm/.ui.LauncherUI",
  "inputState": "typing | idle | unknown"
}
```

`GET /api/status`：返回全部设备最新状态，`online = now - lastSeen <= 30s`。

## 鉴权

所有 `/api/*` 接口需请求头 `X-Auth-Token`，与 Workers 的 `AUTH_TOKEN` secret 一致。Token 不要提交到仓库。

## API 文档

详细接口文档见 [docs/api.md](docs/api.md)：数据模型、`POST /api/report`（增量合并语义）、`GET /api/status`（在线判定）、错误码、客户端接入建议。
