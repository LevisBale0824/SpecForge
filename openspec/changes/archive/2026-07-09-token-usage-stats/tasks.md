# tasks — token-usage-stats

> change: `token-usage-stats` · tier: standard · capability: `token-usage-display`
> 验证命令(来自 contract): `pnpm lint` · `pnpm test` · `pnpm build`

---

## Phase 1 — Spike：确认实现细节

> Proposal 列出 7 项 HOW 层阻塞项(不影响 WHAT 契约),须在写代码前定稿。
> 决策依据：读源码实测 + 与 proposal Context Basis 对齐。

- [x] 1.1 **确认 MessageContent.vue token 行落点**：读 `MessageContent.vue` 现有模板结构(L482–775)，确定 token 明细行并入既有 meta 行(气泡内 `<div class="mb-1 flex items-center gap-2">` L217)还是新增独立 footer 行。记录最终决策(含理由)到本文件下方"Spike 决策记录"区。**完成条件**：决策已记录，且明确了 CSS class / 插入位置的精确描述。
- [x] 1.2 **确认 ChatView.vue sticky header 插入位置**：读 `ChatView.vue` 模板 L182–342，确认 sticky header 放在 `overflow-y-auto` 滚动容器(L186)内顶部(用 `sticky top-0 z-10`)还是外层 wrapper 上。验证不挤占 `InputPanel`(L558,由 App.vue 渲染在 router-view 之后)。**完成条件**：插入位置 + CSS 定位策略已记录。
- [x] 1.3 **确认"含 cache 总 token"公式**：核对 spec.md L99–107，确认口径为 `input + output + reasoning + cache.read + cache.write`(各字段存在时计入，缺失视为 0)。确认 `cache.read` 不做计费折扣修正。**完成条件**：公式已固化为常量并记录。
- [x] 1.4 **确认柱数切换控件形态**：决定用 segmented control(段控)还是 select 下拉；选项集 `[10, 20, 50]`，默认 20。考虑窄窗不溢出(spec L93–97)。**完成条件**：控件类型 + 选项集已记录。
- [x] 1.5 **确认流式中 assistant 消息对应柱的行为**：决定 streaming 状态的 assistant 消息是否实时更新对应柱高(动态增长)还是完成后才入柱。推荐：实时增长(computed 自动响应)，但须实测无抖动(spec L141–146)。**完成条件**：行为决策已记录。
- [x] 1.6 **确认缺 token 数据旧消息柱处理**：核对 spec.md L121–135，确认跳过不渲染空洞柱 + 累计数字旁注明"基于 N 条已统计"。**完成条件**：降级策略已记录。
- [x] 1.7 **确认 i18n 文案最终措辞**：拟定中/英文案 key 列表(input / output / reasoning / cost / cache.read / cache.write / 会话累计 / 最近 N 次 / 柱数切换 / "基于 N 条已统计" / 空态文案)。**完成条件**：key 清单 + 中英双语文案已记录。

---

## Phase 2 — 基础层：i18n + 数据聚合

- [x] 2.1 **新增 token 展示 i18n key(双语)** — `app/locales/zh-CN.ts` / `app/locales/en.ts`
  - 在 `chat` 命名空间下新增 `tokenUsage` 子命名空间(或按 spike 1.7 决策)。
  - key 清单至少覆盖：`input` / `output` / `reasoning` / `cost` / `cacheRead` / `cacheWrite` / `cacheToggle` / `sessionTotal` / `recentN` / `barCount` / `basedOnN` / `emptyState`。
  - 两个 locale 文件的 key 集合一一对应，无缺失键。
  - **验证**：`pnpm typecheck` 通过；手动切换 zh-CN / en 无 key 缺失告警。
  - `- Scenario: zh-CN 与 en 双语键齐全`(spec L158–162)

