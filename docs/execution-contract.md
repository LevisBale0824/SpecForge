# 执行契约 (Execution Contract)

SpecForge 在 Propose 与 Apply 之间维护一份**执行契约**，作为规划到实现的唯一交接层。
本文档说明：契约为什么存在、长什么样、何时生成与检查、关键设计决策、维护指引。

---

## 1. 为什么需要这层

AI 编程有两类典型失控：

| 失控               | 表现                                               | 根因                       |
| ------------------ | -------------------------------------------------- | -------------------------- |
| **AI 跑偏**        | 用户说"修个 bug"，AI 顺手把配置项全重构了          | 没有意图锁定               |
| **执行与规划脱节** | proposal 写了"必须 200ms 内响应"，代码里一条没兑现 | 规划文档对执行阶段无约束力 |

传统做法是写一份 `proposal.md` 后让 AI 自由发挥，但这等于把规划做成"历史文件"——
执行阶段的 AI 不会主动读、读了也不会对照检查。

执行契约的作用是：**把规划文档压缩成一份可机器解析、可校验、可追溯的硬约束**，
让 Apply 阶段的每个动作都必须对齐这份契约。

---

## 2. 数据结构

定义在 `app/types/openspec.ts` 的 `ExecutionContract`。每个 change 一份，落盘到
`openspec/changes/<change-id>/contract.md`（JSON 序列化，扩展名沿袭项目约定）。

```
{
  "changeId": "fix-token-renew-perm",
  "need": "修复 token 续期后权限校验的边界 bug",
  "tier": "standard",
  "intent": "token 续期后必须重新校验资源权限,不改 RBAC 模型",  ← Intent Lock
  "outOfScope": [                                            ← Scope Fence
    "不重构现有 RBAC 模型",
    "不调整 /auth/login 的请求/响应格式"
  ],
  "requirements": [                                          ← 验收义务
    { "name": "Token 续期权限校验", "level": "MUST", "source": "specs/auth/spec.md" }
  ],
  "sourceHash": "a3f10c2e",                                  ← 内容指纹
  "scope": { "files": ["src/auth/renew.ts"], "api": ["POST /auth/renew"] },
  "verify": [
    { "command": "npm run lint", "description": "代码风格检查" },
    { "command": "npm test",  "description": "单元测试" },
    { "command": "npm run build", "description": "构建验证" }
  ],
  "risks": [],
  "generatedAt": 1719500000000
}
```

四个新字段（v0.x 新增）的语义：

| 字段           | 来源                                 | 作用                                               |
| -------------- | ------------------------------------ | -------------------------------------------------- |
| `intent`       | proposal `## Why` 第一段             | 一句话锁定核心意图。Apply 拒绝与之无关的"顺便"建议 |
| `outOfScope`   | proposal `## Out of Scope` 列表      | 显式排除项。改动文件路径命中即停                   |
| `requirements` | delta specs 的 `### Requirement:` 头 | 每个 SHALL/MUST 都必须有对应 completed task        |
| `sourceHash`   | proposal + deltaSpecs 的 djb2 哈希   | 内容级指纹。变了就标 stale                         |

---

## 3. 生命周期：双层防御

```
Propose ──┐ generateContract()
          │  ├─ extractIntent(proposal.## Why)
          │  ├─ extractOutOfScope(proposal.## Out of Scope)
          │  ├─ extractRequirements(change.deltaSpecs)
          │  └─ computeSourceHash() → contract.md 落盘
          ▼
Apply   ──┐ loadContract() → checkStale()
          │  stale → contract-card 显示红字警告
          │  apply.md prompt 强制:触碰 Out-of-Scope / 偏离 Intent 即停
          ▼
Verify  ──┐ refreshVerifyWarnings()
          │  ├─ checkStale()                  → 契约过期?
          │  └─ checkRequirementsCoverage()   → 每个 SHALL/MUST 有 completed task?
          │  verify.md prompt 强制:命中即 NOT_READY,哪怕 lint/test/build 全绿
          ▼
Archive ── 既有 NOT_READY 阻断逻辑
```

### 3.1 Apply 阶段的契约卡

`WorkflowStudio.vue` 在 apply 阶段渲染 `contract-card`，可视化展示：

- Intent Lock（黄色斜体）
- Out of Scope（玫红 ⊘）
- Requirements 列表（带 MUST/SHALL 等级徽章 + 来源路径）
- Scope / Verify / Risks（原有）
- 顶部红色 stale 横幅（当 proposal/specs 被改后未重建契约时）

### 3.2 Verify 阶段的 Pre-Gate 卡

`runGates` 入口调 `refreshVerifyWarnings()`，在 evidence-card 上方渲染独立的红框警告，
列出每一项风险（"契约过期"、"未覆盖：XXX"）。**不阻断 Run Gates 执行**——
真实退出码仍然跑，但 verify.md prompt 要求 AI 把这些风险纳入 verdict：
命中任一即 NOT_READY。

---

## 4. 关键设计决策

### 4.1 为什么用 djb2 而不是 SHA256

spec-superflow 原版用 SHA256 哈希。SpecForge 改用 djb2（32-bit 字符串哈希）：

- **目的只是检测「变没变」**，不是密码学抗碰撞——djb2 足够
- **零依赖**：不需要 Node `crypto` 模块，浏览器/Electron 通用
- **性能**：一个 change 的契约哈希计算在微秒级

