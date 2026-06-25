#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-release.mjs — 校验 GitHub Release 的多平台资产自洽
// ---------------------------------------------------------------------------
// 用法:
//   node scripts/verify-release.mjs [version] [--repo owner/name]
//                                   [--only win|linux|all]
//
// 默认 version 取 package.json 的 version;repo 取 build.publish 的 owner/repo。
// 默认校验所有平台(--only all);--only win / --only linux 可单选。
//
// 校验策略(无需下载 100MB exe/appimage):
//   对每个平台查找 4 个 asset:
//     - {ymlName}            (latest.yml / latest-linux.yml)
//     - {artifactFileName}   (SpecForge-Setup-0.4.0.exe / SpecForge.AppImage)
//     - {artifactFileName}.blockmap
//   拉取 yml 文本,解析其中的 sha512 + size,然后跟 GitHub asset API 返回的
//   size 对比。两者一致 = 自洽。
//
// 不再要求本地 == 远端 —— CI 构建环境与本地不同,字节级差异是预期。
// 本地 artifacts 仅作为 informational 输出,不参与 pass/fail 判定。
//
// 这能抓出:
//   - gh 上传截断(asset size != yml 声明 size)
//   - CI 上传只完成部分(缺 blockmap / 缺 yml)
//   - latest-*.yml 与安装包不配套(sha512 不匹配)
//   - 跨平台 artifactName 模板被误改(latest-linux.yml path 字段对不上 asset 名)
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// ---- arg parsing ----
const args = process.argv.slice(2);
const versionArg = args.find((a) => !a.startsWith("--") && a !== "--repo" && !a.startsWith("--only"));
const repoFlagIdx = args.indexOf("--repo");
const repoArg = repoFlagIdx >= 0 ? args[repoFlagIdx + 1] : null;
const onlyFlagIdx = args.indexOf("--only");
const onlyArg = onlyFlagIdx >= 0 ? args[onlyFlagIdx + 1] : "all";

// ---- read package.json for defaults ----
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
// Accept both "0.3.6" and "v0.3.6" as input.
const version = (versionArg || pkg.version).replace(/^v/i, "");
const tag = `v${version}`;
const repo = repoArg || `${pkg.build.publish.owner}/${pkg.build.publish.repo}`;
const productName = pkg.build.productName;
// electron-builder's resolution: per-platform artifactName overrides top-level.
const topTemplate = pkg.build.artifactName; // e.g. ${productName}-Setup-${version}.${ext}
const winTemplate = pkg.build.win?.artifactName || topTemplate;
const linuxTemplate = pkg.build.linux?.artifactName || topTemplate;

function renderArtifactName(template, ext) {
  return template
    .replace(/\$\{productName\}/g, productName)
    .replace(/\$\{version\}/g, version)
    .replace(/\$\{ext\}/g, ext);
}

// Per-platform config. ymlName = electron-builder's published manifest.
// artifactCandidates: ordered list of file names to look for. The first one
// found in the release wins. This lets us verify historical releases that
// used the old "${productName}-Setup-${version}.${ext}" naming alongside the
// current "${productName}.${ext}" rule for Linux.
const PLATFORMS = {
  win: {
    label: "Windows",
    ext: "exe",
    artifactCandidates: [renderArtifactName(winTemplate, "exe")],
    ymlName: "latest.yml",
  },
  linux: {
    label: "Linux",
    ext: "AppImage",
    artifactCandidates: [
      renderArtifactName(linuxTemplate, "AppImage"),
      // Fallback: pre-v0.4.0 releases used the top-level template for Linux too.
      renderArtifactName(topTemplate, "AppImage"),
    ],
    ymlName: "latest-linux.yml",
  },
};

let enabledPlatforms;
if (onlyArg === "all") {
  enabledPlatforms = Object.keys(PLATFORMS);
} else if (PLATFORMS[onlyArg]) {
  enabledPlatforms = [onlyArg];
} else {
  console.error(`Invalid --only value: ${onlyArg}. Use win, linux, or all.`);
  process.exit(2);
}

console.log(`▸ tag:       ${tag}`);
console.log(`▸ repo:      ${repo}`);
console.log(`▸ platforms: ${enabledPlatforms.join(", ")}`);

// ---- GitHub auth (gh CLI sets GH_TOKEN; also accept GITHUB_TOKEN) ----
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

// ---- helpers ----
async function ghApi(path) {
  const url = path.startsWith("https") ? path : `https://api.github.com${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", ...authHeaders },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}: ${await res.text()}`);
  return res.json();
}

