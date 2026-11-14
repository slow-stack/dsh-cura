// say.ps1 调用侧的回归：node tests/test-say.mjs
//
// 背景：say.ps1 原先靠命令行 -Text <值> 收文本。PowerShell 在 -File 模式下会把
// 以 "-" 开头的值当成参数名，于是回复里只要出现 -Text / -Out / --text 这类字样，
// 脚本就报 "Missing an argument for parameter 'Text'" 并退出；
// 三个调用点都在 try/catch 里，异常被吞成「语音生成失败，回退文字」——静默失败。
// 待合成的是模型回复（QQ 里对方说的话会进来），内容不由我们决定。
//
// 这一套钉三件事：
//   1) 静态：文本只走 stdin，lib/ 里不再有把文本塞进 argv 的调用
//   2) 动态（仅 Windows + 有 powershell 时）：真跑一遍，逐字节比对回读的文本
//   3) 生产函数：直接 import lib/say.js 调 runSay，而不是自己复刻一遍调用逻辑
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(HERE, '..');

let passed = 0;
function check(ok, msg) {
  assert.ok(ok, msg);
  passed += 1;
}

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const P = (name) => path.join(root, 'lib', name);

// ---------- 1. 静态：lib/ 里没有人再把文本塞进 argv ----------
check(fs.existsSync(P('say.js')), 'lib/say.js 必须存在：调用侧要有一处统一封装');

