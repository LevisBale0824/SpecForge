# token-usage-display Specification

## ADDED Requirements

### Requirement: Token 数据须复用既有数据通路，禁止重新采集

每条 assistant 消息的 token / cost 展示 MUST 经由既有 `getUsage(id)` / `normalizeUsage()` 取数，严禁重新解析 SSE 原始流、绕过 `useMessages` store 自建第二条提取链路。会话级聚合 MUST 基于内存 messages store 实时派生，不得新增持久化存储层。

#### Scenario: 每条消息明细取数复用 getUsage

- **WHEN** 渲染某条 assistant 消息 `M` 的 token 明细
- **THEN** 取数 SHALL 调用 `useMessages().getUsage(M.id)`，返回的 `MessageUsage.tokens`（input/output/reasoning/cache）与 `cost` 直接用于展示
- **AND** 不得在组件内自行解析 `MessageInfo` 或监听 `message.updated` 原始事件重建 token 数据

#### Scenario: 会话级聚合派生自内存 store

- **WHEN** 计算当前会话 `S` 的累计 token / 累计 cost 与最近 N 条柱序列
- **THEN** 聚合 SHALL 基于内存 messages store 中 `S` 的全部 assistant 消息，经 `computed` 派生
- **AND** 不得落盘 token 历史、不得新建数据库 / 文件存储层

#### Scenario: 不解析 SSE 原始流

- **WHEN** 任一展示组件需要 token 数据
- **THEN** 取数路径 MUST 经过 `useMessages` 暴露的 API，不得直接订阅 `sse.ts` 的 `message.updated` / `message.part.delta` 事件自行抽取 token 字段

### Requirement: 每条 assistant 消息须展示 token 明细

每条 assistant 消息气泡下方（meta / footer 行）MUST 展示该消息的 token 明细，至少包含 input / output / reasoning 与 cost 四项；cache（read / write）默认折叠并入 input，用户可展开查看明细。缺数据的消息（`getUsage` 返回 undefined）SHALL 不渲染该明细行，不留空白占位。

#### Scenario: 标准消息展示四项明细与 cost

- **WHEN** assistant 消息 `M` 的 `getUsage(M.id)` 返回有效 `MessageUsage`
- **THEN** 气泡下方 SHALL 展示 input / output / reasoning 三项 token 与 cost，每项带可识别图标或标签
- **AND** cache（read / write）默认折叠，展开前并入或不单独突出展示

#### Scenario: cache 可展开查看明细

- **WHEN** 用户对某条消息的 cache 明细感兴趣并触发展开交互
- **THEN** 该消息 SHALL 展示 cache.read 与 cache.write 两项独立数值
- **AND** 折叠 / 展开状态变更不得重算其他消息的取数

#### Scenario: 缺数据的消息不渲染明细

- **WHEN** `getUsage(M.id)` 返回 undefined（旧消息未带 token、或上游未推送）
- **THEN** 该消息气泡下方 SHALL NOT 渲染 token 明细行
- **AND** 不得渲染值为 0 / "N/A" 的占位明细

### Requirement: 会话顶部须展示累计消耗与柱状图

会话消息列表顶部 MUST 有一个 sticky header（随滚动固定可见），展示当前会话的累计 token、累计 cost，以及一张柱状图：每根柱代表 1 条 assistant 消息，按时间横向排列，柱高量纲为含 cache 的总 token。

#### Scenario: sticky header 展示累计数字

- **WHEN** 当前会话 `S` 至少有 1 条带 token 的 assistant 消息
- **THEN** sticky header SHALL 展示 `S` 的累计 token 与累计 cost 数字
- **AND** header 在消息列表滚动时保持 sticky 固定，不被滚出视口

#### Scenario: 柱状图每根柱对应一条 assistant 消息

- **WHEN** sticky header 渲染柱状图
- **THEN** 每根柱 SHALL 对应会话内 1 条 assistant 消息（不按轮次二次聚合）
- **AND** 柱按消息时间序横向排列
- **AND** 柱高量纲 SHALL 为该消息含 cache 的总 token

#### Scenario: 空会话不渲染 header 内容

- **WHEN** 当前会话无任何带 token 的 assistant 消息
- **THEN** sticky header 的累计数字与柱状图 SHALL 显示为零态 / 空态，不报错

#### Scenario: header 不挤占输入区

- **WHEN** sticky header 存在且消息列表较长
- **THEN** header MUST NOT 挤占消息输入区域的可用空间
- **AND** header 须与既有滚动容器（`overflow-y-auto`）共存，不破坏滚动行为

### Requirement: 柱状图须纯 CSS / SVG 实现且柱数可切换

柱状图 MUST 以纯 CSS / SVG 实现，严禁引入 chart.js / d3 等图表库新运行时依赖。柱数 SHALL 可由用户切换，选项集至少包含 `[10, 20, 50]`，默认 20 根。

#### Scenario: 无新运行时依赖

- **WHEN** 实现柱状图组件
- **THEN** 构建 SHALL NOT 引入 chart.js / d3 / echarts 或任何新的图表 / 可视化运行时依赖
- **AND** 柱体渲染 SHALL 使用纯 CSS（如 flex + height）或内联 SVG

#### Scenario: 柱数可切换且默认 20

- **WHEN** 用户在 sticky header 操作柱数切换控件
- **THEN** 可选柱数 SHALL 至少包含 10 / 20 / 50 三档
- **AND** 初始默认柱数 SHALL 为 20
- **AND** 切换后柱状图展示最近 N 条 assistant 消息的柱