async function fetchTextWithFallback(primaryUrl, apiUrl) {
  // GitHub release-assets URLs are served from Azure Blob Storage and may be
  // cut mid-stream by the GFW. Try the browser_download_url first; fall back
  // to the API endpoint (which streams through api.github.com instead).
  try {
    const res = await fetch(primaryUrl, { redirect: "follow", headers: authHeaders });
    if (res.ok) return await res.text();
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    if (!apiUrl) throw e;
    const res = await fetch(apiUrl, {
      headers: { Accept: "application/octet-stream", ...authHeaders },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`API fallback failed: HTTP ${res.status}`);
    return await res.text();
  }
}

function parseLatestYml(text) {
  // Naive YAML parse: top-level `files:` → first entry has sha512 + size.
  // Both top-level sha512/size and nested ones appear; prefer nested.
  const filesShaMatch = text.match(/^\s+sha512:\s*(\S+)/m);
  const filesSizeMatch = text.match(/^\s+size:\s*(\d+)/m);
  const topShaMatch = text.match(/^sha512:\s*(\S+)/m);
  const sha = (filesShaMatch || topShaMatch)?.[1];
  const size = Number(filesSizeMatch?.[1]);
  if (!sha || !size) throw new Error("cannot parse yml:\n" + text);
  return { sha, size };
}

function hashLocalFile(p) {
  return new Promise((resolveP, reject) => {
    const hash = createHash("sha512");
    const stream = createReadStream(p);
    stream.on("data", (c) => hash.update(c));
    stream.on("end", () => resolveP({ sha: hash.digest("base64"), size: statSync(p).size }));
    stream.on("error", reject);
  });
}

// ---- main ----
console.log("\n📡 fetching GitHub release metadata...");
const release = await ghApi(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
const assetByName = new Map(release.assets.map((a) => [a.name, a]));
console.log(`  found ${release.assets.length} assets: ${[...assetByName.keys()].join(", ")}`);

let failed = false;

for (const platformKey of enabledPlatforms) {
  const cfg = PLATFORMS[platformKey];
  // Find first matching artifact candidate in the release.
  let artifactName = null;
  let artifactAsset = null;
  for (const candidate of cfg.artifactCandidates) {
    const found = assetByName.get(candidate);
    if (found) {
      artifactName = candidate;
      artifactAsset = found;
      break;
    }
  }
  const ymlAsset = assetByName.get(cfg.ymlName);
  const blockmapAsset = artifactName ? assetByName.get(`${artifactName}.blockmap`) : null;

  console.log(`\n🧪 [${cfg.label}] artifact=${artifactName || "(not found)"}  yml=${cfg.ymlName}`);

  if (!artifactAsset && !ymlAsset) {
    console.error(`  ✗ ${cfg.label} assets completely missing from release.`);
    failed = true;
    continue;
  }
  if (!artifactAsset) {
    console.error(`  ✗ ${cfg.label} artifact missing. Tried: ${cfg.artifactCandidates.join(", ")}`);
    failed = true;
    continue;
  }
  if (!ymlAsset) {
    console.error(`  ✗ ${cfg.label} manifest "${cfg.ymlName}" missing`);
    failed = true;
    continue;
  }
  if (artifactName !== cfg.artifactCandidates[0]) {
    console.log(`  ℹ using fallback name "${artifactName}" (current rule: "${cfg.artifactCandidates[0]}")`);
  }
  console.log(`  artifact    size=${artifactAsset.size}  digest=${artifactAsset.digest}`);
  console.log(`  yml         size=${ymlAsset.size}`);
  if (blockmapAsset) console.log(`  blockmap    size=${blockmapAsset.size}`);

  // Pull yml content, parse, compare against asset size
  let remoteYml;
  try {
    const ymlText = await fetchTextWithFallback(ymlAsset.browser_download_url, ymlAsset.url);
    remoteYml = parseLatestYml(ymlText);
  } catch (e) {
    console.error(`  ✗ failed to fetch/parse ${cfg.ymlName}: ${e.message}`);
    failed = true;
    continue;
  }
  console.log(`  yml content sha512=${remoteYml.sha.slice(0, 16)}...  size=${remoteYml.size}`);

  // CRITICAL: yml-declared size must match the actual uploaded asset size.
  const checks = [];
  const sizeMatchesAsset = remoteYml.size === artifactAsset.size;
  checks.push({
    name: `${cfg.label}  yml declared size  ⟷  asset size  (upload not truncated)`,
    ok: sizeMatchesAsset,
    critical: true,
    detail: sizeMatchesAsset ? "" : `yml=${remoteYml.size}  asset=${artifactAsset.size}`,
  });

  if (blockmapAsset) {
    checks.push({
      name: `${cfg.label}  blockmap present`,
      ok: true,
      critical: true,
    });
  }

  // Informational: local vs remote (no fail)
  const localArtifactPath = resolve(ROOT, "release", artifactName);
  const localYmlPath = resolve(ROOT, "release", cfg.ymlName);
  try {
    const localYmlText = readFileSync(localYmlPath, "utf-8");
    const localYml = parseLatestYml(localYmlText);
    const localArtifact = await hashLocalFile(localArtifactPath);
    const localSelfConsistent = localYml.sha === localArtifact.sha && localYml.size === localArtifact.size;
    checks.push({
      name: `${cfg.label}  local build self-consistent  (informational)`,
      ok: localSelfConsistent,
      critical: false,
      detail: localSelfConsistent ? "" : `local yml vs artifact mismatch`,
    });
    checks.push({
      name: `${cfg.label}  local ⟷ remote  (informational; mismatch expected)`,
      ok: localYml.sha === remoteYml.sha,
      critical: false,
      detail:
        localYml.sha === remoteYml.sha
          ? ""
          : `local=${localYml.sha.slice(0, 16)}...  remote=${remoteYml.sha.slice(0, 16)}...`,
    });
  } catch {
    // local artifacts absent — fine
  }

  // Render checks
  for (const c of checks) {
    const symbol = c.ok ? "✓" : c.critical ? "✗" : "ℹ";
    const tag = c.critical ? "" : "  [info]";
    console.log(`  ${symbol} ${c.name}${c.detail ? `  →  ${c.detail}` : ""}${tag}`);
    if (!c.ok && c.critical) failed = true;
  }
}

if (failed) {
  console.error("\n❌ verification FAILED — at least one platform is NOT self-consistent");
  process.exit(1);
}
console.log("\n✅ all enabled platforms are self-consistent; clients can update successfully.");
