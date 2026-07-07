# brainstorm — 真正删除会话历史

> change: `hard-delete-sessions` · 档位: standard · 阶段: Explore
> 下游消费者: Propose 据此固化为 proposal

---

## 背景 / 问题

当前"删除会话"在冷启动后会**复活**——用户删除后重新打开 SpecForge,被删的会话又出现在侧栏。

经代码追踪,现有删除链路:

```
SessionTree.vue:185 (delete btn)
  └─► emit('delete', id)
        └─► App.vue:170 onDeleteSession
              └─► useBackend.ts:1114 deleteSession(id)
```

`useBackend.deleteSession` 干了三件事:

1. `await adapter.deleteSession(id, dir)` → OpenCode `DELETE /session/{id}` HTTP(`opencode.ts:312`)
2. `try/catch` **静默吞错**(仅 `console.error`,`useBackend.ts:1122`)
3. **无条件**从内存 `sessionsStore` 移除(`useSessions.ts:22 remove`)

而冷启动时 `refreshSessions()`(`useBackend.ts:514`)会重新 `GET /session` 回填列表——**未传任何 archived 过滤**。于是只要后端仍返回该会话,它就"复活"。

**根因判定**:`adapter` 把 `sessionDelete` 与 `sessionArchive`/`sessionUnarchive` 声明为**三个独立 capability**(`openCodeAdapter.ts:22-24`),说明 `DELETE` 本应是硬删。但实测它没有产生"重启后仍不可见"的持久状态。具体是 (a) 调用方 bug / 打错实例,还是 (b) 端点本身行为不符 —— **交 Propose 阶段核实**(见"待澄清 #1")。

```
┌─────────────────────────────────────────────────────────────┐
│  点删除 ─► backend.deleteSession(id)                        │
│                  │                                          │
│      ┌───────────┴────────────┐                             │
│      ▼ (try)                  ▼ (无论成败,无条件执行)       │
│  DELETE /session/{id}     sessionsStore.remove(id)          │
│  ⚠ 静默 catch                ← 内存立刻"消失"               │
│      │                                                      │
│      ✗ 后端不持久化(或归档/或打错实例)                      │
│      │                                                      │
│  ══════════════════════════════════════════════════════════ │
│  冷启动 ─► refreshSessions() ─► GET /session                │
│           ─► 会话又回来了 ✗                                 │
│  ══════════════════════════════════════════════════════════ │
```

---

## 利益相关方

- **SpecForge 终端用户**(单人桌面场景):期望"删除即消失",隐私/数据卫生诉求。
- **维护者**:须保证不误删其他会话、不破坏 archive/pin/revert/fork 等既有功能。
- **OpenCode 上游**(sst/opencode):若 `DELETE` 端点本身有 bug,属上游范畴,SpecForge 只能兜底。

---

## 硬约束

1. **真硬删(α)** — 数据须从磁盘物理移除,不只是前端隐藏。用户明确否决"黑名单过滤"的纯前端方案(β)。
2. **优先用 OpenCode 自带 API** — adapter 已声明 `sessionDelete: true`,端点存在;优先修调用,Electron 主进程 `fs.rm` 仅作兜底。
3. **级联删除子线程** — 删父会话须连带删 subagent / fork 子会话(递归)。现有 `useBackend.deleteSession` **不做级联**,只删单个 id,必须补齐。
4. **不破坏既有** — archive / unarchive / pin / revert / fork 等独立 capability 不受影响。
5. **跨后端一致性** — OpenCode(13284)与 Zero(13286)两套 adapter 都暴露 `deleteSession`,改动须对称覆盖(或明确只动其一并说明理由)。
6. **Electron 主进程边界** — 若需 `fs.rm` 兜底,文件操作只能在主进程,渲染层走 IPC;须先摸清 OpenCode 各平台会话存储路径与 project→实例映射。

---

## 非目标 (Out of Scope)

- ❌ **不实现回收站 / 撤销 toast** — 用户选确认对话框(a),否决 tombstone+undo(b)。
- ❌ **不改 archive 语义** — archive 仍是软删/可恢复,与本次硬删是两条独立路径。
- ❌ **不批量删除 / 不"清空全部历史"** — 本次只改单个(含级联)删除路径。
- ❌ **不重构 serverPool / instanceCoordinator 多实例路由** — 除非证实根因就是打错实例。
- ❌ **不做跨设备同步删除** — 单机桌面场景,无云同步。

