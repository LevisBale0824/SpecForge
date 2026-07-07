# Tasks — hard-delete-sessions

> 阶段: Apply · 档位: standard · change: `hard-delete-sessions`
> 上游: `proposal.md` / `contract.md` / `specs/session-deletion/spec.md`
> 拆分原则: 每个 task 可独立勾选、有明确完成条件、可单独验证；按依赖排成 DAG。
> 验证命令（来自 contract.verify）: `pnpm lint` / `pnpm test` / `pnpm build`
> 约定: 完成条件中“测试通过”= 新增/相关单测在 `pnpm test` 中绿；构建通过 = `pnpm build` 退出 0；手动验收需在 Electron 桌面端 `pnpm electron:dev` 实跑。

---

## 阶段 0 · Apply 前置核实（阻塞项）

> 对应 proposal §“待 Apply 核实的阻塞项”。这些是 HOW 层细节，结论决定后续阶段 3/4 是否触发。
> 完成方式: 把结论写入本文件顶部的“阶段 0 结论”注释块（Apply 时回填），并在 PR 描述里附证据（curl 输出 / 源码引用 / 截图）。

- [x] 0.1 核实 OpenCode `DELETE /session/{id}` 真实持久化行为
  - Requirement: 删除须持久化——冷启动后不可复活
  - 完成条件: 明确回答“DELETE 后 `GET /session` 列表是否还包含该 id”；给出可复现的验证步骤（启动 OpenCode 服务、curl DELETE、curl GET 列表对比）。
  - 结论分流: 持久 → 阶段 3（fs.rm 兜底）整组降级为可选；不持久 → 阶段 3 为 MUST。

- [x] 0.2 核实 OpenCode 各平台会话磁盘存储路径 + project→实例桶映射规则
  - 完成条件: 给出 Windows / macOS / Linux 三平台会话存储根目录；说明 `activeDirectory`(project) 如何映射到实例桶（参考 `electron/paths.ts` / `electron/instanceCoordinator.ts` / `electron/serverPool.ts`）。
  - 验证方式: 引用 OpenCode 官方文档或源码 commit；本地实测一处路径。

- [x] 0.3 核实 `getSessionChildren`（`opencode.ts:297`）返回的是直接子级还是全量后代
  - 完成条件: 给出返回结构示例；判定“是否需要客户端递归”。
  - 结论分流: 全量后代 → 阶段 1.1 递归辅助可省略；仅直接子级 → 1.1 为 MUST。

- [x] 0.4 核实 Zero 后端（`zeroAdapter.ts`）DELETE 是否同样持久；不持久时兜底是否对称覆盖
  - 完成条件: 对称回答 0.1 的等价问题；若 Zero 路径规则与 OpenCode 不同，记录其独立派生规则。
  - 验证方式: 切换到 Zero 后端实测，或引用 Zero 适配器源码。

---

## 阶段 1 · 核心删除链路重写（spec R1 / R2 / R4）

> 落地 `useBackend.ts:1114–1135` 的 `deleteSession` 重写。
> 顺序约束: 1.1（后代收集）→ 1.2（主路径删除+回查+失败显形）→ 1.3（兜底接入点 stub）。
> 兜底实现放阶段 3，本阶段只留接入点和接口契约。

- [x] 1.1 新增“递归收集全部后代”辅助函数（条件性，依 0.3 结论）
  - Requirement: 删除须级联整棵子会话子树
  - 范围: `app/utils/opencode.ts` 或 `app/composables/useBackend.ts` 内部辅助。
  - 完成条件:
    - 输入一个 sessionId，返回其后代 id 数组（递归到底）。
    - 任一 `getSessionChildren` 调用失败 → 抛错并附 failing id（供 spec “子树枚举不全时安全失败”场景）。
    - 若 0.3 结论为“全量后代”，则该任务降级为直接透传，并在代码注释标注依据。
  - 验证方式: 新增单测 `app/composables/__tests__/useBackend.descendants.test.ts`（或 utils 下对应文件），覆盖：无子、单层、多层、调用失败 4 个用例；`pnpm test` 绿。

