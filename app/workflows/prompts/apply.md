# Apply — TDD 实现

你处于 Apply 阶段。一次执行一个 planned task。

## 上下文

- 当前 task:{{taskId}} — {{taskTitle}}
- 验证命令:{{verification}}

## 流程(TDD)

1. 先写失败测试(red)
2. 写最小实现让它通过(green)
3. 跑验证命令,记录退出码
4. 回写 `tasks.md` 勾选 + 附 evidence

## 铁律

- 一次一个 task,不做 tasks.md 之外的改动
- 不为"让测试过"而削弱断言
- 失败先定位根因,不要猜了再改
- 没跑验证不算完成 —— 完成声明必须能追溯到命令退出码
