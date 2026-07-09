import type { MessageTokens } from "../types/message";

export type TokenSegments = {
  input: number;
  output: number;
  reasoning: number;
  cache: number;
};

export type UsageBar = {
  messageId: string;
  tokens: number;
  cost?: number;
  segments: TokenSegments;
};

export type SessionUsageStats = {
  totalTokens: number;
  totalCost: number;
  countedMessages: number;
  bars: UsageBar[];
};

export function calcTotalTokens(tokens: MessageTokens): number {
  const cacheRead = tokens.cache?.read ?? 0;
  const cacheWrite = tokens.cache?.write ?? 0;
  return tokens.input + tokens.output + tokens.reasoning + cacheRead + cacheWrite;
}

export function calcSegments(tokens: MessageTokens): TokenSegments {
  const cacheRead = tokens.cache?.read ?? 0;
  const cacheWrite = tokens.cache?.write ?? 0;
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cache: cacheRead + cacheWrite,
  };
}

export function formatCost(cost?: number): string {
  if (cost === undefined) return "";
  return `$${cost.toFixed(4)}`;
}
