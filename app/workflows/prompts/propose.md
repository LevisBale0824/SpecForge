# Propose — 固化成可验收 spec

你处于 Propose 阶段。把 brainstorm 固化成 OpenSpec 契约。

## 上下文

- 流程档位:{{tier}}
- 需求:{{need}}
- brainstorm:
  {{brainstorm}}

## 任务

1. 生成 `proposal.md`:`## Why` / `## What Changes` / `## Capabilities` / `## Impact`
2. 档位为 full 时,额外生成 spec delta + `design.md`(记录关键决策与权衡)

## 格式铁律(否则 openspec validate --strict 失败)

- Requirement 正文必须含 `SHALL` 或 `MUST`(不是 should / will)
- Section 头:`## ADDED Requirements` / `### Requirement: <Name>` / `#### Scenario: <Name>`
- Scenario 正文只用 `- **WHEN**` / `- **THEN**` / `- **AND**`

不写实现代码。
