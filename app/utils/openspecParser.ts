// ---------------------------------------------------------------------------
// OpenSpec markdown 解析器(纯函数)
// ---------------------------------------------------------------------------
// 解析 OpenSpec 标准结构:
//   - proposal.md  (兼容官方 ## Intent/Scope/Approach 与 skill 版 ## Why/What Changes/Impact)
//   - tasks.md     (`## N. Group` + `- [ ]` / `- [x]` 行 + 缩进子字段)
//   - spec.md      (源真理:`### Requirement:` + `#### Scenario:`)
//   - delta spec.md(4 个固定 section:ADDED/MODIFIED/REMOVED/RENAMED Requirements)
//
// 全部函数无副作用,方便单测。task toggle 写回使用 lineOffset 定位,精确替换
// 单行,保证 evidence 子字段不被破坏。
// ---------------------------------------------------------------------------

import type {
  OpenSpecDeltaRequirement,
  OpenSpecDeltaSpec,
  OpenSpecProposal,
  OpenSpecRequirement,
  OpenSpecScenario,
  OpenSpecTask,
  OpenSpecTaskGroup,
  OpenSpecTaskStats,
  ScenarioStep,
  SpecLevel,
} from "../types/openspec";

// ── 通用工具 ────────────────────────────────────────────────────────────

const HEADER_RE = /^(#{1,6})\s+(.*)$/;
const TASK_LINE_RE = /^\s*-\s+\[([ xX])\]\s+(.*)$/;
const TASK_ID_RE = /^(\d+(?:\.\d+)*)\s+(.*)$/;

/** 按 markdown header(## Title)将文本切成 sections */
export function splitSections(md: string): Array<{ header: string; level: number; body: string }> {
  const lines = md.split(/\r?\n/);
  const sections: Array<{ header: string; level: number; body: string }> = [];
  let currentHeader = "";
  let currentLevel = 0;
  let buffer: string[] = [];

  const flush = () => {
    sections.push({
      header: currentHeader,
      level: currentLevel,
      body: buffer.join("\n"),
    });
    buffer = [];
  };

  // 第一个隐式 section(header 为空)容纳 H1 之前的所有内容
  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      if (currentHeader !== "" || buffer.length > 0) flush();
      currentLevel = m[1].length;
      currentHeader = m[2].trim();
    } else {
      buffer.push(line);
    }
  }
  if (currentHeader !== "" || buffer.length > 0) flush();
  return sections;
}

function findSection(
  sections: ReturnType<typeof splitSections>,
  level: number,
  candidates: string[],
): { header: string; body: string } | undefined {
  for (const s of sections) {
    if (s.level !== level) continue;
    const norm = s.header.trim().toLowerCase();
    if (candidates.some((c) => c.toLowerCase() === norm)) {
      return { header: s.header, body: s.body };
    }
  }
  return undefined;
}

/** 提取 markdown 列表项的纯文本(支持 - * + 三种 marker) */
export function parseBulletList(body: string): string[] {
  const items: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (m) {
      const text = m[1].trim();
      // `- name: desc` 取冒号前的 name(去 backticks)
      const colonIdx = text.indexOf(":");
      if (colonIdx > 0) {
        items.push(text.slice(0, colonIdx).replace(/`/g, "").trim());
      } else {
        items.push(text.replace(/`/g, "").trim());
      }
    }
  }
  return items;
}

// ── Requirement / Scenario 解析(源真理 spec.md 用) ───────────────────

function detectLevel(text: string): SpecLevel {
  if (/\bMUST\b/.test(text)) return "MUST";
  if (/\bSHALL\b/.test(text)) return "SHALL";
  if (/\bSHOULD\b/.test(text)) return "SHOULD";
  return "MAY";
}

function parseScenarioBody(body: string): ScenarioStep[] {
  const steps: ScenarioStep[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // `- GIVEN ...` / `- WHEN ...` / `- THEN ...` / `- AND ...`
    const m = /^[-*+]?\s*\*?\*?(GIVEN|WHEN|THEN|AND)\b\*?\*?\s*(.*)$/i.exec(line);
    if (m) {
      const kw = m[1].toUpperCase() as ScenarioStep["keyword"];
      steps.push({ keyword: kw, text: m[2].replace(/\*+/g, "").trim() });
    }
  }
  return steps;
}

