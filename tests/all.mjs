// 一次跑完全部单测：node tests/all.mjs（CI 与本地共用同一个入口）
// 每套测试独立进程：它们各自改写 process.env / 全局缓存，串在一个进程里会互相污染。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 顺序有意义：纯逻辑的放前面，真起 127.0.0.1 假 MCP server 的放后面，
// 挂了的时候先坏哪一套一看就知道。
const SUITES = [
  ['rules', 'test-rules.mjs'],
  ['cycle', 'test-cycle.mjs'],
  ['plugin', 'test-plugin.mjs'],
  ['brain', 'test-brain.mjs'],
  ['care', 'test-care.mjs'],
  ['travel', 'test-travel.mjs'],
  ['luckin', 'test-luckin.mjs'],
  ['remote', 'test-remote.mjs'],
  ['release-body', 'test-release-body.mjs'],
  // 真起 PowerShell 的放最后：Windows 上跑得慢，CI（ubuntu）上会自我跳过动态段。
  ['tts-inject', 'test-tts-inject.mjs'],
  ['say', 'test-say.mjs'],
];

const only = process.argv.slice(2);
const picked = only.length ? SUITES.filter(([name]) => only.includes(name)) : SUITES;
if (!picked.length) {
  console.error('没有匹配的测试套件：' + only.join(', ') + '（可选：' + SUITES.map(([n]) => n).join(' / ') + '）');
  process.exit(1);
}

const failed = [];
const t0 = Date.now();

for (const [name, file] of picked) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(HERE, file)], {
    cwd: path.resolve(HERE, '..'),
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  const cost = Date.now() - started;
  const out = ((res.stdout || '') + (res.stderr || '')).trim();
  const ok = res.status === 0;
  console.log('\n========== ' + (ok ? 'PASS' : 'FAIL') + ' ' + name + ' (' + cost + 'ms) ==========');
  if (out) console.log(out);
  if (res.error) console.log('spawn error: ' + res.error.message);
  if (!ok) {
    failed.push({ name, status: res.status, signal: res.signal });
    if (res.signal) console.log('被信号终止：' + res.signal + '（可能是超时或 abort）');
  }
}

const total = Date.now() - t0;
console.log('\n==================================================');
if (!failed.length) {
  console.log(picked.length + ' 套测试全部通过 ✓  (' + total + 'ms)');
  process.exitCode = 0;
} else {
  console.log(failed.length + ' 套失败：' + failed.map((f) => f.name + '(exit ' + f.status + ')').join(', '));
  process.exitCode = 1;
}
