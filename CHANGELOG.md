# 更新日志

所有重要的项目变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.6] - 2026-07-01

### 新增 (Added)

- 🌲 **文件树连续目录合并**：连续单子目录按 IDEA 风格折叠为单节点（`packages/foo/src` 一行展示），节点 path/handle 收敛到链尾确保展开仍正确加载
- 🔍 **文件搜索**：侧栏文件区新增搜索框，复用 @ 候选的扁平索引做包含匹配（限 100 条），快速跳到任意文件
- 📁 **@ 候选支持目录**：useFileIndex 目录条目带 `/` 后缀入索引；@ 菜单中目录条目显示文件夹图标，整目录可作为上下文交给 Agent
- ⌨️ **终端 Tab 补全**：Console 新增 Tab 补全——命令名（BUILTIN + 30+ 常用 CLI + 历史命令）+ 路径补全（readDirectory 列 cwd）；多候选用最长公共前缀 + 列表展示，单匹配直接替换并补空格/斜杠

### 修复 (Fixed)

- 🔁 **流式文本重复乱码**：`part.updated` 快照到达时 delta lens 未按文本关系重新基线，分叉快照导致后续 delta 偏移检查系统性失效、同段内容被反复追加；改用最长公共前缀（LCP）重新基线 lens，覆盖扩展/截断/分叉三种关系（含 `useDeltaAccumulator` / `useMessages` 镜像逻辑与新增单元测试）
- ✂️ **流式 Markdown 中途渲染抖动**：未闭合的代码围栏 / 行内代码 / 链接导致 markdown-it 解析异常，出现 DOM 抖动与字面标记外露；新增 `renderStreaming` 预处理在渲染前补全最小闭合符号（仅作用于流式分支，不污染最终渲染）
- 👆 **拖拽/缩放手势泄漏**：浮窗拖拽、面板缩放仅监听 `pointerup` 未监听 `pointercancel`，系统抢占/多点触控中断手势后事件监听器残留卡死；补全 `pointercancel` 监听与清理
- 🔄 **自动滚动与用户交互冲突**：流式追加时自动滚动抢占用户的手动滚动/选择；`scheduleAutoScroll` 在指针交互期间暂停，滚动容器补 `overscroll-behavior: contain` 与 `overflow-anchor: none` 防链式传播与锚点抢占
- 🧩 **子 Agent 委派后父 session 卡死**：子 Agent 在独立 session 运行时其内容事件携带子 sessionID，父 session 的 no-content 看门狗（120s）因从未收到自身 sessionID 内容而误触发；part 事件改为沿 `parentID` 链向上对每个祖先 session 清除看门狗（复用 sessions store，无需自维护映射）
- 🧹 **文本清洗补全**：`stripSystemReminder` 新增移除 `<think>...</think>` 推理块、单独成行的 chat 模板角色标记行（`assistant`/`user`）、以及多块噪声移除后残留的连续多余空行
- 💬 **对话气泡宽度与折行**：助手/用户气泡 max-width 统一为 900px（原 760/820px 不一致且偏小）；`.md-content` 由 `word-break: break-word` 改为 `overflow-wrap: anywhere`，避免 flex 子元素被压到 min-content 导致中文段落未达 max-width 即被异常截断

---

## [0.4.5] - 2026-06-29

### 新增 (Added)

- 📋 **代码块一键复制**：消息正文中的代码块（bash 命令等）hover 出现复制按钮，点击复制原始代码；渲染层 + 全局事件委托，消息正文 / release notes / openspec 等所有 markdown 处通用

### 改进 (Changed)

- 🎯 **工具智能折叠**：非编辑类工具（read/grep/bash/list 等）默认折叠，仅失败或含文件修改（edit/write）的工具默认展开，进一步减少噪音
- 📍 **复制按钮左下角**：消息复制按钮从气泡右下角移至左下角
- 🔍 **diff 仅显示修改行**：代码变更 diff 去掉未修改的上下文行，只渲染 added/removed

### 修复 (Fixed)

- 🔧 **流式去重增强**：处理 `message.part.removed` 事件清理状态（避免已删内容残留与误丢 delta）；浮窗补充去重防止重连重放重复显示；补充 fast path / tail-match 分支单元测试并完成变异验证
- 🖥️ **dev 启动修复**：dev server 端口避开 Windows Hyper-V/WSL 保留端口范围（5173 → 4173），修复 `EACCES` 启动失败

---

## [0.4.4] - 2026-06-29

### 新增 (Added)

- ⏱️ **后端无响应恢复**：Agent 120s 无输出自动失败回退，SSE 90s 静默断流自动重连，告别「正在思考」卡死
- 💭 **思考过程流式指示**：折叠态显示跳动指示与「输出中」，展开后底部一键收起，不必滚回顶部
- 🧰 **工具组智能展开**：含错误或代码变更（edit/write）的工具组默认展开，纯只读成功组折叠；摘要显示错误计数（如 `5 tools · 1 err`）
- 📝 **内联代码变更 diff**：提取 edit / write / multiedit / apply_patch 的 before/after，工具条目直接显示改了什么
- 🧭 **对话滚动导航**：打开历史会话直达最新消息；右下角 ↑/↓ 按钮（跳顶/跳最新，互斥显示）
- 📋 **消息复制**：每条消息框外右下角 hover 出现复制按钮，复制正文（不含 reasoning/工具过程）
- 🏷️ **自定义显示名称**：设置 → 外观新增 Agent / 用户名称配置，对话头部即时生效，持久化保存

