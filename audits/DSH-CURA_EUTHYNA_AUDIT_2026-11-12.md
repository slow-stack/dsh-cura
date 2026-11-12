# DSH-CURA · EUTHYNA 审查报告（2026-11-12）

**审查对象**：`D:/dsh-cura` 分支 `feat/care-layer-all-sessions`，base `d4522cb`（= main），head `18a6efb` + 本轮修复提交
**变更面**：18 files changed, +3571 −74（含 CI workflow、README、7 套测试）
**审查方式**：euthyna 阶段 A 粗筛 → 阶段 B 测量（`audit` 命令驱动）→ 阶段 C 六门禁裁定；全程 `git status --porcelain` 只有 `?? cov-tmp/`
**审查者**：lead（主控亲跑，未委派阶段 C）

---

## 0. 执行摘要

| 项 | 值 |
|---|---|
| 疑似发现 | 4 条（F1/F2/F3 由本次变更引入，F4 由 `audit` 报出） |
| TRUE POSITIVE（安全漏洞） | **0 条** |
| FALSE POSITIVE（按安全漏洞判据） | 4 条 |
| 其中**真实缺陷**（虽非安全漏洞） | **1 条**：F3，已修复并加回归测试 |
| 阶段 B 退出码 | `EXIT=10`（有 security 分类事实，见 §1） |
| 测试基线 | 七套全绿（24135 ms）；本轮修复后仍七套全绿 |

**一句话结论**：这次改动没有引入可利用的安全漏洞；但审查确实抓到一个会**让整轮对话挂掉**的健壮性缺陷（用户自己写的地名/备注里出现 `{{…}}` 就会把 pre-step 抛穿），已修复并用「真实宿主 + 生产函数」的对照实验证明修好了。按 euthyna 门禁 3 的判据，可用性问题不算安全漏洞，所以它记 FALSE POSITIVE——但**不是「不用修」的意思**。

---

## 1. 覆盖表

### 1.1 未评估（先列，缺数据≠干净）

| 项 | 为什么没评估 |
|---|---|
| 依赖面（dependency 门禁） | 仓库无 lockfile（`package-lock.json` / `Cargo.lock` / `go.mod` 均不存在），无法做依赖树比对 |
| 历史溯源完整性 | `history-origins` 的 `-S` 探针上限 40 已用尽；另有 2 行 <12 字符的删除未被追源 |
| 重引入检测 | `audit` 未启用 `--pickaxe`，reintroduction 维度未跑 |
| 真实 QQ 群聊路径 | 本机 `groupPolicy: disabled` 且会话存储里 `onebot-group` 命中 0，群聊分支**无法实测**，只做了源码推断（见 BUG #1 门禁 6） |
| 子代理会话内的实际渲染 | 子会话 id 是随机 UUID（无前缀可辨），没有实例化一个真实子代理去验证提示词内容 |

### 1.2 已评估

| 面 | 结论 |
|---|---|
| 提示词注入面（section/context 注册范围） | 已评估，见 BUG #1 |
| 宿主服务缺失路径 | 已评估，见 BUG #2 |
| 用户可控文本 → 宿主渲染 | 已评估，见 BUG #3（**真实缺陷**） |
| `audit` 报出的 security 分类删除 | 已评估，见 BUG #4 |
| 危险 sink 扫描（`git diff d4522cb..18a6efb -- lib/` 新增行） | 无 `eval` / `new Function` / `child_process` / 反斜杠路径拼接；只有 2 处 `fs.writeFileSync(tmp, ...)` 原子写 |
| 凭据外泄 | key/token 只落 `travel.json` / `luckin.json`，RPC 返回值只给 masked 串与末四位；推送前扫过新增行，无 32 位 hex、无本机绝对路径 |

---

## 2. 粗筛方法与候选

```
cd /d/dsh-cura
node /d/euthyna/bin/euthyna.js audit --base d4522cb --repo /d/dsh-cura
# EXIT=10
```

audit 给出 3 条可确证事实：

