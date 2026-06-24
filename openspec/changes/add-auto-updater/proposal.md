## Why

SpecForge 通过 electron-builder 打包为桌面应用（已发布到 GitHub Release）。当前用户必须手动到 Release 页下载新版本才能升级，缺少应用内通知与一键安装。`electron-updater` 依赖已加入 `package.json` 但尚未集成，需要补齐「检测 → 通知 → 下载 → 安装」的闭环。

## What Changes

- 主进程集成 `electron-updater`，监听更新事件并通过 IPC 推送给渲染层
- 渲染层在标题栏 / 设置页提供更新通知（可用版本、下载进度、重启安装）
- 提供「检查更新」手动入口与「自动检查」开关（默认开启）
- 完善 `electron-builder` 的 `publish` 配置，确保 `latest.yml` 正常生成
- **BREAKING**：发布流程新增「必须打 tag 并推送到 GitHub」才能触达用户的环节

## Capabilities

### New Capabilities

- `app-update`: 应用自动更新能力 —— 涵盖启动时自动检查、事件通知、手动触发、下载进度与退出安装

### Modified Capabilities

<!-- 当前 openspec/specs/ 下无相关能力，全部走新增 -->

## Impact

- **依赖**：`electron-updater@^6.8.9`（已添加）
- **主进程** `electron/main.ts`：新增 `autoUpdater` 初始化、事件转发、IPC 处理器
- **预加载** `electron/preload.cjs`：暴露 `checkForUpdates` / `installUpdate` / `onUpdateEvent`
- **渲染层**：新增更新提示组件（标题栏徽标 + Toast）、设置页开关项
- **打包配置** `package.json > build`：确认 `publish.github` 完整、签名要求（Windows 可选）
- **发布流程**：CI/本地发布需打 tag → GitHub Release，autoUpdater 才能拉到 `latest.yml`
