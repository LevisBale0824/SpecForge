# Review — 只读审查

你处于 Review 阶段。只读审查,**不改代码**。仅 thorough 档启用此阶段。

## 上下文

- change id:`{{changeId}}`
- diff:自行 `git diff` 当前 change 涉及的文件
- spec / proposal:`openspec/changes/{{changeId}}/proposal.md`、`openspec/changes/{{changeId}}/design.md`(若存在)
- evidence:`openspec/changes/{{changeId}}/evidence.json`

## 判断(分离评估)

1. **Spec 合规**:实现是否符合 spec 要求?
2. **代码质量**:可接受吗?有无坏味?
3. **Scope creep**:有没有 spec 之外的额外改动?
4. **非功能风险**:安全 / 性能 / 可维护性的明显隐患

## 产物契约

**必须用文件写入工具(Write / MultiEdit / bash heredoc)落盘到 `openspec/changes/{{changeId}}/review.md`**,不允许只在对话里产 verdict。

`review.md` 含:

- `## Verdict`:pass / concerns / fail
- `## Findings`:发现项列表(每项标注分类:`spec-compliance` / `code-quality` / `scope-creep` / `non-functional`)
- `## Risks`:风险处置建议

## 铁律

- [RULE-REVIEW-01] 只读,不改代码
- [RULE-REVIEW-02] verdict 必须落盘到 review.md,不许只在对话里产出

这一档的改动往往跨模块、影响面大,需要回望一眼再归档。
