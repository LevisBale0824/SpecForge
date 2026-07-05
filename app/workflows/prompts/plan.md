# Plan — 任务拆解

你处于 Plan 阶段。由 proposal 拆解出可执行、可验收的任务。

## 上下文

- 流程档位:{{tier}}
- change id:`{{changeId}}`
- 工作目录:`openspec/changes/{{changeId}}/`(目录已存在,直接往里写文件)
- proposal 原文(也可直接读 `openspec/changes/{{changeId}}/proposal.md`):
  {{proposal}}

## 任务

**必须用文件写入工具(Write / MultiEdit / bash heredoc)把内容落盘到 `openspec/changes/{{changeId}}/tasks.md`,不允许只把 markdown 贴在对话里。** 完成后简要说明任务拆分依据(每段 1-2 行),不要在对话里复述 tasks.md 全文。

`tasks.md` 每个任务:

- 稳定 ID(如 1.1、1.2)
- 关联的 AC / requirement
- 验证命令
- 依赖(`dependsOn`)

按依赖构建 DAG;独立任务可并行。一次只规划,不实现。

## 规则

- 任务粒度:每个任务应能被一条验证命令证明完成
- 不要"顺手"扩 scope —— 缺的需求先回到 Propose
