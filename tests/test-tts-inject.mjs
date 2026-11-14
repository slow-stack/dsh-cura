// SAPI 离线兜底的命令注入回归：node tests/test-tts-inject.mjs
//
// 背景：dshopen 维护者在 issue #460 指出，engine.py 的 Windows 离线 TTS 兜底把
// 模型回复直接拼进 PowerShell 脚本（"-Command" 的脚本文本），属于命令注入。
// 模型回复是外部可控内容（QQ 里对方说的话会被喂进去），所以这不是风格问题。
//
// 这一套钉三件事：
//   1) 静态：engine.py 的脚本主体是常量，文本只走 stdin，输出路径只走环境变量
//   2) 动态（仅 Windows + 有 powershell 时）：真跑一遍，注入文本不得执行、wav 要出来
//   3) 覆盖面：不只看一个函数 —— 全仓不得再有把变量拼进 -Command 的地方
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, '..');
// 仓库里 engine.py 是 CRLF（Windows 侧维护），正则一律按归一化后的 \n 写，
// 免得同一份代码在两个平台上有两种判定。
const src = fs.readFileSync(path.join(root, 'engine', 'engine.py'), 'utf8').replace(/\r\n/g, '\n');

let passed = 0;
function check(ok, msg) {
  assert.ok(ok, msg);
  passed += 1;
}

// ---------- 1. 静态：脚本主体必须是常量，且不含外部拼接 ----------
const m = /_SAPI_PS = r"""\n([\s\S]*?)\n"""/.exec(src);
check(Boolean(m), '找不到 _SAPI_PS 常量：脚本主体必须提出来当常量，不能在函数里现拼');
const psBody = m ? m[1] : '';

