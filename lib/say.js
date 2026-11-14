// say.ps1 的唯一调用封装：待合成文本只走标准输入，从不进 argv。
//
// 为什么不让文本走命令行参数：PowerShell 会把以 '-' 开头的值当成参数名解析。
// 文本恰好等于 "-Text" / "-Out" / "--text" 时，脚本报
// "Missing an argument for parameter 'Text'"，语音静默失败；
// 而待合成的正是模型回复（QQ 里对方说的话会进来），内容不由我们决定。
// 走 stdin 之后，「值长什么样」与「脚本怎么解析」彻底分开。
import { spawn } from 'node:child_process';
import fs from 'node:fs';

/**
 * 调 say.ps1 合成一段语音。
 *
 * @param {object} o
 * @param {string} o.sayScript say.ps1 的绝对路径
 * @param {string} o.text      待合成文本（走 stdin，不进 argv）
 * @param {string} o.out       期望产物路径（实际产物以脚本 stdout 最后一行为准，兜底层可能回 .wav）
 * @param {number} [o.timeoutMs]
 * @returns {Promise<{stdout: string, produced: string}>} produced 为空串表示脚本没报错但没落成文件
 */
export function runSay({ sayScript, text, out, timeoutMs = 120000 } = {}) {
  if (!sayScript) return Promise.reject(new Error('没有配置 sayScript'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-File', sayScript, '-Out', out], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经没了 */ }
      finish(reject, new Error('say.ps1 超时（' + timeoutMs + 'ms）'));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      if (code !== 0) {
        finish(reject, new Error('say.ps1 退出码 ' + code + '：' + (stderr || stdout).trim().slice(0, 300)));
        return;
      }
      const lines = String(stdout).trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const last = lines.length ? lines[lines.length - 1] : '';
      finish(resolve, { stdout, produced: last && fs.existsSync(last) ? last : '' });
    });

    // 脚本在参数阶段就失败时，写 stdin 会得到 EPIPE —— 那属于正常收尾，不该冒成未捕获异常。
    child.stdin.on('error', () => { /* 交给 close 里的退出码判定 */ });
    child.stdin.end(String(text ?? ''), 'utf8');
  });
}
