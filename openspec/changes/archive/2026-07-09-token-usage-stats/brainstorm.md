# brainstorm — Token 消耗统计与展示

> change: `token-usage-stats` · 档位: standard · 阶段: Explore
> 下游消费者: Propose 据此固化为 proposal

---

## 背景 / 问题

SpecForge 作为 OpenCode / Zero Agent 的可视化前端,后端 SSE 其实**早已推送每条 assistant 消息的 token 与成本**,但 UI 从未消费——用户完全看不到"这次对话烧了多少 token / 多少钱"。

经代码追踪,数据管道已全部就绪,只差"最后一公里"展示:

```
后端 SSE message.updated
  └─► AssistantMessageInfo { cost, tokens{ input, output, reasoning, cache.read, cache.write, total? } }
        └─► sse.ts:266-290  (类型已定义)
              └─► useMessages.ts:203 normalizeUsage()   (提取已实现 ✅)
                    └─► useMessages.ts:772 getUsage(id) (查询 API 已导出 ✅)
                          └─► ✗ 零个 .vue 组件调用   ← 断点在这
                                └─► 无会话级聚合
                                      └─► 无任何 UI
```

> 旁证:`cli-bridge/src/services/eventParser.ts:37` 曾把 token 粗暴 dump 成 `[done] tokens: N | cost: $X` 纯文本,但 cli-bridge 是独立 / legacy 路径,主 UI(OpenCode / Zero adapter)走结构化 SSE,**主界面从未显示过 token**。

**结论**:这不是"采集"问题,是"展示"问题。数据现成、提取现成、查询 API 现成,工程重心在 UI 形态与聚合,而非数据获取。

---

## 利益相关方

- **SpecForge 终端用户**(单人桌面场景):想在对话过程中感知 token / 成本消耗,把控用量。
- **维护者**:须保证不破坏现有消息流式渲染性能(useMessages 的 batched microtask 机制)、不引入重依赖、i18n 双语补齐。
- **OpenCode / Zero 上游**:token 字段语义(cache.read 是否计费折扣项等)由上游决定,SpecForge 只消费。

---

## 硬约束

1. **复用既有数据通路** —— 必须复用 `getUsage()` / `normalizeUsage()`,**禁止**重新解析 SSE 或绕过 useMessages store。
2. **不引入新运行时依赖** —— 柱状图用纯 CSS / SVG 实现(≤20 根柱,无需 chart.js / d3),保住包体积与 Linus 三问之"更简单做法"。
3. **不持久化** —— 基于内存 messages store 实时聚合;会话切换靠现有 `loadHistory` / sessionCache 重建,不新增存储层(用户选 A+B,否决全局跨会话累计)。
4. **跨后端一致** —— OpenCode(13284) / Zero(13286) 两套 adapter 推送相同 token 结构,改动对二者对称生效。
5. **不破坏流式性能** —— 聚合须用 `computed` + 与现有 batched trigger 机制兼容,不得在每次 `message.part.delta` 高频回调里重算柱状图。
6. **i18n 双语** —— 新增 UI 文案必须补 `app/locales/{zh-CN,en}.ts`。

---

## 非目标 (Out of Scope)

- ❌ **全局跨会话累计** —— 用户明确选 A(每条消息)+ B(本会话汇总),否决 C(全局累计)。故不引入跨会话持久存储。
- ❌ **持久化 / 历史趋势存储** —— 不落盘 token 历史,不建趋势数据库。
- ❌ **按 provider / model 分组统计** —— 本次不做分模型汇总。
- ❌ **context window 占用条** —— `MessageUsage.contextPercent` 字段后端**未填充**,本次不纳入。
- ❌ **成本预算告警 / 限额阻断** —— 只展示,不干预。
- ❌ **导出 token 报表** —— 不做 CSV / JSON 导出。

---

## 关键决策

