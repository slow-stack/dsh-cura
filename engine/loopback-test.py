# -*- coding: utf-8 -*-
"""虚拟声卡回环测试：向 CABLE Input 播放正弦波，同时从 CABLE Output 录回来，
检查收到的波形是否还是干净的正弦（格式/采样率匹配验证）。"""
import sys
import time

import numpy as np
import soundcard as sc

SR = int(sys.argv[1]) if len(sys.argv) > 1 else 48000
DUR = 3.0

def find(names, kind):
    devs = sc.all_microphones() if kind == "mic" else sc.all_speakers()
    for n in names:
        for d in devs:
            if n.lower() in d.name.lower():
                return d
    raise RuntimeError(f"找不到设备 {names}，现有: {[d.name for d in devs]}")

tx_in = find(["CABLE Input"], "spk")       # 引擎播放（她说）
tx_out = find(["CABLE Output"], "mic")     # AVSDK 采集的同一根线的录音端

freq = 440.0
t = np.arange(int(SR * DUR)) / SR
sine = (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
stereo = np.repeat(sine[:, None], 2, axis=1)

with tx_in.player(samplerate=SR, channels=2) as player, \
     tx_out.recorder(samplerate=SR, channels=2) as rec:
    print(f"以 {SR}Hz 播放 {freq}Hz 正弦 {DUR}s，同时从 CABLE Output 录制...")
    pos = 0
    frames = int(SR * 0.05)
    got = []
    t0 = time.monotonic()
    queued = 0
    while pos < len(stereo) or (time.monotonic() - t0) < DUR + 0.5:
        if pos < len(stereo):
            end = min(pos + frames, len(stereo))
            player.play(stereo[pos:end])
            queued += end - pos
            pos = end
        got.append(rec.record(numframes=frames))
    audio = np.concatenate(got).mean(axis=1)

# 分析录到的信号
audio = audio[int(SR * 0.2): int(SR * (DUR - 0.2))]  # 去头尾
rms = float(np.sqrt(np.mean(audio ** 2)))
# 检查主频
spec = np.abs(np.fft.rfft(audio * np.hanning(len(audio))))
peak_freq = float(np.fft.rfftfreq(len(audio), 1 / SR)[int(np.argmax(spec))])
# 削波/噪声检查
clipped = float(np.mean(np.abs(audio) > 0.99))
print(f"RMS={rms:.4f}  主频={peak_freq:.0f}Hz（期望 {freq:.0f}）  削波占比={clipped:.3%}")
if rms < 0.01:
    print("❌ 几乎录到静音：回环不通（设备接错或格式被拒）")
elif abs(peak_freq - freq) > 40:
    print("❌ 主频偏移：采样率不匹配（听感会是电波噪声/变调）")
elif clipped > 0.01:
    print("❌ 严重削波：位深/增益问题（听感是爆音噪声）")
else:
    print("✅ 回环干净：引擎→CABLE→录音 这半条链路格式正确")
