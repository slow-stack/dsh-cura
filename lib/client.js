/**
 * dsh-cura — client bundle（Cura 面板：侧边栏入口 + main 面板，内含
 * 「表达规则 / 语音通话」两页）
 *
 * 结构模板：dsh-onebot lib/client.js（CJS 包裹 + slots/remote 挂载模式，已验证先例）。
 *
 * 宿主装载契约（对照 dsh-client-modules 校验与 dsh-onebot 先例）：
 *   - CJS 包裹：banner `window.__ModuleLoader__.load({ id, factory: (require) => {`，
 *     footer `return module.exports; } });`；externals 仅 react（平台冻结模块表）。
 *   - 入口导出 `inject`（宿主客户端服务名数组）与 `apply(ctx) => disposer`。
 *   - 侧边栏入口：root 作用域 `sidebar.panellist` list slot（id/order/label + 图标组件）；
 *   - 面板本体：root 作用域 `main` keyed slot，key 与 panellist 的 id 一致。
 *     注意：面板组件用「闭包直传 props」（dsh-onebot 同款）——slots 的 inject
 *     管道不保证透传任意键，上版走 inject 导致面板空白。
 *   - 数据通道：Typert Remote（`ctx.remote.$mount(...)` 后 `ctx.get('remote.<ns>')`）；
 *     宿主侧 lib/rules-remote.js（两侧 descriptor 逐字对齐，全 positional）。
 */

