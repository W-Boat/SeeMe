# SeeMe API 文档

SeeMe 是一个跨设备状态汇聚服务：客户端（Android / Windows）事件驱动上报设备状态，Web 仪表盘轮询查询。

## 基本信息

| 项 | 值 |
|---|---|
| Base URL | `https://seeme.liuter.workers.dev` |
| 数据格式 | JSON（UTF-8） |
| 鉴权 | 请求头 `X-Auth-Token` |
| CORS | `Access-Control-Allow-Origin: *`（支持跨域浏览器调用） |

## 鉴权

所有 `/api/*` 接口都需要请求头：

```
X-Auth-Token: <共享密钥>
```

密钥由服务端 `AUTH_TOKEN` secret 配置，客户端与前端共用同一密钥。缺失或错误返回 `401 {"error":"unauthorized"}`。

---

## 数据模型

### DeviceState（设备最新状态，`GET /api/status` 返回）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `deviceId` | string | ✓ | 设备唯一 ID（客户端首次运行时生成 UUID） |
| `deviceName` | string | | 设备显示名（如 `Pixel 7`、`DESKTOP-ABC`） |
| `platform` | `"android" \| "windows"` | ✓ | 平台 |
| `battery` | `{ level: number, charging: boolean }` | | 电量百分比（0-100）+ 是否充电 |
| `foregroundApp` | string | | 前台应用名 / 窗口标题 |
| `foregroundActivity` | string | | Activity 类名（如 `com.tencent.mm/.ui.LauncherUI`）或进程名（`chrome.exe`） |
| `inputState` | `"typing" \| "idle" \| "unknown"` | | 输入状态 |
| `statusText` | string | | 自定义状态文案（如「摸鱼中」） |
| `mediaTitle` | string | | 正在播放的媒体（如 `晴天 - 周杰伦`） |
| `lastSeen` | number | | 最后上报时间（epoch ms） |
| `online` | boolean | | 是否在线（仅 status 返回，服务端计算） |

---

## POST /api/report — 上报设备状态

### 请求

```
POST /api/report
Content-Type: application/json
X-Auth-Token: <token>
```

请求体字段（**全部可选**，增量合并）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `deviceId` | string | **必填**，设备唯一 ID |
| `platform` | `"android" \| "windows"` | **必填** |
| `deviceName` | string | 设备名（首次上报后固定） |
| `battery` | `{ level?, charging? }` | 电量局部更新 |
| `foregroundApp` | string | 前台应用名 |
| `foregroundActivity` | string | 前台 Activity / 进程 |
| `inputState` | string | 输入状态 |
| `statusText` | string | 自定义状态文案 |
| `mediaTitle` | string | 正在播放的媒体 |

**增量语义**：只更新请求中出现的字段，未提供的字段保留服务端旧值（例如只传 `battery` 不会清空 `foregroundApp`）。若想清空某字段，传空字符串 `""`（仍会被视为新值）。

### 响应

```
200 {"ok":true}
400 {"error":"invalid json"}                    # 请求体不是合法 JSON
400 {"error":"deviceId required"}               # 缺 deviceId
400 {"error":"platform must be android|windows"} # platform 非法
401 {"error":"unauthorized"}                    # 鉴权失败
```

### 示例

```bash
curl -X POST https://seeme.liuter.workers.dev/api/report \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: <token>" \
  -d '{
    "deviceId": "a1b2c3d4-...",
    "deviceName": "Pixel 7",
    "platform": "android",
    "battery": { "level": 87, "charging": false },
    "foregroundApp": "微信",
    "foregroundActivity": "com.tencent.mm/.ui.LauncherUI",
    "inputState": "idle",
    "statusText": "摸鱼中",
    "mediaTitle": "晴天 - 周杰伦"
  }'
```

Python（Windows 客户端使用）：

```python
import requests

requests.post(
    "https://seeme.liuter.workers.dev/api/report",
    json={
        "deviceId": device_id,
        "deviceName": "DESKTOP-ABC",
        "platform": "windows",
        "battery": {"level": 92, "charging": True},
        "foregroundApp": "Chrome - GitHub",
        "foregroundActivity": "chrome.exe",
        "inputState": "typing",
    },
    headers={"X-Auth-Token": token},
    timeout=10,
)
```

---

## GET /api/status — 查询全部设备状态

### 请求

```
GET /api/status
X-Auth-Token: <token>
```

### 响应

```
200
{
  "serverTime": 1786294679387,          // 服务器当前时间（epoch ms）
  "devices": [ DeviceState, ... ]       // 按 lastSeen 降序
}
```

`online` 判定：`now - lastSeen <= 90s` 为在线（客户端心跳 60s，留 1.5 倍余量，漏报一次心跳不掉线）。

### 示例

```bash
curl https://seeme.liuter.workers.dev/api/status -H "X-Auth-Token: <token>"
```

```json
{
  "serverTime": 1786294679387,
  "devices": [
    {
      "deviceId": "a1b2c3d4-...",
      "deviceName": "Pixel 7",
      "platform": "android",
      "battery": { "level": 87, "charging": false },
      "foregroundApp": "微信",
      "foregroundActivity": "com.tencent.mm/.ui.LauncherUI",
      "inputState": "idle",
      "statusText": "摸鱼中",
      "mediaTitle": "晴天 - 周杰伦",
      "lastSeen": 1786294678535,
      "online": true
    }
  ]
}
```

---

## 错误码汇总

| 状态码 | 说明 |
|---|---|
| `200` | 成功 |
| `400` | 请求体非法（JSON 解析失败 / 缺必填字段 / 枚举非法） |
| `401` | `X-Auth-Token` 缺失或不匹配 |
| `404` | 接口不存在 |

---

## 客户端接入建议

- **事件驱动上报**：状态变化（前台应用切换、输入状态翻转、电量档变化）时立即上报；无变化时按心跳（60s）上报维持在线。
- **deviceId**：客户端首次运行生成 UUID 并持久化，不要每次重新生成。
- **在线判定**：阈值 90s，客户端心跳间隔建议 ≤ 60s。
- **Token 安全**：Token 只应存在于服务端 secret、客户端配置与前端 localStorage，切勿提交到公开仓库。
