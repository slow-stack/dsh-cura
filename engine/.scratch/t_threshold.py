# -*- coding: utf-8 -*-
"""门限封顶 + 等门自愈 的回归测试（驱动 engine.py 里的真实函数）。"""
import importlib.util
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ENGINE = HERE.parent / "engine.py"
sys.path.insert(0, str(ENGINE.parent))

import engine as E

FAIL = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (("  | " + str(detail)) if detail else ""))
    if not cond:
        FAIL.append(name)


class FakeRec:
    def __init__(self, seq, frames):
        self.seq, self.frames, self.i = list(seq), frames, 0

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def record(self, numframes):
        val = self.seq[self.i] if self.i < len(self.seq) else 0.0
        self.i += 1
        return np.full((self.frames, 1), val, dtype=np.float32)

    def drain(self):
        return 0


class FakeMic:
    def __init__(self, seq):
        self.seq = seq

    def recorder(self, samplerate, channels):
        return FakeRec(self.seq, int(samplerate * 50 // 1000))


def make_session(mod, audio):
    s = mod.CallSession.__new__(mod.CallSession)
    s.cfg = {"audio": dict(audio)}
    s.stop_flag = __import__("threading").Event()
    return s


SR = 16000
FRAMES = SR * 50 // 1000

# ---- 1. 底噪高时门限必须封顶（旧代码会顶到 0.05，人声永远够不到）
sess = make_session(E, {"adaptiveThreshold": True})
sess._calibrate_thresholds(FakeMic([0.03] * 24 + [0.025] * 20), SR, 1, FRAMES)
start = sess.cfg["audio"]["startThreshold"]
old = min(0.05, max(0.003, 0.025 * 2.5 + 0.0008))
check("高底噪时门限封顶 0.012", abs(start - 0.012) < 1e-9, f"start={start} 旧算法={old}")
check("封顶后仍高于人声静音段", start > 0.002, f"start={start}")

# ---- 2. 底噪正常时行为不变（不该被这次改动带偏）
sess = make_session(E, {"adaptiveThreshold": True})
sess._calibrate_thresholds(FakeMic([0.03] * 24 + [0.0026] * 20), SR, 1, FRAMES)
start = sess.cfg["audio"]["startThreshold"]
check("正常底噪仍按 2.5x+0.0008 算", 0.006 < start < 0.009, f"start={start}")

# ---- 3. 门限定高了要能自愈：等门期间有能量却没触发，就往下退
class FakeTime:
    def __init__(self, t=1000.0):
        self.t = t

    def monotonic(self):
        return self.t

    def time(self):
        return self.t

    def sleep(self, s):
        self.t += s


AUDIO = {"startThreshold": 0.02, "stopThreshold": 0.008,
         "trailingSilenceSec": 1.2, "minSpeechSec": 0.6, "maxSegmentSec": 30}

# 等门 100 块（5s）电平 0.011（高于半门限，说明"有人在说话但没够到"），
# 然后 30 块 0.016（真实人声，低于旧门限 0.02、高于自愈后的 0.014），最后尾静音
seq = [0.011] * 100 + [0.016] * 30 + [0.001] * 30
ft = FakeTime()
real_time = E.time
E.time = ft
try:
    sess = make_session(E, AUDIO)
    rec = FakeRec(seq, FRAMES)
    raw_record = rec.record

    def record_advancing(numframes):
        ft.t += 0.05
        return raw_record(numframes)

    rec.record = record_advancing
    got = sess._record_utterance(rec, SR, FRAMES, deadline=1100.0)
finally:
    E.time = real_time

new_start = sess.cfg["audio"]["startThreshold"]
check("自愈后门限被下调", new_start < 0.02, f"start={new_start}")
check("自愈后能收到人声", isinstance(got, np.ndarray) and got.size > 0,
      f"type={type(got).__name__} size={getattr(got, 'size', None)}")
if isinstance(got, np.ndarray) and got.size:
    dur = got.size / SR
    check("收到时长合理（1.5s 人声 + 1.2s 尾静音）", 2.5 <= dur <= 3.0, f"dur={dur:.2f}s")

# ---- 4. 变异自证：把自愈段删掉，同一个场景必须失败
src = ENGINE.read_text(encoding="utf-8")
marker = "            if not collected:"
assert marker in src, "自愈块不见了，变异自证失效"
mut_src = src.replace(marker, "            if False:  # 变异：关掉自愈", 1)
mut_path = HERE / "_engine_mut_noselfheal.py"
mut_path.write_text(mut_src, encoding="utf-8")
spec = importlib.util.spec_from_file_location("engine_mut", mut_path)
mut = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mut)

ft = FakeTime()
E.time = ft
mut.time = ft
try:
    sess = make_session(mut, AUDIO)
    rec = FakeRec(seq, FRAMES)
    raw_record2 = rec.record

    def record_advancing2(numframes):
        ft.t += 0.05
        return raw_record2(numframes)

    rec.record = record_advancing2
    got_mut = sess._record_utterance(rec, SR, FRAMES, deadline=1100.0)
finally:
    E.time = real_time
    mut.time = real_time

check("变异体（无自愈）收不到人声", got_mut is None or (isinstance(got_mut, str) and got_mut == ""),
      f"mut got={type(got_mut).__name__} size={getattr(got_mut, 'size', None)}")
mut_path.unlink()

print()
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("all threshold tests passed ✓")
