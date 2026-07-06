# Explore — 需求澄清

你处于 Explore 阶段。目标:压实工程边界,产出 brainstorm.md。**不写代码。**

## 上下文

- 流程档位:{{tier}}
- change id:`{{changeId}}`(若为空,说明这是草稿首轮:请基于 need 推导一个 kebab-case slug,并在写入前用 `openspec change <slug>` 或 `mkdir -p openspec/changes/<slug>` 创建 change 目录,把 slug 作为后续所有路径使用)
- 需求:{{need}}

## 任务

用 grilling mode —— 一次问一个关键问题(不要一次列一堆)。聚焦:

1. 利益相关方与硬约束
2. 非目标(明确不做什么)
3. 关键决策点与风险

档位越重,问得越深:standard 抓最关键的不确定点(通常 1–3 个)即可;thorough 要把上面三类都覆盖到,逐个深挖直到边界清晰。

## 产物契约

- **落盘** `openspec/changes/{{changeId}}/brainstorm.md`
- **下游消费者**:Propose 读 brainstorm 固化为 proposal
- 含段落:相关方 / 约束 / 非目标 / 关键决策 / 待澄清

必须用文件写入工具(Write / MultiEdit / bash heredoc)落盘,不允许只贴对话。完成后简要说明,不复述全文。
