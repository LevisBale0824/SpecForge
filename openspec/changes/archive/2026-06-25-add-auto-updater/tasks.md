## 1. 主进程集成

- [x] 1.1 在 `electron/main.ts` 新建 `updater.ts` 模块：封装 `initAutoUpdater()` 与事件广播
- [x] 1.2 注册 `autoUpdater` 事件转发：`checking-for-update` / `update-available` / `update-not-available` / `download-progress` / `update-downloaded` / `error`
- [x] 1.3 开发态守卫：`if (!process.env.VITE_DEV_SERVER_URL)` 才初始化，否则 no-op
- [x] 1.4 在 `app.whenReady` 内调用 `initAutoUpdater()`（放在 `createWindow()` 之后,确保 webContents 已就绪可接收广播）
- [x] 1.5 `autoUpdater.autoDownload = true`、`autoUpdater.autoInstallOnAppQuit = true`

## 2. IPC 与 preload

- [x] 2.1 新增 IPC：`update:check`（手动触发，返回首个事件结果）、`update:install`（调用 `quitAndInstall`）
- [x] 2.2 新增 IPC 广播通道：`update:event`，载荷形如 `{ status, version, percent, error?, releaseNotes? }`
- [x] 2.3 `electron/preload.cjs` 暴露 `checkForUpdates()`、`installUpdate()`、`onUpdateEvent(cb)`、`getUpdatePrefs()`、`setUpdateAutoCheck()`
- [x] 2.4 渲染层 `electronAPI` 类型声明（`app/types/electron.d.ts`）补齐 `UpdateEvent` / `UserUpdatePrefs`

## 3. 配置持久化

- [x] 3.1 新增 `userData/user-prefs.json` 持久化 `autoUpdate: boolean`（默认 `true`）。注:原计划复用 agentConfig,但 agentConfig 设计上不持久化,故独立存储
- [x] 3.2 `initAutoUpdater` 读取配置，若 `autoUpdate === false` 则跳过启动时自动检查
- [x] 3.3 提供 `update:setAutoCheck` / `update:getPrefs` IPC，供设置页读写开关

## 4. 渲染层状态管理（composable）

- [x] 4.1 新建 `app/composables/useUpdate.ts`：state `{ status, version, percent, error, lastCheckedAt }`（注:项目无 Pinia,沿用 composables 单例模式）
- [x] 4.2 在 composable 首次调用时订阅 `onUpdateEvent` 并更新 state
- [x] 4.3 action `checkForUpdates()` 调用 IPC，在 `up-to-date` / `error` 时 resolve
- [x] 4.4 action `installUpdate()` 调用 IPC

## 5. UI 组件

- [x] 5.1 新增 `UpdateToast.vue` 全局组件：监听 store，在 `available` / `progress` / `downloaded` / 手动结果时展示对应 UI
- [x] 5.2 标题栏新增更新红点徽标：仅当 `status === 'downloaded'` 显示（点击齿轮打开设置）
- [x] 5.3 设置页「关于」标签页新增「检查更新」按钮 + 「自动检查更新」开关
- [x] 5.4 进度展示：下载中显示百分比进度条，「重启并安装」按钮在 `downloaded` 后出现

## 6. 打包与发布

- [x] 6.1 校验 `package.json > build.publish.github` 配置完整（补齐 `owner`/`repo`）
- [x] 6.2 确认 `publish` 与 `win`/`linux` 同级、不会被覆盖，electron-builder 会自动生成 `latest.yml`
- [x] 6.3 README 补充「发布流程：打 tag → push → 上传 release/latest.yml」

## 7. 验证

- [x] 7.1 `pnpm typecheck` + `pnpm lint` + `pnpm test`（64 测试全绿,0 lint 错误）；dev 模式 autoUpdater 走 no-op 分支,不会报错
- [x] 7.2 本地打包一次，确认 `release/latest.yml` 生成且包含正确版本号 ✓ 实测:v0.3.0~v0.3.6 多次打包,latest.yml 均正确生成
- [x] 7.3 模拟「当前版本 < Release 版本」场景，验证自动检查与提示链路 ✓ 实测:0.3.1 启动自动拉到 0.3.2,系统代理生效,端到端通过
- [x] 7.4 手动「检查更新」按钮在「有更新 / 无更新 / 失败」三种场景下的 UI 表现 ✓ 实测:有更新弹对话框、已是最新弹 Toast、网络错误 Toast
- [x] 7.5 关闭「自动检查」开关后重启，确认不再自动触发检查 ✓ 代码路径验证:initAutoUpdater 读 prefs.autoUpdate,为 false 时跳过 setTimeout 自动检查