export interface ParsedSpec {
  purpose?: string;
  requirements: OpenSpecRequirement[];
}

/**
 * 解析源真理 spec.md(也可用于 delta 内 ADDED/MODIFIED 部分)。
 * 匹配 `### Requirement: <Name>` 与 `#### Scenario: <Name>`。
 */
export function parseSpec(
  md: string,
  capability: string,
  source: "spec" | "delta" = "spec",
): ParsedSpec {
  const lines = md.split(/\r?\n/);
  const requirements: OpenSpecRequirement[] = [];
  let purpose: string | undefined;
  let inPurpose = false;
  let currentReq: OpenSpecRequirement | null = null;
  let currentScenario: OpenSpecScenario | null = null;
  let textBuffer: string[] = [];
  let scenarioBuffer: string[] = [];

  const flushScenario = () => {
    if (currentScenario) {
      currentScenario.steps = parseScenarioBody(scenarioBuffer.join("\n"));
      currentReq?.scenarios.push(currentScenario);
      currentScenario = null;
    }
    scenarioBuffer = [];
  };

  const flushReq = () => {
    flushScenario();
    if (currentReq) {
      currentReq.text = textBuffer.join("\n").trim();
      currentReq.level = detectLevel(currentReq.text);
      requirements.push(currentReq);
      currentReq = null;
    }
    textBuffer = [];
  };

  for (const line of lines) {
    // `## Purpose` 开启 purpose 区,直到下一个 ## 或更高级 header 结束
    if (/^##\s+Purpose\s*$/.test(line)) {
      flushReq();
      inPurpose = true;
      purpose = "";
      continue;
    }
    if (inPurpose) {
      if (/^#{1,2}\s/.test(line)) {
        inPurpose = false;
        if (purpose !== undefined) purpose = purpose.trim() || undefined;
        // 落到下面的 reqM / scenarioM 判断,不 continue
      } else {
        purpose = (purpose ?? "") + line + "\n";
        continue;
      }
    }

    const reqM = /^###\s+Requirement:\s*(.+?)\s*$/i.exec(line);
    const scenarioM = /^####\s+Scenario:\s*(.+?)\s*$/i.exec(line);

    if (reqM) {
      flushReq();
      currentReq = {
        name: reqM[1].trim(),
        level: "MAY",
        text: "",
        scenarios: [],
        capability,
        source,
      };
      continue;
    }
    if (scenarioM && currentReq) {
      flushScenario();
      currentScenario = { name: scenarioM[1].trim(), steps: [] };
      continue;
    }

    if (currentScenario) {
      scenarioBuffer.push(line);
    } else if (currentReq) {
      textBuffer.push(line);
    }
  }
  flushReq();
  if (inPurpose && purpose !== undefined) purpose = purpose.trim() || undefined;

  return { purpose, requirements };
}

// ── Delta Spec 解析 ───────────────────────────────────────────────────

const DELTA_SECTION_HEADERS: Record<string, OpenSpecDeltaRequirement["op"]> = {
  "ADDED Requirements": "added",
  "MODIFIED Requirements": "modified",
  "REMOVED Requirements": "removed",
  "RENAMED Requirements": "renamed",
};

/** 只按 H2(## Header)切分,H3/H4 等都保留在 body 里 */
function splitByH2(md: string): Array<{ header: string; body: string }> {
  const lines = md.split(/\r?\n/);
  const result: Array<{ header: string; body: string }> = [];
  let current: { header: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) result.push({ header: current.header, body: current.body.join("\n") });
      current = { header: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) result.push({ header: current.header, body: current.body.join("\n") });
  return result;
}