1. 删除了 **71 行**来自 `dfba8e5bde`（提交信息含 "QQ companion enhancement"，被分类为 security）的代码，分布 4 个文件 → 候选 F4
2. 删除了 2 行来自 `d2e37b6757`（面板空白修复）→ 并入 F4 一并核对
3. 删除了 1 行来自 `653316eb00`（语音工具注册修复）→ 并入 F4

主控另行按「本次改动的语义面」补充候选：

- F1：把健康/坐标/管家从单会话挂到根 ctx（全局）——范围扩大是否越界
- F2：`ctx.get('systemPrompt')` 取不到时退回 QQ 模式——是否静默降级
- F3：`renderPlacesHint` / `renderHealth` 的文本来自用户可编辑文件，未做 `{{…}}` 转义

---

## 3. 裁定

### BUG #1 FALSE POSITIVE — 关怀层全局挂载把健康/坐标暴露给所有会话（含 QQ 与子代理）

**断言重述（C.0）**：把 `cura:health` / `cura:places` / `cura:butler` 注册在插件根 ctx 上，会让这些文本进入**每一个** agent 的提示词，包括 QQ 群聊会话与子代理；健康数据与常驻坐标属私密信息，越出「QQ 私聊」范围即构成越权披露。
**声称根因**：`installCareLayer` 用无 scope tag 的根 ctx 注册 → 落 global 层。
**威胁模型**：攻击者需要先在这个 DSH 实例里拿到另一个会话的提示词输出权；而这个实例只有单一本机用户。

**数据流**
```
travel.json / health.json（本机文件，用户自己写）
  → renderPlacesHint() / renderHealth()
  → CARE.installCareLayer(systemPromptService)         ← 根 ctx
  → PromptLayer(global).contexts
  → assemble(scope=任意 agent) → merge(global ∪ scope链) → 进入该会话提示词
```
机制取证（三条独立证据）：
- `@deepseek-ai/dsh-scope/lib/index.js:190-215` `effect()`：`const scope = scopeOf(ctx); scope === undefined → layer = this.global`
- `@deepseek-ai/dsh-scope/lib/index.js:179-183` `merge()`：`const merged = new Map(pick(this.global).entries()); for (const layer of chainLayers(scope)) merged.set(...)` → 全局条目对所有 scope 可见，除非同 scope 链有同名覆盖（care 用 `cura:*` 前缀，无覆盖）
- 实测探针 `D:/DSH/asarx-extract/dsh/.probe/care-scope-probe.mjs`：三个 scope（无 scope / agentA / agentB）**都带** `cura:butler` 与 `cura:health`，只有 agentA 额外带 `channel:dsh-onebot`

**可利用性**：不成立。文本流向的是**同一个用户自己的** agent。要说「泄露」，得先指明一个能读到别人提示词的主体——本实例里没有这样的主体。

**影响**：不是信息泄露。它是**可见范围的设计选择**：作者本人要的就是「主对话也照顾我」。真正的风险版本是「QQ 群聊里所有人共享的 agent 也带着你的健康周期」——但那需要同时满足两个前提，见门禁 6。

**恶魔代言人**
- 反 6「攻击者真的控制这个输入吗」→ 不，数据源是本机用户自己的文件。
- 反 11「影响真实还是运维层面」→ 真实但落在「隐私可见范围」而非「未授权访问」。
- 支持 12「是否因为不太可能就否掉了真实缺陷」→ 没有：群聊路径我单独查了，见门禁 6。
- 支持 13「是否编造了缓解措施」→ 已重读 `cordis.patch.yml:2433-2464` 确认 `groupPolicy: disabled` 是配置里真实存在的行，不是推测。

