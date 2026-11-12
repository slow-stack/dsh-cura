// .github/scripts/release-body.mjs
//
// 推 v* 标签触发发版时，Release 页的标题与正文由这里拼，格式固定成四段：
//
//   {package.json 的 description}
//
//   ## 本次变更
//   - <提交标题>…            ← 没有手写说明时，从上一个 tag 列到当前 tag
//
//   ## 安装
//   ```powershell
//   cd <DSH profile 目录>
//   npm install <name>@<version>
//   ```
//
//   ## 链接
//   - npm / 提交对比
//
// 想给某一版写人话，加一个 release-notes/v<版本>.md 就够了：
//   第一行是 `# 标题` → 顶替默认标题 v<版本>，其余原样当「本次变更」；
//   第一行不是标题   → 整份文件都当「本次变更」。
// 没有这个文件就退回列提交。骨架别在 workflow 里手改，改这里，测试会跟着红。

import { pathToFileURL } from 'node:url';

// 这些提交标题对读 Release 的人没有信息量，列出来只是噪音。
const SKIP_SUBJECTS = [
  /^Merge (pull request|branch|remote-tracking|tag)\b/i,
  /^Revert "Merge/i,
  /^chore:\s*发版\s*v?\d/i,
];

export function pickCommits(subjects = []) {
  const out = [];
  for (const raw of subjects) {
    const subject = String(raw ?? '').trim();
    if (!subject) continue;
    if (SKIP_SUBJECTS.some((re) => re.test(subject))) continue;
    if (out.includes(subject)) continue;
    out.push(subject);
  }
  return out;
}

export function parseNotes(raw = '') {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return { title: '', body: '' };
  const lines = text.split('\n');
  const first = lines[0].trim();
  if (/^#\s+\S/.test(first)) {
    return { title: first.replace(/^#\s+/, '').trim(), body: lines.slice(1).join('\n').trim() };
  }
  return { title: '', body: text };
}

export function repoUrlFrom(pkg = {}) {
  const raw = typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url;
  const url = String(raw ?? '').trim();
  if (!url) return '';
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
}

export function buildReleaseBody(options = {}) {
  const name = String(options.name ?? '').trim();
  const version = String(options.version ?? '').trim();
  const tag = String(options.tag ?? '').trim() || (version ? 'v' + version : '');
  const description = String(options.description ?? '').trim();
  const repoUrl = String(options.repoUrl ?? '').trim().replace(/\/+$/, '');
  const previousTag = String(options.previousTag ?? '').trim();
  const notes = parseNotes(options.notes);
  const title = notes.title || tag || version;

  const changes = notes.body
    ? [notes.body]
    : pickCommits(options.commits).map((subject) => '- ' + subject);

  const lines = [];
  if (description) lines.push(description, '');
  lines.push('## 本次变更', '');
  if (changes.length) lines.push(...changes, '');
  else lines.push('- 这一版没有可列的提交（大概是重打了同一个 tag）。', '');
  lines.push('## 安装', '', '```powershell', 'cd <DSH profile 目录>', 'npm install ' + name + '@' + version, '```', '');
  lines.push('装完重启 DSH；profile 的 `package.json` 里要把 `' + name + '` 登记进 `dsh.profile.bundles`。', '');
  lines.push('## 链接', '');
  if (name && version) lines.push('- npm：https://www.npmjs.com/package/' + name + '/v/' + version);
  if (repoUrl && previousTag && tag) lines.push('- 提交对比：' + repoUrl + '/compare/' + previousTag + '...' + tag);
  else if (repoUrl && tag) lines.push('- 提交列表：' + repoUrl + '/commits/' + tag);

  return { title, body: lines.join('\n').trim() + '\n' };
}

function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function main(argv) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const args = parseArgs(argv);
  const pkgPath = typeof args.pkg === 'string' ? args.pkg : 'package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = (typeof args.version === 'string' && args.version) || String(pkg.version ?? '');
  const tag = (typeof args.tag === 'string' && args.tag) || 'v' + version;
  const commitsFile = typeof args['commits-file'] === 'string' ? args['commits-file'] : '';
  const commits = commitsFile && fs.existsSync(commitsFile)
    ? fs.readFileSync(commitsFile, 'utf8').split('\n')
    : [];
  const notesFile = typeof args['notes-file'] === 'string'
    ? args['notes-file']
    : path.join('release-notes', 'v' + version + '.md');
  const notes = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : '';

  const result = buildReleaseBody({
    name: pkg.name,
    version,
    tag,
    description: pkg.description,
    repoUrl: repoUrlFrom(pkg),
    previousTag: typeof args.previous === 'string' ? args.previous : '',
    commits,
    notes,
  });

  if (typeof args.out === 'string') fs.writeFileSync(args.out, result.body);
  else process.stdout.write(result.body);
  if (typeof args['title-out'] === 'string') fs.writeFileSync(args['title-out'], result.title + '\n');

  console.log('release body ' + result.body.length + ' 字节 / 标题「' + result.title + '」/ 列了 ' + pickCommits(commits).length + ' 条提交' + (notes ? '（用了手写说明）' : ''));
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invoked) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err?.message || String(err));
    process.exitCode = 1;
  });
}
