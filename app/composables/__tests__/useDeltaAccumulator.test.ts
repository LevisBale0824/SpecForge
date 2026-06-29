import { beforeEach, describe, expect, it } from "vitest";
import { useDeltaAccumulator } from "../useDeltaAccumulator";
import type {
  AssistantMessageInfo,
  MessagePartDeltaPacket,
  MessagePartUpdatedPacket,
  MessageUpdatedPacket,
  TextPart,
} from "../../types/sse";

// Minimal factory helpers — only the fields the accumulator actually reads.

function assistantInfo(
  id: string,
  overrides: Partial<AssistantMessageInfo> = {},
): AssistantMessageInfo {
  return {
    id,
    sessionID: "session-1",
    role: "assistant",
    time: { created: 1 },
    parentID: "",
    modelID: "m",
    providerID: "p",
    mode: "default",
    agent: "general",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  };
}

function textPart(messageID: string, id: string, text = ""): TextPart {
  return {
    id,
    sessionID: "session-1",
    messageID,
    type: "text",
    text,
  };
}

function makeEmitter() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on(event: string, listener: (payload: unknown) => void) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
    emit(event: string, payload: unknown) {
      listeners.get(event)?.forEach((fn) => fn(payload));
    },
  };
}

describe("useDeltaAccumulator", () => {
  beforeEach(() => {
    // Module-level Map persists between tests — flush it.
    useDeltaAccumulator().clear();
  });

  it("ignores deltas for messages it has never seen", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.part.delta", {
      sessionID: "s",
      messageID: "ghost",
      partID: "p1",
      field: "text",
      delta: "hello",
    } satisfies MessagePartDeltaPacket);

    expect(getMessage("ghost")).toBeUndefined();
  });

  it("accumulates text deltas into a streaming part", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    const info = assistantInfo("msg-1");
    ge.emit("message.updated", { info } satisfies MessageUpdatedPacket);

    ge.emit("message.part.updated", {
      part: textPart("msg-1", "p1", ""),
    } satisfies MessagePartUpdatedPacket);

    ge.emit("message.part.delta", {
      sessionID: "s",
      messageID: "msg-1",
      partID: "p1",
      field: "text",
      delta: "Hello ",
    } satisfies MessagePartDeltaPacket);

    ge.emit("message.part.delta", {
      sessionID: "s",
      messageID: "msg-1",
      partID: "p1",
      field: "text",
      delta: "world",
    } satisfies MessagePartDeltaPacket);

    const entry = getMessage("msg-1");
    expect(entry?.info.id).toBe("msg-1");
    const part = entry?.parts.get("p1") as TextPart | undefined;
    expect(part?.text).toBe("Hello world");
  });

  it("drops the message once it is marked complete (finish flag)", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.updated", { info: assistantInfo("msg-2") } satisfies MessageUpdatedPacket);
    expect(getMessage("msg-2")).toBeDefined();

    // `finish` (string) should trigger isComplete() and clear the entry.
    ge.emit("message.updated", {
      info: assistantInfo("msg-2", { finish: "stop" }),
    } satisfies MessageUpdatedPacket);

    expect(getMessage("msg-2")).toBeUndefined();
  });

  it("treats completed timestamps as terminal", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.updated", {
      info: assistantInfo("msg-3", { time: { created: 1, completed: 99 } }),
    } satisfies MessageUpdatedPacket);

    expect(getMessage("msg-3")).toBeUndefined();
  });

  it("always considers non-assistant messages complete", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.updated", {
      info: {
        id: "msg-user",
        sessionID: "s",
        role: "user",
        time: { created: 1 },
        agent: "general",
        model: { providerID: "p", modelID: "m" },
      } as unknown as MessageUpdatedPacket["info"],
    } satisfies MessageUpdatedPacket);

    expect(getMessage("msg-user")).toBeUndefined();
  });

  it("clears everything on connection.reconnected", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.updated", { info: assistantInfo("msg-4") } satisfies MessageUpdatedPacket);
    expect(getMessage("msg-4")).toBeDefined();

    ge.emit("connection.reconnected", undefined);
    expect(getMessage("msg-4")).toBeUndefined();
  });

  it("stops listening after the returned disposer runs", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    const off = listen(ge);

    off();

    ge.emit("message.updated", { info: assistantInfo("msg-5") } satisfies MessageUpdatedPacket);
    expect(getMessage("msg-5")).toBeUndefined();
  });

  it("skips deltas whose text is already present after a part.updated snapshot", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.updated", { info: assistantInfo("msg-dedup") } satisfies MessageUpdatedPacket);

    // Establish the part with empty text first (the accumulator drops deltas
    // for unknown parts, so this must come before any delta).
    ge.emit("message.part.updated", {
      part: textPart("msg-dedup", "p1", ""),
    } satisfies MessagePartUpdatedPacket);

    // Delta accumulates "Hello " first.
    ge.emit("message.part.delta", {
      sessionID: "s",
      messageID: "msg-dedup",
      partID: "p1",
      field: "text",
      delta: "Hello ",
    } satisfies MessagePartDeltaPacket);

    // Server snapshot arrives with the full text "Hello world" — this is
    // longer than what deltas have produced so far, so it replaces the text
    // but deltaLens stays at 6.
    ge.emit("message.part.updated", {
      part: textPart("msg-dedup", "p1", "Hello world"),
    } satisfies MessagePartUpdatedPacket);

    // Late delta "world" arrives after the snapshot already included it.
    // Without dedup this would append and produce "Hello worldworld".
    ge.emit("message.part.delta", {
      sessionID: "s",
      messageID: "msg-dedup",
      partID: "p1",
      field: "text",
      delta: "world",
    } satisfies MessagePartDeltaPacket);

    const part = getMessage("msg-dedup")?.parts.get("p1") as TextPart | undefined;
    expect(part?.text).toBe("Hello world");
  });

  it("resumes accumulating fresh deltas after dedup skips a late one", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.updated", {
      info: assistantInfo("msg-resume"),
    } satisfies MessageUpdatedPacket);
    ge.emit("message.part.updated", {
      part: textPart("msg-resume", "p1", "Hello world"),
    } satisfies MessagePartUpdatedPacket);

    // Late deltas that match the snapshot should be skipped…
    ge.emit("message.part.delta", {
      sessionID: "s",
      messageID: "msg-resume",
      partID: "p1",
      field: "text",
      delta: "Hello ",
    } satisfies MessagePartDeltaPacket);
    ge.emit("message.part.delta", {
      sessionID: "s",
      messageID: "msg-resume",
      partID: "p1",
      field: "text",
      delta: "world",
    } satisfies MessagePartDeltaPacket);

    // …but a genuinely new delta should still be appended.
    ge.emit("message.part.delta", {
      sessionID: "s",
      messageID: "msg-resume",
      partID: "p1",
      field: "text",
      delta: "!",
    } satisfies MessagePartDeltaPacket);

    const part = getMessage("msg-resume")?.parts.get("p1") as TextPart | undefined;
    expect(part?.text).toBe("Hello world!");
  });

  it("protects reasoning text from a truncating part.updated snapshot", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.updated", {
      info: assistantInfo("msg-reason"),
    } satisfies MessageUpdatedPacket);

    // A reasoning part whose text has been streamed to a long value.
    ge.emit("message.part.updated", {
      part: {
        id: "pr1",
        sessionID: "session-1",
        messageID: "msg-reason",
        type: "reasoning",
        text: "thinking deeply about the answer",
        time: { start: 1 },
      } as unknown as MessagePartUpdatedPacket["part"],
    } satisfies MessagePartUpdatedPacket);

    // A late, shorter snapshot tries to overwrite with a prefix — should be
    // ignored in favor of the longer accumulated text.
    ge.emit("message.part.updated", {
      part: {
        id: "pr1",
        sessionID: "session-1",
        messageID: "msg-reason",
        type: "reasoning",
        text: "thinking",
        time: { start: 1 },
      } as unknown as MessagePartUpdatedPacket["part"],
    } satisfies MessagePartUpdatedPacket);

    const part = getMessage("msg-reason")?.parts.get("pr1") as { text: string } | undefined;
    expect(part?.text).toBe("thinking deeply about the answer");
  });

  it("drops a delta identical to the immediately preceding one for the same field", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.updated", { info: assistantInfo("msg-fast") });
    // Seed the part with a non-empty prefix so the repeated "Hi" is NOT a
    // suffix of the whole text — this keeps the tail-match fallback from
    // masking a fast-path regression (the lens stays shorter than the text).
    ge.emit("message.part.updated", {
      part: textPart("msg-fast", "p1", "X"),
    });

    const delta = (d: string) =>
      ge.emit("message.part.delta", {
        sessionID: "s",
        messageID: "msg-fast",
        partID: "p1",
        field: "text",
        delta: d,
      } satisfies MessagePartDeltaPacket);

    // "Hi" appends -> "XHi".
    delta("Hi");
    // A byte-identical replay of "Hi" must be dropped by the fast path; the
    // lens (2) is shorter than the text (3), so no other branch can catch
    // it — without the fast path the text would become "XHiHi".
    delta("Hi");
    // A fresh delta afterwards still appends, proving the fast path didn't
    // corrupt the lens state.
    delta("!");

    const part = getMessage("msg-fast")?.parts.get("p1") as TextPart | undefined;
    expect(part?.text).toBe("XHi!");
  });

  it("drops a tail-matching delta once the lens has reached the snapshot length", () => {
    const { listen, getMessage } = useDeltaAccumulator();
    const ge = makeEmitter();
    listen(ge);

    ge.emit("message.updated", { info: assistantInfo("msg-tail") });
    // Snapshot lands with the full text "abc" before any delta arrives.
    ge.emit("message.part.updated", {
      part: textPart("msg-tail", "p1", "abc"),
    });

    const delta = (d: string) =>
      ge.emit("message.part.delta", {
        sessionID: "s",
        messageID: "msg-tail",
        partID: "p1",
        field: "text",
        delta: d,
      } satisfies MessagePartDeltaPacket);

    const text = () => (getMessage("msg-tail")?.parts.get("p1") as TextPart | undefined)?.text;

    // "abc" is folded in by the snapshot branch, advancing the lens to 3.
    delta("abc");
    // "bc" differs from the previous delta (so the fast path won't fire) but
    // matches the tail of "abc" with the lens already at the snapshot length —
    // the tail-match fallback must drop it. Without that guard the text would
    // become "abcbc".
    delta("bc");
    expect(text()).toBe("abc");

    // A genuinely new delta after the tail-match skip still appends, proving
    // the fallback didn't corrupt the lens state.
    delta("!");
    expect(text()).toBe("abc!");
  });
});
