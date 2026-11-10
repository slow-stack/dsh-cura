# -*- coding: utf-8 -*-
"""QQ 语音通话引擎 —— napcat-qq-voice-call-win 的上层 AI 管线。

职责（Windows 通话桥只管"音频进出"，本引擎管"听懂、思考、说话、挂断"）：
  轮询 6110 控制口事件 → 白名单自动接听 → 虚拟声卡音频 → ASR → DeepSeek → TTS → 挂断

用法：
  python engine.py                # 常驻服务：监控来电 + 自动接听 + 对话
  python engine.py status         # 查看通话桥状态
  python engine.py dial <QQ号>    # 主动拨给某人（接通后同样进入 AI 对话）
  python engine.py hangup         # 主动挂断当前通话
"""

import asyncio
import ipaddress
import json
import logging
import os
import queue
import socket
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
import numpy as np

if sys.platform == "win32":
    import soundcard as sc  # 必须在主线程导入：soundcard 只在导入线程初始化 COM；
    # 之后每个会话线程自行 CoInitializeEx（见 CallSession.run），否则第二通电话必炸
    try:
        import sounddevice as sd  # PortAudio：真麦采集走这条（soundcard 采真麦会失流）
    except Exception:  # 没装也不影响 QQ 回环模式
        sd = None
else:
    sd = None

log = logging.getLogger("qq-call")

HERE = Path(__file__).resolve().parent
CONFIG_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].endswith(".json") else HERE / "config.json"

# LLM 端点安全基线：默认强制 https + 拒绝私网地址（防 SSRF）。
# 配置 llm.allowPrivate: true 可放开私网/环回（用于指向本机 DSH 等本地服务）。


WHISPER_SR = 16000  # faster-whisper 只可靠地吃 16k；其它采样率必须先自己重采样


def _resample_to(pcm: np.ndarray, sr_from: int, sr_to: int) -> np.ndarray:
    """线性插值重采样。对语音识别足够，避免为了 resample 再引一个依赖。"""
    pcm = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if sr_from == sr_to or pcm.size == 0:
        return pcm
    n_out = max(1, int(round(pcm.size * float(sr_to) / float(sr_from))))
    x_old = np.arange(pcm.size, dtype=np.float64)
    x_new = np.linspace(0.0, float(pcm.size - 1), n_out)
    return np.interp(x_new, x_old, pcm).astype(np.float32)


# whisper 在「其实没人说话」的片段上会凭空造句子——最常见的是字幕组署名那类
# （「字幕by索兰娅」「请不吝点赞订阅转发」）。这种文本一旦进了对话，就变成一句莫名其妙
# 的提问，模型还会一本正经地回答一遍，整通电话就歪了。两道闸：置信度闸 + 已知幻觉闸。
_ASR_HALLUCINATIONS = (
    "字幕", "索兰娅", "请不吝", "点赞", "订阅", "转发", "打赏",
    "谢谢观看", "明镜与点点", "amara.org", "字幕提供",
)
_ASR_MIN_AVG_LOGPROB = -1.0   # whisper 的「我有多确定」；低于它基本是硬编出来的
_ASR_MAX_NO_SPEECH = 0.6      # whisper 自己判「这段没有语音」的概率


def _asr_segment_ok(seg) -> bool:
    """单段是否可信。缺字段按可信处理，免得换模型版本就全静音。"""
    try:
        no_speech = float(getattr(seg, "no_speech_prob", 0.0) or 0.0)
    except (TypeError, ValueError):
        no_speech = 0.0
    try:
        logprob = float(getattr(seg, "avg_logprob", 0.0) or 0.0)
    except (TypeError, ValueError):
        logprob = 0.0
    text = str(getattr(seg, "text", "") or "").strip()
    if not text:
        return False
    if no_speech > _ASR_MAX_NO_SPEECH or logprob < _ASR_MIN_AVG_LOGPROB:
        return False
    low = text.lower()
    return not any(bad in low for bad in _ASR_HALLUCINATIONS)


def _join_asr(segments) -> str:
    """只拼可信段落。全被丢掉就返回空串——上层会走「没听清」分支。"""
    return "".join(str(getattr(s, "text", "") or "") for s in segments if _asr_segment_ok(s)).strip()


def _check_llm_url(base_url: str, allow_private: bool = False) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme != "https" and not (allow_private and parsed.scheme == "http"):
        raise ValueError(f"LLM baseUrl 必须是 https（本地服务可开 allowPrivate 用 http），当前: {base_url}")
    host = (parsed.hostname or "").lower()
    if not host:
        raise ValueError(f"LLM baseUrl 缺少主机名: {base_url}")
    if not allow_private:
        for _, _, _, _, sockaddr in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM):
            ip = ipaddress.ip_address(sockaddr[0])
            if not ip.is_global:
                raise ValueError(f"LLM 主机解析到非公网地址 {ip}（如确要指向本机服务，配置 llm.allowPrivate: true）")
    return base_url.rstrip("/")


# ---------------------------------------------------------------- 音频设备判定

# Windows 上"默认设备"经常被虚拟声卡顶掉（VB-Audio / ToDesk / VoiceMeeter 等），
# 选到它们就等于对着空气说话。DSH 内语音必须按名字挑真实设备。
_VIRTUAL_DEVICE_MARKS = (
    "cable", "vb-audio", "virtual", "todesk", "voicemeeter", "loopback",
    "stereo mix", "what u hear", "立体声混音", "virtual audio",
)
_REAL_DEVICE_MARKS = ("麦克风", "microphone", "mic array", "array", "realtek", "headset")


def _looks_virtual(name: str) -> bool:
    low = str(name or "").lower()
    return any(mark in low for mark in _VIRTUAL_DEVICE_MARKS)


# ---------------------------------------------------------------- sounddevice 采集/播放适配
# 为什么不拿 soundcard 采真麦：本机实测，soundcard 打开 Realtek 麦克风阵列后
# 头一两秒有数据，随后整条流归零（关掉重开只能复活一小会儿、且只有十分之一量级）；
# 同一个设备用 PortAudio(MME/WASAPI) 连续采集 70 秒始终有正常电平。
# 另外注意：这块 Realtek 阵列自带回声消除 —— 喇叭里放什么基本不会被采进来，
# 所以「播一段音看麦克风有没有电平」不能用来判断麦克风好坏，会被 AEC 消掉。


