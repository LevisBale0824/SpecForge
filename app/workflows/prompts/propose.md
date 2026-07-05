# Propose — 固化成可验收 spec

你处于 Propose 阶段。把需求固化成可验收的 OpenSpec 契约。

## 上下文

- 流程档位:{{tier}}
- change id:`{{changeId}}`
- 工作目录:`openspec/changes/{{changeId}}/`(目录已存在,直接往里写文件)
- 需求:{{need}}
  {{#unless lean}}
- brainstorm:
  {{brainstorm}}
  {{/unless}}

## 第一步:判定是否触及 capability 契约层

读 need/brainstorm 与项目结构,做出**显式判定**,写进 proposal.md 的 `## Capabilities` section:

- **Case A — 触及契约层**:新增/修改/删除用户可见能力,或变更对外 API/接口/数据契约 → 必须产 spec delta
- **Case B — 不触及契约层**:内部重构 / dev tooling / CI / 文档 / UI 微调 → 不产 spec delta,但要在 Capabilities section 写明判定依据

判定不清按 Case A 保守处理。

## 任务

**所有产物必须用文件写入工具(Write / MultiEdit / bash heredoc)落盘到 `openspec/changes/{{changeId}}/` 下,不允许只把 markdown 贴在对话里。** 完成后简要说明写了哪些文件、各自的核心内容(每文件 1-2 行摘要),不要在对话里复述全文。

1. 落盘 `openspec/changes/{{changeId}}/proposal.md`,必含以下 section(顺序固定):
   - `## Why`:一句话锁定本次变更的核心意图(=Intent Lock,Apply 阶段会以此拦截偏离建议)
   - `## What Changes`:涉及哪些文件/模块,列出具体路径
   - `## Out of Scope`:本次明确**不做**的事(=Scope Fence,每条独占一行,`-` 起始)
   - `## Capabilities`:写明 Case A / Case B 判定与依据;Case A 时列出涉及哪些 capability
   - `## Impact`:向后兼容 / 性能 / 迁移路径

2. **Case A 专属**(Case B 跳过此步):在 `openspec/changes/{{changeId}}/specs/<capability>/spec.md` 落盘 spec delta。格式铁律(否则 openspec validate --strict 失败):
   - Requirement 正文必须含 `SHALL` 或 `MUST`(不是 should / will)
   - Section 头:`## ADDED Requirements` / `### Requirement: <Name>` / `#### Scenario: <Name>`
   - Scenario 正文只用 `- **WHEN**` / `- **THEN**` / `- **AND**`
   - 档位为 thorough 时,额外落盘 `openspec/changes/{{changeId}}/design.md`(至少 2 个备选方案 + 取舍理由)
     {{#if lean}}
3. **lean 专属**:在 `openspec/changes/{{changeId}}/proposal.md` 末尾追加 `## Acceptance Checklist` section(2-5 项 `- [ ]`,每项绑定一条可验证命令,如 lint/test/build/手动验收),并在 `openspec/changes/{{changeId}}/tasks.md`(checkbox 格式 `- [ ] 1.1 ...`,与 checklist 一一对应)。这是 Apply 的 scope 边界,粒度过粗时 Apply 会迷失。
   {{/if}}

## Case B 收尾:告诉用户 strict 会失败

判定为 Case B 时,proposal.md 落盘完成后在对话里**显式**告诉用户:

> 本次改动判定为不触及 capability 契约层(依据已写入 Capabilities section)。`openspec validate --strict` 因此会失败(无 delta)。建议:
>
> - 若只是内部重构/dev tooling:可跳过 openspec 流程,直接 git 提交
> - 若坚持走 openspec:切到 lean 档,verify 阶段只跑 lint/test/build,不跑 strict

由用户决定下一步,不要擅自跳过后续阶段。

## 档位差异(深度而不是数量)

- **lean**:需求边界清晰(已跳过 Explore),proposal 写得短而准,直击 What/Impact;末尾附 2-5 项 Acceptance Checklist 并同步落 tasks.md
- **standard**:补全 Why 与 Capabilities 锚点,确保 spec 可验收
- **thorough**:`design.md` 必须列出至少 2 个备选方案 + 取舍理由;Impact 涵盖向后兼容、性能、迁移路径

不写实现代码。
