## Context

SpecForge 已用 electron-builder 打包，`publish` 指向 GitHub Release，但主进程未集成 `electron-updater`，渲染层也无任何更新感知。`electron-updater@6.x` 已加入依赖。主进程 `electron/main.ts` 采用「IPC handler + BrowserWindow」结构，preload 通过 `contextBridge` 暴露 API，渲染层为 Vue3 + Pinia。

约束：

- Windows 目标用 NSIS，Linux 用 AppImage，macOS 暂未配置
- 仓库为 GitHub，发布走 `releaseType: release`
- 开发态（`VITE_DEV_SERVER_URL` 存在）`autoUpdater` 会报错，须跳过

## Goals / Non-Goals

**Goals:**

- 启动后自动检查更新，发现新版本时通过 UI 通知用户
- 用户可手动「检查更新」并查看下载进度
- 下载完成后提示「重启安装」
- 用户可在设置中关闭自动检查

**Non-Goals:**

- 不做差异更新（full package 即可）
- 不做强制升级（业务无关紧要）
- 不做内网/自建更新服务器（GitHub 足够）
- 不引入代码签名（Windows SmartScreen 警告可接受，后续单独立项）

## Decisions

### 1. 在 `app.whenReady` 后、`createWindow` 前初始化 autoUpdater

**为何**：autoUpdater 必须在 app ready 后调用；提前注册事件，避免错过首次 check 的 error 事件。
**替代**：放进 createWindow 内 —— 但窗口加载有延迟，可能丢事件，弃用。

### 2. 事件通过 `mainWindow.webContents.send` 单向广播，渲染层订阅

**为何**：更新事件天然是「主 → 渲染」的通知流，订阅模式最贴合；反向操作（check/quitInstall）用 `ipcMain.handle`。
**替代**：双向 invoke 轮询 —— 浪费且延迟高，弃用。

### 3. 开发态完全跳过 autoUpdater

**为何**：`electron-updater` 在 dev 下无法读取 `app-update.yml`，会抛 `ENOTFOUND` / 文件缺失。
**做法**：`if (!process.env.VITE_DEV_SERVER_URL) { initAutoUpdater(); }`，并把能力暴露成 no-op。

### 4. 自动检查开关持久化在现有 `agentConfig` 同级的用户配置文件

**为何**：项目已有 `getAgentConfig`/`setAgentConfig` 的 IPC + 配置文件机制，复用而不新建存储。
**字段**：`autoUpdate: boolean`，默认 `true`。

### 5. 渲染层用 Pinia store + 全局 Toast 组件

**为何**：更新状态跨组件共享（标题栏徽标 + 设置页 + Toast），store 最自然；Toast 已在项目内有先例。

### 6. 手动入口放在「设置 → 关于」页

**为何**：更新行为低频，不适合塞标题栏；标题栏只放一个红点徽标做提示。

## Risks / Trade-offs

- **[GitHub 限流]** 匿名调用 GitHub API 有 60 次/小时限制 → autoUpdater 内部已做节流（启动 + 每小时一次），无需额外处理
- **[无代码签名]** Windows 首次安装会被 SmartScreen 拦截 → 文档说明，后续单独做签名
- **[latest.yml 缺失]** 若发布时未正确生成 `latest.yml`，客户端永远检查不到更新 → 在发布脚本里加校验
- **[跨平台差异]** macOS 暂未启用 → `autoUpdater` 仅在 win/linux 初始化，mac 走 no-op
- **[网络失败静默]** 自动检查失败不应打扰用户 → error 事件仅在手动触发时弹 Toast

## Migration Plan

1. 发布带本变更的版本（如 0.3.0）到 GitHub Release
2. 老版本（0.2.x）若已含本变更，下次启动会自动拉到 0.3.0
3. 老版本（0.2.x）若不含本变更 —— 必须手动升级一次，之后才能自动更新
4. 回滚：若新版本有问题，发布更高版本号修复即可；autoUpdater 不支持降级

## Open Questions

- 是否需要在「下载中」提供取消按钮？→ 倾向不做，包体积小、下载快
- 是否需要 `allowDowngrade`？→ 不需要
