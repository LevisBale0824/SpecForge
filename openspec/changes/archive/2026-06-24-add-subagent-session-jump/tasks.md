## 1. 子会话 ID 提取工具函数

- [x] 1.1 在 `app/components/ToolWindow/utils.ts` 新增 `extractSubSessionId(tool, state)`：当 `tool` 为 `task`/`batch` 时，依次尝试 `metadata.sessionId` → `metadata.session_id` → `metadata.subSessionID` → 正则匹配 `state.output` 中的 `task_id:\s*(<id>)`；返回 `{ sessionId, inferred: boolean }` 或 `undefined`
- [x] 1.2 新增 `matchChildSession(parentSessionId, candidates, toolTime)` 兜底匹配函数：从子会话候选（`parentID === parentSessionId`）中按 `time.created` 最接近 `toolTime` 且未被占用者选取
- [x] 1.3 在 `app/components/ToolWindow/utils.test.ts`（或 `__tests__`）为两条函数补单测：覆盖主路径、各兜底 key、output 正则、parentID 匹配、全部失败返回 undefined

## 2. MessageContent.vue 渲染跳转入口

- [x] 2.1 `MessageContent.vue` 新增 `defineEmits<{ 'navigate-session': [sessionId: string] }>()`
- [x] 2.2 在 `inlineBlocks` 构建处，为 `kind:"tool"` block 计算并附带 `subSessionId`（主路径）；`DisplayBlock` 的 tool 变体与 `ToolBlock` 类型相应扩展
- [x] 2.3 单工具 chip（`:390-445`）：当 `block.tool` 为 task/batch 且有 subSessionId 时，在标题区渲染独立可点击元素（下划线标题 + ↗ 图标），`@click.stop="emit('navigate-session', subSessionId)"`
- [x] 2.4 分组展开后的子 chip（`:480-531`）同样条件渲染跳转入口
- [x] 2.5 兜底匹配（inferred=true）时给跳转入口加 hover title 提示"推测匹配的子会话"
- [x] 2.6 运行中（status=running）的 task 也启用跳转入口

## 3. 事件透传与会话切换接线

- [x] 3.1 `ChatView.vue` 声明 `defineEmits<{ 'navigate-session': [sessionId: string] }>()`，在两处 `<MessageContent>`（`:144`、`:156`）加 `@navigate-session="$emit('navigate-session', $event)"`
- [x] 3.2 `App.vue` 渲染 `<ChatView>` 处加 `@navigate-session="onSelectSession"`，复用 `:129` 既有逻辑
- [x] 3.3 验证跳转后 `SessionTree.vue:91-102` 的 watch 自动展开父节点并高亮子项（无需改代码，仅验证）

## 4. 国际化与边界

- [x] 4.1 在 `app/locales/zh-CN.ts` 与 `app/locales/en.ts` 新增跳转入口 title、兜底匹配提示文案
- [x] 4.2 目标子会话 ID 在本地 `useSessions` 不存在时安全降级（不崩溃，可提示"会话尚未就绪"）—`selectSession` 已 try/catch 包裹，满足

## 5. 验证

- [x] 5.1 `pnpm typecheck` + `pnpm lint` 通过
- [x] 5.2 `pnpm test`（新增 18 个单测，全套 64 通过）通过
- [x] 5.3 手动验证：主 agent 派发 task 子 agent，从消息流 chip 点击跳转到子会话；侧边栏同步展开高亮
- [x] 5.4 手动验证：中断 task（metadata 缺失）走兜底路径；非 task 工具无跳转入口