| 门禁 | 结论 | 依据 |
|---|---|---|
| 1 流程 | PASS | 三阶段均有书面证据（本报告 §2/§3） |
| 2 可达性 | PASS | 全局注册确实进所有会话，探针实测复现 |
| 3 真实影响 | **FAIL** | 未越过信任边界：文本进入的是同一用户自己的会话；不构成 RCE / 提权 / 未授权信息泄露 |
| 4 PoC 验证 | PASS | 探针展示了「根 ctx 注册 → 任意 scope 可见」，路径成立 |
| 5 数学边界 | PASS | 无算术边界可言 |
| 6 环境 | **FAIL** | 本机 `groupPolicy: disabled`（`cordis.patch.yml:2452`），且会话存储中 `onebot-group` 命中 0 —— 群聊分支被环境完全阻断 |

门禁 3 与门禁 6 FAIL，按写死规则判 FALSE POSITIVE。**但保留一条观察**：若将来把 `groupPolicy` 改成 `allowlist`，群聊会话会共享同一份健康/坐标文本，届时需要按群聊场景重新评估——这一条记在 §5 限制里，不算本次裁定。

---

### BUG #2 FALSE POSITIVE — `ctx.get('systemPrompt')` 失败时静默退回 QQ 模式

**断言重述**：宿主没有 systemPrompt 服务时，`careMode()` 退回 `'qq'`，用户以为什么都没配错，实际上关怀层只挂在 QQ 会话上，主对话一无所获——属静默降级。
**实测**：`D:/DSH/asarx-extract/dsh/.probe/care-get-probe.mjs` —— 裸 `new Context()` 上 `root.get('systemPrompt')` 返回 `undefined`，**不抛**。
**代码路径**：`lib/care.js:33-37` `if (!options.hasSystemPrompt) return 'qq';`；`lib/index.js` 该分支**不是静默**：`logger.warning('宿主没有 systemPrompt 服务，生活关怀层退回 QQ 会话挂载')`。

| 门禁 | 结论 | 依据 |
|---|---|---|
| 1 流程 | PASS | 探针 + 源码行号齐备 |
| 2 可达性 | PASS | 该分支可达（无 systemPrompt 的宿主） |
| 3 真实影响 | **FAIL** | 是功能降级且**有 warning 日志**，不涉及 RCE / 提权 / 信息泄露 |
| 4 PoC 验证 | PASS | 探针展示了返回值与不抛的行为 |
| 5 数学边界 | PASS | 不适用 |
| 6 环境 | PASS | 无环境防护，但也无需防护 |

门禁 3 FAIL → FALSE POSITIVE。「有日志的降级」正是该项目一贯要求的做法（讨厌的是**点了没反应**，而有明确 warning 属可观测降级），因此不判缺陷。

---

### BUG #3 FALSE POSITIVE — 用户可编辑文本里的 `{{…}}` 会打崩整轮 pre-step（**真实缺陷**）

**断言重述**：`renderPlacesHint()` 把 `travel.json` 里的地名原样拼进 `cura:places`，`renderHealth()` 把备注拼进 `cura:health`；这两条 context 注册时没有 `interpolate: false`。只要文本里出现完整的 `{{name}}`，宿主 `renderContextSections` 就抛 `unknown prompt variable`，而它在 `agent/pre-step` 的默认回调里，**抛错直接冒泡，整轮对话失败**。
**声称根因**：`lib/care.js:113-115` 注册时未传 `interpolate`；`lib/travel.js:146-158` 与 `lib/health.js:190/390` 对花括号零限制。
**威胁模型**：输入来源是本机用户自己（面板输入 / 编辑 JSON 文件）。没有第三方攻击者。

**数据流**
```
面板输入地名 "我家 {{home}}"（normalizePlace 只校验坐标格式，lib/travel.js:59-67）
  → placesPrompt() 原样拼接（lib/travel.js:146-158）
  → installCareLayer → systemPrompt.context({name:'cura:places', text: fn})   ← 无 interpolate:false
  → assemble → renderContextSections(assembly)  →  interpolate() 抛 Error
  → dsh-agent-loop/lib/index.js:691 的 waterfall 默认回调内抛出
  → 外层 try/catch 只做 toolSet.dispose() 后 throw   →  整轮 pre-step 失败
```

