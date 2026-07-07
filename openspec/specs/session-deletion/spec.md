# session-deletion Specification

## Purpose

TBD - created by archiving change hard-delete-sessions. Update Purpose after archive.

## Requirements

### Requirement: 删除须持久化——冷启动后不可复活

被删除的会话 MUST 从底层存储（OpenCode/Zero 后端，必要时延伸到磁盘）真正移除。判定标准：删除完成后再触发一次全量会话回填（等价于冷启动时的 `refreshSessions` 调用 `GET /session`），该会话 ID SHALL NOT 出现在回填结果中。

#### Scenario: 主路径成功持久化

- **WHEN** 用户确认删除会话 `S`，且后端 `DELETE /session/{S}` 返回成功
- **THEN** 随后调用 `adapter.listSessions({ directory })` 等价查询时，结果 SHALL NOT 包含 `S`
- **AND** 内存中的 `sessionsStore`、`sessionStatus`、`sessionModelStore`、`sessionAgentStore` 同步清除 `S`

#### Scenario: 主路径不持久时走兜底硬删

- **WHEN** `DELETE /session/{S}` 返回成功，但回查确认 `S` 仍存在于后端列表（即上游 DELETE 不产生持久状态）
- **THEN** 系统 SHALL 触发兜底路径：通过 Electron 主进程 IPC 对该会话对应的磁盘存储执行物理移除
- **AND** 兜底执行后再次回查，`S` 须已不在列表；若仍在，SHALL 上报失败告警而非静默成功

#### Scenario: 冷启动后不复活

- **WHEN** 会话 `S` 已被确认删除（主路径或兜底任一成功）
- **AND** 用户关闭并重新打开 SpecForge，触发 `refreshSessions` 全量回填
- **THEN** `S` SHALL NOT 出现在侧栏会话列表中

### Requirement: 删除须级联整棵子会话子树

删除一个会话时，其全部后代（subagent / fork 子会话，递归到底）MUST 一并硬删除，不得遗留孤儿会话。后代集合的收集 SHALL 优先使用后端提供的全量后代接口；若仅提供直接子级，则须在客户端递归到底。

#### Scenario: 父会话带子树一并删除

- **WHEN** 用户确认删除会话 `P`，且 `P` 存在子会话 `C1`、`C1` 的子会话 `C2`
- **THEN** `P`、`C1`、`C2` 三者 SHALL 全部被硬删除
- **AND** 删除顺序须保证子先于父（或独立并行，任一失败须能定位到具体 id）

#### Scenario: 无子会话时退化为单点删除

- **WHEN** 被删除会话无任何后代
- **THEN** 行为与单个硬删除等价，不产生额外开销

#### Scenario: 子树枚举不全时安全失败

- **WHEN** 后代收集过程中某次 `getSessionChildren` 调用失败或返回不完整
- **THEN** 删除流程 SHALL 中止并显形告警，禁止"删了父但留下孤儿"

### Requirement: 删除前须有确认门拦截误删

用户主动触发删除时，MUST 弹出确认对话框，明示"此操作不可撤销"及级联范围（"将删除此会话及其所有子线程"），用户取消时 SHALL 中止整个删除流程。确认门复用既有 `ConfirmDialog` 组件，danger 样式。

#### Scenario: 用户确认后执行删除

- **WHEN** 用户点击会话上的删除按钮，并在确认对话框中点击"删除"
- **THEN** 系统进入级联硬删除流程

#### Scenario: 用户取消则中止

- **WHEN** 用户在确认对话框中点击"取消"、按 Esc、或点击遮罩关闭
- **THEN** 删除流程 SHALL 完全中止，会话状态、内存列表、后端存储均无任何变化

#### Scenario: 确认文案须中英双语

- **WHEN** 应用语言为 zh-CN 或 en
- **THEN** 确认对话框的标题、正文、按钮文案 SHALL 从 `app/locales/{zh-CN,en}.ts` 取，且正文 MUST 明确包含"不可撤销"与"级联子线程"两层语义

### Requirement: 删除失败须显形，禁止静默吞错

`deleteSession` 流程中的任何失败（HTTP 错误、兜底 fs.rm 异常、回查不一致）MUST 上报给调用方并阻断后续"清除内存"步骤，禁止仅 `console.error` 后无条件从 `sessionsStore` 移除。当前 `useBackend.ts:1122` 的 `catch{console.error}` 静默吞错行为 SHALL 被消除。

