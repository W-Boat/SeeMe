import {
  DeviceState,
  fetchStatus,
  getToken,
  setToken,
  TokenError,
} from "./api";
import "./style.css";

const app = document.getElementById("app")!;
const POLL_MS = 2500;
const OFFLINE_LABEL_MS = 30_000;

let devices = new Map<string, DeviceState>();
let token = getToken();
let tokenModal: HTMLDivElement | null = null;

function timeAgo(ts: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 60) return `${diff}s 前`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}min 前`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min 前`;
}

function batteryColor(level: number): string {
  if (level > 60) return "#34d399";
  if (level > 30) return "#fbbf24";
  return "#f87171";
}

function batteryLabel(level: number): string {
  if (level >= 100) return "已充满";
  if (level > 60) return "电量充足";
  if (level > 30) return "电量一般";
  if (level > 15) return "电量偏低";
  return "电量告急";
}

function platformIcon(p: string): string {
  return p === "android" ? "🤖" : "🪟";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}

function batteryRing(level: number, charging: boolean): string {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - level / 100);
  const color = batteryColor(level);
  const bolt = charging
    ? `<span class="bolt">⚡</span>`
    : "";
  return `
    <div class="ring-wrap">
      <svg class="ring" viewBox="0 0 120 120" width="150" height="150">
        <circle class="ring-bg" cx="60" cy="60" r="${r}" />
        <circle class="ring-fg" cx="60" cy="60" r="${r}"
          style="stroke:${color};stroke-dasharray:${c.toFixed(1)};stroke-dashoffset:${offset.toFixed(1)}" />
      </svg>
      <div class="ring-center">
        <div class="ring-level">${level}%</div>
        <div class="ring-label">${batteryLabel(level)}</div>
      </div>
      ${bolt}
    </div>`;
}

function inputBadge(state: string): string {
  if (state === "typing") {
    return `<span class="badge typing"><span class="dot red"></span>输入中</span>`;
  }
  if (state === "idle") {
    return `<span class="badge"><span class="dot gray"></span>空闲</span>`;
  }
  return `<span class="badge"><span class="dot dim"></span>未知</span>`;
}

function onlineBadge(d: DeviceState, now: number): string {
  if (d.online) {
    return `<span class="badge online"><span class="dot green"></span>在线</span>`;
  }
  return `<span class="badge offline"><span class="dot gray"></span>离线 · ${timeAgo(d.lastSeen, now)}</span>`;
}

function deviceCard(d: DeviceState, now: number): string {
  const name = d.deviceName || d.deviceId;
  const fgAppHtml = d.foregroundApp
    ? `<div class="field">
         <div class="field-label">前台应用</div>
         <div class="field-value">${escapeHtml(d.foregroundApp)}</div>
         ${
           d.foregroundActivity
             ? `<div class="field-sub mono">${escapeHtml(d.foregroundActivity)}</div>`
             : ""
         }
       </div>`
    : `<div class="field"><div class="field-label">前台应用</div><div class="field-value dim-text">—</div></div>`;

  return `
    <section class="card" data-device="${d.deviceId}">
      <header class="card-head">
        <span class="platform">${platformIcon(d.platform)}</span>
        <div class="card-title">
          <h2>${escapeHtml(name)}</h2>
          <div class="card-sub mono">${d.deviceId}</div>
        </div>
        <div class="head-badges">${onlineBadge(d, now)}</div>
      </header>
      ${
        d.statusText
          ? `<div class="status-banner">${escapeHtml(d.statusText)}</div>`
          : ""
      }
      <div class="card-body">
        ${batteryRing(d.battery.level, d.battery.charging)}
        <div class="card-info">
          ${app}
          <div class="field">
            <div class="field-label">输入状态</div>
            <div>${inputBadge(d.inputState)}</div>
          </div>
          ${
            d.mediaTitle
              ? `<div class="field">
                   <div class="field-label">正在播放</div>
                   <div class="field-value media">🎵 ${escapeHtml(d.mediaTitle)}</div>
                 </div>`
              : ""
          }
        </div>
      </div>
      <footer class="card-foot">
        <span class="updated">最后活跃 ${timeAgo(d.lastSeen, now)}</span>
        <span class="charging ${d.battery.charging ? "on" : ""}">
          ${d.battery.charging ? "充电中" : "未充电"}
        </span>
      </footer>
    </section>`;
}