class _SdRecorder:
    """把 sounddevice.InputStream 包成 soundcard 的 recorder 形状：record(numframes) → (n, 1)。

    必须走回调式：PortAudio 的 WDM-KS 后端不支持阻塞读（实测抛
    "Blocking API not supported yet [Windows WDM-KS error -9999]"），
    而本机唯一能录到人声的真麦恰好只在 WDM-KS 下可见。
    回调把块丢进队列，record() 从队列里凑够帧数再返回。

    另：WDM-KS 那条阵列必须开 2 声道，1 声道录出来全是 NaN（float→int 转换报
    "invalid value encountered in cast"），所以这里只取第 0 声道，其余声道丢弃。
    """

    def __init__(self, device, samplerate: int, channels: int, blocksize: int, gain: float = 1.0):
        self.device, self.samplerate = device, int(samplerate)
        self.channels, self.blocksize = max(int(channels), 1), max(int(blocksize), 1)
        self.gain = float(gain)
        self._stream = None
        self._queue: "queue.Queue" = queue.Queue(maxsize=256)
        self._pending = np.zeros(0, dtype=np.float32)

    def _callback(self, indata, frames, time_info, status):
        try:
            self._queue.put_nowait(indata[:, 0].copy())
        except queue.Full:
            pass  # 下游卡住时宁可丢块，也不能让 PortAudio 回调里阻塞

    def __enter__(self):
        self._stream = sd.InputStream(device=self.device, samplerate=self.samplerate,
                                      channels=self.channels, dtype="float32",
                                      blocksize=self.blocksize, callback=self._callback)
        self._stream.start()
        return self

    def __exit__(self, *exc):
        try:
            self._stream.stop()
            self._stream.close()
        except Exception:
            pass
        return False

    def drain(self) -> int:
        """丢掉队列里积压的块，返回丢掉的采样数。

        存在的理由：播放 TTS 期间麦克风一直在录，录到的是自己的漏音。
        不排空的话下一轮 _record_utterance 会把这段漏音当对方说话，
        于是「自己说一句 → 听见自己 → 再回一句」变成无限复读。
        """
        dropped = int(self._pending.size)
        self._pending = np.zeros(0, dtype=np.float32)
        while True:
            try:
                chunk = self._queue.get_nowait()
            except queue.Empty:
                break
            dropped += int(chunk.size)
        return dropped

    def record(self, numframes: int):
        need = max(int(numframes), 1)
        deadline = time.monotonic() + 3.0
        while self._pending.size < need:
            try:
                self._pending = np.concatenate([self._pending, self._queue.get(timeout=0.2)])
            except queue.Empty:
                if time.monotonic() > deadline:
                    log.warning("录音流 3 秒没有新数据（设备被独占？），本次用静音填充")
                    pad = np.zeros(need - self._pending.size, dtype=np.float32)
                    self._pending = np.concatenate([self._pending, pad])
                    break
        out, self._pending = self._pending[:need], self._pending[need:]
        if self.gain != 1.0:
            out = np.clip(out * self.gain, -1.0, 1.0)
        return out.reshape(-1, 1)


class _SdPlayer:
    """把 sounddevice.OutputStream 包成 soundcard 的 player 形状：play(block)。"""

    def __init__(self, device, samplerate: int, out_channels: int):
        self.device, self.samplerate = device, int(samplerate)
        self.out_channels = max(int(out_channels), 1)
        self._stream = None

    def __enter__(self):
        self._stream = sd.OutputStream(device=self.device, samplerate=self.samplerate,
                                       channels=self.out_channels, dtype="float32")
        self._stream.start()
        return self

    def __exit__(self, *exc):
        try:
            self._stream.stop()
            self._stream.close()
        except Exception:
            pass
        return False

    def play(self, block):
        b = np.asarray(block, dtype=np.float32)
        if b.ndim == 1:
            b = b.reshape(-1, 1)
        if b.shape[1] != self.out_channels:
            b = np.repeat(b[:, :1], self.out_channels, axis=1)
        self._stream.write(b)  # 阻塞写：天然按实时节奏推进，不会像排队式 play() 那样积压


