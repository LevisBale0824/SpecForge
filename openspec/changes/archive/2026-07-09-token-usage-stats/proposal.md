# proposal — Token 消耗统计与展示（token-usage-stats）

> 阶段: Propose · 档位: standard · change: `token-usage-stats`
> 上游依据: `brainstorm.md`（关键结论已逐条经直接读源码核实，见 Context Basis）
> 下游消费者: Apply（拆 tasks）/ Verify（检查 SHALL/MUST 覆盖）/ Review

---

## Why

后端 SSE 每条 assistant 消息**早已推送 token 与成本**，提取链路与查询 API 全部就绪，但 UI 从未消费——用户在对话中完全看不到"这次烧了多少 token / 多少钱"。本变更打通"最后一公里"：在每条 assistant 消息气泡下方展示明细、在会话顶部 sticky header 汇总本会话累计消耗并以柱状图呈现最近消耗趋势，让 token / 成本对用户可见、可控。

> **Intent Lock**：本次只解决"展示缺口"——数据现成、提取现成、查询 API 现成，工程重心在 **UI 形态与会话级聚合**，而非数据采集。任何偏离此意图的扩展（全局跨会话累计、持久化趋势、按模型分组、预算阻断等）一律由 Out of Scope 拦截，转后续独立 change。

---

## What Changes

涉及文件 / 模块（路径相对仓库根）：

- `app/composables/useMessages.ts`
  - 既有 `normalizeUsage()`（L203）、`getUsage()`（L772，导出于 L1113）**零改动**——数据提取链路已就绪，本变更只消费。
  - **新增**会话级聚合 computed（如 `getSessionUsageStats(sessionId)`）：基于内存 messages store 汇总当前会话全部 assistant 消息的累计 token / 累计 cost，并产出"最近 N 条 assistant 消息含 cache 总 token"序列供柱状图消费。须用 `computed` 依赖收集，与既有 batched microtask trigger 兼容，**禁止**在 `message.part.delta` 高频回调里重算。
- `app/components/MessageContent.vue`
  - 在 assistant 消息气泡下方（meta / footer 行）新增 token 明细：`↑input ↓output ⚡reasoning 💰cost`，cache 默认折叠（并入 input，可展开看 read/write）。
- `app/components/ChatView.vue`（模板 L182 起）
  - 在会话消息列表顶部新增 **sticky header**：展示本会话累计 token / 累计 cost 数字 + 柱状图（每根柱 = 1 条 assistant 消息，横向时间序，柱高 = 含 cache 总 token）+ 柱数切换控件（默认 `[10,20,50]`，默认 20）。
  - sticky header 须与既有滚动容器（L186 的 `overflow-y-auto`）共存，不挤占输入区。
- `app/components/`（新增或复用既有）
  - 纯 CSS / SVG 柱状图组件（≤50 根柱，无 chart.js / d3 新依赖），由 sticky header 引入。
- `app/locales/zh-CN.ts` / `app/locales/en.ts`
  - 新增 token 展示相关文案 key（input / output / reasoning / cost / 会话累计 / 最近 N 次 / cache 展开 等），沿用既有命名空间风格。
- `app/types/message.ts`
  - `MessageUsage`（L22–28）类型零改动——字段语义（含未填充的 `contextPercent`）由上游决定。本次仅在展示层加总，不新增类型。

---

## Out of Scope

- 不引入全局跨会话累计（用户已选 A+B，否决 C 全局累计）
- 不做 token 历史持久化 / 趋势存储 / 数据库落盘
- 不按 provider / model 分组统计
- 不实现 context window 占用条（`MessageUsage.contextPercent` 后端未填充，本次不纳入）
- 不做成本预算告警 / 限额阻断（只展示，不干预）
- 不导出 token 报表（CSV / JSON）
- 不重新解析 SSE 或绕过 useMessages store（必须复用 `getUsage` / `normalizeUsage`）
- 不引入新运行时依赖（柱状图纯 CSS / SVG）
- 不改动 OpenCode / Zero 两套 adapter 的 token 推送结构（展示层对二者对称消费即可）
- 不改动 `cli-bridge/src/services/eventParser.ts` 的 legacy 文本 dump（属独立 / legacy 路径，主 UI 走结构化 SSE）

---

## Capabilities

| Capability            | 变更类型  | 说明                                                                                                                |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `token-usage-display` | **ADDED** | 新增契约层：定义"每条消息 token 明细 + 会话级累计与柱状图 + 复用既有数据通路 + 跨后端对称 + i18n 双语"的可验收 spec |

> 既有 `session-deletion`、`subagent-session-navigation`、`app-update` 三个 capability 不受本次影响。`token-usage-display` 为本次新建 capability 目录，spec delta 见 `specs/token-usage-display/spec.md`。

---

## Context Basis

> 逐条可追溯，标注来源类型（直接读源码 / brainstorm 硬约束 / 用户原话）。