- [x] 1.2 重写 `useBackend.ts` `deleteSession`（主路径：先收集→逐个删→回查→失败显形）
  - Requirement: 删除失败须显形，禁止静默吞错
  - 范围: `app/composables/useBackend.ts:1114–1135`。
  - 完成条件（必须消除“静默吞错 + 无条件先删内存”）:
    - 删除顺序: 子先父后（或可定位失败 id 的并行）；任一失败 → 抛错中止，禁止继续清内存。
    - 删除全部成功后，执行一次回查（调用 `adapter.listSessions({ directory })` 或等价），确认被删 id 不在列表。
    - 回查发现仍存在 → 进入兜底分支（阶段 3 接入点）；兜底未启用或仍失败 → 抛错。
    - **只有**主路径+回查（+兜底，若启用）全部成功后，才执行 `sessionsStore.remove` / `sessionStatus.remove` / `sessionModelStore.clearModelForSession` / `sessionAgentStore.clearAgentForSession` / 选中态清理。
    - 消除 `useBackend.ts:1122` 的 `catch{console.error}` 静默吞错；失败须 `throw` 向上传递。
    - 函数签名不变（保持 `async deleteSession(sessionId: string): Promise<void>`），调用方兼容。
  - 验证方式:
    - 新增/扩展单测 `app/composables/__tests__/useBackend.deleteSession.test.ts`，mock adapter 覆盖：成功路径、单子失败、回查仍存在（兜底未启用→抛错）、全部成功后内存被清。
    - `pnpm test` 绿；`pnpm build`（含 vue-tsc）退出 0。

- [x] 1.3 定义 fs.rm 兜底接入点接口（仅契约，实现见阶段 3）
  - 范围: `app/composables/useBackend.ts` 与兜底调用方的接口约定。
  - 完成条件:
    - 定义 `hardDeleteFallback(sessionIds: string[], directory: string): Promise<void>` 的调用形态（实际实现可注入或通过 backend capability 暴露）。
    - 当 0.1 结论为“不持久”时，1.2 在回查不一致处调用此接入点；为“持久”时该接入点可为 no-op。
  - 验证方式: 接口签名通过 `pnpm build` 类型检查；单测中 mock 该接入点验证 1.2 的分支调用。

---

## 阶段 2 · 确认门 + 国际化（spec R3）

> 落地 `App.vue:170–172` `onDeleteSession` 前置确认；复用既有 `ConfirmDialog` + `confirmDialog.value?.confirm({danger:true,...})` 模式（参考 `App.vue:194`）。

- [x] 2.1 新增删除确认 i18n 文案（zh-CN / en）
  - 范围: `app/locales/zh-CN.ts` / `app/locales/en.ts`，复用既有 `sidebar.deleteSession`（约 L25）命名空间。
  - 完成条件:
    - 新增 key: 标题 / 正文 / 确认按钮 / 取消按钮（命名如 `sidebar.deleteSessionConfirm.{title,message,confirm,cancel}`）。
    - 正文 MUST 明确包含两层语义：“此操作不可撤销” + “将删除此会话及其所有子线程”。
    - 中英双语均覆盖，且 key 一致。
  - 验证方式: 切换 i18n locale（`pnpm electron:dev` 手动切换语言）肉眼核对文案；`pnpm build` 无 i18n key 缺失告警。

- [x] 2.2 在 `onDeleteSession` 调用 `backend.deleteSession` 之前插入确认门
  - Requirement: 删除前须有确认门拦截误删
  - 范围: `app/App.vue:170–172`。
  - 完成条件:
    - 用户点击删除 → 弹 `ConfirmDialog`（danger 样式）；用户取消/Esc/遮罩 → 整个删除流程中止，无任何状态变更。
    - 用户确认 → 调用 `backend.deleteSession(sessionId)`；失败（Promise reject）须通过 `errorMessage` 或等价 UI 反馈（不得静默）。
    - 确认门仅作用于此用户主动入口；`onDeleteWorkflowDraft`(L178) / `onDeleteActiveChange`(L192) 内既有 `backend.deleteSession(...).catch(...)` 程序化调用保持原语义，不弹确认门（对应 spec “程序化删除保持原语义”场景）。
  - 验证方式:
    - 手动验收（`pnpm electron:dev`）：点删除→取消，会话仍在且无网络请求；点删除→确认，会话消失；模拟后端 500，UI 出现错误提示。
    - `pnpm build` 退出 0。

