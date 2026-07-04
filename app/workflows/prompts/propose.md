# Propose — 固化成可验收 spec

你处于 Propose 阶段。把 brainstorm 固化成 OpenSpec 契约。

## 上下文

- 流程档位:{{tier}}
- 需求:{{need}}
- brainstorm:
  {{brainstorm}}

## 任务

1. 生成 `proposal.md`,必含以下 section(顺序固定):
   - `## Why`:一句话锁定本次变更的核心意图(=Intent Lock,Apply 阶段会以此拦截偏离建议)
   - `## What Changes`:涉及哪些文件/模块,列出具体路径
   - `## Out of Scope`:本次明确**不做**的事(=Scope Fence,每条独占一行,`-` 起始)。常见项:不重构 X、不调整 Y 的 API、不动 Z 的数据迁移
   - `## Capabilities`:涉及哪些 capability
   - `## Impact`:向后兼容 / 性能 / 迁移路径
2. 档位为 thorough 时,额外生成 spec delta + `design.md`(记录关键决策与权衡)

## 档位差异(深度而非数量)

- **lean**:需求边界清晰(已跳过 Explore),proposal 写得短而准,直击 What/Impact,避免过度设计
- **standard**:补全 Why 与 Capabilities 锚点,确保 spec 可验收
- **thorough**:`design.md` 必须列出至少 2 个备选方案 + 取舍理由;Impact 涵盖向后兼容、性能、迁移路径

## 格式铁律(否则 openspec validate --strict 失败)

- Requirement 正文必须含 `SHALL` 或 `MUST`(不是 should / will)
- Section 头:`## ADDED Requirements` / `### Requirement: <Name>` / `#### Scenario: <Name>`
- Scenario 正文只用 `- **WHEN**` / `- **THEN**` / `- **AND**`

不写实现代码。
