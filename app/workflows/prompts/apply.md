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

### 任务格式

每个任务为一行 checkbox 列表项,后接若干缩进子字段。仅下列子字段会被识别;自造键名或拼写错误将被忽略,可能导致 Verify 阶段判定 requirement 未覆盖。

```
- [ ] <ID> <标题>
  - Requirement: <requirement 名>
  - Verification: <验证命令>
  - Estimate: <分钟数>
  - Depends on: <前置任务 ID>
  - Result: <完成证据>
```

| 子字段         | 任务级          | 释义                                                                |
| -------------- | --------------- | ------------------------------------------------------------------- |
| `Requirement`  | 可选,见覆盖规则 | 本任务满足的验收点,取 contract.md 中对应 requirement 的 `name` 原文 |
| `Verification` | 推荐            | 可执行命令或手动验收步骤,作为完成判据                               |
| `Estimate`     | 可选            | 预估工时,整数分钟                                                   |
| `Depends on`   | 可选            | 前置任务 ID,逗号分隔,用于构建 DAG                                   |
| `Result`       | 完成时回填      | 命令输出或证据摘要                                                  |

- checkbox 标记:`- [ ]` 未完成,`- [x]` 已完成。
- `<ID>` 形如 `<组号>.<序号>`(如 `1.1`、`2.3`),全局唯一且稳定。
- 子字段须缩进并以 `- ` 起首;键名大小写不敏感,但 `Depends on` 为空格分隔的双词,非驼峰。

### Requirement 覆盖规则

contract.md 中**每一条** MUST / SHALL requirement,须至少由一个状态为 completed 的任务,经 `- Requirement: <name>` 绑定其完整 `name`,方视为已覆盖。Verify 阶段据此判定;任一 MUST / SHALL 缺少对应 completed 绑定,verdict 须为 NOT_READY。

- `name` 取 contract.md 中该 requirement 的 `name` 字段原文,通常为含全角标点与破折号的中文陈述句;须逐字相等,禁止缩写、改写或代之以 `REQ-xxx` 等自造标识。
- 单个任务的 `Requirement` 为单值,仅能绑定一个 requirement;若一份实现同时满足多条,应拆分为多个任务分别绑定,或择最贴切者绑定。
- 非 MUST / SHALL 的事务性任务(调研、脚手架等)无须绑定。

按依赖关系构建 DAG;无依赖任务可并行。任务粒度以“可由单一验证命令证明完成”为准。不得借机扩大 scope;发现遗漏的 requirement 应回 Propose 阶段补充。

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
