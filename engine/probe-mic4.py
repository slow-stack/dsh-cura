# -*- coding: utf-8 -*-
"""回调式录两条真麦路径（MME 走阻塞、WDM-KS 必须走回调），逐秒打电平并存 wav。
用法: python probe-mic4.py [秒=60]"""
import sys, time, threading, queue, wave
import numpy as np
import sounddevice as sd

DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 60.0
LSB = 1.0 / 32768.0
CANDS = [(3, "mme"), (37, "wdmks")]
summary = {}

def worker(idx, tag):
    d = sd.query_devices(idx)
    sr = int(d["default_samplerate"])
    ch = 2
    q = queue.Queue()
    buf = []

    def cb(indata, frames, tinfo, status):
        q.put(indata[:, 0].copy())

    try:
        st = sd.InputStream(device=idx, samplerate=sr, channels=ch, dtype="float32",
                            blocksize=int(sr * 0.05), callback=cb)
        st.start()
    except Exception as e:
        print(f"[{tag}] OPEN_FAIL {e}", flush=True)
        summary[tag] = None
        return

    t0 = time.monotonic()
    last_report = 0.0
    while time.monotonic() - t0 < DUR:
        try:
            a = q.get(timeout=0.5)
        except queue.Empty:
            continue
        buf.append(a)
        el = time.monotonic() - t0
        if el - last_report >= 1.0:
            last_report = el
            rms = float(np.sqrt(np.mean(a ** 2)))
            pk = float(np.abs(a).max())
            print(f"[{tag}] {el:5.1f}s rms={rms:.6f} peak={pk:.5f} LSB={pk/LSB:.0f}", flush=True)
    st.stop(); st.close()

    if not buf:
        summary[tag] = None
        return
    pcm = np.concatenate(buf)
    fr = int(sr * 0.05)
    segs = np.array([float(np.sqrt(np.mean(pcm[i:i+fr]**2))) for i in range(0, pcm.size-fr, fr)])
    summary[tag] = dict(sr=sr, rms=round(float(np.sqrt(np.mean(pcm**2))), 6),
                        peak=round(float(np.abs(pcm).max()), 6),
                        p50=round(float(np.percentile(segs,50)), 6),
                        p90=round(float(np.percentile(segs,90)), 6),
                        p99=round(float(np.percentile(segs,99)), 6),
                        mx=round(float(segs.max()), 6),
                        gt002=int((segs>0.002).sum()), gt005=int((segs>0.005).sum()),
                        gt01=int((segs>0.01).sum()), frames=int(segs.size))
    w = wave.open(f"probe4-{tag}.wav", "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((np.clip(pcm, -1, 1) * 32767).astype(np.int16).tobytes())
    w.close()

ths = [threading.Thread(target=worker, args=c) for c in CANDS]
for t in ths: t.start()
for t in ths: t.join()
print("=== SUMMARY ===", flush=True)
for _i, tag in CANDS:
    print(tag, summary.get(tag), flush=True)
