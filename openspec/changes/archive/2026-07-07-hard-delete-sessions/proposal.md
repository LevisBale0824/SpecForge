# proposal — 真正删除会话历史（hard-delete-sessions）

> 阶段: Propose · 档位: standard · change: `hard-delete-sessions`
> 上游依据: `brainstorm.md`（已逐条经直接读源码核实，见 Context Basis）
> 下游消费者: Apply（拆 tasks）/ Verify（检查 SHALL/MUST 覆盖）/ Review

---

## Why

用户删除会话后，冷启动会话**复活**——删除只在内存生效，重启后 `refreshSessions()` 回填列表时被删会话重新出现。本变更把"删除"从**前端隐藏**升级为**可持久化的硬删除**（含子线程级联），并补齐确认门与失败显形，让"删除即消失"成立且可验收。

> **Intent Lock**：本次只解决"删了又回来"与"删错没提示"两类用户痛点。任何偏离此意图的扩展（回收站、批量删、同步等）一律由 Out of Scope 拦截，转后续独立 change。

---

## What Changes

涉及文件 / 模块（路径相对仓库根）：

- `app/composables/useBackend.ts`
  - `deleteSession()`（L1114–1135）：重写——先递归收集子树，主路径逐个 `DELETE`，验证不持久则走兜底；失败须显形，**禁止**无条件先删内存。
  - `refreshSessions()`（L514–534）：不改逻辑，但作为验证锚点（删除后该会话不应再出现在其回填结果中）。
- `app/App.vue`
  - `onDeleteSession()`（L170–172）：在调用 `backend.deleteSession` **之前**插入 `ConfirmDialog` 确认门（复用既有 `confirmDialog.value?.confirm(...)` 模式，参考 L194 的 `onDeleteActiveChange`）。
- `app/components/SessionTree.vue`
  - 删除按钮（L181–192）：行为不变（仍 `emit('delete', id)`），确认门下沉到 App 层统一处理，组件不重复弹窗。
- `app/backends/openCodeAdapter.ts` / `app/backends/zeroAdapter.ts`
  - capability 表（`sessionDelete` 等）保持不变；确保两套 adapter 对 `deleteSession` 对称覆盖（已确认两者都暴露）。
- `app/utils/opencode.ts`
  - `deleteSession`（L312）、`getSessionChildren`（L297）：被 `useBackend` 复用，可能需新增"递归取全部后代"的辅助（若 `getSessionChildren` 仅返回直接子级）。
- `electron/main.ts` + `electron/preload.cjs`（**仅当主路径证实不持久时**）
  - 新增 IPC 通道（如 `session:hardDeleteFallback`），主进程内 `fs.rm` 对应实例的磁盘会话存储；渲染层通过 IPC 调用，严禁在渲染进程直接 `fs`。
  - 复用 `electron/paths.ts`、`electron/instanceCoordinator.ts`、`electron/serverPool.ts` 定位正确实例的存储桶。
- `app/locales/zh-CN.ts` / `app/locales/en.ts`
  - 新增删除确认文案 key（确认对话框标题/正文/按钮），沿用既有 `sidebar.deleteSession`（L25）的命名空间。

---

## Out of Scope

- 不实现回收站 / tombstone / undo toast（用户已否决，选确认对话框）
- 不修改 archive / unarchive 语义（archive 仍为软删可恢复，与硬删是两条独立路径）
- 不实现批量删除 / "清空全部历史"（本次仅单个含级联）
- 不重构 `serverPool` / `instanceCoordinator` 多实例路由（除非证实根因是打错实例）
- 不做跨设备 / 云同步删除（单机桌面场景）
- 不改动 `useTaskRunner.ts` 的 `cliBridge.deleteSession` 路径（L60/65/99/103，属 CLI Bridge 独立链路，不走 `backend.deleteSession`，本次不触及）
- 不引入新依赖、不改构建配置

---

## Capabilities

| Capability         | 变更类型  | 说明                                                                      |
| ------------------ | --------- | ------------------------------------------------------------------------- |
| `session-deletion` | **ADDED** | 新增契约层：定义"硬删除 + 级联 + 确认门 + 失败显形 + 不复活"的可验收 spec |