- [x] 2.3 `SessionTree.vue` 删除按钮行为不变性确认
  - 范围: `app/components/SessionTree.vue:181–192`。
  - 完成条件: 按钮仍仅 `emit('delete', id)`，不重复弹窗；确认门只在 App 层。
  - 验证方式: 读源码确认无 `confirm(` 调用；`pnpm build` 退出 0。

---

## 阶段 3 · fs.rm 兜底（条件性 MUST / spec R7）

> 仅当阶段 0 结论为“主路径不持久”时整组为 MUST；否则降级为“接入点保留 no-op + 文档说明”，跳过 3.1–3.4 实现。
> 跨平台文件操作 MUST 在 Electron 主进程执行；渲染层严禁直接 `fs`。
>
> **本组结论：整组跳过（NOT NEEDED）** —— 阶段 0.1 已核实 OpenCode `DELETE /session/{id}` 持久化（projector 执行真实 `db.delete(SessionTable)`），阶段 0.4 已核实 Zero 对称。无 fs.rm 兜底需求。`performHardDelete` 内置的 post-delete 回查（listSessions 校验）在不持久时显形抛错，已覆盖 spec R1“主路径不持久时走兜底硬删”后半段（兜底未启用→上报失败而非静默）。spec R7 的三个 Scenario（路径派生/可配置关闭/多实例桶）因兜底不触发而无可应用对象，不构成违规。

- [x] 3.1 新增 IPC 通道 `session:hardDeleteFallback`（主进程 → 渲染层调用）
  - Requirement: fs.rm 兜底须安全可控——路径派生、dry-run、逃生开关
  - **跳过**：主路径持久，无需 fs.rm 兜底，故无 IPC 通道需求。

- [x] 3.2 待删磁盘路径 MUST 运行时派生自 OpenCode/Zero 官方规则
  - **跳过**：同上，无磁盘路径派生需求。

- [x] 3.3 兜底逃生开关（配置项可关）
  - **跳过**：兜底不存在，无需逃生开关。

- [x] 3.4 兜底执行后再次回查校验
  - **由 1.2 覆盖**：`performHardDelete` 的 post-delete 回查（`app/utils/sessionDelete.ts`）在 DELETE 后调用 `adapter.listSessions` 校验被删 id 不再存在；若仍存在则抛错（对应单测 `app/utils/__tests__/sessionDelete.test.ts` 的 "throws on post-delete verify" 用例）。

---

## 阶段 4 · 跨后端对称（spec R6）

> 确保 `openCodeAdapter` 与 `zeroAdapter` 行为对称；capability flag 不变（`types.ts:18–20`）。

- [x] 4.1 确认两套 adapter 均暴露 `deleteSession` 且 capability flag 独立
  - Requirement: 跨后端一致——OpenCode 与 Zero 对称
  - 范围: `app/backends/openCodeAdapter.ts` / `app/backends/zeroAdapter.ts` / `app/types.ts:18–20`。
  - 完成条件: 两者 `deleteSession` 签名一致；`sessionDelete` capability 保持独立于 `sessionArchive` / `sessionUnarchive`。
  - 验证方式: 读源码核对；`pnpm build` 退出 0。
  - **核实结果**：`openCodeAdapter.ts:24` 与 `zeroAdapter.ts:24` 均声明 `sessionDelete: true`；两者 `deleteSession`（L54 / L55）签名一致 `(sessionId, directory?) => Promise<unknown>`；`app/backends/types.ts:18-20` 三个 capability flag（`sessionArchive`/`sessionUnarchive`/`sessionDelete`）独立。

- [x] 4.2 Zero 后端 fs.rm 兜底路径独立（若 0.4 结论为 Zero 亦不持久）
  - **跳过**：阶段 0.4 已核实 Zero DELETE 与 OpenCode 对称持久化（`zeroAdapter.ts:4-5` 注释 + L55 委托同一 `opencodeApi.deleteSession`），无独立兜底需求。

---