- **[源码]** `app/types/message.ts:11-28`：`MessageTokens`（input/output/reasoning/total?/cache{read,write}）与 `MessageUsage`（tokens/cost/providerId/modelId/contextPercent?）类型已完整定义——证实数据结构现成，无需新增类型。
- **[源码]** `app/types/message.ts:27` `contextPercent?: number | null`——证实该字段存在但后端未填充，故 context window 占用条列入 Out of Scope。
- **[源码]** `app/composables/useMessages.ts:203` `normalizeUsage()`：已实现从 `MessageInfo` 提取 `MessageUsage`，过滤 `role !== "assistant"`——证实提取链路就绪。
- **[源码]** `app/composables/useMessages.ts:772-773` `getUsage(id)` → `normalizeUsage(get(id))`，导出于 L1113——证实查询 API 已暴露，本变更只消费。
- **[源码]** 全仓 `.vue` 文件 grep `getUsage` **零命中**——证实 brainstorm 所述"断点在 .vue 消费层"，无任何组件调用过 token 数据。
- **[源码]** `app/composables/useMessages.ts:262-298`：`roots` / `streaming` / `childrenByParent` 等 computed 已基于 `messages` Map（L241，`shallowRef`）建索引——证实会话级聚合应遵循同一 `computed` + Map 模式，不动既有 batched trigger。
- **[源码]** `app/components/ChatView.vue:182-215`：模板为 `min-h-0 flex-1` 外层 + `overflow-y-auto px-5 py-5` 滚动容器 + 消息气泡渲染——证实 sticky header 须插入在滚动容器顶部之内，且与 `overflow-y-auto` 共存（`sticky top-0`）。
- **[源码]** `app/locales/zh-CN.ts:16-36`：`sidebar.*` 命名空间已有 deleteSession 系列文案——证实 i18n 双语补齐机制现成，token 文案按相近命名空间扩展。
- **[源码]** `cli-bridge/src/services/eventParser.ts:37`：legacy 路径把 token 粗暴 dump 成纯文本——证实主 UI 走结构化 SSE，cli-bridge 是独立 / legacy 链路，本次不触及。
- **[brainstorm 硬约束]** "必须复用 `getUsage()` / `normalizeUsage()`，禁止重新解析 SSE"——本 spec 据此固化为 SHALL。
- **[brainstorm 硬约束]** "不引入新运行时依赖，柱状图纯 CSS / SVG（≤50 根柱）"——本 spec 据此固化为 MUST。
- **[brainstorm 硬约束]** "不持久化，基于内存 store 实时聚合"——本 spec 据此固化为 SHALL。
- **[brainstorm 决策表]** D1–D10：每条消息 footer 明细 / sticky header 累计 + 柱状图 / 每根柱=1 条 assistant / 含 cache 总 token 加总 / 默认 20 可切 [10,20,50] / 纯 CSS 实现 / 复用 getUsage——本 spec 据此固化为 SHALL。

---

## Impact

- **向后兼容**：本变更为纯新增展示层，不改任何既有数据通路、SSE 解析、消息流式渲染逻辑。`getUsage` / `normalizeUsage` 签名与行为不变；`MessageUsage` 类型零改动；既有消息气泡、流式渲染、工具调用展示零回归。
- **性能（关键风险 R1）**：助手消息流式输出时 `message.updated` 多次触发。聚合须用 `computed` 依赖收集，依赖 Vue 响应式自动增量重算，**禁止**在 `message.part.delta` 高频回调里全量重算柱状图。须复用既有 batched microtask trigger 机制削峰；Apply 阶段须实测流式场景下 sticky header / 柱状图不抖动、不阻塞主线程。
- **口径歧义（风险 R2）**：`cache.read` 在计费模型里常为折扣项（如 0.1x），字面加总 `input+output+reasoning+cache.read+cache.write` 可能高估"真实消耗 token"。本变更：**柱高与累计数字按字面加总**（用户要的是"消耗了多少 token"），**cost 字段独立格式化展示真实钱**，二者各司其职。口径公式在 spec 中明示，Apply 阶段实测后可复核（待澄清 #3）。
- **数据缺失（风险 R3）**：切换会话重载历史时，若个别 `message.updated` 未带 tokens，对应柱须跳过（不留空洞柱），并在累计数字旁注明"基于 N 条已统计"。
- **布局（风险 R4/R6）**：sticky header 须与 ChatView 既有滚动容器共存，不挤占输入区；柱数切换控件须在小屏 / Electron 窄窗下不溢出。
- **货币格式（风险 R5）**：`cost` 为裸 number（美元），须统一格式化（如 `$0.0123` / 4 位小数），跨 locale 注意符号一致性。
- **迁移路径**：无需数据迁移——基于内存 store 实时聚合，会话切换靠既有 `loadHistory` / sessionCache 重建，不新增存储层。既有消息立即获得 token 展示能力。
- **跨后端**：OpenCode（13284）/ Zero（13286）两套 adapter 推送相同 token 结构，改动对二者对称生效，无 adapter 侧改动。

---

## 待 Apply / Verify 核实的阻塞项（不阻塞本 spec 落盘）

> 这些是 HOW 层细节，不影响 WHAT 契约；Apply 阶段第一组任务须先回答。

1. `MessageContent.vue` 现有 meta / footer 结构：token 行并入既有 meta 还是新增独立行？（决定 D1 落点与样式侵入面）
2. `ChatView.vue` sticky header 精确插入位置与既有滚动容器、输入区的空间关系。（决定 D3 落点）
3. "含 cache 总 token"最终公式确认：`input+output+reasoning+cache.read+cache.write` 是否符合用户预期？是否应排除 cache.read？（影响柱高与累计数字口径）
4. 柱数切换控件形态：段控 / 下拉 / 滑块？选项集 `[10,20,50]` 是否最终采纳？
5. 流式中 assistant 消息对应柱：实时增长（动态）还是完成后才定型（避免抖动）？
6. 缺 token 数据的旧消息柱：跳过 / 灰柱占位？
7. 新增 i18n 文案最终中 / 英措辞。
