import { describe, expect, it, vi } from "vitest";
import { performHardDelete } from "../sessionDelete";
import type { SessionDeleteAdapter } from "../sessionDelete";
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

function makeAdapter(opts: {
  children?: Record<string, SessionInfo[]>;
  list?: SessionInfo[];
  deleteThrowOn?: string;
  deleteOk?: boolean;
}): SessionDeleteAdapter & { deletedOrder: string[] } {
  const deletedOrder: string[] = [];
  const adapter: SessionDeleteAdapter & { deletedOrder: string[] } = {
    deletedOrder,
    deleteSession: vi.fn(async (id: string) => {
      if (opts.deleteThrowOn && id === opts.deleteThrowOn) {
        throw new Error(`delete failed for ${id}`);
      }
      deletedOrder.push(id);
    }),
    getSessionChildren: vi.fn(async (id: string) => opts.children?.[id] ?? []),
  };
  if (opts.list !== undefined) {
    adapter.listSessions = vi.fn(async () => opts.list);
  }
  return adapter;
}

describe("performHardDelete", () => {
  it("deletes a leaf session (no descendants) and returns [root]", async () => {
    const adapter = makeAdapter({ children: {}, list: [] });
    const result = await performHardDelete(adapter, "root", "/tmp");
    expect(result.deletedIds).toEqual(["root"]);
    expect(adapter.deletedOrder).toEqual(["root"]);
  });

  it("cascades descendants children-first, root last", async () => {
    // root -> c1 -> c2 ; root -> c3
    const adapter = makeAdapter({
      children: { root: [info("c1"), info("c3")], c1: [info("c2")], c2: [], c3: [] },
      list: [],
    });
    const result = await performHardDelete(adapter, "root", "/tmp");
    expect(result.deletedIds).toContain("root");
    // children deleted before root
    const order = adapter.deletedOrder;
    expect(order.indexOf("root")).toBe(order.length - 1);
    expect(order.indexOf("c2")).toBeLessThan(order.indexOf("c1"));
    expect(result.deletedIds.slice().sort()).toEqual(["c1", "c2", "c3", "root"]);
  });

  it("aborts and throws when a child DELETE fails, surfacing the id", async () => {
    const adapter = makeAdapter({
      children: { root: [info("c1")], c1: [] },
      deleteThrowOn: "c1",
    });
    await expect(performHardDelete(adapter, "root", "/tmp")).rejects.toThrow(/c1/);
  });

  it("does NOT swallow root DELETE failure", async () => {
    const adapter = makeAdapter({ children: {}, deleteThrowOn: "root" });
    await expect(performHardDelete(adapter, "root", "/tmp")).rejects.toThrow(/root/);
  });

  it("throws on post-delete verify when a deleted id still lingers in the list", async () => {
    // Backend DELETE returned ok, but the session is still in listSessions —
    // i.e. the delete did not actually persist. We must surface this.
    const adapter = makeAdapter({
      children: {},
      list: [info("root")], // still present after delete
    });
    await expect(performHardDelete(adapter, "root", "/tmp")).rejects.toThrow(/root/);
  });

  it("succeeds when post-delete list no longer contains the id", async () => {
    const adapter = makeAdapter({
      children: { root: [info("c1")], c1: [] },
      list: [info("other")], // neither root nor c1 present
    });
    const result = await performHardDelete(adapter, "root", "/tmp");
    expect(result.deletedIds.slice().sort()).toEqual(["c1", "root"]);
  });

  it("skips post-delete verify when adapter has no listSessions", async () => {
    const adapter = makeAdapter({ children: {} });
    delete (adapter as { listSessions?: unknown }).listSessions;
    const result = await performHardDelete(adapter, "root", "/tmp");
    expect(result.deletedIds).toEqual(["root"]);
  });

  it("skips descendant collection when adapter has no getSessionChildren", async () => {
    const adapter = makeAdapter({ children: {}, list: [] });
    delete (adapter as { getSessionChildren?: unknown }).getSessionChildren;
    const result = await performHardDelete(adapter, "root", "/tmp");
    expect(result.deletedIds).toEqual(["root"]);
  });

  it("passes the directory through to all adapter calls", async () => {
    const adapter = makeAdapter({ children: {}, list: [] });
    await performHardDelete(adapter, "root", "/projects/x");
    expect(adapter.deleteSession).toHaveBeenCalledWith("root", "/projects/x");
    expect(adapter.getSessionChildren).toHaveBeenCalledWith("root", "/projects/x");
    expect(adapter.listSessions).toHaveBeenCalledWith({ directory: "/projects/x" });
  });
});