- [x] 2.2 **新增 token 聚合纯函数 + 单元测试** — `app/utils/tokenStats.ts` (新建) / `app/utils/__tests__/tokenStats.test.ts` (新建)
  - 导出 `calcTotalTokens(tokens: MessageTokens): number`：按公式 `input + output + reasoning + (cache?.read ?? 0) + (cache?.write ?? 0)` 字面加总。
  - 导出 `formatCost(cost?: number): string`：统一 `$` 前缀 + 4 位小数(如 `$0.0123`)，`undefined` 返回空字符串。
  - 导出 `type SessionUsageStats`：`{ totalTokens: number; totalCost: number; countedMessages: number; bars: { messageId: string; tokens: number; cost?: number }[] }`。
  - **先写测试(红)**：`calcTotalTokens` 覆盖无 cache / 有 cache / cache 部分缺失 / 全零；`formatCost` 覆盖正常值 / undefined / 0 / 极小值。
  - **验证**：`pnpm test -- tokenStats` 全部通过。
  - `- Scenario: 累计数字与柱高按字面加总`(spec L103–107) · `- Scenario: cost 独立展示不进柱高`(spec L109–113) · `- Scenario: 货币格式跨 locale 一致`(spec L115–119)

- [x] 2.3 **在 useMessages.ts 新增会话级聚合 computed** — `app/composables/useMessages.ts`
  - 新增 `getSessionUsageStats(sessionId: string): ComputedRef<SessionUsageStats>`，基于 `list()` 过滤 `sessionID === sessionId && role === "assistant"` 的消息，逐一调 `getUsage(id)`(复用既有数据通路，禁止重新解析 SSE)，跳过 `getUsage` 返回 undefined 的消息(不留空洞柱)。
  - 必须用 `computed` 派生，依赖 Vue 响应式自动增量重算；**禁止**在 `message.part.delta` / `message.updated` 回调里手动重算。
  - 与既有 `messages` Map(L241 `shallowRef`) + batched microtask trigger 兼容。
  - 在 `useMessages()` 返回对象(L1095–1141)中导出 `getSessionUsageStats`。
  - **验证**：`pnpm typecheck` 通过；`pnpm test` 既有测试无回归。
  - `- Scenario: 每条消息明细取数复用 getUsage`(spec L9–13) · `- Scenario: 会话级聚合派生自内存 store`(spec L15–19) · `- Scenario: 不解析 SSE 原始流`(spec L21–24) · `- Scenario: 流式输出期间不高频全量重算`(spec L141–146)

---

## Phase 3 — 组件层：柱状图 + 消息明细 + Sticky Header

- [x] 3.1 **新建纯 CSS/SVG 柱状图组件** — `app/components/TokenBarChart.vue` (新建)
  - Props：`bars: { messageId: string; tokens: number; cost?: number }[]`、`maxBars: number`(当前选中柱数)、`barCountOptions: number[]`(默认 `[10, 20, 50]`)。
  - 仅渲染最近 `maxBars` 根柱，每根柱高量纲 = 该消息含 cache 总 token(由调用方传入已算好的 `tokens`)。
  - 用纯 CSS flex + `height: %` 或内联 SVG 实现；**严禁**引入 chart.js / d3 / echarts。
  - 柱数切换控件(按 spike 1.4 决策形态)，`emit('update:maxBars', value)`。
  - `bars` 为空时渲染空态文案(从 i18n 取)。
  - 窄窗不溢出：柱状图容器 `overflow-hidden`，控件 `flex-shrink-0`。
  - **验证**：`pnpm typecheck` 通过；`pnpm lint` 通过。
  - `- Scenario: 无新运行时依赖`(spec L80–84) · `- Scenario: 柱数可切换且默认 20`(spec L86–91) · `- Scenario: 窄窗不溢出`(spec L93–97)

- [x] 3.2 **MessageContent.vue 新增 per-message token 明细行** — `app/components/MessageContent.vue`
  - 在 assistant 消息气泡内(按 spike 1.1 决策位置)新增 token 明细行。
  - 取数调用 `msgStore.getUsage(props.messageId)`；`getUsage` 返回 `undefined` 时**不渲染**该行(不显示 0 / N/A 占位)。
  - 展示四项：`↑input  ↓output  ⚡reasoning  💰cost`，每项带图标或标签(图标可用 emoji 或 inline SVG)。
  - cache 默认折叠：折叠态只显示 input 合计或不突出 cache；展开后显示 `cache.read` / `cache.write` 两项独立数值。折叠/展开为 per-message 本地 ref，不影响其他消息取数。
  - 所有面向用户文案经 `useI18n().t(...)` 取值(task 2.1 的 key)，**禁止**硬编码中/英文字面量。
  - cost 用 `formatCost()`(task 2.2)格式化为 `$0.0123`。
  - **验证**：`pnpm typecheck` 通过；`pnpm lint` 通过；手动：对有 token 数据的消息显示明细，对无数据消息不渲染。
  - `- Scenario: 标准消息展示四项明细与 cost`(spec L30–34) · `- Scenario: cache 可展开查看明细`(spec L36–40) · `- Scenario: 缺数据的消息不渲染明细`(spec L42–46)

