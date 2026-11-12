// 插件装载面单测：node tests/test-plugin.mjs
// 覆盖两处只会在宿主里才炸掉的装载期约定：
//   1) ctx.tools 必须在 inject 里（否则 4 个 DSH 工具一个都注册不上）
//   2) DSH 数据根目录不能从 ctx.dshHome 取（宿主没有这个服务）
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as plugin from '../lib/index.js';

// 不用 import.meta.dirname（Node ≥20.11 才有），CI 的 20.x 早期小版本会报 undefined
const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, '..');

// ---------- 1. inject 必须含 tools ----------
assert.ok(Array.isArray(plugin.inject), 'inject 必须是数组');
assert.ok(plugin.inject.includes('agents'), 'inject 要保留 agents');
assert.ok(plugin.inject.includes('tools'), 'inject 必须含 tools：ctx.tools.register 需要它');

// ---------- 2. resolveDshHome 三级优先级 ----------
const home = os.homedir();
const saved = process.env.DSH_HOME;

// 显式配置最高：压过环境变量
process.env.DSH_HOME = 'D:\\env-home';
assert.strictEqual(plugin.resolveDshHome('D:\\explicit-home'), path.resolve('D:\\explicit-home'), '显式配置优先');
// 配置为空串/空白 → 退到 DSH_HOME
assert.strictEqual(plugin.resolveDshHome(''), path.resolve('D:\\env-home'), '空白配置不覆盖环境变量');
assert.strictEqual(plugin.resolveDshHome('   '), path.resolve('D:\\env-home'), '纯空格等同未配置');
assert.strictEqual(plugin.resolveDshHome(undefined), path.resolve('D:\\env-home'), '未配置走 DSH_HOME');
// DSH_HOME 也为空 → 落到 ~/.dsh
process.env.DSH_HOME = '';
assert.strictEqual(plugin.resolveDshHome(''), path.join(home, '.dsh'), '两级都空则回落 ~/.dsh');
process.env.DSH_HOME = '   ';
assert.strictEqual(plugin.resolveDshHome(''), path.join(home, '.dsh'), '空白 DSH_HOME 等同未设置');

if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved;

// ---------- 3. 源码静态约定（宿主里才炸得出来的那类错误，在 CI 里先红） ----------
const libDir = path.resolve(HERE, '..', 'lib');
const files = fs.readdirSync(libDir).filter((f) => f.endsWith('.js'));
assert.ok(files.length >= 9, 'lib 目录文件数异常');

// 注释里会提到 this.#config 这个历史事故本身，比对前先剥掉注释行
const stripComments = (src) => src
  .replace(/\r\n?/g, "\n")  // CRLF 归一：剥注释是逐行做，CR 会让 $ 到不了行尾（git core.autocrlf=true 的检出会加 CRLF）
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split('\n').map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

