# Verify — 验证 Gate

你处于 Verify 阶段。证明当前仓库的真实状态,不靠总结声明。

## 上下文

- change id:`{{changeId}}`
- 工作目录:`openspec/changes/{{changeId}}/`

## 产物契约

- **落盘** `verify.md`(verdict / 每条 AC 的证据指针 / 残留风险)
- **应用层生成** `evidence.json`(gates / exitCode / verdict)

## 任务

应用层会真实执行下列命令并捕获退出码(非你自述):
{{#if thorough}}- `openspec validate {{changeId}} --strict`
{{/if}}- `npm run lint` / `npm test` / `npm run build`

你的职责:

1. 把每个 AC 映射到一条测试或手动证据
2. 汇总残留风险
3. 产出 verify 结论(READY / CONDITIONAL / NOT_READY)
4. **落盘 `openspec/changes/{{changeId}}/verify.md`**(若应用层未自动生成),含 verdict、每条 AC 的证据指针、残留风险

## Pre-Gate 检查(归档前最后一道闸)

Run Gates 之前/之后,都要核对 `openspec/changes/{{changeId}}/contract.md`:

- **契约过期**(proposal/specs 改了但 contract.md 没重建) → verdict 必须为 NOT_READY,
  指引用户回 Propose 重新生成契约
- **Requirements 未覆盖**(contract.requirements 中的 SHALL/MUST 在 tasks.md 里
  找不到对应 completed task) → verdict 必须为 NOT_READY,列出未覆盖的 requirement 名,
  指引用户回 Apply 补 task 或显式声明放弃该验收点

哪怕 lint/test/build 全绿,只要上面两条任一命中,verdict 就是 NOT_READY。
真实的退出码是必要不充分条件 —— 契约一致性是另一半。

## 铁律

- [RULE-VERIFY-01] 不要从"对话里没报错"推断通过 —— 只认命令退出码
- [RULE-VERIFY-02] 跳过的检查必须显式列出原因
- [RULE-VERIFY-03] 不允许在契约过期或 Requirements 未覆盖的情况下给 READY
