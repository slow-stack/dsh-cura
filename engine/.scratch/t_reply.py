
import sys, importlib.util, os, json
spec = importlib.util.spec_from_file_location("eng", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "engine.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class R:
    def __init__(self, code, body):
        self.status_code = code
        self._body = body
        self.text = json.dumps(body) if not isinstance(body, str) else body
    def json(self):
        return self._body

bad = 0
def check(why, fn, want_sub):
    global bad
    try:
        got = fn()
        print("FAIL " + why + " -> returned " + repr(got) + " (expected raise)")
        bad += 1
    except Exception as e:
        ok = want_sub in str(e)
        if not ok: bad += 1
        print(("PASS " if ok else "FAIL ") + why + " -> " + type(e).__name__ + ": " + str(e)[:110])

b = m.Brain({"persona": "test", "llm": {"baseUrl": "http://127.0.0.1:8765/v1", "model": "dsh", "apiKey": "test-key", "allowPrivate": True}})

# 1) 429 + 结构化 error.message：必须把原因带出来
m.httpx.post = lambda *a, **k: R(429, {"error": {"message": "every account is rate-limited for model deepseek-v4.1-flash"}})
check("429 exposes provider reason", lambda: b.reply([{"role":"user","content":"hi"}]), "every account is rate-limited")

# 2) 200 但 content 为空串：必须抛，不能把 '' 交给 TTS
m.httpx.post = lambda *a, **k: R(200, {"choices": [{"message": {"content": ""}}]})
check("empty content rejected", lambda: b.reply([{"role":"user","content":"hi"}]), "空文本")

# 3) 200 但 content 是 None
m.httpx.post = lambda *a, **k: R(200, {"choices": [{"message": {"content": None}}]})
check("null content rejected", lambda: b.reply([{"role":"user","content":"hi"}]), "空文本")

# 4) 200 但 content 只有空白
m.httpx.post = lambda *a, **k: R(200, {"choices": [{"message": {"content": "   \n  "}}]})
check("whitespace-only rejected", lambda: b.reply([{"role":"user","content":"hi"}]), "空文本")

# 5) 正常路径不能被改坏
m.httpx.post = lambda *a, **k: R(200, {"choices": [{"message": {"content": " 我在。 "}}]})
got = b.reply([{"role":"user","content":"hi"}])
ok = got == "我在。"
if not ok: bad += 1
print(("PASS " if ok else "FAIL ") + "normal reply trimmed -> " + repr(got))

print("BAD", bad)
sys.exit(1 if bad else 0)
