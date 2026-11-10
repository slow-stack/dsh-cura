# QQ 语音通话引擎（qq-call-engine）

让你的 QQ 机器人接听/拨打**真·QQ 语音电话**，接通后由 DeepSeek 驱动对话。
通话层复用 [napcat-qq-voice-call-win](https://github.com/oldhan13/napcat-qq-voice-call-win)（GPL-3.0，上游 KoishiRTC），
本仓库只提供它的上层引擎：来电监控 → 白名单自动接听 → ASR → LLM → TTS → 挂断。

```
来电事件(6110) → 白名单自动接听
  对方声音 ◄── [Hi-Fi Cable Output] ◄── AVSDK 播放 ◄── QQ 通话
  引擎 VAD 切句 → faster-whisper 转写 → DeepSeek 回复 → edge-tts 合成
  引擎播放 ──► [CABLE Input] ──► AVSDK 采集（QQ 眼里的麦克风）──► 对方
```

## 前置条件

| 要什么 | 你的现状 |
|---|---|
| Windows 10/11 x64 | ✅ |
| Node.js ≥ 22.19 | ✅ v24.15.0 |
| Python 3.11 环境（faster-whisper 的 ctranslate2 暂无 3.13 轮子） | 用 Miniconda 建 |
| VB-Audio Virtual Cable（一次装两条虚拟声卡） | 需安装 |
| 通话桥仓库 napcat-qq-voice-call-win | `git clone` |
| DeepSeek API Key | [platform.deepseek.com](https://platform.deepseek.com) |

## 部署步骤

### 1. 装虚拟声卡（需重启）

下载 [VB-CABLE](https://vb-audio.com/Cable/)（VBCABLE_Driver_Pack43.zip），解压后以管理员运行
`VBAudio64bitDriverPack...exe` → 右下角 Install Driver → **重启电脑**。
重启后"声音设置"里应能看到 `CABLE Input/Output` 和 `Hi-Fi Cable Input/Output` 四条。

### 2. 装 Windows 通话桥

```powershell
git clone https://github.com/oldhan13/napcat-qq-voice-call-win.git
cd napcat-qq-voice-call-win
node bridge\qq\windows\manage.mjs install --install-dir D:\RTCWorkspace\RTCQQ
node bridge\qq\windows\manage.mjs doctor  --install-dir D:\RTCWorkspace\RTCQQ
```

`install` 会下载官方 QQ 9.9.36（约 330MB，SHA256 校验）并搭好 NapCat + AV Host。
`doctor` 全绿才算过。

### 3. 停掉旧 NapCat（重要：同号不能双开）

```powershell
# 停掉你现在 D:\NapCat\shell 的 NapCat 实例（整个进程树）
taskkill /F /IM node.exe /FI "WINDOWTITLE eq NapCat" 2>$null
# 或者直接在旧 WebUI 里退出登录后关闭进程；确认 6099 不再监听
```

### 4. 起新 NapCat 并登录

```powershell
node bridge\qq\windows\manage.mjs run-napcat --install-dir D:\RTCWorkspace\RTCQQ
```

- 浏览器开 `http://127.0.0.1:6210`（token 在 `D:\RTCWorkspace\RTCQQ\NapCat\config\webui.json`），登录 **2237170771**。
- 把旧配置搬过来（DSH 无感知）：
  `copy D:\NapCat\shell\napcat\config\onebot11_2237170771.json D:\RTCWorkspace\RTCQQ\NapCat\config\`
  （反向 WS `ws://127.0.0.1:8643/ws` 原样保留，DSH 自动重连；"签名"HTTP 服务也一并搬过来了。）

### 5. 起 AV Host + 配声卡路由

```powershell
node bridge\qq\windows\manage.mjs run-av-host --install-dir D:\RTCWorkspace\RTCQQ
node bridge\qq\windows\manage.mjs control --install-dir D:\RTCWorkspace\RTCQQ --action devices
```

用 `devices` 输出的**编号**建 `route.json`（input=她听，output=她说）：

```json
{"input": {"id": <Hi-Fi Cable Output 的编号>, "name": "..."}, "output": {"id": <CABLE Input 的编号>, "name": "..."}}
```

```powershell
node bridge\qq\windows\manage.mjs control --install-dir D:\RTCWorkspace\RTCQQ --action route --body-file route.json
```

**验收**：返回 `ready: true`。不配就拨号会报 `CAPABILITY_UNAVAILABLE`——不是坏了，是没配。

### 6. 装引擎

```powershell
conda create -n qqcall python=3.11 -y
conda activate qqcall
cd <本目录>
pip install -r requirements.txt
copy config.example.json config.json
# 编辑 config.json：
#   whitelist      → 你的大号 QQ 号（字符串）
#   deepseek.apiKey → 你的 key（或设环境变量 DEEPSEEK_API_KEY）
#   tokenFile      → D:\RTCWorkspace\RTCQQ\runtime\control.token
```

### 7. 跑通验收链

```powershell
python engine.py status     # 能看到 selfId/媒体状态即桥正常
python engine.py            # 常驻，开始监听来电
```

用大号给 **2237170771** 打 QQ 语音电话 → 引擎自动接 → 听到"喂，我在，请讲" → 说话 → 它回复 →
说"拜拜"挂断。也可以反过来：`python engine.py dial 你的大号`。

验收链（来自手册）：
`6110/3000/6111/6210 都在听 → status 的 selfId 是你的号 → route ready:true → 来电自动接 → 对话 → 挂断`

## 常见坑（按出现概率）

1. **同号不能双开**：新 NapCat 登录前必须把旧实例停干净。
2. **重启后要重新登录**：WebUI 快速登录可脚本化（win-scripts/napcat-quicklogin.mjs）。
3. **AVSDK 采集跟着 Windows「默认录音设备」走**：把默认录音设备设成 `CABLE Output`；改了设备要**挂断重拨**。
4. **`peerUin` 必须字符串**；**hangup 必带 callId**。
5. **引擎听不到对方**：确认 AVSDK 播放设备是 `Hi-Fi Cable Input`，录的是 `Hi-Fi Cable Output`。
6. **threshold 太灵/太钝**：改 config.json 的 `startThreshold/stopThreshold`（先看 engine.log 里的音量）。

## 引擎行为可调

- `greeting / farewell / persona`：问候、告别、人格
- `goodbyeWords`：说什么自动挂断
- `idleTimeoutSec / maxDurationSec`：静音挂断 / 最长通话
- `bargeIn`：说话时能否被打断
- `asr.model`：`base`(快) / `small`(准，默认) / `medium`

## 风险与合规

- 通话层走的是腾讯未开放的 AVSDK 能力，**有账号风控风险**，建议小号；用你自己的号和机器。
- GPL-3.0：分发需保留原仓库的 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`bridge/qq/ATTRIBUTION.md`。
