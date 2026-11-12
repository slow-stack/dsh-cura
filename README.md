# dsh-cura

> Cura，拉丁语的"照看、照料"。这个插件做的事：在 DeepSeek Harness 里替你照看生活——健康记录、周期关怀、出门查路、点杯咖啡；顺带把 QQ Bot 的人味儿（人格、说话规则、语料）一并注进去。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![平台](https://img.shields.io/badge/platform-Windows%20%7C%20DSH%20desktop-5b5bd6)

**dsh-cura** 是 [DeepSeek Harness](https://chat.deepseek.com)（DSH）的插件，分两层挂载、范围不同：

- **生活关怀层**（`lib/care.js`）挂在插件根 ctx 上，**DSH 里任何会话都能用**——健康汇总与周期关怀、面板里存的常用坐标、管家 MCP（高德 / 瑞幸）。这些事跟"在哪个窗口说话"无关，主对话框里也该能问一句「附近有咖啡吗」。
- **QQ 伴生层**只贴 QQ 会话 scope，注入拟人化：回复规则、人设、语料、情境表达规则。它不接管消息流（那是 [dsh-onebot-qq](https://github.com/NapNeko/dsh-onebot-qq) 的职责）。

```
 DS  任  何  会  话（主对话框 / QQ / 子会话…）
 ┌────────────────────────────────────────────┐
 │ 生活关怀层（插件根 ctx，全部会话可见）        │
 │   健康汇总 · 周期关怀 · 常用坐标 · 管家 MCP   │
 └────────────────────────────────────────────┘
                     ▲ 叠加
 QQ ⇄ NapCat ⇄ dsh-onebot-qq（消息流 + STT + qq_* 工具，原样保留）
                     ▲
                     │ 贴附（agents.get → systemPrompt.section）
        QQ 伴生层：回复规则 / 人设 / 语料 / 情境表达规则
                     │
                     ├─ ctx.llm.stream（模型随 DSH 设置走，如 xdpool）
                     └─ 托管 Python 语音通话引擎（可选，见下）
```

不想让主对话也带这些？把 `careGlobal` 关掉就退回旧行为（只在 QQ 会话里挂），见下方「生活关怀层」。

## 功能

| 功能 | 状态 | 说明 |
|---|---|---|
| 回复规则注入 | ✅ | 把"像真人发 QQ 消息"的硬规则注入 QQ 会话的 system prompt（order 96，末位最大权重）；设置页/patch 改完自动重注册，**下一条消息即生效** |
| 人设补充注入 | ✅ | `chatPersona` 文本随规则一同注入 |
| 语料库 | ✅ 基础版 | `corpus/` 目录的 txt/jsonl 作为"说话风格示例"轮换注入 |
| 情境表达规则库 | ✅ | MaiBot 式"情境→表达"规则：全局说话方式+反面清单进 system prompt 段，情境规则每轮按最近用户消息检索注入（`systemPrompt.context`，官方动态上下文）；规则库 `rules.json` 人工可编辑、改完即生效，无需重启 |
| 规则库管理面板（DSH 内） | ✅ | DSH 左侧侧边栏新增 "Cura" 入口（内含「表达规则 / 语音通话 / 健康日志 / 周期关怀 / 出行 · 高德 / 瑞幸 · 点单」六页，瑞幸页为 🧪 beta）（`sidebar.panellist` + `main` keyed slot，浏览器半侧 `lib/client.js`）：增删改查、启用/停用、手动学习、导出 JSON；数据走 Typert Remote（`curaRules` 命名空间，宿主行 `lib/rules-remote.js`，独立 patch 行），不依赖任何独立本地服务 |
| 规则自动学习 | ✅ | 定时（默认 6h）从对话事件流抽取新规则：LLM 抽取 → 本地去重审查（情境 bigram 相似 + 关键词重合）→ 入库；首跑只建游标不学习，库满自动停；学习引擎在 rules-remote 行（单一写方），面板可手动触发 |
| 健康日志（男女通用） | ✅ | 面板「健康日志」页手动记，或在任意会话里说（agent 的 `health_log` 工具自动抽取记录：睡眠/运动/情绪/备注）；近 7 天汇总 + 关注目标每轮注入**所有会话**，Cura 会顺势劝早睡/夸坚持。数据只存本机 `health.json`（gitignored） |
| 周期关怀（可选，默认关） | ✅ | 健康模块的子功能：面板「周期关怀」页开启后，按末次月经+周期长度估算四阶段（月经/卵泡/排卵/黄体），今日阶段+相处建议每轮注入**所有会话**——经期多照顾、卵泡期推学习、排卵期排表达类任务、经前别硬催；阶段建议可在面板改。数据只存本机 `health.json`，生活方式参考而非医疗建议 |
| 管家工具（butler） | ✅ | 把外部 MCP server（瑞幸下单、高德地图、天气……）挂进**所有会话**，Agent 能在现实里照顾人而不只是虚拟关怀。与 DSH 设置/ds-bot 的连接管理不冲突（见下方组件说明）；server 清单在 Config `butlerServers` 配（默认空 = 关）；高德另有面板「出行 · 高德」页、瑞幸有「瑞幸 · 点单」页（🧪 beta，见下），填 key/token 即写 `travel.json` / `luckin.json`、下一条消息就带上；高德页还能把「学校 / 家」这类常用坐标存下来，以 `cura:places` 注入所有会话，模型算「附近」时不用再反问你在哪 |
| 语音合成助手 | ✅ | `say.ps1`：edge-tts（自然，云）失败自动换 Windows 离线 SAPI（稳定，本地）。agent 用 shell 调它生成音频，再用 `qq_send_voice`（dsh-onebot 自带）发送——职责不重叠 |
| STT 包装器 | ✅ | `stt-whisper.py`：faster-whisper 包装，适配 dsh-onebot 的 `custom` STT 引擎（`{file}`/`{out}` 模板） |
| 语音通话引擎托管 | 🧪 beta | 托管一个 Python 通话引擎（自动接听/对话/挂断，基于 [KoishiRTC](https://github.com/Touch-Night/KoishiRTC) 系桥）。QQ 通话里"对方声音回放路由"在 Windows 上暂无可靠解（上游待验证），代码完整保留，随时可复活。<br>**标 beta 的是 DSH 内语音对话（`voice_chat`）**：已能整通跑（采集→ASR→大脑→TTS→播放），但依赖本机麦克风/扬声器与 Python 侧依赖，首次使用往往要调设备，失败率不低，故按 beta 发布；QQ 通话那半条仍是搁置 |

## 安装（Windows + DSH 桌面版）

> 需要 Node.js ≥ 20。QQ 伴生层是**可选**的——只想要生活关怀层（健康、周期、常用坐标、高德/瑞幸）的话不用装 [dsh-onebot-qq](https://github.com/NapNeko/dsh-onebot-qq)。

### 方式一：dsh plugin（推荐）

```powershell
dsh plugin --profile web add dsh-cura
```

`--profile` 换成你实际在用的 profile（默认 `web`）。这条命令会在 profile 目录里装包并把插件登记进 bundles，装完重启 DSH 即可。

### 方式二：npm 手动装

1. 进 DSH profile 目录装（默认 profile 一般是 `~/.dsh/profiles/desktop`，装了多个 profile 时就选你用的那个）：
   ```powershell
   cd <DSH profile 目录>
   npm install dsh-cura
   ```
2. 编辑同目录的 `package.json`，把插件登记进 bundles（`dependencies` 那行 npm 已经写好了）：
   ```jsonc
   "dsh": { "profile": { "bundles": [ "dsh-cura" /* 追加到数组 */ ] } }
   ```
3. 重启 DSH。插件设置页里填机器相关项（见「配置」）。

包的默认路径（`rules.json` / `health.json` / `voice.json` / `corpus/` / `say.ps1` / `stt-whisper.py`）全部按**插件包根目录**推导，装在哪个盘都不用改；要挪到别处（比如放自己的数据盘）在 profile 层覆盖即可。

### 方式三：从源码（要改代码/跟 main 走时用）

1. 把仓库克隆到固定位置：
   ```powershell
   git clone https://github.com/slow-stack/dsh-cura.git <你的目录>
   ```
2. 在 DSH profile 的 `node_modules` 里建 junction（以默认 profile 为例）：
   ```powershell
   cmd /c mklink /J "<DSH profile 目录>\node_modules\dsh-cura" "<你的目录>"
   ```
3. 编辑 `<DSH profile 目录>\package.json`，两处登记：
   ```jsonc
   "dependencies": { "dsh-cura": "link:<你的目录>" },
   "dsh": { "profile": { "bundles": [ "dsh-cura" /* 追加到数组 */ ] } }
   ```
4. 重启 DSH。

> ⚠️ 踩坑提示（都是实测踩过的）：bundle 层 `cordis.patch.yml` 必须是 `- insert:` 操作方言；插件 `package.json` 必须带 `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}}` 元数据，否则加载器静默跳过；只放 node_modules 不登记 bundles 不会加载。

## 配置

机器相关的值（引擎路径、目标 QQ 号）**不要**写进本仓库——在 profile 层的 `cordis.patch.yml` 按 id 覆盖：

```yaml
- id: dsh-cura
  name: dsh-cura
  config:
    targetUser: '你的QQ号'          # 会话 onebot-private-<QQ号>
    enginePython: <你的 python.exe>  # 可选，留空则用 CURA_PYTHON 或 PATH 里的 python
    engineDir: <插件目录>\engine      # 可选（托管通话引擎时用，引擎随包在 engine/）
```

其余字段（回复规则、人设、语料目录、场景、语音条模式）都在 Config schema 里，重启后在 DSH 插件设置页可视化修改；也可以直接改本仓库的 `cordis.patch.yml` 默认值。

## 组件说明

### engine/（Python 语音通话引擎）

QQ 语音通话与 DSH 内语音对话的 Python 侧：采集（sounddevice，WDM-KS 优先）→ VAD/断句 → faster-whisper ASR → 大脑（8765 或 DSH）→ TTS → 播放，含打断（barge-in）。

之前它散在工作区里、不是 git 仓库，现在整目录收进本仓库，只有源码与维护中的测试入库：

- `engine.py`：主程序，`dsh-chat` 子命令给 DSH 内语音用，无子命令时轮询 QQ 通话桥 6110
- `.scratch/t_*.py`：维护中的六套测试（session / reply / drain / threshold / polling / cal）
- `config.json`、`engine.log`、探针产物与 `.scratch` 下的探索脚本都不入库（含 QQ 号或本机路径）

跑测试（Windows，需要装了依赖的 Python 环境和系统 PATH——只给 conda 路径的话 soundcard 会找不到 `ole32`）：

```bash
PYTHONPATH=<你的目录>/engine <你的 python.exe> engine/.scratch/t_session.py
```

> 测试脚本随**源码仓库**分发，不打进 npm 包（`package.json` 的 `files` 只收录运行所需文件）。

### lib/care.js（生活关怀层 · 所有会话）

把"照看生活"那部分从 QQ 会话里解耦出来，挂到插件根 ctx 上——DSH 里**任何会话**（主对话框、QQ、子会话）都能看到同一份关怀上下文。

| 条目 | order | 内容 | 形态 |
|---|---|---|---|
| `cura:butler` | 93 | 管家引导语 + 当前已挂的 server 清单 | section（函数文本，每轮重读） |
| `cura:health` | 94 | 近 7 天汇总 + 关注目标 + 周期关怀 | context（动态） |
| `cura:places` | 94 | 面板里存的常用坐标 | context（动态） |

设计上的三个取舍：

- **为什么是 `ctx.get('systemPrompt')` 而不是把 `systemPrompt` 加进 `inject`**：照 `dsh-voice-call` 的成熟写法，避免改 inject 带来的装载顺序风险；宿主没这个服务时 `careMode()` 自动退回 QQ 专用模式并记一条 warning，而不是静默丢掉这些能力。
- **为什么全局名与 QQ 旧名不同**（`cura:*` vs `qq-bot:*`）：全局模式下 QQ 会话不再重复注册那三项，直接靠 scope 继承；只有退回 QQ 专用模式时才用旧名补挂。不同名 + 只挂一边 = 提示词里不会出现两份同样文字。
- **为什么每条单独 try/catch**：一条 section 重名不该连坐另外两条；挂不上的进 `failed` 并记日志，全部失败时会显式 warning「未挂上任何条目」，不会嘴上说挂好了实际什么都没有。

`careGlobal`（Config，默认 `true`）关掉即退回旧行为：只在 QQ 会话里挂 `qq-bot:butler` / `qq-bot:health` / `qq-bot:places`。

### lib/butler.js（管家工具挂载）

让**所有会话**里的 Agent 调用外部 MCP server，把"照顾"落进现实：点咖啡（自部署的瑞幸 MCP）、查地点/路线/天气（高德 amap MCP）、黄历、待办……社区 server 在 GitHub 上找（搜 `mcp server` + 场景名）。

配置（机器相关项请写在 profile 层 patch）：

```jsonc
// dsh-cura 的 Config.butlerServers（JSON 数组；默认 [] = 关）
[
  { "serverName": "luckin", "transport": "streamable-http", "url": "http://你的云服务器:3000/mcp",
    "headers": { "Authorization": "Bearer xxx" } },
  { "serverName": "amap", "transport": "stdio", "command": "npx",
    "args": ["-y", "@amap/amap-maps-mcp-server"], "env": { "AMAP_MAPS_API_KEY": "你的key" } }
]
```

**与生态的冲突处理**（为什么不另做一套"连接管理"）：

- DSH 核心自带 MCP 连接管理（设置页 + `storages/mcp_connector.json`，catalog 里就有 amap），ds-bot 另有按 Bot 粒度的 Connectors/Capabilities。本插件**不做管理器**，只做"会话内挂载器"：server 清单来自本插件 Config，不提供审批流/密钥治理/连接状态页。
- 挂载走 DSH 官方通道：经 `loader.import('@deepseek-ai/dsh-mcp-client')` 拿到官方 MCP 客户端，`scope.plugin(mcpPlugin, config)` 挂到目标 scope 上（ds-bot 同款挂法）。**默认挂插件根 ctx = 所有会话**；`careGlobal=false` 时退回挂 `onebot-private-<QQ>` 单个会话。ds-bot 的能力只挂它自己的 Bot 会话，两者作用域不相交。
- 工具名天然隔离：挂进来的是 `mcp__<serverName>__*`，与 `qq_*` 工具、cura 自有工具（`say_aloud`/`voice_chat`/`health_log`）互不覆盖。
- 重名防御两层：①挂载前读核心连接表，同一 `serverName` 已在 DSH 设置里连接的，以核心为准、跳过并记 warning——避免同一会话出现两份同名工具；②全局模式下 QQ 侧不再重挂一遍（同一 scope 里同名 `serverName` 会直接抛重复占用）。
- server 挂了不连坐：`failOnStartupError: false` + 后台汇报结果，一个坏 server 不影响会话的其他能力。

引导语（`butlerPrompt`）会作为 `cura:butler` section（order 93，全局模式）或 `qq-bot:butler`（退回 QQ 模式）注入，让模型把工具和"照顾人"的场景对上：做完用一句话自然说结果，像朋友顺口提起，不像客服报菜单。

### lib/travel.js（出行 / 高德面板）

面板第五页「出行 · 高德」把高德 MCP 的接入做成填一个 key：校验/打码、写本机 \`travel.json\`、真连一次（MCP 握手 → 工具列表 → 试调一个只读工具）并把过程与原文错误显示出来。

- 配置来源两层：\`Config.butlerServers\`（手写 JSON） + \`travel.json\`（面板写，同名 server 以面板为准）。面板保存后**下一条消息**就带上 \`amap\`（挂的是根 ctx，所有会话都有），不用改 profile、不用重启宿主。
- 地址两种写法：裸 key（16–64 位十六进制，自动拼 \`https://mcp.amap.com/mcp?key=…\`）或完整 MCP 地址（\`new URL()\` 校验后原样用）。
- key 只以明文存本机 \`travel.json\`（gitignored、不进包），面板只回打码地址与末四位；「测试连接」的返回值同样不含完整 key。
- 「测试连接」不做假成功：探针按 \`initialize\` → \`notifications/initialized\` → \`tools/list\` → 试调（优先 \`maps_weather\`，其次 \`maps_ip_location\`/\`maps_geo\`）走，超时 12 秒，结束时 DELETE 会话；哪一步失败就停在哪一步并把原始报错贴回面板。
- 插件自己把 `amap` 挂进所有会话，**不用**再去 DSH 设置 → MCP 连接里重复加一份。只有把 `careGlobal` 关掉（退回 QQ 专用）时，主对话框才需要手动加同一个地址。

#### 常用坐标（面板里存，注入进会话）

高德和瑞幸的定位工具其实都**不自己查位置**：`maps_ip_location` 的必填参数就是 `ip` 本身，瑞幸 `queryShopList` 也要求先给 `longitude`/`latitude`。所以「找附近有什么」这件事，缺的一直是**坐标从哪来**。

这一页因此加了一张「常用坐标」卡：填地名 → `maps_geo` 查坐标（可带城市消除同名歧义）→ 挑一条存成「学校 / 家 / 公司」。存下的坐标以 `cura:places`（order 94，全局模式）/ `qq-bot:places`（退回 QQ 模式）作为**动态 context** 注入所有会话，面板保存后**下一条消息**就带上，不用重启——用静态 section 的话得等下一次 attach。

- 注入形态：`【常用坐标】` + 每行「名字：经度,纬度（地址）」+ 一句「对不上就用 maps_geo 查、记得带 city、别猜」。没有存任何地点时整段不出现，不占额度。
- 上限 20 条，按 `名字|坐标` 去重；坐标格式非法（不是 `经度,纬度`）的条目在读写两侧都会被丢掉，不写进提示。
- 这几条不改任何工具行为：模型仍可调 `maps_geo` / `maps_around_search` / 瑞幸 `queryShopList`，只是手上先有了一组「她亲口存过的」坐标，不至于每轮反问她「你在哪」。

### lib/luckin.js（瑞幸 / 咖啡面板 · 🧪 beta）

> **beta**：这一页的 token 保存、MCP 握手、工具列表都已实测通过，但**真实下单流程一次也没跑过**（没拿真 token 走过 `createOrder` → 支付 → 取餐）。所以按 beta 发布，出错概率未知，面板上也挂了同样的提示。

面板第六页「瑞幸 · 点单」把瑞幸 AI 开放平台的 MCP 接入做成填一个 token：校验/打码、写本机 \`luckin.json\`、真连一次（MCP 握手 → 工具列表）并把过程与原文错误显示出来。

- 端点固定 \`https://gwmcp.lkcoffee.com/order/user/mcp\`（streamable-http），鉴权走请求头 \`Authorization: Bearer <token>\`——与高德把 key 放在 URL 上不同，所以这一路的探针需要能带 header。
- token 粘贴容错：\`Bearer xxx\` / \`Authorization: Bearer xxx\` / 裸 token / 带引号都能收；太短、含空格、含非法字符直接拒绝，不联网。
- token 只以明文存本机 \`luckin.json\`（gitignored、不进包），面板只回打码串与末四位；全链路返回值都不含完整 token。
- **有效期是估算**：token 本身不带到期时间，面板按「写入时间 + 30 天」算一个参考值并明确标注是估算，不当平台的承诺。
- **探针绝不试调工具**：瑞幸工具集里有 \`createOrder\` 这种会真实扣费的，「测试连接」只做 \`initialize\` → \`notifications/initialized\` → \`tools/list\`，把工具名列表贴出来证明握手与鉴权都通了，不替用户下单。
- 配置来源同样两层：\`Config.butlerServers\`（手写 JSON） + \`luckin.json\`（面板写，同名 server 以面板为准）。面板保存后**下一条消息**就带上 \`my-coffee\`（所有会话），不用改 profile、不用重启宿主。
- 插件自己把 \`my-coffee\` 挂进所有会话，**不用**再去 DSH 设置里重复加。只有 \`careGlobal=false\` 时，主对话框才需要手动加：类型 \`streamablehttp\`、上面那个地址、请求头 \`Authorization: Bearer <token>\`。

### say.ps1（语音合成助手）

```powershell
powershell -NoProfile -File <插件目录>\say.ps1 -Text "要说的话" -Out "$env:TEMP\reply.mp3"
```

edge-tts 失败（断网/接口抽风）时自动降级为 Windows 离线 SAPI 语音。agent 在会话里用 shell 调用它生成音频文件，然后用 dsh-onebot 的 `qq_send_voice` 工具发送。

### stt-whisper.py（STT 包装器）

适配 dsh-onebot-qq 的 custom STT 引擎契约（`{file}`/`{out}` 模板）：

```yaml
sttEnabled: true
sttEngine: custom
sttCommand: <你的python.exe>   # 需要 faster-whisper
sttArgs: ["<插件目录>/stt-whisper.py", "--file", "{file}", "--out", "{out}"]
```

## 开发

```bash
npm install          # 只是跑测试用的开发依赖（@deepseek-ai/schemastery）
npm test             # 一次跑完八套单测
npm test -- travel   # 只跑指定的（rules / cycle / plugin / care / travel / luckin / remote / release-body）
```

八套单测都在 `tests/`，全部直接驱动 `lib/` 里的生产函数（不 mock 掉被测对象），覆盖：

| 套件 | 管什么 |
|---|---|
| `test-rules.mjs` | 规则库纯逻辑：抽取、检索打分、种子规则 |
| `test-cycle.mjs` | 健康日志聚合 + 周期推算的纯函数 |
| `test-plugin.mjs` | 装载面：`inject` 必须含 `tools`、`resolveDshHome` 三级优先级、大脑回退与冷却、`assistant.source` 契约 |
| `test-remote.mjs` | 宿主行服务全方法（stub cordis ctx 直测）+ 学习链路 + 出行/瑞幸接线 |
| `test-travel.mjs` | 高德 key 收敛与打码、MCP 探针（真起 127.0.0.1 假 server）、常用坐标、`placesPrompt` |
| `test-luckin.mjs` | 瑞幸 token 收敛、到期推算、探针带 `Authorization` 且**绝不试调**（防误下单） |
| `test-care.mjs` | 生活关怀层：模式判定、名字表、渲染器降级、注册顺序、单条失败不连坐 |
| `test-release-body.mjs` | Release 正文骨架：提交筛选、手写说明解析、四段格式、CLI 落盘 |

不联网：所有 MCP 交互都打本机 `127.0.0.1` 上的假服务端；临时文件一律落系统临时目录，不往仓库里写。

CI 在 `.github/workflows/test.yml`：每次 push 与 PR 都跑 Node 20 / 22 两档。安装依赖特意用 `npm install --omit=peer`——只装 `schemastery`，另外三个 peer 故意缺席，因为 `rules-remote` 的降级路径正是测试要覆盖的形状（装上反而测不到）。

### 发版

推一个 `v*` 标签就会自动发版（`.github/workflows/release.yml`）：

```bash
npm version patch --no-git-tag-version   # 或 minor / major，改 package.json
git commit -am "chore: 发版 0.9.1"
git push
git tag -a v0.9.1 -m "v0.9.1"
git push origin v0.9.1                   # ← 这一步触发整个流程
```

流程分三段，任何一段红了后面都不跑：

1. **test** —— Node 20 / 22 双档跑全套单测，和 `test.yml` 用同一套装法；
2. **publish** —— 先校验「标签版本 == `package.json` 版本」（对不上直接红，因为 npm 上的版本号发出去就改不了），再查 registry 上有没有这个版本（有就跳过），然后 `npm publish --access public --provenance`，发完回查一次确认真的能查到；
3. **release** —— 从上一个标签列提交，拼正文，建 GitHub Release。

Release 的正文格式固定成四段，由 `.github/scripts/release-body.mjs` 生成：

````markdown
<package.json 的 description>

## 本次变更
- feat: …
- fix: …          ← 自动列上一个 tag 到本 tag 的提交，merge 与「发版」提交会被过滤

## 安装
```powershell
cd <DSH profile 目录>
npm install dsh-cura@0.9.1
```

## 链接
- npm：https://www.npmjs.com/package/dsh-cura/v/0.9.1
- 提交对比：…/compare/v0.9.0...v0.9.1
````

想给某一版写人话（推荐），加一个 `release-notes/v0.9.1.md`：第一行写 `# 标题`，标题就用它、其余进「本次变更」；不写标题就整份进正文。有这个文件就不再列提交。

需要仓库里配 `NPM_TOKEN`（Settings → Secrets → Actions），权限是 npm 的 Automation token；`--provenance` 需要 workflow 的 `id-token: write`，已经在文件里给了。

### 发版演练

标签格式或正文想先看一眼再真发？手动触发时勾上 `dry_run`：

```bash
gh workflow run release.yml -f tag=v0.10.0 -f dry_run=true
```

演练模式照样跑完整测试和全部校验（版本号对不对得上、registry 上有没有、正文怎么拼），然后把 Release 标题和正文打在日志里，**不发 npm、不建 Release**。这时候标签可以还不存在——反正不发布，就是拿来看格式的；`git describe` 找不到就退回用当前检出点当终点。

确认没问题，推同名标签，同一条流水线会真发。演练与真发按「目标标签」排队（不是按 ref），所以演练还没跑完时推标签不会两边抢同一个版本号。

## Roadmap

- [x] 情境→表达规则库：LLM 从聊天记录抽取 `{"situation","style"}` 规则入库，按情境检索注入（MaiBot 1.x 模式）
- [ ] 回复意愿门控：数值意愿 + 一次 yes/no "读空气"调用，决定是否回复（MaiBot 0.6 公式）
- [ ] dsh-mneme 深度联动：QQ 会话独立记忆域（agentPreset scope 隔离）
- [ ] 手机健康数据导入：Apple Health export.zip / Health Connect 导出文件解析入库（本机解析，不上传）
- [ ] DSH 设置页 Remote 面板（照 dsh-onebot settings-remote 契约）
- [ ] QQ 语音通话里的语音导航：amap MCP 算路 + TTS 逐步播报（过渡方案 `say_aloud` 即可做）；真正的通话内导航等通话引擎 RX 复活后再做
- [x] 管家面板页（高德先行）：面板填 key → 写 `travel.json` → 自动挂 `amap`（所有会话），带真连测试；其余 server 仍走 Config
- [x] 管家面板第二页（瑞幸）：面板填 token → 写 `luckin.json` → 自动挂 `my-coffee`（所有会话），探针只握手不试调（避免误下单）
- [x] 生活关怀层（`lib/care.js`）：健康汇总 / 周期关怀 / 常用坐标 / 管家 MCP 从 QQ 会话解耦，挂到插件根 ctx，DSH 任何会话都能用；`careGlobal=false` 可退回旧行为
- [ ] 管家面板通用化：butlerServers 可视化编辑 + 各 server 连接状态展示
- [ ] 语音通话 RX 复活（等上游 KoishiRTC/oldhan13 解决 Windows 回放路由后，改一行配置即恢复）

## 致谢

- [Touch-Night/KoishiRTC](https://github.com/Touch-Night/KoishiRTC) 与 [oldhan13/napcat-qq-voice-call-win](https://github.com/oldhan13/napcat-qq-voice-call-win) —— QQ 原生语音通话桥的实现与 Windows 部署手册
- [ClaudiaGardner/maibot-qq-voice-call](https://github.com/ClaudiaGardner/maibot-qq-voice-call) —— AVSDK Host 的原始实现
- [NapNeko/dsh-onebot-qq](https://github.com/NapNeko/dsh-onebot-qq) —— QQ 通道层（本插件贴附的宿主）
- [MaiM-with-u/MaiBot](https://github.com/MaiM-with-u/MaiBot) —— 拟人化回复的诸多配方来源
- [tabler/tabler-icons](https://github.com/tabler/tabler-icons) —— 面板图标（MIT，`<path d>` 数据内联在 `lib/client.js` 的 `ICON_PATHS`，版权声明见仓库根 [NOTICE](NOTICE)）

## 免责声明

本项目对接的 QQ 通话桥使用腾讯未公开协议能力，存在账号风控风险，请自担风险、小号先行。不要用于骚扰、群发或任何违反平台规则与法律法规的场景。
