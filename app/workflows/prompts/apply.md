# Apply — 拆任务 + TDD 实现

你处于 Apply 阶段。先由 proposal/specs 拆解出可执行任务,再以 TDD 逐个实现。

## 上下文

- 流程档位:{{tier}}
- change id:`{{changeId}}`
- 工作目录:`openspec/changes/{{changeId}}/`(目录已存在)
- proposal:读 `openspec/changes/{{changeId}}/proposal.md`(用 Read 工具读取最新内容)

## 执行契约(已与 proposal/specs 锁定,不允许偏离)

执行前先读 `openspec/changes/{{changeId}}/contract.md`。其中三块是硬约束:

- **Intent Lock**(`intent`):一句话意图。任何"顺便重构 X / 顺手统一 Y / 顺道优化 Z"的建议,
  若与 intent 无关,**必须拒绝并指出**——这是 scope creep 的典型入口
- **Out of Scope**(`outOfScope[]`):本次明确不做的事。改动文件路径命中其中任何一项 → 停下报告
- **Requirements**(`requirements[]`):delta specs 中所有 SHALL/MUST 验收点,
  每个 task 的实现必须能追溯到至少一条;全部完成时不能有 requirement 无证据

## 子步骤 1:拆解 tasks.md(若不存在或为空)

若 `openspec/changes/{{changeId}}/tasks.md` 不存在或内容为空,先由 proposal 的 Acceptance Criteria / specs 的 Requirements 拆解任务。

**必须用文件写入工具(Write / MultiEdit / bash heredoc)把内容落盘到 `openspec/changes/{{changeId}}/tasks.md`,不允许只把 markdown 贴在对话里。**

`tasks.md` 每个任务:

- 稳定 ID(如 1.1、1.2)
- 关联的 AC / requirement(标注 `satisfies: REQ-xxx`)
- 验证命令(lint / test / build / 手动验收)
- 依赖(`dependsOn: 1.1`)

按依赖构建 DAG;独立任务可并行。任务粒度:每个任务应能被一条验证命令证明完成。不要"顺手"扩 scope —— 缺的需求先回到 Propose。

## 子步骤 2:TDD 实现(一次一个 task)

1. 先写失败测试(red)
2. 写最小实现让它通过(green)
3. 跑验证命令,记录退出码
4. 回写 `openspec/changes/{{changeId}}/tasks.md` 勾选 + 附 evidence

## 铁律

- [RULE-APPLY-01] **NO PRODUCTION CODE WITHOUT FAILING TEST**(有测试覆盖要求的任务)
- [RULE-APPLY-02] 一次一个 task,不做 tasks.md 之外的改动
- [RULE-APPLY-03] 不为"让测试过"而削弱断言
- [RULE-APPLY-04] **NO COMPLETION CLAIMS WITHOUT FRESH EVIDENCE** —— 没跑验证不算完成,完成声明必须能追溯到命令退出码
- [RULE-APPLY-05] 失败先定位根因,不要猜了再改
- [RULE-APPLY-06] 偏离 Intent Lock / 触碰 Out of Scope / 漏 Requirements 中任一发生 → 暂停并报告,不擅自扩大改动