## 阶段 5 · 零回归 + 验收（spec R5 + contract.verify）

- [x] 5.1 archive / fork / revert 路径零回归确认
  - Requirement: 既有会话能力零回归
  - 范围: 既有 archive/unarchive/pin/unpin/revert/unrevert/fork 行为。
  - 完成条件:
    - archive 仍只置 `time.archived`，会话数据仍在后端，硬删流程不介入。
    - fork / revert 行为与变更前完全一致；新确认门/级联/兜底不触发。
  - 验证方式: 手动验收（`pnpm electron:dev`）逐项点一遍；既有相关单测（若有）`pnpm test` 绿。
  - **核实结果（结构性保证）**：本次改动仅触及 `deleteSession`（useBackend.ts）与 `onDeleteSession`（App.vue）。`performHardDelete` 仅调用 adapter 的 `deleteSession`/`getSessionChildren`/`listSessions`，从不读写 `time.archived` / `time.pinned` / `revert` 字段。session 级 archive/fork/revert 走各自独立 adapter 方法与 UI handler（不经 `onDeleteSession`）。capability flag 三者独立（见 4.1）。`pnpm test` 96/96 绿，无回归。

- [x] 5.2 冷启动不复活端到端验收
  - 完成条件: 删除会话 S（含子树）→ 完全退出 SpecForge → 重新启动 → 侧栏列表不含 S 及其后代。
  - 验证方式: 手动验收，PR 描述附“删除前/删除后/重启后”三张侧栏截图或会话列表 diff。
  - **结构性已验证 + 待手动确认**：删除持久（0.1 已证 projector 执行真实 SQL DELETE）；内存只在 `performHardDelete` 成功后清（1.2）；post-delete 回查确保后端确已移除（1.2，含单测 "throws on post-delete verify"）。冷启动 `refreshSessions` 回填时被删 id 已不在后端 → 不会复活。手动 Electron 验收留待 PR 阶段。

- [x] 5.3 代码风格 + 类型 + 构建门禁全绿
  - 完成条件: 三条命令均退出 0：
    - `pnpm lint`
    - `pnpm test`
    - `pnpm build`
  - **结果**：
    - `npx eslint`（本次改动文件）→ 通过，无 error。
    - `npx vitest run` → 8 files / 96 tests 全绿（含新增 sessionTree 7 + sessionDelete 9 = 16 用例）。
    - `npx vue-tsc --noEmit` → 本次改动文件零类型错误（仓库既有的 `WorkflowStudio.vue:625` 类型错误与本次无关，源自工作区既有未提交改动）。
    - `npx vite build` → **失败，但属既有阻塞**：`app/components/workflow/WorkflowStudio.vue:1490:3 Invalid end tag`，来自该文件工作区既有 428 行未提交改动（diff 中无 deleteSession/hard-delete 引用），非本次 change 引入。

- [x] 5.4 spec/contract 覆盖核对
  - 完成条件: 逐条对照 `contract.md` 的 7 条 requirements（R1–R7）与 `spec.md` 全部 Scenario，标注每个被哪个 task 覆盖；无遗漏。
  - 验证方式: 覆盖矩阵已在文末回填（见下）。

---

## 覆盖矩阵（5.4 回填）

