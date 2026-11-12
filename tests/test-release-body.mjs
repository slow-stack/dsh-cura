// tests/test-release-body.mjs — Release 正文骨架（真驱动 .github/scripts/release-body.mjs）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../.github/scripts/release-body.mjs';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function eq(name, got, want) { ok(name + ' = ' + JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got)); }
function has(name, haystack, needle) { ok(name, String(haystack).includes(needle), '找不到 ' + JSON.stringify(needle) + '\n' + String(haystack).slice(0, 400)); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ---------- 1. 提交筛选 ----------
eq('合进主干的 merge 提交不列', R.pickCommits(['Merge pull request #3 from x/y']), []);
eq('Merge branch 也不列', R.pickCommits(['Merge branch \'main\' into feat']), []);
ok('chore: 发版 不列', R.pickCommits(['chore: 发版 0.9.0']).length === 0);
ok('英文 chore: release 保留（不猜）', R.pickCommits(['chore: release 1.0.0']).length === 1);
eq('空行/空白丢掉', R.pickCommits(['', '   ', '\t']), []);
eq('重复提交只留一条', R.pickCommits(['feat: a', 'feat: a', 'fix: b']), ['feat: a', 'fix: b']);
eq('保持原顺序', R.pickCommits(['fix: b', 'feat: a']), ['fix: b', 'feat: a']);
eq('非数组入参不炸', R.pickCommits(undefined), []);
eq('数字/null 混入也能过', R.pickCommits([null, undefined, 'feat: a']), ['feat: a']);

// ---------- 2. 手写说明解析 ----------
eq('空文件 → 无标题无正文', R.parseNotes(''), { title: '', body: '' });
eq('纯空白 → 无标题无正文', R.parseNotes('  \n\n '), { title: '', body: '' });
eq('首行 # 标题被摘出来', R.parseNotes('# v0.9.0 — 生活关怀层走到所有会话\n\n正文'), { title: 'v0.9.0 — 生活关怀层走到所有会话', body: '正文' });
eq('首行不是标题就整份当正文', R.parseNotes('## 子标题\n内容'), { title: '', body: '## 子标题\n内容' });
eq('CRLF 归一', R.parseNotes('# T\r\n\r\nA\r\nB'), { title: 'T', body: 'A\nB' });
eq('# 后面没字不算标题', R.parseNotes('#\n内容'), { title: '', body: '#\n内容' });

// ---------- 3. 仓库地址归一 ----------
eq('git+ 前缀与 .git 后缀去掉', R.repoUrlFrom({ repository: { url: 'git+https://github.com/slow-stack/dsh-cura.git' } }), 'https://github.com/slow-stack/dsh-cura');
eq('字符串形式也认', R.repoUrlFrom({ repository: 'https://github.com/a/b.git' }), 'https://github.com/a/b');
eq('尾部斜杠去掉', R.repoUrlFrom({ repository: { url: 'https://github.com/a/b/' } }), 'https://github.com/a/b');
eq('没有仓库地址返回空串', R.repoUrlFrom({}), '');
eq('空对象不炸', R.repoUrlFrom(), '');

// ---------- 4. 正文骨架 ----------
const base = {
  name: 'dsh-cura',
  version: '0.9.0',
  tag: 'v0.9.0',
  description: '生活关怀层 + QQ 伴生增强',
  repoUrl: 'https://github.com/slow-stack/dsh-cura',
  previousTag: 'v0.8.0',
  commits: ['Merge pull request #3 from x/y', 'feat: 把照看生活的能力解耦', 'chore: 发版 0.9.0', 'fix: 关掉变量插值'],
};
const out = R.buildReleaseBody(base);
eq('默认标题就是 tag', out.title, 'v0.9.0');

const body = out.body;
const order = ['## 本次变更', '## 安装', '## 链接'].map((s) => body.indexOf(s));
ok('三段都在', order.every((i) => i >= 0), JSON.stringify(order));
ok('三段顺序固定', order[0] < order[1] && order[1] < order[2], JSON.stringify(order));
has('描述在最前面', body.split('\n')[0], '生活关怀层 + QQ 伴生增强');
has('只列真正的提交', body, '- feat: 把照看生活的能力解耦');
has('也列 fix', body, '- fix: 关掉变量插值');
ok('merge 与发版提交没混进去', !body.includes('Merge pull request') && !body.includes('chore: 发版'));
has('安装给的是带版本号的包名', body, 'npm install dsh-cura@0.9.0');
has('安装块用 powershell 高亮', body, '```powershell');
has('提醒重启 DSH', body, '重启 DSH');
has('提醒登记 bundles', body, 'dsh.profile.bundles');
has('npm 版本页链接', body, 'https://www.npmjs.com/package/dsh-cura/v/0.9.0');
has('有上一个 tag 就给对比链接', body, 'https://github.com/slow-stack/dsh-cura/compare/v0.8.0...v0.9.0');
ok('正文结尾只有一个换行', body.endsWith('\n') && !body.endsWith('\n\n'), JSON.stringify(body.slice(-8)));
ok('没有残留占位符', !/undefined|null|\$\{/.test(body), body.slice(0, 300));

// ---------- 5. 边界 ----------
const noPrev = R.buildReleaseBody({ ...base, previousTag: '' });
has('没有上一个 tag 时退回提交列表链接', noPrev.body, '/commits/v0.9.0');
ok('没有上一个 tag 时不出现 compare', !noPrev.body.includes('/compare/'));

const noRepo = R.buildReleaseBody({ ...base, repoUrl: '' });
ok('没有仓库地址时链接段不硬塞', !noRepo.body.includes('/compare/') && !noRepo.body.includes('/commits/'));
has('但 npm 链接还在', noRepo.body, 'npmjs.com/package/dsh-cura');

const noCommits = R.buildReleaseBody({ ...base, commits: [] });
has('没有可列提交时说明一句', noCommits.body, '没有可列的提交');

const noDesc = R.buildReleaseBody({ ...base, description: '' });
ok('没有描述时正文不以空行开头', noDesc.body.startsWith('## 本次变更'), noDesc.body.slice(0, 40));

const withNotes = R.buildReleaseBody({ ...base, notes: '# v0.9.0 — 生活关怀层走到所有会话\n\n手写的正文\n\n- 一条' });
eq('手写说明的标题顶替默认标题', withNotes.title, 'v0.9.0 — 生活关怀层走到所有会话');
has('手写正文进「本次变更」', withNotes.body, '手写的正文');
ok('有手写说明就不再列提交', !withNotes.body.includes('- feat: 把照看生活的能力解耦'));

const notesNoTitle = R.buildReleaseBody({ ...base, notes: '- 手写一条' });
eq('没写标题就还是用 tag 当标题', notesNoTitle.title, 'v0.9.0');
has('没写标题时整份都是变更内容', notesNoTitle.body, '- 手写一条');
ok('没写标题时也不列提交', !notesNoTitle.body.includes('把照看生活的能力解耦'));

const noTag = R.buildReleaseBody({ ...base, tag: '' });
eq('没给 tag 就用 v+version', noTag.title, 'v0.9.0');

// ---------- 6. 真实跑一遍 CLI（workflow 里就是这么调的） ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cura-release-'));
const commitsFile = path.join(dir, 'commits.txt');
const bodyFile = path.join(dir, 'body.md');
const titleFile = path.join(dir, 'title.txt');
fs.writeFileSync(commitsFile, 'feat: 真跑一条\nMerge pull request #9 from x/y\n');
const { spawnSync } = await import('node:child_process');
const cli = spawnSync(process.execPath, [
  path.join(ROOT, '.github/scripts/release-body.mjs'),
  '--pkg', path.join(ROOT, 'package.json'),
  '--version', '9.9.9',
  '--tag', 'v9.9.9',
  '--previous', 'v9.9.8',
  '--commits-file', commitsFile,
  '--notes-file', path.join(dir, 'nope.md'),
  '--out', bodyFile,
  '--title-out', titleFile,
], { encoding: 'utf8' });
eq('CLI 退出码 0', cli.status, 0);
ok('CLI 把正文写进文件', fs.existsSync(bodyFile) && fs.readFileSync(bodyFile, 'utf8').includes('## 安装'));
has('CLI 用 package.json 的包名', fs.readFileSync(bodyFile, 'utf8'), 'npm install dsh-cura@9.9.9');
eq('CLI 写标题文件', fs.readFileSync(titleFile, 'utf8').trim(), 'v9.9.9');
ok('CLI 的正文里没有 merge 提交', !fs.readFileSync(bodyFile, 'utf8').includes('Merge pull request'));
ok('CLI 打印了一行摘要', /release body \d+ 字节/.test(cli.stdout || ''), cli.stdout);

// 说明文件存在时确实被读进去（workflow 默认路径就是 release-notes/v<version>.md）
const notesDir = path.join(dir, 'release-notes');
fs.mkdirSync(notesDir);
fs.writeFileSync(path.join(notesDir, 'v9.9.9.md'), '# 九点九版\n\n手写\n');
const cli2 = spawnSync(process.execPath, [
  path.join(ROOT, '.github/scripts/release-body.mjs'),
  '--pkg', path.join(ROOT, 'package.json'),
  '--version', '9.9.9',
  '--commits-file', commitsFile,
  '--out', path.join(dir, 'body2.md'),
  '--title-out', path.join(dir, 'title2.txt'),
], { encoding: 'utf8', cwd: dir });
eq('默认路径的说明文件被自动找到', fs.readFileSync(path.join(dir, 'title2.txt'), 'utf8').trim(), '九点九版');

// ---------- 7. 接线静态断言（workflow 真的这么用） ----------
const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
ok('release.yml 由 v* 标签触发', /tags:\s*\n\s*-\s*'v\*'/.test(yml), yml.slice(0, 200));
ok('release.yml 调了 release-body.mjs', /release-body\.mjs/.test(yml));
ok('release.yml 用 --notes-file 而不是 --generate-notes', /gh release create/.test(yml) && /--notes-file/.test(yml) && !/--generate-notes/.test(yml));
ok('release.yml 校 tag 与 package.json 版本一致', /tag="\$\{RELEASE_TAG#v\}"/.test(yml) && /if \[ "\$tag" != "\$ver" \]; then/.test(yml) && /does not match package.json version/.test(yml));
ok('release.yml 发版带 provenance', /npm publish[^\n]*--provenance/.test(yml));
ok('release.yml 用 NPM_TOKEN', /secrets\.NPM_TOKEN/.test(yml));
ok('release.yml 先测试后发版', /needs:\s*\[test\]/.test(yml));
ok('Release 等 publish 完成才建', /needs:\s*\[test, publish\]/.test(yml));
ok('重复打同一个 tag 不会重复建 Release', /gh release view/.test(yml) && /已存在/.test(yml));

console.log('\n' + (fail === 0 ? 'all release body tests passed ✓' : fail + ' 项失败'));
if (fail) process.exitCode = 1;
