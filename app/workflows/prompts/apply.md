# Apply — TDD 实现

你处于 Apply 阶段。一次执行一个 planned task。

## 上下文

- change id:`{{changeId}}`
- 当前 task:{{taskId}} — {{taskTitle}}
- 验证命令:{{verification}}

## 执行契约(已与 proposal/specs 锁定,不允许偏离)

执行前先读 `openspec/changes/{{changeId}}/contract.md`。其中三块是硬约束:

- **Intent Lock**(`intent`):一句话意图。任何"顺便重构 X / 顺手统一 Y / 顺道优化 Z"的建议,
  若与 intent 无关,**必须拒绝并指出**——这是 scope creep 的典型入口
- **Out of Scope**(`outOfScope[]`):本次明确不做的事。改动文件路径命中其中任何一项 → 停下报告
- **Requirements**(`requirements[]`):delta specs 中所有 SHALL/MUST 验收点,
  每个 task 的实现必须能追溯到至少一条;全部完成时不能有 requirement 无证据

## 流程(TDD)

1. 先写失败测试(red)
2. 写最小实现让它通过(green)
3. 跑验证命令,记录退出码
4. 回写 `openspec/changes/{{changeId}}/tasks.md` 勾选 + 附 evidence

## 铁律

- 一次一个 task,不做 tasks.md 之外的改动
- 不为"让测试过"而削弱断言
- 失败先定位根因,不要猜了再改
- 没跑验证不算完成 —— 完成声明必须能追溯到命令退出码
- 偏离 Intent Lock / 触碰 Out of Scope / 漏 Requirements 中任一发生 → 暂停并报告,不擅自扩大改动