**PoC（生产函数、零 mock）**
```
cd /d/DSH/asarx-extract/dsh
node .probe/cura-f3-poc.mjs
```
真实输出：
```
1. normalizePlace 接受该地名: "我家 {{home}}"
2. placesPrompt 产出含 {{: true
3. careContexts 条目: cura:places/context
4. renderContextSections 抛错: unknown prompt variable "{{home}}" in context "cura:places"; registered variables: (none)
```

**Negative PoC**（同一路径、良性输入正常）：地名写成「我家」时 `placesPrompt` 照常产出、渲染不抛——差异只在那两个花括号，前置条件被隔离出来。

**影响**：可用性。一次坏输入会让**每一轮**都挂（因为 context 每轮重渲染，坏数据留在 `travel.json` 里就一直挂），直到手动改文件。用户视角就是「对话突然一直报错」。没有 RCE、没有提权、没有把数据发给第三方。

| 门禁 | 结论 | 依据 |
|---|---|---|
| 1 流程 | PASS | 三阶段证据齐（源码行号 + 双 PoC + 修复对照） |
| 2 可达性 | PASS | 面板「存为常用」→ `savePlace`（`lib/rules-remote.js:463-471`）是正常 UI 路径，无需改文件 |
| 3 真实影响 | **FAIL** | 只造成可用性中断（DoS 自身），按 C.3 判据属「仅运维健壮性」，不构成 RCE / 提权 / 信息泄露 |
| 4 PoC 验证 | PASS | 展示了输入控制、触发点与真实抛错文本；修复后同一输入不再抛 |
| 5 数学边界 | PASS | 无算术边界；条件等价于「文本含完整 `{{[a-z][a-z0-9_]*}}`」 |
| 6 环境 | PASS | 无任何环境防护阻拦该路径 |

门禁 3 FAIL → 按写死规则判 **FALSE POSITIVE（作为安全漏洞）**。这不是「不算 bug」：它是一条**真实缺陷**，只因 euthyna 门禁 3 把判据限定在 RCE/提权/信息泄露，可用性缺陷不进 TP。**已修复，见 §4。**

---

### BUG #4 FALSE POSITIVE — `audit` 报「删除了 security 分类提交的 71 行代码」

**断言重述**：本次改动删掉了来自 `dfba8e5bde`（被 `audit` 标为 security 类）的 71 行，可能移除了某处安全防护。
**核对方法**：`git diff d4522cb..18a6efb -- lib/index.js` 逐条读删除行 + `git blame d4522cb -- lib/index.js`。

**核对结果**：删除行**全部**是搬迁式重写的左侧——头注释改写、`const { servers } = B.parseServers(...)` 移入 `mountButler()`、`dropButlerFibers()` 与 `const fibers = butlerFibers / butlerFibers = []` 合并成 `disposeFibers(fibers)`、`qq-bot:butler` section 注册块与 `qq-bot:health` context 注册块各包进 `if (careMode === 'qq')`、`scope.plugin(mcpPlugin, ...)` 循环移入 `mountButler()`。**没有一处能力被移除**，等价性由七套测试与 43 项 luckin 断言背书。

`audit` 之所以标 security，唯一依据是提交信息里含 "QQ companion enhancement" 字样（**模式匹配，不是语义分类**）——这正是 C.4 第 9 条「不要把模式识别当成漏洞分析」。

| 门禁 | 结论 | 依据 |
|---|---|---|
| 1 流程 | PASS | diff + blame 双证据 |
| 2 可达性 | PASS | 删除行确实存在于 diff |
| 3 真实影响 | **FAIL** | 搬迁等价，无能力丢失，无安全影响 |
| 4 PoC 验证 | PASS | 逐行对照 + 测试全绿即为等价性证据 |
| 5 数学边界 | PASS | 不适用 |
| 6 环境 | PASS | 无 |

门禁 3 FAIL → FALSE POSITIVE。

---

## 4. 修复与验证（针对 BUG #3）

### 4.1 修复

