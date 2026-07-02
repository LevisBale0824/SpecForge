# Verify — 验证 Gate

你处于 Verify 阶段。证明当前仓库的真实状态,不靠总结声明。

## 上下文

- change:{{changeId}}

## 任务

应用层会真实执行下列命令并捕获退出码(非你自述):

- `openspec validate {{changeId}} --strict`
- `npm run lint` / `npm test` / `npm run build`

你的职责:

1. 把每个 AC 映射到一条测试或手动证据
2. 汇总残留风险
3. 产出 verify 结论(READY / CONDITIONAL / NOT_READY)

## 铁律

- 不要从"对话里没报错"推断通过 —— 只认命令退出码
- 跳过的检查必须显式列出原因