export function parseDeltaSpec(md: string, capability: string, path: string): OpenSpecDeltaSpec {
  // 注意:必须按 H2 切分,否则 ADDED Requirements 内部的 `### Requirement:`
  // 会被通用 splitSections 当成独立 section 切走,导致 H2 body 为空。
  const sections = splitByH2(md);
  const requirements: OpenSpecDeltaRequirement[] = [];

  for (const [header, op] of Object.entries(DELTA_SECTION_HEADERS)) {
    const sec = sections.find((s) => s.header.toLowerCase() === header.toLowerCase());
    if (!sec) continue;

    if (op === "removed") {
      // REMOVED 只需 name,匹配 `### Requirement: <Name>` 或纯列表
      for (const line of sec.body.split(/\r?\n/)) {
        const m = /^###\s+Requirement:\s*(.+?)\s*$/i.exec(line);
        if (m) {
          requirements.push({ op, name: m[1].trim() });
        }
      }
    } else if (op === "renamed") {
      // RENAMED 用 `FROM:` / `TO:` 行,值可能是 `### Requirement: Name` 或纯 Name
      const cleanName = (raw: string): string => {
        const m = /^###\s+Requirement:\s*(.+?)\s*$/i.exec(raw.trim());
        return m ? m[1].trim() : raw.trim();
      };
      let fromName: string | undefined;
      for (const line of sec.body.split(/\r?\n/)) {
        const fromM = /^[-*+]?\s*\*?\*?FROM:?\*?\*?\s*`?([^`]+?)`?\s*$/i.exec(line);
        const toM = /^[-*+]?\s*\*?\*?TO:?\*?\*?\s*`?([^`]+?)`?\s*$/i.exec(line);
        if (fromM) fromName = cleanName(fromM[1]);
        else if (toM && fromName) {
          requirements.push({
            op,
            name: cleanName(toM[1]),
            fromName,
          });
          fromName = undefined;
        }
      }
    } else {
      // ADDED / MODIFIED — 完整 requirement 结构
      const inner = parseSpec(sec.body, capability, "delta");
      for (const req of inner.requirements) {
        requirements.push({ op, name: req.name, requirement: req });
      }
    }
  }

  return { capability, path, requirements };
}

// ── Proposal 解析 ──────────────────────────────────────────────────────

export function parseProposal(md: string): OpenSpecProposal {
  const sections = splitSections(md);

  const whySec = findSection(sections, 2, ["Why"]) ?? findSection(sections, 2, ["Intent"]);
  const whatSec = findSection(sections, 2, ["What Changes"]) ?? findSection(sections, 2, ["Scope"]);
  const impactSec = findSection(sections, 2, ["Impact"]) ?? findSection(sections, 2, ["Approach"]);

  // Capabilities 子节(### New Capabilities / ### Modified Capabilities)
  const newCapSec = findSection(sections, 3, ["New Capabilities"]);
  const modCapSec = findSection(sections, 3, ["Modified Capabilities"]);

  return {
    raw: md,
    why: whySec?.body.trim() || undefined,
    whatChanges: whatSec?.body.trim() || undefined,
    capabilitiesNew: newCapSec ? parseBulletList(newCapSec.body) : [],
    capabilitiesModified: modCapSec ? parseBulletList(modCapSec.body) : [],
    impact: impactSec?.body.trim() || undefined,
  };
}

// ── Tasks 解析 ─────────────────────────────────────────────────────────

export interface ParsedTasks {
  groups: OpenSpecTaskGroup[];
  stats: OpenSpecTaskStats;
  /** 原始 markdown 行数组(用于写回) */
  rawLines: string[];
}

const GROUP_HEADER_RE = /^##\s+(\d+)\.\s*(.*)$/;

