# -*- coding: utf-8 -*-
"""诊断辅助：等待来电并自动接听（不做对话），供音频诊断使用。120 秒后自动退出。"""
import json
import time
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
cfg = json.load(open(HERE / "config.json", encoding="utf-8"))
token = open(cfg["tokenFile"], encoding="utf-8").read().strip()
BASE = f"http://127.0.0.1:{cfg['controlPort']}"
H = {"Authorization": f"Bearer {token}"}
WHITELIST = {str(u) for u in cfg["whitelist"]}

deadline = time.time() + 600
accepted = False
while time.time() < deadline and not accepted:
    try:
        cur = httpx.get(f"{BASE}/v1/calls/current", headers=H, timeout=5).json()["data"]
    except Exception:
        time.sleep(1)
        continue
    if cur and cur.get("phase") == "ringing" and cur.get("direction") == "incoming":
        uin = str(cur.get("callerUin") or "")
        if uin and uin in WHITELIST:
            r = httpx.post(f"{BASE}/v1/calls/accept", headers=H, timeout=10,
                           json={"requestId": f"diag-accept-{int(time.time())}", "callId": cur["id"]})
            print("accept →", r.status_code, r.text[:120], flush=True)
            if r.status_code == 200:
                accepted = True
                print("已接听，开始说话吧（本脚本只接听不对话）", flush=True)
    time.sleep(0.5)
if not accepted:
    print("120 秒内无来电")
