# -*- coding: utf-8 -*-
"""同时录两条真麦路径，存 wav 并逐秒打电平。用法: python probe-mic3.py [秒=25]"""
import sys, time, threading, wave
import numpy as np
import sounddevice as sd

DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 25.0
LSB = 1.0 / 32768.0
CANDS = [(3, 2, "mme"), (37, 2, "wdmks")]
out = {}

def worker(idx, ch, tag):
    d = sd.query_devices(idx)
    sr = int(d["default_samplerate"])
    buf = []
    try:
        st = sd.InputStream(device=idx, samplerate=sr, channels=ch, dtype="float32",
                            blocksize=int(sr * 0.05))
        st.start()
    except Exception as e:
        print(f"[{tag}] OPEN_FAIL {e}", flush=True)
        out[tag] = None
        return
    t0 = time.monotonic()
    while time.monotonic() - t0 < DUR:
        try:
            block, _ = st.read(int(sr * 0.05))
        except Exception as e:
            print(f"[{tag}] READ_FAIL {e}", flush=True)
            break
        a = np.asarray(block, dtype=np.float64)[:, 0]
        buf.append(a)
        rms = float(np.sqrt(np.mean(a ** 2)))
        print(f"[{tag}] {time.monotonic()-t0:5.1f}s rms={rms:.6f} peak={float(np.abs(a).max()):.5f} LSB={float(np.abs(a).max())/LSB:.0f}", flush=True)
    st.stop(); st.close()
    if not buf:
        out[tag] = None
        return
    pcm = np.concatenate(buf)
    fr = int(sr * 0.05)
    segs = np.array([float(np.sqrt(np.mean(pcm[i:i+fr]**2))) for i in range(0, pcm.size-fr, fr)])
    out[tag] = dict(sr=sr, rms=float(np.sqrt(np.mean(pcm**2))), peak=float(np.abs(pcm).max()),
                    p50=float(np.percentile(segs,50)), p90=float(np.percentile(segs,90)),
                    p99=float(np.percentile(segs,99)), mx=float(segs.max()),
                    gt002=int((segs>0.002).sum()), gt005=int((segs>0.005).sum()),
                    gt01=int((segs>0.01).sum()), frames=int(segs.size))
    w = wave.open(f"probe3-{tag}.wav", "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((np.clip(pcm, -1, 1) * 32767).astype(np.int16).tobytes())
    w.close()

ths = [threading.Thread(target=worker, args=c) for c in CANDS]
for t in ths: t.start()
for t in ths: t.join()
print("=== SUMMARY ===", flush=True)
for tag, _c, _t in CANDS:
    print(tag, out.get(tag), flush=True)
