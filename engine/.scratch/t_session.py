
import sys, os, importlib.util, numpy as np
spec = importlib.util.spec_from_file_location("eng", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "engine.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

CFG = {
    "persona": "t",
    "llm": {"baseUrl": "http://127.0.0.1:8765/v1", "model": "dsh", "apiKey": "k", "allowPrivate": True},
    "asr": {"model": "small", "language": "zh"},
    "tts": {},
    "audio": {"samplerate": 16000, "channels": 1, "startThreshold": 0.004,
              "stopThreshold": 0.002, "bargeIn": False, "bargeThreshold": 0.02},
    "call": {"goodbyeWords": ["再见"], "idleTimeoutSec": 5, "maxDurationSec": 10},
}
bad = 0
def check(why, cond, extra=""):
    global bad
    if not cond: bad += 1
    print(("PASS " if cond else "FAIL ") + why + (" | " + extra if extra else ""))

class FakeBrain:
    def __init__(self, reply=None, exc=None, text="在的", heard=True):
        self._reply, self._exc, self._text = reply, exc, text
        self._heard = heard
        self.spoken = []
    def transcribe(self, speech, sr): return self._text, self._heard
    def reply(self, history):
        if self._exc: raise self._exc
        return self._reply
    def synthesize(self, text): return np.zeros(0)   # 模拟四层 TTS 全挂

def make(brain):
    s = m.CallSession.__new__(m.CallSession)
    s.cfg, s.bridge, s.call = CFG, None, {"id": "abcd1234-0000"}
    s.call_id = "abcd1234-0000"
    s.history, s.started_at, s.brain = [], 0, brain
    s.llm_fail_streak = 0
    import threading
    s.stop_flag = threading.Event()
    s.thread = None
    s.spoken = []
    def fake_speak(player, rec, text, sr, frames):
        s.spoken.append(text)
    s._speak = fake_speak
    return s

speech = (np.ones(1600, dtype=np.float32) * 0.5)          # 0.1 秒：碎片
speech_long = (np.ones(24000, dtype=np.float32) * 0.5)   # 1.5 秒：够长，值得让对方重说

# 1) 正常路径：user/assistant 都进 history，说的是模型回复
s = make(FakeBrain(reply="我在听"))
keep = s._handle_utterance(None, None, speech, 16000, 160)
check("normal: keeps going", keep is True)
check("normal: reply spoken", s.spoken == ["我在听"], repr(s.spoken))
check("normal: history has both turns",
      [h["role"] for h in s.history] == ["user", "assistant"], repr(s.history))

# 2) LLM 失败：user 轮必须被撤掉，说兜底话术
s = make(FakeBrain(exc=RuntimeError("LLM 429: soft_rate")))
keep = s._handle_utterance(None, None, speech, 16000, 160)
check("failure: call survives", keep is True)
check("failure: history rolled back", s.history == [], repr(s.history))
check("failure: fallback spoken", s.spoken and "卡了一下" in s.spoken[0], repr(s.spoken))

# 3) 失败之后再说一句：history 里不能残留上一句（否则模型以为那是它自己说的）
s = make(FakeBrain(reply="好的"))
s.brain._exc = RuntimeError("boom")
s._handle_utterance(None, None, speech, 16000, 160)
s.brain._exc = None
s._handle_utterance(None, None, speech, 16000, 160)
check("after failure: history starts clean",
      [h["role"] for h in s.history] == ["user", "assistant"], repr(s.history))

# 4) 空转写：不该进 history，也不该调 LLM
s = make(FakeBrain(reply="不该被调用"))
s.brain._text = ""
keep = s._handle_utterance(None, None, speech_long, 16000, 160)
check("empty ASR: history untouched", s.history == [], repr(s.history))
check("empty ASR: asks to repeat", s.spoken and "没听清" in s.spoken[0], repr(s.spoken))

# 4b) 空转写 + VAD 判定没人说话（噪音）：必须沉默，不能回「没听清」
s = make(FakeBrain(reply="不该被调用", heard=False))
s.brain._text = ""
s._handle_utterance(None, None, speech_long, 16000, 160)
check("noise ASR: stays silent", s.spoken == [], repr(s.spoken))

# 4c) 空转写 + 碎片（<1.2s）：也沉默，别为一声咳嗽追问
s = make(FakeBrain(reply="不该被调用"))
s.brain._text = ""
s._handle_utterance(None, None, speech, 16000, 160)
check("fragment ASR: stays silent", s.spoken == [], repr(s.spoken))

# 5) 再见词：结束通话
s = make(FakeBrain(reply="不该被调用"))
s.brain._text = "好了再见"
check("goodbye: ends call", s._handle_utterance(None, None, speech, 16000, 160) is False)

# 6) 连续失败：不能复读同一句（live6 现场就是「卡了一下你再说一遍」×N）
s = make(FakeBrain(exc=RuntimeError("timed out")))
s._handle_utterance(None, None, speech, 16000, 160)
check("streak: 1st says stuck", s.spoken == ["我这边卡了一下，你再说一遍？"], repr(s.spoken))
check("streak: counter is 1", s.llm_fail_streak == 1, repr(s.llm_fail_streak))
s._handle_utterance(None, None, speech, 16000, 160)
check("streak: 2nd changes wording", len(s.spoken) == 2 and "网络" in s.spoken[1], repr(s.spoken))
check("streak: counter is 2", s.llm_fail_streak == 2, repr(s.llm_fail_streak))
check("streak: still alive after 2", s.history == [], repr(s.history))

# 7) 第三次失败：不再发言（沉默 + 退避），但通话不结束
import time as _time
s.spoken = []
_orig_sleep = m.time.sleep
m.time.sleep = lambda sec: None            # 别真睡 6 秒
keep = s._handle_utterance(None, None, speech, 16000, 160)
m.time.sleep = _orig_sleep
check("streak: 3rd stays silent", s.spoken == [], repr(s.spoken))
check("streak: call not ended", keep is True)
check("streak: counter is 3", s.llm_fail_streak == 3, repr(s.llm_fail_streak))

# 8) 恢复成功后 streak 归零（否则下一次偶发失败又直接跳到「沉默」）
s.brain._exc = None
s.brain._reply = "回来了"
s._handle_utterance(None, None, speech, 16000, 160)
check("streak: reset on success", s.llm_fail_streak == 0, repr(s.llm_fail_streak))
check("streak: recovery spoken", s.spoken == ["回来了"], repr(s.spoken))

print("BAD", bad)
sys.exit(1 if bad else 0)
