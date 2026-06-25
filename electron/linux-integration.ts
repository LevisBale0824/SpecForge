// ---------------------------------------------------------------------------
// linux-integration.ts — AppImage 桌面集成
// ---------------------------------------------------------------------------
// Linux AppImage 默认不会在桌面菜单里出现。这个模块提供一个 `--install`
// 入口,让用户敲一次命令就把 SpecForge 集成到 ~/.local/share/applications/。
//
// 设计要点:
//   - 只在 AppImage 模式下工作(process.env.APPIMAGE 由 AppImage runtime 注入)
//   - 不覆盖已存在的 .desktop(避免破坏用户自定义图标/分类)
//   - .desktop 的 Exec= 指向当前 AppImage 路径(electron-updater 替换文件时
//     路径不变,菜单自动跟随新版本,不需要每次更新重新 install)
//   - 桌面菜单刷新由 update-desktop-database 异步触发(失败可忽略,下次
//     登录自动刷新)
// ---------------------------------------------------------------------------

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

const DESKTOP_FILE_NAME = "specforge.desktop";

export function isLinuxAppImage(): boolean {
  return process.platform === "linux" && !!process.env.APPIMAGE;
}

export interface InstallResult {
  installed: boolean;
  alreadyExisted: boolean;
  desktopPath: string;
  execPath: string;
}

/**
 * 把 SpecForge 集成到用户桌面菜单。
 * - 如果 .desktop 已存在,只更新 Version= 行(保留用户自定义的 Icon/Categories)
 * - 如果不存在,生成完整的 .desktop 文件
 */
export function installDesktopEntry(): InstallResult {
  if (!isLinuxAppImage()) {
    throw new Error("--install 仅在 AppImage 模式下可用");
  }
  const home = app.getPath("home");
  const appsDir = path.join(home, ".local", "share", "applications");
  const desktopPath = path.join(appsDir, DESKTOP_FILE_NAME);
  const execPath = process.env.APPIMAGE!;
  const version = app.getVersion();

  fs.mkdirSync(appsDir, { recursive: true });

  if (fs.existsSync(desktopPath)) {
    // Update Version= line only; preserve everything else.
    const raw = fs.readFileSync(desktopPath, "utf-8");
    const next = /^Version=.*$/m.test(raw)
      ? raw.replace(/^Version=.*$/m, `Version=${version}`)
      : `${raw.trimEnd()}\nVersion=${version}\n`;
    if (next !== raw) {
      fs.writeFileSync(desktopPath, next, "utf-8");
    }
    refreshDesktopDatabase(appsDir);
    return { installed: true, alreadyExisted: true, desktopPath, execPath };
  }

  const content = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=SpecForge",
    `Comment=AI 编程协作工作站 v${version}`,
    `Exec="${execPath}" %U`,
    "Icon=specforge",
    "Terminal=false",
    "Categories=Development;Utility;",
    `TryExec=${execPath}`,
    `Version=${version}`,
    "",
  ].join("\n");

  fs.writeFileSync(desktopPath, content, "utf-8");
  // chmod +x the AppImage in case it lost its executable bit during download.
  try {
    fs.chmodSync(execPath, 0o755);
  } catch {
    // ignore — might be on a filesystem that doesn't support chmod
  }
  refreshDesktopDatabase(appsDir);
  return { installed: true, alreadyExisted: false, desktopPath, execPath };
}

/**
 * 告诉桌面环境(GNOME/KDE/ XFCE)立即重新扫描 applications 目录,让新写入
 * 的 .desktop 文件出现在菜单里。失败可忽略(下次登录自动刷新)。
 */
function refreshDesktopDatabase(appsDir: string): void {
  try {
    const child = spawn("update-desktop-database", [appsDir], {
      stdio: "ignore",
      detached: false,
    });
    child.on("error", () => {
      // update-desktop-database not installed (e.g. minimal WM setups) — fine.
    });
  } catch {
    // ignore
  }
}
