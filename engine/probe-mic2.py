# -*- coding: utf-8 -*-
"""同时录两个候选麦克风，每秒打一行电平，用来判断哪条采集路径真能听到人声。
用法: python probe-mic2.py [秒数=15]"""
import sys, time, threading
import numpy as np
import sounddevice as sd

DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 15.0
LSB = 1.0 / 32768.0
CANDS = [3, 37]

results = {}
stop = threading.Event()

def worker(idx):
    d = sd.query_devices(idx)
    sr = int(d["default_samplerate"])
    ch = 2
    buf = []
    try:
        st = sd.InputStream(device=idx, samplerate=sr, channels=ch, dtype="float32",
                            blocksize=int(sr * 0.05))
        st.start()
    except Exception as e:
        results[idx] = ("OPEN_FAIL", str(e))
        return
    t0 = time.monotonic()
    while not stop.is_set():
        try:
            block, _ = st.read(int(sr * 0.05))
        except Exception as e:
            results[idx] = ("READ_FAIL", str(e))
            st.close()
            return
        a = np.asarray(block, dtype=np.float64)[:, 0]
        buf.append(a)
        rms = float(np.sqrt(np.mean(a ** 2)))
        print(f"[dev{idx}] {time.monotonic()-t0:5.1f}s rms={rms:.6f} peak={float(np.abs(a).max()):.5f} LSB={float(np.abs(a).max())/LSB:.1f}", flush=True)
    st.stop(); st.close()
    pcm = np.concatenate(buf) if buf else np.zeros(1)
    fr = int(sr * 0.05)
    segs = np.array([float(np.sqrt(np.mean(pcm[i:i+fr]**2))) for i in range(0, pcm.size-fr, fr)])
    results[idx] = ("OK", dict(rms=float(np.sqrt(np.mean(pcm**2))), peak=float(np.abs(pcm).max()),
                               p50=float(np.percentile(segs,50)), p90=float(np.percentile(segs,90)),
                               p99=float(np.percentile(segs,99)), mx=float(segs.max()),
                               gt002=int((segs>0.002).sum()), gt005=int((segs>0.005).sum()),
                               gt01=int((segs>0.01).sum()), frames=int(segs.size)))

ths = [threading.Thread(target=worker, args=(i,)) for i in CANDS]
for t in ths: t.start()
time.sleep(DUR)
stop.set()
for t in ths: t.join(timeout=5)

print("=== SUMMARY ===", flush=True)
for i in CANDS:
    print(i, results.get(i), flush=True)
