/**
 * SeeMe Worker — 设备状态汇聚 API + 前端静态托管
 *
 * 数据流：客户端（Android/Windows）事件驱动 POST /api/report，
 * 前端每 2~3s 轮询 GET /api/status。
 */

export interface Env {
  DEVICES: KVNamespace;
  ASSETS: Fetcher;
  AUTH_TOKEN: string;
}

export type Platform = "android" | "windows";
export type InputState = "typing" | "idle" | "unknown";

export interface BatteryState {
  level: number; // 0-100
  charging: boolean;
}

export interface DeviceState {
  deviceId: string;
  deviceName?: string;
  platform: Platform;
  battery: BatteryState;
  foregroundApp?: string;
  foregroundActivity?: string;
  inputState: InputState;
  statusText?: string; // 自定义状态文案（借鉴 sleepy 的在线状态）
  mediaTitle?: string; // 正在播放的媒体（借鉴 SleepyXposed 的媒体上报）
  lastSeen: number; // epoch ms
}

export interface ReportBody {
  deviceId: string;
  deviceName?: string;
  platform: Platform;
  battery?: Partial<BatteryState>;
  foregroundApp?: string;
  foregroundActivity?: string;
  inputState?: InputState;
  statusText?: string;
  mediaTitle?: string;
}

const KV_PREFIX = "device:";
/** 超过该时长无心跳视为离线（客户端心跳 60s，留 1.5 倍余量） */
const OFFLINE_THRESHOLD_MS = 90_000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    // 其余请求交给静态资源（前端产物）
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") {
    return Promise.resolve(new Response(null, { status: 204, headers: CORS_HEADERS }));
  }

  // 鉴权：所有 /api 接口都需要 X-Auth-Token
  const auth = request.headers.get("X-Auth-Token");
  if (!env.AUTH_TOKEN || auth !== env.AUTH_TOKEN) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      })
    );
  }

  if (request.method === "POST" && url.pathname === "/api/report") {
    return handleReport(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    return handleStatus(env);
  }
  return Promise.resolve(
    new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  );
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  let body: ReportBody;
  try {
    body = await request.json<ReportBody>();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim()) {
    return json({ error: "deviceId required" }, 400);
  }
  if (body.platform !== "android" && body.platform !== "windows") {
    return json({ error: "platform must be android|windows" }, 400);
  }

  const key = KV_PREFIX + body.deviceId;
  const existing = await env.DEVICES.get<DeviceState>(key, "json");

  const merged: DeviceState = {
    deviceId: body.deviceId,
    deviceName: body.deviceName ?? existing?.deviceName,
    platform: body.platform,
    battery: {
      level: body.battery?.level ?? existing?.battery?.level ?? 0,
      charging: body.battery?.charging ?? existing?.battery?.charging ?? false,
    },
    foregroundApp: body.foregroundApp ?? existing?.foregroundApp,
    foregroundActivity: body.foregroundActivity ?? existing?.foregroundActivity,
    inputState: body.inputState ?? existing?.inputState ?? "unknown",
    statusText: body.statusText ?? existing?.statusText,
    mediaTitle: body.mediaTitle ?? existing?.mediaTitle,
    lastSeen: Date.now(),
  };

  await env.DEVICES.put(key, JSON.stringify(merged));
  return json({ ok: true }, 200);
}

async function handleStatus(env: Env): Promise<Response> {
  const now = Date.now();
  const devices: (DeviceState & { online: boolean })[] = [];
  const list = await env.DEVICES.list({ prefix: KV_PREFIX });

  for (const item of list.keys) {
    const state = await env.DEVICES.get<DeviceState>(item.name, "json");
    if (!state) continue;
    devices.push({
      ...state,
      online: now - state.lastSeen <= OFFLINE_THRESHOLD_MS,
    });
  }

  // 按最后活跃排序，最近的在前
  devices.sort((a, b) => b.lastSeen - a.lastSeen);
  return json({ serverTime: now, devices }, 200);
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
