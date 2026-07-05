// ---------------------------------------------------------------------------
// Stage Title Encoding
// ---------------------------------------------------------------------------
// Encodes a (workflowKey × stage) binding into a session's title as a suffix,
// so the binding travels with the session itself instead of depending on
// localStorage. This lets us recover stage bindings when the localStorage
// registry is cleared, the change was created externally, or the app is
// opened on a different machine.
//
// Format:  "<visible title> ⌁sf:<stage>:<workflowKey>"
//
// The "⌁" (zigzag) sentinel is unusual enough that real titles never contain
// it; we treat any line lacking the sentinel as "no binding encoded".
//
// Stage sessions are filtered out of the main sidebar list (see SidePanel),
// so this suffix is invisible during normal use.
// ---------------------------------------------------------------------------

import type { StepName } from "../types/workflow";

const SENTINEL = "⌁sf:";
const SENTINEL_REGEX = /\s*⌁sf:([a-zA-Z]+):([^\s⌁]+)\s*$/;
const SENTINEL_STRIP_REGEX = /\s*⌁sf:[^\s⌁]+:[^\s⌁]+\s*$/;

export interface StageBinding {
  stage: StepName;
  workflowKey: string;
}

/**
 * Parse the trailing `⌁sf:<stage>:<workflowKey>` suffix from a title.
 * Returns undefined when the title has no encoded binding.
 */
export function decodeStageBinding(title: string | undefined | null): StageBinding | undefined {
  if (!title) return undefined;
  const match = title.match(SENTINEL_REGEX);
  if (!match) return undefined;
  return { stage: match[1] as StepName, workflowKey: match[2] };
}

/**
 * Remove any `⌁sf:...` suffix from a title, returning the clean user-visible
 * portion. Used both when rendering and when deriving a fresh auto-title.
 */
export function stripStageSuffix(title: string | undefined | null): string {
  if (!title) return "";
  return title.replace(SENTINEL_STRIP_REGEX, "").trimEnd();
}

/**
 * Append (or replace) the stage-binding suffix on a title.
 * If the title already carries a suffix, it is replaced with the new binding.
 * Returns the encoded title, or the original title when binding is missing.
 */
export function encodeStageSuffix(title: string | undefined | null, binding: StageBinding): string {
  const base = stripStageSuffix(title);
  if (!binding.stage || !binding.workflowKey) return base;
  return `${base} ${SENTINEL}${binding.stage}:${binding.workflowKey}`;
}
