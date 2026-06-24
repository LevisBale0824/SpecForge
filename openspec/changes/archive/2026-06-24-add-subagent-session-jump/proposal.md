## Why

当主 agent 通过 `task`/`batch` 工具派发子 agent 时，消息流里仅显示一个可展开的工具 chip，用户无法从这里直接进入子 agent 的会话。要看子会话的完整对话，必须手动打开侧边栏、展开父节点、再点子项——这割裂了"派发→查看结果"的工作流。opencode 的 `task` 工具本身已在 `metadata.sessionId` 中携带了子会话 ID，SpecForge 目前完全没有使用它。

## What Changes

- 消息流中的 `task`/`batch` 工具 chip 标题变为可点击：点击即切换到对应子 agent 会话（复用现有 `backend.selectSession`）。
- 从工具状态中提取子会话 ID：优先 `state.metadata.sessionId`（成功路径），缺失时（中断/abort，opencode 已知 bug #22348/#13910）用 `parentID` + 子会话列表兜底匹配。
- 视觉上区分可跳转的 chip（如标题加下划线/箭头图标/hover 提示），与普通展开 chip 区分开。
- 仅 `task`/`batch` 类工具启用跳转；其他工具行为不变。

## Capabilities

### New Capabilities

- `subagent-session-navigation`: 从消息流中的子 agent 工具调用直接跳转到其子会话的能力，包括子会话 ID 的提取（主路径 + 兜底路径）与导航交互。

### Modified Capabilities

<!-- 无已有 spec 被修改（openspec/specs/ 当前为空）。 -->

## Impact

- **代码**：`app/components/MessageContent.vue`（新增 emit + chip 点击逻辑 + ID 提取）、`app/components/ToolWindow/utils.ts`（新增 `extractSubSessionId` 辅助函数）、`app/components/ChatView.vue`（透传 emit）、`app/App.vue`（接到 `onSelectSession`）。
- **数据**：依赖 opencode `task` 工具返回的 `metadata.sessionId`；兜底依赖 `useSessions()` 中按 `parentID` 过滤的子会话（`SessionTree.vue` 已有相同逻辑）。
- **类型**：`ToolStateCompleted.metadata` 已是 `Record<string, unknown>`，无需改类型；可能新增一个 narrow 后的子会话 ID 提取工具的返回类型。
- **向后兼容**：纯增量，无破坏性变更；未派生子 agent 时行为完全不变。