- [x] 3.3 **ChatView.vue 新增会话级 sticky header** — `app/components/ChatView.vue`
  - 在滚动容器内(L186 `overflow-y-auto` 容器)顶部新增 sticky header，用 `sticky top-0 z-10` 定位。
  - 获取当前 sessionId：从 `useBackend().selectedSessionId`(或在 ChatView 中从 `allMessages` 首条 assistant 消息的 `sessionID` 推断，参考 `getLatestAssistantMessageId` L845–849 模式)。
  - 调用 `msgStore.getSessionUsageStats(sessionId)`(task 2.3)获取 `SessionUsageStats`。
  - header 内容：累计 token 数字 + 累计 cost(`formatCost`) + "基于 N 条已统计"文案(当 `countedMessages` < 会话 assistant 消息总数时显示)。
  - 引入 `TokenBarChart.vue`(task 3.1)，传入 `bars` + 柱数切换。
  - header 高度固定或自适应，不挤占输入区(InputPanel 在 App.vue L558 由 router-view 外渲染，header 不应使 InputPanel 被推出视口)。
  - 空会话(无带 token 的 assistant 消息)显示零态/空态，不报错。
  - 所有文案经 `useI18n().t(...)`，禁止硬编码字面量。
  - **验证**：`pnpm typecheck` 通过；`pnpm lint` 通过。
  - `- Scenario: sticky header 展示累计数字`(spec L52–56) · `- Scenario: 柱状图每根柱对应一条 assistant 消息`(spec L58–63) · `- Scenario: 空会话不渲染 header 内容`(spec L65–68) · `- Scenario: header 不挤占输入区`(spec L70–74)

---

## Phase 4 — 缺数据降级收尾

- [x] 4.1 **缺数据消息柱状图跳过 + 累计注明基数** — 跨 `useMessages.ts` / `ChatView.vue`
  - 确认 `getSessionUsageStats`(task 2.3)已跳过 `getUsage === undefined` 的消息，柱序列中不留高度为 0 的空洞柱。
  - 在 sticky header 累计数字旁显示"基于 N 条已统计"(N = `stats.countedMessages`)，当存在缺数据消息时可见。
  - 会话 assistant 消息总数 = `allMessages.filter(role === 'assistant').length`；若该数 > `countedMessages`，则展示注明文案。
  - **验证**：`pnpm typecheck` 通过；手动：构造含部分缺 token 消息的会话，确认无空洞柱 + 注明文案出现。
  - `- Scenario: 缺数据柱跳过不留空洞`(spec L125–129) · `- Scenario: 累计数字注明统计基数`(spec L131–135)

---

## Phase 5 — 质量门禁

- [x] 5.1 **Lint + Typecheck 全量通过**
  - 运行 `pnpm lint` — 0 error。
  - 运行 `pnpm typecheck`(`vue-tsc --noEmit`)— 0 error。
  - **完成条件**：两条命令退出码均为 0。

- [x] 5.2 **单元测试全量通过**
  - 运行 `pnpm test` — 全部通过(含 task 2.2 新增 `tokenStats.test.ts` + 既有测试无回归)。
  - **完成条件**：退出码 0，无 failed。

- [x] 5.3 **构建通过**
  - 运行 `pnpm build`(`vue-tsc --noEmit && vite build`)— 构建成功，无 error。
  - **完成条件**：退出码 0，`dist/` 产物生成。

- [x] 5.4 **手动验收：流式性能 + 跨后端对称 + 响应式**
  - **流式性能(R1)**：启动 OpenCode 后端，发送一条会触发长回复的消息；在流式输出期间观察 sticky header 累计数字 + 柱状图：须随消息增长平滑更新，无明显卡顿 / 抖动 / 主线程阻塞。既有消息气泡、工具调用、reasoning 渲染帧率无可感知退化。
  - **跨后端对称(spec L170–182)**：切换到 Zero 后端，确认每条消息明细 + sticky header 累计 + 柱状图行为与 OpenCode 等价。
  - **响应式(R4/R6)**：缩小 Electron 窗口至窄窗(如 600px 宽)，确认柱数切换控件不溢出、不产生横向滚动条。
  - **会话切换(spec L148–152)**：切换到另一个会话再切回，确认 sticky header 及时刷新新会话数据，无阻塞延迟。
  - **cache 展开(spec L36–40)**：展开某条消息的 cache 明细，确认不触发其他消息取数重算。
  - **完成条件**：以上 5 项全部通过(手动观察 + 截图/录屏存证)。
  - **状态**：✅ 用户确认通过。