- `lib/care.js:111-120`：三条关怀条目注册时统一带上 `interpolate: false`
- `lib/index.js`：QQ 侧五处提示词注册（`qq-bot:reply-style` / `qq-bot:butler` / `qq-bot:expression-habits` / `qq-bot:health` / `qq-bot:places`）同样带 `interpolate: false`
  理由：回复规则正文与语料来自**可编辑文件**、健康备注与地名同理，宿主对 section 与 context 一视同仁地插值，两边都得挡

### 4.2 修复验证（真实宿主 + 生产函数，零 mock）

```
cd /d/DSH/asarx-extract/dsh
node .probe/cura-f3-verify.mjs        # 修复后
node .probe/cura-f3-negative.mjs      # 修复前（用 git show 18a6efb:lib/care.js 落成旧版）
```
真实输出：
```
[verify]    OK renderPrompt 未抛; 含 {{butler}}: true
            OK renderContextSections 未抛; 条数: 2
               - cura:health | 含{{ : true
               - cura:places | 含{{ : true
            OK renderContextSnapshot 未抛; 含 {{home}}: true | 含 {{note}}: true
[negative]  OK 修复前抛错: unknown prompt variable "{{home}}" in context "cura:places"; registered variables: (none)
```
即：同一份含 `{{home}}` 的输入，修复后**原样保留**并正常渲染，修复前**抛错**。

### 4.3 回归测试

`D:/dsh-cura/tests/test-care.mjs` 新增两组断言：
1. 三条关怀条目 `interpolate === false`（数组整体断言，漏一条就红）
2. `index.js` 里 5 处 `.systemPrompt.section|context({...})` 全部含 `interpolate: false`（扫源码，按处数逐条校验）

**变异自证（两条，均 EXIT=1，还原后全绿）**：

| 变异 | 结果 |
|---|---|
| `sed -i 's/, interpolate: false//' lib/care.js` | `EXIT=1` · AssertionError: 每条关怀注入都必须显式 interpolate:false（防用户文本里的 {{}} 打崩 pre-step） |
| `sed -i '0,/, interpolate: false/s// /' lib/index.js` | `EXIT=1` · AssertionError: 第 1 处提示词注册缺 interpolate:false：name: 'qq-bot:reply-style', order: 96, text , |

**全套基线**：`node tests/all.mjs` → `7 套测试全部通过 ✓ (24135ms)`

---

## 5. 限制与残留风险

1. **群聊场景未实测**：`groupPolicy: disabled` 且无 `onebot-group` 会话。若将来开群，关怀层的健康/坐标文本会进入群聊共享的 agent 上下文，**需要按群聊场景重新评估**（不是本次裁定范围）。
2. **子代理会话未实测**：子会话 id 是随机 UUID，无法靠命名识别；理论上同样继承全局层。风险同上——同一用户自己的实例内。
3. **依赖面与历史溯源未完成**：见 §1.1，不得当作「干净」。
4. **`interpolate: false` 的语义代价**：这些文本从此不解析任何提示词变量。目前宿主未注册任何 prompt variable（`assemble` 里 variables 恒为 `{}`），因此无功能损失；将来若要在这些段落里用变量，需要显式改回。

---

## 6. 结论

- 本次改动**没有引入可利用的安全漏洞**（0 TRUE POSITIVE）。
- 但抓到 **1 条真实缺陷**（F3：`{{…}}` 打崩整轮 pre-step），成因是「用户可编辑文本直接进提示词插值」——已修复、已用真实宿主对照实验证明、已加两条回归断言并用变异自证。
- `audit` 的 security 分类是提交信息模式匹配的产物，不是语义判定（F4）。
- 未评估项按三态如实列出，不折算成干净。

---

## 7. 机器可校验裁定（euthyna gate 格式）

以下四段是 `euthyna gate` 的机械输入，与上文 §3 的人工裁定一一对应。