export function parseTasks(md: string): ParsedTasks {
  const rawLines = md.split(/\r?\n/);
  const groups: OpenSpecTaskGroup[] = [];
  let currentGroup: OpenSpecTaskGroup | null = null;
  let currentTask: OpenSpecTask | null = null;

  const flushTask = () => {
    if (currentTask && currentGroup) currentGroup.tasks.push(currentTask);
    currentTask = null;
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    const groupM = GROUP_HEADER_RE.exec(line);
    if (groupM) {
      flushTask();
      currentGroup = {
        title: groupM[2].trim(),
        groupIndex: parseInt(groupM[1], 10),
        tasks: [],
      };
      groups.push(currentGroup);
      continue;
    }

    if (!currentGroup) continue;

    const taskM = TASK_LINE_RE.exec(line);
    if (taskM) {
      flushTask();
      const completed = taskM[1].toLowerCase() === "x";
      const rest = taskM[2].trim();
      const idM = TASK_ID_RE.exec(rest);
      if (!idM) {
        // 不带 X.Y 前缀的列表项,跳过(不是有效 task)
        continue;
      }
      currentTask = {
        id: idM[1],
        title: idM[2].trim(),
        status: completed ? "completed" : "pending",
        groupIndex: currentGroup.groupIndex,
        groupTitle: currentGroup.title,
        lineOffset: i,
      };
      continue;
    }

    if (!currentTask) continue;

    // 缩进的子字段:Requirement / Scenario / Verification / Estimate / Depends on / Result
    const trimmed = line.trim();
    const reqM = /^-\s*Requirement:\s*(.+)$/i.exec(trimmed);
    const scnM = /^-\s*Scenario:\s*(.+)$/i.exec(trimmed);
    const verM = /^-\s*Verification:\s*`?([^`]+?)`?\s*$/i.exec(trimmed);
    const estM = /^-\s*Estimate:\s*(\d+)\s*(?:min|minutes)?\s*$/i.exec(trimmed);
    const depM = /^-\s*Depends\s+on:\s*(.+)$/i.exec(trimmed);
    const resM = /^-\s*Result:\s*(.+)$/i.exec(trimmed);
    if (reqM) currentTask.requirement = reqM[1].trim();
    else if (scnM) currentTask.scenario = scnM[1].trim();
    else if (verM) currentTask.verification = verM[1].trim();
    else if (estM) currentTask.estimate = parseInt(estM[1], 10);
    else if (depM)
      currentTask.dependsOn = depM[1]
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    else if (resM) currentTask.result = resM[1].trim();
  }
  flushTask();

  const allTasks = groups.flatMap((g) => g.tasks);
  return {
    groups,
    stats: countTaskStats(allTasks),
    rawLines,
  };
}

export function countTaskStats(tasks: OpenSpecTask[]): OpenSpecTaskStats {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  return {
    total,
    completed,
    pending: total - completed,
    progress: total === 0 ? 0 : completed / total,
  };
}

// ── Task toggle(写回用) ───────────────────────────────────────────────

/**
 * 切换某个 task 的 [ ] / [x] 状态,返回新的 rawLines(单行替换)。
 * 只改 lineOffset 处那一行,其他行原样保留,确保 evidence 子字段不被破坏。
 */
export function applyTaskToggle(rawLines: string[], taskId: string, completed: boolean): string[] {
  // 在 rawLines 里找 taskId 对应的 `- [ ]` / `- [x]` 行
  // 由于 parseTasks 已经记录了 lineOffset,这里按 id 找最准确
  // 但为保持纯函数 + 解耦,这里重新扫一遍
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const taskM = TASK_LINE_RE.exec(line);
    if (!taskM) continue;
    const rest = taskM[2].trim();
    const idM = TASK_ID_RE.exec(rest);
    if (!idM || idM[1] !== taskId) continue;

    const newBox = completed ? "[x]" : "[ ]";
    // 只替换第一个 [x]/[ ] 出现,保留行其他内容(缩进 + title)
    const replaced = line.replace(/\[([ xX])\]/, newBox);
    const next = rawLines.slice();
    next[i] = replaced;
    return next;
  }
  return rawLines;
}

/** 在 task 列表上切换状态(更新内存中的 task 对象) */
export function updateTaskStatuses(
  tasks: OpenSpecTask[],
  taskId: string,
  completed: boolean,
): OpenSpecTask[] {
  return tasks.map((t) =>
    t.id === taskId ? { ...t, status: completed ? "completed" : "pending" } : t,
  );
}