---

## Spike 决策记录

> Spike(task 1.x)完成后在此区记录每项最终决策，供 Apply / Review 追溯。

- **1.1 MessageContent 落点**：新增独立 footer 行，放在 `<template v-for="renderItems">` 之后、`showThinking` / `isError` div 之前（即 L762 `</template>` 之后、L764 `<div v-if="showThinking">` 之前）。理由：token 明细是整条消息的 summary，逻辑上属于 footer 而非 meta header；放在内容末尾不打断文本/工具/reasoning 块的阅读流。CSS：`mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-surface-700/50 pt-1.5 text-[10px] text-surface-500`。
- **1.2 sticky header 插入位置**：放在 `overflow-y-auto` 滚动容器（L186 `<div ref="containerEl">`）**内部**，作为第一个子元素，在 empty-state div（L189）和 messages div（L197）之前。用 `sticky top-0 z-10` + 背景色 `bg-surface-950/95 backdrop-blur` 确保滚动时消息从下方穿过。InputPanel 由 App.vue L558 在 router-view 外独立渲染，不在滚动容器内，不受影响。
- **1.3 总 token 公式**：`total = input + output + reasoning + (cache?.read ?? 0) + (cache?.write ?? 0)`。cache.read 不做折扣修正，字面加总。固化在 `calcTotalTokens(tokens: MessageTokens)` 纯函数中。
- **1.4 柱数切换控件**：segmented control（段控）—— 3 个紧凑按钮 `10 | 20 | 50`，默认选中 20。段控比下拉更省空间、操作更快，适合 sticky header 窄条。容器 `flex-shrink-0`，柱状图区域 `min-w-0 flex-1 overflow-hidden`。
- **1.5 流式柱行为**：实时增长。assistant 消息在 streaming 期间，其 `getUsage()` 返回的 tokens 会随 `message.updated` 增长；computed 自动响应，柱高实时更新。因 computed 是惰性缓存，不会高频全量重算。验收时在 5.4 手动确认无抖动。
- **1.6 缺数据柱处理**：`getUsage(id)` 返回 undefined 的消息：①柱状图完全跳过，不渲染高度为 0 的空洞柱；②累计数字旁显示"基于 N 条已统计"（N = 实际有数据的 assistant 消息数），仅当 N < 会话 assistant 消息总数时显示。
- **1.7 i18n 文案**：命名空间 `chat.tokenUsage.*`，双语 key 如下：
  - `input`: 输入 / Input
  - `output`: 输出 / Output
  - `reasoning`: 推理 / Reasoning
  - `cost`: 费用 / Cost
  - `cacheRead`: 缓存读取 / Cache Read
  - `cacheWrite`: 缓存写入 / Cache Write
  - `cacheToggle`: 缓存明细 / Cache Details
  - `sessionTotal`: 本会话累计 / Session Total
  - `recentN`: 最近 {n} 条 / Last {n}
  - `barCount`: 柱数 / Bars
  - `basedOnN`: 基于 {n} 条已统计 / Based on {n} messages
  - `emptyState`: 暂无 token 数据 / No token data yet

---

## Requirement → Task 覆盖矩阵

| Contract Requirement                       | Level | 覆盖 Task |
| ------------------------------------------ | ----- | --------- |
| Token 数据须复用既有数据通路，禁止重新采集 | MUST  | 2.3       |
| 每条 assistant 消息须展示 token 明细       | MUST  | 3.2       |
| 会话顶部须展示累计消耗与柱状图             | MUST  | 3.3       |
| 柱状图须纯 CSS / SVG 实现且柱数可切换      | MUST  | 3.1       |
| 聚合口径须为含 cache 总 token 加总         | MUST  | 2.2 · 2.3 |
| 缺数据消息须优雅降级                       | SHALL | 2.3 · 4.1 |
| 聚合须保证流式渲染性能不退化               | MUST  | 2.3 · 5.4 |
| 新增 UI 文案须中英双语                     | MUST  | 2.1       |
| 跨后端对称——OpenCode 与 Zero 等价展示      | SHALL | 5.4       |
