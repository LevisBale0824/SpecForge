import type { WorkflowTier } from "../types/workflow";

export type StagePromptName = "explore" | "propose" | "plan" | "apply" | "verify" | "review";

export interface StageContext {
  tier: WorkflowTier;
  changeId?: string;
  need?: string;
  brainstorm?: string;
  proposal?: string;
  taskId?: string;
  taskTitle?: string;
  verification?: string;
}

export type PromptSender = (sessionId: string, prompt: string) => Promise<void>;

const promptModules = import.meta.glob("../workflows/prompts/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function loadTemplate(stage: StagePromptName): string {
  const key = Object.keys(promptModules).find((k) => k.endsWith(`/prompts/${stage}.md`));
  return key ? promptModules[key] : "";
}

function fillTemplate(tpl: string, ctx: StageContext): string {
  let out = tpl.replace(/\{\{#if thorough\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, body) =>
    ctx.tier === "thorough" ? (body as string) : "",
  );
  out = out.replace(/\{\{#if lean\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, body) =>
    ctx.tier === "lean" ? (body as string) : "",
  );
  out = out.replace(/\{\{#unless lean\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_, body) =>
    ctx.tier !== "lean" ? (body as string) : "",
  );
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = (ctx as unknown as Record<string, unknown>)[key];
    return v != null ? String(v) : "";
  });
  return out.trim();
}

export function getStagePrompt(stage: StagePromptName, ctx: StageContext): string {
  return fillTemplate(loadTemplate(stage), ctx);
}

export async function injectStagePrompt(
  sessionId: string,
  stage: StagePromptName,
  ctx: StageContext,
  send: PromptSender,
): Promise<void> {
  const prompt = getStagePrompt(stage, ctx);
  if (!prompt) return;
  await send(sessionId, prompt);
}
