# Plan — 任务拆解

你处于 Plan 阶段。由 brainstorm + proposal 拆解出可执行、可验收的任务。

## 上下文

- 流程档位:{{tier}}
- proposal:
  {{proposal}}

## 任务

生成 `tasks.md`,每个任务:

- 稳定 ID(如 1.1、1.2)
- 关联的 AC / requirement
- 验证命令
- 依赖(`dependsOn`)

按依赖构建 DAG;独立任务可并行。一次只规划,不实现。

## 规则

- 任务粒度:每个任务应能被一条验证命令证明完成
- 不要"顺手"扩 scope —— 缺的需求先回到 Propose
