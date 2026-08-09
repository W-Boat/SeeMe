// SeeMe 前端 API 层

export interface BatteryState {
  level: number; // 0-100
  charging: boolean;
}

export type InputState = "typing" | "idle" | "unknown";
export type Platform = "android" | "windows";

export interface DeviceState {
  deviceId: string;
  deviceName?: string;
  platform: Platform;
  battery: BatteryState;
  foregroundApp?: string;
  foregroundActivity?: string;
  inputState: InputState;
  lastSeen: number;
  online: boolean;
}

export interface StatusResponse {
  serverTime: number;
  devices: DeviceState[];
}

const TOKEN_KEY = "seeme_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

async function request(path: string, token: string): Promise<Response> {
  const resp = await fetch(path, {
    headers: { "X-Auth-Token": token },
  });
  if (resp.status === 401) {
    throw new TokenError("token 无效或未配置");
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp;
}

export class TokenError extends Error {}

export async function fetchStatus(token: string): Promise<StatusResponse> {
  const resp = await request("api/status", token);
  return (await resp.json()) as StatusResponse;
}
