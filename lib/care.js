// dsh-cura — 生活关怀层（care）：健康注入 / 常用坐标 / 管家工具
//
// 为什么单独一层：这三件事与「在哪个会话里说话」无关——QQ 里该能用，DSH 主对话、
// 随手新开的会话里也该能用。以前它们跟着 QQ 会话 id 走（onebot-private-<QQ号>），
// 普通会话因此完全看不到，插件被用成了一个 QQ 专用件。
//
// 挂载语义：注册到插件根 ctx 的 systemPrompt = 全局所有会话可见；注册到 agent.ctx
// 的 systemPrompt = 只有那个会话。因此本层只负责「形状 + 安装」，由调用方决定挂在
// 哪个 ctx 上；它不读配置文件、不连 MCP、不认识任何会话 id。
//
// 同一条目若在会话 scope 里也被注册，@deepseek-ai/dsh-system-prompt 的 merge 会让
// scoped 覆盖 global（见 store.ts 的 merge），同一会话里不会出现两份同样的文字。

/** 管家提示：只在配置了 server 且有引导语时才出现。 */
export const CARE_BUTLER = { name: 'cura:butler', order: 93 };

/** 每轮重读的动态 context：健康汇总、常用坐标。 */
export const CARE_CONTEXTS = [
  { key: 'health', name: 'cura:health', order: 94 },
  { key: 'places', name: 'cura:places', order: 94 },
];

/** QQ 侧沿用的旧名字：只在退回 QQ 专用模式时出现，避免与全局条目同名打架。 */
export const LEGACY_NAMES = { butler: 'qq-bot:butler', health: 'qq-bot:health', places: 'qq-bot:places' };

/**
 * 决定关怀层挂哪儿（纯函数，便于单测）。
 * - 'global'：挂插件根 ctx，所有会话都用得上（默认）
 * - 'qq'：退回旧行为，只在 QQ 会话里挂
 * 关掉开关、或宿主没有 systemPrompt 服务时都退回 'qq'：宁可只服务 QQ，也不能把
 * 能力静默弄丢（缺服务不是"用户不想要"）。
 */
export function careMode(options = {}) {
  if (options.careGlobal === false) return 'qq';
  if (!options.hasSystemPrompt) return 'qq';
  return 'global';
}

function asText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

/** 渲染器在组装管线里被调用，抛错会带崩整轮 → 这里兜住，降级为空串。 */
export function safeRender(fn) {
  if (typeof fn !== 'function') return '';
  try {
    return asText(fn());
  } catch {
    return '';
  }
}

/**
 * 管家条目描述符。
 * @param butler 字符串（安装时定稿）或函数（每轮重读，配置改了下一轮就生效）
 * @returns 描述符或 null（字符串为空时不注册空 section）
 */
export function careSection(butler, name = CARE_BUTLER.name, order = CARE_BUTLER.order) {
  if (typeof butler === 'function') {
    return { kind: 'section', name, order, text: () => safeRender(butler) };
  }
  const text = asText(butler).trim();
  if (!text) return null;
  return { kind: 'section', name, order, text };
}

/**
 * 动态 context 描述符列表；没有对应渲染器的项跳过。
 * @param renderers {health?, places?} → 函数
 * @param names 自定义名字表（QQ 旧模式传 LEGACY_NAMES）
 */
export function careContexts(renderers = {}, names = null) {
  const out = [];
  for (const item of CARE_CONTEXTS) {
    const fn = renderers?.[item.key];
    if (typeof fn !== 'function') continue;
    out.push({
      kind: 'context',
      name: names?.[item.key] ?? item.name,
      order: item.order,
      text: () => safeRender(fn),
    });
  }
  return out;
}

/** 完整挂载计划（纯数据，可断言）：section 在前、contexts 在后。 */
export function carePlan(options = {}) {
  const names = options.names ?? null;
  const specs = [];
  const section = careSection(options.butler, names?.butler ?? CARE_BUTLER.name, CARE_BUTLER.order);
  if (section) specs.push(section);
  specs.push(...careContexts({ health: options.health, places: options.places }, names));
  return specs;
}

/**
 * 把关怀层装到某个 systemPrompt 上。
 * @param systemPrompt 宿主服务；scope 由调用方决定（根 ctx = 全局，agent.ctx = 单会话）
 * @param options.butler 文本或渲染函数；options.health/places 渲染函数；options.names 名字表；options.log 诊断
 * @returns {{installed: string[], disposers: Array<() => void>, failed: string[]}}
 */
export function installCareLayer(systemPrompt, options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const installed = [];
  const disposers = [];
  const failed = [];
  if (!systemPrompt || typeof systemPrompt !== 'object') return { installed, disposers, failed };
  for (const spec of carePlan(options)) {
    try {
      const disposer = spec.kind === 'section'
        ? systemPrompt.section({ name: spec.name, order: spec.order, text: spec.text })
        : systemPrompt.context({ name: spec.name, order: spec.order, text: spec.text });
      if (typeof disposer === 'function') disposers.push(disposer);
      installed.push(spec.name);
    } catch (error) {
      // 单条失败不影响其它条：一个条目重名不该让健康注入整块消失
      failed.push(spec.name);
      log('关怀层 %s 注册失败: %s', spec.name, error?.message || error);
    }
  }
  return { installed, disposers, failed };
}

/** 释放安装结果（幂等，单项失败不阻断其余项）。 */
export function disposeCare(result) {
  const list = Array.isArray(result?.disposers) ? result.disposers : [];
  for (const dispose of list) {
    try {
      if (typeof dispose === 'function') dispose();
    } catch { /* ignore */ }
  }
}