> 既有 `subagent-session-navigation`、`app-update` 两个 capability 不受本次影响。`session-deletion` 为本次新建 capability 目录，spec delta 见 `specs/session-deletion/spec.md`。

---

## Context Basis

> 逐条可追溯，标注来源类型（直接读源码 / brainstorm 硬约束 / 用户原话）。

- **[源码]** `useBackend.ts:1114–1135` `deleteSession`：`try{await adapter.deleteSession(...)}catch{console.error}` 后**无条件** `sessionsStore.remove`——证实"静默吞错 + 内存先删"是复活根因之一。
- **[源码]** `useBackend.ts:514–534` `refreshSessions`：`adapter.listSessions({ directory })` **未传任何 archived/excluded 过滤**——证实冷启动回填会重新带回后端仍存在的会话，是复活根因之二。
- **[源码]** `opencode.ts:312–321` `deleteSession` → HTTP `DELETE /session/{id}`；`opencode.ts:297–303` `getSessionChildren` → `GET /session/{id}/children`（返回结构待 Apply 核实是否需递归）。
- **[源码]** `types.ts:18–20` `sessionArchive` / `sessionUnarchive` / `sessionDelete` 为三个独立 capability flag——证实 adapter 设计上把 delete 视为硬删，archive 是独立语义。
- **[源码]** `useSessions.ts:22–27` `remove(id)`：仅 mutate in-memory `Map`，无持久化——证实前端隐藏≠删除。
- **[源码]** `App.vue:170–172` `onDeleteSession`：直接 `backend.deleteSession(sessionId)`，**无确认门**；而 L194–201 `onDeleteActiveChange` 已用 `confirmDialog.value?.confirm({danger:true,...})`——证实组件可复用、模式可借鉴。
- **[源码]** `useTaskRunner.ts:60/65/99/103`：用的是 `cliBridge.deleteSession`（CLI Bridge 链路），**不是** `backend.deleteSession`——故本次不触及，列入 Out of Scope。
- **[brainstorm 硬约束]** 用户明确否决"纯前端黑名单过滤"方案，要求数据从磁盘物理抹除（α 真硬删）。
- **[brainstorm 硬约束]** 用户明确要求级联递归删除子线程，避免孤儿数据。
- **[brainstorm 决策表]** D3 选确认对话框、D6 选"失败须阻断并提示"——本 spec 据此固化为 SHALL。

---

## Impact

- **向后兼容**：`DELETE /session/{id}` 端点与 capability flag 已存在，调用方签名不变；新增的确认门仅作用于用户主动删除入口，程序化删除（如 change 清理时的 `backend.deleteSession` 在 L210/182 已自带 `.catch`）保持原有 fire-and-forget 语义，不受确认门影响。archive / pin / revert / fork 路径零改动。
- **不可逆性**：硬删一旦成功（含 fs.rm 兜底）数据不可恢复——故确认门为强约束（SHALL），且级联范围须在文案中明示。
- **性能**：级联删除需先递归枚举子树（一次 `getSessionChildren` 递归或多次调用），单次删除 latency 略增；子树规模通常 ≤ 数十，可接受。
- **迁移路径**：无需数据迁移——既有"已删除但未持久"的会话，用户首次执行新删除流程时即被真正抹除；不做历史遗留扫描清理（避免误删）。
- **上游依赖风险**：OpenCode `DELETE` 真实语义（硬删/软归档/no-op）待 Apply 核实；若不持久，启用 fs.rm 兜底。兜底路径的存储定位规则 MUST 派生自 OpenCode 官方路径，严禁硬编码（见 spec R5）。
- **逃生开关**：fs.rm 兜底 SHOULD 提供配置项可关，应对上游版本漂移（见 spec R6）。

---

## 待 Apply 核实的阻塞项（不阻塞本 spec 落盘）

> 这些是 HOW 层细节，不影响 WHAT 契约；Apply 阶段第一组任务须先回答。

1. OpenCode `DELETE /session/{id}` 真实持久化行为（决定走主路径或 fs.rm 兜底）。
2. OpenCode 各平台会话磁盘存储路径 + project→实例桶映射规则（fs.rm 兜底前置条件）。
3. `getSessionChildren` 返回直接子级还是全量后代（决定是否需递归辅助）。
4. Zero 后端 DELETE 是否同样持久；不持久时兜底是否对称覆盖。
