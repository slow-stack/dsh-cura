# -*- coding: utf-8 -*-
"""验证 _SdRecorder.drain() 与 _speak 播放后排空，防自听复读。"""
import sys, types, time
import numpy as np

sys.path.insert(0, "..")
import engine as E

FAIL = []

def check(name, cond, detail=""):
    print(("  ok  " if cond else " FAIL ") + name + ("  " + detail if detail else ""))
    if not cond:
        FAIL.append(name)

# ---- 1. drain 清空 pending 与队列，返回丢掉的采样数
print("[1] _SdRecorder.drain")
rec = E._SdRecorder.__new__(E._SdRecorder)
rec._queue = E.queue.Queue(maxsize=256)
rec._pending = np.ones(100, dtype=np.float32)
for _ in range(3):
    rec._queue.put_nowait(np.ones(50, dtype=np.float32))
dropped = rec.drain()
check("返回值等于丢掉的采样数", dropped == 250, f"got {dropped}")
check("pending 被清空", rec._pending.size == 0)
check("队列被清空", rec._queue.empty())
check("再 drain 一次返回 0", rec.drain() == 0)

# ---- 2. 不 drain 时 record() 会拿到旧数据（证明 bug 真实存在）
print("[2] 对照：不 drain 就会把旧漏音当成新输入")
rec2 = E._SdRecorder.__new__(E._SdRecorder)
rec2._queue = E.queue.Queue(maxsize=256)
rec2._pending = np.zeros(0, dtype=np.float32)
rec2.gain = 1.0
rec2._queue.put_nowait(np.full(80, 0.5, dtype=np.float32))
got = rec2.record(80).ravel()
check("record 读到的正是积压的漏音", np.allclose(got, 0.5))

# ---- 3. _speak 播完必须调 drain
print("[3] _speak 播放后排空")
class FakePlayer:
    def __init__(self): self.played = 0
    def play(self, block): self.played += len(block)

class FakeRec:
    def __init__(self): self.drained = 0
    def drain(self):
        self.drained += 1
        return 4410
    def record(self, numframes):  # bargeIn 关掉时不该被调用
        raise AssertionError("bargeIn=False 时 _speak 不该读麦克风")

class Stub:
    pass

stub = Stub()
stub.cfg = {"audio": {"channels": 2, "bargeIn": False, "startThreshold": 0.006,
                      "stopThreshold": 0.002, "bargeThreshold": 0.02}}
stub.stop_flag = E.threading.Event()
stub.brain = types.SimpleNamespace(synthesize=lambda text: np.full(2205, 0.2, dtype=np.float32))

player, frec = FakePlayer(), FakeRec()
E.CallSession._speak(stub, player, frec, "测试一句", 44100, 441)
check("真的播放了音频", player.played > 0, f"played={player.played}")
check("播放后调用了 drain", frec.drained == 1, f"drained={frec.drained}")

# ---- 4. TTS 空音频时不播、也不该假装 drain（提前 return）
print("[4] TTS 空音频提前返回")
stub2 = Stub()
stub2.cfg = {"audio": {"channels": 2, "bargeIn": False, "startThreshold": 0.006,
                       "stopThreshold": 0.002, "bargeThreshold": 0.02}}
stub2.stop_flag = E.threading.Event()
stub2.brain = types.SimpleNamespace(synthesize=lambda text: np.zeros(100, dtype=np.float32))
p2, r2 = FakePlayer(), FakeRec()
E.CallSession._speak(stub2, p2, r2, "空", 44100, 441)
check("全零音频不播放", p2.played == 0)
check("全零音频不调 drain（没播就没漏音）", r2.drained == 0)

print()
if FAIL:
    print("FAILED:", ", ".join(FAIL))
    sys.exit(1)
print("all drain/barge tests passed")