#### Scenario: 窄窗不溢出

- **WHEN** 应用窗口宽度较小（Electron 窄窗 / 小屏）
- **THEN** 柱数切换控件与柱状图 SHALL 不溢出 sticky header 边界
- **AND** 不得因控件过宽导致横向滚动条

### Requirement: 聚合口径须为含 cache 总 token 加总

累计 token 数字与柱高所用的"总 token"MUST 按 `input + output + reasoning + cache.read + cache.write` 字面加总。cost 字段独立展示真实金额，不参与柱高量纲。该口径须在 UI 上对用户可感知（如 tooltip / 标签说明），避免与"计费折扣后真实消耗"混淆。

#### Scenario: 累计数字与柱高按字面加总

- **WHEN** 计算某消息的柱高或会话累计 token
- **THEN** 总 token SHALL = `input + output + reasoning + cache.read + cache.write`（各字段存在时计入，缺失项视为 0）
- **AND** 不得用 cache.read 的计费折扣系数修正柱高

#### Scenario: cost 独立展示不进柱高

- **WHEN** 展示某消息或会话的 cost
- **THEN** cost SHALL 作为独立金额字段展示（如 `$0.0123`，4 位小数）
- **AND** cost 不得作为柱高量纲或参与 token 加总

#### Scenario: 货币格式跨 locale 一致

- **WHEN** 应用语言为 zh-CN 或 en
- **THEN** cost 展示 SHALL 统一为带 `$` 前缀的定点格式（小数位数固定，如 4 位）
- **AND** 不得因 locale 切换出现符号错乱或精度漂移

### Requirement: 缺数据消息须优雅降级

会话内若存在 `getUsage` 返回 undefined 的 assistant 消息（旧消息未带 token），柱状图 SHALL 跳过该消息不渲染空洞柱，累计数字旁 SHALL 注明"基于 N 条已统计"以明示统计基数。

#### Scenario: 缺数据柱跳过不留空洞

- **WHEN** 会话内某条 assistant 消息 `getUsage` 返回 undefined
- **THEN** 柱状图 SHALL 跳过该消息，不为其渲染柱
- **AND** 不得渲染高度为 0 的空洞柱误导用户

#### Scenario: 累计数字注明统计基数

- **WHEN** 会话内存在带 token 与不带 token 的 assistant 消息混合
- **THEN** 累计 token / cost 数字旁 SHALL 注明"基于 N 条已统计"（N = 实际纳入统计的消息数）
- **AND** 不得把缺数据消息按 0 计入累计造成误导

### Requirement: 聚合须保证流式渲染性能不退化

会话级聚合与柱状图 MUST 以 `computed` 响应式派生，依赖 Vue 自动增量重算，严禁在 `message.part.delta` 高频回调内全量重算柱状图或累计数字。聚合须与既有 batched microtask trigger 机制兼容，不得在助手消息流式输出时引入可感知的卡顿、抖动或主线程阻塞。

#### Scenario: 流式输出期间不高频全量重算

- **WHEN** 助手消息流式输出，`message.updated` / `message.part.delta` 高频触发
- **THEN** 柱状图与累计数字的更新 SHALL 经 `computed` 依赖收集由响应式驱动
- **AND** 不得在 delta 回调里同步全量重算柱状图
- **AND** 既有消息流式渲染（气泡、工具调用、reasoning）的帧率 SHALL NOT 因本变更可感知退化

#### Scenario: 会话切换不卡顿

- **WHEN** 用户切换会话触发 `loadHistory` / sessionCache 重建
- **THEN** sticky header 与柱状图 SHALL 随新会话数据就绪后及时刷新，不阻塞切换交互
- **AND** 不得因聚合计算导致切换出现可感知延迟

### Requirement: 新增 UI 文案须中英双语

本变更新增的所有面向用户文案（input / output / reasoning / cost / cache 明细 / 会话累计 / 最近 N 次 / 柱数切换 / "基于 N 条已统计" 等）MUST 补齐 `app/locales/zh-CN.ts` 与 `app/locales/en.ts`，沿用既有命名空间风格，不得硬编码中文或英文字面量到组件。

#### Scenario: zh-CN 与 en 双语键齐全

- **WHEN** 应用语言切换为 zh-CN 或 en
- **THEN** 所有新增 token 展示文案 SHALL 从对应 locale 文件取值
- **AND** 两个 locale 文件的新增 key 集合 SHALL 一一对应，无缺失键

#### Scenario: 组件不硬编码字面量

- **WHEN** 审查任一新增 / 改动的 `.vue` 组件
- **THEN** 面向用户的字符串 SHALL 经由 `useI18n().t(...)` 取值
- **AND** 不得在模板或脚本中硬编码中 / 英文字面量

### Requirement: 跨后端对称——OpenCode 与 Zero 等价展示

OpenCode（13284）与 Zero（13286）两套 adapter 推送相同的 token 结构，token 展示契约 SHALL 对两者对称生效，不得出现"仅某一后端能显示 token"的不一致。

#### Scenario: OpenCode 后端展示 token

- **WHEN** 活动后端为 OpenCode，assistant 消息携带 token / cost
- **THEN** 每条消息明细、sticky header 累计数字、柱状图 SHALL 全部正常展示

#### Scenario: Zero 后端展示 token

- **WHEN** 活动后端为 Zero，assistant 消息携带 token / cost
- **THEN** 行为 SHALL 与 OpenCode 后端等价（明细、累计、柱状图均展示）
- **AND** 不得因后端不同出现字段缺失或口径偏移
