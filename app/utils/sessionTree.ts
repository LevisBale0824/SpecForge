// ---------------------------------------------------------------------------
// Session tree helpers
// ---------------------------------------------------------------------------
// Pure utilities for walking the session parent→child tree. The OpenCode
// backend exposes `GET /session/:id/children` which returns ONLY the direct
// children of a session (verified against upstream anomalyco/opencode
// session.ts:596 — a single non-recursive `WHERE parentID = ?` query). These
// helpers recurse client-side when the full descendant set is needed (e.g.
// cascading a hard delete so no orphaned children survive).
// ---------------------------------------------------------------------------

import type { SessionInfo } from "../types/sse";

/** Fetcher abstraction over `adapter.getSessionChildren`. */
export type SessionChildrenFetcher = (
  sessionId: string,
  directory?: string,
) => Promise<SessionInfo[] | undefined | null>;

/**
 * Recursively collect ALL descendant session ids of `rootId` (root excluded).
 * Returns ids in DFS post-order so callers iterating the result delete
 * child-first / parent-last (spec: "删除顺序须保证子先于父").
 *
 * Each id is visited at most once (de-dup + cycle guard). If any getChildren
 * call rejects, the error is re-thrown annotated with the failing id so the
 * caller can surface an incomplete enumeration rather than orphan children.
 */
export async function collectDescendantSessionIds(
  getChildren: SessionChildrenFetcher,
  rootId: string,
  directory?: string,
): Promise<string[]> {
  const visited = new Set<string>([rootId]);
  const collected: string[] = [];

  async function walk(id: string): Promise<void> {
    let children: SessionInfo[] | undefined | null;
    try {
      children = await getChildren(id, directory);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to enumerate children of session "${id}": ${reason}`, {
        cause: error,
      });
    }
    if (!children || children.length === 0) return;
    for (const child of children) {
      if (!child?.id || visited.has(child.id)) continue;
      visited.add(child.id);
      await walk(child.id);
      collected.push(child.id);
    }
  }

  await walk(rootId);
  return collected;
}
