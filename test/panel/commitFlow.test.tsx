import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CommitReceipt } from "../../shared/types.js";
import type { Bridge } from "../../ui/src/bridge.js";
import { previewState } from "../../ui/src/preview.js";
import { useCommitFlow } from "../../ui/src/hooks/useCommitFlow.js";
import { usePassages } from "../../ui/src/hooks/usePassages.js";

/** A bridge that records what was called and answers however a test says to. */
interface StubBridge extends Bridge {
  calls: string[];
  /** Arguments per call, so a test can assert what actually travelled. */
  sent: Array<Record<string, unknown>>;
}

/**
 * Builds a bridge whose answers a test controls.
 *
 * @param answers - Result per tool name; anything unlisted succeeds emptily.
 * @returns The bridge, with the call log attached.
 */
function stubBridge(answers: Record<string, CallToolResult> = {}): StubBridge {
  const calls: string[] = [];
  const sent: Array<Record<string, unknown>> = [];
  return {
    calls,
    sent,
    async callTool(name, args) {
      calls.push(name);
      sent.push(args);
      return answers[name] ?? { content: [{ type: "text", text: "ok" }], structuredContent: {} };
    },
    async updateModelContext() {
      return {};
    },
    async sendMessage() {
      return {};
    },
  };
}

/** A refusal carrying a reason, which is how a tool declines a call. */
const refusal = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

const receipt: CommitReceipt = {
  ok: true,
  path: "/preview/file.yml",
  display: "file.yml",
  mode: "overwrite",
  bytes: 10,
  lines: 1,
  sha256: "a".repeat(64),
  dryRun: true,
  editedByHuman: false,
};

/**
 * Renders the commit flow against a stub bridge.
 *
 * @param bridge - The bridge to drive it with.
 * @param spies - Callbacks to observe.
 * @returns The rendered hook.
 */
function renderFlow(
  bridge: Bridge,
  spies: {
    onCommitted?: (r: CommitReceipt) => void;
    onDiscarded?: () => void;
    onFailure?: (m: string | null) => void;
  } = {},
) {
  return renderHook(() =>
    useCommitFlow({
      bridge,
      state: previewState(),
      content: "what is on screen\n",
      ack: false,
      onCommitted: spies.onCommitted ?? (() => {}),
      onDiscarded: spies.onDiscarded ?? (() => {}),
      onFailure: spies.onFailure ?? (() => {}),
    }),
  );
}

describe("committing", () => {
  /*
   * The flush before a commit carries what is on screen. If it is refused the
   * server still holds whatever the debounce last managed to send, so committing
   * anyway writes bytes nobody looked at and reports a green receipt for them.
   */
  it("does not commit when the flush of the final content was refused", async () => {
    // Arrange.
    const bridge = stubBridge({ editor_update: refusal("This proposal has already resolved.") });
    const onFailure = vi.fn();
    const { result } = renderFlow(bridge, { onFailure });

    // Act.
    await act(() => result.current.commit());

    // Assert.
    expect(bridge.calls).toEqual(["editor_update"]);
    expect(bridge.calls).not.toContain("editor_commit");
    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining("nothing was written"));
  });

  it("reports a refusal that carries no text at all", async () => {
    // Arrange: a host may refuse without saying why, and an empty string reads
    // as "no failure" to every caller that renders on truthiness.
    const bridge = stubBridge({ editor_commit: { content: [], isError: true } });
    const onFailure = vi.fn();
    const { result } = renderFlow(bridge, { onFailure });

    // Act.
    await act(() => result.current.commit());

    // Assert: the reason has to be renderable, not merely non-null. Filtering
    // the falsy values out first and then asserting the survivors are truthy
    // cannot fail, and a whitespace-only reason still puts nothing on screen.
    const reported = onFailure.mock.calls.at(-1)?.[0] as string | null;
    expect(reported?.trim(), "a blank reason renders as no failure at all").toBeTruthy();
  });

  it("surfaces a commit that came back without a receipt", async () => {
    // Arrange: the file may well have been written, so this cannot be silent.
    const bridge = stubBridge({
      editor_commit: { content: [{ type: "text", text: "wrote it" }] },
    });
    const onFailure = vi.fn();
    const onCommitted = vi.fn();
    const { result } = renderFlow(bridge, { onFailure, onCommitted });

    // Act.
    await act(() => result.current.commit());

    // Assert.
    expect(onCommitted).not.toHaveBeenCalled();
    const reported = onFailure.mock.calls.map(([m]) => m).filter(Boolean);
    expect(reported[0]).toMatch(/no receipt/i);
  });

  it("tells the model what landed before handing over the receipt", async () => {
    // Arrange: past the receipt the review is unmounted, so a failure raised
    // after it has nowhere left to render.
    const order: string[] = [];
    const bridge: Bridge = {
      async callTool(name) {
        order.push(name);
        return name === "editor_commit"
          ? { content: [], structuredContent: receipt }
          : { content: [], structuredContent: {} };
      },
      async updateModelContext() {
        order.push("updateModelContext");
        return {};
      },
      async sendMessage() {
        return {};
      },
    };
    const { result } = renderFlow(bridge, { onCommitted: () => order.push("onCommitted") });

    // Act.
    await act(() => result.current.commit());

    // Assert.
    expect(order).toEqual(["editor_update", "editor_commit", "updateModelContext", "onCommitted"]);
  });
});

