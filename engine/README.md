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

| 要什么 | 说明 |
|---|---|
| Windows 10/11 x64 | x64 桌面版 |
| Node.js ≥ 22.19 | 通话桥是 Node 写的 |
| Python 3.11 环境 | faster-whisper 的 ctranslate2 暂无 3.13 轮子，建议 conda 单独建一个 |
| VB-Audio Virtual Cable | 一次装两条虚拟声卡（CABLE + Hi-Fi Cable） |
| 通话桥仓库 napcat-qq-voice-call-win | 见步骤 2，`git clone` 下来 |
| LLM API Key | 任意 OpenAI 兼容端点，[platform.deepseek.com](https://platform.deepseek.com) 也行 |

## 部署步骤

### 1. 装虚拟声卡（需重启）

下载 [VB-CABLE](https://vb-audio.com/Cable/)（VBCABLE_Driver_Pack43.zip），解压后以管理员运行
`VBAudio64bitDriverPack...exe` → 右下角 Install Driver → **重启电脑**。
重启后"声音设置"里应能看到 `CABLE Input/Output` 和 `Hi-Fi Cable Input/Output` 四条。

### 2. 装 Windows 通话桥

```powershell
git clone https://github.com/oldhan13/napcat-qq-voice-call-win.git
cd napcat-qq-voice-call-win
node bridge\qq\windows\manage.mjs install --install-dir <安装目录>
node bridge\qq\windows\manage.mjs doctor  --install-dir <安装目录>
```

`install` 会下载官方 QQ 9.9.36（约 330MB，SHA256 校验）并搭好 NapCat + AV Host。
`doctor` 全绿才算过。

### 3. 停掉旧 NapCat（重要：同号不能双开）

```powershell
# 停掉你现在正在跑的那个 NapCat 实例（整个进程树）
taskkill /F /IM node.exe /FI "WINDOWTITLE eq NapCat" 2>$null
# 或者直接在旧 WebUI 里退出登录后关闭进程；确认 6099 不再监听
```

### 4. 起新 NapCat 并登录

```powershell
node bridge\qq\windows\manage.mjs run-napcat --install-dir <安装目录>
```

- 浏览器开 `http://127.0.0.1:6210`（token 在 `<安装目录>\NapCat\config\webui.json`），用**要接电话的那个号**登录。
- 如果之前已经有一个 NapCat 在跑，把它的账号配置搬过来（DSH 无感知）：
  `copy <旧 NapCat 目录>\config\onebot11_<你的QQ>.json <安装目录>\NapCat\config\`
  （反向 WS `ws://127.0.0.1:8643/ws` 原样保留，DSH 自动重连；"签名"HTTP 服务也一并搬过来了。）

### 5. 起 AV Host + 配声卡路由

```powershell
node bridge\qq\windows\manage.mjs run-av-host --install-dir <安装目录>
node bridge\qq\windows\manage.mjs control --install-dir <安装目录> --action devices
```

用 `devices` 输出的**编号**建 `route.json`（input=她听，output=她说）：

```json
{"input": {"id": <Hi-Fi Cable Output 的编号>, "name": "..."}, "output": {"id": <CABLE Input 的编号>, "name": "..."}}
```

```powershell
node bridge\qq\windows\manage.mjs control --install-dir <安装目录> --action route --body-file route.json
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
#   whitelist  → 允许自动接听的 QQ 号（字符串数组）
#   selfId     → 你的机器人 QQ 号（写通话记录时用）
#   llm.apiKey → 你的 key（或设环境变量 LLM_API_KEY）
#   tokenFile  → <安装目录>\runtime\control.token
```

> 由 DSH 插件托管启动时，上面 llm 那一段**不用填**：插件会通过环境变量
> `CURA_BRAIN_URL`（宿主 webServer 上的 `/cura/v1` 路由）与 `CURA_BRAIN_TOKEN`
> 把地址和凭据传进来，优先级高于 config.json。
>
> 单独跑引擎（不经插件）时**别再指向 `/cura/v1`**：那条路由要插件进程内现生成的
> token，你手里没有，会收到 401。这种场景把 `llm.baseUrl` 指向你自己的
> OpenAI 兼容端点（并填 `llm.apiKey`），或者干脆在 DSH 里用 `voice_chat` 工具。

### 7. 跑通验收链

```powershell
python engine.py status     # 能看到 selfId/媒体状态即桥正常
python engine.py            # 常驻，开始监听来电
```

用你的大号给你的机器人号打 QQ 语音电话 → 引擎自动接 → 听到"喂，我在，请讲" → 说话 → 它回复 →
说"拜拜"挂断。也可以反过来：`python engine.py dial <你的大号>`。

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