| #   | 决策点           | 选择                                                                                   | 理由                                                                         |
| --- | ---------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D1  | 每条消息展示位置 | **assistant 消息气泡下方**(meta / footer 行)                                           | 用户明确;紧贴内容,所见即所得                                                 |
| D2  | 每条消息展示内容 | `↑input  ↓output  ⚡reasoning  💰$cost`,cache 折叠(默认并入 input,可展开看 read/write) | 用户认可该默认;信息密度适中                                                  |
| D3  | 会话级展示位置   | **会话顶部 sticky header**(固定不随滚动移走)                                           | 用户明确"会话上方固定"                                                       |
| D4  | 会话级展示内容   | **总消耗数字**(本会话累计 token / $cost) **+ 柱状图**                                  | 用户明确要柱状图记录最近消耗                                                 |
| D5  | 柱状图语义       | **每根柱 = 1 条 assistant 消息**,横向时间序                                            | 用户明确;数据现成,无需按轮次再聚合                                           |
| D6  | 柱高量纲         | **含 cache 的总 token**                                                                | 用户明确(见 D7 口径)                                                         |
| D7  | 聚合口径         | `input + output + reasoning + cache.read + cache.write`                                | 字面"消耗了多少 token";cache 计费折扣是另一维度,展示层先加总(待澄清 #3 复核) |
| D8  | 柱数             | **默认 20,可切换**                                                                     | 用户明确;切换选项集默认 `[10, 20, 50]`(待澄清 #4 定 UI 形态)                 |
| D9  | 图表实现         | **纯 CSS / SVG,无新依赖**                                                              | ≤50 根柱,纯 CSS 足矣;避免 chart.js 增包体                                    |
| D10 | 数据源           | 复用 `getUsage(id)`;**新增**会话级 `computed` 聚合当前 session 全部 assistant 消息     | 不动既有提取链路,只加聚合 + 消费层                                           |

### 目标态数据流

```
messages store (既有,内存)
  │   assistant msg ──► getUsage(id) ──► MessageUsage{ tokens, cost }
  │
  ├──[每条消息] MessageContent footer
  │     ↑input  ↓output  ⚡reasoning  💰$cost   (cache 折叠)
  │
  └──[会话级] 新增 useTokenStats(sessionId) computed
        ├─► 累计 token / 累计 $cost           ──► sticky header 数字
        └─► 最近 N 条 assistant 的含cache总token ──► 柱状图(纯 CSS)
                                                  ▲
                              柱数切换控件(10/20/50) ┘
```

---

## 风险

- **R1 流式重渲性能(中)** —— 助手消息流式输出时 `message.updated` 多次触发,柱状图若每次全量重算可能抖动。须用 `computed` 依赖收集 + 验证 batched trigger 是否已足够削峰;Apply 阶段实测。
- **R2 "含cache总token"口径歧义(中)** —— `cache.read` 在计费模型里常是折扣项(如 Anthropic cache read 0.1x),字面加总可能高估"真实消耗 token"。展示层先按加总(用户要的是"消耗了多少"),cost 字段独立显示真实钱,二者各司其职。(待澄清 #3)
- **R3 历史/旧消息 token 缺失(低)** —— 切换会话重载历史时,若个别 `message.updated` 未带 tokens,对应柱缺失。策略:跳过缺数据柱(不留空洞柱),并在总数字上注明"基于 N 条已统计"。
- **R4 sticky header 布局冲突(中)** —— ChatView 顶部可能已有标题 / agent 选择 / 模型等控件,sticky header 须与之共存,不能挤占输入区。需确认落点(待澄清 #1、#2)。
- **R5 cost 货币格式(低)** —— `cost` 是裸 number(美元),须统一格式化(`$0.0123` / 4 位小数),跨 locale 注意符号。
- **R6 柱数切换控件复杂度(低)** —— 切换控件增加 header 元素,须保证小屏 / Electron 窄窗不溢出。

---

## 待澄清 (交 Propose / Apply 核实)

1. **[阻塞]** `MessageContent.vue` 现有 meta / footer 结构:是否已有 model / time / agent 行?token 行是并入既有 meta 还是新增独立行?(决定 D1 落点与样式侵入面)
2. **[阻塞]** `ChatView.vue` 顶部结构:sticky header 插入位置,与现有顶栏(标题 / agent / model 选择器)的空间关系。(决定 D3 落点)
3. **[口径]** "含cache总token"最终公式:`input+output+reasoning+cache.read+cache.write` 是否符合用户预期?或应排除 cache.read(已缓存读取不算新消耗)?——影响柱高与总数字。
4. **[UI]** 柱数切换控件形态:段控(button group) / 下拉 / 滑块?选项集 `[10,20,50]` 是否合适?
5. **[UX]** 流式中的 assistant 消息:对应柱是实时增长(动态)还是完成后才定型(避免抖动)?
6. **[UX]** 缺 token 数据的旧消息:柱状图跳过 / 灰柱占位?
7. **[i18n]** 新增文案最终措辞(中 / 英),含 `input/output/reasoning/cost/会话累计/最近N次` 等键。