---

## [0.4.3] - 2026-06-28

### 修复 (Fixed)

- 🔄 **后端切换刷新**：切换后端后显式刷新模型 / Agent / 会话列表，避免列表残留旧后端数据
- ⚡ **状态栏卡 running**：修复子 agent 完成后状态栏仍显示"运行中"的问题
- 🔼 **更新面板补全**：设置面板补齐"立即更新 / 重启安装"按钮，并统一 release notes 渲染逻辑
- 🔗 **链接外链打开**：更新弹窗中的链接改为调用系统浏览器打开，不再在 Electron 内部导航

---

## [0.4.2] - 2026-06-27

### 新增 (Added)

- 🪟 **多实例 Agent Server 协调**：多实例生命周期统一管理 + 共享配置持久化到 `specforge.config.json`，避免端口/会话冲突
- 📎 **输入框拖放附件**：支持文件 / 文件夹直接拖入 composer 自动附加到上下文
- ❓ **帮助系统**：顶栏新增帮助按钮 + 功能指南轮播弹框，新用户上手更友好
- 💬 **消息时间戳**：聊天气泡显示发送时间，并修复时间单位不一致问题

### 修复 (Fixed)

- 🐛 **Stream 文本重复**：修复 SSE 流中 `part.updated` 与 `delta` 乱序导致的文本重复渲染
- 🖼️ **图标裁切**：补全 `lucide-subset` 的 `width/height`，修复图标被裁切显示
- 🐧 **Linux 桌面图标**：修复设置面板图标和 Linux 桌面图标显示为问号
- 🌐 **i18n 补全**：关于面板剩余硬编码文案接入国际化
- 📝 **Release Notes**：用真实 release notes 替换硬编码 Highlights 占位文案
- ⚙️ **代理设置**：修复代理输入框启动后显示为空
- 🔗 **链接打开方式**：更新弹窗与设置面板中的链接改为调用系统浏览器打开，不再在 Electron 内部导航

---

## [0.4.1] - 2026-06-26

### 新增 (Added)

- 🎨 **主题系统升级**：6 套预设主题（default / ocean / forest / sakura + slate / solarized），每套主题独立配色代码块高亮
- 🌗 **跟随系统深浅模式**：根据 OS `prefers-color-scheme` 自动在配对主题间切换
- 🔄 **文件列表自动刷新**：检测到 `file.edited` 事件自动刷新侧边栏文件树 + `@` 附件菜单
- 🔧 **侧边栏文件区新增手动刷新按钮**
- 🪟 **设置面板新增 openExternalUrl IPC**：外链通过系统浏览器打开（HTTP/HTTPS 白名单）
- 🐧 **Linux AppImage 桌面集成完善** + 发布流程自洽校验脚本

### 修复 (Fixed)

- 💬 **子 agent 会话禁用输入框**：避免误发消息导致会话卡死在 running 状态

### 变更 (Changed)

- 🎨 代码语法高亮改用 Shiki 的 `css-variables` 主题，UI 主题切换无需重渲染代码块

---

## [0.1.0] - 2026-06-16

### 新增 (Added)

- 🤖 AI Agent 交互式执行功能
- 📁 智能文件树浏览（支持 Web File System API 和 Electron IPC）
- 📊 完整的会话管理系统
  - 创建新会话
  - 会话选择和切换
  - 会话历史记录
  - 会话删除功能
- 🎯 浮动窗口系统
  - 独立窗口管理
  - 窗口拖拽
  - 层级控制
  - 多窗口支持
- 💻 Electron 桌面应用
  - 本地文件系统集成
  - 原生菜单
  - 跨平台支持（Windows, macOS, Linux）
- 🌐 国际化支持（中英文）
- 🎨 UI 组件
  - 欢迎页面
  - 聊天视图
  - 文件树
  - 输入面板
  - 设置面板
  - 状态栏
  - 工具窗口（Bash, Edit, Default）
- ⚡ CLI Bridge HTTP 客户端
- 🔧 后端适配器系统
  - OpenCode 适配器
  - 后端注册表
  - 类型定义

### 技术栈 (Technical)

- Vue 3.5.28 (Composition API)
- TypeScript 6.0.3
- Vite 7.3.1
- Electron 42.4.0
- Tailwind CSS 4.1.18
- Vue Router 4.5.1
- Vue I18n 11.3.0
- Vitest 4.1.2

### 构建 (Build)

- Web 应用构建
- Electron 应用打包
- 跨平台安装包（NSIS, AppImage）

### 文档 (Documentation)

- 项目 README
- 贡献指南
- 变更日志
- 环境变量模板

---

## 版本说明

- **[Unreleased]**: 尚未发布的功能
- **[0.4.3]**: 当前稳定版本
- **[0.4.2]**: 上一稳定版本
- **[0.1.0]**: 首个公开发布版本

### 变更类型

- `新增` - 新功能
- `变更` - 功能变更
- `弃用` - 即将移除的功能
- `移除` - 已移除的功能
- `修复` - Bug 修复
- `安全` - 安全相关修复
