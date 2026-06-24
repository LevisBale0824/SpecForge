## Context

SpecForge 是 opencode CLI 的 Electron+Vue 前端。主 agent 通过 `task`/`batch` 工具派发子 agent 时：

- opencode 的 `task` 工具在成功路径返回 `metadata: { sessionId: <子会话ID>, model }`（见 `packages/opencode/src/tool/task.ts`，issue #13910 引用）。
- 子会话本身带 `parentID` 指向父会话（`app/types/sse.ts:115`），侧边栏 `SessionTree.vue` 已据此把子会话渲染为父会话的可展开子节点。
- 当前会话切换入口：`App.vue:129` 的 `onSelectSession` → `backend.selectSession(id)`；`SessionTree.vue` 子项点击 `emit('select', child.id)` 已可跳转。
- 工具调用在 `MessageContent.vue` 渲染为 chip（单工具 `:390-445`、分组展开子项 `:480-531`），当前 chip 的 `<button>` 仅用于展开/收起输出，无任何 emit。
- `ToolStateCompleted.metadata` 为 `Record<string, unknown>`（`sse.ts:48`），可直接读取 `sessionId`，无需改类型。

数据缺口：全代码库从未提取过 `metadata.sessionId`（grep 无匹配），需新增提取逻辑。

## Goals / Non-Goals

**Goals:**

- 在消息流的 `task`/`batch` 工具 chip 上提供"一键跳转到子会话"的交互。
- 主路径（`metadata.sessionId` 存在）精确跳转；兜底路径（中断/abort 导致 metadata 丢失）尽力匹配。
- 复用现有会话切换机制（`backend.selectSession` + 侧边栏自动展开父节点 watch），不引入新的导航栈。

**Non-Goals:**

- 不在 chip 内联展开子会话的完整对话（仍在子会话页查看）。
- 不修改 opencode 端 task 工具（中断丢 ID 是 opencode 已知 bug，本变更只做前端兜底）。
- 不为 `task`/`batch` 以外的工具启用跳转。
- 不做子会话实时进度嵌套展示（属另一特性）。

## Decisions

### 决策 1：子会话 ID 提取——主路径 + 兜底路径

- **主路径**：从 `ToolStateCompleted.metadata.sessionId` / `ToolStateRunning.metadata.sessionId` 读取。这是 opencode 官方契约，最精确。
- **兜底路径**：当中断/abort 使 `metadata` 仅含 `{ interrupted: true }` 而无 `sessionId` 时，从 `useSessions()` 按 `s.parentID === 当前会话id` 过滤子会话，取与该 task 工具 chip **时间最接近**（tool 完成时间 vs 子会话 `time.created`）且尚未被其他 chip 占用者。
- **备选方案（否决）**：仅在侧边栏手动找子会话——体验割裂，正是本变更要消除的痛点。
- **备选方案（否决）**：调用 `GET /session/{parentID}/children` 远程拉取——`useSessions` 已持有本地子会话列表，无需额外网络请求；仅当本地缺失时才考虑（列为开放问题）。

### 决策 2：交互形态——chip 标题可点击，与展开动作分离

- 现有 chip 整个 `<button>` 负责展开/收起。若让整个 chip 跳转，会破坏既有展开交互。
- **方案**：仅当工具是 `task`/`batch` 且解析出子会话 ID 时，在标题区域渲染一个**独立的可点击元素**（如标题文字带下划线 + 一个 ↗ 跳转图标按钮），`@click.stop` 触发跳转，不影响外层展开按钮。
- 运行中（status=running）的 task 也允许跳转——子会话可能已在产生消息，用户可实时查看。

### 决策 3：事件透传链路

- `MessageContent.vue` 新增 `defineEmits<{ 'navigate-session': [sessionId: string] }>()`。
- `ChatView.vue`（`:144`/`:156` 渲染 MessageContent 处）透传 `@navigate-session="$emit('navigate-session', $event)"`，并自身声明同名 emit。
- `App.vue` 渲染 ChatView 处 `@navigate-session="onSelectSession"`，复用 `:129` 既有逻辑。选中子会话后 `SessionTree.vue:91-102` 的 watch 自动展开父节点并高亮。

### 决策 4：ID 提取函数放 ToolWindow/utils.ts

- `extractSubSessionId(tool, state, ctx?)` 与现有 `extractCommand`、`formatReadLikeToolTitle` 等同层，保持工具解析逻辑集中、可单测。
- 兜底匹配需要"当前会话 id + 子会话候选列表"，通过参数注入（不直接耦合 store），便于测试。

## Risks / Trade-offs

- **[兜底匹配可能错配]** 多个并发 task 同时中断时，按时间最近匹配可能选错子会话。→ 缓解：仅当主路径 `metadata.sessionId` 缺失才启用兜底；错配只影响"跳到哪个子会话"，不影响数据正确性；可在 chip hover 提示标明"推测匹配"。
- **[metadata 字段名不确定性]** opencode 用 `sessionId`（camelCase），但不同版本/适配器可能用 `session_id`。→ 缓解：提取函数兼容 `sessionId` / `session_id` / `subSessionID` 多种 key；并通过 `output` 文本里的 `task_id: <id>` 正则作为第三道兜底。
- **[事件冒泡新增 emit 链]** 三层组件加 emit 略显繁琐。→ 权衡：保持单向数据流与组件可测试性，优于直接在深层组件调全局 store。
- **[opencode 上游修复后兜底成死代码]** 若 opencode 修复中断路径始终返回 sessionId，兜底逻辑将极少触发。→ 可接受：兜底是无害的防御性代码，保留即可。

## Open Questions

- 本地 `useSessions()` 未持有某子会话（例如刚中断、SSE 未送达）时，是否要补一次 `GET /session/{parentID}/children` 远程拉取？倾向"先不做，观察实际命中率"。
- 是否需要 i18n 文案（跳转按钮 title、兜底匹配提示）？倾向加入 `app/locales/{en,zh-CN}.ts`。
