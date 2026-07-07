import { describe, expect, it } from "vitest";
import { collectDescendantSessionIds } from "../sessionTree";
import type { SessionChildrenFetcher } from "../sessionTree";
import type { SessionInfo } from "../../types/sse";

function info(id: string, parentID?: string): SessionInfo {
  return {
    id,
    slug: id,
    projectID: "p",
    directory: "/tmp",
    title: id,
    version: "",
    time: { created: 0, updated: 0 },
    ...(parentID ? { parentID } : {}),
  };
}

describe("collectDescendantSessionIds", () => {
  it("returns empty array when root has no children", async () => {
    const fetcher: SessionChildrenFetcher = async () => [];
    const ids = await collectDescendantSessionIds(fetcher, "root", "/tmp");
    expect(ids).toEqual([]);
  });

  it("returns empty array when backend reports undefined/null", async () => {
    const fetcher: SessionChildrenFetcher = async () => undefined;
    const ids = await collectDescendantSessionIds(fetcher, "root", "/tmp");
    expect(ids).toEqual([]);
  });

  it("collects a single level of children", async () => {
    const tree: Record<string, SessionInfo[]> = {
      root: [info("c1"), info("c2")],
      c1: [],
      c2: [],
    };
    const fetcher: SessionChildrenFetcher = async (id) => tree[id] ?? [];
    const ids = await collectDescendantSessionIds(fetcher, "root", "/tmp");
    expect(ids.sort()).toEqual(["c1", "c2"]);
  });

  it("recurses to grandchildren and beyond (BFS, root excluded)", async () => {
    // root -> c1 -> c2 -> c3 ; root -> c4
    const tree: Record<string, SessionInfo[]> = {
      root: [info("c1"), info("c4")],
      c1: [info("c2")],
      c2: [info("c3")],
      c3: [],
      c4: [],
    };
    const fetcher: SessionChildrenFetcher = async (id) => tree[id] ?? [];
    const ids = await collectDescendantSessionIds(fetcher, "root", "/tmp");
    expect(ids.sort()).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("visits each id once even if backend returns duplicates", async () => {
    const tree: Record<string, SessionInfo[]> = {
      root: [info("c1"), info("c1")],
      c1: [],
    };
    const fetcher: SessionChildrenFetcher = async (id) => tree[id] ?? [];
    const ids = await collectDescendantSessionIds(fetcher, "root", "/tmp");
    expect(ids).toEqual(["c1"]);
  });

  it("guards against cycles in malformed backend data", async () => {
    // Defensive: if backend ever returns a cycle (c1 -> c2 -> c1), we must
    // not loop forever.
    const tree: Record<string, SessionInfo[]> = {
      root: [info("c1")],
      c1: [info("c2")],
      c2: [info("c1")],
    };
    const fetcher: SessionChildrenFetcher = async (id) => tree[id] ?? [];
    const ids = await collectDescendantSessionIds(fetcher, "root", "/tmp");
    expect(ids.sort()).toEqual(["c1", "c2"]);
  });

  it("throws when a children fetch rejects, surfacing the failing id", async () => {
    const tree: Record<string, SessionInfo[]> = {
      root: [info("c1")],
      c1: [info("c2")],
    };
    const fetcher: SessionChildrenFetcher = async (id) => {
      if (id === "c1") throw new Error("network down");
      return tree[id] ?? [];
    };
    await expect(collectDescendantSessionIds(fetcher, "root", "/tmp")).rejects.toThrow(/c1/);
  });
});
