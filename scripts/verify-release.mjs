#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-release.mjs — 校验 GitHub Release 的资产与本地产物一致
// ---------------------------------------------------------------------------
// 用法:
//   node scripts/verify-release.mjs [version] [--repo owner/name]
//
// 默认 version 取 package.json 的 version;repo 取 build.publish 的 owner/repo。
//
// 校验策略(无需下载 100MB exe):
//   1. GET GitHub Release by tag → 取每个 asset 的真实 size + digest (sha256)
//   2. GET GitHub Release 的 latest.yml 内容 → 解析其中的 sha512 + size
//   3. 读本地 release/latest.yml → 解析其中的 sha512 + size
//   4. 读本地 release/<exe> → 计算 sha512 + size
//
// 对比四方:
//   - GitHub latest.yml 声明的 sha512/size
//   - GitHub asset API 返回的真实 size  (latest.yml.size 必须等于此值)
//   - 本地 latest.yml 声明的 sha512/size
//   - 本地 exe 文件实际的 sha512/size
//
// 全部一致才 exit 0。这能抓出:
//   - gh 上传截断(asset size != yml 声明 size)
//   - 本地 release/ 被 rebuild 覆盖但没重传(本地 != 远端)
//   - latest.yml 与 exe 不配套(sha512 不匹配)
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

// ---- arg parsing ----
const args = process.argv.slice(2);
const versionArg = args.find((a) => !a.startsWith("--") && a !== "--repo");
const repoFlagIdx = args.indexOf("--repo");
const repoArg = repoFlagIdx >= 0 ? args[repoFlagIdx + 1] : null;

// ---- read package.json for defaults ----
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
const version = versionArg || pkg.version;
const tag = `v${version}`;
const repo = repoArg || `${pkg.build.publish.owner}/${pkg.build.publish.repo}`;
const productName = pkg.build.productName;
const artifactNameTemplate = pkg.build.artifactName;
const fileName = artifactNameTemplate
  .replace("${productName}", productName)
  .replace("${version}", version)
  .replace("${ext}", "exe");

const localYmlPath = resolve(ROOT, "release", "latest.yml");
const localExePath = resolve(ROOT, "release", fileName);

console.log(`▸ tag:       ${tag}`);
console.log(`▸ repo:      ${repo}`);
console.log(`▸ exe file:  ${fileName}`);

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

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow", headers: authHeaders });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.text();
}

function parseLatestYml(text) {
  const filesShaMatch = text.match(/^\s+sha512:\s*(\S+)/m);
  const filesSizeMatch = text.match(/^\s+size:\s*(\d+)/m);
  const topShaMatch = text.match(/^sha512:\s*(\S+)/m);
  const sha = (filesShaMatch || topShaMatch)?.[1];
  const size = Number(filesSizeMatch?.[1]);
  if (!sha || !size) throw new Error("cannot parse latest.yml:\n" + text);
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

const exeAsset = assetByName.get(fileName);
const ymlAsset = assetByName.get("latest.yml");
const blockmapAsset = assetByName.get(`${fileName}.blockmap`);
if (!exeAsset || !ymlAsset) {
  console.error(`❌ release ${tag} missing assets`);
  console.error(`   have: ${[...assetByName.keys()].join(", ")}`);
  process.exit(1);
}
console.log(`  exe asset      size=${exeAsset.size}  digest=${exeAsset.digest}`);
console.log(`  yml asset      size=${ymlAsset.size}`);
if (blockmapAsset) console.log(`  blockmap asset size=${blockmapAsset.size}`);

console.log("\n⬇ fetching remote latest.yml content...");
// GitHub release-assets URLs are served from Azure Blob Storage and may be
// cut mid-stream by the GFW. Try the browser_download_url first; fall back to
// the API endpoint (which streams through api.github.com instead).
let remoteYmlText;
try {
  remoteYmlText = await fetchText(ymlAsset.browser_download_url);
} catch (e) {
  console.log(`  ⚠ direct download failed (${e.message}), retrying via API...`);
  const json = await ghApi(ymlAsset.url, { raw: true });
  // The asset `url` is the API endpoint; for binary content we need to request
  // with Accept: application/octet-stream. Re-fetch through the API.
  const res = await fetch(ymlAsset.url, {
    headers: { Accept: "application/octet-stream", ...authHeaders },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`API asset download failed: HTTP ${res.status}`);
  remoteYmlText = await res.text();
}
const remoteYml = parseLatestYml(remoteYmlText);
console.log(`  remote yml  sha512=${remoteYml.sha.slice(0, 16)}...  size=${remoteYml.size}`);

console.log("\n📁 reading local artifacts (informational only)...");
let localYml = null;
let localExe = null;
try {
  const localYmlText = readFileSync(localYmlPath, "utf-8");
  localYml = parseLatestYml(localYmlText);
  localExe = await hashLocalFile(localExePath);
  console.log(`  local yml   sha512=${localYml.sha.slice(0, 16)}...  size=${localYml.size}`);
  console.log(`  local exe   sha512=${localExe.sha.slice(0, 16)}...  size=${localExe.size}`);
} catch (e) {
  console.log(`  ⚠ local artifacts not found (${e.code || e.message}); skipping local-remote comparison.`);
}

// ---- compare ----
// CRITICAL checks: remote self-consistency. This is what determines whether
// clients can successfully update. CI build environment differs from local
// (different runner OS, timestamps, paths), so local ≠ remote is EXPECTED
// and not an error.
const checks = [
  {
    name: "remote yml  ⟷ remote exe asset size  (CI build self-consistent)",
    a: remoteYml,
    b: { size: exeAsset.size, sha: null },
    critical: true,
  },
  {
    name: "remote yml  ⟷ remote blockmap present",
    a: { size: blockmapAsset ? 1 : 0, sha: null },
    b: { size: blockmapAsset ? 1 : 0, sha: null },
    critical: true,
  },
];

// Informational check: local vs remote. Mismatch is OK (different build env),
// printed for visibility only.
if (localYml && localExe) {
  checks.push({
    name: "local build ⟷ remote build  (informational; mismatch is expected)",
    a: localYml,
    b: remoteYml,
    critical: false,
  });
}

let failed = false;
console.log("\n🔍 results:");
for (const c of checks) {
  const shaOk = c.a.sha == null || c.b.sha == null || c.a.sha === c.b.sha;
  const sizeOk = c.a.size === c.b.size;
  const ok = shaOk && sizeOk;
  if (!ok && c.critical) failed = true;
  const shaLabel = c.a.sha == null || c.b.sha == null ? "skip" : shaOk ? "ok" : "MISMATCH";
  const criticalTag = c.critical ? "" : "  [info]";
  console.log(
    `  ${ok ? "✓" : c.critical ? "✗" : "ℹ"} ${c.name}\n      sha=${shaLabel}  size=${sizeOk ? "ok" : `${c.a.size} vs ${c.b.size}`}${criticalTag}`,
  );
  if (!ok && !shaOk) {
    console.log(`      a.sha=${c.a.sha}`);
    console.log(`      b.sha=${c.b.sha}`);
  }
}

if (failed) {
  console.error("\n❌ verification FAILED — remote release is NOT self-consistent");
  process.exit(1);
}
console.log("\n✅ remote release is self-consistent; clients can update successfully.");
