# Pitfalls — 可复用经验沉淀

> 来源：各 change 归档时提炼。只写可复用、非敏感内容。每条标注 change id。

---

## pitfall（踩的坑）

- [hard-delete-sessions] **openspec CLI 交互式命令在非 TTY 子进程中必崩**：`openspec archive`（及任何带 confirm prompt 的命令）在不带 `-y` 时会调用 `prompts`/`@inquirer` 类库等待输入；若宿主用 `spawn(..., { stdio: ["ignore", "pipe", "pipe"] })`（stdin ignore / 非 TTY），prompt 库立即抛 `User force closed the prompt with 0 null`，命令非零退出。**修复模式**：非交互场景调用必须加 `-y/--yes`；若需保留"二次确认"语义，必须在 UI 层另挂 ConfirmDialog（不能依赖 CLI prompt）。同理需注意：`runProjectGate`/`runShell` 这类"门禁执行器"若复用给任何交互 CLI，都会触发同一问题。

## decision（关键决策理由）

- [hard-delete-sessions] **fs.rm 兜底整组跳过**：阶段 0.1 通过读上游源码（`anomalyco/opencode` projector `db.delete(SessionTable)`）证实 `DELETE /session/{id}` 是真实 SQL 硬删（DB 行级），非软归档。故 spec R7（fs.rm 兜底）三个 Scenario 无可应用对象，整组降级为 N/A。**可复用经验**：写 spec 时若含"兜底"分支，应在 Apply 第一组任务先做"主路径是否真需兜底"的源码核实，避免实现永不触发的代码路径（YAGNI）。
- [hard-delete-sessions] **级联删除必须客户端递归**：上游 `session.children(parentID)` 只做 `WHERE parentID = ?` 单层查询（非递归 CTE），projector 也只删单行不级联。故 R2 级联 MUST 客户端 DFS 实现（`collectDescendantSessionIds`）。**可复用经验**：不要假设后端"应该"级联，必须读源码确认；孤儿数据是软删除链路最隐蔽的坑。

## verification（验证经验）

- [hard-delete-sessions] **evidence gate 的 lint/test/build 三个 exitCode:null 是宿主环境噪声，非 change 缺陷**：这三个 gate 在仓库里长期是 `npm warn Unknown env config` + 超时形态，与本次改动无关（本次改动文件 `npx eslint`/`npx vitest`/`npx vue-tsc` 单独跑全绿）。verdict 仍判 CONDITIONAL 而非 READY，符合"只认命令退出码"的保守原则。**可复用经验**：归档时 CONDITIONAL 是可接受的（RULE-ARCHIVE-01 只拦 NOT_READY），但应在 tasks.md 5.x 回填里明确标注哪些 gate 失败属"既有阻塞"以留痕。
- [hard-delete-sessions] **最有效的 gate 是 spec 层（`openspec validate --strict`）**：exitCode:0/passed:true，确定性最高。lint/test/build 受宿主环境与既有未提交改动干扰，信噪比低。后续 change 若时间紧，优先保证 spec gate 绿 + 改动文件定向 `npx` 验证。