碰撞概率 ~1/4 亿，对单 change 的语义比较完全够用。如果未来要做跨 change 索引，
再升级到 SHA256 即可（接口不变）。

### 4.2 为什么 stale 只警告不阻断

硬阻断（不允许进入 Apply）在 GUI 应用里不友好——用户改了 proposal 一个错别字，
不应被强制回 Propose 重生成契约。

因此采用 **soft guard**：

- 视觉上明确标红（contract-card 顶部、verify Pre-Gate 卡）
- AI prompt 上强制约束（apply.md / verify.md 都要求 AI 看到风险就停/判 NOT_READY）
- 用户仍可选择忽略警告推进——但风险全程可见

这与 spec-superflow 的硬门禁哲学不同，是 SpecForge 作为 GUI 应用的有意取舍。

### 4.3 为什么覆盖率只看 `task.requirement` 字段

`checkRequirementsCoverage` 的判据：契约里每个 requirement.name 必须能在
`change.tasks` 里找到一条 `status === "completed" && requirement === name` 的 task。

**没有**做更复杂的语义匹配（比如解析 task 描述里的关键词、跑测试反向映射等），
理由：

- 现有数据模型已经支持 `OpenSpecTask.requirement` 显式绑定，用足它即可
- 复杂匹配会引入误报，把"覆盖率检查"从硬约束变成噪音
- 真实遗漏会被 Verify 阶段的 `openspec validate --strict` 进一步兜底

如果未来发现覆盖率漏报严重，再考虑加权（比如允许 task 描述里的关键词弱匹配）。

### 4.4 为什么不引入新的工作流阶段

spec-superflow 把 contract-builder 单列一个 skill、一个状态。SpecForge 把契约生成
挂在 `Propose → Apply` 的转换钩子里，零新阶段、零新 UI 入口。

理由：

- SpecForge 已有三档位（lean/standard/thorough），阶段数已不少
- 契约生成是 Propose 的副作用，不是用户主动行为
- 减少跳转 = 减少认知负担

---

## 5. 来源与差异

本机制借鉴自 [MageByte-Zero/spec-superflow](https://github.com/MageByte-Zero/spec-superflow)
的 `contract-builder` skill。原版核心思路（Intent Lock / Scope Fence / Requirements 映射）
完整保留，差异在工程实现：

| 维度     | spec-superflow                     | SpecForge                                    |
| -------- | ---------------------------------- | -------------------------------------------- |
| 阶段数   | 9 skill + 8 状态机                 | 复用现有 7 阶段，0 新阶段                    |
| 哈希算法 | SHA256                             | djb2（够用即可）                             |
| 失败行为 | 硬阻断（不允许进入下一状态）       | soft warn（用户可推进，AI 强制判 NOT_READY） |
| 状态存储 | `.spec-superflow.yaml` + DP 时间戳 | 契约文件本身（`contract.md`）                |
| 集成方式 | Claude Code 插件 / 多平台          | Vue/Electron GUI，UI 可视化                  |
| 部署成本 | 9 个 skill 文件 + guard 脚本       | 1 个 composable + 2 处 prompt + 1 个 UI 卡片 |

关键洞察保留：**真实退出码是必要不充分条件，契约一致性是另一半**。
（原版 `release-archivist.md`: "Claiming work is complete without verification is dishonesty"）

---

## 6. 故障排查

| 现象                                     | 可能原因                                                  | 处置                                                          |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| Apply 阶段 contract-card 不显示          | 契约未生成（用户跳过 Propose）                            | 检查 `contract.md` 是否存在；回 Propose                       |
| contract-card 顶部红字 "契约过期"        | proposal/specs 改了但没重建契约                           | 回 Propose，重新走 generateContract                           |
| Requirements 区块为空                    | delta specs 没有 `### Requirement:` 头，或没标 SHALL/MUST | 检查 spec.md 格式，运行 `openspec validate --strict`          |
| Verify Pre-Gate 显示"未覆盖"             | task 没绑 requirement，或对应的 task 还没勾选             | 在 tasks.md 给 task 加 `requirement: <Name>`，或完成对应 task |
| `checkStale` 总是报 source-hash-mismatch | proposal 文件被工具自动格式化（prettier 等）              | 排除格式化干扰；或重生成契约                                  |

---

## 7. 维护指引

### 何时更新本文档

- 契约字段增删 → 更新第 2 节
- 新增 stale 判据 → 更新第 3 节 + `ContractStaleReason` 类型注释
- 修改 soft/hard guard 取舍 → 更新第 4.2 节
- 升级哈希算法 → 更新第 4.1 节

### 相关代码索引

| 关注点                   | 文件                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| 类型定义                 | `app/types/openspec.ts` (搜 `ExecutionContract`)                  |
| 生成/加载/检测逻辑       | `app/composables/useContract.ts`                                  |
| Apply 阶段 UI 卡片       | `app/components/workflow/WorkflowStudio.vue` (搜 `contract-card`) |
| Verify Pre-Gate 卡片     | 同上 (搜 `verify-warn-card`)                                      |
| Propose 产出格式约束     | `app/workflows/prompts/propose.md`                                |
| Apply 契约引用约束       | `app/workflows/prompts/apply.md`                                  |
| Verify Pre-Gate 强制约束 | `app/workflows/prompts/verify.md`                                 |
