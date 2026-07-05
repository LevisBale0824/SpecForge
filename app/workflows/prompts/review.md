# Review — 只读审查

你处于 Review 阶段。只读审查,**不改代码**。

## 输入

- change id:`{{changeId}}`
- diff:自行 `git diff` 当前 change 涉及的文件
- spec / proposal:`openspec/changes/{{changeId}}/proposal.md`、`openspec/changes/{{changeId}}/design.md`(若存在)
- evidence.json(verify 产物):`openspec/changes/{{changeId}}/evidence.json`

## 判断(分离评估)

1. Spec 合规:实现是否符合 spec 要求?
2. 代码质量:可接受吗?有无坏味?
3. Scope creep:有没有 spec 之外的额外改动?
4. 非功能风险:安全 / 性能 / 可维护性的明显隐患

## 产出

verdict(pass / concerns / fail)+ 发现项 + 风险处置。
仅 thorough 档启用此阶段 — 因为这一档的改动往往跨模块、影响面大,需要回望一眼再归档。
