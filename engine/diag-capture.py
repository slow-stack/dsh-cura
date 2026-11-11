# -*- coding: utf-8 -*-
"""通话音频诊断：同时环回监测多个播放端点，每秒输出各端点 RMS。
用法: python diag-capture.py [持续秒数=180] —— 打电话并说话，结束后看哪个端点有电平。"""
import sys
import time

import numpy as np
import soundcard as sc

DUR = int(sys.argv[1]) if len(sys.argv) > 1 else 180
SR = 44100
frames = int(SR * 0.5)


def find_speaker(*names):
    for n in names:
        for d in sc.all_speakers():
            if n.lower() in d.name.lower():
                return d
    return None


targets = []
if (spk := find_speaker("Realtek")):
    targets.append(("Realtek(默认)", spk))
if (spk := find_speaker("Hi-Fi Cable Input")):
    targets.append(("HiFi(cmd102)", spk))
if (spk := find_speaker("CABLE Input")):
    targets.append(("CABLE(我们的TTS)", spk))

mics = []
for tag, spk in targets:
    mic = sc.get_microphone(spk.id, include_loopback=True)
    if mic:
        mics.append((tag, mic))
        print(f"监测: {tag} ← {spk.name}")
    else:
        print(f"跳过: {tag}（无环回）")

recs = [mic.recorder(samplerate=SR, channels=1) for _, mic in mics]
levels = {tag: 0.0 for tag, _ in mics}
import contextlib
with contextlib.ExitStack() as stack:
    for r in recs:
        stack.enter_context(r)
    t0 = time.monotonic()
    last_print = 0
    while time.monotonic() - t0 < DUR:
        for (tag, _), rec in zip(mics, recs):
            data = rec.record(numframes=frames)
            levels[tag] = float(np.sqrt(np.mean(data ** 2)))
        if time.monotonic() - last_print >= 1.0:
            stamp = time.strftime("%H:%M:%S")
            line = " | ".join(f"{tag}={levels[tag]:.4f}" for tag, _ in mics)
            print(f"{stamp}  {line}", flush=True)
            last_print = time.monotonic()
print("诊断结束")
