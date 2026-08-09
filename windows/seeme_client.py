# -*- coding: utf-8 -*-
"""
SeeMe Windows 采集端
- 前台窗口：GetForegroundWindow → 窗口标题 + 进程 exe
- 电量：psutil.sensors_battery
- 输入状态：GetLastInputInfo（距上次输入 N 秒内 = typing，否则 idle）
- 事件驱动上报 + 60s 心跳 → POST /api/report
"""

import ctypes
import json
import os
import signal
import socket
import sys
import time
import uuid

import psutil
import requests
import win32gui
import win32process
from ctypes import wintypes

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

DEFAULT_CONFIG = {
    "server_url": "",
    "auth_token": "",
    "device_name": "",
    "idle_seconds": 10,          # 距上次输入超过该秒数视为 idle
    "poll_interval": 1.0,        # 前台窗口/输入状态轮询间隔（秒）
    "heartbeat_interval": 60,    # 心跳间隔（秒）
    "battery_report_delta": 5,   # 电量变化超过该百分比才上报
}


# ---------------- 配置 ----------------

def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception as e:
            print(f"[warn] 读取 config.json 失败: {e}")
    return cfg


def save_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def get_device_id(cfg: dict) -> str:
    if not cfg.get("device_id"):
        cfg["device_id"] = str(uuid.uuid4())
        save_config(cfg)
    return cfg["device_id"]


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
    """返回 (窗口标题, 进程 exe)；无法获取时返回 (None, None)"""
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


# ---------------- 主循环 ----------------

def main() -> None:
    cfg = load_config()
    if not cfg["server_url"] or not cfg["auth_token"]:
        print("请先编辑 config.json，填写 server_url 与 auth_token")
        sys.exit(1)

    device_id = get_device_id(cfg)
    device_name = cfg["device_name"] or socket.gethostname()
    state = {
        "deviceId": device_id,
        "deviceName": device_name,
        "battery": None,
        "foregroundApp": None,
        "foregroundActivity": None,
        "inputState": "unknown",
    }

    running = True

    def stop(_sig, _frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    print(f"SeeMe Windows 采集端启动  deviceId={device_id}  deviceName={device_name}")
    print(f"上报地址: {cfg['server_url']}")

    last_window_key = None
    last_input_state = "unknown"
    last_battery_key = None
    last_heartbeat = 0.0

    while running:
        now = time.time()

        # 1. 前台窗口
        title, exe = get_foreground()
        if title is not None and (title, exe) != last_window_key:
            last_window_key = (title, exe)
            state["foregroundApp"] = title or "(桌面)"
            state["foregroundActivity"] = exe
            print(f"[window] {exe}: {title}")
            report(cfg, state)

        # 2. 输入状态
        idle_ms = ms_since_last_input()
        input_state = "typing" if idle_ms < cfg["idle_seconds"] * 1000 else "idle"
        if input_state != last_input_state:
            last_input_state = input_state
            state["inputState"] = input_state
            print(f"[input] {input_state} ({idle_ms / 1000:.0f}s idle)")
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
                print(f"[battery] {bat['level']}% {'充电中' if bat['charging'] else '未充电'}")
                report(cfg, state)

        # 4. 心跳
        if now - last_heartbeat >= cfg["heartbeat_interval"]:
            last_heartbeat = now
            report(cfg, state)

        time.sleep(cfg["poll_interval"])

    print("已停止")


if __name__ == "__main__":
    main()
