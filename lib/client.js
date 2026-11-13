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
 *
 * 图标来源：面板内联 SVG 图标取自 Tabler Icons（https://github.com/tabler/tabler-icons），
 *   MIT License, Copyright (c) 2020-2024 Paweł Kuna。仅为 <path d> 数据的再实现（viewBox 24、
 *   stroke currentColor），未引入其构建产物或运行时依赖；完整声明见仓库根 NOTICE。
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
			// 宿主中心列是 flex-direction:column + overflow:hidden，它不会替我们滚（dsh-study-desk 同款先例）。
						// 所以 root 只负责撑满并让出高度，真正的滚动条由 .aqr-scroll 自己出——否则内容超高就是被裁掉，整页不能滚。
						".aqr-root{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;width:100%;height:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}",
						".aqr-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;padding:20px 24px 48px;box-sizing:border-box}",
			".aqr-inner{max-width:980px;margin:0 auto}",
			".aqr-h1{margin:0 0 2px;font-size:18px;font-weight:600}",
			".aqr-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0 0 12px}",
			".aqr-pages{display:flex;gap:18px;border-bottom:0.5px solid var(--dsw-alias-border-l2);margin:0 0 16px}",
			".aqr-page-tab{display:inline-flex;align-items:center;gap:5px;background:transparent;border:0;cursor:pointer;font:inherit;font-size:13.5px;color:var(--dsw-alias-label-tertiary);padding:6px 2px 9px;position:relative}",
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
			".aqr-cal-grid{display:grid;grid-template-columns:repeat(7,54px);gap:4px;justify-content:center}",
			".aqr-cal-head{color:var(--dsw-alias-label-tertiary);font-size:11.5px;text-align:center;padding:4px 0}",
			".aqr-cal-cell{height:56px;display:flex;align-items:center;justify-content:center}",
			".aqr-cal-empty{opacity:0}",
			".aqr-cal-box{position:relative;width:50px;height:50px}",
			".aqr-cal-svg{position:absolute;left:0;top:0}",
			".aqr-cal-num{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-size:13px;color:var(--dsw-alias-label-primary)}",
			".aqr-cal-today .aqr-cal-num{font-weight:700;color:var(--dsw-alias-state-business-primary)}",
			".aqr-legend{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-top:10px}",
			".aqr-lg-mark{font-weight:700;margin-right:4px}",
			".aqr-privacy{border:0.5px solid var(--dsw-alias-border-l3);border-radius:10px;padding:8px 12px;margin-bottom:14px;background:var(--dsw-alias-bg-module-platform)}",
			".aqr-privacy summary{cursor:pointer;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);list-style:none}",
			".aqr-privacy summary::-webkit-details-marker{display:none}",
			".aqr-privacy summary:hover{color:var(--dsw-alias-label-primary)}",
			".aqr-privacy-title{font-weight:600;color:var(--dsw-alias-label-primary);font-size:12.5px}",
			".aqr-privacy-one{color:var(--dsw-alias-label-tertiary)}",
			".aqr-privacy p{margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:19px}",
			".aqr-tile-sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:2px}",
			".aqr-chip-gap{color:var(--dsw-alias-state-error-primary);font-weight:600}",
			".aqr-page-head{display:flex;align-items:center;gap:8px;margin:0 0 12px}",
			".aqr-page-head .aqr-ico{color:var(--dsw-alias-state-business-primary)}",
			".aqr-page-title{font-size:15px;font-weight:600;margin:0}",
			".aqr-ico{flex:none;display:inline-block;vertical-align:-2px}",
			".aqr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:4px}",
			".aqr-stat{background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:10px 12px;box-sizing:border-box}",
			".aqr-stat-label{display:flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:11.5px}",
			".aqr-stat-value{font-size:19px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums}",
			".aqr-stat-sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:1px}",
			".aqr-h2{display:flex;align-items:center;gap:6px;margin:0 0 10px;font-size:14.5px;font-weight:600}",
			".aqr-h2 .aqr-ico{color:var(--dsw-alias-label-tertiary)}",
			".aqr-phase{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600}",
			".aqr-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;align-items:start}",
			".aqr-chart-wide{grid-column:1/-1}",
			".aqr-chart{background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:10px 12px 8px;box-sizing:border-box;overflow:hidden}",
			".aqr-phases{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:2px}",
			".aqr-phase-cell{border-radius:9px;padding:8px 10px;box-sizing:border-box;border:0.5px solid transparent}",
			".aqr-phase-cell[data-on=true]{border-color:currentColor}",
			".aqr-phase-name{font-size:12px;font-weight:600;display:flex;align-items:center;gap:4px}",
			".aqr-phase-days{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}",
			".aqr-cal-grid{display:grid;grid-template-columns:repeat(7,52px);gap:2px;justify-content:center}",
			".aqr-cal-cell{height:52px;display:flex;align-items:center;justify-content:center}",
			".aqr-cal-box{position:relative;width:46px;height:46px}",
			".aqr-cal-num{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-size:13px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}",
			".aqr-cal-weekend .aqr-cal-num{color:var(--dsw-alias-label-tertiary)}",
			".aqr-cal-out .aqr-cal-num{opacity:.35}",
			".aqr-legend{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-top:12px}",
			".aqr-legend>span{display:inline-flex;align-items:center;gap:5px}",
			".aqr-lg-swatch{width:14px;height:14px;border-radius:4px;flex:none;box-sizing:border-box}",
			".aqr-privacy{border:0.5px solid var(--dsw-alias-border-l3);border-radius:10px;padding:7px 12px;margin-bottom:12px;background:var(--dsw-alias-bg-module-platform)}",
			".aqr-privacy .aqr-ico{color:var(--dsw-alias-state-success-primary,#22a06b)}",
			".aqr-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:8px}",
			".aqr-form-grid-4{grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}",
			".aqr-form-label{display:block;font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin:0 0 3px}",
			".aqr-field{display:flex;flex-direction:column}",
			".aqr-field .aqr-input,.aqr-field .aqr-select{width:100%;box-sizing:border-box}",
			".aqr-tile{background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:11px 14px 9px;box-sizing:border-box;min-width:150px;flex:1}",
			".aqr-tile-head{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11.5px}",
			".aqr-tile-value{font-size:21px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums;letter-spacing:-.2px}",
			".aqr-tile-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:3px}",
			".aqr-badge{display:inline-flex;align-items:center;gap:3px;border-radius:6px;padding:0 6px;font-size:11px;line-height:17px}",
			".aqr-badge[data-tone=green]{background:rgba(23,128,61,.12);color:#17803d}",
			".aqr-badge[data-tone=orange]{background:rgba(224,160,79,.16);color:#a9721f}",
			".aqr-badge[data-tone=red]{background:rgba(192,38,38,.13);color:#c02626}",
			".aqr-badge[data-tone=muted]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}",
			".aqr-spark{display:block;margin-top:4px}",
			".aqr-field .aqr-row{flex-wrap:nowrap;gap:6px}",
			".aqr-field .aqr-row .aqr-input{min-width:0}",
			".aqr-field-wide{grid-column:span 2}",
			".aqr-chart svg{display:block}",
			".aqr-ov-top{display:grid;grid-template-columns:150px 1fr;gap:12px;align-items:start}",
			".aqr-ov-duo{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}",
			".aqr-ov-gauge{display:flex;flex-direction:column;align-items:center;justify-content:center}",
			".aqr-axis{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;margin-top:4px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);text-align:center}",
			".aqr-ex-row{display:flex;justify-content:space-between;padding:14px 4px 6px}",
			".aqr-ex-item{display:flex;flex-direction:column;align-items:center;gap:8px;flex:1}",
			".aqr-ex-dot{width:13px;height:13px;border-radius:50%;border:1.4px solid var(--dsw-alias-border-l3);box-sizing:border-box}",
			".aqr-ex-dot.aqr-ex-on{background:#5fae6f;border-color:#5fae6f}",
			".aqr-ex-label{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
			".aqr-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}",
			".aqr-today-bar{display:flex;align-items:center;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:11px 14px;margin-bottom:12px;background:var(--dsw-alias-bg-module-platform)}",
			".aqr-today-bar-empty{border-style:dashed}",
			".aqr-today-ico{display:flex;align-items:center;color:var(--dsw-alias-state-success-primary,#22a06b)}",
			".aqr-today-bar-empty .aqr-today-ico{color:var(--dsw-alias-label-tertiary)}",
			".aqr-today-text{flex:1;min-width:0}",
			".aqr-today-title{font-size:13px;font-weight:600}",
			".aqr-today-sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".aqr-card-head .aqr-h2{margin:0}",
			".aqr-btn-ghost{background:transparent;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}",
			".aqr-btn-ghost:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}",
			".aqr-cal-wrap{display:grid;grid-template-columns:1fr 190px;gap:18px;align-items:start}",
			".aqr-cal-side{display:flex;flex-direction:column;gap:2px;border-left:1px solid var(--dsw-alias-border-l2);padding-left:14px}",
			".aqr-cal-side-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed var(--dsw-alias-border-l2);font-size:12px}",
			".aqr-cal-side-row:last-child{border-bottom:0}",
			".aqr-cal-side-label{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary)}",
			".aqr-cal-side-val{font-weight:600;font-variant-numeric:tabular-nums}",
			".aqr-checkin-top{display:flex;align-items:flex-end;gap:12px;margin-bottom:10px;flex-wrap:wrap}",
			".aqr-checkin-flow{width:180px}",
			".aqr-cal-title{margin:0 12px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}",
			".aqr-lg-dash{border:1px dashed currentColor;border-radius:50%;width:11px;height:11px;display:inline-block;text-indent:-99px;overflow:hidden}",
			".aqr-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}",
			".aqr-gauge-wrap{display:flex;justify-content:center}",
			".aqr-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}",
			".aqr-switch-row{display:flex;align-items:center;gap:8px;font-size:13px}",
			".aqr-today-phase{display:flex;align-items:center;gap:6px;font-size:14px}",
			".aqr-today-day{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;margin-left:2px}",
			".aqr-empty-warn{color:#a9721f;display:flex;align-items:center;gap:6px}",
			".aqr-note-warn{color:#a9721f;display:flex;align-items:center;gap:6px}",
			".aqr-msg{color:var(--dsw-alias-state-business-primary);font-size:12px}",
			".aqr-log-list{margin:0;padding:0;list-style:none}",
			".aqr-log-row{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}",
			".aqr-log-row:last-child{border-bottom:0}",
			".aqr-log-date{font-weight:600;font-size:12.5px;min-width:88px;font-variant-numeric:tabular-nums}",
			".aqr-log-body{flex:1;min-width:0}",
			".aqr-log-chips{display:flex;gap:6px;flex-wrap:wrap}",
			".aqr-log-note{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:3px;word-break:break-word}",
			".aqr-log-act{flex:none}",
			".aqr-cal-strip{display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;margin:2px 0 10px;color:var(--dsw-alias-label-tertiary);font-size:11.5px}",
			".aqr-bar-row{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12px}",
			".aqr-bar-label{min-width:52px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
			".aqr-bar-track{flex:1;height:8px;border-radius:5px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}",
			".aqr-bar-fill{height:100%;border-radius:5px}",
			".aqr-bar-val{min-width:44px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}",
			".aqr-advice{border-left:3px solid var(--dsw-alias-border-l3);padding:2px 0 2px 10px;margin:0 0 12px}",
			".aqr-advice[data-on=true]{border-left-color:var(--dsw-alias-state-business-primary)}",
			".aqr-advice-head{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;margin-bottom:4px}",
			".aqr-advice .aqr-textarea{background:transparent;border:0;padding:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary)}",
			".aqr-advice .aqr-textarea:focus-visible{outline:1px dashed var(--dsw-alias-border-l3);outline-offset:2px}",
			].join("\n");
		//#endregion

		//#region 词条
		var DICT = {
			zh: {
				panel: "Cura",
				title: "Cura · QQ 伴生增强",
				sub: "拟人化规则库 + 语音链路——改动实时落盘，下一条消息即生效，无需重启",
				pageRules: "表达规则",
				pageVoice: "语音通话 · beta",
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
				voiceProxy: "大脑代理（宿主 webServer 路由）",
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
				voiceCallNote: "【beta】QQ 原生语音通话：桥与引擎已就绪，等上游 KoishiRTC 修复 Windows 回放路由后改配置即恢复；DSH 内语音（say_aloud / voice_chat 工具）现已可用，但属 beta——依赖本机麦克风/扬声器与 Python 依赖，首次使用可能要调设备。",
				pageHealth: "健康日志",
				pageCycle: "周期关怀",
				pageTravel: "出行 · 高德",
				travelHint: "填高德「Web 服务」key，或直接粘完整 MCP 地址。保存后写进 travel.json，管家自动带上 amap 这条 server——DSH 里任何会话都能用。",
				travelPh: "粘贴 key，或 https://mcp.amap.com/mcp?key=…",
				travelSave: "保存",
				travelFill: "填写 key",
				travelAbout: "说明",
				travelTest: "测试连接",
				travelTesting: "连接中…（最长 30 秒）",
				travelClear: "停用",
				travelUnset: "还没配置",
				travelSet: "已配置",
				travelServer: "管家 server",
				travelFile: "配置文件",
				travelButler: "会话挂载",
				travelButlerOn: "已开启，下一条消息就带上（所有会话）",
				travelButlerOff: "butlerEnabled=false，配了也不会挂",
				travelTools: "MCP 工具",
				travelSteps: "连接过程",
				travelSample: "试调结果",
				travelOk: "连上了",
				travelFail: "没连上",
				travelNoTest: "还没测过。点「测试连接」会真连一次：握手、工具列表、试调一个只读工具都记在下面——失败就把原文贴回来，不会假装成功。",
				travelMain: "保存后插件自己把 amap 挂到所有会话，不用再去 DSH 设置里重复加一份。只有在关掉「生活关怀层挂到所有会话」（careGlobal=false）时，才需要手动在设置 → MCP 连接里加同一个地址。",
				travelPrivacy: "key 明文存本机 travel.json（与 rules.json 同级，不上传）；面板只显示打码后的地址和末四位。",
				travelSaved: "已保存",
				travelPlaces: "常用坐标",
				travelPlacesHint: "存几个常去的地方（学校、家、公司），QQ 里问「附近有什么」时直接用这些坐标，不用每轮先问你在哪。地名查坐标走高德 maps_geo。",
				travelPlaceQuery: "地名，或直接贴 经度,纬度",
				travelPlaceCity: "城市（可选，同名地点会歧义）",
				travelPlaceName: "起个名字（点下面某行的「存为常用」时用）",
				travelLocate: "查坐标",
				travelLocating: "查询中…",
				travelLocateOk: "查到了",
				travelLocateFail: "没查到",
				travelSavePlace: "存为常用",
				travelPlaceSaved: "已存下",
				travelPlaceNone: "还没存过。存一条之后，QQ 里的 AI 就能直接用这个坐标查附近。",
				travelDelete: "删",
				travelUseThis: "用这条",
				travelPlaceCount: "条",
				pageLuckin: "瑞幸 · 点单 · beta",
				luckinBeta: "【beta】这一页还没实测过——token 能存、能握手、工具列表能列出来，但真实下单流程一次也没跑过。当试验田用，出错把原文发我。",
				luckinHint: "去 open.lkcoffee.com 用手机号收验证码登录，生成 token 后整段粘过来。存进 luckin.json，管家会自动挂上 my-coffee——任何会话都能点单。",
				luckinPh: "粘贴 token（Bearer 前缀可有可无）",
				luckinUnset: "还没配置",
				luckinSet: "已配置",
				luckinToken: "令牌",
				luckinExpiry: "预计有效期",
				luckinExpiryNote: "按生成时间加 30 天估的，不是平台给的确切日期；过期后重新生成再粘一次。",
				luckinButlerOn: "已开启，下一条消息就带上（所有会话）",
				luckinButlerOff: "butlerEnabled=false，配了也不会挂",
				luckinTools: "可用工具",
				luckinNotice: "这条连接能真实下单扣费（createOrder 会回支付链接），所以「测试连接」只做握手和列工具，绝不替你先下一单。",
				luckinMain: "保存后插件自己把 my-coffee 挂到所有会话。只有在关掉「生活关怀层挂到所有会话」（careGlobal=false）时，才需要去设置 → MCP 连接里手动加：类型 streamablehttp，地址 https://gwmcp.lkcoffee.com/order/user/mcp，请求头 Authorization: Bearer <token>。",
				luckinPrivacy: "token 明文存本机 luckin.json（与 rules.json 同级，不上传）；面板只显示打码和末四位。",
				luckinNoTest: "还没测过。点「测试连接」会真连一次：握手、工具列表都在下面——失败就把原文贴回来，不会假装成功。",
				healthSummary: "近 7 天",
				healthAdd: "记一条",
				healthHabits: "关注目标",
				healthLogs: "日志",
				healthProfile: "基础资料",
				healthProfileHint: "身高和出生年用来算 BMI；性别只影响健康与周期建议，三项都可以不填。",
				healthProfileMissing: "还没填基础资料。可以在下面直接填，也可以在 QQ 里聊到相关话题时顺手告诉 Cura。",
				phHeight: "身高（cm）",
				phBirthYear: "出生年（如 1998）",
				phSex: "性别（可不填）",
				sexFemale: "女",
				sexMale: "男",
				sexUnknown: "未填",
				profileSaved: "基础资料已保存",
				profileAgeSuffix: "岁",
				bmiLabel: "BMI",
				phDate: "日期（缺省今天）",
				phSleepHours: "睡眠时长（小时，0-24）",
				phSleepQuality: "睡眠质量 1-5（5 最好）",
				phMood: "情绪 1-5（5 最好）",
				phExercise: "运动（如：跑步30分钟）",
				phWeight: "体重（kg）",
				phBpSys: "收缩压",
				phBpDia: "舒张压",
				phPulse: "心率",
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
				privacyTitle: "数据与隐私",
				privacyOne: "只存本机 · 摘要随对话发给模型 · 非医疗建议",
				privacyBody: "健康与周期数据只保存在本机 health.json（明文文件，随插件目录，不会自动同步或上传）。面板的读写都经本机 DSH，不经过任何服务器。为了让回复更贴合，近 7 天汇总与当日周期阶段会随对话上下文发送给你当前配置的模型服务商；除此之外不外传。数据属于你自己：可随时删除单条记录，卸载前请自行备份导出。以上均为生活方式参考，不是医疗建议。",
				sumCount: "记录",
				sumCountUnit: "条",
				sumSleep: "睡眠均值",
				sumSleepNone: "睡眠未记",
				sumTarget: "目标",
				sumExercise: "运动",
				sumExerciseUnit: "次",
				sumMood: "情绪",
				sumMoodNone: "情绪未记",
				sumNote: "最近备注",
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
				statsRange: "波动",
				statsCycles: "个周期样本",
				unitDay: "天",
				dayInPhaseLabel: "本阶段第",
				remoteFail: "Remote 调用失败",
				// —— 图标化后的新增词条 ——
				secCheckin: "今日打卡",
				secStats: "周期统计",
				secToday: "今日状态",
				secCalendar: "日历",
				secSettings: "周期设置",
				secAdvice: "阶段建议",
				secProfile: "基础资料",
				secVitals: "体征趋势",
				secWeek: "近 7 天",
				secOverview: "健康一览",
				secLog: "记一条",
				secGoals: "关注目标",
				secHistory: "历史记录",
				statCycleDay: "周期第几天",
				statCycleLen: "周期长度",
				statPeriodLen: "经期天数",
				statNext: "距下次月经",
				statOvu: "预估排卵",
				statAvgCycle: "平均周期",
				statRange: "周期波动",
				statSamples: "样本",
				statSleepAvg: "睡眠均值",
				statMoodAvg: "情绪均值",
				statExercise: "运动次数",
				statEntries: "记录条数",
				statBmi: "BMI",
				unitTimes: "次",
				unitKg: "kg",
				unitCm: "cm",
				phaseLegend: "四阶段分布（按周期长度估算）",
				phaseNow: "当前",
				calToday: "今天",
				calPrev: "上个月",
				calNext: "下个月",
				calBackToday: "回到今天",
				legendPeriodNow: "已记录经期",
				legendPeriodNext: "预测经期",
				legendOvuWin: "排卵窗",
				legendTodayMark: "今天",
				bmiUnder: "偏瘦",
				bmiNormal: "正常",
				bmiOver: "超重",
				bmiObese: "肥胖",
				profileHint2: "填了身高才出 BMI；出生年用来算年龄；性别只影响建议口径。",
				profileMissing2: "还没填。可以在这里填，也可以在 QQ 里顺口告诉 Cura。",
				quickAddTitle: "快速记一条",
				quickAddHint: "只填想记的项，留空的不会写入。",
				noData: "还没有数据",
				noDataHint: "记满两天就能看到趋势",
				todayCheckinDone: "今天已打卡",
				cycleOffHint: "开启后才能打卡与预测",
				loggedAt: "记录于",
				phaseMenstrual: "月经期",
				phaseFollicular: "卵泡期",
				phaseOvulatory: "排卵期",
				phaseLuteal: "黄体期",
				enableNow: "现在开启",
				daysUnit: "天",
				calHint: "圈=经期（虚线为预测），叉=排卵窗，粗圈=今天",
				healthPrivacyShort: "本地存储 · 只把摘要发给模型 · 非医疗建议",
				del: "删除",
				unitBpm: "次/分",
				logAddBtn: "记一条",
				statToday: "今日",
				calRecLabel: "本月经期",
				calPredLabel: "预测经期",
				calOvuLabel: "排卵窗",
				calTodayLabel: "今天",
				calNone: "无",
				unitDayShort: " 日",
				healthExportBtn: "导出数据",
				healthExportHint: "把基础资料、目标、周期设置与全部记录导出为 JSON 文件",
				healthExported: "已导出 JSON",
				todayLogged: "今天已记录",
				todayEmpty: "今天还没记录",
				todayEmptyHint: "顺手记一条，7 天趋势才有得看",
				todayAdd: "记一条",
				todayEdit: "补充",
				todaySleep: "睡眠",
				todayMood: "情绪",
				todayExercise: "运动",
				todayWeight: "体重",
				todayBp: "血压",
				todayPulse: "心率",
			},
			en: {
				panel: "Cura",
				title: "Cura · QQ Companion",
				sub: "Expression rules + voice pipeline — edits apply to the next message, no restart",
				pageRules: "Expression Rules",
				pageVoice: "Voice Call · beta",
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
				voiceProxy: "Brain proxy (host webServer route)",
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
				voiceCallNote: "[beta] QQ native voice call: bridge & engine ready, will return once upstream KoishiRTC fixes Windows playback routing; in-DSH voice (say_aloud / voice_chat tools) works but ships as beta — it needs a working mic/speaker and the Python deps, and may need device tuning on first use.",
				pageHealth: "Health Log",
				pageCycle: "Cycle Care",
				pageTravel: "Travel · Amap",
				travelHint: "Paste an Amap Web-service key, or the full MCP URL. Saved to travel.json; the butler mounts the amap server for every session — no extra DSH setting needed.",
				travelPh: "Paste a key, or https://mcp.amap.com/mcp?key=…",
				travelSave: "Save",
				travelFill: "Key",
				travelAbout: "About",
				travelTest: "Test connection",
				travelTesting: "Connecting… (up to 30s)",
				travelClear: "Disable",
				travelUnset: "Not configured",
				travelSet: "Configured",
				travelServer: "Butler server",
				travelFile: "Config file",
				travelButler: "Session mount",
				travelButlerOn: "enabled — next message already has it (every session)",
				travelButlerOff: "butlerEnabled=false, so it will not mount",
				travelTools: "MCP tools",
				travelSteps: "Handshake",
				travelSample: "Sample call",
				travelOk: "Connected",
				travelFail: "Not connected",
				travelNoTest: "Not tested yet. The Test button really connects: handshake, tool list and one read-only sample call are shown below — failures show the raw error, never a fake success.",
				travelMain: "The plugin mounts amap into every session itself, so you do not need to add it again under DSH Settings → MCP connections. Only if the care layer is turned off (careGlobal=false) do you need to add the same URL there manually.",
				travelPrivacy: "The key is stored in plain text in the local travel.json (same level as rules.json, never uploaded); the panel only shows a masked URL and the last 4 chars.",
				travelSaved: "Saved",
				travelPlaces: "Saved places",
				travelPlacesHint: "Keep a few places you visit often (school, home, office). When you ask what is nearby, the bot uses these coordinates instead of asking where you are. Name to coordinate goes through Amap maps_geo.",
				travelPlaceQuery: "Place name, or paste lon,lat",
				travelPlaceCity: "City (optional; helps disambiguate)",
				travelPlaceName: "Name it (used when you save a row)",
				travelLocate: "Find coordinates",
				travelLocating: "Looking up…",
				travelLocateOk: "Found",
				travelLocateFail: "Not found",
				travelSavePlace: "Save place",
				travelPlaceSaved: "Saved",
				travelPlaceNone: "Nothing saved yet. Once saved, any session can search nearby with this coordinate.",
				travelDelete: "Del",
				travelUseThis: "Use this",
				travelPlaceCount: "",
				pageLuckin: "Luckin · Order · beta",
				luckinBeta: "[beta] Never tested end to end — the token saves, the handshake works and the tool list comes back, but no real order has been placed through this page. Treat it as a sandbox and send me the raw error if it breaks.",
				luckinHint: "Sign in at open.lkcoffee.com with your phone number and the SMS code, generate a token, then paste the whole string here. Saved to luckin.json; the butler mounts my-coffee for every session, so you can order from any chat.",
				luckinPh: "Paste the token (Bearer prefix optional)",
				luckinUnset: "Not configured",
				luckinSet: "Configured",
				luckinToken: "Token",
				luckinExpiry: "Estimated expiry",
				luckinExpiryNote: "Estimated as generation time + 30 days, not an exact date from the platform. Regenerate and paste again once it lapses.",
				luckinButlerOn: "enabled — next message already has it (every session)",
				luckinButlerOff: "butlerEnabled=false, so it will not mount",
				luckinTools: "Tools",
				luckinNotice: "This connection can place real, chargeable orders (createOrder returns a payment link), so Test only performs the handshake and tool listing — it never places an order for you.",
				luckinMain: "The plugin mounts my-coffee into every session itself. Only if the care layer is turned off (careGlobal=false) do you need to add it under Settings → MCP connections: type streamablehttp, URL https://gwmcp.lkcoffee.com/order/user/mcp, header Authorization: Bearer <token>.",
				luckinPrivacy: "The token is stored in plain text in the local luckin.json (same level as rules.json, never uploaded); the panel only shows a mask and the last 4 chars.",
				luckinNoTest: "Not tested yet. Test really connects once: handshake and tool list appear below — failures show the raw error, never a fake success.",
				healthSummary: "Last 7 days",
				healthAdd: "Add entry",
				healthHabits: "Goals",
				healthLogs: "Log",
				healthProfile: "Basics",
				healthProfileHint: "Height and birth year power BMI; sex only tunes health and cycle advice. All three are optional.",
				healthProfileMissing: "No basics yet. Fill them in below, or tell Cura next time it comes up in chat.",
				phHeight: "Height (cm)",
				phBirthYear: "Birth year (e.g. 1998)",
				phSex: "Sex (optional)",
				sexFemale: "Female",
				sexMale: "Male",
				sexUnknown: "Not set",
				profileSaved: "Basics saved",
				profileAgeSuffix: "y",
				bmiLabel: "BMI",
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
				privacyTitle: "Data & privacy",
				privacyOne: "Local only · summary sent to your model provider · not medical advice",
				privacyBody: "Health and cycle data live only in local health.json (plain-text file inside the plugin folder; never auto-synced or uploaded). Panel reads and writes go through local DSH, not any server. To make replies fit better, the 7-day summary and today's cycle phase travel with the conversation context to the model provider you configured — nothing else leaves this machine. The data is yours: delete entries anytime, export before uninstalling. All of it is lifestyle reference, not medical advice.",
				sumCount: "Entries",
				sumCountUnit: "",
				sumSleep: "Avg sleep",
				sumSleepNone: "No sleep logged",
				sumTarget: "Target",
				sumExercise: "Exercise",
				sumExerciseUnit: "×",
				sumMood: "Mood",
				sumMoodNone: "No mood logged",
				sumNote: "Latest note",
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
				statsRange: "Range",
				statsCycles: "cycles sampled",
				unitDay: "d",
				dayInPhaseLabel: "day in phase",
				remoteFail: "Remote call failed",
				// —— entries added by the icon pass ——
				secCheckin: "Check in",
				secStats: "Cycle stats",
				secToday: "Today",
				secCalendar: "Calendar",
				secSettings: "Cycle settings",
				secAdvice: "Phase advice",
				secProfile: "Basics",
				secVitals: "Vitals",
				secWeek: "Last 7 days",
				secOverview: "Overview",
				secLog: "Add entry",
				secGoals: "Goals",
				secHistory: "History",
				statCycleDay: "Cycle day",
				statCycleLen: "Cycle length",
				statPeriodLen: "Period days",
				statNext: "Next period in",
				statOvu: "Est. ovulation",
				statAvgCycle: "Avg cycle",
				statRange: "Variation",
				statSamples: "Samples",
				statSleepAvg: "Avg sleep",
				statMoodAvg: "Avg mood",
				statExercise: "Exercise",
				statEntries: "Entries",
				statBmi: "BMI",
				unitTimes: "×",
				unitKg: "kg",
				unitCm: "cm",
				phaseLegend: "Phase split (estimated from cycle length)",
				phaseNow: "now",
				calToday: "Today",
				calPrev: "Previous month",
				calNext: "Next month",
				calBackToday: "Back to today",
				legendPeriodNow: "Logged period",
				legendPeriodNext: "Predicted period",
				legendOvuWin: "Ovulation window",
				legendTodayMark: "Today",
				bmiUnder: "Underweight",
				bmiNormal: "Normal",
				bmiOver: "Overweight",
				bmiObese: "Obese",
				profileHint2: "Height unlocks BMI; birth year gives age; sex only tunes wording.",
				profileMissing2: "Nothing filled in yet — do it here or just tell Cura in chat.",
				quickAddTitle: "Quick log",
				quickAddHint: "Fill only what you want to record; blanks are skipped.",
				noData: "No data yet",
				noDataHint: "Two days of entries reveal a trend",
				todayCheckinDone: "Checked in today",
				cycleOffHint: "Enable cycle care to check in and predict",
				loggedAt: "logged",
				phaseMenstrual: "Menstrual",
				phaseFollicular: "Follicular",
				phaseOvulatory: "Ovulatory",
				phaseLuteal: "Luteal",
				enableNow: "Enable now",
				daysUnit: "d",
				calHint: "Circle = period (dashed = predicted), cross = ovulation window, bold circle = today",
				healthPrivacyShort: "Local only · summary only to your provider · not medical advice",
				del: "Delete",
				phWeight: "Weight (kg)",
				phBpSys: "Systolic",
				phBpDia: "Diastolic",
				phPulse: "Pulse",
				unitBpm: "bpm",
				logAddBtn: "Log it",
				statToday: "Today",
				calRecLabel: "Period",
				calPredLabel: "Predicted",
				calOvuLabel: "Ovulation",
				calTodayLabel: "Today",
				calNone: "none",
				unitDayShort: "d",
				tileWeight: "Weight",
				tileBp: "Blood pressure",
				tilePulse: "Pulse",
				healthTrends: "Vital trends",
				statusGreen: "Normal",
				statusOrange: "Watch",
				statusRed: "High",
				voiceProviderBuiltinDesc: "Built-in voice (local system TTS, no API key)",
				voiceProviderOpenaiDesc: "OpenAI-compatible TTS endpoint",
				voiceProviderLocalDesc: "Custom local TTS service",
				healthExportBtn: "Export",
				healthExportHint: "Export profile, goals, cycle settings and every entry as JSON",
				healthExported: "JSON exported",
				todayLogged: "Logged today",
				todayEmpty: "Nothing logged today",
				todayEmptyHint: "One quick entry keeps the 7-day trend honest",
				todayAdd: "Add entry",
				todayEdit: "Add more",
				todaySleep: "Sleep",
				todayMood: "Mood",
				todayExercise: "Exercise",
				todayWeight: "Weight",
				todayBp: "BP",
				todayPulse: "Pulse",
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
			proxy: vObject({ port: vInt(0), alive: vBoolean(), url: vOptional(vString(0, 512)) }),
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
		var luckinPatchSchema = vObject({
			input: vOptional(vString(0, 2048)),
			enabled: vOptional(vBoolean()),
		});
		var luckinStateSchema = vObject({
			enabled: vBoolean(),
			hasToken: vBoolean(),
			tokenTail: vString(0, 8),
			tokenMasked: vString(0, 80),
			serverName: vString(0, 40),
			url: vString(0, 300),
			file: vString(0, 1024),
			updatedAt: vString(0, 40),
			expiresAt: vString(0, 20),
			daysLeft: vOptional(vNumber()),
			butlerEnabled: vOptional(vBoolean()),
		});
		var travelPatchSchema = vObject({
			input: vOptional(vString(0, 600)),
			enabled: vOptional(vBoolean()),
			city: vOptional(vString(0, 60)),
			location: vOptional(vString(0, 40)),
			radius: vOptional(vInt(0)),
		});
		var travelPlacePatchSchema = vObject({
			id: vOptional(vString(0, 200)),
			name: vOptional(vString(0, 60)),
			address: vOptional(vString(0, 200)),
			location: vOptional(vString(0, 40)),
			city: vOptional(vString(0, 60)),
		});
		var placeSchema = vObject({
			id: vString(1, 200),
			name: vString(0, 60),
			address: vString(0, 200),
			location: vString(1, 40),
			city: vString(0, 60),
		});
		var travelStateSchema = vObject({
			enabled: vBoolean(),
			hasKey: vBoolean(),
			url: vString(0, 600),
			keyTail: vString(0, 8),
			serverName: vString(0, 40),
			file: vString(0, 1024),
			updatedAt: vString(0, 40),
			butlerEnabled: vOptional(vBoolean()),
			places: vArray(placeSchema),
		});
		var travelSampleSchema = vObject({
			tool: vString(0, 60),
			argsText: vOptional(vString(0, 300)),
			text: vOptional(vString(0, 2000)),
			error: vOptional(vString(0, 600)),
		});
		var travelTestSchema = vObject({
			ok: vBoolean(),
			url: vString(0, 600),
			tools: vArray(vString(0, 120)),
			sample: vOptional(travelSampleSchema),
			error: vString(0, 1200),
			steps: vArray(vString(0, 200)),
			ms: vInt(0),
		});
		var locatorMatchSchema = vObject({
			location: vString(0, 40),
			province: vString(0, 40),
			city: vString(0, 40),
			district: vString(0, 40),
			level: vString(0, 40),
		});
		var travelLocateSchema = vObject({
			ok: vBoolean(),
			error: vString(0, 600),
			matches: vArray(locatorMatchSchema),
			picked: vOptional(locatorMatchSchema),
			ms: vInt(0),
		});
		var aroundPoiSchema = vObject({
			id: vString(0, 64),
			name: vString(0, 120),
			address: vString(0, 300),
			typecode: vString(0, 40),
			location: vString(0, 40),
		});
		var travelAroundSchema = vObject({
			ok: vBoolean(),
			error: vString(0, 600),
			pois: vArray(aroundPoiSchema),
			ms: vInt(0),
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
var healthProfileSchema = vObject({
				heightCm: vOptional(vNumber()),
				birthYear: vOptional(vInt(0)),
				sex: vOptional(vString(0, 10)),
			});
			var healthSnapshotSchema = vObject({
				habits: habitsSchema,
				profile: vOptional(healthProfileSchema),
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
				bmi: vOptional(vNumber()),
			}))),
			score: vOptional(vObject({
				overall: vInt(0),
				label: vString(0, 20),
				parts: vOptional(vArray(vObject({ key: vString(0, 16), score: vInt(0) }))),
			})),
			file: vOptional(vString(0, 1024)),
		});
		var healthProfilePatchSchema = vObject({
				heightCm: vOptional(vNumber()),
				birthYear: vOptional(vInt(0)),
				sex: vOptional(vString(0, 10)),
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
			curaMethod("saveHealthProfile", [jsonParameter("patch", "CuraProfilePatch", healthProfilePatchSchema)], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("saveHealthConfig", [jsonParameter("patch", "CuraHabitsPatch", vObject({ habits: vOptional(habitsPatchSchema) }))], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("saveCycle", [jsonParameter("patch", "CuraCyclePatch", cyclePatchSchema)], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("addHealthLog", [jsonParameter("entry", "CuraHealthLogInput", healthLogInputSchema)], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("deleteHealthLog", [jsonParameter("id", "CuraLogId", vString(1, 64))], healthSnapshotSchema, "CuraHealthSnapshot"),
			curaMethod("getVoiceConfig", [], voiceConfigSchema, "CuraVoiceConfig"),
			curaMethod("saveVoiceConfig", [jsonParameter("patch", "CuraVoicePatch", voicePatchSchema)], voiceConfigSchema, "CuraVoiceConfig"),
			curaMethod("getLuckin", [], luckinStateSchema, "CuraLuckinState"),
			curaMethod("saveLuckin", [jsonParameter("patch", "CuraLuckinPatch", luckinPatchSchema)], luckinStateSchema, "CuraLuckinState"),
			curaMethod("testLuckin", [jsonParameter("patch", "CuraLuckinPatch", luckinPatchSchema)], travelTestSchema, "CuraLuckinTest"),
			curaMethod("getTravel", [], travelStateSchema, "CuraTravelState"),
			curaMethod("saveTravel", [jsonParameter("patch", "CuraTravelPatch", travelPatchSchema)], travelStateSchema, "CuraTravelState"),
			curaMethod("testTravel", [jsonParameter("patch", "CuraTravelPatch", travelPatchSchema)], travelTestSchema, "CuraTravelTest"),
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

		//#region 图标（Tabler Icons 的 <path d> 数据，MIT；见仓库根 NOTICE）
		var ICON_PATHS = {
			"heartbeat": ["M19.5 13.572l-7.5 7.428l-2.896 -2.868m-6.117 -8.104a5 5 0 0 1 9.013 -3.022a5 5 0 1 1 7.5 6.572", "M3 13h2l2 3l2 -6l1 3h3"],
			"heart-rate-monitor": ["M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -10", "M7 20h10", "M9 16v4", "M15 16v4", "M7 10h2l2 3l2 -6l1 3h3"],
			"activity": ["M3 12h4l3 8l4 -16l3 8h4"],
			"moon": ["M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008"],
			"mood-smile": ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M9 10l.01 0", "M15 10l.01 0", "M9.5 15a3.5 3.5 0 0 0 5 0"],
			"barbell": ["M2 12h1", "M6 8h-2a1 1 0 0 0 -1 1v6a1 1 0 0 0 1 1h2", "M6 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1", "M9 12h6", "M15 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1", "M18 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2", "M22 12h-1"],
			"scale": ["M7 20l10 0", "M6 6l6 -1l6 1", "M12 3l0 17", "M9 12l-3 -6l-3 6a3 3 0 0 0 6 0", "M21 12l-3 -6l-3 6a3 3 0 0 0 6 0"],
			"droplet": ["M7.502 19.423c2.602 2.105 6.395 2.105 8.996 0c2.602 -2.105 3.262 -5.708 1.566 -8.546l-4.89 -7.26c-.42 -.625 -1.287 -.803 -1.936 -.397a1.376 1.376 0 0 0 -.41 .397l-4.893 7.26c-1.695 2.838 -1.035 6.441 1.567 8.546"],
			"user": ["M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0", "M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"],
			"lock": ["M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6", "M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0", "M8 11v-4a4 4 0 1 1 8 0v4"],
			"notes": ["M5 5a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -14", "M9 7l6 0", "M9 11l6 0", "M9 15l4 0"],
			"chart-line": ["M4 19l16 0", "M4 15l4 -6l4 2l4 -5l4 4"],
			"calendar": ["M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12", "M16 3v4", "M8 3v4", "M4 11h16"],
			"plus": ["M12 5l0 14", "M5 12l14 0"],
			"target": ["M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"],
			"trash": ["M4 7l16 0", "M10 11l0 6", "M14 11l0 6", "M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12", "M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"],
			"device-watch": ["M6 9a3 3 0 0 1 3 -3h6a3 3 0 0 1 3 3v6a3 3 0 0 1 -3 3h-6a3 3 0 0 1 -3 -3v-6", "M9 18v3h6v-3", "M9 6v-3h6v3"],
			"shield-check": ["M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06", "M15 19l2 2l4 -4"],
			"trending-up": ["M3 17l6 -6l4 4l8 -8", "M14 7l7 0l0 7"],
			"trending-down": ["M3 7l6 6l4 -4l8 8", "M21 10l0 7l-7 0"],
			"calendar-heart": ["M11.5 21h-5.5a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4", "M16 3v4", "M8 3v4", "M4 11h16", "M18 22l3.35 -3.284a2.143 2.143 0 0 0 .005 -3.071a2.242 2.242 0 0 0 -3.129 -.006l-.224 .22l-.223 -.22a2.242 2.242 0 0 0 -3.128 -.006a2.143 2.143 0 0 0 -.006 3.071l3.355 3.296"],
			"flower": ["M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M12 2a3 3 0 0 1 3 3c0 .562 -.259 1.442 -.776 2.64l-.724 1.36l1.76 -1.893c.499 -.6 .922 -1 1.27 -1.205a2.968 2.968 0 0 1 4.07 1.099a3.011 3.011 0 0 1 -1.09 4.098c-.374 .217 -.99 .396 -1.846 .535l-2.664 .366l2.4 .326c1 .145 1.698 .337 2.11 .576a3.011 3.011 0 0 1 1.09 4.098a2.968 2.968 0 0 1 -4.07 1.098c-.348 -.202 -.771 -.604 -1.27 -1.205l-1.76 -1.893l.724 1.36c.516 1.199 .776 2.079 .776 2.64a3 3 0 0 1 -6 0c0 -.562 .259 -1.442 .776 -2.64l.724 -1.36l-1.76 1.893c-.499 .601 -.922 1 -1.27 1.205a2.968 2.968 0 0 1 -4.07 -1.098a3.011 3.011 0 0 1 1.09 -4.098c.374 -.218 .99 -.396 1.846 -.536l2.664 -.366l-2.4 -.325c-1 -.145 -1.698 -.337 -2.11 -.576a3.011 3.011 0 0 1 -1.09 -4.099a2.968 2.968 0 0 1 4.07 -1.099c.348 .203 .771 .604 1.27 1.205l1.76 1.894c-1 -2.292 -1.5 -3.625 -1.5 -4a3 3 0 0 1 3 -3"],
			"egg": ["M19 14.083c0 4.154 -2.966 6.74 -7 6.917c-4.2 0 -7 -2.763 -7 -6.917c0 -5.538 3.5 -11.09 7 -11.083c3.5 .007 7 5.545 7 11.083"],
			"sun": ["M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"],
			"moon-stars": ["M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008", "M17 4a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2", "M19 11h2m-1 -1v2"],
			"sparkles": ["M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6"],
			"clipboard-check": ["M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2", "M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2", "M9 14l2 2l4 -4"],
			"circle-check": ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M9 12l2 2l4 -4"],
			"gender-female": ["M7 9a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", "M12 14v7", "M9 18h6"],
			"temperature": ["M10 13.5a4 4 0 1 0 4 0v-8.5a2 2 0 0 0 -4 0v8.5", "M10 9l4 0"],
			"arrow-up-right": ["M17 7l-10 10", "M8 7l9 0l0 9"],
			"arrow-down-right": ["M7 7l10 10", "M17 8l0 9l-9 0"],
			"settings": ["M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065", "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"],
			"info-circle": ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M12 9h.01", "M11 12h1v4h1"],
			"chevron-left": ["M15 6l-6 6l6 6"],
			"chevron-right": ["M9 6l6 6l-6 6"],
			"circle-dashed": ["M8.56 3.69a9 9 0 0 0 -2.92 1.95", "M3.69 8.56a9 9 0 0 0 -.69 3.44", "M3.69 15.44a9 9 0 0 0 1.95 2.92", "M8.56 20.31a9 9 0 0 0 3.44 .69", "M15.44 20.31a9 9 0 0 0 2.92 -1.95", "M20.31 15.44a9 9 0 0 0 .69 -3.44", "M20.31 8.56a9 9 0 0 0 -1.95 -2.92", "M15.44 3.69a9 9 0 0 0 -3.44 -.69"],
			"refresh": ["M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4", "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"],
			"pencil": ["M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4", "M13.5 6.5l4 4"],
			"download": ["M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2", "M7 11l5 5l5 -5", "M12 4l0 12"],
			"check": ["M5 12l5 5l10 -10"],
			"x": ["M18 6l-12 12", "M6 6l12 12"],
			"clock": ["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0", "M12 7v5l3 3"],
			"ruler-measure": ["M19.875 12c.621 0 1.125 .512 1.125 1.143v5.714c0 .631 -.504 1.143 -1.125 1.143h-15.875a1 1 0 0 1 -1 -1v-5.857c0 -.631 .504 -1.143 1.125 -1.143h15.75", "M9 12v2", "M6 12v3", "M12 12v3", "M18 12v3", "M15 12v2", "M3 3v4", "M3 5h18", "M21 3v4"],
			"weight": ["M9 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M6.835 9h10.33a1 1 0 0 1 .984 .821l1.637 9a1 1 0 0 1 -.984 1.179h-13.604a1 1 0 0 1 -.984 -1.179l1.637 -9a1 1 0 0 1 .984 -.821"],
			"walk": ["M12 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M7 21l3 -4", "M16 21l-2 -4l-3 -3l1 -6", "M6 12l2 -3l4 -1l3 3l3 1"],
			"glass-full": ["M8 21l8 0", "M12 15l0 6", "M17 3l1 7c0 3.012 -2.686 5 -6 5s-6 -1.988 -6 -5l1 -7h10", "M6 10a5 5 0 0 1 6 0a5 5 0 0 0 6 0"],
			"mood-heart": ["M21 12a9 9 0 1 0 -8.012 8.946", "M9 10h.01", "M15 10h.01", "M9.5 15a3.59 3.59 0 0 0 2.774 .99", "M18.994 21.5l2.518 -2.58a1.74 1.74 0 0 0 .004 -2.413a1.627 1.627 0 0 0 -2.346 -.005l-.168 .172l-.168 -.172a1.627 1.627 0 0 0 -2.346 -.004a1.74 1.74 0 0 0 -.004 2.412l2.51 2.59"],
			"heart": ["M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"],
			"calendar-stats": ["M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4", "M18 14v4h4", "M14 18a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M15 3v4", "M7 3v4", "M3 11h16"],
			"file-download": ["M14 3v4a1 1 0 0 0 1 1h4", "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2", "M12 17v-6", "M9.5 14.5l2.5 2.5l2.5 -2.5"],
			"list-details": ["M13 5h8", "M13 9h5", "M13 15h8", "M13 19h5", "M3 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4", "M3 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"],
			"alert-triangle": ["M12 9v4", "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0", "M12 16h.01"],
			"phone": ["M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"],
			"phone-call": ["M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2", "M15 7a2 2 0 0 1 2 2", "M15 3a6 6 0 0 1 6 6"],
			"message-chatbot": ["M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12", "M9.5 9h.01", "M14.5 9h.01", "M9.5 13a3.5 3.5 0 0 0 5 0"],
			"map-pin": ["M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0", "M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0"],
			"map-2": ["M12 18.5l-3 -1.5l-6 3v-13l6 -3l6 3l6 -3v7.5", "M9 4v13", "M15 7v5.5", "M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M20.2 20.2l1.8 1.8"],
			"coffee": ["M3 14h14v-6a2 2 0 0 0 -2 -2h-10a2 2 0 0 0 -2 2v6", "M3 14a4 4 0 0 0 4 4h6a4 4 0 0 0 4 -4", "M17 9h1a3 3 0 0 1 0 6h-1", "M6 3v1", "M10 3v1"],
			"plug": ["M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5", "M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5", "M3 21l2.5 -2.5", "M18.5 5.5l2.5 -2.5", "M10 14l-2 2", "M13 11l-2 2", "M16 8l-2 2"],
		};
		/** 内联图标：viewBox 24 + stroke currentColor，与 tabler 源文件同构 */
		function Icon(props) {
			var name = props.name;
			var ds = ICON_PATHS[name];
			if (!ds) return null;
			var size = props.size || 16;
			var stroke = props.strokeWidth || 1.8;
			return h("svg", {
				width: size, height: size, viewBox: "0 0 24 24", fill: "none",
				stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round",
				className: "aqr-ico" + (props.className ? " " + props.className : ""), "aria-hidden": true,
			}, ds.map(function (d, i) { return h("path", { key: i, d: d }); }));
		}
		//#endregion

		/** 侧边栏入口图标（沿用原入口名，内容换成 Tabler 心跳） */
		function RulesIcon(props) {
			return h(Icon, { name: "heart", size: (props && props.size) || 20 });
		}

// ---------- 小工具组件（图标化改版共用） ----------
		/** 卡片标题：图标 + 文本 */
		function CardTitle(props) {
			return h("h2", { className: "aqr-h2" },
				props.icon ? h(Icon, { name: props.icon, size: 15 }) : null,
				h("span", null, props.children));
		}

		/** 统计小卡：图标 + 标签 + 大数字 + 副标题 */
		function Stat(props) {
			return h("div", { className: "aqr-stat" },
				h("div", { className: "aqr-stat-label" }, props.icon ? h(Icon, { name: props.icon, size: 13 }) : null, h("span", null, props.label)),
				h("div", { className: "aqr-stat-value" }, props.value, props.unit ? h("span", { className: "aqr-tile-unit" }, " " + props.unit) : null),
				props.sub ? h("div", { className: "aqr-stat-sub" }, props.sub) : null,
			);
		}

		/** 带图标的小徽标 */
		function Badge(props) {
			return h("span", { className: "aqr-badge", "data-tone": props.tone || "muted" },
				props.icon ? h(Icon, { name: props.icon, size: 11 }) : null,
				h("span", null, props.children));
		}

		/** 横向比例条 */
		function BarRow(props) {
			var pct = Math.max(0, Math.min(100, props.pct || 0));
			return h("div", { className: "aqr-bar-row" },
				h("span", { className: "aqr-bar-label" }, props.label),
				h("div", { className: "aqr-bar-track" },
					h("div", { className: "aqr-bar-fill", style: { width: pct + "%", background: props.color || "var(--dsw-alias-state-business-primary)" } })),
				h("span", { className: "aqr-bar-val" }, props.value),
			);
		}

		var PHASE_COLOR = { menstrual: "#ef6b6b", follicular: "#5fae6f", ovulatory: "#8e7cc3", luteal: "#e0a04f" };
		var PHASE_ICON = { menstrual: "droplet", follicular: "flower", ovulatory: "egg", luteal: "moon" };
		function phaseName(t, key) {
			var map = { menstrual: "phaseMenstrual", follicular: "phaseFollicular", ovulatory: "phaseOvulatory", luteal: "phaseLuteal" };
			return t(map[key] || "phaseLuteal");
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
						h("li", null, h(Dot, { ok: info.proxy.alive }), h("span", null, t("voiceProxy") + (info.proxy.url ? " · " + info.proxy.url : "") + " — " + (info.proxy.alive ? t("voiceProxyAlive") : t("voiceProxyDown")))),
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
			var blankForm = { date: todayStr, sleepHours: "", sleepQuality: "", mood: "", exercise: "", weight: "", bpSystolic: "", bpDiastolic: "", pulse: "", notes: "" };
			var formState = React.useState(blankForm);
			var form = formState[0], setForm = formState[1];
			var habitsState = React.useState(null); // {sleepTarget, exerciseWeekly, focusNote}
			var habits = habitsState[0], setHabits = habitsState[1];
			var profileState = React.useState(null); // {heightCm, birthYear, sex}
			var profile = profileState[0], setProfile = profileState[1];
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
						var p = value.profile || {};
						setProfile({
							heightCm: p.heightCm != null ? String(p.heightCm) : "",
							birthYear: p.birthYear != null ? String(p.birthYear) : "",
							sex: p.sex || "",
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
					setForm(blankForm);
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
			function saveProfile() {
				var patch = {};
				patch.heightCm = profile.heightCm === "" ? null : Number(profile.heightCm);
				patch.birthYear = profile.birthYear === "" ? null : Number(profile.birthYear);
				patch.sex = profile.sex || "";
				remote.saveHealthProfile(patch).then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setSnap(value); setErr(""); flash(t("profileSaved"));
					var p = value.profile || {};
					setProfile({
						heightCm: p.heightCm != null ? String(p.heightCm) : "",
						birthYear: p.birthYear != null ? String(p.birthYear) : "",
						sex: p.sex || "",
					});
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
			// 导出全部健康数据（隐私文案承诺「卸载前自行备份导出」，这里给出入口）
			function exportHealth() {
				if (!snap) return;
				var payload = {
					version: 1,
					exportedAt: new Date().toISOString(),
					profile: snap.profile || {},
					habits: snap.habits || {},
					cycle: snap.cycle || null,
					logs: snap.logs || [],
				};
				var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
				var url = URL.createObjectURL(blob);
				var a = document.createElement("a");
				a.href = url;
				a.download = "cura-health-" + todayStr + ".json";
				a.click();
				setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
				flash(t("healthExported"));
			}

			var s = snap ? snap.summary : null;
			var logs = snap ? snap.logs.slice().sort(function (a, b) { var ka = String(a.date || "") + " " + String(a.createdAt || ""); var kb = String(b.date || "") + " " + String(b.createdAt || ""); return kb < ka ? -1 : kb > ka ? 1 : 0; }) : [];
			var setH = function (key, value) { setHabits(Object.assign({}, habits, (function () { var o = {}; o[key] = value; return o; })())); };
			var setP = function (key, value) { setProfile(Object.assign({}, profile, (function () { var o = {}; o[key] = value; return o; })())); };
			var prof = snap ? (snap.profile || {}) : null;
			var profAge = prof && prof.birthYear ? (new Date().getFullYear() - prof.birthYear) : null;
			var profComplete = Boolean(prof && prof.heightCm && prof.birthYear && prof.sex);
			var sleepTarget = snap && snap.habits && snap.habits.sleepTarget != null ? Number(snap.habits.sleepTarget) : 7.5;
			var sleepGap = Boolean(s && s.sleepAvg != null && s.sleepAvg < sleepTarget - 0.5);
			var todayLogs = snap && snap.logs ? snap.logs.filter(function (l) { return l.date === todayStr; }) : [];
			var todayEntry = todayLogs.length ? todayLogs[todayLogs.length - 1] : null;
			var todayHas = Boolean(todayEntry && (todayEntry.sleepHours != null || todayEntry.mood != null || todayEntry.exercise || todayEntry.weight != null || todayEntry.bpSystolic != null || todayEntry.pulse != null));
			var quickRef = React.useRef(null);
			function jumpQuick() {
				if (quickRef.current && quickRef.current.scrollIntoView) quickRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
			}

			// ---- 统计条 ----
			var statRow = h("div", { className: "aqr-stats" },
				h(Stat, { icon: "list-details", label: t("statEntries"), value: s ? s.total : "—", unit: s ? t("unitTimes") : "" }),
				h(Stat, { icon: "moon", label: t("statSleepAvg"), value: s && s.sleepAvg != null ? s.sleepAvg : "—", unit: "h", sub: t("sumTarget") + " " + sleepTarget + "h" }),
				h(Stat, { icon: "mood-smile", label: t("statMoodAvg"), value: s && s.moodAvg != null ? s.moodAvg : "—", unit: "/5" }),
				h(Stat, { icon: "barbell", label: t("statExercise"), value: s ? s.exerciseCount : "—", unit: t("unitTimes") }),
			);

			// ---- 日志列表 ----
			function logRow(l) {
				var chips = [];
				if (l.sleepHours != null) chips.push(h(Badge, { key: "sl", tone: "muted", icon: "moon" }, l.sleepHours + "h" + (l.sleepQuality != null ? " · " + l.sleepQuality + "/5" : "")));
				if (l.mood != null) chips.push(h(Badge, { key: "mo", tone: "muted", icon: "mood-smile" }, l.mood + "/5"));
				if (l.exercise) chips.push(h(Badge, { key: "ex", tone: "muted", icon: "walk" }, l.exercise));
				if (l.weight != null) chips.push(h(Badge, { key: "we", tone: "muted", icon: "scale" }, l.weight + "kg"));
				if (l.bpSystolic != null && l.bpDiastolic != null) chips.push(h(Badge, { key: "bp", tone: "muted", icon: "heart-rate-monitor" }, l.bpSystolic + "/" + l.bpDiastolic));
				if (l.pulse != null) chips.push(h(Badge, { key: "pu", tone: "muted", icon: "heartbeat" }, String(l.pulse)));
				return h("li", { key: l.id, className: "aqr-log-row" },
					h("span", { className: "aqr-log-date" }, l.date),
					h("div", { className: "aqr-log-body" },
						chips.length ? h("div", { className: "aqr-log-chips" }, chips) : h("span", { className: "aqr-empty" }, "—"),
						l.notes ? h("div", { className: "aqr-log-note" }, l.notes) : null),
					h("span", { className: "aqr-log-act" },
						h("button", { className: "aqr-btn aqr-btn-danger aqr-btn-sm", onClick: function () { delLog(l.id); }, title: t("del") }, h(Icon, { name: "trash", size: 13 }))),
				);
			}

			return h("div", null,
				err ? h("p", { className: "aqr-err", role: "alert" }, err) : null,
				h("div", { className: "aqr-page-head" },
					h("span", { className: "aqr-page-title" }, h(Icon, { name: "heartbeat", size: 18 }), h("span", null, t("pageHealth"))),
					h("span", { className: "aqr-sub" }, t("healthPrivacyShort")),
				),
				h(PrivacyBanner, { t: t }),

				// 今日摘要条：一眼看到今天记了没有、记了什么
				snap ? h("div", { className: "aqr-today-bar" + (todayHas ? "" : " aqr-today-bar-empty") },
					h("span", { className: "aqr-today-ico" }, h(Icon, { name: todayHas ? "circle-check" : "circle-dashed", size: 16 })),
					h("div", { className: "aqr-today-text" },
						h("div", { className: "aqr-today-title" }, todayHas ? t("todayLogged") : t("todayEmpty")),
						h("div", { className: "aqr-today-sub" }, todayHas
							? [
								todayEntry.sleepHours != null ? t("todaySleep") + " " + todayEntry.sleepHours + "h" + (todayEntry.sleepQuality != null ? " · " + todayEntry.sleepQuality + "/5" : "") : null,
								todayEntry.mood != null ? t("todayMood") + " " + todayEntry.mood + "/5" : null,
								todayEntry.exercise ? t("todayExercise") + " " + todayEntry.exercise : null,
								todayEntry.weight != null ? t("todayWeight") + " " + todayEntry.weight + "kg" : null,
								todayEntry.bpSystolic != null && todayEntry.bpDiastolic != null ? t("todayBp") + " " + todayEntry.bpSystolic + "/" + todayEntry.bpDiastolic : null,
								todayEntry.pulse != null ? t("todayPulse") + " " + todayEntry.pulse + "bpm" : null,
								todayEntry.notes ? "「" + todayEntry.notes + "」" : null,
							].filter(Boolean).join(" · ")
							: t("todayEmptyHint"))),
					h("button", { className: "aqr-btn aqr-btn-sm" + (todayHas ? " aqr-btn-ghost" : " aqr-btn-primary"), onClick: jumpQuick },
						h(Icon, { name: "plus", size: 13 }), h("span", null, todayHas ? t("todayEdit") : t("todayAdd"))) ) : null,

				statRow,

				// 基础资料
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "user" }, t("secProfile")),
					profile ? h("div", null,
						!profComplete ? h("p", { className: "aqr-empty aqr-empty-warn" }, h(Icon, { name: "info-circle", size: 13 }), h("span", null, t("profileMissing2"))) : null,
						h("div", { className: "aqr-form-grid" },
							h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "ruler-measure", size: 12 }), h("span", null, t("phHeight"))),
								h("input", { className: "aqr-input", type: "number", step: "0.1", min: "100", max: "230", placeholder: "165", value: profile.heightCm, onChange: function (e) { setP("heightCm", e.target.value); } })),
							h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "calendar", size: 12 }), h("span", null, t("phBirthYear"))),
								h("input", { className: "aqr-input", type: "number", min: "1900", max: String(new Date().getFullYear()), placeholder: "2002", value: profile.birthYear, onChange: function (e) { setP("birthYear", e.target.value); } })),
							h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "gender-female", size: 12 }), h("span", null, t("phSex"))),
								h("select", { className: "aqr-select", value: profile.sex, onChange: function (e) { setP("sex", e.target.value); } },
									h("option", { value: "" }, t("phSex")),
									h("option", { value: "female" }, t("sexFemale")),
									h("option", { value: "male" }, t("sexMale")))),
						),
						h("div", { className: "aqr-row", style: { marginTop: "10px" } },
							h("button", { className: "aqr-btn aqr-btn-primary", onClick: saveProfile }, h(Icon, { name: "check", size: 13 }), h("span", null, t("saveBtn"))),
							profAge !== null ? h(Badge, { tone: "muted", icon: "calendar-stats" }, profAge + " " + t("profileAgeSuffix")) : null,
							h("span", { className: "aqr-msg" }, msgState[0])),
						h("p", { className: "aqr-note" }, t("healthProfileHint")),
					) : h("p", { className: "aqr-empty" }, "…"),
				),

				// 体征趋势
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "activity" }, t("secVitals")),
					snap ? h(VitalTiles, { tiles: snap.tiles, t: t }) : h("p", { className: "aqr-empty" }, "…"),
				),

				// 图表
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "chart-line" }, t("secOverview")),
					snap ? h(HealthCharts, { series: snap.series, score: snap.score, habits: snap.habits, t: t }) : h("p", { className: "aqr-empty" }, "…"),
					sleepGap ? h("p", { className: "aqr-note aqr-note-warn" }, h(Icon, { name: "alert-triangle", size: 12 }), h("span", null, t("sumSleep") + " " + s.sleepAvg + "h < " + t("sumTarget") + " " + sleepTarget + "h")) : null,
				),

				// 记一条
				h("div", { className: "aqr-card", ref: quickRef },
					h(CardTitle, { icon: "plus" }, t("quickAddTitle")),
					h("p", { className: "aqr-note" }, t("quickAddHint")),
					h("div", { className: "aqr-form-grid aqr-form-grid-4" },
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "calendar", size: 12 }), h("span", null, t("colDate"))),
							h("input", { className: "aqr-input", type: "date", value: form.date, onChange: function (e) { setF("date", e.target.value); } })),
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "moon", size: 12 }), h("span", null, t("phSleepHours"))),
							h("input", { className: "aqr-input", type: "number", step: "0.1", min: "0", max: "24", placeholder: "7.5", value: form.sleepHours, onChange: function (e) { setF("sleepHours", e.target.value); } })),
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "moon-stars", size: 12 }), h("span", null, t("phSleepQuality"))),
							h("select", { className: "aqr-select", value: form.sleepQuality, onChange: function (e) { setF("sleepQuality", e.target.value); } },
								h("option", { value: "" }, "—"),
								[1, 2, 3, 4, 5].map(function (n) { return h("option", { key: n, value: n }, n + "/5"); }))),
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "mood-smile", size: 12 }), h("span", null, t("phMood"))),
							h("select", { className: "aqr-select", value: form.mood, onChange: function (e) { setF("mood", e.target.value); } },
								h("option", { value: "" }, "—"),
								[1, 2, 3, 4, 5].map(function (n) { return h("option", { key: n, value: n }, n + "/5"); }))),
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "walk", size: 12 }), h("span", null, t("phExercise"))),
							h("input", { className: "aqr-input", placeholder: t("phExercise"), value: form.exercise, onChange: function (e) { setF("exercise", e.target.value); } })),
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "scale", size: 12 }), h("span", null, t("phWeight"))),
							h("input", { className: "aqr-input", type: "number", step: "0.1", min: "30", max: "250", placeholder: "55", value: form.weight, onChange: function (e) { setF("weight", e.target.value); } })),
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "heart-rate-monitor", size: 12 }), h("span", null, t("phBpSys") + " / " + t("phBpDia"))),
							h("div", { className: "aqr-row", style: { gap: "6px" } },
								h("input", { className: "aqr-input aqr-fill", type: "number", min: "60", max: "260", placeholder: "120", value: form.bpSystolic, onChange: function (e) { setF("bpSystolic", e.target.value); } }),
								h("input", { className: "aqr-input aqr-fill", type: "number", min: "30", max: "160", placeholder: "80", value: form.bpDiastolic, onChange: function (e) { setF("bpDiastolic", e.target.value); } }))),
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "heartbeat", size: 12 }), h("span", null, t("phPulse"))),
							h("input", { className: "aqr-input", type: "number", min: "30", max: "220", placeholder: "72", value: form.pulse, onChange: function (e) { setF("pulse", e.target.value); } })),
					),
					h("label", { className: "aqr-field", style: { marginTop: "10px" } }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "notes", size: 12 }), h("span", null, t("phNotes"))),
						h("textarea", { className: "aqr-textarea", rows: 2, placeholder: t("phNotes"), value: form.notes, onChange: function (e) { setF("notes", e.target.value); } })),
					h("div", { className: "aqr-row", style: { marginTop: "10px" } },
						h("button", { className: "aqr-btn aqr-btn-primary", onClick: addLog }, h(Icon, { name: "plus", size: 13 }), h("span", null, t("healthAddBtn"))),
						h("span", { className: "aqr-msg" }, msgState[0])),
				),

				// 关注目标
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "target" }, t("secGoals")),
					habits ? h("div", null,
						h("div", { className: "aqr-form-grid" },
							h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "moon", size: 12 }), h("span", null, t("phSleepTarget"))),
								h("input", { className: "aqr-input", type: "number", step: "0.1", min: "3", max: "14", placeholder: "7.5", value: habits.sleepTarget, onChange: function (e) { setH("sleepTarget", e.target.value); } })),
							h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "barbell", size: 12 }), h("span", null, t("phExerciseWeekly"))),
								h("input", { className: "aqr-input", type: "number", min: "0", max: "14", placeholder: "3", value: habits.exerciseWeekly, onChange: function (e) { setH("exerciseWeekly", e.target.value); } })),
						),
						h("label", { className: "aqr-field", style: { marginTop: "10px" } }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "notes", size: 12 }), h("span", null, t("phFocusNote"))),
							h("textarea", { className: "aqr-textarea", rows: 2, placeholder: t("phFocusNote"), value: habits.focusNote, onChange: function (e) { setH("focusNote", e.target.value); } })),
						h("div", { className: "aqr-row", style: { marginTop: "10px" } },
							h("button", { className: "aqr-btn aqr-btn-primary", onClick: saveHabits }, h(Icon, { name: "check", size: 13 }), h("span", null, t("saveBtn")))),
					) : h("p", { className: "aqr-empty" }, "…"),
				),

				// 历史
				h("div", { className: "aqr-card" },
					h("div", { className: "aqr-card-head" },
						h(CardTitle, { icon: "list-details" }, t("secHistory")),
						snap && snap.logs.length
							? h("button", { className: "aqr-btn aqr-btn-ghost aqr-btn-sm", onClick: exportHealth, title: t("healthExportHint") },
								h(Icon, { name: "download", size: 13 }), h("span", null, t("healthExportBtn")))
							: null),
					logs.length
						? h("ul", { className: "aqr-log-list" }, logs.map(logRow))
						: h("p", { className: "aqr-empty" }, snap ? t("noData") : "…"),
					logs.length ? null : h("p", { className: "aqr-note" }, t("noDataHint")),
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
			function applyConfig(value) {
				var cfg = value.cycle.config || {};
				setForm({
					enabled: value.cycle.enabled === true,
					lastStart: cfg.lastStart || "",
					cycleLength: cfg.cycleLength != null ? String(cfg.cycleLength) : "28",
					periodLength: cfg.periodLength != null ? String(cfg.periodLength) : "5",
				});
			}
			function refresh() {
				remote.getHealth().then(function (result) {
					var value = unwrap(result);
					if (!mountedRef.current) return;
					setSnap(value);
					if (!loadedRef.current) {
						loadedRef.current = true;
						applyConfig(value);
						var cfg = value.cycle.config || {};
						setAdvice({
							menstrual: (cfg.advice && cfg.advice.menstrual) || "",
							follicular: (cfg.advice && cfg.advice.follicular) || "",
							ovulatory: (cfg.advice && cfg.advice.ovulatory) || "",
							luteal: (cfg.advice && cfg.advice.luteal) || "",
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
					applyConfig(value);
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
					applyConfig(value);
				}, function (e) {
					if (mountedRef.current) setErr(e && e.message ? e.message : String(e));
				});
			}
			var today = snap && snap.cycle.enabled ? snap.cycle.today : null;
			var stats = snap && snap.cycle.enabled ? snap.cycle.stats : null;
			if (!snap || !form) {
				return h("div", null, err ? h("p", { className: "aqr-err" }, err) : null, h("div", { className: "aqr-card" }, h("p", { className: "aqr-empty" }, "…")));
			}
			var enabled = snap.cycle.enabled === true;

			// ---- 统计条 ----
			var statRow = h("div", { className: "aqr-stats" },
				h(Stat, { icon: "calendar-stats", label: t("statCycleDay"), value: today ? today.cycleDay : "—", unit: today ? t("unitDay") : "", sub: today ? t("statCycleLen") + " " + today.cycleLength + t("unitDay") : null }),
				h(Stat, { icon: "droplet", label: t("statPeriodLen"), value: form.periodLength || "—", unit: t("unitDay") }),
				h(Stat, { icon: "calendar-heart", label: t("statNext"), value: today && today.nextPeriodInDays != null ? today.nextPeriodInDays : "—", unit: t("unitDay"), sub: today && today.nextPeriodDate ? today.nextPeriodDate.slice(5) : null }),
				h(Stat, { icon: "egg", label: t("statOvu"), value: today && today.ovulationDate ? today.ovulationDate.slice(5) : "—" }),
			);

			// ---- 四阶段色条 ----
			var phaseBar = null;
			if (today) {
				var order = ["menstrual", "follicular", "ovulatory", "luteal"];
				var ovuDay = today.cycleLength - 14;
				var days = {
					menstrual: today.periodLength,
					follicular: Math.max(0, ovuDay - 2 - today.periodLength),
					ovulatory: 3,
					luteal: Math.max(0, today.cycleLength - (today.periodLength + Math.max(0, ovuDay - 2 - today.periodLength) + 3)),
				};
				var total = today.cycleLength || 28;
				phaseBar = h("div", { className: "aqr-phases" }, order.map(function (key) {
					var d = days[key] || 0;
					var pct = Math.max(4, Math.round((d / total) * 100));
					return h("div", {
						key: key,
						className: "aqr-phase-cell",
						"data-on": today.phase === key,
						style: { flex: String(pct), borderTopColor: PHASE_COLOR[key] },
					},
						h(Icon, { name: PHASE_ICON[key], size: 13 }),
						h("span", { className: "aqr-phase-name" }, phaseName(t, key)),
						h("span", { className: "aqr-phase-days" }, d + t("daysUnit")),
					);
				}));
			}

			// ---- 周期样本 ----
			var statsCard = null;
			if (stats && stats.cycles > 0) {
				var maxLen = 0;
				stats.lengths.forEach(function (v) { if (v > maxLen) maxLen = v; });
				statsCard = h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "chart-line" }, t("secStats")),
					h("div", { className: "aqr-stats", style: { marginBottom: "10px" } },
						h(Stat, { icon: "calendar-stats", label: t("statAvgCycle"), value: stats.avg != null ? stats.avg : "—", unit: t("unitDay") }),
						stats.range ? h(Stat, { icon: "trending-up", label: t("statRange"), value: stats.range[0] + "-" + stats.range[1], unit: t("unitDay") }) : null,
						h(Stat, { icon: "list-details", label: t("statSamples"), value: stats.cycles, unit: t("statsCycles") }),
					),
					stats.lengths.length ? h("div", null, stats.lengths.map(function (len, idx) {
						return h(BarRow, {
							key: idx,
							label: "#" + (idx + 1),
							pct: maxLen ? Math.round((len / maxLen) * 100) : 0,
							value: len + t("unitDay"),
							color: PHASE_COLOR.luteal,
						});
					})) : null,
				);
			}

			return h("div", null,
				err ? h("p", { className: "aqr-err", role: "alert" }, err) : null,
				h("div", { className: "aqr-page-head" },
					h("span", { className: "aqr-page-title" }, h(Icon, { name: "flower", size: 18 }), h("span", null, t("pageCycle"))),
					h("span", { className: "aqr-sub" }, t("cycleIntro")),
				),
				h(PrivacyBanner, { t: t }),

				// 开关 + 配置
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "settings" }, t("secSettings")),
					h("label", { className: "aqr-switch-row" },
						h("input", { type: "checkbox", checked: form.enabled, onChange: function (e) { setF("enabled", e.target.checked); } }),
						h("span", null, t("cycleEnable")),
						enabled ? h(Badge, { tone: "green", icon: "circle-check" }, t("cycleEnabledTag")) : h(Badge, { tone: "muted", icon: "info-circle" }, "off")),
					!enabled ? h("p", { className: "aqr-empty aqr-empty-warn" }, h(Icon, { name: "info-circle", size: 13 }), h("span", null, t("cycleEnableHint"))) : null,
					h("div", { className: "aqr-form-grid", style: { marginTop: "10px" } },
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "calendar", size: 12 }), h("span", null, t("cycleLastStart"))),
							h("input", { className: "aqr-input", type: "date", value: form.lastStart, onChange: function (e) { setF("lastStart", e.target.value); }, "aria-label": t("cycleLastStart") })),
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "refresh", size: 12 }), h("span", null, t("cycleLengthLabel"))),
							h("input", { className: "aqr-input", type: "number", min: "21", max: "45", placeholder: "28", value: form.cycleLength, onChange: function (e) { setF("cycleLength", e.target.value); } })),
						h("label", { className: "aqr-field" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "droplet", size: 12 }), h("span", null, t("periodLengthLabel"))),
							h("input", { className: "aqr-input", type: "number", min: "2", max: "10", placeholder: "5", value: form.periodLength, onChange: function (e) { setF("periodLength", e.target.value); } })),
					),
					h("div", { className: "aqr-row", style: { marginTop: "10px" } },
						h("button", { className: "aqr-btn aqr-btn-primary", onClick: function () { save(); } }, h(Icon, { name: "check", size: 13 }), h("span", null, t("cycleSaveBtn"))),
						form.enabled ? h("button", { className: "aqr-btn", onClick: function () { save({ enabled: false }); } }, h(Icon, { name: "x", size: 13 }), h("span", null, t("cycleDisable"))) : null,
						h("span", { className: "aqr-msg" }, msgState[0])),
				),

				enabled ? statRow : null,
				enabled && today ? h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "calendar-heart" }, t("secToday")),
					phaseBar,
					h("div", { className: "aqr-flex", style: { marginTop: "14px" } },
						h(CycleRing, { info: today, size: 168 }),
						h("div", { className: "aqr-flex-col" },
							h("div", { className: "aqr-today-phase", style: { color: PHASE_COLOR[today.phase] } },
								h(Icon, { name: PHASE_ICON[today.phase] || "flower", size: 15 }),
								h("strong", null, phaseName(t, today.phase)),
								h("span", { className: "aqr-today-day" }, t("cycleDayLabel") + " " + today.cycleDay + t("unitDay"))),
							h("div", { className: "aqr-row", style: { marginTop: "8px" } },
								h(Badge, { tone: "muted", icon: "clock" }, t("dayInPhaseLabel") + " " + today.dayInPhase + t("unitDay")),
								h(Badge, { tone: "muted", icon: "calendar-heart" }, t("cycleNext") + " " + today.nextPeriodInDays + t("unitDay")),
								h(Badge, { tone: "muted", icon: "egg" }, (today.ovulationDate || "?").slice(5))),
							today.advice ? h("p", { className: "aqr-note" }, today.advice) : null,
						),
					),
				) : null,

				enabled && snap.cycle.config && snap.cycle.config.lastStart ? h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "calendar" }, t("secCalendar")),
					h(CycleCalendar, { config: snap.cycle.config, t: t }),
				) : null,

				enabled ? h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "clipboard-check" }, t("secCheckin")),
					h("div", { className: "aqr-checkin-top" },
						h("button", { className: "aqr-btn aqr-btn-primary", onClick: periodToday }, h(Icon, { name: "droplet", size: 13 }), h("span", null, t("periodToday"))),
						h("label", { className: "aqr-field aqr-checkin-flow" }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "droplet", size: 12 }), h("span", null, t("flowLabel"))),
							h("select", { className: "aqr-select", value: checkin.flow, onChange: function (e) { setCheck("flow", e.target.value); } },
								h("option", { value: "" }, "—"),
								FLOW_LABELS.map(function (f, idx) { return h("option", { key: idx, value: idx }, f); })))),
					h("div", { className: "aqr-form-label", style: { marginTop: "10px" } }, h(Icon, { name: "activity", size: 12 }), h("span", null, t("symptomsLabel"))),
					h("div", { className: "aqr-row", style: { marginTop: "6px" } },
						SYMPTOMS.map(function (s) {
							return h("button", {
								key: s, className: "aqr-btn aqr-tab", "data-on": checkin.symptoms.indexOf(s) >= 0,
								onClick: function () { toggleSymptom(s); },
							}, s);
						})),
					h("label", { className: "aqr-field", style: { marginTop: "10px" } }, h("span", { className: "aqr-form-label" }, h(Icon, { name: "notes", size: 12 }), h("span", null, t("phNotes"))),
						h("textarea", { className: "aqr-textarea", rows: 2, placeholder: t("phNotes"), value: checkin.notes, onChange: function (e) { setCheck("notes", e.target.value); } })),
					h("div", { className: "aqr-row", style: { marginTop: "10px" } },
						h("button", { className: "aqr-btn aqr-btn-primary", onClick: checkinSave }, h(Icon, { name: "check", size: 13 }), h("span", null, t("checkinSave"))),
						h("span", { className: "aqr-msg" }, msgState[0])),
				) : null,

				statsCard,

				enabled ? h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "message-chatbot" }, t("secAdvice")),
					h("p", { className: "aqr-note" }, t("cycleAdviceTitle")),
					["menstrual", "follicular", "ovulatory", "luteal"].map(function (key) {
						return h("div", { key: key, className: "aqr-advice", "data-on": today && today.phase === key },
							h("div", { className: "aqr-advice-head", style: { color: PHASE_COLOR[key] } },
								h(Icon, { name: PHASE_ICON[key], size: 13 }),
								h("span", null, phaseName(t, key))),
							h("textarea", { className: "aqr-textarea", rows: 2, value: advice[key], onChange: function (e) { setA(key, e.target.value); } }));
					}),
					h("p", { className: "aqr-note" }, t("medicalNote")),
				) : null,
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
			var recDays = [], predDays = [], ovuDays = [];
			for (var i = 0; i < startOffset; i++) cells.push(null);
			for (var dnum = 1; dnum <= daysInMonth; dnum++) {
				var date = new Date(year, month, dnum);
				var diff = Math.floor((date - start) / 86400000);
				var cycleDay = ((diff % cycleLen) + cycleLen) % cycleLen + 1;
				var isToday = date.getTime() === todayMid.getTime();
				var isPast = date.getTime() <= todayMid.getTime();
				var mark = null;
				if (cycleDay <= periodLen) {
					mark = { type: "period", predicted: !isPast };
					(mark.predicted ? predDays : recDays).push(dnum);
				} else if (Math.abs(cycleDay - ovuDay) <= 1) {
					mark = { type: "ovu" };
					ovuDays.push(dnum);
				}
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
						key: "p", d: sketchCirclePath(25, 25, 19.5, cell.seed, { points: 14, squash: 0.88 }),
						fill: "none", stroke: "#ef6b6b", strokeWidth: 2,
						strokeDasharray: cell.mark.predicted ? "4 3" : undefined, opacity: cell.mark.predicted ? 0.55 : 0.9,
					}));
				}
				if (cell.mark && cell.mark.type === "ovu") {
					var xs = sketchCrossPaths(25, 25, 17.5, cell.seed);
					overlays.push(h("path", { key: "x1", d: xs[0], fill: "none", stroke: "#8e7cc3", strokeWidth: 2, opacity: 0.85 }));
					overlays.push(h("path", { key: "x2", d: xs[1], fill: "none", stroke: "#8e7cc3", strokeWidth: 2, opacity: 0.85 }));
				}
				if (cell.isToday) {
					overlays.push(h("path", { key: "t", d: sketchCirclePath(25, 25, 22, "today" + cell.seed, { points: 14, squash: 0.92 }), fill: "none", stroke: "#2563eb", strokeWidth: 2.2 }));
				}
				return h("div", { key: "c" + idx, className: "aqr-cal-cell" + (cell.isToday ? " aqr-cal-today" : "") },
					h("div", { className: "aqr-cal-box" },
						h("svg", { width: 50, height: 50, viewBox: "0 0 50 50", className: "aqr-cal-svg" }, overlays),
						h("span", { className: "aqr-cal-num" }, cell.dnum),
					));
			});
			var prevM = new Date(year, month - 1, 1);
			var nextM = new Date(year, month + 1, 1);
			var isCur = year === today.getFullYear() && month === today.getMonth();
			function span(list) {
				if (!list.length) return null;
				var a = list[0], b = list[list.length - 1];
				return a === b ? String(a) : a + "–" + b;
			}
			function sideRow(icon, label, value, tone) {
				return h("div", { className: "aqr-cal-side-row" },
					h("span", { className: "aqr-cal-side-label" }, h(Icon, { name: icon, size: 12 }), h("span", null, label)),
					h("span", { className: "aqr-cal-side-val", style: tone ? { color: tone } : null }, value));
			}
			var side = h("div", { className: "aqr-cal-side" },
				sideRow("droplet", t("calRecLabel"), recDays.length ? span(recDays) + t("unitDayShort") : t("calNone"), "#ef6b6b"),
				sideRow("calendar-heart", t("calPredLabel"), predDays.length ? span(predDays) + t("unitDayShort") : t("calNone"), "#e0a04f"),
				sideRow("egg", t("calOvuLabel"), ovuDays.length ? span(ovuDays) + t("unitDayShort") : t("calNone"), "#8e7cc3"),
				sideRow("calendar-stats", t("calTodayLabel"), (today.getMonth() + 1) + "/" + today.getDate()),
			);
			return h("div", { className: "aqr-cal-wrap" },
				h("div", null,
					h("div", { className: "aqr-row", style: { justifyContent: "center", marginBottom: "8px" } },
						h("button", { className: "aqr-btn aqr-btn-sm", "aria-label": t("calPrev"), onClick: function () { setViewed({ year: prevM.getFullYear(), month: prevM.getMonth() }); } }, h(Icon, { name: "chevron-left", size: 14 })),
						h("span", { className: "aqr-cal-title" }, year + " · " + (month + 1)),
						h("button", { className: "aqr-btn aqr-btn-sm", "aria-label": t("calNext"), onClick: function () { setViewed({ year: nextM.getFullYear(), month: nextM.getMonth() }); } }, h(Icon, { name: "chevron-right", size: 14 })),
						isCur ? null : h("button", { className: "aqr-btn aqr-btn-sm", onClick: function () { setViewed(null); } }, h(Icon, { name: "refresh", size: 13 }), h("span", null, t("calBackToday"))),
					),
					h("div", { className: "aqr-cal-grid" }, head.concat(body)),
					h("div", { className: "aqr-legend" },
						h("span", null, h("span", { className: "aqr-lg-mark", style: { color: "#ef6b6b" } }, "○"), t("legendPeriodNow")),
						h("span", null, h("span", { className: "aqr-lg-mark aqr-lg-dash", style: { color: "#ef6b6b" } }, "○"), t("legendPeriodNext")),
						h("span", null, h("span", { className: "aqr-lg-mark", style: { color: "#8e7cc3" } }, "✕"), t("legendOvuWin")),
						h("span", null, h("span", { className: "aqr-lg-mark", style: { color: "#2563eb" } }, "○"), t("legendTodayMark")),
					),
				),
				side,
			);
		}

		/** 健康一览：评分环 + 睡眠柱状 + 情绪折线 + 运动点 */
		function HealthCharts(props) {
			var series = props.series, score = props.score, habits = props.habits, t = props.t;
			if (!series || !score) return null;
			var CH = 96;

			// 评分环
			var gSize = 132, gcx = gSize / 2, gcy = gSize / 2, gr = gSize / 2 - 12;
			var gaugeDeg = (score.overall / 100) * 360;
			var gaugeColor = score.overall >= 70 ? "#5fae6f" : score.overall >= 55 ? "#e0a04f" : "#ef6b6b";
			var gaugeCard = h("div", { key: "gauge", className: "aqr-chart aqr-ov-gauge" },
				h("div", { className: "aqr-gauge-wrap" },
					h("svg", { width: gSize, height: gSize, viewBox: "0 0 " + gSize + " " + gSize },
						h("circle", { cx: gcx, cy: gcy, r: (gr - 8 + gr) / 2, fill: "none", stroke: "var(--dsw-alias-border-l2)", strokeWidth: 8 }),
						gaugeDeg > 2 ? h("path", {
							d: ringArcPath(gcx, gcy, gr, gr - 8, 0, Math.min(359.5, gaugeDeg)),
							fill: gaugeColor, fillOpacity: 0.5, stroke: gaugeColor, strokeWidth: 1.4,
						}) : null,
						h("text", { x: gcx, y: gcy - 2, textAnchor: "middle", fontSize: 26, fontWeight: 700, fill: "currentColor" }, score.overall),
						h("text", { x: gcx, y: gcy + 18, textAnchor: "middle", fontSize: 11, fill: gaugeColor }, score.label),
					)),
				h("div", { className: "aqr-chart-title" }, t("chartGauge")),
			);

			// 睡眠柱状（7 天 + 目标虚线），柱宽随容器等比，标签走 HTML 轴，避免 SVG 拉伸变形
			var bw = 700, bh = CH, step = bw / series.length, barW = Math.max(8, step * 0.42);
			var target = Number(habits.sleepTarget) || 7.5;
			var maxSleep = Math.max(target * 1.15, 10);
			var bars = [];
			for (var i = 0; i < series.length; i++) {
				var d0 = series[i];
				var x = i * step + (step - barW) / 2;
				if (d0.sleepHours !== null) {
					var hgt = Math.max(2, (d0.sleepHours / maxSleep) * (bh - 10));
					var under = d0.sleepHours < target - 0.4;
					bars.push(h("path", { key: "b" + i, d: sketchRectPath(x, bh, barW, hgt, "bar" + d0.date), fill: under ? "#ef6b6b" : "#5fae6f", fillOpacity: 0.32, stroke: under ? "#ef6b6b" : "#5fae6f", strokeWidth: 1.3 }));
				}
			}
			var targetY = bh - (target / maxSleep) * (bh - 10);
			bars.push(h("line", { key: "target", x1: 0, y1: targetY, x2: bw, y2: targetY, stroke: "#e0a04f", strokeWidth: 1.2, strokeDasharray: "5 4" }));
			var sleepCard = h("div", { key: "sleep", className: "aqr-chart" },
				h("svg", { width: "100%", height: CH, viewBox: "0 0 " + bw + " " + CH, preserveAspectRatio: "none" }, bars),
				h("div", { className: "aqr-axis" }, series.map(function (d, ix) { return h("span", { key: "ax" + ix }, d.label); })),
				h("div", { className: "aqr-chart-title" }, t("chartSleep") + " · " + t("sumTarget") + " " + target + "h"),
			);

			// 情绪折线（1-5 归一）
			var mw = 700;
			var moodPts = [];
			for (var j = 0; j < series.length; j++) {
				var m = series[j].mood;
				if (m !== null) moodPts.push([j * step + step / 2, 10 + (1 - (m - 1) / 4) * (CH - 20)]);
			}
			var moodEls = [];
			if (moodPts.length >= 2) {
				moodEls.push(h("path", { key: "line", d: sketchLinePath(moodPts, "moodline", 1.5), fill: "none", stroke: "#b39ddb", strokeWidth: 1.8 }));
			}
			for (var k2 = 0; k2 < moodPts.length; k2++) {
				moodEls.push(h("path", { key: "md" + k2, d: sketchCirclePath(moodPts[k2][0], moodPts[k2][1], 3.4, "md" + k2, { points: 8, squash: 1 }), fill: "#b39ddb", fillOpacity: 0.5, stroke: "#8e7cc3", strokeWidth: 1 }));
			}
			var moodCard = h("div", { key: "mood", className: "aqr-chart" },
				moodPts.length ? h("div", null,
					h("svg", { width: "100%", height: CH, viewBox: "0 0 " + mw + " " + CH, preserveAspectRatio: "none" }, moodEls),
					h("div", { className: "aqr-axis" }, series.map(function (d, ix) { return h("span", { key: "ax" + ix }, d.label); }))) : h("div", { className: "aqr-empty" }, t("empty")),
				h("div", { className: "aqr-chart-title" }, t("chartMood")),
			);

			// 运动点（HTML 圆点，避免 SVG 拉伸成椭圆）
			var exerciseCard = h("div", { key: "exercise", className: "aqr-chart" },
				h("div", { className: "aqr-ex-row" }, series.map(function (d, ix) {
					return h("div", { key: "ex" + ix, className: "aqr-ex-item" },
						h("span", { className: "aqr-ex-dot" + (d.exercise ? " aqr-ex-on" : "") }),
						h("span", { className: "aqr-ex-label" }, d.label));
				})),
				h("div", { className: "aqr-chart-title" }, t("chartExercise")),
			);

			return h("div", null,
				h("div", { className: "aqr-ov-top" }, gaugeCard, sleepCard),
				h("div", { className: "aqr-ov-duo" }, moodCard, exerciseCard),
			);
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
			var META = {
				weight: { icon: "scale", label: t("tileWeight") },
				bp: { icon: "heart-rate-monitor", label: t("tileBp") },
				pulse: { icon: "heartbeat", label: t("tilePulse") },
			};
			var TONE = { green: t("statusGreen"), orange: t("statusOrange"), red: t("statusRed") };
			var BMI_TONE = { green: t("bmiNormal"), orange: null, red: t("bmiObese") };
			function bmiLabel(v) {
				if (v < 18.5) return t("bmiUnder");
				if (v < 24) return t("bmiNormal");
				if (v < 28) return t("bmiOver");
				return t("bmiObese");
			}
			return h("div", { className: "aqr-tiles" }, tiles.map(function (tile) {
				var meta = META[tile.key] || { icon: "activity", label: tile.key };
				var badges = [];
				if (tile.status) badges.push(h(Badge, { key: "st", tone: tile.status, icon: "circle-check" }, TONE[tile.status] || tile.status));
				if (tile.bmi !== null && tile.bmi !== undefined) {
					var bmiTone = tile.bmi < 18.5 ? "orange" : tile.bmi < 24 ? "green" : tile.bmi < 28 ? "orange" : "red";
					badges.push(h(Badge, { key: "bmi", tone: bmiTone, icon: "ruler-measure" }, t("bmiLabel") + " " + tile.bmi + " · " + bmiLabel(tile.bmi)));
				}
				if (tile.dir && tile.dir !== "→" && tile.delta) {
					badges.push(h(Badge, { key: "dir", tone: "muted", icon: tile.dir === "↑" ? "trending-up" : "trending-down" }, String(Math.abs(tile.delta))));
				}
				return h("div", { key: tile.key, className: "aqr-tile" },
					h("div", { className: "aqr-tile-head" }, h(Icon, { name: meta.icon, size: 14 }), h("span", null, meta.label)),
					tile.value !== null && tile.value !== undefined
						? h("div", { className: "aqr-tile-value" }, tile.value, h("span", { className: "aqr-tile-unit" }, " " + (tile.unit || "")))
						: h("div", { className: "aqr-tile-value aqr-tile-nodata" }, "—"),
					badges.length ? h("div", { className: "aqr-tile-badges" }, badges) : null,
					sparkline(tile.series || [], "spark" + tile.key, "#5b8fd6"),
				);
			}));
		}

		/** 手绘小锁（隐私条用，与面板手绘风一致） */
		function LockGlyph() {
			return h("svg", { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": "true" },
				h("path", { d: sketchRectPath(3.5, 13.5, 9, 6.5, "lockbody"), fill: "none", stroke: "currentColor", strokeWidth: 1.3 }),
				h("path", { d: sketchLinePath([[5.5, 7], [5.5, 4.5], [8, 3], [10.5, 4.5], [10.5, 7]], "lockarc", 0.8), fill: "none", stroke: "currentColor", strokeWidth: 1.3 }),
			);
		}

		/** 数据与隐私声明（折叠条，默认收起；健康/周期两页顶部各放一份） */
		function PrivacyBanner(props) {
			var t = props.t;
			return h("details", { className: "aqr-privacy" },
				h("summary", null,
					h(LockGlyph, null),
					h("span", { className: "aqr-privacy-title" }, t("privacyTitle")),
					h("span", { className: "aqr-privacy-one" }, t("privacyOne")),
				),
				h("p", null, t("privacyBody")),
			);
		}

		// ---------- 出行页（高德 MCP） ----------
		function TravelPage(props) {
			var remote = props.remote;
			var t = props.t;
			var snapState = React.useState(null);
			var snap = snapState[0], setSnap = snapState[1];
			var inputState = React.useState("");
			var input = inputState[0], setInput = inputState[1];
			var busyState = React.useState(false);
			var busy = busyState[0], setBusy = busyState[1];
			var resultState = React.useState(null);
			var result = resultState[0], setResult = resultState[1];
			var msgState = React.useState("");
			var msg = msgState[0], setMsg = msgState[1];
			var pqState = React.useState("");
			var pq = pqState[0], setPq = pqState[1];
			var pcityState = React.useState("");
			var pcity = pcityState[0], setPcity = pcityState[1];
			var pnameState = React.useState("");
			var pname = pnameState[0], setPname = pnameState[1];
			var foundState = React.useState(null);
			var found = foundState[0], setFound = foundState[1];
			var pmsgState = React.useState("");
			var pmsg = pmsgState[0], setPmsg = pmsgState[1];
			var pbusyState = React.useState(false);
			var pbusy = pbusyState[0], setPbusy = pbusyState[1];
			var mountedRef = React.useRef(true);

			React.useEffect(function () {
				mountedRef.current = true;
				remote.getTravel().then(function (r) {
					if (mountedRef.current) setSnap(unwrap(r));
				}).catch(function (e) {
					if (mountedRef.current) setMsg(String(e && e.message ? e.message : e));
				});
				return function () { mountedRef.current = false; };
			}, []);

			function flash(text) {
				setMsg(text);
				setTimeout(function () { if (mountedRef.current) setMsg(""); }, 2500);
			}
			function showError(e) {
				if (mountedRef.current) setMsg(String(e && e.message ? e.message : e));
			}
			function done() { if (mountedRef.current) setBusy(false); }

			function save() {
				if (!input.trim()) { flash(t("travelHint")); return; }
				setBusy(true);
				remote.saveTravel({ input: input }).then(function (r) {
					if (!mountedRef.current) return;
					setSnap(unwrap(r));
					setInput("");
					flash(t("travelSaved"));
					done();
				}).catch(function (e) { showError(e); done(); });
			}
			function turnOff() {
				setBusy(true);
				remote.saveTravel({ enabled: false }).then(function (r) {
					if (mountedRef.current) setSnap(unwrap(r));
					done();
				}).catch(function (e) { showError(e); done(); });
			}
			function probe() {
				setBusy(true);
				setResult(null);
				var patch = input.trim() ? { input: input.trim() } : {};
				remote.testTravel(patch).then(function (r) {
					if (mountedRef.current) setResult(unwrap(r));
					done();
				}).catch(function (e) { showError(e); done(); });
			}

			function pflash(text) {
				setPmsg(text);
				setTimeout(function () { if (mountedRef.current) setPmsg(""); }, 3000);
			}
			function pshowError(e) {
				if (mountedRef.current) setPmsg(String(e && e.message ? e.message : e));
			}
			function pdone() { if (mountedRef.current) setPbusy(false); }

			function locate() {
				var q = pq.trim();
				if (!q) { pflash(t("travelPlaceQuery")); return; }
				setPbusy(true);
				setFound(null);
				remote.locateTravel({ input: q, city: pcity.trim() }).then(function (r) {
					if (!mountedRef.current) return;
					var value = unwrap(r);
					setFound(value);
					if (!value.ok) pflash(value.error || t("travelLocateFail"));
					else if (!pname.trim()) setPname(q);
					pdone();
				}).catch(function (e) { pshowError(e); pdone(); });
			}
			function savePlace(loc, name) {
				setPbusy(true);
				remote.savePlace({ name: name, location: loc, city: pcity.trim() }).then(function (r) {
					if (!mountedRef.current) return;
					setSnap(unwrap(r));
					setFound(null);
					setPq("");
					setPname("");
					pflash(t("travelPlaceSaved"));
					pdone();
				}).catch(function (e) { pshowError(e); pdone(); });
			}
			function dropPlace(id) {
				setPbusy(true);
				remote.deletePlace({ id: id }).then(function (r) {
					if (mountedRef.current) setSnap(unwrap(r));
					pdone();
				}).catch(function (e) { pshowError(e); pdone(); });
			}

			var configured = Boolean(snap && snap.enabled);
			var tools = (result && result.tools) || [];
			var places = (snap && snap.places) || [];

			return h("div", null,
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "map-pin" }, t("pageTravel")),
					h("ul", { className: "aqr-li" },
						h("li", null, h(Dot, { ok: configured }), h("span", null, configured ? t("travelSet") : t("travelUnset"), snap && snap.url ? h("span", { className: "aqr-kv" }, "  " + snap.url) : null)),
						h("li", null, h(Icon, { name: "settings", size: 12 }), h("span", null, t("travelServer") + ": " + ((snap && snap.serverName) || "amap"))),
						h("li", null, h(Dot, { ok: Boolean(snap && snap.butlerEnabled) }), h("span", null, t("travelButler") + " — " + (snap && snap.butlerEnabled === false ? t("travelButlerOff") : t("travelButlerOn")))),
						snap && snap.file ? h("li", null, h("span", { className: "aqr-kv" }, t("travelFile") + ": " + snap.file)) : null,
					),
					h("p", { className: "aqr-note" }, t("travelHint")),
				),
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "lock" }, t("travelFill")),
					h("div", { className: "aqr-row" },
						h("input", { className: "aqr-input aqr-fill", placeholder: t("travelPh"), value: input, onChange: function (e) { setInput(e.target.value); } }),
					),
					h("div", { className: "aqr-row", style: { marginTop: "10px" } },
						h("button", { className: "aqr-btn aqr-btn-primary", disabled: busy, onClick: save }, t("travelSave")),
						h("button", { className: "aqr-btn", disabled: busy, onClick: probe }, busy ? t("travelTesting") : t("travelTest")),
						configured ? h("button", { className: "aqr-btn", disabled: busy, onClick: turnOff }, t("travelClear")) : null,
					),
					h("span", { className: "aqr-msg" }, msg),
				),
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "map-2" }, t("travelPlaces") + (places.length ? "（" + places.length + "）" : "")),
					h("p", { className: "aqr-note" }, t("travelPlacesHint")),
					places.length ? h("ul", { className: "aqr-li", style: { marginTop: "8px" } },
						places.map(function (p2, i) {
							return h("li", { key: p2.id || ("p" + i) },
								h(Icon, { name: "map-pin", size: 12 }),
								h("span", null, " " + p2.name + (p2.address ? "  " : ""), p2.address ? h("span", { className: "aqr-kv" }, p2.address) : null),
								h("span", { className: "aqr-kv" }, "  " + p2.location),
								h("button", { className: "aqr-btn", style: { marginLeft: "8px", padding: "1px 8px", fontSize: "11px" }, disabled: pbusy, onClick: function () { dropPlace(p2.id); } }, t("travelDelete")),
							);
						}),
					) : h("p", { className: "aqr-note", style: { marginTop: "8px" } }, t("travelPlaceNone")),
					h("div", { className: "aqr-row", style: { marginTop: "12px" } },
						h("input", { className: "aqr-input aqr-fill", placeholder: t("travelPlaceQuery"), value: pq, onChange: function (e) { setPq(e.target.value); } }),
						h("input", { className: "aqr-input", style: { width: "210px" }, placeholder: t("travelPlaceCity"), value: pcity, onChange: function (e) { setPcity(e.target.value); } }),
					),
					h("div", { className: "aqr-row", style: { marginTop: "8px" } },
						h("button", { className: "aqr-btn", disabled: pbusy, onClick: locate }, pbusy ? t("travelLocating") : t("travelLocate")),
					),
					found ? h("div", { style: { marginTop: "10px" } },
						found.ok
							? h("div", null,
								h("p", { className: "aqr-kv" }, t("travelLocateOk") + " · " + found.ms + " ms"),
								h("ul", { className: "aqr-li" },
									(found.matches || []).map(function (m2, i) {
										return h("li", { key: "m" + i },
											h("span", null, (m2.province || "") + (m2.city || "") + (m2.district || "") + (m2.level ? " · " + m2.level : "")),
											h("span", { className: "aqr-kv" }, "  " + m2.location),
											h("button", { className: "aqr-btn", style: { marginLeft: "8px", padding: "1px 8px", fontSize: "11px" }, disabled: pbusy, onClick: function () { setPname((pname || pq).trim()); savePlace(m2.location, (pname || pq).trim() || m2.location); } }, t("travelSavePlace")),
										);
									}),
								),
								h("div", { className: "aqr-row", style: { marginTop: "8px" } },
									h("input", { className: "aqr-input aqr-fill", placeholder: t("travelPlaceName"), value: pname, onChange: function (e) { setPname(e.target.value); } }),
								),
							)
							: h("p", { className: "aqr-err" }, found.error || t("travelLocateFail")),
					) : null,
					h("span", { className: "aqr-msg" }, pmsg),
				),
				result ? h("div", { className: "aqr-card" },
					h(CardTitle, { icon: result.ok ? "circle-check" : "alert-triangle" }, (result.ok ? t("travelOk") : t("travelFail")) + " · " + (result.ms || 0) + " ms"),
					h("ul", { className: "aqr-li" },
						(result.steps || []).map(function (s, i) { return h("li", { key: "s" + i }, h("span", { className: "aqr-kv" }, s)); }),
					),
					tools.length ? h("div", null,
						h("p", { className: "aqr-kv" }, t("travelTools") + "（" + tools.length + "）"),
						h("div", { className: "aqr-row", style: { flexWrap: "wrap", gap: "6px" } },
							tools.map(function (n, i) { return h("span", { key: "t" + i, className: "aqr-tag" }, n); }),
						),
					) : null,
					result.sample ? h("div", { style: { marginTop: "10px" } },
						h("p", { className: "aqr-kv" }, t("travelSample") + ": " + result.sample.tool + " " + (result.sample.argsText || "")),
						result.sample.error
							? h("p", { className: "aqr-err" }, result.sample.error)
							: h("p", { className: "aqr-note" }, result.sample.text || ""),
					) : null,
					result.error ? h("p", { className: "aqr-err" }, result.error) : null,
				) : h("div", { className: "aqr-card" }, h("p", { className: "aqr-note" }, t("travelNoTest"))),
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "info-circle" }, t("travelAbout")),
					h("p", { className: "aqr-note" }, t("travelMain")),
					h("p", { className: "aqr-note" }, t("travelPrivacy")),
				),
			);
		}

		// ---------- 瑞幸页（咖啡 MCP） ----------
		function LuckinPage(props) {
			var remote = props.remote;
			var t = props.t;
			var snapState = React.useState(null);
			var snap = snapState[0], setSnap = snapState[1];
			var inputState = React.useState("");
			var input = inputState[0], setInput = inputState[1];
			var busyState = React.useState(false);
			var busy = busyState[0], setBusy = busyState[1];
			var resultState = React.useState(null);
			var result = resultState[0], setResult = resultState[1];
			var msgState = React.useState("");
			var msg = msgState[0], setMsg = msgState[1];
			var mountedRef = React.useRef(true);

			React.useEffect(function () {
				mountedRef.current = true;
				remote.getLuckin().then(function (r) {
					if (mountedRef.current) setSnap(unwrap(r));
				}).catch(function (e) {
					if (mountedRef.current) setMsg(String(e && e.message ? e.message : e));
				});
				return function () { mountedRef.current = false; };
			}, []);

			function flash(text) {
				setMsg(text);
				setTimeout(function () { if (mountedRef.current) setMsg(""); }, 2500);
			}
			function showError(e) {
				if (mountedRef.current) setMsg(String(e && e.message ? e.message : e));
			}
			function done() { if (mountedRef.current) setBusy(false); }

			function save() {
				if (!input.trim()) { flash(t("luckinHint")); return; }
				setBusy(true);
				remote.saveLuckin({ input: input }).then(function (r) {
					if (!mountedRef.current) return;
					setSnap(unwrap(r));
					setInput("");
					flash(t("travelSaved"));
					done();
				}).catch(function (e) { showError(e); done(); });
			}
			function turnOff() {
				setBusy(true);
				remote.saveLuckin({ enabled: false }).then(function (r) {
					if (mountedRef.current) setSnap(unwrap(r));
					done();
				}).catch(function (e) { showError(e); done(); });
			}
			function probe() {
				setBusy(true);
				setResult(null);
				var patch = input.trim() ? { input: input.trim() } : {};
				remote.testLuckin(patch).then(function (r) {
					if (mountedRef.current) setResult(unwrap(r));
					done();
				}).catch(function (e) { showError(e); done(); });
			}

			var configured = Boolean(snap && snap.enabled);
			var tools = (result && result.tools) || [];
			var daysLeft = snap && typeof snap.daysLeft === "number" ? snap.daysLeft : null;
			var expiryOk = daysLeft === null ? null : daysLeft > 7;

			return h("div", null,
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "coffee" }, t("pageLuckin")),
					h("p", { className: "aqr-note" }, t("luckinBeta")),
					h("ul", { className: "aqr-li" },
						h("li", null, h(Dot, { ok: configured }), h("span", null, configured ? t("luckinSet") : t("luckinUnset"),
							snap && snap.tokenMasked ? h("span", { className: "aqr-kv" }, "  " + snap.tokenMasked) : null)),
						snap && snap.expiresAt
							? h("li", null, h(Dot, { ok: Boolean(expiryOk) }), h("span", null, t("luckinExpiry") + ": " + snap.expiresAt + "（剩 " + daysLeft + " 天）"))
							: null,
						h("li", null, h(Icon, { name: "settings", size: 12 }), h("span", null, t("travelServer") + ": " + ((snap && snap.serverName) || "my-coffee"))),
						h("li", null, h(Dot, { ok: Boolean(snap && snap.butlerEnabled) }), h("span", null, t("travelButler") + " — " + (snap && snap.butlerEnabled === false ? t("luckinButlerOff") : t("luckinButlerOn")))),
						snap && snap.file ? h("li", null, h("span", { className: "aqr-kv" }, t("travelFile") + ": " + snap.file)) : null,
					),
					h("p", { className: "aqr-note" }, t("luckinHint")),
					snap && snap.expiresAt ? h("p", { className: "aqr-note" }, t("luckinExpiryNote")) : null,
				),
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "lock" }, t("travelSave")),
					h("div", { className: "aqr-row" },
						h("input", { className: "aqr-input aqr-fill", placeholder: t("luckinPh"), value: input, onChange: function (e) { setInput(e.target.value); } }),
					),
					h("div", { className: "aqr-row", style: { marginTop: "10px" } },
						h("button", { className: "aqr-btn aqr-btn-primary", disabled: busy, onClick: save }, t("travelSave")),
						h("button", { className: "aqr-btn", disabled: busy, onClick: probe }, busy ? t("travelTesting") : t("travelTest")),
						configured ? h("button", { className: "aqr-btn", disabled: busy, onClick: turnOff }, t("travelClear")) : null,
					),
					h("span", { className: "aqr-msg" }, msg),
				),
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: result ? (result.ok ? "circle-check" : "alert-triangle") : "plug" },
						result ? ((result.ok ? t("travelOk") : t("travelFail")) + " · " + (result.ms || 0) + " ms") : t("travelTest")),
					result ? null : h("p", { className: "aqr-note" }, t("luckinNoTest")),
					result ? h("ul", { className: "aqr-li" },
						(result.steps || []).map(function (s, i) { return h("li", { key: "s" + i }, h("span", { className: "aqr-kv" }, s)); }),
					) : null,
					result && tools.length ? h("div", null,
						h("p", { className: "aqr-kv" }, t("luckinTools") + "（" + tools.length + "）"),
						h("div", { className: "aqr-row", style: { flexWrap: "wrap", gap: "6px" } },
							tools.map(function (n, i) { return h("span", { key: "t" + i, className: "aqr-tag" }, n); }),
						),
					) : null,
					result && result.error ? h("p", { className: "aqr-err" }, result.error) : null,
				),
				h("div", { className: "aqr-card" },
					h(CardTitle, { icon: "info-circle" }, t("travelSteps")),
					h("p", { className: "aqr-err" }, t("luckinNotice")),
					h("p", { className: "aqr-note" }, t("luckinMain")),
					h("p", { className: "aqr-note" }, t("luckinPrivacy")),
				),
			);
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
						h("div", { className: "aqr-scroll" },
							h("div", { className: "aqr-inner" },
								h("p", { className: "aqr-err" }, "Cura panel error: " + (this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error))),
								h("button", { className: "aqr-btn", onClick: function () { this.setState({ error: null }); }.bind(this) }, "Retry"))));
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
				h("div", { className: "aqr-scroll", key: "scroll" },
				h("div", { className: "aqr-inner" },
					h("h1", { className: "aqr-h1" }, t("title")),
					h("p", { className: "aqr-sub" }, t("sub")),
					h("div", { className: "aqr-pages" },
						h("button", { className: "aqr-page-tab", "data-on": page === "rules", onClick: function () { setPage("rules"); } }, t("pageRules")),
						h("button", { className: "aqr-page-tab", "data-on": page === "voice", onClick: function () { setPage("voice"); } }, t("pageVoice")),
						h("button", { className: "aqr-page-tab", "data-on": page === "health", onClick: function () { setPage("health"); } }, t("pageHealth")),
						h("button", { className: "aqr-page-tab", "data-on": page === "cycle", onClick: function () { setPage("cycle"); } }, t("pageCycle")),
						h("button", { className: "aqr-page-tab", "data-on": page === "travel", onClick: function () { setPage("travel"); } }, t("pageTravel")),
						h("button", { className: "aqr-page-tab", "data-on": page === "luckin", onClick: function () { setPage("luckin"); } }, t("pageLuckin")),
					),
					page === "rules" ? h(RulesPage, { remote: remote, t: t })
						: page === "voice" ? h(VoicePage, { remote: remote, t: t })
							: page === "health" ? h(HealthPage, { remote: remote, t: t })
								: page === "cycle" ? h(CyclePage, { remote: remote, t: t })
									: page === "travel" ? h(TravelPage, { remote: remote, t: t })
									: h(LuckinPage, { remote: remote, t: t }),
				),
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