BUG #1 FALSE POSITIVE — 关怀层全局挂载把健康与常用坐标注入所有会话，越出「QQ 私聊」范围
证据：lib/care.js:105 (18a6efb)
复现：node /d/DSH/asarx-extract/dsh/.probe/care-scope-probe.mjs
影响：文本进入的是同一用户自己的 agent，未越过信任边界，不构成未授权信息泄露
门禁 1（流程）PASS：粗筛 audit、源码机制取证、scope 探针三段证据齐备
门禁 2（可达性）PASS：根 ctx 注册确实落 global 层，scope 探针实测三个 scope 都带 cura:butler 与 cura:health
门禁 3（真实影响）FAIL：接收方是同一用户的其它会话，没有第三方读取主体，不构成 RCE、提权或信息泄露
门禁 4（PoC 验证）PASS：care-scope-probe.mjs 展示了根 ctx 注册后任意 scope 可见的完整路径
门禁 5（数学边界）PASS：本项不涉及算术边界条件
门禁 6（环境）FAIL：cordis.patch.yml:2452 为 groupPolicy: disabled 且会话存储中 onebot-group 命中 0，群聊分支被环境完全阻断

BUG #2 FALSE POSITIVE — 宿主缺少 systemPrompt 服务时关怀层退回 QQ 模式，属静默降级
证据：lib/care.js:33 (18a6efb)
复现：node /d/DSH/asarx-extract/dsh/.probe/care-get-probe.mjs
影响：功能降级但不影响安全边界，且降级时写 logger.warning 可观测
门禁 1（流程）PASS：探针实测返回值与源码分支行号齐备
门禁 2（可达性）PASS：无 systemPrompt 服务的宿主上该分支可达
门禁 3（真实影响）FAIL：只影响功能覆盖范围，且以 warning 日志明示，不涉及 RCE、提权或信息泄露
门禁 4（PoC 验证）PASS：care-get-probe.mjs 证明裸 Context 上 get 返回 undefined 且不抛
门禁 5（数学边界）PASS：本项不涉及算术边界条件
门禁 6（环境）PASS：该路径无环境防护，也无需防护

BUG #3 FALSE POSITIVE — 用户可编辑文本中的双花括号会让宿主插值抛错并打崩整轮 pre-step
证据：lib/care.js:113 (18a6efb)
复现：node /d/DSH/asarx-extract/dsh/.probe/cura-f3-poc.mjs
影响：可用性中断，坏数据留在 travel.json 里会让该会话每一轮都失败，直到手动改文件，但不涉及 RCE、提权或信息泄露
门禁 1（流程）PASS：源码行号、正向 PoC、反向 PoC 与修复对照四段证据齐备
门禁 2（可达性）PASS：面板「存为常用」经 rules-remote 的 savePlace 即为正常 UI 路径，无需手改文件
门禁 3（真实影响）FAIL：仅造成对自身的可用性中断，按 verification-gates.md 门禁 3 判据属运维健壮性，不进 TRUE POSITIVE
门禁 4（PoC 验证）PASS：cura-f3-poc.mjs 展示触发输入与 unknown prompt variable 抛错原文，修复后 cura-f3-verify.mjs 同输入不再抛
门禁 5（数学边界）PASS：触发条件等价于文本含完整的双花括号标识符，无算术边界
门禁 6（环境）PASS：无任何环境防护阻断该路径

BUG #4 FALSE POSITIVE — audit 报本次改动删除了 security 分类提交的 71 行代码
证据：lib/index.js:291 (18a6efb)
复现：cd /d/dsh-cura && git diff d4522cb..18a6efb -- lib/index.js
影响：删除行全部为搬迁式重写的左侧，无能力丢失，无安全影响
门禁 1（流程）PASS：git diff 与 git blame 两路证据交叉核对
门禁 2（可达性）PASS：删除行确实存在于本次 diff 中
门禁 3（真实影响）FAIL：逐行对照确认为重写搬迁，七套测试与 43 项 luckin 断言背书等价性，无安全能力被移除
门禁 4（PoC 验证）PASS：diff 与 blame 的逐行对照即等价性证据
门禁 5（数学边界）PASS：本项不涉及算术边界条件
门禁 6（环境）PASS：本项不涉及环境防护

