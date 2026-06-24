## ADDED Requirements

### Requirement: 启动时自动检查更新

系统 SHALL 在生产模式（非开发服务器）下、应用 `whenReady` 完成后自动调用一次更新检查。开发模式下 SHALL 跳过检查且不抛错。

#### Scenario: 生产模式自动检查

- **WHEN** 用户启动打包后的应用
- **THEN** 系统在 `app.whenReady` 后自动调用 `autoUpdater.checkForUpdates()`

#### Scenario: 开发模式跳过

- **WHEN** 应用在开发模式（存在 `VITE_DEV_SERVER_URL`）下启动
- **THEN** 系统不初始化 `autoUpdater`，且不向渲染层发送任何更新事件

### Requirement: 发现新版本时通知用户

当检查到比当前版本更高的发布版本时，系统 SHALL 通过 IPC 向渲染层广播 `update-available` 事件，携带新版本号与发布说明摘要。

#### Scenario: 有新版本可用

- **WHEN** `autoUpdater` 触发 `update-downloaded` 之前的 `update-available` 事件
- **THEN** 渲染层收到 `{ status: 'available', version, releaseNotes }`，并展示更新提示 Toast

#### Scenario: 已是最新版本

- **WHEN** 检查完成且无更高版本
- **THEN** 仅在「手动触发」场景下向渲染层广播 `{ status: 'up-to-date' }`；自动检查时不打扰用户

### Requirement: 手动检查更新入口

设置页「关于」区域 SHALL 提供「检查更新」按钮。点击后系统 SHALL 立即调用 `checkForUpdates()`，无论 `autoUpdate` 开关状态。

#### Scenario: 手动触发并发现新版本

- **WHEN** 用户点击「检查更新」且存在新版本
- **THEN** 渲染层收到 `available` 事件并展示更新提示

#### Scenario: 手动触发且已是最新

- **WHEN** 用户点击「检查更新」且无新版本
- **THEN** 渲染层显示「已是最新版本」的 Toast 提示

#### Scenario: 手动触发失败

- **WHEN** 检查过程抛错（如网络异常）
- **THEN** 渲染层显示「检查更新失败」的错误 Toast

### Requirement: 下载进度可见

下载阶段系统 SHALL 向渲染层周期性广播 `update-download-progress` 事件，携带 `percent`、`bytesPerSecond`、`transferred`、`total`。

#### Scenario: 下载中显示进度

- **WHEN** `autoUpdater` 触发 `download-progress` 事件
- **THEN** 渲染层更新进度条 / 百分比展示

### Requirement: 下载完成后提示重启安装

下载完成后系统 SHALL 广播 `update-downloaded` 事件，渲染层 SHALL 展示「重启并安装」按钮；用户点击后调用 `autoUpdater.quitAndInstall()`。

#### Scenario: 下载完成

- **WHEN** `autoUpdater` 触发 `update-downloaded` 事件
- **THEN** 渲染层展示「重启并安装」提示

#### Scenario: 用户点击重启安装

- **WHEN** 用户点击「重启并安装」按钮
- **THEN** 主进程调用 `quitAndInstall()`，应用退出并启动新版本

### Requirement: 自动检查开关

用户 SHALL 可在设置中关闭「自动检查更新」。默认值为开启（`true`）。设置项持久化到用户配置文件。

#### Scenario: 关闭自动检查

- **WHEN** 用户在设置中将「自动检查更新」设为关闭并重启应用
- **THEN** 应用启动时不再自动调用 `checkForUpdates()`，但手动入口仍可用

#### Scenario: 默认开启

- **WHEN** 首次启动且配置文件中无 `autoUpdate` 字段
- **THEN** 系统视为 `true` 并在启动时自动检查

### Requirement: 错误处理不打扰用户

自动检查（非手动触发）发生错误时，系统 SHALL 不向用户展示任何 UI 提示，仅在控制台记录日志。

#### Scenario: 自动检查网络失败

- **WHEN** 启动时自动检查抛出网络错误
- **THEN** 渲染层不展示任何错误 UI，错误仅写入主进程控制台