window.__ModuleLoader__.load({
	id: "dsh-cura",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		//#region 外部模块（平台冻结表内：react）
		var reactModule = require("react");
		var React = reactModule != null && typeof reactModule.createElement === "function"
			? reactModule
			: reactModule.default;
		if (React == null || typeof React.createElement !== "function") {
			throw new Error("dsh-cura client: react 不可用");
		}
		//#endregion

		//#region 常量
		var PLUGIN_ID = "dsh-cura";
		var PANEL_ID = "cura";
		var REMOTE_NS = "curaRules";
		var NS = "cura";
		var SCOPES = ["scene", "global", "ban"];
		var SCOPE_NAME = { scene: "情境", global: "全局", ban: "禁止" };
		var SRC_NAME = { seed: "内置", manual: "手动", learned: "学习" };
		var FILTERS = [["all", "全部"], ["scene", "情境"], ["global", "全局"], ["ban", "禁止"], ["learned", "学习的"], ["manual", "手动的"]];
		//#endregion

		//#region 样式（作用域前缀 aqr-；颜色走宿主 dsw-alias 变量，主题自动跟随）
		var CSS = [
			".aqr-root{min-height:100%;box-sizing:border-box;padding:20px 24px 48px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}",
			".aqr-inner{max-width:980px;margin:0 auto}",
			".aqr-h1{margin:0 0 2px;font-size:18px;font-weight:600}",
			".aqr-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0 0 12px}",
			".aqr-pages{display:flex;gap:18px;border-bottom:0.5px solid var(--dsw-alias-border-l2);margin:0 0 16px}",
			".aqr-page-tab{background:transparent;border:0;cursor:pointer;font:inherit;font-size:13.5px;color:var(--dsw-alias-label-tertiary);padding:6px 2px 9px;position:relative}",
			".aqr-page-tab:hover{color:var(--dsw-alias-label-primary)}",
			".aqr-page-tab[data-on=true]{color:var(--dsw-alias-label-primary)}",
			".aqr-page-tab[data-on=true]:after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary)}",
			".aqr-card{background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1));border:0.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l3));border-radius:12px;padding:14px 16px;margin-bottom:14px;transition:box-shadow .15s ease,transform .15s ease}",
			".aqr-card:hover{box-shadow:0 2px 12px rgba(0,0,0,.06)}",
			".aqr-h1{background:linear-gradient(90deg,var(--dsw-alias-state-business-primary),var(--dsw-alias-label-primary));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}",
			".aqr-page-tab[data-on=true]{color:var(--dsw-alias-state-business-primary);font-weight:600}",
			".aqr-page-tab[data-on=true]:after{background:var(--dsw-alias-state-business-primary)}",
			".aqr-card h2{margin:0 0 10px;font-size:14.5px;font-weight:600}",
			".aqr-chip{display:inline-block;background:var(--dsw-alias-bg-module-platform);border-radius:999px;padding:2px 10px;font-size:12px;margin:2px 8px 2px 0}",
			".aqr-btn{border:0.5px solid var(--dsw-alias-border-l3);background:transparent;border-radius:8px;padding:4px 12px;cursor:pointer;font:inherit;font-size:12.5px;color:inherit}",
			".aqr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".aqr-btn:disabled{opacity:.5;cursor:default}",
			".aqr-btn-primary{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:#fff}",
			".aqr-btn-danger{color:var(--dsw-alias-state-error-primary)}",
			".aqr-btn-sm{padding:1px 8px;font-size:11.5px;margin-left:4px}",
			".aqr-input,.aqr-select,.aqr-textarea{border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12.5px;padding:5px 8px;outline:none}",
			".aqr-input:focus-visible,.aqr-select:focus-visible,.aqr-textarea:focus-visible{border-color:var(--dsw-alias-state-business-primary)}",
			".aqr-textarea{width:100%;resize:vertical;box-sizing:border-box}",
			".aqr-fill{width:100%;box-sizing:border-box}",
			".aqr-grid{display:grid;grid-template-columns:230px 1fr;gap:8px;margin-bottom:8px}",
			".aqr-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".aqr-tabs{margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap}",
			".aqr-tab{border-radius:999px}",
			".aqr-tab[data-on=true]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-label-primary)}",
			".aqr-table{width:100%;border-collapse:collapse}",
			".aqr-table th,.aqr-table td{text-align:left;padding:6px 8px;border-bottom:0.5px solid var(--dsw-alias-border-l2);vertical-align:top;font-size:12.5px}",
			".aqr-table th{color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:11.5px;white-space:nowrap}",
			".aqr-sit{width:24%}.aqr-style{width:38%}.aqr-kw{width:16%;color:var(--dsw-alias-label-tertiary)}",
			".aqr-tag{display:inline-block;border-radius:5px;padding:0 7px;font-size:11px;margin-right:4px;white-space:nowrap;background:var(--dsw-alias-bg-module-platform)}",
			".aqr-off{opacity:.45}",
			".aqr-editing .aqr-input,.aqr-editing .aqr-select{width:100%;box-sizing:border-box}",
			".aqr-msg{margin-left:10px;font-size:12px;color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-secondary))}",
			".aqr-err{color:var(--dsw-alias-state-error-primary);margin:0 0 10px}",
			".aqr-empty{color:var(--dsw-alias-label-tertiary);padding:10px 0}",
			".aqr-li{margin:0;padding:0;list-style:none}",
			".aqr-li li{padding:4px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2);display:flex;align-items:baseline;gap:8px}",
			".aqr-li li:last-child{border-bottom:0}",
			".aqr-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none;position:relative;top:-1px}",
			".aqr-dot[data-ok=true]{background:var(--dsw-alias-state-success-primary,#22a06b)}",
			".aqr-dot[data-ok=false]{background:var(--dsw-alias-state-error-primary,#d64545)}",
			".aqr-kv{color:var(--dsw-alias-label-tertiary)}",
			".aqr-note{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:6px 0 0}",
			".aqr-flex{display:flex;gap:18px;align-items:center;flex-wrap:wrap}",
			".aqr-flex-col{display:flex;flex-direction:column;gap:6px;min-width:240px;flex:1}",
			".aqr-charts-row{display:flex;gap:14px;flex-wrap:wrap;align-items:stretch}",
			".aqr-chart{background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:10px 12px;box-sizing:border-box}",
			".aqr-chart-title{color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-top:6px;text-align:center}",
			".aqr-status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none}",
			".aqr-tile{background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:10px 14px;box-sizing:border-box;min-width:150px;flex:1}",
			".aqr-tile-head{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11.5px}",
			".aqr-tile-value{font-size:20px;font-weight:700;margin-top:4px}",
			".aqr-tile-unit{font-size:12px;font-weight:400;color:var(--dsw-alias-label-tertiary)}",
			".aqr-tile-dir{font-size:12px;font-weight:600;margin-left:4px}",
			".aqr-tile-nodata{color:var(--dsw-alias-label-tertiary);font-weight:400}",
			".aqr-prov-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}",
			".aqr-prov{flex:1;min-width:200px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l3);border-radius:10px;padding:10px 12px;cursor:pointer;text-align:left;font:inherit;color:inherit;display:flex;flex-direction:column;gap:3px}",
			".aqr-prov:hover{border-color:var(--dsw-alias-state-business-primary)}",
			".aqr-prov[data-on=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1.5px var(--dsw-alias-state-business-primary)}",
			".aqr-prov-name{font-weight:600;font-size:13px}",
			".aqr-prov-desc{color:var(--dsw-alias-label-tertiary);font-size:11.5px}",
			".aqr-cal-grid{display:grid;grid-template-columns:repeat(7,46px);gap:3px;justify-content:center}",
			".aqr-cal-head{color:var(--dsw-alias-label-tertiary);font-size:11.5px;text-align:center;padding:4px 0}",
			".aqr-cal-cell{height:48px;display:flex;align-items:center;justify-content:center}",
			".aqr-cal-empty{opacity:0}",
			".aqr-cal-box{position:relative;width:42px;height:42px}",
			".aqr-cal-svg{position:absolute;left:0;top:0}",
			".aqr-cal-num{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-size:12.5px;color:var(--dsw-alias-label-primary)}",
			".aqr-cal-today .aqr-cal-num{font-weight:700;color:var(--dsw-alias-state-business-primary)}",
			".aqr-legend{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-top:10px}",
			".aqr-lg-mark{font-weight:700;margin-right:4px}",
		].join("\n");
		//#endregion

		//#region 词条
		var DICT = {
			zh: {
				panel: "Cura",
				title: "Cura · QQ 伴生增强",
				sub: "拟人化规则库 + 语音链路——改动实时落盘，下一条消息即生效，无需重启",
				pageRules: "表达规则",
				pageVoice: "语音通话",
				learnNow: "立即学习一次",
				learning: "已触发…",
				exportJson: "导出 JSON",
				addTitle: "新增规则",
				addScopeScene: "情境规则（按话题匹配注入）",
				addScopeGlobal: "全局说话方式（始终注入）",
				addScopeBan: "反面清单（始终禁止类）",
				phSituation: "情境：用户…（如：用户抱怨加班）",
				phStyle: "该怎么接（如：跟着吐槽一句+轻推休息；示例：「别硬扛啊，躺会儿」）",
				phKeywords: "触发词，逗号分隔（如：加班, 累, 下班）",
				add: "添加规则",
				colEnabled: "启用", colScope: "类型", colSituation: "情境", colStyle: "表达", colKeywords: "触发词", colSource: "来源", colActions: "操作",
				searchPh: "搜索规则…",
				edit: "编辑", del: "删除", save: "保存", cancel: "取消",
				needBoth: "情境和表达都不能为空",
				saved: "已保存", added: "已添加", deleted: "已删除",
				delConfirm: "删除这条规则？",
				learnTriggered: "学习已触发，稍后刷新看结果",
				empty: "（无）",
				learnNever: "上次学习：从未",
				learnAt: "上次学习",
				cursor: "游标",
				cursorUnset: "未建",
				learnOff: "学习未启用（未配置 targetUser 或 learnEnabled=false）",
				voiceProxy: "大脑代理（127.0.0.1）",
				voiceProxyAlive: "在线",
				voiceProxyDown: "离线",
				voiceEngine: "通话引擎托管",
				voiceEngineManaged: "已托管（引擎目录存在）",
				voiceEngineNoDir: "已托管但目录缺失",
				voiceEngineOff: "未托管（enginePython/engineDir 未配置）",
				voiceStt: "语音识别（faster-whisper 包装器）",
				voiceTtsTitle: "TTS 四保险链（say.ps1）",
				voiceReady: "就绪",
				voiceMissing: "缺文件",
				voiceTryTitle: "试听（走完整四保险链，优先用配置的音色）",
				voiceTryPh: "让它说一句…（200 字内）",
				voiceTryBtn: "合成并播放",
				voiceTryBusy: "合成中…（最长 2 分钟）",
				voiceCallNote: "QQ 原生语音通话：桥与引擎已就绪，等上游 KoishiRTC 修复 Windows 回放路由后改配置即恢复；DSH 内语音（say_aloud / voice_chat 工具）现已可用。",
				pageHealth: "健康日志",
				pageCycle: "周期关怀",
				healthSummary: "近 7 天",
				healthAdd: "记一条",
				healthHabits: "关注目标",
				healthLogs: "日志",
				phDate: "日期（缺省今天）",
				phSleepHours: "睡眠时长（小时，0-24）",
				phSleepQuality: "睡眠质量 1-5（5 最好）",
				phMood: "情绪 1-5（5 最好）",
				phExercise: "运动（如：跑步30分钟）",
				phWeight: "体重（kg）",
				phBpSys: "血压高压（收缩压）",
				phBpDia: "血压低压（舒张压）",
				phPulse: "心率（次/分）",
				phNotes: "备注（如：有点累）",
				tileWeight: "体重",
				tileBp: "血压",
				tilePulse: "心率",
				healthTrends: "体征趋势",
				statusGreen: "正常",
				statusOrange: "偏高",
				statusRed: "异常",
				healthAddBtn: "记录",
				phSleepTarget: "目标睡眠（小时）",
				phExerciseWeekly: "每周运动目标（次）",
				phFocusNote: "想让 TA 额外关注什么",
				saveBtn: "保存",
				colDate: "日期", colSleep: "睡眠", colMood: "情绪", colExercise: "运动", colNotes: "备注", colActions: "操作",
				logged: "已记录",
				habitsSaved: "目标已保存",
				healthPrivacy: "健康数据只存在本机 health.json，不上传到任何地方；记录来自你自己在聊天里说的，Cura 每轮会看到近 7 天汇总。",
				cycleIntro: "周期关怀：让 Cura 知道每个月的状态起伏——经期多照顾、卵泡期推学习、排卵期排表达类任务、经前别硬催。默认关闭；开启后数据同样只存本机。",
				cycleEnable: "开启周期关怀",
				cycleDisable: "停用",
				cycleEnabledTag: "已启用",
				cycleLastStart: "末次月经第一天",
				cycleLengthLabel: "周期长度（天，21-45）",
				periodLengthLabel: "经期天数（2-10）",
				cycleToday: "今日状态",
				cycleNext: "下次月经",
				cycleOvu: "预估排卵日",
				cycleDayLabel: "周期第",
				cycleAdviceTitle: "四个阶段的相处建议（可改，Cura 每轮会读）",
				cycleSaveBtn: "保存周期设置",
				cycleSaved: "周期设置已保存",
				calendarTitle: "这个月",
				legendPeriod: "月经期（虚线=预测）",
				legendOvu: "排卵窗",
				legendToday: "今天",
				chartHealth: "健康一览",
				chartGauge: "健康水平",
				chartSleep: "睡眠（小时）· 虚线为目标",
				chartMood: "情绪 1-5",
				chartExercise: "运动",
				voiceModels: "语音模型接入",
				voiceProviderBuiltin: "内置四保险链（say.ps1）",
				voiceProviderBuiltinDesc: "开箱即用：火山复刻音色 → 云端 TTS → edge → 离线兜底",
				voiceProviderOpenai: "OpenAI 兼容 TTS 端点",
				voiceProviderOpenaiDesc: "火山方舟 / 阿里百炼 / OpenAI / 自建网关，音色随端点设计",
				voiceProviderLocal: "本地部署模型",
				voiceProviderLocalDesc: "GPT-SoVITS / CosyVoice / IndexTTS / Fish Speech，数据不出本机",
				builtinVoiceNote: "音色设计说明（告诉 agent 你的声音是什么样的，会进人设提示）",
				phBuiltinNote: "如：低音男声，温柔偏低沉",
				voiceOpenaiHint: "兼容 OpenAI POST /v1/audio/speech 的端点都能接：火山方舟、阿里百炼、OpenAI、自建网关。音色（voice）填端点的音色 ID——复刻、预设随你设计",
				voiceLocalHint: "本地部署参考：GPT-SoVITS api_v2、CosyVoice、IndexTTS、Fish Speech 各自 HTTP API。填 baseUrl（http/https 地址）+ 音色；选 custom 时按项目文档接",
				e2eTitle: "端到端语音对话模型",
				e2eEnable: "启用端到端模型（说话进→语音出，无 ASR/TTS 中间层）",
				e2eHint: "可选：GLM-Realtime / Qwen-Omni / OpenAI Realtime / 自建。当前通话引擎是 ASR→LLM→TTS 管线，这里先落配置层；启用后按 provider 接入引擎",
				callTitle: "来电设置",
				callAutoAccept: "自动接听白名单来电",
				callWhitelist: "QQ 语音来电白名单（每行一个 QQ 号）",
				callRing: "通话时长上限（分钟，1-60）",
				callGreeting: "接通问候语",
				callFarewell: "告别后自动挂断",
				callHint: "保存后自动写回引擎 config.json（白名单/问候语/时长），引擎重启生效；engineDir 未配置时只存本机 voice.json",
				voiceSave: "保存语音配置",
				voiceSaved: "语音配置已保存",
				phVoiceModel: "模型名（如 cosyvoice-v2）",
				phVoiceId: "音色 ID / 音色名",
				phApiKey: "API Key（留空 = 不修改）",
				phApiBase: "API 地址（https://…）",
				medicalNote: "生活方式参考，不是医疗建议；经期严重疼痛或明显紊乱请就医。",
				checkinTitle: "今日打卡",
				flowLabel: "经量",
				symptomsLabel: "症状：",
				periodToday: "月经今天来了",
				periodConfirm: "把「末次月经第一天」更新为今天，并记入历史？预测会随之刷新。",
				periodRecorded: "已记录，预测已刷新",
				checkinSave: "记录今日状态",
				checkinSaved: "打卡已记录",
				cycleEnableHint: "先在上方的周期设置里开启并填好末次月经日期，打卡才会可用",
				cycleStatsTitle: "周期统计",
				statsAvg: "平均周期",
				remoteFail: "Remote 调用失败",
			},
			en: {
				panel: "Cura",
				title: "Cura · QQ Companion",
				sub: "Expression rules + voice pipeline — edits apply to the next message, no restart",
				pageRules: "Expression Rules",
				pageVoice: "Voice Call",
				learnNow: "Learn now",
				learning: "Triggered…",
				exportJson: "Export JSON",
				addTitle: "Add rule",
				addScopeScene: "Scene rule (matched by topic)",
				addScopeGlobal: "Global style (always injected)",
				addScopeBan: "Ban list (always forbidden)",
				phSituation: "Situation: user… (e.g. user complains about overtime)",
				phStyle: "How to respond (may include a sample line)",
				phKeywords: "Trigger words, comma separated",
				add: "Add rule",
				colEnabled: "On", colScope: "Type", colSituation: "Situation", colStyle: "Expression", colKeywords: "Keywords", colSource: "Source", colActions: "Actions",
				searchPh: "Search rules…",
				edit: "Edit", del: "Delete", save: "Save", cancel: "Cancel",
				needBoth: "Situation and expression are both required",
				saved: "Saved", added: "Added", deleted: "Deleted",
				delConfirm: "Delete this rule?",
				learnTriggered: "Learning triggered — refresh later to see results",
				empty: "(empty)",
				learnNever: "Last learn: never",
				learnAt: "Last learn",
				cursor: "Cursor",
				cursorUnset: "unset",
				learnOff: "Learning disabled (no targetUser, or learnEnabled=false)",
				voiceProxy: "Brain proxy (127.0.0.1)",
				voiceProxyAlive: "online",
				voiceProxyDown: "offline",
				voiceEngine: "Call engine hosting",
				voiceEngineManaged: "hosted (engine dir present)",
				voiceEngineNoDir: "hosted but dir missing",
				voiceEngineOff: "not hosted (enginePython/engineDir unset)",
				voiceStt: "Speech recognition (faster-whisper wrapper)",
				voiceTtsTitle: "TTS four-tier fallback chain (say.ps1)",
				voiceReady: "ready",
				voiceMissing: "missing files",
				voiceTryTitle: "Audition (full chain, first tier is the cloned voice)",
				voiceTryPh: "Make it say something… (≤200 chars)",
				voiceTryBtn: "Synthesize & play",
				voiceTryBusy: "Synthesizing… (up to 2 min)",
				voiceCallNote: "QQ native voice call: bridge & engine ready, will return once upstream KoishiRTC fixes Windows playback routing; in-DSH voice (say_aloud / voice_chat tools) available now.",
				pageHealth: "Health Log",
				pageCycle: "Cycle Care",
				healthSummary: "Last 7 days",
				healthAdd: "Add entry",
				healthHabits: "Goals",
				healthLogs: "Log",
				phDate: "Date (default today)",
				phSleepHours: "Sleep hours (0-24)",
				phSleepQuality: "Sleep quality 1-5",
				phMood: "Mood 1-5",
				phExercise: "Exercise (e.g. run 30min)",
				phNotes: "Notes",
				healthAddBtn: "Log it",
				phSleepTarget: "Sleep target (h)",
				phExerciseWeekly: "Weekly exercise target",
				phFocusNote: "What should Cura watch for",
				saveBtn: "Save",
				colDate: "Date", colSleep: "Sleep", colMood: "Mood", colExercise: "Exercise", colNotes: "Notes", colActions: "Actions",
				logged: "Logged",
				habitsSaved: "Goals saved",
				healthPrivacy: "Health data stays in local health.json — nothing is uploaded; Cura sees a 7-day summary each turn.",
				cycleIntro: "Cycle care lets Cura know your monthly rhythm — gentler during the period, push learning in the follicular phase, schedule expression-heavy tasks around ovulation, ease off pre-period. Off by default; data stays local.",
				cycleEnable: "Enable cycle care",
				cycleDisable: "Disable",
				cycleEnabledTag: "enabled",
				cycleLastStart: "Last period start",
				cycleLengthLabel: "Cycle length (days, 21-45)",
				periodLengthLabel: "Period days (2-10)",
				cycleToday: "Today",
				cycleNext: "Next period",
				cycleOvu: "Estimated ovulation",
				cycleDayLabel: "cycle day",
				cycleAdviceTitle: "Phase advice (editable, read every turn)",
				cycleSaveBtn: "Save cycle settings",
				cycleSaved: "Cycle settings saved",
				calendarTitle: "This month",
				legendPeriod: "Period (dashed = predicted)",
				legendOvu: "Ovulation window",
				legendToday: "Today",
				chartHealth: "Health at a glance",
				chartGauge: "Health level",
				chartSleep: "Sleep (hours) · dashed = target",
				chartMood: "Mood 1-5",
				chartExercise: "Exercise",
				voiceModels: "Voice model integration",
				voiceProviderBuiltin: "Built-in fallback chain (say.ps1)",
				voiceProviderOpenai: "OpenAI-compatible TTS endpoint",
				voiceProviderLocal: "Locally deployed model",
				builtinVoiceNote: "Voice design notes (told to the agent)",
				phBuiltinNote: "e.g. deep male voice, cloned timbre, gentle",
				voiceOpenaiHint: "Any endpoint compatible with OpenAI POST /v1/audio/speech works",
				voiceLocalHint: "Local deploy: GPT-SoVITS api_v2 / CosyVoice / IndexTTS / Fish Speech HTTP APIs",
				e2eTitle: "End-to-end voice model",
				e2eEnable: "Enable end-to-end model (speech in, speech out)",
				e2eHint: "GLM-Realtime / Qwen-Omni / OpenAI Realtime / custom; config layer now, engine wiring later",
				callTitle: "Incoming call settings",
				callAutoAccept: "Auto-accept whitelisted calls",
				callWhitelist: "QQ voice-call whitelist (one number per line)",
				callRing: "Max call duration (minutes)",
				callGreeting: "Greeting on connect",
				callFarewell: "Auto hang up after goodbye",
				callHint: "Saved to voice.json and written back into engine config.json; engine picks it up on restart",
				voiceSave: "Save voice settings",
				voiceSaved: "Voice settings saved",
				phVoiceModel: "Model name",
				phVoiceId: "Voice ID / name",
				phApiKey: "API key (empty = unchanged)",
				phApiBase: "API URL (https://…)",
				medicalNote: "Lifestyle reference, not medical advice; see a doctor for severe pain or irregular cycles.",
				checkinTitle: "Daily check-in",
				flowLabel: "Flow",
				symptomsLabel: "Symptoms:",
				periodToday: "Period started today",
				periodConfirm: "Set last period start to today and add to history? Predictions will refresh.",
				periodRecorded: "Recorded, predictions refreshed",
				checkinSave: "Save today",
				checkinSaved: "Check-in saved",
				cycleEnableHint: "Enable cycle care and fill in last period start first",
				cycleStatsTitle: "Cycle statistics",
				statsAvg: "Average cycle",
				remoteFail: "Remote call failed",
			},
		};
		//#endregion

		//#region 极简 schema 校验（供 Typert 严格 codec 使用；与 dsh-onebot 模板同款）
		function vString(min, max) {
			return {
				parse(value) {
					if (typeof value !== "string" || value.length < min || value.length > max) {
						throw new TypeError("expected string(" + min + ".." + max + ")");
					}
					return value;
				},
			};
		}
		function vInt(min) {
			return {
				parse(value) {
					if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
						throw new TypeError("expected int>=" + min);
					}
					return value;
				},
			};
		}
		function vNumber() {
			return {
				parse(value) {
					if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("expected finite number");
					return value;
				},
			};
		}
		function vBoolean() {
			return {
				parse(value) {
					if (typeof value !== "boolean") throw new TypeError("expected boolean");
					return value;
				},
			};
		}
		function vArray(item) {
			return {
				parse(value) {
					if (!Array.isArray(value)) throw new TypeError("expected array");
					return value.map((entry) => item.parse(entry));
				},
			};
		}
		function vOptional(inner) {
			return {
				parse(value) {
					if (value === undefined || value === null) return undefined;
					return inner.parse(value);
				},
			};
		}
		function vObject(shape) {
			return {
				parse(value) {
					if (value === null || typeof value !== "object" || Array.isArray(value)) {
						throw new TypeError("expected object");
					}
					var out = {};
					for (var key of Object.keys(shape)) out[key] = shape[key].parse(value[key]);
					return out;
				},
			};
		}
		//#endregion

		//#region Typert Remote descriptor（与宿主 lib/rules-remote.js 方法面逐字对齐，全 positional）
		var ruleSchema = vObject({
			id: vString(1, 64),
			scope: vString(1, 16),
			situation: vString(0, 200),
			style: vString(0, 400),
			keywords: vArray(vString(0, 64)),
			weight: vOptional(vNumber()),
			source: vOptional(vString(0, 16)),
			enabled: vOptional(vBoolean()),
			createdAt: vOptional(vString(0, 40)),
		});
		var snapshotSchema = vObject({
			rules: vArray(ruleSchema),
			learn: vObject({
				cursorSeq: vOptional(vInt(0)),
				lastLearnAt: vOptional(vString(0, 64)),
				maxRules: vInt(0),
				enabled: vBoolean(),
			}),
			file: vString(0, 1024),
		});
		var startedSchema = vObject({ started: vBoolean() });
		var ruleInputSchema = vObject({
			scope: vOptional(vString(0, 16)),
			situation: vString(0, 200),
			style: vString(0, 400),
			keywords: vOptional(vArray(vString(0, 64))),
		});
		var rulePatchSchema = vObject({
			scope: vOptional(vString(0, 16)),
			situation: vOptional(vString(0, 200)),
			style: vOptional(vString(0, 400)),
			keywords: vOptional(vArray(vString(0, 64))),
		});
		var voiceInfoSchema = vObject({
			proxy: vObject({ port: vInt(0), alive: vBoolean() }),
			engine: vObject({
				managed: vBoolean(),
				python: vOptional(vString(0, 512)),
				dir: vOptional(vString(0, 512)),
				dirExists: vOptional(vBoolean()),
			}),
			sayScript: vOptional(vString(0, 512)),
			stt: vOptional(vObject({ script: vOptional(vString(0, 512)), ready: vOptional(vBoolean()) })),
			tts: vArray(vObject({ tier: vInt(0), name: vString(0, 160), ready: vBoolean() })),
			errors: vOptional(vArray(vString(0, 300))),
		});
		var voiceTestSchema = vObject({
			audio: vString(1, 8000000),
			bytes: vOptional(vInt(0)),
		});
		var voiceOpenaiSchema = vObject({
			baseUrl: vOptional(vString(0, 300)),
			model: vOptional(vString(0, 120)),
			voice: vOptional(vString(0, 160)),
			apiKey: vOptional(vString(0, 200)),
			format: vOptional(vString(0, 8)),
			speed: vOptional(vNumber()),
		});
		var voiceLocalSchema = vObject({
			engine: vOptional(vString(0, 24)),
			baseUrl: vOptional(vString(0, 300)),
			voice: vOptional(vString(0, 160)),
			apiKey: vOptional(vString(0, 200)),
			note: vOptional(vString(0, 300)),
		});
		var voiceConfigSchema = vObject({
			version: vOptional(vInt(0)),
			tts: vObject({
				provider: vString(1, 16),
				builtinVoiceNote: vOptional(vString(0, 300)),
				openai: vOptional(voiceOpenaiSchema),
				local: vOptional(voiceLocalSchema),
			}),
			e2e: vObject({
				enabled: vBoolean(),
				provider: vOptional(vString(0, 24)),
				baseUrl: vOptional(vString(0, 300)),
				model: vOptional(vString(0, 120)),
				apiKey: vOptional(vString(0, 200)),
				voice: vOptional(vString(0, 160)),
				note: vOptional(vString(0, 300)),
			}),
			call: vObject({
				autoAccept: vBoolean(),
				whitelist: vArray(vString(1, 12)),
				ringTimeoutSec: vOptional(vInt(0)),
				farewellHangup: vOptional(vBoolean()),
				greeting: vOptional(vString(0, 200)),
				maxDurationMin: vOptional(vInt(0)),
			}),
			updatedAt: vOptional(vString(0, 40)),
		});
		var voicePatchSchema = vObject({
			tts: vOptional(vObject({
				provider: vOptional(vString(0, 16)),
				builtinVoiceNote: vOptional(vString(0, 300)),
				openai: vOptional(voiceOpenaiSchema),
				local: vOptional(voiceLocalSchema),
			})),
			e2e: vOptional(vObject({
				enabled: vOptional(vBoolean()),
				provider: vOptional(vString(0, 24)),
				baseUrl: vOptional(vString(0, 300)),
				model: vOptional(vString(0, 120)),
				apiKey: vOptional(vString(0, 200)),
				voice: vOptional(vString(0, 160)),
				note: vOptional(vString(0, 300)),
			})),
			call: vOptional(vObject({
				autoAccept: vOptional(vBoolean()),
				whitelist: vOptional(vArray(vString(1, 12))),
				ringTimeoutSec: vOptional(vInt(0)),
				farewellHangup: vOptional(vBoolean()),
				greeting: vOptional(vString(0, 200)),
				maxDurationMin: vOptional(vInt(0)),
			})),
		});
		var healthLogSchema = vObject({
			id: vString(1, 64),
			date: vString(1, 10),
			sleepHours: vOptional(vNumber()),
			sleepQuality: vOptional(vInt(0)),
			mood: vOptional(vInt(0)),
			exercise: vOptional(vString(0, 200)),
			weight: vOptional(vNumber()),
			bpSystolic: vOptional(vInt(0)),
			bpDiastolic: vOptional(vInt(0)),
			pulse: vOptional(vInt(0)),
			notes: vOptional(vString(0, 500)),
			createdAt: vOptional(vString(0, 40)),
		});
		var healthSummarySchema = vObject({
			days: vInt(0),
			total: vInt(0),
			sleepAvg: vOptional(vNumber()),
			sleepCount: vInt(0),
			moodAvg: vOptional(vNumber()),
			exerciseCount: vInt(0),
			latest: vOptional(vObject({
				date: vString(0, 10),
				mood: vOptional(vInt(0)),
				notes: vOptional(vString(0, 500)),
				exercise: vOptional(vString(0, 200)),
			})),
		});
		var habitsSchema = vObject({
			sleepTarget: vOptional(vNumber()),
			exerciseWeekly: vOptional(vInt(0)),
			focusNote: vOptional(vString(0, 200)),
		});
		var cycleAdviceSchema = vObject({
			menstrual: vOptional(vString(0, 600)),
			follicular: vOptional(vString(0, 600)),
			ovulatory: vOptional(vString(0, 600)),
			luteal: vOptional(vString(0, 600)),
		});
		var cycleConfigSchema = vObject({
			enabled: vBoolean(),
			lastStart: vOptional(vString(0, 10)),
			cycleLength: vOptional(vInt(0)),
			periodLength: vOptional(vInt(0)),
			advice: vOptional(cycleAdviceSchema),
		});
		var cycleTodaySchema = vObject({
			cycleDay: vInt(0),
			cycleLength: vInt(0),
			periodLength: vOptional(vInt(0)),
			phase: vString(1, 16),
			phaseName: vString(1, 20),
			dayInPhase: vInt(0),
			ovulationDate: vOptional(vString(0, 10)),
			nextPeriodDate: vOptional(vString(0, 10)),
			nextPeriodInDays: vInt(0),
			advice: vOptional(vString(0, 600)),
		});
		var cycleStatsSchema = vObject({
			cycles: vInt(0),
			lengths: vArray(vInt(0)),
			avg: vOptional(vInt(0)),
			range: vOptional(vArray(vInt(0))),
		});
		var healthSnapshotSchema = vObject({
			habits: habitsSchema,
			cycle: vObject({ enabled: vBoolean(), config: vOptional(cycleConfigSchema), today: vOptional(cycleTodaySchema), stats: vOptional(cycleStatsSchema) }),
			logs: vArray(healthLogSchema),
			summary: healthSummarySchema,
			series: vOptional(vArray(vObject({
				date: vString(0, 10),
				label: vString(0, 8),
				sleepHours: vOptional(vNumber()),
				mood: vOptional(vInt(0)),
				exercise: vOptional(vBoolean()),
				weight: vOptional(vNumber()),
				bpSystolic: vOptional(vInt(0)),
				bpDiastolic: vOptional(vInt(0)),
				pulse: vOptional(vInt(0)),
			}))),
			tiles: vOptional(vArray(vObject({
				key: vString(0, 16),
				value: vOptional(vString(0, 20)),
				dir: vOptional(vString(0, 4)),
				delta: vOptional(vNumber()),
				unit: vOptional(vString(0, 12)),
				series: vOptional(vArray(vOptional(vNumber()))),
				status: vOptional(vString(0, 8)),
				target: vOptional(vNumber()),
			}))),
			score: vOptional(vObject({
				overall: vInt(0),
				label: vString(0, 20),
				parts: vOptional(vArray(vObject({ key: vString(0, 16), score: vInt(0) }))),
			})),
			file: vOptional(vString(0, 1024)),
		});
		var habitsPatchSchema = vObject({
			sleepTarget: vOptional(vNumber()),
			exerciseWeekly: vOptional(vInt(0)),
			focusNote: vOptional(vString(0, 200)),
		});
		var cyclePatchSchema = vObject({
			enabled: vOptional(vBoolean()),
			lastStart: vOptional(vString(0, 10)),
			cycleLength: vOptional(vInt(0)),
			periodLength: vOptional(vInt(0)),
			advice: vOptional(cycleAdviceSchema),
		});
		var healthLogInputSchema = vObject({
			date: vOptional(vString(0, 10)),
			sleepHours: vOptional(vNumber()),
			sleepQuality: vOptional(vInt(0)),
			mood: vOptional(vInt(0)),
			exercise: vOptional(vString(0, 200)),
			weight: vOptional(vNumber()),
			bpSystolic: vOptional(vInt(0)),
			bpDiastolic: vOptional(vInt(0)),
			pulse: vOptional(vInt(0)),
			notes: vOptional(vString(0, 500)),
		});
		function strictCodec(typeSymbol, schema) {
			return { mode: "strict", typeSymbol: typeSymbol, create: () => schema, schema: schema };
		}
		function jsonParameter(name, typeSymbol, schema) {
			return { name: name, wire: name, source: "json", codec: strictCodec(typeSymbol, schema) };
		}
		function curaMethod(method, parameters, resultSchema, typeSymbol) {
			return {
				id: PLUGIN_ID + "#" + REMOTE_NS + "/" + method,
				service: REMOTE_NS,
				namespace: REMOTE_NS,
				method: method,
				invocation: { kind: "direct" },
				parameters: parameters,
				result: strictCodec(typeSymbol != null ? typeSymbol : "CuraRulesSnapshot", resultSchema || snapshotSchema),
			};
		}
		var CURA_RULES_DESCRIPTORS = [
			curaMethod("getRules", []),
			curaMethod("addRule", [jsonParameter("rule", "CuraRuleInput", ruleInputSchema)]),
			curaMethod("updateRule", [jsonParameter("id", "CuraRuleId", vString(1, 64)), jsonParameter("patch", "CuraRulePatch", rulePatchSchema)]),
			curaMethod("deleteRule", [jsonParameter("id", "CuraRuleId", vString(1, 64))]),
			curaMethod("toggleRule", [jsonParameter("id", "CuraRuleId", vString(1, 64)), jsonParameter("enabled", "CuraRuleEnabled", vBoolean())]),
			curaMethod("learnNow", [], startedSchema, "CuraLearnResult"),
			curaMethod("getVoiceInfo", [], voiceInfoSchema, "CuraVoiceInfo"),
			curaMethod("ttsTest", [jsonParameter("text", "CuraTtsText", vString(1, 200))], voiceTestSchema, "CuraVoiceTest"),
			curaMethod("getHealth", [], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("saveHealthConfig", [jsonParameter("patch", "CuraHabitsPatch", vObject({ habits: vOptional(habitsPatchSchema) }))], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("saveCycle", [jsonParameter("patch", "CuraCyclePatch", cyclePatchSchema)], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("addHealthLog", [jsonParameter("entry", "CuraHealthLogInput", healthLogInputSchema)], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("deleteHealthLog", [jsonParameter("id", "CuraLogId", vString(1, 64))], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("getVoiceConfig", [], voiceConfigSchema, "CuraVoiceConfig"),
			curaMethod("saveVoiceConfig", [jsonParameter("patch", "CuraVoicePatch", voicePatchSchema)], voiceConfigSchema, "CuraVoiceConfig"),
		];
		var CURA_RULES_REMOTE = { package: PLUGIN_ID, descriptors: CURA_RULES_DESCRIPTORS };
		//#endregion

		//#region Remote 结果处理（dsh-onebot 同款约定）
		function unwrap(result) {
			if (result != null && result.ok === true) return result.value;
			var detail = result != null && result.error != null ? result.error.message : "unknown remote error";
			var error = new Error(detail);
			if (result != null && result.error != null && result.error.code != null) error.code = result.error.code;
			throw error;
		}
		//#endregion

		//#region 组件
		function h(type, props) {
			var children = Array.prototype.slice.call(arguments, 2);
			return React.createElement.apply(React, [type, props].concat(children));
		}

		function RulesIcon(props) {
			var size = (props && props.size) || 20;
			return h("svg", {
				width: size, height: size, viewBox: "0 0 24 24", fill: "none",
				stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round",
				"aria-hidden": true,
			},
				h("path", { d: "M4 6h10M4 11h7M4 16h9" }),
				h("path", { d: "M17.5 13.5l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1 1-2.3z" }),
			);
		}

		function Dot(props) {
			return h("span", { className: "aqr-dot", "data-ok": props.ok === true, title: props.title || "" });
		}

		function scopeTag(scope) {
			return h("span", { className: "aqr-tag" }, SCOPE_NAME[scope] || scope);
		}
		function sourceTag(source) {
			var key = source || "seed";
			return h("span", { className: "aqr-tag" }, SRC_NAME[key] || key);
		}

		// ---------- 表达规则页 ----------
		function RulesPage(props) {
			var remote = props.remote;
			var t = props.t;
			var snapState = React.useState(null);
			var snap = snapState[0], setSnap = snapState[1];
			var errState = React.useState("");
			var err = errState[0], setErr = errState[1];
			var filterState = React.useState("all");
			var filter = filterState[0], setFilter = filterState[1];
			var searchState = React.useState("");
			var search = searchState[0], setSearch = searchState[1];
			var editingState = React.useState(null);
			var editing = editingState[0], setEditing = editingState[1];
			var msgState = React.useState("");
			var setMsg = msgState[1];
			var formState = React.useState({ scope: "scene", situation: "", style: "", keywords: "" });
			var form = formState[0], setForm = formState[1];
			var learnBusyState = React.useState(false);
			var learnBusy = learnBusyState[0], setLearnBusy = learnBusyState[1];

			var mountedRef = React.useRef(true);
			React.useEffect(function () {
				mountedRef.current = true;
				return function () { mountedRef.current = false; };
			}, []);

			function flash(text) {
				setMsg(text);
				setTimeout(function () { if (mountedRef.current) setMsg(""); }, 2500);
			}
			function applySnap(value) {
				if (mountedRef.current) setSnap(value);
			}
			function refresh() {
				remote.getRules().then(function (result) {
					applySnap(unwrap(result));
				}, function (e) {
					if (mountedRef.current) setErr(t("remoteFail") + "：" + (e && e.message ? e.message : String(e)));
				});
			}
			React.useEffect(refresh, []);

			function run(promise, doneText) {
				promise.then(function (result) {
					var value = unwrap(result);
					applySnap(value);
					if (doneText) flash(doneText);
					setErr("");
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}

			function addRule() {
				if (!form.situation.trim() || !form.style.trim()) { setErr(t("needBoth")); return; }
				run(remote.addRule({
					scope: form.scope,
					situation: form.situation.trim(),
					style: form.style.trim(),
					keywords: form.keywords,
				}), t("added"));
				setForm({ scope: form.scope, situation: "", style: "", keywords: "" });
			}
			function startEdit(rule) {
				setEditing({
					id: rule.id,
					draft: {
						scope: rule.scope,
						situation: rule.situation,
						style: rule.style,
						keywords: (rule.keywords || []).join(", "),
					},
				});
				setErr("");
			}
			function saveEdit() {
				if (!editing) return;
				if (!editing.draft.situation.trim() || !editing.draft.style.trim()) { setErr(t("needBoth")); return; }
				var draft = editing.draft;
				run(remote.updateRule(editing.id, {
					scope: draft.scope,
					situation: draft.situation.trim(),
					style: draft.style.trim(),
					keywords: draft.keywords,
				}), t("saved"));
				setEditing(null);
			}
			function delRule(id) {
				if (!window.confirm(t("delConfirm"))) return;
				run(remote.deleteRule(id), t("deleted"));
				if (editing && editing.id === id) setEditing(null);
			}
			function toggleRule(id, enabled) {
				run(remote.toggleRule(id, enabled));
			}
			function learnNow() {
				setLearnBusy(true);
				remote.learnNow().then(function (result) {
					unwrap(result);
					flash(t("learnTriggered"));
					setTimeout(function () { if (mountedRef.current) setLearnBusy(false); }, 4000);
				}, function (e) {
					if (mountedRef.current) { setLearnBusy(false); setErr(e && e.message ? e.message : String(e)); }
				});
			}
			function exportJson() {
				if (!snap) return;
				var blob = new Blob([JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), learn: snap.learn, rules: snap.rules }, null, 2)], { type: "application/json" });
				var url = URL.createObjectURL(blob);
				var a = document.createElement("a");
				a.href = url;
				a.download = "rules.json";
				a.click();
				setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
			}

			var rules = snap ? snap.rules : [];
			var q = search.trim().toLowerCase();
			var visible = rules.filter(function (r) {
				if (filter === "scene" || filter === "global" || filter === "ban") { if (r.scope !== filter) return false; }
				else if (filter === "learned" || filter === "manual") { if ((r.source || "") !== filter) return false; }
				if (q) {
					var hay = (r.situation + " " + r.style + " " + (r.keywords || []).join(" ")).toLowerCase();
					if (hay.indexOf(q) < 0) return false;
				}
				return true;
			});
			var order = { global: 0, ban: 1, scene: 2 };
			visible = visible.slice().sort(function (a, b) {
				var d = (order[a.scope] === undefined ? 9 : order[a.scope]) - (order[b.scope] === undefined ? 9 : order[b.scope]);
				if (d) return d;
				return String(a.id) < String(b.id) ? -1 : 1;
			});
			var enabledCount = rules.filter(function (r) { return r.enabled !== false; }).length;

			var rows = visible.map(function (rule) {
				if (editing && editing.id === rule.id) {
					var draft = editing.draft;
					var setDraft = function (key, value) {
						setEditing({ id: editing.id, draft: Object.assign({}, draft, (function () { var o = {}; o[key] = value; return o; })()) });
					};
					return h("tr", { key: rule.id, className: "aqr-editing" },
						h("td", null, h("input", { type: "checkbox", checked: true, disabled: true })),
						h("td", null,
							h("select", { className: "aqr-select", value: draft.scope, onChange: function (e) { setDraft("scope", e.target.value); } },
								SCOPES.map(function (s) { return h("option", { key: s, value: s }, SCOPE_NAME[s]); }))),
						h("td", null, h("input", { className: "aqr-input", value: draft.situation, onChange: function (e) { setDraft("situation", e.target.value); } })),
						h("td", null, h("textarea", { className: "aqr-textarea", rows: 3, value: draft.style, onChange: function (e) { setDraft("style", e.target.value); } })),
						h("td", null, h("input", { className: "aqr-input", value: draft.keywords, onChange: function (e) { setDraft("keywords", e.target.value); } })),
						h("td", null, sourceTag(rule.source)),
						h("td", null,
							h("button", { className: "aqr-btn aqr-btn-primary aqr-btn-sm", onClick: saveEdit }, t("save")),
							h("button", { className: "aqr-btn aqr-btn-sm", onClick: function () { setEditing(null); } }, t("cancel"))),
					);
				}
				return h("tr", { key: rule.id, className: rule.enabled === false ? "aqr-off" : "" },
					h("td", null, h("input", {
						type: "checkbox", checked: rule.enabled !== false,
						onChange: function (e) { toggleRule(rule.id, e.target.checked); },
					})),
					h("td", null, scopeTag(rule.scope)),
					h("td", { className: "aqr-sit" }, rule.situation),
					h("td", { className: "aqr-style" }, rule.style),
					h("td", { className: "aqr-kw" }, (rule.keywords || []).join(", ")),
					h("td", null, sourceTag(rule.source)),
					h("td", null,
						h("button", { className: "aqr-btn aqr-btn-sm", onClick: function () { startEdit(rule); } }, t("edit")),
						h("button", { className: "aqr-btn aqr-btn-danger aqr-btn-sm", onClick: function () { delRule(rule.id); } }, t("del"))),
				);
			});

			var learn = snap ? snap.learn : null;
			var cursorText = learn ? (learn.cursorSeq === undefined || learn.cursorSeq === null ? t("cursorUnset") : learn.cursorSeq) : "…";
			var learnText = learn
				? (learn.lastLearnAt
					? t("learnAt") + "：" + new Date(learn.lastLearnAt).toLocaleString() + " · " + t("cursor") + " " + cursorText
					: t("learnNever") + " · " + t("cursor") + " " + cursorText)
				: "…";

			return h("div", null,
				err ? h("p", { className: "aqr-err", role: "alert" }, err) : null,
				h("div", { className: "aqr-card" },
					h("span", { className: "aqr-chip" }, enabledCount + " / " + rules.length),
					h("span", { className: "aqr-chip" }, learnText),
					learn && !learn.enabled ? h("span", { className: "aqr-chip" }, t("learnOff")) : null,
					h("button", { className: "aqr-btn aqr-btn-primary", disabled: learnBusy || !snap, onClick: learnNow }, learnBusy ? t("learning") : t("learnNow")),
					h("button", { className: "aqr-btn", disabled: !snap, onClick: exportJson }, t("exportJson")),
					h("span", { className: "aqr-msg" }, msgState[0]),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("addTitle")),
					h("div", { className: "aqr-grid" },
						h("select", { className: "aqr-select", value: form.scope, onChange: function (e) { setForm(Object.assign({}, form, { scope: e.target.value })); } },
							h("option", { value: "scene" }, t("addScopeScene")),
							h("option", { value: "global" }, t("addScopeGlobal")),
							h("option", { value: "ban" }, t("addScopeBan"))),
						h("input", { className: "aqr-input aqr-fill", placeholder: t("phSituation"), value: form.situation, onChange: function (e) { setForm(Object.assign({}, form, { situation: e.target.value })); } }),
					),
					h("textarea", { className: "aqr-textarea", rows: 2, placeholder: t("phStyle"), value: form.style, onChange: function (e) { setForm(Object.assign({}, form, { style: e.target.value })); } }),
					h("div", { className: "aqr-grid", style: { marginTop: "8px", marginBottom: "0" } },
						h("input", { className: "aqr-input aqr-fill", placeholder: t("phKeywords"), value: form.keywords, onChange: function (e) { setForm(Object.assign({}, form, { keywords: e.target.value })); } }),
						h("div", { className: "aqr-row" },
							h("button", { className: "aqr-btn aqr-btn-primary", onClick: addRule }, t("add"))),
					),
				),
				h("div", { className: "aqr-card" },
					h("div", { className: "aqr-tabs" },
						FILTERS.map(function (f) {
							return h("button", {
								key: f[0], className: "aqr-btn aqr-tab", "data-on": filter === f[0],
								onClick: function () { setFilter(f[0]); setEditing(null); },
							}, f[1]);
						}),
						h("input", {
							className: "aqr-input", placeholder: t("searchPh"),
							value: search, style: { marginLeft: "auto", width: "180px" },
							onChange: function (e) { setSearch(e.target.value); },
						}),
					),
					h("table", { className: "aqr-table" },
						h("thead", null,
							h("tr", null,
								h("th", null, t("colEnabled")),
								h("th", null, t("colScope")),
								h("th", { className: "aqr-sit" }, t("colSituation")),
								h("th", { className: "aqr-style" }, t("colStyle")),
								h("th", { className: "aqr-kw" }, t("colKeywords")),
								h("th", null, t("colSource")),
								h("th", null, t("colActions")))),
						h("tbody", null,
							rows.length ? rows : h("tr", null, h("td", { colSpan: 7, className: "aqr-empty" }, snap ? t("empty") : "…"))),
					),
				),
			);
		}

		// ---------- 语音通话页（模型接入 + 来电设置 + 链路体检 + 试听） ----------
		function VoicePage(props) {
			var remote = props.remote;
			var t = props.t;
			var infoState = React.useState(null);
			var info = infoState[0], setInfo = infoState[1];
			var vcfgState = React.useState(null);
			var vcfg = vcfgState[0], setVcfg = vcfgState[1];
			var errState = React.useState("");
			var err = errState[0], setErr = errState[1];
			var msgState = React.useState("");
			var setMsg = msgState[1];
			var textState = React.useState("");
			var text = textState[0], setText = textState[1];
			var busyState = React.useState(false);
			var busy = busyState[0], setBusy = busyState[1];
			var audioState = React.useState(null);
			var audio = audioState[0], setAudio = audioState[1];
			// 表单草稿（从 vcfg 初始化一次）
			var ttsProviderState = React.useState(null);
			var ttsProvider = ttsProviderState[0], setTtsProvider = ttsProviderState[1];
			var openaiState = React.useState(null);
			var openai = openaiState[0], setOpenai = openaiState[1];
			var localState = React.useState(null);
			var local = localState[0], setLocal = localState[1];
			var noteState = React.useState("");
			var note = noteState[0], setNote = noteState[1];
			var e2eState = React.useState(null);
			var e2e = e2eState[0], setE2e = e2eState[1];
			var callState = React.useState(null);
			var call = callState[0], setCall = callState[1];
			var loadedRef = React.useRef(false);

			var mountedRef = React.useRef(true);
			React.useEffect(function () {
				mountedRef.current = true;
				return function () { mountedRef.current = false; };
			}, []);
			function flash(text2) {
				setMsg(text2);
				setTimeout(function () { if (mountedRef.current) setMsg(""); }, 2500);
			}
			function refresh() {
				remote.getVoiceInfo().then(function (result) {
					if (mountedRef.current) setInfo(unwrap(result));
				}, function (e) {
					if (mountedRef.current) setErr(t("remoteFail") + "：" + (e && e.message ? e.message : String(e)));
				});
				remote.getVoiceConfig().then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setVcfg(value);
					if (!loadedRef.current) {
						loadedRef.current = true;
						setTtsProvider(value.tts.provider);
						setOpenai({
							baseUrl: value.tts.openai.baseUrl || "", model: value.tts.openai.model || "",
							voice: value.tts.openai.voice || "", apiKey: "", format: value.tts.openai.format || "mp3",
							speed: value.tts.openai.speed != null ? String(value.tts.openai.speed) : "1",
						});
						setLocal({
							engine: value.tts.local.engine || "custom", baseUrl: value.tts.local.baseUrl || "",
							voice: value.tts.local.voice || "", apiKey: "", note: value.tts.local.note || "",
						});
						setNote(value.tts.builtinVoiceNote || "");
						setE2e({
							enabled: value.e2e.enabled === true, provider: value.e2e.provider || "glm-realtime",
							baseUrl: value.e2e.baseUrl || "", model: value.e2e.model || "",
							apiKey: "", voice: value.e2e.voice || "", note: value.e2e.note || "",
						});
						setCall({
							autoAccept: value.call.autoAccept !== false,
							whitelistText: (value.call.whitelist || []).join("\n"),
							ringTimeoutSec: value.call.ringTimeoutSec != null ? String(value.call.ringTimeoutSec) : "25",
							farewellHangup: value.call.farewellHangup !== false,
							greeting: value.call.greeting || "",
							maxDurationMin: value.call.maxDurationMin != null ? String(value.call.maxDurationMin) : "10",
						});
					}
				}, function (e) {
					if (mountedRef.current) setErr(t("remoteFail") + "：" + (e && e.message ? e.message : String(e)));
				});
			}
			React.useEffect(refresh, []);

			function saveTts() {
				var patch = { tts: { provider: ttsProvider, builtinVoiceNote: note } };
				if (ttsProvider === "openai") {
					if (!openai.baseUrl.trim() || !openai.model.trim()) { setErr(t("phApiBase") + " / " + t("phVoiceModel")); return; }
					patch.tts.openai = {
						baseUrl: openai.baseUrl.trim(), model: openai.model.trim(),
						voice: openai.voice.trim(), format: openai.format, speed: Number(openai.speed) || 1,
					};
					if (openai.apiKey.trim()) patch.tts.openai.apiKey = openai.apiKey.trim();
				}
				if (ttsProvider === "local") {
					if (!local.baseUrl.trim()) { setErr(t("phApiBase")); return; }
					patch.tts.local = { engine: local.engine, baseUrl: local.baseUrl.trim(), voice: local.voice.trim(), note: local.note.trim() };
					if (local.apiKey.trim()) patch.tts.local.apiKey = local.apiKey.trim();
				}
				remote.saveVoiceConfig(patch).then(function (result) {
					unwrap(result);
					if (!mountedRef.current) return;
					setErr(""); flash(t("voiceSaved"));
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}
			function saveE2e() {
				var patch = { e2e: {
					enabled: e2e.enabled, provider: e2e.provider,
					baseUrl: e2e.baseUrl.trim(), model: e2e.model.trim(),
					voice: e2e.voice.trim(), note: e2e.note.trim(),
				} };
				if (e2e.apiKey.trim()) patch.e2e.apiKey = e2e.apiKey.trim();
				remote.saveVoiceConfig(patch).then(function (result) {
					unwrap(result);
					if (!mountedRef.current) return;
					setErr(""); flash(t("voiceSaved"));
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}
			function saveCall() {
				var patch = { call: {
					autoAccept: call.autoAccept,
					whitelist: call.whitelistText.split("\n").map(function (s) { return s.trim(); }).filter(Boolean),
					ringTimeoutSec: Number(call.ringTimeoutSec) || 25,
					farewellHangup: call.farewellHangup,
					greeting: call.greeting.trim(),
					maxDurationMin: Number(call.maxDurationMin) || 10,
				} };
				remote.saveVoiceConfig(patch).then(function (result) {
					unwrap(result);
					if (!mountedRef.current) return;
					setErr(""); flash(t("voiceSaved"));
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}
			function trySpeak() {
				if (!text.trim()) return;
				setBusy(true);
				setErr("");
				remote.ttsTest(text.trim()).then(function (result) {
					var value = unwrap(result);
					if (mountedRef.current) { setAudio(value); setBusy(false); }
				}, function (e) {
					if (mountedRef.current) { setBusy(false); setErr(e && e.message ? e.message : String(e)); }
				});
			}
			var setO = function (key, value) { setOpenai(Object.assign({}, openai, (function () { var o = {}; o[key] = value; return o; })())); };
			var setL = function (key, value) { setLocal(Object.assign({}, local, (function () { var o = {}; o[key] = value; return o; })())); };
			var setE = function (key, value) { setE2e(Object.assign({}, e2e, (function () { var o = {}; o[key] = value; return o; })())); };
			var setC = function (key, value) { setCall(Object.assign({}, call, (function () { var o = {}; o[key] = value; return o; })())); };

			var engineText = info && info.engine.managed
				? (info.engine.dirExists ? t("voiceEngineManaged") : t("voiceEngineNoDir"))
				: t("voiceEngineOff");
			if (!info || !vcfg || !call || !e2e || !openai || !local) {
				return h("div", null,
					err ? h("p", { className: "aqr-err", role: "alert" }, err) : null,
					h("div", { className: "aqr-card" }, h("p", { className: "aqr-empty" }, "…")));
			}
			return h("div", null,
				err ? h("p", { className: "aqr-err", role: "alert" }, err) : null,
				h("div", { className: "aqr-card" },
					h("h2", null, t("pageVoice")),
					h("ul", { className: "aqr-li" },
						h("li", null, h(Dot, { ok: info.proxy.alive }), h("span", null, t("voiceProxy") + ":" + info.proxy.port + " — " + (info.proxy.alive ? t("voiceProxyAlive") : t("voiceProxyDown")))),
						h("li", null, h(Dot, { ok: info.engine.managed && info.engine.dirExists !== false }), h("span", null, t("voiceEngine") + " — " + engineText)),
						h("li", null, h(Dot, { ok: info.stt ? info.stt.ready !== false : false }), h("span", null, t("voiceStt"), info.stt && info.stt.script ? h("span", { className: "aqr-kv" }, " · " + info.stt.script) : null)),
					),
					h("p", { className: "aqr-note" }, t("voiceCallNote")),
					(info.errors || []).length ? h("p", { className: "aqr-err" }, info.errors.join("；")) : null,
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("voiceModels")),
					h("div", { className: "aqr-prov-row" },
						[
							["builtin", t("voiceProviderBuiltin"), t("voiceProviderBuiltinDesc")],
							["openai", t("voiceProviderOpenai"), t("voiceProviderOpenaiDesc")],
							["local", t("voiceProviderLocal"), t("voiceProviderLocalDesc")],
						].map(function (p) {
							return h("button", {
								key: p[0], className: "aqr-prov", "data-on": ttsProvider === p[0],
								onClick: function () { setTtsProvider(p[0]); },
							},
								h("span", { className: "aqr-prov-name" }, p[1]),
								h("span", { className: "aqr-prov-desc" }, p[2]));
						}),
					),
					ttsProvider === "builtin" ? h("div", null,
						h("textarea", { className: "aqr-textarea", rows: 2, placeholder: t("phBuiltinNote"), value: note, onChange: function (e) { setNote(e.target.value); } }),
						h("div", { className: "aqr-row", style: { marginTop: "8px" } }, h("button", { className: "aqr-btn aqr-btn-primary", onClick: saveTts }, t("voiceSave"))),
					) : null,
					ttsProvider === "openai" ? h("div", null,
						h("p", { className: "aqr-note" }, t("voiceOpenaiHint")),
						h("div", { className: "aqr-grid", style: { marginTop: "8px" } },
							h("input", { className: "aqr-input", placeholder: t("phApiBase"), value: openai.baseUrl, onChange: function (e) { setO("baseUrl", e.target.value); } }),
							h("input", { className: "aqr-input aqr-fill", placeholder: t("phVoiceModel"), value: openai.model, onChange: function (e) { setO("model", e.target.value); } }),
						),
						h("div", { className: "aqr-grid" },
							h("input", { className: "aqr-input", placeholder: t("phVoiceId"), value: openai.voice, onChange: function (e) { setO("voice", e.target.value); } }),
							h("input", { className: "aqr-input aqr-fill", type: "password", placeholder: t("phApiKey"), value: openai.apiKey, onChange: function (e) { setO("apiKey", e.target.value); } }),
						),
						h("div", { className: "aqr-grid" },
							h("select", { className: "aqr-select", value: openai.format, onChange: function (e) { setO("format", e.target.value); } },
								h("option", { value: "mp3" }, "mp3"), h("option", { value: "wav" }, "wav"), h("option", { value: "opus" }, "opus")),
							h("div", { className: "aqr-row" },
								h("span", { className: "aqr-kv" }, "speed 0.5-2"),
								h("input", { className: "aqr-input", type: "number", step: "0.1", min: "0.5", max: "2", value: openai.speed, onChange: function (e) { setO("speed", e.target.value); } }),
								h("button", { className: "aqr-btn aqr-btn-primary", onClick: saveTts }, t("voiceSave"))),
						),
					) : null,
					ttsProvider === "local" ? h("div", null,
						h("p", { className: "aqr-note" }, t("voiceLocalHint")),
						h("div", { className: "aqr-grid", style: { marginTop: "8px" } },
							h("select", { className: "aqr-select", value: local.engine, onChange: function (e) { setL("engine", e.target.value); } },
								h("option", { value: "gpt-sovits" }, "GPT-SoVITS"),
								h("option", { value: "cosyvoice" }, "CosyVoice"),
								h("option", { value: "indextts" }, "IndexTTS"),
								h("option", { value: "fish-speech" }, "Fish Speech"),
								h("option", { value: "custom" }, "custom")),
							h("input", { className: "aqr-input aqr-fill", placeholder: t("phApiBase"), value: local.baseUrl, onChange: function (e) { setL("baseUrl", e.target.value); } }),
						),
						h("div", { className: "aqr-grid" },
							h("input", { className: "aqr-input", placeholder: t("phVoiceId"), value: local.voice, onChange: function (e) { setL("voice", e.target.value); } }),
							h("input", { className: "aqr-input aqr-fill", type: "password", placeholder: t("phApiKey"), value: local.apiKey, onChange: function (e) { setL("apiKey", e.target.value); } }),
						),
						h("textarea", { className: "aqr-textarea", rows: 2, placeholder: t("phBuiltinNote"), value: local.note, onChange: function (e) { setL("note", e.target.value); } }),
						h("div", { className: "aqr-row", style: { marginTop: "8px" } }, h("button", { className: "aqr-btn aqr-btn-primary", onClick: saveTts }, t("voiceSave"))),
					) : null,
					h("span", { className: "aqr-msg" }, msgState[0]),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("e2eTitle")),
					h("label", { className: "aqr-row", style: { marginBottom: "8px", cursor: "pointer" } },
						h("input", { type: "checkbox", checked: e2e.enabled, onChange: function (e) { setE("enabled", e.target.checked); } }),
						t("e2eEnable")),
					h("p", { className: "aqr-note" }, t("e2eHint")),
					h("div", { className: "aqr-grid", style: { marginTop: "8px" } },
						h("select", { className: "aqr-select", value: e2e.provider, onChange: function (e) { setE("provider", e.target.value); } },
							h("option", { value: "glm-realtime" }, "GLM-Realtime"),
							h("option", { value: "qwen-omni" }, "Qwen-Omni Realtime"),
							h("option", { value: "openai-realtime" }, "OpenAI Realtime"),
							h("option", { value: "custom" }, "custom")),
						h("input", { className: "aqr-input aqr-fill", placeholder: t("phApiBase"), value: e2e.baseUrl, onChange: function (e) { setE("baseUrl", e.target.value); } }),
					),
					h("div", { className: "aqr-grid" },
						h("input", { className: "aqr-input", placeholder: t("phVoiceModel"), value: e2e.model, onChange: function (e) { setE("model", e.target.value); } }),
						h("input", { className: "aqr-input aqr-fill", placeholder: t("phVoiceId"), value: e2e.voice, onChange: function (e) { setE("voice", e.target.value); } }),
					),
					h("div", { className: "aqr-grid" },
						h("input", { className: "aqr-input", type: "password", placeholder: t("phApiKey"), value: e2e.apiKey, onChange: function (e) { setE("apiKey", e.target.value); } }),
						h("div", { className: "aqr-row" }, h("button", { className: "aqr-btn aqr-btn-primary", onClick: saveE2e }, t("voiceSave"))),
					),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("callTitle")),
					h("p", { className: "aqr-note" }, t("callHint")),
					h("div", { className: "aqr-row", style: { margin: "8px 0" } },
						h("label", { className: "aqr-row", style: { cursor: "pointer" } },
							h("input", { type: "checkbox", checked: call.autoAccept, onChange: function (e) { setC("autoAccept", e.target.checked); } }),
							t("callAutoAccept")),
						h("label", { className: "aqr-row", style: { cursor: "pointer" } },
							h("input", { type: "checkbox", checked: call.farewellHangup, onChange: function (e) { setC("farewellHangup", e.target.checked); } }),
							t("callFarewell")),
					),
					h("textarea", { className: "aqr-textarea", rows: 3, placeholder: t("callWhitelist"), value: call.whitelistText, onChange: function (e) { setC("whitelistText", e.target.value); } }),
					h("div", { className: "aqr-grid", style: { marginTop: "8px" } },
						h("input", { className: "aqr-input", type: "number", min: "1", max: "60", placeholder: t("callRing"), value: call.maxDurationMin, onChange: function (e) { setC("maxDurationMin", e.target.value); } }),
						h("input", { className: "aqr-input aqr-fill", placeholder: t("callGreeting"), value: call.greeting, onChange: function (e) { setC("greeting", e.target.value); } }),
					),
					h("div", { className: "aqr-row", style: { marginTop: "8px" } }, h("button", { className: "aqr-btn aqr-btn-primary", onClick: saveCall }, t("voiceSave"))),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("voiceTtsTitle")),
					h("ul", { className: "aqr-li" },
						info.tts.map(function (tier) {
							return h("li", { key: tier.tier },
								h(Dot, { ok: tier.ready }),
								h("span", null, "T" + tier.tier + " · " + tier.name),
								h("span", { className: "aqr-kv" }, tier.ready ? t("voiceReady") : t("voiceMissing")));
						}),
					),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("voiceTryTitle")),
					h("div", { className: "aqr-row" },
						h("input", {
							className: "aqr-input aqr-fill", placeholder: t("voiceTryPh"),
							value: text, maxLength: 200,
							onChange: function (e) { setText(e.target.value); },
							onKeyDown: function (e) { if (e.key === "Enter" && !busy) trySpeak(); },
						}),
						h("button", { className: "aqr-btn aqr-btn-primary", disabled: busy || !text.trim(), onClick: trySpeak }, busy ? t("voiceTryBusy") : t("voiceTryBtn")),
					),
					audio ? h("div", { style: { marginTop: "10px" } },
						h("audio", { controls: true, autoPlay: true, src: audio.audio }),
						h("span", { className: "aqr-kv", style: { marginLeft: "8px" } }, audio.bytes ? (audio.bytes + " bytes") : ""),
					) : null,
				),
			);
		}

		// ---------- 健康日志页（通用） ----------
		function HealthPage(props) {
			var remote = props.remote;
			var t = props.t;
			var snapState = React.useState(null);
			var snap = snapState[0], setSnap = snapState[1];
			var errState = React.useState("");
			var err = errState[0], setErr = errState[1];
			var msgState = React.useState("");
			var setMsg = msgState[1];
			var todayStr = (function () { var d = new Date(); var p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); })();
			var formState = React.useState({ date: todayStr, sleepHours: "", sleepQuality: "", mood: "", exercise: "", weight: "", bpSystolic: "", bpDiastolic: "", pulse: "", notes: "" });
			var form = formState[0], setForm = formState[1];
			var habitsState = React.useState(null); // {sleepTarget, exerciseWeekly, focusNote}
			var habits = habitsState[0], setHabits = habitsState[1];
			var habitsLoadedRef = React.useRef(false);
			var mountedRef = React.useRef(true);
			React.useEffect(function () {
				mountedRef.current = true;
				return function () { mountedRef.current = false; };
			}, []);

			function flash(text) {
				setMsg(text);
				setTimeout(function () { if (mountedRef.current) setMsg(""); }, 2500);
			}
			function refresh() {
				remote.getHealth().then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setSnap(value);
					if (!habitsLoadedRef.current) {
						habitsLoadedRef.current = true;
						setHabits({
							sleepTarget: value.habits.sleepTarget != null ? String(value.habits.sleepTarget) : "",
							exerciseWeekly: value.habits.exerciseWeekly != null ? String(value.habits.exerciseWeekly) : "",
							focusNote: value.habits.focusNote || "",
						});
					}
				}, function (e) {
					if (mountedRef.current) setErr(t("remoteFail") + "：" + (e && e.message ? e.message : String(e)));
				});
			}
			React.useEffect(refresh, []);

			function setF(key, value) { setForm(Object.assign({}, form, (function () { var o = {}; o[key] = value; return o; })())); }
			function addLog() {
				var entry = {};
				if (form.date) entry.date = form.date;
				if (form.sleepHours !== "") entry.sleepHours = Number(form.sleepHours);
				if (form.sleepQuality !== "") entry.sleepQuality = Number(form.sleepQuality);
				if (form.mood !== "") entry.mood = Number(form.mood);
				if (form.exercise.trim()) entry.exercise = form.exercise.trim();
				if (form.weight !== "") entry.weight = Number(form.weight);
				if (form.bpSystolic !== "") entry.bpSystolic = Number(form.bpSystolic);
				if (form.bpDiastolic !== "") entry.bpDiastolic = Number(form.bpDiastolic);
				if (form.pulse !== "") entry.pulse = Number(form.pulse);
				if (form.notes.trim()) entry.notes = form.notes.trim();
				if (Object.keys(entry).length === 0 || (entry.date && Object.keys(entry).length === 1)) {
					setErr(t("needBoth")); return;
				}
				remote.addHealthLog(entry).then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setSnap(value); setErr(""); flash(t("logged"));
					setForm({ date: todayStr, sleepHours: "", sleepQuality: "", mood: "", exercise: "", weight: "", bpSystolic: "", bpDiastolic: "", pulse: "", notes: "" });
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}
			function saveHabits() {
				var patch = { habits: {} };
				if (habits.sleepTarget !== "") patch.habits.sleepTarget = Number(habits.sleepTarget);
				if (habits.exerciseWeekly !== "") patch.habits.exerciseWeekly = Number(habits.exerciseWeekly);
				patch.habits.focusNote = habits.focusNote;
				remote.saveHealthConfig(patch).then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setSnap(value); setErr(""); flash(t("habitsSaved"));
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}
			function delLog(id) {
				if (!window.confirm(t("delConfirm"))) return;
				remote.deleteHealthLog(id).then(function (result) {
					var value = unwrap(result);
					if (mountedRef.current) { setSnap(value); setErr(""); }
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}

			var s = snap ? snap.summary : null;
			var logs = snap ? snap.logs.slice().reverse() : [];
			var setH = function (key, value) { setHabits(Object.assign({}, habits, (function () { var o = {}; o[key] = value; return o; })())); };
			return h("div", null,
				err ? h("p", { className: "aqr-err", role: "alert" }, err) : null,
				h("div", { className: "aqr-card" },
					h("h2", null, t("healthTrends")),
					snap ? h(VitalTiles, { tiles: snap.tiles, t: t }) : h("p", { className: "aqr-empty" }, "…"),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("healthSummary")),
					h("span", { className: "aqr-chip" }, s ? s.total + " 条" : "…"),
					h("span", { className: "aqr-chip" }, s && s.sleepAvg != null ? ("睡眠均值 " + s.sleepAvg + "h") : "睡眠未记"),
					h("span", { className: "aqr-chip" }, s ? ("运动 " + s.exerciseCount + " 次") : "…"),
					h("span", { className: "aqr-chip" }, s && s.moodAvg != null ? ("情绪 " + s.moodAvg + "/5") : "情绪未记"),
					s && s.latest && s.latest.notes ? h("span", { className: "aqr-chip" }, "最近备注：" + s.latest.notes) : null,
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("chartHealth")),
					snap ? h(HealthCharts, { series: snap.series, score: snap.score, habits: snap.habits, t: t }) : h("p", { className: "aqr-empty" }, "…"),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("healthAdd")),
					h("div", { className: "aqr-grid" },
						h("input", { className: "aqr-input", type: "date", value: form.date, onChange: function (e) { setF("date", e.target.value); } }),
						h("input", { className: "aqr-input aqr-fill", type: "number", step: "0.1", min: "0", max: "24", placeholder: t("phSleepHours"), value: form.sleepHours, onChange: function (e) { setF("sleepHours", e.target.value); } }),
					),
					h("div", { className: "aqr-grid" },
						h("select", { className: "aqr-select", value: form.sleepQuality, onChange: function (e) { setF("sleepQuality", e.target.value); } },
							h("option", { value: "" }, t("phSleepQuality")),
							[1, 2, 3, 4, 5].map(function (n) { return h("option", { key: n, value: n }, n); })),
						h("select", { className: "aqr-select", value: form.mood, onChange: function (e) { setF("mood", e.target.value); } },
							h("option", { value: "" }, t("phMood")),
							[1, 2, 3, 4, 5].map(function (n) { return h("option", { key: n, value: n }, n); })),
					),
					h("div", { className: "aqr-grid" },
						h("input", { className: "aqr-input aqr-fill", placeholder: t("phExercise"), value: form.exercise, onChange: function (e) { setF("exercise", e.target.value); } }),
						h("input", { className: "aqr-input aqr-fill", type: "number", step: "0.1", min: "30", max: "250", placeholder: t("phWeight"), value: form.weight, onChange: function (e) { setF("weight", e.target.value); } }),
					),
					h("div", { className: "aqr-row", style: { marginBottom: "8px" } },
						h("input", { className: "aqr-input aqr-fill", type: "number", min: "60", max: "260", placeholder: t("phBpSys"), value: form.bpSystolic, onChange: function (e) { setF("bpSystolic", e.target.value); } }),
						h("input", { className: "aqr-input aqr-fill", type: "number", min: "30", max: "160", placeholder: t("phBpDia"), value: form.bpDiastolic, onChange: function (e) { setF("bpDiastolic", e.target.value); } }),
						h("input", { className: "aqr-input aqr-fill", type: "number", min: "30", max: "220", placeholder: t("phPulse"), value: form.pulse, onChange: function (e) { setF("pulse", e.target.value); } }),
					),
					h("textarea", { className: "aqr-textarea", rows: 2, placeholder: t("phNotes"), value: form.notes, onChange: function (e) { setF("notes", e.target.value); } }),
					h("div", { className: "aqr-row" }, h("button", { className: "aqr-btn aqr-btn-primary", onClick: addLog }, t("healthAddBtn")), h("span", { className: "aqr-msg" }, msgState[0])),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("healthHabits")),
					habits ? h("div", null,
						h("div", { className: "aqr-grid" },
							h("input", { className: "aqr-input", type: "number", step: "0.1", min: "3", max: "14", placeholder: t("phSleepTarget"), value: habits.sleepTarget, onChange: function (e) { setH("sleepTarget", e.target.value); } }),
							h("input", { className: "aqr-input aqr-fill", type: "number", min: "0", max: "14", placeholder: t("phExerciseWeekly"), value: habits.exerciseWeekly, onChange: function (e) { setH("exerciseWeekly", e.target.value); } }),
						),
						h("textarea", { className: "aqr-textarea", rows: 2, placeholder: t("phFocusNote"), value: habits.focusNote, onChange: function (e) { setH("focusNote", e.target.value); } }),
						h("div", { className: "aqr-row", style: { marginTop: "8px" } }, h("button", { className: "aqr-btn aqr-btn-primary", onClick: saveHabits }, t("saveBtn"))),
					) : h("p", { className: "aqr-empty" }, "…"),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("healthLogs")),
					h("table", { className: "aqr-table" },
						h("thead", null, h("tr", null,
							h("th", null, t("colDate")), h("th", null, t("colSleep")), h("th", null, t("colMood")),
							h("th", { className: "aqr-style" }, t("colExercise")), h("th", { className: "aqr-style" }, t("colNotes")), h("th", null, t("colActions")))),
						h("tbody", null,
							logs.length ? logs.map(function (l) {
								return h("tr", { key: l.id },
									h("td", null, l.date),
									h("td", null, l.sleepHours != null ? (l.sleepHours + "h" + (l.sleepQuality != null ? " · " + l.sleepQuality + "/5" : "")) : "—"),
									h("td", null, l.mood != null ? (l.mood + "/5") : "—"),
									h("td", { className: "aqr-style" }, l.exercise || "—"),
									h("td", { className: "aqr-style" }, l.notes || "—"),
									h("td", null, h("button", { className: "aqr-btn aqr-btn-danger aqr-btn-sm", onClick: function () { delLog(l.id); } }, t("del"))),
								);
							}) : h("tr", null, h("td", { colSpan: 6, className: "aqr-empty" }, snap ? t("empty") : "…")),
						),
					),
					h("p", { className: "aqr-note" }, t("healthPrivacy")),
				),
			);
		}

		// ---------- 周期关怀页（可选子模块，默认关；打卡参考 ovumcy） ----------
		var SYMPTOMS = ["痛经", "头痛", "疲劳", "腹胀", "情绪波动", "失眠", "痤疮", "食欲变化", "腰酸", "胸胀"];
		var FLOW_LABELS = ["无", "点滴", "少量", "正常", "大量"];
		function CyclePage(props) {
			var remote = props.remote;
			var t = props.t;
			var snapState = React.useState(null);
			var snap = snapState[0], setSnap = snapState[1];
			var errState = React.useState("");
			var err = errState[0], setErr = errState[1];
			var msgState = React.useState("");
			var setMsg = msgState[1];
			var formState = React.useState(null); // {enabled, lastStart, cycleLength, periodLength}
			var form = formState[0], setForm = formState[1];
			var adviceState = React.useState(null); // {menstrual, follicular, ovulatory, luteal}
			var checkinState = React.useState({ flow: "", symptoms: [], notes: "" }); // ovumcy 式每日打卡
			var checkin = checkinState[0], setCheckin = checkinState[1];
			var advice = adviceState[0], setAdvice = adviceState[1];
			var loadedRef = React.useRef(false);
			var mountedRef = React.useRef(true);
			React.useEffect(function () {
				mountedRef.current = true;
				return function () { mountedRef.current = false; };
			}, []);
			function flash(text) {
				setMsg(text);
				setTimeout(function () { if (mountedRef.current) setMsg(""); }, 2500);
			}
			function refresh() {
				remote.getHealth().then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setSnap(value);
					if (!loadedRef.current) {
						loadedRef.current = true;
						var c = value.cycle.config || {};
						setForm({
							enabled: value.cycle.enabled === true,
							lastStart: c.lastStart || "",
							cycleLength: c.cycleLength != null ? String(c.cycleLength) : "28",
							periodLength: c.periodLength != null ? String(c.periodLength) : "5",
						});
						setAdvice({
							menstrual: (c.advice && c.advice.menstrual) || "",
							follicular: (c.advice && c.advice.follicular) || "",
							ovulatory: (c.advice && c.advice.ovulatory) || "",
							luteal: (c.advice && c.advice.luteal) || "",
						});
					}
				}, function (e) {
					if (mountedRef.current) setErr(t("remoteFail") + "：" + (e && e.message ? e.message : String(e)));
				});
			}
			React.useEffect(refresh, []);
			function save(extra) {
				var patch = Object.assign({
					enabled: form.enabled,
					lastStart: form.lastStart,
					cycleLength: Number(form.cycleLength),
					periodLength: Number(form.periodLength),
					advice: advice,
				}, extra || {});
				remote.saveCycle(patch).then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setSnap(value); setErr(""); flash(t("cycleSaved"));
					var c = value.cycle.config || {};
					setForm({ enabled: value.cycle.enabled === true, lastStart: c.lastStart || "", cycleLength: c.cycleLength != null ? String(c.cycleLength) : "28", periodLength: c.periodLength != null ? String(c.periodLength) : "5" });
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}
			var setF = function (key, value) { setForm(Object.assign({}, form, (function () { var o = {}; o[key] = value; return o; })())); };
			var setA = function (key, value) { setAdvice(Object.assign({}, advice, (function () { var o = {}; o[key] = value; return o; })())); };
			var setCheck = function (key, value) { setCheckin(Object.assign({}, checkin, (function () { var o = {}; o[key] = value; return o; })())); };
			function toggleSymptom(s) {
				var has = checkin.symptoms.indexOf(s) >= 0;
				var next = has ? checkin.symptoms.filter(function (x) { return x !== s; }) : checkin.symptoms.concat([s]);
				setCheck("symptoms", next);
			}
			function checkinSave() {
				var entry = {};
				if (checkin.flow !== "") entry.flow = Number(checkin.flow);
				if (checkin.symptoms.length) entry.symptoms = checkin.symptoms;
				if (checkin.notes.trim()) entry.notes = checkin.notes.trim();
				if (!Object.keys(entry).length) { setErr(t("needBoth")); return; }
				remote.addHealthLog(entry).then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setSnap(value); setErr(""); flash(t("checkinSaved"));
					setCheckin({ flow: checkin.flow, symptoms: checkin.symptoms, notes: "" });
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}
			function periodToday() {
				if (!window.confirm(t("periodConfirm"))) return;
				var d = new Date();
				var p = function (n) { return String(n).padStart(2, "0"); };
				var todayStr2 = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
				remote.saveCycle({ recordPeriodStart: todayStr2 }).then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setSnap(value); setErr(""); flash(t("periodRecorded"));
					var c = value.cycle.config || {};
					setForm({ enabled: value.cycle.enabled === true, lastStart: c.lastStart || "", cycleLength: c.cycleLength != null ? String(c.cycleLength) : "28", periodLength: c.periodLength != null ? String(c.periodLength) : "5" });
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}
			var today = snap && snap.cycle.enabled ? snap.cycle.today : null;
			var stats = snap && snap.cycle.enabled ? snap.cycle.stats : null;
			if (!snap || !form) {
				return h("div", null, err ? h("p", { className: "aqr-err" }, err) : null, h("div", { className: "aqr-card" }, h("p", { className: "aqr-empty" }, "…")));
			}
			return h("div", null,
				err ? h("p", { className: "aqr-err", role: "alert" }, err) : null,
				h("p", { className: "aqr-sub" }, t("cycleIntro")),
				h("div", { className: "aqr-card" },
					h("h2", null, t("checkinTitle")),
					form.enabled ? h("div", null,
						h("button", { className: "aqr-btn aqr-btn-primary", onClick: periodToday }, t("periodToday")),
						h("div", { className: "aqr-row", style: { marginTop: "10px" } },
							h("select", { className: "aqr-select", value: checkin.flow, onChange: function (e) { setCheck("flow", e.target.value); } },
								h("option", { value: "" }, t("flowLabel")),
								FLOW_LABELS.map(function (f, idx) { return h("option", { key: idx, value: idx }, f); })),
							h("span", { className: "aqr-kv" }, t("symptomsLabel")),
						),
						h("div", { className: "aqr-row", style: { marginTop: "6px" } },
							SYMPTOMS.map(function (s) {
								return h("button", {
									key: s, className: "aqr-btn aqr-tab", "data-on": checkin.symptoms.indexOf(s) >= 0,
									onClick: function () { toggleSymptom(s); },
								}, s);
							}),
						),
						h("textarea", { className: "aqr-textarea", rows: 2, placeholder: t("phNotes"), value: checkin.notes, onChange: function (e) { setCheck("notes", e.target.value); }, style: { marginTop: "8px" } }),
						h("div", { className: "aqr-row", style: { marginTop: "8px" } },
							h("button", { className: "aqr-btn aqr-btn-primary", onClick: checkinSave }, t("checkinSave")),
							h("span", { className: "aqr-msg" }, msgState[0])),
					) : h("p", { className: "aqr-empty" }, t("cycleEnableHint")),
				),
				stats && stats.cycles > 0 ? h("div", { className: "aqr-card" },
					h("h2", null, t("cycleStatsTitle")),
					stats.avg != null ? h("div", { className: "aqr-row" },
						h("span", { className: "aqr-chip" }, t("statsAvg") + "：" + stats.avg + " 天"),
						stats.range ? h("span", { className: "aqr-chip" }, "波动 " + stats.range[0] + "-" + stats.range[1] + " 天") : null,
						h("span", { className: "aqr-chip" }, "近 " + stats.cycles + " 个周期"),
					) : null,
					stats.lengths.length ? h("div", { className: "aqr-row", style: { marginTop: "6px" } },
						stats.lengths.map(function (len, idx) { return h("span", { key: idx, className: "aqr-chip" }, len + "天"); }),
					) : null,
				) : null,
				today ? h("div", { className: "aqr-card" },
					h("h2", null, t("cycleToday")),
					h("div", { className: "aqr-flex" },
						h(CycleRing, { info: today, size: 170 }),
						h("div", { className: "aqr-flex-col" },
							h("div", null, h("strong", null, today.phaseName + " · " + t("cycleDayLabel") + " " + today.cycleDay + " 天")),
							h("div", { style: { marginTop: "6px" } },
								h("span", { className: "aqr-chip" }, t("cycleNext") + "：" + (today.nextPeriodDate || "?") + "（" + today.nextPeriodInDays + " 天后）"),
								h("span", { className: "aqr-chip" }, t("cycleOvu") + "：" + (today.ovulationDate || "?")),
							),
							h("p", { className: "aqr-note" }, today.advice),
						),
					),
				) : null,
				snap && snap.cycle.enabled && snap.cycle.config && snap.cycle.config.lastStart ? h("div", { className: "aqr-card" },
					h("h2", null, t("calendarTitle")),
					h(CycleCalendar, { config: snap.cycle.config, t: t }),
				) : null,
				h("div", { className: "aqr-card" },
					h("h2", null, t("pageCycle") + " · " + (snap.cycle.enabled ? t("cycleEnabledTag") : "off")),
					h("div", { className: "aqr-grid" },
						h("label", { className: "aqr-kv", style: { display: "flex", alignItems: "center", gap: "8px" } },
							h("input", { type: "checkbox", checked: form.enabled, onChange: function (e) { setF("enabled", e.target.checked); } }),
							t("cycleEnable")),
						h("input", { className: "aqr-input aqr-fill", type: "date", value: form.lastStart, onChange: function (e) { setF("lastStart", e.target.value); }, "aria-label": t("cycleLastStart") }),
					),
					h("div", { className: "aqr-grid" },
						h("input", { className: "aqr-input", type: "number", min: "21", max: "45", placeholder: t("cycleLengthLabel"), value: form.cycleLength, onChange: function (e) { setF("cycleLength", e.target.value); } }),
						h("input", { className: "aqr-input aqr-fill", type: "number", min: "2", max: "10", placeholder: t("periodLengthLabel"), value: form.periodLength, onChange: function (e) { setF("periodLength", e.target.value); } }),
					),
					h("div", { className: "aqr-row", style: { marginTop: "8px" } },
						h("button", { className: "aqr-btn aqr-btn-primary", onClick: function () { save(); } }, t("cycleSaveBtn")),
						form.enabled ? h("button", { className: "aqr-btn", onClick: function () { save({ enabled: false }); } }, t("cycleDisable")) : null,
						h("span", { className: "aqr-msg" }, msgState[0]),
					),
				),
				h("div", { className: "aqr-card" },
					h("h2", null, t("cycleAdviceTitle")),
					["menstrual", "follicular", "ovulatory", "luteal"].map(function (key) {
						return h("div", { key: key, style: { marginBottom: "10px" } },
							h("div", { className: "aqr-kv", style: { marginBottom: "4px" } }, key),
							h("textarea", { className: "aqr-textarea", rows: 3, value: advice[key], onChange: function (e) { setA(key, e.target.value); } }));
					}),
					h("p", { className: "aqr-note" }, t("medicalNote")),
				),
			);
		}

		// ---------- 手绘风 SVG 组件（种伪随机抖动，渲染稳定不闪烁） ----------
		function strSeed(s) {
			var h = 2166136261 >>> 0;
			for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
			return h >>> 0;
		}
		function mulberry32(seed) {
			var t = seed >>> 0;
			return function () {
				t += 0x6D2B79F5;
				var r = Math.imul(t ^ (t >>> 15), 1 | t);
				r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
				return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
			};
		}
		/** 手绘线：折线 + 中点抖动 */
		function sketchLinePath(points, seedStr, jitter) {
			var rnd = mulberry32(strSeed(seedStr));
			var parts = [];
			for (var i = 0; i < points.length; i++) {
				var x = points[i][0] + (rnd() - 0.5) * (i === 0 || i === points.length - 1 ? 1 : jitter * 2);
				var y = points[i][1] + (rnd() - 0.5) * (i === 0 || i === points.length - 1 ? 1 : jitter * 2);
				parts.push((i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1));
			}
			return parts.join(" ");
		}
		/** 手绘圈：多边形近似椭圆，半径/角度都带抖动 */
		function sketchCirclePath(cx, cy, r, seedStr, opts) {
			opts = opts || {};
			var rnd = mulberry32(strSeed(seedStr));
			var squash = opts.squash || 0.9; // 稍微压扁，更像手画
			var n = opts.points || 12;
			var parts = [];
			for (var i = 0; i <= n; i++) {
				var deg = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
				var rr = r * (1 + (rnd() - 0.5) * 0.14);
				var x = cx + Math.cos(deg) * rr;
				var y = cy + Math.sin(deg) * rr * squash;
				parts.push((i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1));
			}
			return parts.join(" ") + " Z";
		}
		/** 手绘叉：两笔抖动短线 */
		function sketchCrossPaths(cx, cy, size, seedStr) {
			var d = size / 2;
			return [
				sketchLinePath([[cx - d, cy - d], [cx, cy], [cx + d, cy + d]], seedStr + ":a", 1.2),
				sketchLinePath([[cx + d, cy - d], [cx, cy], [cx - d, cy + d]], seedStr + ":b", 1.2),
			];
		}
		/** 手绘矩形（柱状图条） */
		function sketchRectPath(x, y, w, h, seedStr) {
			if (h < 1) h = 1;
			var rnd = mulberry32(strSeed(seedStr));
			var j = function () { return (rnd() - 0.5) * 1.6; };
			var x2 = x + w, y2 = y - h;
			return "M" + (x + j()) + " " + y + " L" + (x + j()) + " " + (y2 + j()) + " L" + (x2 + j()) + " " + (y2 + j()) + " L" + (x2 + j()) + " " + (y + j()) + " Z";
		}
		function polar(cx, cy, r, deg) {
			var a = ((deg - 90) * Math.PI) / 180;
			return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
		}
		function ringArcPath(cx, cy, rOuter, rInner, startDeg, endDeg) {
			var p1 = polar(cx, cy, rOuter, startDeg), p2 = polar(cx, cy, rOuter, endDeg);
			var p3 = polar(cx, cy, rInner, endDeg), p4 = polar(cx, cy, rInner, startDeg);
			var large = endDeg - startDeg > 180 ? 1 : 0;
			return "M" + p1[0].toFixed(1) + " " + p1[1].toFixed(1)
				+ " A" + rOuter + " " + rOuter + " 0 " + large + " 1 " + p2[0].toFixed(1) + " " + p2[1].toFixed(1)
				+ " L" + p3[0].toFixed(1) + " " + p3[1].toFixed(1)
				+ " A" + rInner + " " + rInner + " 0 " + large + " 0 " + p4[0].toFixed(1) + " " + p4[1].toFixed(1) + " Z";
		}

		var PHASE_COLORS = { menstrual: "#ef6b6b", follicular: "#5fae6f", ovulatory: "#8e7cc3", luteal: "#e0a04f" };

		/** 周期环形图：四阶段弧段 + 今日标记，中心显示阶段与天数 */
		function CycleRing(props) {
			var info = props.info;
			if (!info) return null;
			var size = props.size || 170;
			var cx = size / 2, cy = size / 2;
			var rOuter = size / 2 - 10, rInner = rOuter - 16;
			var cycleLen = info.cycleLength;
			var ovuDay = cycleLen - 14;
			var segs = [
				{ key: "menstrual", days: info.periodLength },
				{ key: "follicular", days: Math.max(0, ovuDay - 2 - info.periodLength) },
				{ key: "ovulatory", days: 3 },
				{ key: "luteal", days: Math.max(0, cycleLen - (info.periodLength + Math.max(0, ovuDay - 2 - info.periodLength) + 3)) },
			];
			var gap = 1.2;
			var deg = 0;
			var arcs = [];
			for (var i = 0; i < segs.length; i++) {
				var span = (segs[i].days / cycleLen) * 360;
				if (span > gap * 2) {
					var d = ringArcPath(cx, cy, rOuter, rInner, deg + gap, deg + span - gap);
					arcs.push(h("path", { key: segs[i].key, d: d, fill: PHASE_COLORS[segs[i].key], fillOpacity: 0.55, stroke: PHASE_COLORS[segs[i].key], strokeWidth: 1.4 }));
					arcs.push(h("path", { key: segs[i].key + "s", d: d, fill: "none", stroke: PHASE_COLORS[segs[i].key], strokeWidth: 1, opacity: 0.5, transform: "rotate(0.7 " + cx + " " + cy + ")" }));
				}
				deg += span;
			}
			var todayDeg = ((info.cycleDay - 1) / cycleLen) * 360;
			var tp = polar(cx, cy, (rOuter + rInner) / 2, todayDeg);
			arcs.push(h("path", { key: "today", d: sketchCirclePath(tp[0], tp[1], 5.5, "today" + info.cycleDay, { points: 10, squash: 1 }), fill: "none", stroke: "#2563eb", strokeWidth: 2 }));
			return h("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size, role: "img", "aria-label": info.phaseName },
				arcs,
				h("text", { x: cx, y: cy - 6, textAnchor: "middle", fontSize: 15, fontWeight: 600, fill: "currentColor" }, info.phaseName),
				h("text", { x: cx, y: cy + 14, textAnchor: "middle", fontSize: 12, fill: "var(--dsw-alias-label-tertiary)" }, "第 " + info.cycleDay + " / " + cycleLen + " 天"),
			);
		}

		/** 手绘月历：红圈=月经期（实线已过/虚线预测），叉=排卵窗，蓝圈=今天；支持翻月 */
		function CycleCalendar(props) {
			var config = props.config;
			var t = props.t;
			var navState = React.useState(null); // {year, month} null=跟随今天
			var viewed = navState[0], setViewed = navState[1];
			var today = new Date();
			var year = viewed ? viewed.year : today.getFullYear();
			var month = viewed ? viewed.month : today.getMonth();
			if (!config || !config.lastStart) return null;
			var first = new Date(year, month, 1);
			var startOffset = (first.getDay() + 6) % 7; // 周一开头
			var daysInMonth = new Date(year, month + 1, 0).getDate();
			var lastStart = config.lastStart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
			if (!lastStart) return null;
			var start = new Date(Number(lastStart[1]), Number(lastStart[2]) - 1, Number(lastStart[3]));
			var cycleLen = Math.min(Math.max(Math.floor(Number(config.cycleLength)) || 28, 21), 45);
			var periodLen = Math.min(Math.max(Math.floor(Number(config.periodLength)) || 5, 2), 10);
			var ovuDay = cycleLen - 14;
			var todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
			var cells = [];
			for (var i = 0; i < startOffset; i++) cells.push(null);
			for (var dnum = 1; dnum <= daysInMonth; dnum++) {
				var date = new Date(year, month, dnum);
				var diff = Math.floor((date - start) / 86400000);
				var cycleDay = ((diff % cycleLen) + cycleLen) % cycleLen + 1;
				var isToday = date.getTime() === todayMid.getTime();
				var isPast = date.getTime() <= todayMid.getTime();
				var mark = null;
				if (cycleDay <= periodLen) mark = { type: "period", predicted: !isPast };
				else if (Math.abs(cycleDay - ovuDay) <= 1) mark = { type: "ovu" };
				cells.push({ dnum: dnum, isToday: isToday, mark: mark, seed: year + "-" + month + "-" + dnum });
			}
			while (cells.length % 7 !== 0) cells.push(null);
			var head = ["一", "二", "三", "四", "五", "六", "日"].map(function (w, idx) {
				return h("div", { key: "h" + idx, className: "aqr-cal-head" }, w);
			});
			var body = cells.map(function (cell, idx) {
				if (!cell) return h("div", { key: "e" + idx, className: "aqr-cal-cell aqr-cal-empty" });
				var overlays = [];
				if (cell.mark && cell.mark.type === "period") {
					overlays.push(h("path", {
						key: "p", d: sketchCirclePath(21, 21, 16, cell.seed, { points: 14, squash: 0.86 }),
						fill: "none", stroke: "#ef6b6b", strokeWidth: 2,
						strokeDasharray: cell.mark.predicted ? "4 3" : undefined, opacity: cell.mark.predicted ? 0.55 : 0.9,
					}));
				}
				if (cell.mark && cell.mark.type === "ovu") {
					var xs = sketchCrossPaths(21, 21, 15, cell.seed);
					overlays.push(h("path", { key: "x1", d: xs[0], fill: "none", stroke: "#8e7cc3", strokeWidth: 2, opacity: 0.85 }));
					overlays.push(h("path", { key: "x2", d: xs[1], fill: "none", stroke: "#8e7cc3", strokeWidth: 2, opacity: 0.85 }));
				}
				if (cell.isToday) {
					overlays.push(h("path", { key: "t", d: sketchCirclePath(21, 21, 18.5, "today" + cell.seed, { points: 14, squash: 0.9 }), fill: "none", stroke: "#2563eb", strokeWidth: 2.2 }));
				}
				return h("div", { key: "c" + idx, className: "aqr-cal-cell" + (cell.isToday ? " aqr-cal-today" : "") },
					h("div", { className: "aqr-cal-box" },
						h("svg", { width: 42, height: 42, viewBox: "0 0 42 42", className: "aqr-cal-svg" }, overlays),
						h("span", { className: "aqr-cal-num" }, cell.dnum),
					));
			});
			var prevM = new Date(year, month - 1, 1);
			var nextM = new Date(year, month + 1, 1);
			var isCur = year === today.getFullYear() && month === today.getMonth();
			return h("div", null,
				h("div", { className: "aqr-row", style: { justifyContent: "center", marginBottom: "8px" } },
					h("button", { className: "aqr-btn aqr-btn-sm", onClick: function () { setViewed({ year: prevM.getFullYear(), month: prevM.getMonth() }); } }, "‹"),
					h("span", { className: "aqr-kv", style: { margin: "0 12px", fontSize: "13px" } }, year + " 年 " + (month + 1) + " 月"),
					h("button", { className: "aqr-btn aqr-btn-sm", onClick: function () { setViewed({ year: nextM.getFullYear(), month: nextM.getMonth() }); } }, "›"),
					isCur ? null : h("button", { className: "aqr-btn aqr-btn-sm", onClick: function () { setViewed(null); } }, t("legendToday")),
				),
				h("div", { className: "aqr-cal-grid" }, head.concat(body)),
				h("div", { className: "aqr-legend" },
					h("span", null, h("span", { className: "aqr-lg-mark", style: { color: "#ef6b6b" } }, "○"), t("legendPeriod")),
					h("span", null, h("span", { className: "aqr-lg-mark", style: { color: "#8e7cc3" } }, "✕"), t("legendOvu")),
					h("span", null, h("span", { className: "aqr-lg-mark", style: { color: "#2563eb" } }, "○"), t("legendToday")),
				),
			);
		}

		/** 健康一览：评分环 + 睡眠柱状 + 情绪折线 + 运动点 */
		function HealthCharts(props) {
			var series = props.series, score = props.score, habits = props.habits, t = props.t;
			if (!series || !score) return null;
			var CH = 120;
			var charts = [];

			// 评分环
			var gSize = 130, gcx = gSize / 2, gcy = gSize / 2, gr = gSize / 2 - 12;
			var gaugeDeg = (score.overall / 100) * 360;
			var gaugeColor = score.overall >= 70 ? "#5fae6f" : score.overall >= 55 ? "#e0a04f" : "#ef6b6b";
			charts.push(h("div", { key: "gauge", className: "aqr-chart" },
				h("svg", { width: gSize, height: gSize, viewBox: "0 0 " + gSize + " " + gSize },
					h("circle", { cx: gcx, cy: gcy, r: (gr - 8 + gr) / 2, fill: "none", stroke: "var(--dsw-alias-border-l2)", strokeWidth: 8 }),
					gaugeDeg > 2 ? h("path", {
						d: ringArcPath(gcx, gcy, gr, gr - 8, 0, Math.min(359.5, gaugeDeg)),
						fill: gaugeColor, fillOpacity: 0.5, stroke: gaugeColor, strokeWidth: 1.4,
					}) : null,
					h("text", { x: gcx, y: gcy - 2, textAnchor: "middle", fontSize: 22, fontWeight: 700, fill: "currentColor" }, score.overall),
					h("text", { x: gcx, y: gcy + 16, textAnchor: "middle", fontSize: 11, fill: gaugeColor }, score.label),
				),
				h("div", { className: "aqr-chart-title" }, t("chartGauge")),
			));

			// 睡眠柱状（7 天 + 目标虚线）
			var bw = 232, bh = CH - 26, pad = 10;
			var target = Number(habits.sleepTarget) || 7.5;
			var maxSleep = Math.max(target * 1.15, 10);
			var bars = [];
			for (var i = 0; i < series.length; i++) {
				var d0 = series[i];
				var x = pad + i * ((bw - pad * 2) / series.length);
				var w = (bw - pad * 2) / series.length - 7;
				if (d0.sleepHours !== null) {
					var hgt = Math.max(2, (d0.sleepHours / maxSleep) * (bh - 14));
					var under = d0.sleepHours < target - 0.4;
					bars.push(h("path", { key: "b" + i, d: sketchRectPath(x + 3, bh, w, hgt, "bar" + d0.date), fill: under ? "#ef6b6b" : "#5fae6f", fillOpacity: 0.32, stroke: under ? "#ef6b6b" : "#5fae6f", strokeWidth: 1.3 }));
				}
				bars.push(h("text", { key: "l" + i, x: x + w / 2 + 3, y: CH - 8, textAnchor: "middle", fontSize: 10, fill: "var(--dsw-alias-label-tertiary)" }, d0.label));
			}
			var targetY = bh - (target / maxSleep) * (bh - 14);
			bars.push(h("line", { key: "target", x1: pad, y1: targetY, x2: bw - pad, y2: targetY, stroke: "#e0a04f", strokeWidth: 1.2, strokeDasharray: "5 4" }));
			charts.push(h("div", { key: "sleep", className: "aqr-chart" },
				h("svg", { width: bw, height: CH, viewBox: "0 0 " + bw + " " + CH }, bars),
				h("div", { className: "aqr-chart-title" }, t("chartSleep")),
			));

			// 情绪折线（1-5 归一）
			var mw = 190;
			var moodPts = [];
			for (var j = 0; j < series.length; j++) {
				var m = series[j].mood;
				if (m !== null) moodPts.push([pad + j * ((mw - pad * 2) / (series.length - 1)), 16 + (1 - (m - 1) / 4) * (CH - 46)]);
			}
			var moodEls = [];
			if (moodPts.length >= 2) {
				moodEls.push(h("path", { key: "line", d: sketchLinePath(moodPts, "moodline", 1.5), fill: "none", stroke: "#b39ddb", strokeWidth: 1.8 }));
			}
			for (var k2 = 0; k2 < moodPts.length; k2++) {
				moodEls.push(h("path", { key: "md" + k2, d: sketchCirclePath(moodPts[k2][0], moodPts[k2][1], 3.2, "md" + k2, { points: 8, squash: 1 }), fill: "#b39ddb", fillOpacity: 0.5, stroke: "#8e7cc3", strokeWidth: 1 }));
			}
			for (var k3 = 0; k3 < series.length; k3++) {
				moodEls.push(h("text", { key: "ml" + k3, x: pad + k3 * ((mw - pad * 2) / (series.length - 1)), y: CH - 8, textAnchor: "middle", fontSize: 10, fill: "var(--dsw-alias-label-tertiary)" }, series[k3].label));
			}
			charts.push(h("div", { key: "mood", className: "aqr-chart" },
				moodEls.length ? h("svg", { width: mw, height: CH, viewBox: "0 0 " + mw + " " + CH }, moodEls) : h("div", { className: "aqr-empty" }, t("empty")),
				h("div", { className: "aqr-chart-title" }, t("chartMood")),
			));

			// 运动点（7 天，有运动 = 实心手绘点）
			var exEls = [];
			for (var k4 = 0; k4 < series.length; k4++) {
				var ex = series[k4].exercise;
				var px = 24 + k4 * 26, py = 52;
				exEls.push(ex
					? h("path", { key: "ex" + k4, d: sketchCirclePath(px, py, 6.5, "ex" + k4, { points: 10, squash: 1 }), fill: "#5fae6f", fillOpacity: 0.6, stroke: "#5fae6f", strokeWidth: 1.3 })
					: h("path", { key: "ex" + k4, d: sketchCirclePath(px, py, 6.5, "ex" + k4, { points: 10, squash: 1 }), fill: "none", stroke: "var(--dsw-alias-border-l3)", strokeWidth: 1.2 }));
				exEls.push(h("text", { key: "exl" + k4, x: px, y: 82, textAnchor: "middle", fontSize: 10, fill: "var(--dsw-alias-label-tertiary)" }, series[k4].label));
			}
			charts.push(h("div", { key: "exercise", className: "aqr-chart" },
				h("svg", { width: 200, height: CH, viewBox: "0 0 200 " + CH }, exEls),
				h("div", { className: "aqr-chart-title" }, t("chartExercise")),
			));

			return h("div", { className: "aqr-charts-row" }, charts);
		}

		/** 迷你走势线（跳过缺数据日） */
		function sparkline(series, seedStr, color) {
			var vals = [];
			for (var i = 0; i < series.length; i++) {
				if (series[i] !== null && series[i] !== undefined) vals.push({ i: i, v: series[i] });
			}
			if (vals.length < 2) return null;
			var w = 64, hgt = 22, pad = 3;
			var min = Math.min.apply(null, vals.map(function (p) { return p.v; }));
			var max = Math.max.apply(null, vals.map(function (p) { return p.v; }));
			if (max - min < 0.0001) max = min + 1;
			var pts = vals.map(function (p) {
				return [pad + (p.i / (series.length - 1)) * (w - pad * 2), hgt - pad - ((p.v - min) / (max - min)) * (hgt - pad * 2)];
			});
			return h("svg", { width: w, height: hgt, viewBox: "0 0 " + w + " " + hgt, className: "aqr-spark" },
				h("path", { d: sketchLinePath(pts, seedStr, 1), fill: "none", stroke: color, strokeWidth: 1.4, opacity: 0.8 }));
		}

		/** 体征趋势瓷砖（HealthLog 式）：最新值 + 趋势箭头 + 范围状态点 + 迷你走势 */
		function VitalTiles(props) {
			var tiles = props.tiles, t = props.t;
			if (!tiles || !tiles.length) return null;
			var TITLE = { weight: t("tileWeight"), bp: t("tileBp"), pulse: t("tilePulse") };
			var statusColor = { green: "#17803d", orange: "#e0a04f", red: "#c02626" };
			var statusText = { green: t("statusGreen"), orange: t("statusOrange"), red: t("statusRed") };
			return h("div", { className: "aqr-charts-row" }, tiles.map(function (tile) {
				var dot = tile.status
					? h("span", { className: "aqr-status-dot", style: { background: statusColor[tile.status] || "var(--dsw-alias-border-l3)" }, title: statusText[tile.status] || "" })
					: h("span", { className: "aqr-status-dot", style: { background: "var(--dsw-alias-border-l3)" } });
				var dirEl = tile.dir && tile.dir !== "→"
					? h("span", { className: "aqr-tile-dir", style: { color: tile.dir === "↑" ? "#c02626" : "#5fae6f" } }, " " + tile.dir + (tile.delta ? " " + Math.abs(tile.delta) : ""))
					: null;
				return h("div", { key: tile.key, className: "aqr-tile" },
					h("div", { className: "aqr-tile-head" }, dot, h("span", null, TITLE[tile.key] || tile.key)),
					tile.value !== null && tile.value !== undefined
						? h("div", { className: "aqr-tile-value" },
							tile.value, h("span", { className: "aqr-tile-unit" }, " " + (tile.unit || "")), dirEl)
						: h("div", { className: "aqr-tile-value aqr-tile-nodata" }, "—"),
					sparkline(tile.series || [], "spark" + tile.key, "#5b8fd6"),
				);
			}));
		}

		// ---------- 面板壳（页签 + 错误边界） ----------
		class PanelBoundary extends React.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error: error };
			}
			render() {
				if (this.state.error) {
					return h("div", { className: "aqr-root" },
						h("div", { className: "aqr-inner" },
							h("p", { className: "aqr-err" }, "Cura panel error: " + (this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error))),
							h("button", { className: "aqr-btn", onClick: function () { this.setState({ error: null }); }.bind(this) }, "Retry")));
				}
				return this.props.children;
			}
		}

		function CuraPanel(props) {
			var remote = props.remote;
			var t = props.t;
			var pageState = React.useState("rules");
			var page = pageState[0], setPage = pageState[1];
			return h("div", { className: "aqr-root" },
				h("div", { className: "aqr-inner" },
					h("h1", { className: "aqr-h1" }, t("title")),
					h("p", { className: "aqr-sub" }, t("sub")),
					h("div", { className: "aqr-pages" },
						h("button", { className: "aqr-page-tab", "data-on": page === "rules", onClick: function () { setPage("rules"); } }, t("pageRules")),
						h("button", { className: "aqr-page-tab", "data-on": page === "voice", onClick: function () { setPage("voice"); } }, t("pageVoice")),
						h("button", { className: "aqr-page-tab", "data-on": page === "health", onClick: function () { setPage("health"); } }, t("pageHealth")),
						h("button", { className: "aqr-page-tab", "data-on": page === "cycle", onClick: function () { setPage("cycle"); } }, t("pageCycle")),
					),
					page === "rules" ? h(RulesPage, { remote: remote, t: t })
						: page === "voice" ? h(VoicePage, { remote: remote, t: t })
							: page === "health" ? h(HealthPage, { remote: remote, t: t })
								: h(CyclePage, { remote: remote, t: t }),
				),
			);
		}
		//#endregion

		//#region 客户端入口
		var inject = ["slots", "locale", "remote"];
		/**
		 * 客户端入口：注入样式与词条、挂载 Typert Remote、注册侧边栏入口与 main 面板。
		 * @returns {() => void} 卸载函数（对照先例：只回收 Remote 挂载；
		 *          样式/词条/slot 注册由宿主 ctx.effect 与 slot 生命周期回收）。
		 */
		async function apply(ctx) {
			ctx.effect(function () {
				var tag = document.createElement("style");
				tag.dataset.plugin = PLUGIN_ID;
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return function () { tag.remove(); };
			}, "cura-panel: style");

			ctx.effect(function () { return ctx.locale.register(NS, DICT); }, "cura-panel: dictionaries");
			var t = ctx.locale.bind(NS);

			// namespace 是独立 Cordis 服务：必须挂载后 ctx.get() 获取（先例同款注释）。
			var disposeRemote = await ctx.remote.$mount(CURA_RULES_REMOTE);
			var remote = ctx.get("remote." + REMOTE_NS);
			if (remote === undefined) throw new Error("cura-rules Remote 挂载后不可用");

			// 面板渲染：闭包直传 remote/t（dsh-onebot 同款）——slots inject 管道不保证透传任意键。
			var fallbackT = function (key) { var d = DICT.zh[key]; return d === undefined ? key : d; };
			var renderPanel = function (props) {
				return h(PanelBoundary, null, h(CuraPanel, Object.assign({}, props, { remote: remote, t: t || fallbackT })));
			};

			// main 面板（root 作用域 keyed slot，key = PANEL_ID，与侧边栏条目同 id）
			ctx.slots.inject("main", function* () {
				yield ctx.slots.register({
					name: "main",
					key: PANEL_ID,
					locale: NS,
				}, renderPanel);
			});

			// 侧边栏入口（root 作用域 panellist list slot）
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 99,
				label: () => t("panel"),
				locale: NS,
			}, RulesIcon));

			return function () { void disposeRemote(); };
		}
		//#endregion

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