#### Scenario: 后端 DELETE 失败须阻断

- **WHEN** `adapter.deleteSession(S)` 抛出异常或返回错误
- **THEN** 流程 SHALL 中止，`S` 不得从 `sessionsStore` 移除（保持可见，避免"前端消失但后端还在"的假删除）
- **AND** 失败信息 SHALL 通过 `errorMessage` 或等价 UI 反馈通道提示用户

#### Scenario: 兜底 fs.rm 失败须告警

- **WHEN** 主进程 fs.rm 兜底抛出异常（路径不存在、权限不足等）
- **THEN** 系统 SHALL 上报失败，不得回退到"假装成功并清内存"

#### Scenario: 程序化删除保持原语义

- **WHEN** 非用户主动触发的删除（如 change 清理时 `App.vue:210` 的 `backend.deleteSession(...).catch(...)` 程序化调用）
- **THEN** 该调用 SHALL 跳过确认门（确认门仅作用于用户主动入口），但失败仍须向上抛出由调用方 `.catch` 处理

### Requirement: 既有会话能力零回归

本次变更 MUST NOT 影响 archive / unarchive / pin / unpin / revert / unrevert / fork 等既有独立 capability 的行为。`types.ts:18–20` 中三个独立 capability flag（`sessionArchive` / `sessionUnarchive` / `sessionDelete`）须保持独立，硬删路径不得改写 archive 状态字段。

#### Scenario: archive 路径不受硬删影响

- **WHEN** 用户对一个会话执行 archive（软删可恢复）
- **THEN** 该会话的 `time.archived` 字段被置位，会话数据仍存在于后端，硬删流程完全不介入

#### Scenario: fork / revert 路径不受影响

- **WHEN** 用户对会话执行 fork 或 revert
- **THEN** 其行为与本次变更前完全一致，新增的级联/确认门/兜底逻辑不触发

### Requirement: 跨后端一致——OpenCode 与 Zero 对称

`openCodeAdapter` 与 `zeroAdapter` 均暴露 `deleteSession` capability，硬删契约 SHALL 对两者对称生效。若 Zero 后端的 `DELETE` 同样不持久化，其 fs.rm 兜底须按 Zero 自身的存储规则处理（与 OpenCode 路径派生规则独立，互不污染）。

#### Scenario: OpenCode 后端硬删

- **WHEN** 活动后端为 OpenCode，用户确认删除会话 `S`
- **THEN** `S` 及其后代按本 spec 全部要求被硬删除

#### Scenario: Zero 后端硬删

- **WHEN** 活动后端为 Zero，用户确认删除会话 `S`
- **THEN** 行为与 OpenCode 后端等价（持久化、级联、确认门、失败显形）

### Requirement: fs.rm 兜底须安全可控——路径派生、dry-run、逃生开关

当且仅当主路径（后端 DELETE）经回查证实不持久时，方启用 Electron 主进程 `fs.rm` 兜底。兜底路径的待删磁盘路径 MUST 派生自 OpenCode/Zero 官方路径规则（运行时探测，如 `getPathInfo`），严禁硬编码绝对路径。兜底 SHALL 提供配置项可在设置中关闭，应对上游版本漂移导致路径规则失效的情况。

#### Scenario: 路径派生而非硬编码

- **WHEN** 兜底需定位会话 `S` 的磁盘存储路径
- **THEN** 路径 SHALL 由后端提供的路径信息接口在运行时派生得出
- **AND** 严禁在代码中硬编码平台绝对路径常量

#### Scenario: 兜底可被配置关闭

- **WHEN** 上游版本漂移导致路径规则不可靠
- **THEN** 用户或维护者 SHALL 能通过配置项关闭 fs.rm 兜底，退化为"主路径失败即显形告警"，避免误删非目标数据

#### Scenario: 多实例桶不可错位

- **WHEN** OpenCode 按 project 路径起独立实例（见 `electron/instanceCoordinator.ts`），会话按 project 分桶存储
- **THEN** 兜底删除 MUST 定位到正确实例对应的桶
- **AND** 严禁跨 project 误删（删除前须校验目标路径属于当前 `activeDirectory` 对应的实例桶）
