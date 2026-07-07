{
"changeId": "hard-delete-sessions",
"need": "hard-delete-sessions",
"tier": "standard",
"scope": {
"files": [
"src/",
"tests/"
]
},
"intent": "用户删除会话后，冷启动会话**复活**——删除只在内存生效，重启后 `refreshSessions()` 回填列表时被删会话重新出现。本变更把\"删除\"从**前端隐藏**升级为**可持久化的硬删除**（含子线程级联），并补齐确认门与失败显形，让\"删除即消失\"成立且可验收。",
"outOfScope": [
"不实现回收站 / tombstone / undo toast（用户已否决，选确认对话框）",
"不修改 archive / unarchive 语义（archive 仍为软删可恢复，与硬删是两条独立路径）",
"不实现批量删除 / \"清空全部历史\"（本次仅单个含级联）",
"不重构 `serverPool` / `instanceCoordinator` 多实例路由（除非证实根因是打错实例）",
"不做跨设备 / 云同步删除（单机桌面场景）",
"不改动 `useTaskRunner.ts` 的 `cliBridge.deleteSession` 路径（L60/65/99/103，属 CLI Bridge 独立链路，不走 `backend.deleteSession`，本次不触及）",
"不引入新依赖、不改构建配置",
"--"
],
"requirements": [
{
"name": "删除须持久化——冷启动后不可复活",
"level": "MUST",
"source": "changes/hard-delete-sessions/specs/session-deletion/spec.md"
},
{
"name": "删除须级联整棵子会话子树",
"level": "MUST",
"source": "changes/hard-delete-sessions/specs/session-deletion/spec.md"
},
{
"name": "删除前须有确认门拦截误删",
"level": "MUST",
"source": "changes/hard-delete-sessions/specs/session-deletion/spec.md"
},
{
"name": "删除失败须显形，禁止静默吞错",
"level": "MUST",
"source": "changes/hard-delete-sessions/specs/session-deletion/spec.md"
},
{
"name": "既有会话能力零回归",
"level": "MUST",
"source": "changes/hard-delete-sessions/specs/session-deletion/spec.md"
},
{
"name": "跨后端一致——OpenCode 与 Zero 对称",
"level": "SHALL",
"source": "changes/hard-delete-sessions/specs/session-deletion/spec.md"
},
{
"name": "fs.rm 兜底须安全可控——路径派生、dry-run、逃生开关",
"level": "MUST",
"source": "changes/hard-delete-sessions/specs/session-deletion/spec.md"
}
],
"sourceHash": "3f42d2f1",
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
"generatedAt": 1783380846901
}
