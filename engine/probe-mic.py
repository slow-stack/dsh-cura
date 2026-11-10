# -*- coding: utf-8 -*-
"""录一段真麦，每秒打印 RMS，用来判断麦克风到底有没有收到人声。
用法: python probe-mic.py [秒数=20] [设备索引=3]"""
import sys, time
import numpy as np
import sounddevice as sd

DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 20.0
DEV = int(sys.argv[2]) if len(sys.argv) > 2 else 3

d = sd.query_devices(DEV)
sr = int(d["default_samplerate"])
print(f"device[{DEV}] {d['name']} sr={sr} ch={d['max_input_channels']}", flush=True)

rec = sd.InputStream(device=DEV, samplerate=sr, channels=1, dtype="float32", blocksize=int(sr * 0.05))
rec.start()
peak = 0.0
t0 = time.monotonic()
buf = []
while time.monotonic() - t0 < DUR:
    block, _ = rec.read(int(sr * 0.05))
    a = np.asarray(block, dtype=np.float64).reshape(-1)
    buf.append(a)
    rms = float(np.sqrt(np.mean(a ** 2)))
    peak = max(peak, float(np.abs(a).max()))
    print(f"{time.monotonic()-t0:5.1f}s  rms={rms:.6f}  peak={np.abs(a).max():.4f}", flush=True)
rec.stop(); rec.close()

allpcm = np.concatenate(buf)
print("=== SUMMARY ===", flush=True)
print(f"frames={allpcm.size} sec={allpcm.size/sr:.1f}", flush=True)
print(f"overall_rms={float(np.sqrt(np.mean(allpcm**2))):.6f}", flush=True)
print(f"peak={float(np.abs(allpcm).max()):.5f}", flush=True)
fr = int(sr * 0.05)
segs = [float(np.sqrt(np.mean(allpcm[i:i+fr]**2))) for i in range(0, allpcm.size - fr, fr)]
arr = np.array(segs)
print("p50=%.6f p90=%.6f p99=%.6f max=%.6f" % (np.percentile(arr,50), np.percentile(arr,90), np.percentile(arr,99), arr.max()), flush=True)
print("frames>0.002: %d  >0.005: %d  >0.01: %d  >0.02: %d" % ((arr>0.002).sum(), (arr>0.005).sum(), (arr>0.01).sum(), (arr>0.02).sum()), flush=True)
