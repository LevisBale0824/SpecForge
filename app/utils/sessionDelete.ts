// ---------------------------------------------------------------------------
// Hard delete orchestration (backend-only)
// ---------------------------------------------------------------------------
// Pure backend logic for cascading a session hard delete. Deliberately keeps
// NO reference to any reactive/in-memory store: the caller clears memory ONLY
// after this function resolves successfully. This eliminates the historical
// "resurrection" root cause (deleteSession swallowed errors and unconditionally
// removed the session from the in-memory store, so a failed delete looked
// successful until refreshSessions() repopulated it on the next cold start).
// ---------------------------------------------------------------------------

import type { SessionInfo } from "../types/sse";
import { collectDescendantSessionIds } from "./sessionTree";

/** Subset of BackendAdapter needed to perform a hard delete. */
export type SessionDeleteAdapter = {
  deleteSession: (sessionId: string, directory?: string) => Promise<unknown>;
  getSessionChildren?: (sessionId: string, directory?: string) => Promise<unknown>;
  listSessions?: (options?: { directory?: string }) => Promise<unknown>;
};

export type HardDeleteResult = {
  /** All ids that were deleted, ordered children-first / root-last. */
  deletedIds: string[];
};

/**
 * Perform a cascading hard delete against the backend:
 *
 *   1. Recursively collect the full descendant subtree (the OpenCode
 *      `GET /session/:id/children` endpoint returns only direct children, so
 *      we recurse client-side — see sessionTree.ts).
 *   2. DELETE each id children-first, then the root. Any failure aborts and
 *      throws (surfacing the failing id); nothing is silently swallowed.
 *   3. Post-delete verify: re-list sessions for the directory and confirm none
 *      of the deleted ids linger. If any do, throw — never let the caller
 *      clear memory for data that still exists server-side.
 *
 * Returns the list of deleted ids so the caller can clear in-memory state for
 * exactly those sessions.
 */
export async function performHardDelete(
  adapter: SessionDeleteAdapter,
  sessionId: string,
  directory?: string,
): Promise<HardDeleteResult> {
  if (!sessionId) return { deletedIds: [] };

  // 1. Collect descendants (children-first ordering from BFS helper).
  const descendantIds = adapter.getSessionChildren
    ? await collectDescendantSessionIds(
        async (id, dir) => {
          const result = await adapter.getSessionChildren!(id, dir);
          return (result as SessionInfo[] | undefined) ?? undefined;
        },
        sessionId,
        directory,
      )
    : [];

  // 2. Delete children-first, then root. Abort on first failure.
  const toDelete = [...descendantIds, sessionId];
  for (const id of toDelete) {
    await adapter.deleteSession(id, directory);
  }

  // 3. Post-delete verify: confirm none linger server-side.
  if (adapter.listSessions) {
    const remaining = (await adapter.listSessions({ directory })) as SessionInfo[] | undefined;
    const survivorIds = new Set((remaining ?? []).map((s) => s?.id));
    const lingered = toDelete.filter((id) => survivorIds.has(id));
    if (lingered.length > 0) {
      throw new Error(
        `[session-deletion] delete did not persist; still present in backend: ${lingered.join(", ")}`,
      );
    }
  }

  return { deletedIds: toDelete };
}