class _SdDevice:
    """一个 PortAudio 设备，形状对齐 soundcard 的 Microphone/Speaker（供 run() 直接用）。"""

    def __init__(self, index: int, name: str, hostapi: str, kind: str):
        self.index, self.name, self.hostapi, self.kind = index, name, hostapi, kind
        self.gain = 1.0  # 采集软件增益，由 _calibrate_thresholds 按实测底噪设定

    def set_gain(self, gain: float):
        self.gain = float(gain)

    def __repr__(self):
        return f"<{self.kind} {self.name!r} [{self.hostapi}] #{self.index}>"

    def recorder(self, samplerate: int, channels: int, blocksize: int = 0):
        return _SdRecorder(self.index, samplerate, channels,
                           blocksize or int(samplerate) // 20, self.gain)

    def player(self, samplerate: int, channels: int):
        return _SdPlayer(self.index, samplerate, channels)


def _probe_input(index: int, seconds: float = 0.8) -> dict | None:
    """开 0.5 秒回调流，量一下这个设备到底是活的还是死的。

    为什么必须实测而不是看名字：本机有一条 WDM-KS 设备叫「麦克风 ()」，
    RMS 高达 0.106、看着最像好麦，实际频谱全在 0~13 Hz（直流漂移），
    录进去只有嗡嗡声。所以用「过零率」把这种假信号筛掉：
    真人声的过零率在 0.02~0.2，直流漂移 < 0.002，纯抖动噪声反而很高。
    """
    info = sd.query_devices(index)
    sr = int(info["default_samplerate"])
    ch = min(2, max(1, int(info["max_input_channels"])))
    got: list = []

    def cb(indata, frames, tinfo, status):
        got.append(indata[:, 0].copy())

    try:
        with sd.InputStream(device=index, samplerate=sr, channels=ch, dtype="float32",
                            blocksize=int(sr * 0.05), callback=cb):
            time.sleep(seconds)
    except Exception as e:
        log.warning("探测录音设备 #%s 失败: %s", index, e)
        return None
    if not got:
        return None
    pcm = np.concatenate(got).astype(np.float32)
    # WDM-KS 开流头一两百毫秒有启动瞬态（本机实测同一设备两次探测 zcr 能差 20 倍），
    # 丢掉前 0.2s 再量，否则探测结果不可复现。
    drop = min(int(0.2 * sr), pcm.size // 2)
    pcm = pcm[drop:]
    if pcm.size == 0 or not np.all(np.isfinite(pcm)):
        return None
    peak = float(np.abs(pcm).max())
    rms = float(np.sqrt(np.mean(pcm ** 2)))
    sign = np.signbit(pcm)
    zcr = float(np.count_nonzero(sign[1:] != sign[:-1])) / max(1, pcm.size - 1)
    return {"sr": sr, "ch": ch, "peak": peak, "rms": rms, "zcr": zcr}


def _pick_sd_device(name_hint, kind: str):
    """按名字挑 PortAudio 设备，返回 (index, name, hostapi)。

    录音设备的挑法本机实测出来是反直觉的，这里按实测结论排序：
    1. 同一只 Realtek 阵列，MME/DirectSound/WASAPI 三个后端录到的电平只有 ±2 LSB
       （等于聋），只有 WDM-KS 后端是活的 —— 所以真麦优先 WDM-KS；
    2. WDM-KS 后端不支持阻塞读，必须走回调（_SdRecorder 已改）；
    3. 名字最像好麦的那条「麦克风 ()」是直流漂移假信号，靠过零率筛掉。
    播放设备反过来：WDM-KS 的阻塞写不稳，优先挑非 WDM-KS 的。
    """
    if sd is None:
        raise RuntimeError("没装 sounddevice，无法用 PortAudio 采真麦（pip install sounddevice）")
    devs = sd.query_devices()
    apis = [sd.query_hostapis(i)["name"] for i in range(len(sd.query_hostapis()))]
    want_in = kind == "mic"
    cands = []
    for i, d in enumerate(devs):
        if want_in and d["max_input_channels"] < 1:
            continue
        if not want_in and d["max_output_channels"] < 1:
            continue
        cands.append((i, str(d["name"]), apis[int(d["hostapi"])]))
    if not cands:
        raise RuntimeError(f"没找到任何可用的{'录音' if want_in else '播放'}设备")

    if name_hint:
        low = str(name_hint).lower()
        hit = next((c for c in cands if low in c[1].lower()), None)
        if hit:
            return hit
        log.warning("配置的 %r 没匹配到任何 PortAudio 设备，改为自动挑选", name_hint)

    real = [c for c in cands if not _looks_virtual(c[1])]
    if not want_in:
        real.sort(key=lambda c: "WDM-KS" in c[2])  # 播放：WDM-KS 排最后
        for mark in _REAL_DEVICE_MARKS:
            hit = next((c for c in real if mark in c[1].lower()), None)
            if hit:
                return hit
        return real[0] if real else cands[0]

    # ---- 录音：先按名字初筛，再逐个实测，最后按「活着 + 电平」挑 ----
    named = [c for c in real if any(m in c[1].lower() for m in _REAL_DEVICE_MARKS)]
    pool = named or real
    pool = sorted(pool, key=lambda c: ("WDM-KS" not in c[2], c[0]))[:6]
    best, best_score = None, -1.0
    for idx, name, api in pool:
        p = _probe_input(idx)
        if p is None:
            continue
        # 判活的依据必须是「电平」，不能是过零率：静音时 WDM-KS 几乎全零，zcr≈0，
        # 拿 zcr 当门槛会把唯一能用的设备判死（本机实测就踩过：真麦被跳过，
        # 反而选上 MME 那条只有 ±1 LSB 抖动的死设备）。
        # 本机电平参照：WDM-KS 真麦底噪 peak≈5e-3；MME 死设备 peak≈3e-5，差两个数量级。
        alive = p["peak"] >= 3e-4
        # 反过来，大信号但过零率近乎为零 = 直流漂移（本机 #43「麦克风 ()」就是这样），要排除。
        if alive and p["peak"] > 0.02 and p["zcr"] < 0.002:
            alive = False
        # 打分：活着的设备按电平排；死的设备给负分，只在全都没救时才用
        # 同样活着时优先 WDM-KS：MME/WASAPI 那几条就算能开流，电平也低两个数量级。
        score = (p["rms"] * (2.0 if "WDM-KS" in api else 1.0)) if alive else -1.0
        log.info("录音设备候选 #%s %s [%s] peak=%.6f rms=%.6f zcr=%.4f %s",
                 idx, name, api, p["peak"], p["rms"], p["zcr"],
                 "可用" if alive else "无有效信号，跳过")
        if score > best_score:
            best, best_score = (idx, name, api), score
    if best is not None and best_score >= 0:
        return best
    if best is not None:
        log.warning("所有录音设备都只录到直流/静音，勉强使用 #%s %s", best[0], best[1])
        return best
    raise RuntimeError(f"没找到可用的录音设备；现有: {[c[1] for c in cands]}")


# ---------------------------------------------------------------- 配置

def load_config() -> dict:
    if not CONFIG_PATH.exists():
        sys.exit(f"找不到配置文件 {CONFIG_PATH}；请先复制 config.example.json 为 config.json 并填写")
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    cfg["token"] = Path(cfg["tokenFile"]).read_text(encoding="utf-8").strip()
    return cfg


# ---------------------------------------------------------------- 通话桥控制客户端（6110）

class Bridge:
    """napcat-qq-voice-call-win 控制口的最小封装。

    API 契约（上游 KoishiRTC 的桥接协议 v1）：
      GET  /v1/events?after=<seq>&bootId=<id>      游标事件流，事件形如 {seq, type, call:{...}}
      GET  /v1/calls/current                        当前通话快照（无通话时 data 为 null）
      POST /v1/calls/accept  {requestId, callId}   仅 ringing 阶段可接
      POST /v1/calls/reject  {requestId, callId}
      POST /v1/calls/hangup  {requestId, callId}
      POST /v1/calls/dial    {requestId, peerUin, media:"audio"}   peerUin 必须是数字字符串
    全部 POST 要求 requestId 稳定（幂等键）；accept/hangup 必带 callId。
    """

    def __init__(self, port: int, token: str):
        self.base = f"http://127.0.0.1:{port}"  # 环回地址写死，不从配置读
        self.headers = {"Authorization": f"Bearer {token}"}
        self._counter = 0

    def _request_id(self, tag: str) -> str:
        self._counter += 1
        return f"engine-{tag}-{int(time.time() * 1000)}-{self._counter}"

    def _post(self, path: str, body: dict, tag: str):
        body = {"requestId": self._request_id(tag), **body}
        r = httpx.post(f"{self.base}{path}", json=body, headers=self.headers, timeout=15)
        data = r.json()
        if not r.is_success or not data.get("ok"):
            raise RuntimeError(f"{path} 失败: {data}")
        return data.get("data") or {}

    def events(self, after: int, boot_id: str | None):
        params = {"after": max(0, after)}
        if boot_id:
            params["bootId"] = boot_id
        r = httpx.get(f"{self.base}/v1/events", params=params, headers=self.headers, timeout=10)
        r.raise_for_status()
        return r.json()["data"]

    def current(self):
        r = httpx.get(f"{self.base}/v1/calls/current", headers=self.headers, timeout=10)
        r.raise_for_status()
        return r.json()["data"]

    def accept(self, call_id: str):
        return self._post("/v1/calls/accept", {"callId": call_id}, "accept")

    def reject(self, call_id: str):
        return self._post("/v1/calls/reject", {"callId": call_id}, "reject")

    def hangup(self, call_id: str):
        return self._post("/v1/calls/hangup", {"callId": call_id}, "hangup")

    def dial(self, peer_uin: str):
        if not (peer_uin.isdigit() and 5 <= len(peer_uin) <= 16):
            raise ValueError("peerUin 必须是 5-16 位数字字符串")
        return self._post("/v1/calls/dial", {"peerUin": peer_uin, "media": "audio"}, "dial")


# ---------------------------------------------------------------- ASR / LLM / TTS

class Brain:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self._whisper = None
        llm = cfg["llm"]
        self._llm_base = _check_llm_url(llm.get("baseUrl", "https://api.deepseek.com"),
                                        bool(llm.get("allowPrivate", False)))

    def _load_whisper(self):
        if self._whisper is None:
            from faster_whisper import WhisperModel
            asr = self.cfg["asr"]
            device = asr.get("device", "auto")
            compute = {"cuda": "float16", "cpu": "int8"}.get(device, "int8")
            log.info("加载 faster-whisper 模型 %s（device=%s，首次会下载）...", asr["model"], device)
            self._whisper = WhisperModel(asr["model"], device=device, compute_type=compute)
        return self._whisper

    def transcribe(self, pcm_mono: np.ndarray, samplerate: int):
        """返回 (文本, whisper 是否听到了语音)。

        第二个值用来区分两种「空文本」：
          - VAD 把整段判成静音（没人说话/只是噪声）→ 不该回「没听清」，沉默即可；
          - 有语音段但全被置信度/幻觉闸丢掉 → 值得让用户再说一遍。
        分不开就会变成复读机：一次咳嗽也回一句「你再说一遍？」。
        """
        if pcm_mono.size < samplerate * 0.2:
            return "", False
        # faster-whisper 对「传 numpy + 非 16k 采样率」的处理不可靠：44.1k 直接喂进去
        # 会把「我在，请讲。今天复习到哪了」听成「我在下今天呼吸高滿」。必须自己先重采样到 16k。
        audio = _resample_to(pcm_mono, samplerate, WHISPER_SR)
        segments, _ = self._load_whisper().transcribe(
            audio, language=self.cfg["asr"].get("language", "zh"),
            condition_on_previous_text=False, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )
        # 逐段过置信度/幻觉闸，而不是无条件拼接（见 _join_asr 的注释）。
        # 注意 segments 是生成器：先 list() 落地，否则下面想记原始文本时它已经空了。
        segments = list(segments)
        text = _join_asr(segments)
        if not text:
            raw = "".join(s.text for s in segments).strip()
            if raw:
                log.info("ASR 丢弃疑似幻觉: %r", raw[:60])
        return text, bool(segments)

    def _system_prompt(self) -> str:
        """人设 + 当前时间。

        模型自己没有时钟：不告诉它，问「现在几点」它会凭空编一个
        （实测编成「晚上九点四十多」「九月十六号」，而真实时间是中午）。
        时间每轮现算，长通话里也不会停在开场那一刻。
        """
        now = time.localtime()
        weekday = "一二三四五六日"[now.tm_wday]
        clock = (f"现在是 {now.tm_year} 年 {now.tm_mon} 月 {now.tm_mday} 日 "
                 f"星期{weekday} {now.tm_hour:02d}:{now.tm_min:02d}。")
        return f"{self.cfg['persona']}\n\n{clock}（问时间或日期就照此回答，不要猜。）"

    def reply(self, history: list[dict]) -> str:
        llm = self.cfg["llm"]
        api_key = llm.get("apiKey") or os.environ.get("LLM_API_KEY", "")
        if not api_key:
            raise RuntimeError("缺少 LLM API key：请在 config.json 填 llm.apiKey 或设 LLM_API_KEY 环境变量")
        payload = {
            "model": llm.get("model", "deepseek-chat"),
            "messages": [{"role": "system", "content": self._system_prompt()}] + history[-int(llm.get("maxHistory", 20)):],
            "temperature": float(llm.get("temperature", 0.8)),
            "max_tokens": 300,  # 语音对话回复要短
        }
        # 代理侧自己有总预算（默认 25 秒），这里只做兜底。
        # 原来给 60 秒，等于代理一旦整段卡死，对方要干等整整一分钟才听到一句「卡了一下」。
        r = httpx.post(f"{self._llm_base}/chat/completions",
                       headers={"Authorization": f"Bearer {api_key}"},
                       json=payload, timeout=float(llm.get("timeoutSec", 40)))
        if r.status_code >= 400:
            # 代理层失败会把 provider 的失败原因放在 body 里，别只留一个状态码
            detail = ""
            try:
                detail = str(r.json().get("error", {}).get("message", ""))[:200]
            except Exception:
                detail = r.text[:200]
            raise RuntimeError(f"LLM {r.status_code}: {detail}")
        content = r.json()["choices"][0]["message"]["content"]
        content = (content or "").strip()
        if not content:
            # 空串绝不能流进 TTS：四层合成会全炸，最后播 0.5s 空音，对方听到的是死寂。
            # 抛出去让上层用一句兜底话术接住。
            raise RuntimeError("LLM 返回空文本")
        return content

    async def _synthesize(self, text: str) -> bytes:
        import edge_tts
        tts = self.cfg["tts"]
        communicate = edge_tts.Communicate(text, tts.get("voice", "zh-CN-XiaoxiaoNeural"),
                                           rate=tts.get("rate", "+0%"))
        chunks = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        return b"".join(chunks)

    def synthesize(self, text: str) -> np.ndarray:
        """TTS 四保险：火山复刻夏以昼（首选）→ 阿里云 qwen-tts → edge-tts 重试 2 次 → SAPI 兜底。"""
        import io
        import soundfile as sf
        target = self.cfg["audio"]["samplerate"]

        # Tier -1: 火山复刻音色（夏以昼声线，经 dsh-qq-anima/tts-volc.py）
        try:
            import subprocess
            volc_out = Path(self.cfg["audio"].get("workdir", tempfile.gettempdir())) / f"volc-{int(time.time())}.mp3"
            subprocess.run(
                [sys.executable, r"D:\dsh-qq-anima\tts-volc.py", "--text", text, "--out", str(volc_out)],
                timeout=120, capture_output=True, check=True,
            )
            if volc_out.exists() and volc_out.stat().st_size > 1000:
                audio, sr = sf.read(str(volc_out), dtype="float32")
                volc_out.unlink(missing_ok=True)
                if sr != target:
                    idx = np.linspace(0, max(len(audio) - 1, 1), int(len(audio) * target / sr))
                    audio = np.interp(idx, np.arange(len(audio)), audio).astype(np.float32)
                if audio.ndim > 1:
                    audio = audio.mean(axis=1)
                log.info("TTS: 火山复刻音色 (%d 帧)", len(audio))
                return audio
        except FileNotFoundError:
            pass
        except Exception as e:
            log.warning("火山复刻 TTS 失败，落回下一层: %s", e)

        # Tier 0: 阿里云 qwen-audio-3.0-tts-plus（男声 longanlufeng，key 来自 dsh-qq-anima）
        try:
            key_path = Path(r"D:\dsh-qq-anima\.key")
            if key_path.exists():
                key = key_path.read_text(encoding="utf-8-sig").strip()
                r = httpx.post(
                    "https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
                    headers={"Authorization": f"Bearer {key}"},
                    json={"model": "qwen-audio-3.0-tts-plus",
                          "input": {"text": text, "voice": "longanlufeng"}},
                    timeout=60,
                )
                url = ((r.json().get("output") or {}).get("audio") or {}).get("url")
                if url:
                    wav_bytes = httpx.get(url, timeout=60).content
                    audio, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32")
                    if sr != target:
                        idx = np.linspace(0, max(len(audio) - 1, 1), int(len(audio) * target / sr))
                        audio = np.interp(idx, np.arange(len(audio)), audio).astype(np.float32)
                    log.info("TTS: qwen-audio-3.0-tts-plus (%d 帧)", len(audio))
                    return audio
        except Exception as e:
            log.warning("qwen-tts 失败，落回 edge-tts: %s", e)

        last_err = None
        for attempt in range(2):
            try:
                mp3 = asyncio.run(self._synthesize(text))
                audio, sr = sf.read(io.BytesIO(mp3), dtype="float32")
                if sr != target:
                    idx = np.linspace(0, max(len(audio) - 1, 1), int(len(audio) * target / sr))
                    audio = np.interp(idx, np.arange(len(audio)), audio).astype(np.float32)
                return audio
            except Exception as e:
                last_err = e
                log.warning("edge-tts 失败（第 %d 次）: %s", attempt + 1, e)
                time.sleep(1)
        log.warning("edge-tts 两次均失败，改用 Windows 离线语音兜底")
        try:
            return self._sapi_pcm(text, target)
        except Exception as e:
            log.error("离线兜底 TTS 也失败: %s", e)
            return np.zeros(int(0.5 * target), dtype=np.float32)

    def _sapi_pcm(self, text: str, target_sr: int) -> np.ndarray:
        """Windows 自带 SAPI 语音合成（离线，无需网络）。经 PowerShell 生成 wav 后加载。"""
        import subprocess
        import tempfile
        import os
        import soundfile as sf
        out_wav = os.path.join(tempfile.gettempdir(), f"qqcall-sapi-{os.getpid()}.wav")
        ps_script = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$s.SetOutputToWaveFile('" + out_wav.replace("\\", "\\\\").replace("'", "''") + "'); "
            "try { $s.SelectVoice('Microsoft Huihui Desktop') } catch {}; "
            "$s.Speak(@'\n" + text + "\n'@)"
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", ps_script],
                       timeout=60, capture_output=True)
        audio, sr = sf.read(out_wav, dtype="float32")
        os.remove(out_wav)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != target_sr:
            idx = np.linspace(0, max(len(audio) - 1, 1), int(len(audio) * target_sr / sr))
            audio = np.interp(idx, np.arange(len(audio)), audio).astype(np.float32)
        return audio


# ---------------------------------------------------------------- 通话会话（音频 + 对话循环）

class CallSession:
    """一通接通的电话：听 → 想 → 说，直到挂断/超时/说再见。"""

    def __init__(self, cfg: dict, bridge: Bridge, call: dict):
        self.cfg, self.bridge, self.call = cfg, bridge, call
        self.call_id = call["id"]
        self.history: list[dict] = []
        # 大脑连续失败计数：用来区分「偶发一次」和「整段挂了」，
        # 前者照常让对方重说，后者必须换话术并拉开间隔，否则就是复读机。
        self.llm_fail_streak = 0
        self.started_at = time.time()
        self.brain = Brain(cfg)
        self.stop_flag = threading.Event()
        self.thread = threading.Thread(target=self.run, name=f"call-{self.call_id[:8]}", daemon=True)

    def start(self):
        self.thread.start()

    # ---- 音频设备 ----

    def _find_capture(self, audio: dict):
        """获取'耳朵'：captureMode=loopback 时环回捕获 QQ 实际播放端点（不依赖 cmd102/默认设备）。
        captureDevice="default" 时环回系统默认播放设备（QQ 播放跟随默认设备）。
        captureDevice="__real_mic__" 时用真实麦克风（DSH 内语音对话模式）。"""
        if audio.get("captureDevice") == "__real_mic__":
            return self._find_real_devices()[0]
        if audio.get("captureMode") == "loopback":
            if audio.get("captureDevice", "").lower() == "default":
                spk = sc.default_speaker()
            else:
                spk = self._find_device([audio["captureDevice"]], "spk")
            mic = sc.get_microphone(spk.id, include_loopback=True)
            if mic is None:
                raise RuntimeError(f"无法对 {spk.name} 建立环回捕获")
            log.info("耳朵模式: loopback ← %s", spk.name)
            return mic
        return self._find_device([audio["captureDevice"]], "mic")

    def _find_render(self, audio: dict):
        """获取'嘴巴'的播放端：__real_spk__ = 真实扬声器（DSH 内语音对话模式）。"""
        if audio.get("renderDevice") == "__real_spk__":
            return self._find_real_devices()[1]
        return self._find_device([audio["renderDevice"], "CABLE Input"], "spk")

    def _calibrate_thresholds(self, mic, sr: int, channels: int, frames: int):
        """DSH 真麦模式：先听一段底噪，再按底噪定起止门限。

        换设备是治不好的——不同麦克风的灵敏度能差两个数量级，写死 0.004 在
        本机真麦上要么听不见（太钝），要么被自己 TTS 的漏音打断（太灵）。
        这里在开口前实测一次底噪，把门限推到「底噪之上、人声之下」。
        """
        audio = self.cfg["audio"]
        if not audio.get("adaptiveThreshold"):
            return
        levels = []
        try:
            with mic.recorder(samplerate=sr, channels=channels) as rec:
                # WDM-KS 开流后的启动瞬态不止 0.4s：实测同一台机器同一条麦，
                # 标定出的底噪在 0.0026~0.0262 之间跳十倍，跳上去的那几次就是
                # 采样窗还落在瞬态里。所以先丢 1.2s 再采 1s，宁可多等半秒。
                for _ in range(24):
                    rec.record(numframes=frames)
                for _ in range(20):  # 20 × 50ms = 1.0s
                    mono = rec.record(numframes=frames).mean(axis=1)
                    levels.append(float(np.sqrt(np.mean(mono ** 2))))
        except Exception as e:
            log.warning("底噪标定失败，沿用配置门限: %s", e)
            return
        # 取低位分位而不是中位数：噪声是间歇的（风扇一阵、椅子一声），
        # 真实底噪是这段里最安静的那些块，取低分位才不被偶发噪声抬走。
        floor = float(np.percentile(levels, 30)) if levels else 0.0
        # 这里的 levels 已经过软件增益（_SdRecorder 内乘过 gain），所以门限也在增益后的域里算。
        # 本机实测（增益×10）：静音 rms≈2e-3，说话 rms≈8e-3~1.6e-2、峰值 1.3e-1。
        raw = floor * 2.5 + 0.0008
        # 硬上限 0.012：原来封顶 0.05，一旦底噪标到 0.025 就把门限顶到 0.05，
        # 而人声只有 8e-3~1.6e-2——整通电话一个字都听不见，且自己不会回头。
        # 宁可门限偏低被噪声误触发（ASR 那边有 no_speech 闸会丢掉），也不能聋。
        start = min(0.012, max(0.0025, raw))
        stop = max(0.0012, start * 0.4)
        audio["startThreshold"] = start
        audio["stopThreshold"] = stop
        log.info("自适应门限: 底噪 p30=%.5f / max=%.5f → 起 %.4f 止 %.4f%s",
                 floor, max(levels) if levels else 0.0, start, stop,
                 "（已封顶 0.012）" if raw > 0.012 else "")
        if raw > 0.012:
            log.warning("标定底噪偏高（p30=%.4f），门限已按上限 0.012 封顶；"
                        "若仍听不见，说明房间常驻噪音太大，先处理噪音源", floor)

    def _find_real_devices(self):
        """DSH 内语音对话模式：真实麦克风 + 真实扬声器。

        两层坑都在这：
        1. Windows "默认设备"经常被虚拟声卡顶掉（本机默认录音是 VB-Audio，RMS 恒 0）；
        2. 就算挑对了真麦，soundcard 采它在 1~2 秒后整条流归零（本机实测复现多次）。
        所以这里改用 PortAudio(sounddevice) 采真麦，只保留「按名字挑真实设备」这套判断。
        """
        # 缓存：_find_capture 与 _find_render 各调一次，不缓存就会把整轮设备探测
        # （每条 0.8s）跑两遍，而且两次结果可能不一样——耳朵和嘴巴会来自不同次探测。
        cached = getattr(self, "_real_devices", None)
        if cached is not None:
            return cached
        audio = self.cfg["audio"]
        mi, mname, mhost = _pick_sd_device(audio.get("dshMicName"), "mic")
        si, sname, shost = _pick_sd_device(audio.get("dshSpkName"), "spk")
        mic = _SdDevice(mi, mname, mhost, "mic")
        spk = _SdDevice(si, sname, shost, "spk")
        # 本机真麦（WDM-KS 后端）电平只有正常值的 1/10 左右：安静时 rms≈2e-4，
        # 说话时 rms≈8e-4~1.6e-3、峰值 1.3e-2。不放大，能量 VAD 永远够不到门限。
        mic.set_gain(float(audio.get("dshMicGain", 10.0)))
        log.info("DSH 语音对话设备: 麦 %s [%s] 增益×%.1f / 放 %s [%s]",
                 mname, mhost, mic.gain, sname, shost)
        if _looks_virtual(mname):
            log.warning("录到的麦克风看着是虚拟设备（%s），大概率收不到人声；"
                        "用 audio.dshMicName 指定真实麦克风", mname)
        self._real_devices = (mic, spk)
        return mic, spk

    def _pick_real(self, name_hint, kind: str):
        """挑一个真实设备：显式指定 > 排除虚拟设备后按真实特征 > 系统默认。"""
        import soundcard as sc
        devs = sc.all_microphones() if kind == "mic" else sc.all_speakers()
        label = "录音" if kind == "mic" else "播放"
        if name_hint:
            hit = next((d for d in devs if str(name_hint).lower() in d.name.lower()), None)
            if hit is not None:
                return hit
            log.warning("配置的 dsh%sName=%r 没匹配到任何%s设备，改为自动挑选；现有: %s",
                        "Mic" if kind == "mic" else "Spk", name_hint, label,
                        [d.name for d in devs])
        real = [d for d in devs if not _looks_virtual(d.name)]
        for mark in _REAL_DEVICE_MARKS:
            hit = next((d for d in real if mark in d.name.lower()), None)
            if hit is not None:
                return hit
        if real:
            return real[0]
        fallback = sc.default_microphone() if kind == "mic" else sc.default_speaker()
        log.warning("没找到任何非虚拟%s设备，退回系统默认: %s", label, fallback.name)
        return fallback

    def _find_device(self, names: list[str], kind: str):
        all_devs = sc.all_microphones() if kind == "mic" else sc.all_speakers()
        for name in names:
            for dev in all_devs:
                if name.lower() in dev.name.lower():
                    return dev
        raise RuntimeError(
            f"找不到{'录音' if kind == 'mic' else '播放'}设备 {names}；现有: {[d.name for d in all_devs]}")

    # ---- 主循环 ----

    def run(self):
        if sys.platform == "win32":  # soundcard/WASAPI 需要线程上有 COM
            import ctypes
            try:
                ctypes.windll.ole32.CoInitializeEx(None, 0x0)  # COINIT_MULTITHREADED
            except Exception:
                pass
        audio = self.cfg["audio"]
        sr = audio["samplerate"]
        frames = sr * 50 // 1000  # 50ms 一块
        idle_deadline = time.time() + self.cfg["call"]["idleTimeoutSec"]
        started = time.time()

        try:
            mic = self._find_capture(audio)
            spk = self._find_render(audio)
            self._calibrate_thresholds(mic, sr, audio["channels"], frames)
            with mic.recorder(samplerate=sr, channels=audio["channels"]) as rec, \
                 spk.player(samplerate=sr, channels=audio["channels"]) as player:
                log.info("[%s] 音频就绪（录:%s / 放:%s）", self.call_id[:8], mic.name, spk.name)
                if self.cfg.get("greeting"):
                    self._speak(player, rec, self.cfg["greeting"], sr, frames)

                while not self.stop_flag.is_set():
                    if time.time() - started > self.cfg["call"]["maxDurationSec"]:
                        self._speak(player, rec, "聊了很久啦，先挂啦，拜拜～", sr, frames)
                        break
                    seg_start = time.time()
                    speech = self._record_utterance(rec, sr, frames, seg_start + self.cfg["call"]["idleTimeoutSec"])
                    if self.stop_flag.is_set():
                        break
                    if speech is None:  # 等待期内无说话 → 主动告别挂断
                        self._speak(player, rec, "你不在吗？那我先挂啦，拜拜～", sr, frames)
                        break
                    if not isinstance(speech, np.ndarray) or speech.size == 0:
                        continue
                    if not self._handle_utterance(player, rec, speech, sr, frames):
                        break  # 对方说再见
        except Exception:
            log.exception("[%s] 会话异常", self.call_id[:8])
        finally:
            self._safe_hangup()
            self._write_transcript_to_dsh()

    def _write_transcript_to_dsh(self):
        """通话结束后，把记录以 OneBot 消息事件写入 dsh-onebot 注入通道，
        进入 DSH 真实会话管线（供 agent 记忆与 DSH 界面显示）。"""
        if not self.history:
            return
        inject_file = self.cfg.get("injectFile")
        if not inject_file:
            return
        peer = str(self.call.get("peerUin") or self.call.get("callerUin") or "")
        if not peer.isdigit():
            return
        dur = int(time.time() - self.started_at)
        lines = [f"【自动记录】刚才的语音通话（{dur // 60}分{dur % 60}秒）："]
        for m in self.history:
            who = "我说" if m["role"] == "user" else "你回复"
            lines.append(f"{who}：{m['content']}")
        stamp = time.strftime("%m-%d %H:%M", time.localtime())
        lines.append(
            "（通话存档结束。请现在用 memory_save 把这次通话记进长期记忆："
            f"type=history，title=「语音通话 {stamp}」，tags=[\"语音通话\"]，"
            "importance=3，content 用三五句概括聊了什么、定下或约定了什么；"
            "其余内容不必复述。）"
        )
        text = "\n".join(lines)
        event = {
            "time": int(time.time()), "self_id": 2237170771,
            "post_type": "message", "message_type": "private", "sub_type": "friend",
            "message_id": int(time.time()) % 10**9, "user_id": int(peer),
            "message": [{"type": "text", "data": {"text": text}}],
            "raw_message": text, "font": 0,
            "sender": {"user_id": int(peer), "nickname": "通话记录", "sex": "unknown", "age": 0},
        }
        try:
            os.makedirs(os.path.dirname(inject_file), exist_ok=True)
            with open(inject_file, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(event, ensure_ascii=False) + "\n")
            log.info("通话记录已写入 DSH 注入通道（%d 轮对话）", len(self.history) // 2)
        except Exception as e:
            log.warning("通话记录注入失败: %s", e)

    def _handle_utterance(self, player, rec, speech: np.ndarray, sr: int, frames: int) -> bool:
        """转写→回复→播放。返回 False 表示该结束通话。"""
        # 真麦录到的电平常常远小于 0 dBFS，whisper 自带 VAD 会把整段当静音。
        # 这里按峰值归一化（VAD 判的是归一化之前的原始电平，不受影响）。
        peak = float(np.max(np.abs(speech))) if speech.size else 0.0
        if 0 < peak < 0.3:
            speech = np.clip(speech * min(30.0, 0.9 / peak), -1.0, 1.0)
        text, heard = self.brain.transcribe(speech, sr)
        dur = speech.size / float(sr)
        log.info("[%s] 对方(%.1fs, 有语音=%s): %s", self.call_id[:8], dur, heard, text or "（没听清）")
        if not text:
            # 两种空文本要分开处理，否则就成了复读机：
            #   heard=False → whisper 的 VAD 判定这段压根没人说话（咳嗽、键盘、关门声）。
            #                 这种沉默着等下一句就好，回「没听清」等于对噪音应答。
            #   heard=True  → 确实有人声，但被置信度/幻觉闸丢了，或太短转不出（<1.2s
            #                 的碎片几乎必然如此）。只有够长的句子才值得让用户重说。
            if not heard:
                log.info("[%s] %.1fs 无语音段（噪声），静默跳过", self.call_id[:8], dur)
            elif dur >= 1.2:
                self._speak(player, rec, "呃，没听清，你再说一遍？", sr, frames)
            else:
                log.info("[%s] 碎片 %.1fs 转不出字，静默跳过", self.call_id[:8], dur)
            return True
        if any(w in text for w in self.cfg["call"]["goodbyeWords"]):
            self._speak(player, rec, self.cfg.get("farewell", "拜拜～"), sr, frames)
            return False
        self.history.append({"role": "user", "content": text})
        try:
            answer = self.brain.reply(self.history)
        except Exception as e:
            log.error("DeepSeek 调用失败: %s", e)
            # 失败的话不能留在 history 里：下一轮模型会以为上句是自己说过的，
            # 而且一句「网络有问题」会把整通电话的话题带偏。
            self.history.pop()
            self.llm_fail_streak += 1
            # 连续失败时不能再复读同一句：对方听到的是「卡了一下你再说一遍」×N，
            # 既没解释也没变化，只会更烦躁。第一次照旧，第二次起改口风并主动拉长间隔。
            if self.llm_fail_streak == 1:
                answer = "我这边卡了一下，你再说一遍？"
            elif self.llm_fail_streak == 2:
                answer = "抱歉，我这边网络有点不稳，你稍微等一下再跟我说。"
            else:
                log.warning("[%s] 大脑连续 %d 次失败，暂停回话", self.call_id[:8], self.llm_fail_streak)
                time.sleep(min(10.0, 2.0 * self.llm_fail_streak))
                return True
        else:
            self.llm_fail_streak = 0
            self.history.append({"role": "assistant", "content": answer})
        log.info("[%s] 我: %s", self.call_id[:8], answer)
        self._speak(player, rec, answer, sr, frames)
        return True

    def _record_utterance(self, rec, sr: int, frames: int, deadline: float):
        """能量 VAD 切句。返回 np.ndarray；None=超时无语音；''=噪音太短忽略。"""
        audio = self.cfg["audio"]
        start_th, stop_th = audio["startThreshold"], audio["stopThreshold"]
        collected: list[np.ndarray] = []
        silence = 0.0
        speech_sec = 0.0
        last_level_log = time.monotonic()
        # 自愈：门限万一还是定高了（标定窗恰好落在噪音里），人声就永远够不到，
        # 表现为「它一直在等、我说话它没反应」。这里记着等门期间的最高电平，
        # 每 4 秒回头看一次：有过明显能量却始终没触发，就把门限往下退一档。
        wait_started = time.monotonic()
        peak_while_waiting = 0.0
        last_relax = wait_started
        while True:
            if self.stop_flag.is_set():
                return None
            data = rec.record(numframes=frames)  # (frames, ch) float32
            mono = data.mean(axis=1)
            rms = float(np.sqrt(np.mean(mono ** 2)))
            if not collected:
                peak_while_waiting = max(peak_while_waiting, rms)
                now = time.monotonic()
                if (now - last_relax > 4.0 and peak_while_waiting > start_th * 0.5
                        and start_th > 0.0015):
                    new_th = max(0.0015, start_th * 0.7)
                    log.warning("等门 %.0fs 无触发但电平到过 %.4f，门限自愈 %.4f → %.4f",
                                now - wait_started, peak_while_waiting, start_th, new_th)
                    start_th = new_th
                    audio["startThreshold"] = new_th
                    audio["stopThreshold"] = max(0.0012, new_th * 0.4)
                    stop_th = audio["stopThreshold"]
                    last_relax = now
            if time.monotonic() - last_level_log > 3:  # 实时电平诊断
                log.info("RX 电平 RMS=%.4f（起Threshold=%.4f）", rms, start_th)
                last_level_log = time.monotonic()
            if rms > start_th:
                collected.append(mono)
                speech_sec += frames / sr
                silence = 0.0
                if speech_sec >= audio["maxSegmentSec"]:
                    break
            elif collected:
                collected.append(mono)  # 保留句尾静音
                silence += frames / sr
                if silence >= audio["trailingSilenceSec"]:
                    break
            elif time.time() > deadline:  # 还没开口就一直等
                return None
        return np.concatenate(collected) if sum(len(c) for c in collected) / sr >= audio["minSpeechSec"] else ""

    def _speak(self, player, rec, text: str, sr: int, frames: int):
        """合成并播放；播放中监听对方开口则立即打断（barge-in）。"""
        audio = self.cfg["audio"]
        try:
            pcm = self.brain.synthesize(text)
        except Exception as e:
            log.error("TTS 失败: %s", e)
            return
        # 四层 TTS 全挂时 synthesize 会返回一小段全零当占位；播它等于让对话死寂
        # 半秒，还会把下一轮录音的静音判定搅乱。直接跳过，静默本身没有害处。
        if pcm is None or len(pcm) == 0 or not np.any(pcm):
            log.warning("TTS 没有产出可播音频（%r），跳过播放", text[:40])
            return
        log.info("播放 %.1fs 音频", len(pcm) / sr)
        stereo = np.repeat(pcm[:, None], audio["channels"], axis=1)
        total_frames = len(stereo)
        pos, quiet, over = 0, 0, 0
        t0 = time.monotonic()
        queued = 0  # play() 是排队式返回，需限速防止积压（打断时残留才少）
        while pos < total_frames and not self.stop_flag.is_set():
            if queued > (time.monotonic() - t0) * sr + 2 * frames:
                time.sleep(0.01)
                continue
            if audio.get("bargeIn", True) and queued > sr * 0.5:  # 前 0.5s 不判打断，避免切到自己的起音
                heard = rec.record(numframes=frames).mean(axis=1)
                rms = float(np.sqrt(np.mean(heard ** 2)))
                # 播放中麦克风会收到自己的漏音，所以打断门限必须高于起音门限，
                # 且要求连续 3 帧（150ms）越线——短促杂音和自己的尾音都不算插话。
                barge_th = max(audio["startThreshold"] * 1.5, float(audio.get("bargeThreshold", 0.006)))
                quiet = quiet + 1 if rms < audio["stopThreshold"] else 0
                over = over + 1 if rms > barge_th else 0
                if over >= 3:
                    log.info("对方插话（RMS=%.4f > %.4f），停止播放", rms, barge_th)
                    return
            end = min(pos + frames, total_frames)
            player.play(stereo[pos:end])
            queued += end - pos
            pos = end
        # 等尾音播完再返回，防止下一段录音听到自己的 TTS
        tail = total_frames / sr - (time.monotonic() - t0)
        if tail > 0:
            time.sleep(tail)
        # 光等不够：整个播放期间麦克风都在录自己的漏音，全积在队列里。
        # 不排空的话，紧接着的 _record_utterance 会立刻拿到这段漏音当成
        # 对方说话 → ASR 出「你刚才说的有点乱」→ 再回一句 → 再被录进去，
        # 现场就是这样无限复读的（对方(2.9s): 这边卡了一下你再说一遍 ×5）。
        # 再留 0.25s 让房间混响散掉，然后连 pending 一起丢掉。
        time.sleep(0.25)
        dropped = rec.drain() if hasattr(rec, "drain") else 0
        if dropped:
            log.info("播放后清掉 %d 个采样（%.2fs）的自听漏音", dropped, dropped / sr)

    def _safe_hangup(self):
        if not self.bridge:
            return  # DSH 内语音对话模式：没有 QQ 通话可挂
        try:
            cur = self.bridge.current()
            if cur and cur.get("phase") not in ("ended", "error", None):
                self.bridge.hangup(self.call_id)
                log.info("[%s] 已挂断", self.call_id[:8])
        except Exception as e:
            log.warning("挂断失败（可能已结束）: %s", e)


# ---------------------------------------------------------------- 服务主体

class Engine:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.bridge = Bridge(cfg["controlPort"], cfg["token"])
        self.session: CallSession | None = None
        self.accepted_ids: set[str] = set()  # 已提交接听的通话，防止对同一通重复 accept

    def on_call_state(self, call: dict):
        if not call:
            return
        phase, direction = call.get("phase"), call.get("direction")
        log.info("通话: %s %s caller=%s", direction, phase, call.get("callerUin"))
        if phase == "connected" and (self.session is None or not self.session.thread.is_alive()):
            self.session = CallSession(self.cfg, self.bridge, call)
            self.session.start()
        elif phase == "ringing" and direction == "incoming":
            self.maybe_accept(call)
        elif phase in ("ended", "error") and self.session and self.session.call_id == call["id"]:
            self.session.stop_flag.set()

    def maybe_accept(self, call: dict):
        whitelist = {str(u) for u in self.cfg["whitelist"]}
        policy = self.cfg.get("unknownCaller", "ignore")
        last_error = None
        for attempt in range(4):
            # 每次尝试都用 current() 的最新快照（QQ 重新响铃会换 call id，
            # 事件里的 id 可能已过期——上一次 409 的教训）
            cur = self.bridge.current() or {}
            if cur.get("phase") != "ringing" or cur.get("direction") != "incoming":
                return  # 通话已结束/已不是待接状态
            call_id, uin = cur.get("id"), cur.get("callerUin")
            if call_id in self.accepted_ids:
                return
            if not uin:
                time.sleep(0.7)
                continue
            if str(uin) not in whitelist:
                log.warning("来电不在白名单（caller=%s），策略=%s", uin, policy)
                if policy == "reject":
                    try:
                        self.bridge.reject(call_id)
                    except Exception as e:
                        log.warning("拒接失败: %s", e)
                return
            log.info("白名单来电 %s（%s），接听（第 %d 次）", uin, cur.get("callerName") or "?", attempt + 1)
            try:
                # 接听前重申声卡路由：宿主重启/设备变化会让 routeReady 掉线，
                # 且文档明确"通话前会再检查路由"——不新鲜就 CAPABILITY_UNAVAILABLE
                route_file = self.cfg.get("routeFile")
                if route_file and os.path.exists(route_file):
                    try:
                        body = json.load(open(route_file, encoding="utf-8"))
                        body["requestId"] = f"engine-route-{int(time.time() * 1000)}"
                        av_port = self.cfg.get("avPort", 6111)  # 路由接口在 AV Host 端口，不在 6110
                        r = httpx.post(f"http://127.0.0.1:{av_port}/v1/audio/route", headers=self.bridge.headers,
                                       json=body, timeout=10)
                        log.info("路由重申: %s", r.json().get("data", {}).get("ready"))
                    except Exception as e:
                        log.warning("路由重申失败（继续尝试接听）: %s", e)
                self.bridge.accept(call_id)
                self.accepted_ids.add(call_id)
                log.info("接听指令已提交 ✅")
                return
            except RuntimeError as e:
                last_error = str(e)
                log.warning("接听尝试 %d 失败: %s", attempt + 1, e)
                time.sleep(1.5)
        if last_error:
            log.error("多次接听均失败，放弃本通电话: %s", last_error)

    def run_forever(self):
        after, boot_id = 0, None
        log.info("引擎启动，监控 127.0.0.1:%s（白名单: %s）", self.cfg["controlPort"], self.cfg["whitelist"])
        # 桥没起来的时候（QQ 侧插件没加载、6110 没人监听）这里会每 2 秒抛一次
        # 502，一晚上能把 engine.log 刷到 42MB。改成指数退避 + 同一错误只记一次，
        # 桥回来后自动恢复，日志里留得下一行"恢复"就够诊断了。
        fail_streak = 0
        last_err, last_err_at = None, 0.0
        while True:
            try:
                data = self.bridge.events(after, boot_id)
                if data.get("reset"):
                    after, boot_id = 0, data["bootId"]
                    continue
                boot_id = data.get("bootId", boot_id)
                for ev in data.get("events", []):
                    try:  # 单个事件处理失败不能卡死游标（否则后续事件全部饿死）
                        if ev.get("type") == "call.state":
                            self.on_call_state(ev.get("call"))
                        elif ev.get("type") == "call.error":
                            log.error("通话错误: %s", ev)
                    except Exception as e:
                        log.error("事件处理失败（跳过）: %s | %s", e, str(ev)[:120])
                after = data.get("nextSeq", after)
                if fail_streak:
                    log.info("通话桥恢复（此前连续失败 %d 次）", fail_streak)
                    fail_streak, last_err, last_err_at = 0, None, 0.0
            except Exception as e:
                fail_streak += 1
                now = time.time()
                msg = str(e)
                # 同一种错误在 5 分钟窗口内只打一次，其余降级为「第 N 次，仍在重试」
                if msg != last_err or now - last_err_at > 300:
                    log.warning("轮询失败（第 %d 次，之后同样错误静默）: %s", fail_streak, msg)
                    last_err, last_err_at = msg, now
                # 2s → 4s → 8s → 16s → 30s 封顶；桥一回来立刻恢复
                time.sleep(min(30.0, 2.0 * (2 ** min(fail_streak - 1, 4))))
            time.sleep(0.8)


# ---------------------------------------------------------------- CLI

def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(),
                                  logging.FileHandler(HERE / "engine.log", encoding="utf-8")])
    # httpx 自己的 INFO 日志每次请求都打一行，退避后仍会以「HTTP Request: ... 502」刷屏；
    # 失败原因已经由 run_forever 的 warning 记全了，这里只留 httpx 的告警。
    logging.getLogger("httpx").setLevel(logging.WARNING)
    # 子命令解析：第一个以 .json 结尾的参数是配置文件路径，其余才是子命令。
    # 之前直接拿 sys.argv[1] 判子命令，一旦带配置路径启动（engine.py xxx.json dsh-chat），
    # 永远匹配不到 dsh-chat，会静默掉进 run_forever 去轮询 6110——看起来就是「没反应」。
    argv = list(sys.argv[1:])
    if argv and argv[0].endswith(".json"):
        argv.pop(0)
    cmd = argv[0] if argv else ""
    cfg = load_config()

    if cmd == "status":
        print(json.dumps(Bridge(cfg["controlPort"], cfg["token"]).current(),
                         ensure_ascii=False, indent=2))
    elif len(sys.argv) > 1 and cmd == "dial":
        print(json.dumps(Bridge(cfg["controlPort"], cfg["token"]).dial(sys.argv[2]),
                         ensure_ascii=False, indent=2))
    elif len(sys.argv) > 1 and cmd == "hangup":
        bridge = Bridge(cfg["controlPort"], cfg["token"])
        call = bridge.current()
        if call:
            bridge.hangup(call["id"])
            print("已挂断")
        else:
            print("当前没有通话")
    elif len(sys.argv) > 1 and cmd == "dsh-chat":
        # DSH 内实时语音对话：真实麦克风/扬声器，无 QQ 通话，大脑走 DSH 的 ctx.llm
        minutes = float(argv[1]) if len(argv) > 1 else 5.0
        dsh_cfg = dict(cfg)
        base_audio = cfg["audio"]
        dsh_cfg["audio"] = {**base_audio,
                            "captureDevice": "__real_mic__",
                            "renderDevice": "__real_spk__",
                            # 真麦靠自适应门限（听 0.8s 底噪再定），不能沿用回环那套写死的阈值
                            "adaptiveThreshold": base_audio.get("dshAdaptiveThreshold", True),
                            # 播放中判打断的门限（自己的 TTS 漏音进麦也常高于起音门限）
                            "bargeThreshold": float(base_audio.get("dshBargeThreshold", 0.02)),
                            # 真麦说话中间有换气停顿：0.9s 尾静音会把「你好，听得见吗」
                            # 切成 1.1s 的碎片，每片都转不出字。DSH 模式放宽到 1.2s，
                            # 最短语音提到 0.6s（低于它的当杂音直接丢）。
                            "trailingSilenceSec": float(base_audio.get("dshTrailingSilenceSec", 1.2)),
                            "minSpeechSec": float(base_audio.get("dshMinSpeechSec", 0.6))}
        fake_call = {"id": f"dsh-{int(time.time())}", "phase": "connected",
                     "direction": "dsh", "callerUin": ""}
        session = CallSession(dsh_cfg, None, fake_call)
        session.started_at = time.time()
        session.thread.start()
        session.thread.join(timeout=minutes * 60 + 30)
        print(json.dumps({"transcript": session.history,
                          "duration_sec": round(time.time() - session.started_at)},
                         ensure_ascii=False))
    else:
        Engine(cfg).run_forever()


if __name__ == "__main__":
    main()