function render(now: number): void {
  const list = [...devices.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  const onlineCount = list.filter((d) => d.online).length;
  const total = list.length;

  const header = `
    <header class="page-head">
      <div>
        <h1>SeeMe<span class="accent">.</span></h1>
        <p class="tagline">实时视奸自己的每一台设备</p>
      </div>
      <div class="stats">
        <div class="stat">
          <span class="stat-num">${onlineCount}<small>/${total}</small></span>
          <span class="stat-label">在线</span>
        </div>
        <button class="ghost-btn" id="token-btn">🔑 设置 Token</button>
      </div>
    </header>
    <main class="grid">
      ${
        list.length === 0
          ? `<div class="empty">
               <div class="empty-icon">📡</div>
               <p>还没有设备上报状态</p>
               <p class="dim-text">启动 Android 客户端或 Windows 脚本后，这里会出现设备卡片</p>
             </div>`
          : list.map((d) => deviceCard(d, now)).join("")
      }
    </main>
    <footer class="page-foot">SeeMe · 数据每 2.5s 刷新</footer>`;

  app.innerHTML = header;

  // 复用已存在的卡片，避免闪烁
  const existing = app.querySelectorAll(".card");
  existing.forEach((el) => {
    const id = el.getAttribute("data-device");
    if (id) {
      const old = devices.get(id);
      const fresh = list.find((d) => d.deviceId === id);
      if (old && fresh) {
        const changed =
          old.battery.level !== fresh.battery.level ||
          old.battery.charging !== fresh.battery.charging ||
          old.foregroundApp !== fresh.foregroundApp ||
          old.inputState !== fresh.inputState ||
          old.online !== fresh.online;
        if (changed) {
          el.classList.add("flash");
        }
      }
    }
  });

  devices = new Map(list.map((d) => [d.deviceId, d]));

  document.getElementById("token-btn")?.addEventListener("click", () => {
    tokenModal?.remove();
    showTokenModal();
  });
}

function showTokenModal(): void {
  const modal = document.createElement("div");
  modal.className = "modal-mask";
  modal.innerHTML = `
    <div class="modal">
      <h3>设置访问 Token</h3>
      <p class="dim-text">在 Workers 服务端配置的共享密钥，用于读取设备状态</p>
      <input id="token-input" type="password" placeholder="粘贴 Token" value="${escapeHtml(
        token || ""
      )}" autofocus />
      <div class="modal-actions">
        <button class="ghost-btn" id="modal-cancel">取消</button>
        <button class="primary-btn" id="modal-save">保存</button>
      </div>
    </div>`;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
  document.getElementById("modal-cancel")!.addEventListener("click", () => modal.remove());
  document.getElementById("modal-save")!.addEventListener("click", () => {
    const input = document.getElementById("token-input") as HTMLInputElement;
    const value = input.value.trim();
    if (!value) return;
    token = value;
    setToken(value);
    modal.remove();
    refresh();
  });
  document.getElementById("token-input")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (document.getElementById("modal-save") as HTMLButtonElement).click();
  });
  document.body.appendChild(modal);
  tokenModal = modal;
}

async function refresh(): Promise<void> {
  if (!token) {
    render(Date.now());
    showTokenModal();
    return;
  }
  try {
    const resp = await fetchStatus(token);
    render(resp.serverTime);
  } catch (err) {
    if (err instanceof TokenError) {
      token = null;
      render(Date.now());
      showTokenModal();
      return;
    }
    // 网络错误时保留上次渲染，仅在 footer 提示
    console.warn("refresh failed:", err);
    render(Date.now());
  }
}

render(Date.now());

// 轮询
setInterval(() => {
  void refresh();
}, POLL_MS);

// 相对时间每秒刷新一次，无需重新请求
setInterval(() => {
  render(Date.now());
}, 1000);