describe("discarding", () => {
  it("reaches a terminal state rather than leaving the review live", async () => {
    // Arrange.
    const bridge = stubBridge();
    const onDiscarded = vi.fn();
    const { result } = renderFlow(bridge, { onDiscarded });

    // Act.
    await act(() => result.current.discard());

    // Assert.
    expect(onDiscarded).toHaveBeenCalledOnce();
  });

  it("stays silent in chat when the opening call already reported it", async () => {
    // Arrange: under --block-on-review the opener has returned saying the same
    // thing, so a message on top tells the agent about one discard twice.
    const sent: string[] = [];
    const bridge: Bridge = {
      async callTool() {
        return { content: [], structuredContent: { delivered: true } };
      },
      async updateModelContext() {
        return {};
      },
      async sendMessage(text) {
        sent.push(text);
        return {};
      },
    };
    const { result } = renderFlow(bridge);

    // Act.
    await act(() => result.current.discard());

    // Assert.
    expect(sent).toEqual([]);
  });

  it("does not claim a discard the server refused", async () => {
    // Arrange.
    const bridge = stubBridge({ editor_discard: refusal("Unknown proposal.") });
    const onDiscarded = vi.fn();
    const onFailure = vi.fn();
    const { result } = renderFlow(bridge, { onDiscarded, onFailure });

    // Act.
    await act(() => result.current.discard());

    // Assert.
    expect(onDiscarded).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith("Unknown proposal.");
  });
});

describe("sending comments", () => {
  it("refuses to send a highlight nobody commented on", async () => {
    // Arrange: a live selection counts as selected, so it must obey the same
    // rule the tray enforces on screen.
    const bridge = stubBridge();
    const { result } = renderHook(() => usePassages(bridge, "id", "file.yml", () => {}));

    act(() => {
      result.current.select({
        id: "editor:0-5",
        source: "editor",
        text: "stray",
        startLine: 1,
        endLine: 1,
      });
    });

    // Act.
    await act(() => result.current.send());

    // Assert.
    expect(bridge.calls).toEqual([]);
  });

  it("counts the live selection as outgoing", () => {
    // Arrange.
    const bridge = stubBridge();
    const { result } = renderHook(() => usePassages(bridge, "id", "file.yml", () => {}));

    // Act.
    act(() => {
      result.current.select({
        id: "editor:0-5",
        source: "editor",
        text: "stray",
        startLine: 1,
        endLine: 1,
        note: "why?",
      });
    });

    // Assert.
    expect(result.current.outgoing).toHaveLength(1);
    expect(result.current.passages).toHaveLength(0);
  });

  it("carries the message the human typed about all of them", async () => {
    /*
     * The box lives in the bar but more than one control sends, so the text has
     * to belong to the tray. A sender holding its own copy sends an empty one
     * and the paragraph goes nowhere, with nothing on screen saying it was
     * dropped.
     */
    const bridge = stubBridge();
    const { result } = renderHook(() => usePassages(bridge, "id", "file.yml", () => {}));

    act(() => {
      result.current.pin({
        id: "editor:0-5",
        source: "editor",
        text: "jobs:",
        startLine: 1,
        endLine: 1,
        note: "why this job?",
      });
    });
    act(() => result.current.setNote("Overall: split these up."));

    // Act.
    await act(() => result.current.send());

    // Assert.
    expect(bridge.calls).toContain("editor_request_changes");
    const message = String(bridge.sent[0].message);
    expect(message).toContain("why this job?");
    expect(message).toContain("Overall: split these up.");
  });
});
