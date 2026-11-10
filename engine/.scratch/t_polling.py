# -*- coding: utf-8 -*-
"""run_forever 的轮询退避回归测试：桥没起来时不能每 2 秒刷一条日志。"""
import sys
import threading
import time as _time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import engine as E


class _StopMut(BaseException):
    """变异体跳出用：run_forever 会吞 Exception，只有 BaseException 能出去。"""

FAIL = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + (("  | " + str(detail)) if detail else ""))
    if not cond:
        FAIL.append(name)


class FakeBridge:
    """前 fail_times 次抛 502，之后返回空事件；记录调用时间点。"""

    def __init__(self, fail_times):
        self.fail_times = fail_times
        self.calls = 0
        self.times = []

    def events(self, after, boot_id):
        self.calls += 1
        self.times.append(_time.monotonic())
        if self.calls <= self.fail_times:
            raise RuntimeError("Server error '502 Bad Gateway'")
        return {"events": [], "nextSeq": after, "bootId": boot_id or "b1"}


class FakeClock:
    """替换 engine 模块里的 time：sleep 只推进虚拟时钟，不真睡。"""

    def __init__(self):
        self.t = 1000.0
        self.sleeps = []

    def monotonic(self):
        return self.t

    def time(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(float(s))
        self.t += float(s)


def make_engine(bridge):
    e = E.Engine.__new__(E.Engine)
    e.cfg = {"controlPort": 6110, "whitelist": []}
    e.bridge = bridge
    e.stop_flag = threading.Event()
    return e


def run_until(engine, clock, max_iters, stop_after_ok=False):
    """跑 run_forever，但到条件就抛异常跳出（它本身是死循环）。"""
    class Stop(BaseException):  # 必须绕过 run_forever 的 except Exception
        pass

    base_sleep = clock.sleep

    def fake_sleep(s):
        base_sleep(s)
        if len(clock.sleeps) > max_iters:
            raise Stop()

    E.time = clock
    clock.sleep = fake_sleep
    try:
        engine.run_forever()
    except Stop:
        pass
    finally:
        E.time = _time


# ---- 1. 桥一直挂着：重试间隔必须指数退避，而不是恒定 2 秒
bridge = FakeBridge(fail_times=10 ** 6)
clock = FakeClock()
eng = make_engine(bridge)
run_until(eng, clock, max_iters=8)
# sleep 序列里既有轮询的 0.8，也有退避的 2/4/8/16/30，只挑退避那几个
backoffs = [s for s in clock.sleeps if s != 0.8]
check("退避序列递增", backoffs[:4] == [2.0, 4.0, 8.0, 16.0], f"backoffs={backoffs[:5]}")
check("退避有 30s 上限", max(backoffs) <= 30.0, f"max={max(backoffs)}")

# ---- 2. 同样错误不能每次都打日志：抓 log.warning 的调用次数
import logging


class ListHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


bridge = FakeBridge(fail_times=10 ** 6)
clock = FakeClock()
eng = make_engine(bridge)
handler = ListHandler()
E.log.addHandler(handler)
E.log.setLevel(logging.DEBUG)
try:
    run_until(eng, clock, max_iters=10)
finally:
    E.log.removeHandler(handler)
warns = [r for r in handler.records if r.levelno == logging.WARNING and "轮询失败" in r.getMessage()]
check("10 次失败只记 1 条 warning", len(warns) == 1, f"warns={len(warns)}")
check("warning 里带次数", warns and "第 1 次" in warns[0].getMessage(),
      warns[0].getMessage() if warns else "")

# ---- 3. 桥恢复后要打一条「恢复」，并且把退避重置
bridge = FakeBridge(fail_times=3)
clock = FakeClock()
eng = make_engine(bridge)
handler = ListHandler()
E.log.addHandler(handler)
E.log.setLevel(logging.DEBUG)
try:
    run_until(eng, clock, max_iters=6)
finally:
    E.log.removeHandler(handler)
infos = [r.getMessage() for r in handler.records if r.levelno == logging.INFO]
check("恢复时打一条 info", any("通话桥恢复" in m and "3 次" in m for m in infos), infos)

# ---- 4. 变异自证：把退避改回恒定 2 秒，用例 1 必须红
src = (HERE.parent / "engine.py").read_text(encoding="utf-8")
marker = "time.sleep(min(30.0, 2.0 * (2 ** min(fail_streak - 1, 4))))"
assert marker in src, "退避语句不见了，变异自证失效"
mut_src = src.replace(marker, "time.sleep(2.0)  # 变异：恒定退避")
mut_path = HERE / "_engine_mut_nobackoff.py"
mut_path.write_text(mut_src, encoding="utf-8")
import importlib.util
spec = importlib.util.spec_from_file_location("engine_mut2", mut_path)
mut = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mut)

bridge = FakeBridge(fail_times=10 ** 6)
clock = FakeClock()
eng = make_engine(bridge)
mut_engine_cls = mut.Engine
eng_mut = mut_engine_cls.__new__(mut_engine_cls)
eng_mut.cfg = {"controlPort": 6110, "whitelist": []}
eng_mut.bridge = bridge
eng_mut.stop_flag = threading.Event()

mut_clock = FakeClock()
base_sleep_mut = mut_clock.sleep


def fake_sleep_mut(s):
    base_sleep_mut(s)
    if len(mut_clock.sleeps) > 8:
        raise _StopMut()


mut.time = mut_clock
mut_clock.sleep = fake_sleep_mut
try:
    eng_mut.run_forever()
except _StopMut:
    pass
finally:
    mut.time = _time
mut_backoffs = [s for s in mut_clock.sleeps if s != 0.8]
check("变异体（恒定 2s）退避序列不再递增", mut_backoffs[:4] != [2.0, 4.0, 8.0, 16.0],
      f"mut_backoffs={mut_backoffs[:5]}")
mut_path.unlink()

print()
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("all polling tests passed ✓")