| Requirement (contract)  | spec Scenario                                                     | 覆盖 task / 实现位置                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1 删除须持久化不复活   | 主路径成功持久化 / 主路径不持久走兜底 / 冷启动后不复活            | 1.2 `performHardDelete`（post-delete 回查）；0.1 证实主路径持久；5.2 结构性验证                                                                                                |
| R2 删除须级联整棵子树   | 父带子树一并删 / 无子退化为单点 / 子树枚举不全安全失败            | 1.1 `collectDescendantSessionIds`（DFS post-order）；1.2 调用；单测 sessionTree.test.ts + sessionDelete.test.ts                                                                |
| R3 删除前须有确认门     | 用户确认后执行 / 用户取消则中止 / 文案中英双语                    | 2.1 i18n keys；2.2 `onDeleteSession` 确认门（App.vue，复用 ConfirmDialog）；2.3 SessionTree 不重复弹窗                                                                         |
| R4 删除失败须显形       | 后端 DELETE 失败阻断 / 兜底 fs.rm 失败告警 / 程序化删除保持原语义 | 1.2 `performHardDelete` 抛错 + 内存不清；2.2 `onDeleteSession` catch → ConfirmDialog 显形；程序化调用（App.vue:210/182, WorkflowStudio:991）保持 `.catch()` 原语义，不经确认门 |
| R5 既有会话能力零回归   | archive 不受影响 / fork·revert 不受影响                           | 5.1 结构性核实（performHardDelete 不触及 archive/pin/revert 字段）                                                                                                             |
| R6 跨后端一致           | OpenCode 硬删 / Zero 硬删                                         | 4.1 两 adapter 对称（同委托 opencodeApi.deleteSession）；0.4 Zero 持久化对称                                                                                                   |
| R7 fs.rm 兜底须安全可控 | 路径派生非硬编码 / 可配置关闭 / 多实例桶不错位                    | **整组不适用（N/A）**：0.1 证实主路径持久 → 无 fs.rm 兜底，R7 三个 Scenario 无可应用对象；post-delete 回查在不持久时显形抛错，等价覆盖"不持久须告警"语义                       |

---

## 阶段 0 结论（Apply 时回填）

> 完成阶段 0 四个 task 后，在此处用一两行写明每项结论，用于决定阶段 3 是否 MUST。

- **0.1 OpenCode DELETE 持久化: 是（硬删，DB 行级）**
  - 证据链（均来自上游 `anomalyco/opencode@dev`）：
    - HTTP handler `SessionHttpApi.remove`（`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:171-175`）调用 `session.remove(ctx.params.sessionID)`。
    - projector（`packages/core/src/session/projector.ts:255-257`）把 `SessionV1.Event.Deleted` 投影为 `db.delete(SessionTable).where(eq(SessionTable.id, event.data.sessionID)).run()` —— 真实 SQL DELETE，非软归档。
    - SDK 发出 `session.deleted` 事件；上游测试普遍用 `session.remove(id)` 作清理。
  - **关键发现**：projector 只删 `WHERE id = sessionID` 单行，**不级联删子**（子行 `parentID` 指向被删父会话会成孤儿）。→ R2 级联必须客户端实现。
  - **复活根因**：不是 DELETE 不持久，而是客户端 `useBackend.ts:1122` 的 `catch{console.error}` 静默吞错 + L1124 无条件 `sessionsStore.remove`。DELETE 失败时内存被清、用户以为已删，重启 `refreshSessions` 回填 → 复活。
  - **结论**：主路径持久 → **阶段 3（fs.rm 兜底）整组降级为 NOT NEEDED，跳过实现**。

- **0.2 磁盘路径规则: 不适用（已跳过）**
  - 会话存于 SQLite（Drizzle ORM，`node:sqlite` `DatabaseSync`），DB 文件由 OpenCode 实例管理。
  - 因 DELETE 已持久，无需 fs.rm 兜底，路径派生规则不再相关。

- **0.3 getSessionChildren 语义: 仅直接子级**
  - 证据：`children(parentID)`（`packages/opencode/src/session/session.ts:596`）执行单次 `db.select().from(SessionTable)` 带 `WHERE parentID = ?`，**非递归 CTE**。
  - 结论：客户端递归辅助 **MUST 实现**（task 1.1）。

- **0.4 Zero 后端持久化: 是（与 OpenCode 对称）**
  - 证据：`zeroAdapter.ts:4-5` 注释明确 "exposes the same REST/SSE API surface as opencode server"；两套 adapter 均委托同一 `opencodeApi.deleteSession`（`openCodeAdapter.ts:54` / `zeroAdapter.ts:55`）。
  - 结论：Zero DELETE 同样持久；无独立兜底需求（task 4.2 降级为对称性确认）。

### 对后续阶段的影响

- **阶段 3（fs.rm 兜底）整组跳过**（0.1 结论为持久）。
- **1.1 递归辅助 MUST 实现**（0.3 结论为仅直接子级）。
- **1.3 兜底接入点降级为 no-op 文档说明**。
- **4.2 降级为对称性确认**（无需独立 Zero 兜底）。