for (const f of files) {
  const src = stripComments(fs.readFileSync(path.join(libDir, f), 'utf8'));
  // 私有字段品牌检查在 cordis proxy 下必炸（rules-remote 的历史事故）
  const priv = src.match(/(?:^|[^.\w])this\.#[A-Za-z_]/);
  assert.strictEqual(priv, null, `${f} 里出现 this.# 私有字段：cordis proxy 下会 'Receiver must be an instance'`);
  // 宿主没有 dshHome 服务
  assert.ok(!/ctx\.dshHome\b/.test(src), `${f} 里出现 ctx.dshHome：宿主没有这个服务`);
  // 本插件的 logger 包装只暴露 info/warning/error，没有 warn
  assert.ok(!/\blogger\.warn\(/.test(src), `${f} 里调了 logger.warn：包装层没有这个方法（应为 logger.warning）`);
}

// ---------- 4. 面板必须自己出滚动条（宿主中心列 overflow:hidden，不替我们滚） ----------
// 事故：.aqr-root 原来写 min-height:100% + padding，内容再高也只是被裁掉，整页滚不动。
// 正确形态（dsh-study-desk 同款）：root 撑满让高度，内层 .aqr-scroll 自己 overflow-y:auto。
const clientSrc = fs.readFileSync(path.join(libDir, "client.js"), "utf8");
// CSS 是 CSS 数组里的一个个 JS 字符串字面量（形如 ".<sel>{...}",），按行取出花括号内的声明
const cssRule = (sel) => {
  const line = clientSrc.split(String.fromCharCode(10)).find((l) => l.includes(sel + '{'));
  assert.ok(line, 'client.js 里找不到 ' + ' + sel + ' + ' 的样式规则');
  const open = line.indexOf(sel) + sel.length;
  return line.slice(open + 1, line.indexOf('}', open));
};
const rootCss = cssRule(".aqr-root");
assert.ok(/display:flex/.test(rootCss), ".aqr-root 必须是 flex 容器");
assert.ok(/flex-direction:column/.test(rootCss), ".aqr-root 必须竖排");
assert.ok(/min-height:0/.test(rootCss), ".aqr-root 缺 min-height:0：flex 子项不肯缩，滚动条出不来");
assert.ok(!/min-height:100%/.test(rootCss), ".aqr-root 不能写 min-height:100%：那只是撑高，不会出滚动");
const scrollCss = cssRule(".aqr-scroll");
assert.ok(/overflow-y:auto/.test(scrollCss), ".aqr-scroll 必须 overflow-y:auto");
assert.ok(/flex:1/.test(scrollCss), ".aqr-scroll 必须 flex:1 吃满剩余高度");
assert.ok(/min-height:0/.test(scrollCss), ".aqr-scroll 缺 min-height:0：会被内容撑开而不是滚动");
// 面板真的把内容包进 .aqr-scroll（只有 CSS 没有节点 = 还是滚不动）
// 两处都要包：面板本体（key:'scroll'）与错误边界；只包错误边界等于正常页面还是滚不动
assert.ok(clientSrc.includes('className: "aqr-scroll", key: "scroll"'), 'CuraPanel 面板本体没有包进 .aqr-scroll');
assert.ok(clientSrc.split('className: "aqr-scroll"').length - 1 >= 2, '错误边界的错误提示也要能滚（应有 2 处 .aqr-scroll）');

// ---------- 5. butler 读核心连接表的入口签名没被改坏 ----------
const B = await import('../lib/butler.js');
assert.strictEqual(typeof B.usableServers, 'function');
assert.strictEqual(typeof B.coreServerNames, 'function');
const none = B.usableServers([{ serverName: 'x' }], '');
assert.deepStrictEqual(none.usable, [{ serverName: 'x' }], 'dshHome 为空时不该过滤任何 server');
const withEmpty = B.coreServerNames('');
assert.strictEqual(withEmpty.size, 0, 'dshHome 为空 → 核心表按空集处理');


// ---------- 6. 大脑代理必须把 (provider, model) 组合失败说出来，不能吃成空串 ----------
// 两条实测事实锁在这里：
//   a) 宿主的 llm.stream 不抛错：失败收尾给 {type:'finish', reason:{kind:'error', failure}}。
//      只累加 text-delta 的实现会把失败静默成 ''，通话那头就变成 TTS 合成空串（四层全炸）。
//   b) 只换 provider 不换 model 没用：trae 回 400 "does not serve this model"。
//      回退必须是 (provider, model) 组合，且组合来自 llm.listModels(provider)。
// scripts 的键是 "provider/model" 组合；provider 清单单独给，因为真 llm.listProviders()
// 返回的是路由名（xdpool / trae），不是组合。
const fakeLlm = (scripts, { catalogs = {}, providers = [] } = {}) => {
  const seen = [];
  return {
    seen,
    listProviders: () => providers,
    listModels: async (p) => (catalogs[p] ?? []).map((id) => ({ id, provider: p })),
    stream(options) {
      seen.push(options.provider + '/' + options.model);
      const key = options.provider + '/' + options.model;
      const script = scripts[key] ?? scripts[options.provider] ?? [];
      return (async function* () {
        for (const chunk of script) yield chunk;
      })();
    },
  };
};
const msgs = [{ role: 'user', content: '你好' }];
const boom = (code, message) => ({ type: 'finish', reason: { kind: 'error', failure: { message, code } } });
const ok = (text) => [{ type: 'text-delta', text }, { type: 'finish', reason: { kind: 'stop' } }];

// (a) 第一个组合报错、第二个有文本 → 拿到第二个的文本
const failFirst = fakeLlm(
  {
    'xdpool/m': [boom('RATE_LIMIT', 'every account is rate-limited')],
    'trae/m': ok('你好'),
  },
  { providers: ['xdpool', 'trae'] },
);
const okText = await plugin.chatViaDsh({ llm: failFirst }, { provider: 'xdpool', model: 'm' }, msgs);
assert.strictEqual(okText, '你好', '应回退到下一个组合并返回它的文本');
assert.deepStrictEqual(failFirst.seen, ['xdpool/m', 'trae/m'], '配置的 provider 必须排第一');

// (b) 全部失败 → 必须抛错，错误里带每个组合的失败原因（不再静默返回 ''）
const allFail = fakeLlm(
  {
    'xdpool/m': [boom('QUOTA_EXCEEDED', '余额不足')],
    'trae/m': [boom('INVALID_CREDENTIAL', '认证失败')],
  },
  { providers: ['xdpool', 'trae'] },
);
await assert.rejects(
  () => plugin.chatViaDsh({ llm: allFail }, { provider: 'xdpool', model: 'm' }, msgs),
  (e) => /所有 \(provider, model\) 组合都没能产出回复/.test(e.message)
    && /QUOTA_EXCEEDED/.test(e.message) && /INVALID_CREDENTIAL/.test(e.message),
  '全失败必须抛错并带上每个组合的失败码',
);

// (c) 没报错但也没文本（模型吐了空）→ 同样不能当成功
const silent = fakeLlm({ 'xdpool/m': [{ type: 'finish', reason: { kind: 'stop' } }] }, { providers: ['xdpool'] });
await assert.rejects(
  () => plugin.chatViaDsh({ llm: silent }, { provider: 'xdpool', model: 'm' }, msgs),
  (e) => /返回空文本/.test(e.message),
  '静默空回复必须被识别成失败',
);

// (d) 正常路径：第一个就成功，不该多试
const healthy = fakeLlm({ 'xdpool/m': ok('在的') }, { providers: ['xdpool'] });
assert.strictEqual(await plugin.chatViaDsh({ llm: healthy }, { provider: 'xdpool', model: 'm' }, msgs), '在的');
assert.deepStrictEqual(healthy.seen, ['xdpool/m'], '第一个就成功时不该多试别的组合');

// (e) 关键回归：同一个 provider 换了 model 也必须能救回来。
// 实测现场就是这种形状——xdpool 全线 429，而 trae 只认自己的 glm-5.3-flash。
// 若实现只按 provider 回退（旧写法），这里会一路撞到 trae/m 的 400 然后抛错。
const modelSwitch = fakeLlm(
  {
    'xdpool/m': [boom('RATE_LIMIT', 'soft_rate')],
    'trae/m': [boom('INVALID_REQUEST', 'Trae does not serve this model under the SOLO function')],
    'trae/glm-5.3-flash': ok('我在测试'),
  },
  { providers: ['xdpool', 'trae'], catalogs: { trae: ['glm-5.3-flash'] } },
);
const switched = await plugin.chatViaDsh({ llm: modelSwitch }, { provider: 'xdpool', model: 'm' }, msgs);
assert.strictEqual(switched, '我在测试', '同 provider 换 model 的组合同样要能回退成功');
assert.ok(modelSwitch.seen.includes('trae/glm-5.3-flash'), '必须试到 listModels 报出来的模型');
assert.strictEqual(modelSwitch.seen[0], 'xdpool/m', '配置的组合必须排第一');

// (f) 一家 provider 的模型清单不能把名额占满。
// 实测形状：xdpool 报出十几个模型且全线 429，trae 只有一个 glm-5.3-flash 能用。
// 按 provider 顺序铺开的写法会把前 8 个名额全给 xdpool，trae 那个能用的永远轮不到。
const flood = fakeLlm(
  Object.fromEntries([
    ...Array.from({ length: 15 }, (_, i) => ['xdpool/m' + i, [boom('RATE_LIMIT', 'soft_rate')]]),
    ['trae/glm-5.3-flash', ok('我在测试')],
  ]),
  {
    providers: ['xdpool', 'trae'],
    catalogs: { xdpool: Array.from({ length: 15 }, (_, i) => 'm' + i), trae: ['glm-5.3-flash'] },
  },
);
const flooded = await plugin.chatViaDsh({ llm: flood }, { provider: 'xdpool', model: 'm' }, msgs);
assert.strictEqual(flooded, '我在测试', 'xdpool 报十几个模型也不能把 trae 挤出去');
assert.ok(flood.seen.indexOf('trae/glm-5.3-flash') < 10, '能用的一家必须在前几个组合里被试到');

// (g) 关键回归：assistant 消息必须带 source，否则 app.asar 里
//     const source = message.source; if (source.replayState === void 0) ...
// 会抛 "Cannot read properties of undefined (reading 'replayState')"，
// 表现成「history 里只要有 assistant 轮次就全 provider 502」。
// 实测（curl 打 8765）确认过：单 user ✅、任何含 assistant 的形状 ❌。
{
  let captured = null;
  const recorder = {
    listProviders: () => ['xdpool'],
    listModels: async () => [],
    stream(options) {
      captured = options.messages;
      return (async function* () { yield { type: 'text-delta', text: '嗯' }; yield { type: 'finish', reason: { kind: 'stop' } }; })();
    },
  };
  const history = [
    { role: 'system', content: '你是 Amarre' },
    { role: 'user', content: '在吗' },
    { role: 'assistant', content: '在的' },
    { role: 'user', content: [{ type: 'text', text: '那你说说' }] },
    { role: 'user', content: '' },              // 空消息要被丢掉
    { role: 'assistant', content: [{ type: 'text', text: '' }] },
  ];
  await plugin.chatViaDsh({ llm: recorder }, { provider: 'xdpool', model: 'm' }, history);

  assert.ok(Array.isArray(captured), '必须真的把消息传给 llm.stream');
  assert.strictEqual(captured.length, 4, '两条空消息要被过滤掉（实际 4 条）');
  for (const m of captured) {
    assert.ok(m.source && typeof m.source === 'object', `每条消息都必须带 source（role=${m.role}）`);
    assert.ok(m.id, '每条消息都必须带 id');
    assert.ok(Array.isArray(m.content) && m.content.length > 0, 'content 必须是非空 block 数组');
  }
  const sys = captured[0];
  assert.strictEqual(sys.role, 'system');
  assert.strictEqual(sys.source.kind, 'system-prompt', 'system 消息的 source.kind 必须是 system-prompt');
  const asst = captured.find((m) => m.role === 'assistant');
  assert.strictEqual(asst.source.kind, 'model', 'assistant 消息的 source.kind 必须是 model');
  assert.strictEqual(asst.source.provider, 'xdpool');
  assert.strictEqual(asst.source.model, 'm');
  assert.strictEqual(asst.source.replayState, undefined, '不带 replayState，走 foreignAssistant 降级路径');
  assert.strictEqual(asst.content[0].text, '在的');
  const users = captured.filter((m) => m.role === 'user');
  assert.strictEqual(users.length, 2);
  assert.ok(users.every((m) => m.source.kind === 'user'), 'user 消息的 source.kind 必须是 user');
  assert.strictEqual(users[1].content[0].text, '那你说说', 'content 数组形状也要能拍成文本');
}

// (h) 卡死的 provider 不能把整通电话钉死。
// 实测现场：对方说完话 → 引擎 60 秒后自己超时 → 回一句「我这边卡了一下」。
// 根因是 llm.stream 的 for-await 会永远挂在 next() 上，abort signal 不一定被理会。
// 所以每个组合必须有独立时限，且到点必须放弃（哪怕底层还在赖着）。
{
  const hanging = {
    listProviders: () => ['stuck', 'good'],
    listModels: async () => [],
    stream(options) {
      if (options.provider === 'stuck') {
        // 永远不产出、也不理会 signal —— 模拟真实 provider 挂死
        return (async function* () { await new Promise(() => {}); })();
      }
      return (async function* () {
        yield { type: 'text-delta', text: '我在' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  const t0 = Date.now();
  const got = await plugin.chatViaDsh(
    { llm: hanging },
    { provider: 'stuck', model: 'm', comboTimeoutMs: 1000, replyTimeoutMs: 5000 },
    msgs,
  );
  const cost = Date.now() - t0;
  assert.strictEqual(got, '我在', '卡死的组合之后必须能回退成功');
  assert.ok(cost < 4000, `单个组合超时后必须立刻换下一个，实测 ${cost}ms`);
}

// (i) 上次成功的组合要排到最前面，别每次都从失败的那家重新等一轮。
// 实测现场是「前 4 个组合失败，第 5 个 trae/… 才成」，每轮白等十几秒。
{
  const seen = [];
  const flaky = {
    listProviders: () => ['a', 'b'],
    listModels: async () => [],
    stream(options) {
      const key = options.provider + '/' + options.model;
      seen.push(key);
      return (async function* () {
        if (key === 'b/m') {
          yield { type: 'text-delta', text: '好用' };
          yield { type: 'finish', reason: { kind: 'stop' } };
          return;
        }
        yield boom('RATE_LIMIT', 'no');
      })();
    },
  };
  await plugin.chatViaDsh({ llm: flaky }, { provider: 'a', model: 'm' }, msgs);
  assert.strictEqual(seen[0], 'a/m', '第一次调用仍按配置顺序');
  seen.length = 0;
  await plugin.chatViaDsh({ llm: flaky }, { provider: 'a', model: 'm' }, msgs);
  assert.strictEqual(seen[0], 'b/m', '第二次调用必须先用上次成功的组合');
}

// (j) 已知坏掉的组合要进冷却，别每轮都重新撞一遍。
// 实测现场：每一轮日志都写着「前 4 个组合失败」，同一批组合反复白等。
{
  const seen = [];
  const flaky = {
    listProviders: () => ['dead', 'ok'],
    listModels: async () => [],
    stream(options) {
      const key = options.provider + '/' + options.model;
      seen.push(key);
      return (async function* () {
        if (key === 'ok/m') {
          yield { type: 'text-delta', text: '嗯' };
          yield { type: 'finish', reason: { kind: 'stop' } };
          return;
        }
        yield boom('AUTH', 'bad key');
      })();
    },
  };
  await plugin.chatViaDsh({ llm: flaky }, { provider: 'dead', model: 'm' }, msgs);
  assert.deepStrictEqual(seen, ['dead/m', 'ok/m'], '首轮按顺序试');
  seen.length = 0;
  await plugin.chatViaDsh({ llm: flaky }, { provider: 'dead', model: 'm' }, msgs);
  assert.strictEqual(seen[0], 'ok/m', '坏组合进冷却后必须排到最后');
}

// (k) 所有组合都卡住时，必须按总预算报错，不能把调用方一直吊着。
// 实测现场：8765 最小请求也 90 秒不返回，引擎那边只能干等到 60 秒超时。
{
  const allStuck = {
    listProviders: () => ['s1', 's2'],
    listModels: async () => [],
    stream() {
      return (async function* () { await new Promise(() => {}); })();
    },
  };
  const t0 = Date.now();
  let err = null;
  try {
    await plugin.chatViaDsh({ llm: allStuck }, { comboTimeoutMs: 1000, replyTimeoutMs: 4000 }, msgs);
  } catch (e) {
    err = e;
  }
  const cost = Date.now() - t0;
  assert.ok(err, '全挂时必须抛错，不能返回空串');
  assert.ok(cost < 12000, `全挂时必须在总预算附近收手，实测 ${cost}ms`);
}

// (l) 「上次能用的组合」要能跨进程重启活下来。
// 宿主一重启模块就重载，内存记录清空 → 重启后第一通电话又从头撞一遍失败组合，
// 那十几秒沉默正好落在最容易被听见的开场。
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-cache-'));
  const cfg = { sayScript: path.join(dir, 'say.ps1'), provider: 'slow', model: 'm' };
  const seen = [];
  const llm = {
    listProviders: () => ['slow', 'fast'],
    listModels: async () => [],
    stream(options) {
      const key = options.provider + '/' + options.model;
      seen.push(key);
      return (async function* () {
        if (key === 'fast/m') {
          yield { type: 'text-delta', text: '好' };
          yield { type: 'finish', reason: { kind: 'stop' } };
          return;
        }
        yield boom('RATE_LIMIT', 'no');
      })();
    },
  };
  await plugin.chatViaDsh({ llm }, cfg, msgs);
  assert.strictEqual(seen[seen.length - 1], 'fast/m', '首轮应回退到能用的组合');
  const cacheFile = path.join(dir, '.cura-cache', 'last-good-combo.json');
  assert.ok(fs.existsSync(cacheFile), '成功的组合必须落盘');
  const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.strictEqual(saved.provider, 'fast');
  // 用全新的模块实例模拟重启：内存里的 lastGoodCombo 已经没了
  const fresh = await import(pathToFileURL(path.join(root, 'lib/index.js')).href + '?restart=' + Date.now());
  seen.length = 0;
  await fresh.chatViaDsh({ llm }, cfg, msgs);
  assert.strictEqual(seen[0], 'fast/m', '重启后第一次调用必须直接用上次成功的组合');
  fs.rmSync(dir, { recursive: true, force: true });
}

// (m) 硬错要冷得久、软错要冷得短。
// 认证失败十分钟内不会自己好，一直去撞只是白等；
// 超时/限流一分钟就该放回来，冷太久等于把本来能用的组合也锁死了。
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-ttl-'));
  const cfg = { sayScript: path.join(dir, 'say.ps1'), model: 'm' };
  const seen = [];
  const llm = {
    listProviders: () => ['hard', 'soft'],
    listModels: async () => [],
    stream(options) {
      const key = options.provider + '/' + options.model;
      seen.push(key);
      return (async function* () {
        if (key.startsWith('hard')) yield boom('AUTH', 'bad key');
        else yield boom('TIMEOUT', 'slow');
      })();
    },
  };
  await plugin.chatViaDsh({ llm }, cfg, msgs).catch(() => {});
  const after = await (async () => {
    seen.length = 0;
    await plugin.chatViaDsh({ llm }, cfg, msgs).catch(() => {});
    return seen.slice();
  })();
  // 两个都还在冷却里，顺序可能变，但必须都还在尝试（不能被永久剔除）
  assert.strictEqual(after.length, 2, '冷却中的组合仍要尝试，只是排后面');
  fs.rmSync(dir, { recursive: true, force: true });
}

// (n) 「慢但活着」的组合不能被误杀。
// 实测现场：trae 会立刻吐字、但要十几秒才收尾；按「整段耗时」计时会把一个健康的
// 组合判死（日志：组合 trae/deepseek-v4.1-flash 失败: TIMEOUT 超过 8000ms），
// 于是整通电话明明有 provider 可用却全军覆没。吐过字就说明它活着，得继续等它。
{
  const llm = {
    listProviders: () => ['slow'],
    listModels: async () => [],
    stream() {
      return (async function* () {
        yield { type: 'text-delta', text: '我在' };
        // 每 3.5 秒滴一个字，总共 7 秒——远超 comboTimeoutMs，但每次都有新内容
        for (let i = 0; i < 5; i++) {
          await new Promise((r) => setTimeout(r, 3500));
          yield { type: 'text-delta', text: '，' };
        }
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  const t0 = Date.now();
  const got = await plugin.chatViaDsh(
    // comboTimeoutMs 会被地板抬到 3000；滴字间隔 3500ms 比它长，
    // 所以「按整段耗时计时」的实现会在第二个字之前就被判死 —— 这正是要锁住的行为。
    { llm },
    { provider: 'slow', model: 'm', comboTimeoutMs: 3000, idleTimeoutMs: 6000, replyTimeoutMs: 20000 },
    msgs,
  );
  const cost = Date.now() - t0;
  assert.strictEqual(got, '我在，，，，，', '一直在吐字的组合必须等到它说完');
  assert.ok(cost > 7000, `必须真的等到收尾（实测 ${cost}ms）`);
}

// (o) 吐了字之后卡死不动的，也要在 idle 时限内放弃，别把总预算耗光。
{
  const llm = {
    listProviders: () => ['stall', 'good'],
    listModels: async () => [],
    stream(options) {
      if (options.provider === 'stall') {
        return (async function* () {
          yield { type: 'text-delta', text: '我' };
          await new Promise(() => {}); // 吐了一个字之后永远不动
        })();
      }
      return (async function* () {
        yield { type: 'text-delta', text: '换我了' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  const t0 = Date.now();
  const got = await plugin.chatViaDsh(
    { llm },
    { provider: 'stall', model: 'm', comboTimeoutMs: 5000, idleTimeoutMs: 1000, replyTimeoutMs: 12000 },
    msgs,
  );
  const cost = Date.now() - t0;
  assert.strictEqual(got, '换我了', '卡住的组合必须让位给后面的');
  assert.ok(cost < 4000, `吐字后静默要按 idle 时限放弃（实测 ${cost}ms）`);
}

console.log('all plugin wiring tests passed ✓');
process.exitCode = 0;
