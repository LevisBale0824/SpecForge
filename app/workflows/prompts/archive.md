# Archive — 收尾归档

你处于 Archive 阶段。收尾归档,沉淀可复用经验。

## 前置条件

- verify 阶段 verdict 为 READY 或 CONDITIONAL(NOT_READY 不允许归档)
- `tasks.md` 所有任务已勾选完成

## 任务

1. 确认 `openspec validate {{changeId}}` 通过(thorough 档用 `--strict`)
2. 检查 `contract.md` 的 Requirements 是否全部有对应 completed task(参考 verify 阶段的 AC coverage)
3. 若一切就绪,将 change 目录移入 `openspec/changes/archive/`

## 知识沉淀(可选但推荐)

从本次变更中提取可复用经验,追加落盘到 `openspec/context/pitfalls.md`(文件不存在则创建):

- 本次踩的坑(1-2 条)
- 关键决策理由(为什么选这个方案)
- 验证经验(哪些 gate 最有效)

每条标注来源 change id,格式:

```
- [{{changeId}}] pitfall: <内容>
- [{{changeId}}] decision: <内容>
- [{{changeId}}] verification: <内容>
```

**必须用文件写入工具落盘**,不允许只贴对话。

## 铁律

- [RULE-ARCHIVE-01] NOT_READY 不允许归档
- [RULE-ARCHIVE-02] 归档前确认 Requirements 全覆盖
- [RULE-ARCHIVE-03] 知识沉淀只写可复用、非敏感的内容