check(!/\$s\.Speak\(@'/.test(psBody), "脚本里不能再出现 here-string 拼文本——那正是注入点");
check(/\$s\.Speak\(\$text\)/.test(psBody), '要把变量 $text 交给 Speak，而不是把文本嵌进源码');
check(/OpenStandardInput\(\)/.test(psBody), '文本必须从标准输入读（StreamReader(OpenStandardInput)）');
check(/\$env:CURA_SAPI_OUT/.test(psBody), '输出路径必须从环境变量取，不能拼进脚本');
check(!/"""\s*\+|\+\s*"""/.test(psBody), '脚本常量体内不能有 + 拼接');
check(!/\{\{|\}\}/.test(psBody), '脚本常量体内不能有 format 占位符');

// ---------- 2. 静态：调用侧用 input= 传文本 ----------
const fn = /def _sapi_pcm\(self, text: str, target_sr: int\)(?:.|\n)*?\n\n\n/.exec(src);
check(Boolean(fn), '找不到 _sapi_pcm 函数体');
const body = fn ? fn[0] : '';

check(/input=text\.encode\(/.test(body), '调用 subprocess 时必须用 input= 把文本喂给 stdin');
check(/-Command",\s*_SAPI_PS\]/.test(body), '传给 -Command 的必须是常量 _SAPI_PS');
check(!/ps_script/.test(body), '函数里不该再有 ps_script 这种现拼的脚本变量');
check(!/\.replace\("'", "''"\)/.test(body), '不要再手工转义单引号 —— 需要转义就说明还是在拼脚本');
check(/proc\.returncode != 0/.test(body), '失败要显式检查 returncode，不能拿空 wav 硬读');

// ---------- 3. 静态：全文件不得再有「变量拼进 -Command」 ----------
{
  const cmdUses = [...src.matchAll(/"-Command",\s*([^\],\n]+)/g)].map((x) => x[1].trim());
  for (const arg of cmdUses) {
    check(!arg.includes('+'), '-Command 的实参不能是拼接表达式，实际：' + arg);
  }
  check(cmdUses.length === 1, 'engine.py 里 -Command 只该出现一处（SAPI 兜底），实际 ' + cmdUses.length + ' 处');
}

// ---------- 4. 动态：真跑一遍 PowerShell ----------
// CI 是 ubuntu-latest、不装 python 也不装 powershell，这一步在那里跑不了。
// 跑不了就明说跳过，不算通过 —— 静态断言已经覆盖了代码形态。
const isWin = process.platform === 'win32';
const hasPs = isWin && spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true }).status === 0;

if (!hasPs) {
  console.log('· 跳过动态注入验证：当前平台不是 Windows 或没有 powershell（静态断言已覆盖代码形态）');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-sapi-test-'));
  const marker = path.join(tmp, 'pwned');
  const BT = String.fromCharCode(96);   // 反引号

  // 每一个都想在旧实现里把 marker 造出来
  const cases = [
    { name: 'here-string 闭合', text: "hello\n'@\nNew-Item -ItemType File -Path '" + marker + "' -Force\n@'\nworld" },
    { name: '子表达式', text: '$(New-Item -ItemType File -Path "' + marker + '" -Force)' },
    { name: '分号串联', text: 'hi; New-Item -ItemType File -Path "' + marker + '" -Force' },
    { name: '反引号换行', text: 'hi ' + BT + 'n New-Item -ItemType File -Path "' + marker + '" -Force' },
    { name: '看似参数名', text: '-Text' },
    { name: '引号与管道', text: 'a" | Out-File "' + marker + '"; b' },
    { name: '中文与换行', text: '你好，\n我是 Amarre。\t收尾。' },
  ];

  for (const c of cases) {
    const outWav = path.join(tmp, 'out-' + Buffer.from(c.name).toString('hex') + '.wav');
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psBody], {
      input: c.text,
      env: { ...process.env, CURA_SAPI_OUT: outWav },
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
    });
    check(r.status === 0, '用例「' + c.name + '」应当正常合成，实际 rc=' + r.status + ' err=' + String(r.stderr).slice(0, 200));
    check(fs.existsSync(outWav) && fs.statSync(outWav).size > 1000,
      '用例「' + c.name + '」应当产出 wav，实际 ' + (fs.existsSync(outWav) ? fs.statSync(outWav).size + 'B' : '没有文件'));
    check(!fs.existsSync(marker), '用例「' + c.name + '」执行了注入内容 —— 这是个洞');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- 5. 动态：直接调生产函数 _sapi_pcm ----------
// 上面第 4 组把脚本文本自己拼起来跑，等于复刻了一遍调用逻辑；
// 真正要钉的是 engine.py 里那个函数本身。所以这里 import 它、按真实签名调。
// 缺 python 或不是 Windows 时明说跳过，不算通过。
const hasPy = isWin && spawnSync('python', ['-c', 'import sys'], { windowsHide: true }).status === 0;

if (!hasPs || !hasPy) {
  console.log('· 跳过 _sapi_pcm 直调验证：需要 Windows + powershell + python');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-sapi-real-'));
  const marker = path.join(tmp, 'pwned');
  const probe = path.join(tmp, 'probe.py');
  const cases = [
    { name: 'here-string 闭合', text: "hi\n'@\nNew-Item -ItemType File -Path '" + marker + "' -Force\n@'" },
    { name: '子表达式', text: '$(New-Item -ItemType File -Path "' + marker + '" -Force)' },
    { name: '分号串联', text: 'hi; New-Item -ItemType File -Path "' + marker + '" -Force' },
    { name: '看似参数名', text: '-Text' },
    { name: '中文与换行', text: '你好，\n我是 Amarre。' },
  ];

  fs.writeFileSync(probe, [
    'import sys, os, types, json',
    'stub = types.ModuleType("soundcard")',            // 本机没装 soundcard 也不影响兜底
    'stub.all_microphones = lambda *a, **k: []',
    'stub.default_speaker = lambda: None',
    'sys.modules["soundcard"] = stub',
    'sys.path.insert(0, ' + JSON.stringify(path.join(root, 'engine')) + ')',
    'import engine',
    // Windows 上 sys.stdin 默认是 GBK，中文会在这里被解码成代理对；
    // 直接读原始字节再按 UTF-8 解，绕开 locale。
    'cases = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
    'b = engine.Brain.__new__(engine.Brain)',          // 不跑构造：不碰配置和网络
    'out = []',
    'for c in cases:',
    '    if os.path.exists(c["marker"]): os.remove(c["marker"])',
    '    try:',
    '        audio = b._sapi_pcm(c["text"], 24000)',
    '        out.append({"name": c["name"], "samples": int(len(audio)), "err": None})',
    '    except Exception as e:',
    '        out.append({"name": c["name"], "samples": 0, "err": repr(e)[:300]})',
    'print(json.dumps(out, ensure_ascii=False))',
  ].join('\n'), 'utf8');

  const r = spawnSync('python', [probe], {
    input: JSON.stringify(cases.map((c) => ({ ...c, marker }))),
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  });
  check(r.status === 0, '_sapi_pcm 直调探针应当跑完，实际 rc=' + r.status + ' err=' + String(r.stderr).slice(0, 300));

  let results = [];
  try {
    results = JSON.parse(String(r.stdout).trim().split('\n').pop());
  } catch {
    results = [];
  }
  check(results.length === cases.length, '每个用例都该有结果，实际 ' + results.length + '/' + cases.length);

  for (const item of results) {
    check(item.err === null, '用例「' + item.name + '」_sapi_pcm 应正常合成，实际 ' + item.err);
    check(item.samples > 2000, '用例「' + item.name + '」应出足够长的音频，实际 ' + item.samples + ' samples');
  }
  check(!fs.existsSync(marker), '_sapi_pcm 执行了注入内容 —— 这是个洞');

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('all SAPI TTS injection tests passed ✓ (' + passed + ' assertions)');
process.exitCode = 0;
