// 大脑代理的请求准入 —— 纯函数，便于单测。
//
// 为什么非要这一层：宿主的 webServer 在把请求交给插件注册的 exact 路由之前
// **不做**任何准入检查（插件的 exact 路由比 /api 前缀更早命中），所以每个
// 自注册路由必须自己向 connection 要判决。dsh-free-search（bridgeAuthRejection）
// 与 ds-harness-remote（handleControlRequest）都是这么做的。
//
// 本插件有两类调用方：
//   1. 浏览器 / API 客户端：带 DSH 会话 cookie 或 operator 凭据
//      → 交给 connection.requestRejection 判（Host/Origin 栅栏 + cookie 校验）
//   2. 本机 Python 语音引擎（httpx，没有 cookie）
//      → 用插件本进程现生成的 bearer token
// 第二类不能省，否则语音通话整条链路就断了；而 token 只活在内存里、
// 随插件重启作废，本机网页拿不到（跨站也发不出带 Authorization 的请求）。
//
// 服务缺失时一律 fail closed（503），绝不放行——那正是维护者指出的洞。

import { randomBytes, timingSafeEqual } from 'node:crypto';

export const BRAIN_PREFIX = '/cura/v1';
export const BRAIN_PATH = `${BRAIN_PREFIX}/chat/completions`;
/** 请求体上限：语音对话一轮几百字，1 MiB 已经宽到离谱；再大就是有人在灌。 */
export const MAX_BODY = 1024 * 1024;

/** 每次插件启动现生成，不落盘：重启即作废，泄露面只在进程内存里。 */
export function newToken() {
  return randomBytes(32).toString('hex');
}

function headerOf(request, name) {
  const headers = request?.headers;
  if (!headers || typeof headers !== 'object') return undefined;
  const raw = headers[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.join(', ');
  return undefined;
}

/** 取 Authorization: Bearer <token> 里的 token；没有就是 undefined。 */
export function bearerOf(request) {
  const raw = headerOf(request, 'authorization');
  if (typeof raw !== 'string') return undefined;
  const m = /^Bearer[ \t]+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : undefined;
}

/** 定长比较：长度不同直接 false，相同则 timingSafeEqual。 */
export function tokenMatches(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  if (!presented.length || !expected.length) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

/**
 * 请求准入判决。
 * @returns {{ok: true, via: 'token'|'connection'}} 放行
 *        | {{ok: false, status: number, message: string}} 拒绝（status 为回给调用方的 HTTP 码）
 */
export function authorize(request, options = {}) {
  const { connection, token } = options;

  // 跨站请求无条件拒绝：本机任意网页都能发起的攻击面先在这里掐掉。
  // （connection 的 isTrustedApiRequest 也查这一条，但服务缺失时它是空档。）
  if (headerOf(request, 'sec-fetch-site') === 'cross-site') {
    return { ok: false, status: 403, message: 'cross-site request rejected' };
  }

  // 本机引擎的凭据：只认插件本进程生成的 token。
  const presented = bearerOf(request);
  if (presented !== undefined && tokenMatches(presented, token)) {
    return { ok: true, via: 'token' };
  }

  // 浏览器 / API 客户端：交给宿主 connection 判（Host/Origin 栅栏 + cookie/operator）。
  const reject = connection?.requestRejection;
  if (typeof reject !== 'function') {
    return { ok: false, status: 503, message: 'connection service unavailable; brain proxy is closed' };
  }
  let rejection;
  try {
    rejection = reject.call(connection, request);
  } catch (error) {
    return { ok: false, status: 503, message: `connection admission failed: ${error?.message || error}` };
  }
  if (rejection === undefined || rejection === null) return { ok: true, via: 'connection' };
  const status = typeof rejection === 'number' && rejection >= 400 && rejection <= 599 ? rejection : 401;
  return { ok: false, status, message: status === 403 ? 'forbidden' : 'unauthorized' };
}

/** 统一写 JSON 响应（含 no-store，别让中间层缓存模型输出）。 */
export function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** 从 Host 头拼出本机引擎要访问的 base URL（用于给 Python 侧传 CURA_BRAIN_URL）。 */
export function brainBaseUrl(origin) {
  const base = String(origin ?? '').replace(/\/+$/, '');
  if (!base) return '';
  return `${base}${BRAIN_PREFIX}`;
}
/**
 * 把准入 + 读体 + 回包串成一个可测的 handler。
 *
 * 抽出来是为了能真起一个 http server 打一遍（而不是只对着纯函数断言）：
 * 维护者关心的是「本机网页能不能白嫖额度」，这件事只有在真的走一次 HTTP
 * 往返时才算证明过。
 *
 * @param deps.token       本机引擎用的 bearer token
 * @param deps.connectionOf () => connection 服务（可能为 undefined）
 * @param deps.chat        (messages) => Promise<string>，真正调模型
 * @param deps.historyLimit 最多带多少条历史
 * @param deps.logger      可选，{ info, warning, error }
 */
export function createHandler(deps = {}) {
  const { token, connectionOf, chat, historyLimit = 20 } = deps;
  const logger = deps.logger ?? { info() {}, warning() {}, error() {} };
  const maxBody = deps.maxBody ?? MAX_BODY;
  return async function brainHandler(req, res) {
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' });
        res.end();
        return;
      }
      let connection = null;
      try { connection = typeof connectionOf === 'function' ? connectionOf() ?? null : null; } catch { connection = null; }
      const verdict = authorize(req, { connection, token });
      if (!verdict.ok) {
        logger.warning('大脑代理拒绝请求（%d）: %s', verdict.status, verdict.message);
        writeJson(res, verdict.status, { error: { message: verdict.message } });
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > maxBody) {
          writeJson(res, 413, { error: { message: 'request body too large' } });
          return;
        }
      }
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch {
        writeJson(res, 400, { error: { message: 'body is not JSON' } });
        return;
      }
      const messages = (parsed?.messages ?? []).slice(-historyLimit * 4);
      const text = await chat(messages);
      logger.info('大脑回复 %d 字（%s）', text.length, verdict.via === 'token' ? '本机引擎' : 'DSH 客户端');
      writeJson(res, 200, {
        id: 'qq-bot',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      });
    } catch (error) {
      logger.error('大脑代理错误: %s', error?.stack || error);
      // chat 抛的错可以自带 status（例如 llm 服务还没就绪是 503 而不是 502）
      const raw = error?.status;
      const status = typeof raw === 'number' && raw >= 400 && raw <= 599 ? raw : 502;
      try { writeJson(res, status, { error: { message: String(error?.message || error) } }); } catch { /* ignore */ }
    }
  };
}
