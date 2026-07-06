# Propose — 固化成可验收 spec

你处于 Propose 阶段。把需求固化成可验收的 OpenSpec 契约(WHAT)。**不产 tasks.md —— 任务拆解归 Apply 阶段。**

## 上下文

- 流程档位:{{tier}}
- change id:`{{changeId}}`
- 工作目录:`openspec/changes/{{changeId}}/`(目录已存在,直接往里写文件)
- 需求:{{need}}
- brainstorm:读 `openspec/changes/{{changeId}}/brainstorm.md`(用 Read 工具读取最新内容)

## 产物契约

- **落盘** `proposal.md` → Apply / Verify / Review 读
- **Case A 落盘** `specs/<capability>/spec.md` → Verify 检查 SHALL/MUST 覆盖
  {{#if thorough}}- **thorough 额外** `design.md` → Review 读
  {{/if}}

## 任务

**所有产物必须用文件写入工具(Write / MultiEdit / bash heredoc)落盘到 `openspec/changes/{{changeId}}/` 下,不允许只把 markdown 贴在对话里。** 完成后简要说明写了哪些文件、各自核心内容(每文件 1-2 行摘要),不要在对话里复述全文。

1. 落盘 `openspec/changes/{{changeId}}/proposal.md`,必含以下 section(顺序固定):
   - `## Why`:一句话锁定本次变更的核心意图(=Intent Lock,Apply 阶段会以此拦截偏离建议)
   - `## What Changes`:涉及哪些文件/模块,列出具体路径
   - `## Out of Scope`:本次明确**不做**的事(=Scope Fence,每条独占一行,`-` 起始)
   - `## Capabilities`:列出涉及哪些 capability 及变更类型(ADDED/MODIFIED/REMOVED)。若本次不触及契约层(内部重构/CI/文档),写明依据,可跳过 spec delta
   - `## Context Basis`:需求来源(explore 的哪些结论 / 哪些硬约束 / 哪些用户原话),每条一行,可追溯
   - `## Impact`:向后兼容 / 性能 / 迁移路径

2. 若触及契约层,在 `openspec/changes/{{changeId}}/specs/<capability>/spec.md` 落盘 spec delta。格式铁律(否则 openspec validate --strict 失败):
   - Requirement 正文必须含 `SHALL` 或 `MUST`(不是 should / will)
   - Section 头:`## ADDED Requirements` / `### Requirement: <Name>` / `#### Scenario: <Name>`
   - Scenario 正文只用 `- **WHEN**` / `- **THEN**` / `- **AND**`
     {{#if thorough}}
3. **thorough 专属**:额外落盘 `openspec/changes/{{changeId}}/design.md`,必须列出至少 2 个备选方案 + 取舍理由。
   {{/if}}

## 铁律

- [RULE-PROPOSE-01] 所有产物必须落盘,不许只贴对话
- [RULE-PROPOSE-02] **不产 tasks.md** —— 任务拆解归 Apply 阶段

不写实现代码。
