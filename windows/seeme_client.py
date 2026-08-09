# -*- coding: utf-8 -*-
"""
SeeMe Windows 采集端（托盘版）
- 前台窗口：GetForegroundWindow → 窗口标题 + 进程 exe
- 电量：psutil.sensors_battery
- 输入状态：GetLastInputInfo（距上次输入 N 秒内 = typing，否则 idle）
- 事件驱动上报 + 60s 心跳 → POST /api/report
- 运行后仅显示在系统托盘（无控制台窗口，配合 pythonw 使用）
"""

import ctypes
import json
import os
import socket
import sys
import threading
import time
import uuid
import webbrowser
from ctypes import wintypes

import psutil
import requests
import win32gui
import win32process
from PIL import Image, ImageDraw
import pystray

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

DEFAULT_CONFIG = {
    "server_url": "",
    "auth_token": "",
    "device_name": "",
    "idle_seconds": 10,
    "poll_interval": 1.0,
    "heartbeat_interval": 60,
    "battery_report_delta": 5,
}


# ---------------- 配置 ----------------

def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception as e:
            show_error(f"读取 config.json 失败: {e}")
    return cfg


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def get_device_id(cfg: dict) -> str:
    if not cfg.get("device_id"):
        cfg["device_id"] = str(uuid.uuid4())
        save_config(cfg)
    return cfg["device_id"]


def show_error(msg: str) -> None:
    """托盘模式无控制台，用弹窗提示错误"""
    ctypes.windll.user32.MessageBoxW(0, msg, "SeeMe", 0x10)


# ---------------- 采集 ----------------

class _LastInputInfo(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def get_last_input_tick() -> int:
    lii = _LastInputInfo()
    lii.cbSize = ctypes.sizeof(_LastInputInfo)
    if ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
        return lii.dwTime
    return 0


def get_tick() -> int:
    return ctypes.windll.kernel32.GetTickCount()


def ms_since_last_input() -> int:
    """处理 GetTickCount 49 天回绕"""
    return (get_tick() - get_last_input_tick()) & 0xFFFFFFFF


def get_foreground() -> tuple:
    try:
        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None, None
        title = win32gui.GetWindowText(hwnd)
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        exe = psutil.Process(pid).name()
        return title or "", exe
    except Exception:
        return None, None


def get_battery() -> dict:
    try:
        bat = psutil.sensors_battery()
        if bat is None:
            return None
        return {"level": int(bat.percent), "charging": bool(bat.power_plugged)}
    except Exception:
        return None


# ---------------- 上报 ----------------

def report(cfg: dict, state: dict) -> bool:
    url = cfg["server_url"].rstrip("/") + "/api/report"
    payload = {
        "deviceId": state["deviceId"],
        "deviceName": state["deviceName"],
        "platform": "windows",
    }
    for key in ("battery", "foregroundApp", "foregroundActivity", "inputState"):
        if state.get(key) is not None:
            payload[key] = state[key]
    try:
        r = requests.post(
            url,
            json=payload,
            headers={"X-Auth-Token": cfg["auth_token"]},
            timeout=10,
        )
        return r.status_code == 200
    except Exception:
        return False


# ---------------- 托盘 ----------------

def create_icon_image(level: int) -> Image.Image:
    """画一个电池图标，颜色随电量"""
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([6, 16, 56, 48], radius=7, outline="#7DD3FC", width=3)
    d.rectangle([56, 25, 62, 39], fill="#7DD3FC")
    fill = "#34d399" if level > 30 else "#f87171"
    if level > 0:
        w = max(2, int(46 * min(level, 100) / 100))
        d.rounded_rectangle([11, 21, 11 + w, 43], radius=4, fill=fill)
    return img


def build_menu(cfg: dict, state: dict, stop_flag: threading.Event, icon) -> pystray.Menu:
    def quit_app(_icon, _item):
        stop_flag.set()
        icon.stop()

    def open_dashboard(_icon, _item):
        webbrowser.open(cfg["server_url"])

    return pystray.Menu(
        pystray.MenuItem(
            lambda item: f"🔋 电量 {state['battery']['level']}%"
            + (" 充电中" if state["battery"]["charging"] else ""),
            None,
            enabled=False,
        ),
        pystray.MenuItem(
            lambda item: f"🪟 {state['foregroundApp'] or '未知'}",
            None,
            enabled=False,
        ),
        pystray.MenuItem(
            lambda item: f"⌨️ {'输入中' if state['inputState'] == 'typing' else '空闲'}",
            None,
            enabled=False,
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("打开仪表盘", open_dashboard, default=True),
        pystray.MenuItem("退出", quit_app),
    )


# ---------------- 主程序 ----------------

def main() -> None:
    cfg = load_config()
    if not cfg["server_url"] or not cfg["auth_token"]:
        show_error("请先编辑 config.json，填写 server_url 与 auth_token")
        return

    device_id = get_device_id(cfg)
    device_name = cfg["device_name"] or socket.gethostname()
    state = {
        "deviceId": device_id,
        "deviceName": device_name,
        "battery": get_battery() or {"level": -1, "charging": False},
        "foregroundApp": None,
        "foregroundActivity": None,
        "inputState": "unknown",
    }

    stop_flag = threading.Event()

    def collector():
        last_window_key = None
        last_input_state = "unknown"
        last_battery_key = None
        last_heartbeat = 0.0

        while not stop_flag.is_set():
            now = time.time()

            # 1. 前台窗口
            title, exe = get_foreground()
            if title is not None and (title, exe) != last_window_key:
                last_window_key = (title, exe)
                state["foregroundApp"] = title or "(桌面)"
                state["foregroundActivity"] = exe
                report(cfg, state)

            # 2. 输入状态
            idle_ms = ms_since_last_input()
            input_state = "typing" if idle_ms < cfg["idle_seconds"] * 1000 else "idle"
            if input_state != last_input_state:
                last_input_state = input_state
                state["inputState"] = input_state
                report(cfg, state)

            # 3. 电量（周期检查）
            bat = get_battery()
            if bat:
                key = (bat["level"], bat["charging"])
                changed = last_battery_key is None
                if last_battery_key is not None:
                    level_delta = abs(bat["level"] - last_battery_key[0])
                    charging_changed = bat["charging"] != last_battery_key[1]
                    changed = level_delta >= cfg["battery_report_delta"] or charging_changed
                if changed:
                    last_battery_key = key
                    state["battery"] = bat
                    report(cfg, state)

            # 4. 心跳
            if now - last_heartbeat >= cfg["heartbeat_interval"]:
                last_heartbeat = now
                report(cfg, state)

            time.sleep(cfg["poll_interval"])

    threading.Thread(target=collector, daemon=True).start()

    icon = pystray.Icon(
        "seeme",
        create_icon_image(state["battery"].get("level", -1)),
        "SeeMe",
    )
    icon.menu = build_menu(cfg, state, stop_flag, icon)
    icon.run()
    stop_flag.set()


if __name__ == "__main__":
    main()
