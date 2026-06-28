# 更新日志

所有重要的项目变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
