## ADDED Requirements

### Requirement: 子 agent 工具调用 chip 可跳转到子会话

当消息流中出现 `task` 或 `batch` 工具调用，且能解析出其派发的子会话 ID 时，该工具 chip MUST 提供一个可点击的跳转入口，点击后切换到对应子会话。仅 `task`/`batch` 工具启用跳转，其他工具行为不变。

#### Scenario: 成功完成的 task 工具可跳转

- **WHEN** 一个 `task` 工具调用状态为 `completed`，且其 `state.metadata.sessionId` 存在
- **THEN** 该工具 chip 渲染一个可点击的跳转入口（如带 ↗ 图标的标题）
- **AND** 点击该入口触发会话切换到 `metadata.sessionId` 指向的子会话

#### Scenario: 运行中的 task 工具也可跳转

- **WHEN** 一个 `task` 工具调用状态为 `running`，且其 `state.metadata.sessionId` 已出现
- **THEN** 该工具 chip 同样提供跳转入口
- **AND** 点击后切换到正在运行子会话，用户可实时查看其消息流

#### Scenario: 非 task/batch 工具不启用跳转

- **WHEN** 工具名为 `read`/`bash`/`edit`/`grep` 等非 `task`/`batch` 工具
- **THEN** 该 chip 不渲染任何跳转入口，展开/收起行为与现状完全一致

#### Scenario: 跳转入口不干扰展开动作

- **WHEN** 用户点击 task 工具 chip 的跳转入口
- **THEN** 仅触发会话跳转，不触发展开/收起输出面板（事件不冒泡到外层展开按钮）

#### Scenario: 跳转后侧边栏同步展开父节点并高亮

- **WHEN** 用户从 chip 跳转到子会话
- **THEN** 活动会话切换为该子会话
- **AND** 侧边栏自动展开其父会话节点并高亮该子会话项

### Requirement: 子会话 ID 解析的多路径兜底

系统 MUST 优先从工具的 `metadata.sessionId` 解析子会话 ID；当主路径缺失时（中断/abort），SHALL 依次尝试 `metadata` 的其他常见 key、`output` 文本中的 `task_id:` 标记、以及按 `parentID` + 时间的子会话匹配。

#### Scenario: 主路径——metadata.sessionId 存在

- **WHEN** task 工具完成且 `state.metadata.sessionId` 为有效字符串
- **THEN** 直接使用该值作为子会话 ID，不触发兜底

#### Scenario: 兜底路径 1——兼容多种 metadata key

- **WHEN** `metadata.sessionId` 缺失，但 `metadata.session_id` 或 `metadata.subSessionID` 存在
- **THEN** 使用首个存在的替代 key 的值

#### Scenario: 兜底路径 2——从 output 文本提取 task_id

- **WHEN** `metadata` 中无任何会话 ID key，但 `state.output` 文本包含形如 `task_id: <id>` 的标记
- **THEN** 用正则提取该 ID

#### Scenario: 兜底路径 3——按 parentID + 时间匹配子会话

- **WHEN** `metadata` 与 `output` 均无法提取 ID（如中断后 `metadata` 仅含 `{ interrupted: true }`）
- **AND** 当前会话（父会话）存在已知的子会话（`parentID === 当前会话id`）
- **THEN** 选取创建时间与该 task 工具执行时间最接近、且未被同会话其他 task chip 占用的子会话作为推测匹配
- **AND** 该推测匹配在 UI 上标明其不确定性（如 hover 提示"推测匹配的子会话"）

#### Scenario: 所有路径均无法解析时不渲染跳转入口

- **WHEN** 主路径与全部兜底路径都未能解析出子会话 ID
- **THEN** 该 chip 不渲染跳转入口，回退为普通可展开 chip，不向用户报错

### Requirement: 跳转事件沿组件链透传到会话切换入口

跳转动作 MUST 通过组件 emit 链单向传递到 `App.vue`，复用既有 `backend.selectSession`，不引入新的导航栈或全局副作用。

#### Scenario: 事件从 MessageContent 冒泡到 App

- **WHEN** `MessageContent.vue` 发出 `navigate-session` 事件（携带子会话 ID）
- **THEN** `ChatView.vue` 透传该事件
- **AND** `App.vue` 接收并调用既有的 `onSelectSession`（即 `backend.selectSession`）

#### Scenario: 切换到不存在的会话 ID 时安全降级

- **WHEN** 解析出的子会话 ID 在本地会话存储中不存在（例如尚未通过 SSE 到达）
- **THEN** 跳转请求安全降级（不崩溃、不卡死），可提示用户会话尚未就绪
