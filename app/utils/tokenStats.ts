import type { MessageTokens } from "../types/message";

export type UsageBar = {
  messageId: string;
  tokens: number;
  cost?: number;
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

export function formatCost(cost?: number): string {
  if (cost === undefined) return "";
  return `$${cost.toFixed(4)}`;
}