const saySrc = read(P('say.js'));
check(/spawn\(\s*'powershell'/.test(saySrc) || /spawn\(\s*"powershell"/.test(saySrc), 'say.js 要用 spawn 起 powershell（execFile 的 input 选项在本仓库不生效）');
check(/'-File'/.test(saySrc), 'say.js 要走 -File 而不是 -Command');
check(!/'-Command'/.test(saySrc), 'say.js 不该出现 -Command：那需要把文本拼进脚本');
check(!/'-Text'/.test(saySrc), "say.js 的参数数组里不该再有 '-Text'：文本走后 argv 就又会踩参数名解析");
check(/stdio:\s*\[\s*'pipe'/.test(saySrc), 'say.js 要把 stdin 打开成 pipe');
check(/stdin\.end\(/.test(saySrc), 'say.js 必须往 stdin 写文本');
check(/stdin\.on\('error'/.test(saySrc), 'say.js 要给 stdin 挂 error 处理：脚本参数阶段早退时写入会 EPIPE');
check(/setTimeout\(/.test(saySrc), 'say.js 要有超时，否则 TTS 卡住会一直挂着');
check(/produced/.test(saySrc), 'say.js 要把脚本报告的实际产物路径带出来（兜底层可能回 .wav）');

// 三个调用点全部改走 runSay，且都不再自己拼 powershell 参数
for (const f of ['chat.js', 'index.js', 'rules-remote.js']) {
  const s = read(P(f));
  check(/runSay\(/.test(s), f + ' 应当通过 runSay 调 say.ps1');
  check(!/'-Text'/.test(s), f + " 不该再出现 '-Text' 参数：文本走 stdin");
  check(!/'-File'/.test(s), f + " 不该自己拼 powershell 参数（'-File' 应由 say.js 负责）");
}

// 全仓 lib/ 兜底扫一遍：任何 powershell 的 argv 都不得带 -Text
for (const f of fs.readdirSync(P('')).filter((x) => x.endsWith('.js'))) {
  const s = read(P(f));
  const calls = s.match(/powershell['"]\s*,\s*\[[^\]]*\]/g) || [];
  for (const m of calls) {
    check(!/'-Text'/.test(m), f + ' 里仍有把文本塞进 argv 的 powershell 调用：' + m.slice(0, 120));
  }
}

// ---------- 2. 静态：say.ps1 自己从 stdin 收文本、并把产物路径按 UTF-8 报出来 ----------
const ps1 = read(path.join(root, 'say.ps1'));
check(/ContainsKey\('Text'\)/.test(ps1), "say.ps1 要先判断有没有显式传 -Text，没有才读 stdin");
check(/OpenStandardInput\(\)/.test(ps1), 'say.ps1 要从标准输入读全文');
// 读 stdin 必须显式按 UTF-8 解码：默认走控制台代码页，中文会是「浣犲ソ」这类乱码。
check(/StreamReader\([\s\S]{0,120}?Encoding\]::UTF8/.test(ps1), 'say.ps1 读 stdin 时要显式指定 UTF-8，否则中文乱码');
check(!/\[Console\]::In\.ReadToEnd\(\)/.test(ps1), '[Console]::In 走控制台代码页，不能用来读 UTF-8 文本');
check(/IsNullOrWhiteSpace\(\$Text\)/.test(ps1), 'say.ps1 要对空文本早退：否则四层链会一路失败，最后产出静音');
check(/exit 2/.test(ps1), '空文本要用非 0 退出码明说，不能静默产出静音');
check(!/\[Parameter\(Mandatory\s*=\s*\$true\)\]\s*\[string\]\$Text/.test(ps1), 'say.ps1 的 $Text 不该再是 Mandatory：那样不传就报错，读不到 stdin');
// 产物路径经 stdout 回来；Windows PowerShell 默认按控制台代码页（中文机器是 GBK）输出，
// 调用方按 UTF-8 解就会把路径里的中文解成乱码 ——「文件在，却找不到」。
check(/\[Console\]::OutputEncoding\s*=\s*New-Object System\.Text\.UTF8Encoding/.test(ps1), 'say.ps1 必须把 stdout 设成 UTF-8：否则中文路径回读是乱码');

// ---------- 3. 动态：真跑一遍（仅 Windows + 有 powershell） ----------
const isWin = process.platform === 'win32';
const hasPs = isWin && spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true }).status === 0;

if (!hasPs) {
  console.log('· 跳过动态验证：当前平台不是 Windows 或没有 powershell（静态断言已覆盖代码形态）');
} else {
  const { runSay } = await import(new URL('../lib/say.js', import.meta.url).href);
  // 目录名故意带中文：产物路径的中文回读正是上面那条编码断言的现实场景
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-say-测试-'));

  // 用 stub 而不是真 say.ps1：真脚本要联网走五档 TTS，跑一次几十秒且不稳定。
  // stub 只做一件事——把它真正收到的 $Text 原样落到文件，用来逐字节比对。
  const stub = path.join(tmp, 'stub.ps1');
  fs.writeFileSync(stub, [
    'param([string]$Text, [string]$Out = "")',
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    "if (-not $PSBoundParameters.ContainsKey('Text')) {",
    '  $sr = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)',
    '  $Text = $sr.ReadToEnd()',
    '}',
    'if ([string]::IsNullOrWhiteSpace($Out)) { exit 9 }',
    '[IO.File]::WriteAllText($Out + ".txt", $Text, (New-Object System.Text.UTF8Encoding($false)))',
    'Write-Output ($Out + ".txt")',
    'exit 0',
  ].join('\n'), 'utf8');

  const BT = String.fromCharCode(96);
  const cases = [
    { name: '普通中文', text: '你好，我是 Amarre。' },
    { name: '看似参数名', text: '-Text' },
    { name: '看似另一个参数名', text: '--out' },
    { name: '以 - 开头的整句', text: '-NoProfile -File 这种东西' },
    { name: '多行', text: '第一行\n第二行\n第三行' },
    { name: '引号与反斜杠', text: 'a"b\'c\\d\\\\e' },
    { name: '美元与子表达式', text: '$(New-Item x) 和 $env:TEMP' },
    { name: '反引号与制表', text: 'x ' + BT + 'n y\tz' },
    { name: 'emoji 与全角标点', text: '🌙「晚安」，桉桉——' },
    { name: '长文本 3000 字', text: '啊'.repeat(3000) },
  ];

  for (const c of cases) {
    const out = path.join(tmp, 'o-' + Buffer.from(c.name).toString('hex') + '.bin');
    let said = null;
    try {
      said = await runSay({ sayScript: stub, text: c.text, out, timeoutMs: 60000 });
    } catch (e) {
      check(false, '用例「' + c.name + '」不该失败，实际 ' + (e && e.message));
      continue;
    }
    check(Boolean(said.produced), '用例「' + c.name + '」应当带回产物路径，实际 ' + JSON.stringify(said.produced));
    const back = fs.existsSync(said.produced) ? fs.readFileSync(said.produced, 'utf8') : null;
    check(back === c.text, '用例「' + c.name + '」回读的文本必须一致，实际 ' + JSON.stringify((back || '').slice(0, 40)) + ' ≠ ' + JSON.stringify(c.text.slice(0, 40)));
  }

  // 空文本：真 say.ps1 必须明着失败，不能一路降级最后产出 0.5 秒静音
  {
    let rejected = null;
    try {
      await runSay({ sayScript: path.join(root, 'say.ps1'), text: '   ', out: path.join(tmp, 'blank.mp3'), timeoutMs: 60000 });
    } catch (e) {
      rejected = e;
    }
    check(Boolean(rejected), '真 say.ps1 收到空文本必须拒绝（否则会产出静音）');
    check(/退出码 2/.test(String(rejected && rejected.message)), '空文本的拒绝理由要说明是退出码 2，实际 ' + String(rejected && rejected.message).slice(0, 120));
  }

  // 脚本自身失败时，runSay 要把退出码和 stderr 带出来，不能静默 resolve
  {
    const bad = path.join(tmp, 'bad.ps1');
    fs.writeFileSync(bad, 'param([string]$Out = "")\n[Console]::Error.Write("故意失败")\nexit 7\n', 'utf8');
    let rejected = null;
    try {
      await runSay({ sayScript: bad, text: 'x', out: path.join(tmp, 'bad.mp3'), timeoutMs: 60000 });
    } catch (e) {
      rejected = e;
    }
    check(Boolean(rejected), '脚本非 0 退出时 runSay 必须 reject');
    check(/退出码 7/.test(String(rejected && rejected.message)), '报错里要有退出码 7，实际 ' + String(rejected && rejected.message).slice(0, 120));
    check(/故意失败/.test(String(rejected && rejected.message)), '报错里要带出脚本 stderr 原文');
  }

  // 兼容：老调用方仍显式传 -Text 时，普通文本照样能用
  {
    const r = spawnSync('powershell', ['-NoProfile', '-File', stub, '-Text', '老写法', '-Out', path.join(tmp, 'legacy')], {
      encoding: 'utf8', timeout: 60000, windowsHide: true,
    });
    check(r.status === 0, '显式 -Text 的普通文本仍应可用（向后兼容），实际 rc=' + r.status + ' ' + String(r.stderr).slice(0, 160));
    const p = path.join(tmp, 'legacy.txt');
    check(fs.existsSync(p) && fs.readFileSync(p, 'utf8') === '老写法', '向后兼容路径要真的把文本传进去');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}


// ---------- 4. 下游 CLI 也吃「文件」而不是「参数」 ----------
// say.ps1 把文本再交给 tts-volc.py / edge-tts。它们用 argparse / click 一类解析器，
// 同样会在「值以 - 开头」时把值当成选项名。所以这两处也必须改成读文件。
const ps1b = read(path.join(root, 'say.ps1'));
check(/tts-volc\.py'\)\s*--text-file\s+\$textFile/.test(ps1b), 'say.ps1 调 tts-volc.py 要用 --text-file，不要用 --text $Text');
check(!/tts-volc\.py'\)\s*--text\s+\$Text/.test(ps1b), 'say.ps1 里不该再有把 $Text 直接当参数传给 tts-volc.py');
check(/edge\.Source[^\n]*-f\s+\$textFile/.test(ps1b), 'say.ps1 调 edge-tts 要用 -f 读文件，不要用 --text $Text');
check(/WriteAllText\(\$textFile/.test(ps1b), 'say.ps1 要把文本按 UTF-8 落到临时文件');
check(/UTF8Encoding\(\$false\)/.test(ps1b), '落盘要用无 BOM 的 UTF-8：带 BOM 第一个字会被读成零宽字符');

// tts-volc.py 从来没有进过版本库（.gitignore 第 19 行把它挡掉了，它是本机的 Tier 0
// 复刻音脚本，不带凭据也没法跑）。所以这里只在文件存在时校验，换成 CI 或别的机器
// 时整段跳过——不能因为本机放了私有脚本就把别人的测试跑红。
const volcPath = path.join(root, 'tts-volc.py');
const hasVolc = fs.existsSync(volcPath);
if (!hasVolc) {
  console.log('· 跳过 tts-volc.py 校验：本机没有这个脚本（它不在版本库里）');
} else {
  const volcSrc = read(volcPath);
  check(/add_argument\("--text-file"\)/.test(volcSrc), 'tts-volc.py 要支持 --text-file');
  check(/add_argument\("--text"\)/.test(volcSrc) && !/add_argument\("--text",\s*required=True\)/.test(volcSrc),
    '--text 不该还是 required，否则 --text-file 那条路会被 argparse 拦下');
  check(/read_text\(encoding="utf-8-sig"\)/.test(volcSrc), '读文本文件要兼容 BOM（utf-8-sig）');
  check(/"text": text,/.test(volcSrc), '请求体里要用解码后的 text 变量，不能还用 args.text');
}

const hasPyAny = hasVolc && spawnSync('python', ['-c', 'import sys'], { windowsHide: true }).status === 0;
if (!hasPyAny) {
  console.log('· 跳过 tts-volc.py 参数入口验证：没有 python');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-volc-cli-'));
  const volc = path.join(root, 'tts-volc.py');

  // 不给文本 -> 自己 parser.error 退出（rc=2），说明它不会拿空文本去发请求
  {
    const r = spawnSync('python', [volc, '--out', path.join(tmp, 'a.mp3')], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    check(r.status === 2, '不给文本时 tts-volc.py 应当参数错误退出，实际 rc=' + r.status);
    // argparse 的 usage 行是 ASCII（--text / --text-file）。中文提示在 Windows 控制台
    // 按 cp936 输出，用 utf8 解会花屏，所以这里只钉「它把两个入口都告诉了使用者」。
    check(/--text-file/.test(String(r.stderr)) || /--text/.test(String(Buffer.from(r.stderr))), '不给文本时要明说该给哪个参数');

  }

  // 值以 - 开头：走 --text-file 正常读文件；走 --text 会被 argparse 拦下（这正是要绕开的坑）
  {
    const f = path.join(tmp, 't.txt');
    fs.writeFileSync(f, '-Text 这样的内容', 'utf8');
    const r = spawnSync('python', [volc, '--text-file', f, '--out', path.join(tmp, 'b.mp3')], { encoding: 'utf8', timeout: 90000, windowsHide: true });
    // 走到网络那步才算「参数解析通过」；不要求真合成成功（没凭据/没网都可能失败）
    check(r.status !== 2, '--text-file 不该被 argparse 判成参数错误，实际 rc=' + r.status + ' ' + String(r.stderr).slice(0, 120));
  }
  {
    const r = spawnSync('python', [volc, '--text', '-Text', '--out', path.join(tmp, 'c.mp3')], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    check(r.status === 2, '空格形态 "--text -Text" 确实会被 argparse 拦下（这条记录了我们为什么改走文件）');
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('all say.ps1 transport tests passed ✓ (' + passed + ' assertions)');
process.exitCode = 0;