---

## 关键决策

| #   | 决策点     | 选择                                       | 理由                                                                  |
| --- | ---------- | ------------------------------------------ | --------------------------------------------------------------------- |
| D1  | 删除语义   | **α 真硬删**(磁盘抹除)                     | 用户明确;隐私诉求                                                     |
| D2  | 子线程处理 | **级联递归删除**                           | 用户明确;避免孤儿数据                                                 |
| D3  | 安全 UX    | **a 确认对话框**                           | 不可逆+级联,误删代价高;复用现有 `ConfirmDialog`(`App.vue:194` 已在用) |
| D4  | 实现主路径 | **优先修 OpenCode DELETE 调用**            | 用户要求先试官方 API;改动最小、最不易误伤                             |
| D5  | 兜底路径   | **API 不持久化时,主进程 `fs.rm` 磁盘存储** | 保证 α 成立的最后一道防线                                             |
| D6  | 错误处理   | **不再静默吞错,失败须阻断并提示**          | 当前 `catch` 仅 `console.error` 是 bug 之一                           |

### 目标态删除流

```
点删除
  ▼
ConfirmDialog("删除此会话及其所有子线程?此操作不可撤销。")
  ▼ 取消 ─► 中止
  ▼ 确认
递归枚举子会话(getSessionChildren) 收集整棵子树 id 集
  ▼
[主路径] 对每个 id 调 DELETE /session/{id}
   ├─ 成功 ─► sessionsStore / status / model / agent 清除该 id
   └─ 失败或不持久 ──► [兜底 D5] IPC ─► 主进程 fs.rm 对应磁盘存储
                          ▼
                      回查 GET /session 确认已无该 id,否则告警上报
```

---

## 风险

- **R1 误删(最高)** — `fs.rm` 路径算错会带走其他会话/项目数据。必须用 OpenCode 官方路径派生规则,**严禁硬编码**;Apply 阶段先 dry-run 打印待删路径、人工核对再落真删。
- **R2 多实例错位** — OpenCode 按 project 路径起独立实例(`instanceCoordinator`),会话存储按 project 分桶。兜底删除必须定位到**正确实例的桶**。
- **R3 子树枚举不全** — `getSessionChildren`(`opencode.ts:297`)若只返回直接子级,须递归到底;若后端有 descendant 全量 API 优先用。
- **R4 与既有删除点冲突** — `useTaskRunner.ts:60,65,99,103`、`SidePanel.vue`、`App.vue:178 onDeleteWorkflowDraft`、`App.vue:192 onDeleteActiveChange` 已各自调 `deleteSession` 删 stage/workflow 绑定会话。新级联逻辑须与之不重复删、不互相踩。
- **R5 上游行为漂移** — OpenCode 版本升级可能改 DELETE 语义或存储路径;`fs.rm` 兜底需版本探测或逃生开关(配置项可关)。
- **R6 确认对话框的 i18n** — 现有 `ConfirmDialog` 已支持,文案须补 `app/locales/{zh-CN,en}.ts`。

---

## 待澄清 (交 Propose / Apply 核实)

1. **[阻塞]** OpenCode `DELETE /session/{id}` 真实行为:硬删?软归档?no-op?——决定走 D4(修调用)还是 D5(主进程兜底)。已验证 adapter 把 delete/archive 视为不同 capability,端点应存在;精确语义待查 sst/opencode 源码与文档。
2. **[阻塞]** OpenCode 各平台会话存储路径(Windows `%LOCALAPPDATA%`/`%APPDATA%`?macOS `~/Library/Application Support`?Linux `~/.local/share`?)及 project→存储桶映射规则。D5 兜底的前置条件。
3. 子会话树获取:`getSessionChildren` 返回直接子级还是全部后代?需递归?
4. Zero 后端的 `DELETE` 是否同样不持久化?若是,改动是否对称覆盖?
5. 删除确认文案的最终措辞(中/英)。
