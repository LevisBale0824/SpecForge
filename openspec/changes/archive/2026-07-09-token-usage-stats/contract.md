{
"changeId": "token-usage-stats",
"need": "token-usage-stats",
"tier": "standard",
"scope": {
"files": [
"read/write"
]
},
"intent": "后端 SSE 每条 assistant 消息**早已推送 token 与成本**，提取链路与查询 API 全部就绪，但 UI 从未消费——用户在对话中完全看不到\"这次烧了多少 token / 多少钱\"。本变更打通\"最后一公里\"：在每条 assistant 消息气泡下方展示明细、在",
"outOfScope": [
"不引入全局跨会话累计（用户已选 A+B，否决 C 全局累计）",
"不做 token 历史持久化 / 趋势存储 / 数据库落盘",
"不按 provider / model 分组统计",
"不实现 context window 占用条（`MessageUsage.contextPercent` 后端未填充，本次不纳入）",
"不做成本预算告警 / 限额阻断（只展示，不干预）",
"不导出 token 报表（CSV / JSON）",
"不重新解析 SSE 或绕过 useMessages store（必须复用 `getUsage` / `normalizeUsage`）",
"不引入新运行时依赖（柱状图纯 CSS / SVG）",
"不改动 OpenCode / Zero 两套 adapter 的 token 推送结构（展示层对二者对称消费即可）",
"不改动 `cli-bridge/src/services/eventParser.ts` 的 legacy 文本 dump（属独立 / legacy 路径，主 UI 走结构化 SSE）",
"--"
],
"requirements": [
{
"name": "Token 数据须复用既有数据通路，禁止重新采集",
"level": "MUST",
"source": "changes/token-usage-stats/specs/token-usage-display/spec.md"
},
{
"name": "每条 assistant 消息须展示 token 明细",
"level": "MUST",
"source": "changes/token-usage-stats/specs/token-usage-display/spec.md"
},
{
"name": "会话顶部须展示累计消耗与柱状图",
"level": "MUST",
"source": "changes/token-usage-stats/specs/token-usage-display/spec.md"
},
{
"name": "柱状图须纯 CSS / SVG 实现且柱数可切换",
"level": "MUST",
"source": "changes/token-usage-stats/specs/token-usage-display/spec.md"
},
{
"name": "聚合口径须为含 cache 总 token 加总",
"level": "MUST",
"source": "changes/token-usage-stats/specs/token-usage-display/spec.md"
},
{
"name": "缺数据消息须优雅降级",
"level": "SHALL",
"source": "changes/token-usage-stats/specs/token-usage-display/spec.md"
},
{
"name": "聚合须保证流式渲染性能不退化",
"level": "MUST",
"source": "changes/token-usage-stats/specs/token-usage-display/spec.md"
},
{
"name": "新增 UI 文案须中英双语",
"level": "MUST",
"source": "changes/token-usage-stats/specs/token-usage-display/spec.md"
},
{
"name": "跨后端对称——OpenCode 与 Zero 等价展示",
"level": "SHALL",
"source": "changes/token-usage-stats/specs/token-usage-display/spec.md"
}
],
"sourceHash": "856dbfb9",
"verify": [
{
"command": "npm run lint",
"description": "代码风格检查"
},
{
"command": "npm test",
"description": "单元测试"
},
{
"command": "npm run build",
"description": "构建验证"
}
],
"risks": [],
"generatedAt": 1783612878599
}
