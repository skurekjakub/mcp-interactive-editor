import { describe, expect, it } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { EditorState } from "../../shared/types.js";
import { attachProposal, claimProposal, type RetryClock } from "../../ui/src/lib/handshake.js";
import type { ToolCaller } from "../../ui/src/lib/call.js";

/** A caller that answers from a queue and records what it was asked. */
interface ScriptedCaller extends ToolCaller {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

/**
 * Builds a caller that hands out the given answers in order.
 *
 * The last answer repeats once the queue runs dry, so a test can say "empty
 * forever" with one entry.
 *
 * @param answers - Results, or functions that throw, in the order to serve them.
 * @returns The caller, with its call log attached.
 */
function scripted(answers: Array<CallToolResult | (() => never)>): ScriptedCaller {
  const calls: ScriptedCaller["calls"] = [];
  let served = 0;
  return {
    calls,
    async callTool(name, args) {
      calls.push({ name, args });
      const answer = answers[Math.min(served, answers.length - 1)];
      served += 1;
      if (typeof answer === "function") return answer();
      return answer;
    },
  };
}

/** A clock that advances only when something sleeps, so nothing really waits. */
function fakeClock(): RetryClock & { slept: number[] } {
  let now = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  };
}

const STATE = { proposal: { proposalId: "p1" } } as unknown as EditorState;
const withState: CallToolResult = { content: [], structuredContent: STATE };
const empty: CallToolResult = { content: [{ type: "text", text: "No proposal is open yet." }] };
const refused: CallToolResult = {
  content: [{ type: "text", text: "Not allowed." }],
  isError: true,
};
const boom = (): never => {
  throw new Error("transport down");
};

const never = () => false;

describe("claiming a proposal", () => {
  it("keeps asking until a proposal exists, then hands it over", async () => {
    // Arrange: the server has not finished creating the proposal on the first ask.
    const caller = scripted([empty, empty, withState]);
    const clock = fakeClock();

    // Act.
    const outcome = await claimProposal(caller, {
      path: "a.txt",
      timeoutMs: 10_000,
      retryMs: 100,
      cancelled: never,
      clock,
    });

    // Assert.
    expect(outcome).toEqual({ kind: "claimed", state: STATE });
    expect(caller.calls).toHaveLength(3);
    expect(caller.calls[0]).toEqual({ name: "editor_pending", args: { path: "a.txt" } });
    expect(clock.slept).toEqual([100, 100]);
  });

  it("asks without a path when it was not handed one", async () => {
    const caller = scripted([withState]);

    await claimProposal(caller, { timeoutMs: 1_000, retryMs: 1, cancelled: never });

    expect(caller.calls[0].args).toEqual({});
  });

  it("stops at once on a refusal rather than retrying it into a timeout", async () => {
    // Arrange: the host says no, with a reason.
    const caller = scripted([refused]);

    // Act.
    const outcome = await claimProposal(caller, {
      timeoutMs: 10_000,
      retryMs: 100,
      cancelled: never,
      clock: fakeClock(),
    });

    // Assert: retrying for the whole timeout and then blaming an empty answer
    // would hide what the host actually said.
    expect(outcome).toEqual({ kind: "refused", reason: "Not allowed." });
    expect(caller.calls).toHaveLength(1);
  });

  it("reports a thrown call as a failure with its message", async () => {
    const outcome = await claimProposal(scripted([boom]), {
      timeoutMs: 1_000,
      retryMs: 1,
      cancelled: never,
    });

    expect(outcome).toEqual({ kind: "failed", reason: "transport down" });
  });

  it("gives up at the deadline and repeats the server's last answer", async () => {
    // Arrange: nothing ever opens.
    const caller = scripted([empty]);
    const clock = fakeClock();

    // Act.
    const outcome = await claimProposal(caller, {
      timeoutMs: 350,
      retryMs: 100,
      cancelled: never,
      clock,
    });

    // Assert: the timeout says what the server said, not just "empty".
    expect(outcome).toEqual({ kind: "timed-out", lastAnswer: "No proposal is open yet." });
    expect(caller.calls).toHaveLength(4);
  });

  it("stops asking once the caller has stopped caring", async () => {
    // Arrange: cancelled after the first empty answer.
    const caller = scripted([empty]);
    let stopped = false;
    const clock = fakeClock();
    clock.sleep = async () => {
      stopped = true;
    };

    // Act.
    const outcome = await claimProposal(caller, {
      timeoutMs: 10_000,
      retryMs: 100,
      cancelled: () => stopped,
      clock,
    });

    // Assert.
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(caller.calls).toHaveLength(1);
  });
});

describe("attaching to a proposal", () => {
  it("hands over the state on the first successful attach", async () => {
    const caller = scripted([withState]);

    const outcome = await attachProposal(caller, "p1", {
      attempts: 3,
      retryMs: 1,
      cancelled: never,
    });

    expect(outcome).toEqual({ kind: "attached", state: STATE });
    expect(caller.calls).toEqual([{ name: "editor_attach", args: { proposalId: "p1" } }]);
  });

  it("retries a refusal, because the first attach can race the server's own bookkeeping", async () => {
    // Arrange.
    const caller = scripted([refused, refused, withState]);
    const clock = fakeClock();

    // Act.
    const outcome = await attachProposal(caller, "p1", {
      attempts: 3,
      retryMs: 50,
      cancelled: never,
      clock,
    });

    // Assert.
    expect(outcome.kind).toBe("attached");
    expect(caller.calls).toHaveLength(3);
    expect(clock.slept).toEqual([50, 50]);
  });

  it("reports the last refusal once every attempt has been refused", async () => {
    const caller = scripted([refused]);

    const outcome = await attachProposal(caller, "p1", {
      attempts: 3,
      retryMs: 1,
      cancelled: never,
      clock: fakeClock(),
    });

    expect(outcome).toEqual({ kind: "refused", reason: "Not allowed." });
    expect(caller.calls).toHaveLength(3);
  });

  it("says when the server attached but sent nothing to show", async () => {
    const outcome = await attachProposal(scripted([empty]), "p1", {
      attempts: 2,
      retryMs: 1,
      cancelled: never,
      clock: fakeClock(),
    });

    expect(outcome).toEqual({ kind: "empty" });
  });

  it("reports a thrown call as a failure after the last attempt", async () => {
    const outcome = await attachProposal(scripted([boom]), "p1", {
      attempts: 2,
      retryMs: 1,
      cancelled: never,
      clock: fakeClock(),
    });

    expect(outcome).toEqual({ kind: "failed", reason: "transport down" });
  });

  it("stops between attempts once the caller has stopped caring", async () => {
    // Arrange: cancelled during the pause after the first refusal.
    const caller = scripted([refused]);
    let stopped = false;
    const clock = fakeClock();
    clock.sleep = async () => {
      stopped = true;
    };

    // Act.
    const outcome = await attachProposal(caller, "p1", {
      attempts: 3,
      retryMs: 1,
      cancelled: () => stopped,
      clock,
    });

    // Assert.
    expect(outcome).toEqual({ kind: "cancelled" });
    expect(caller.calls).toHaveLength(1);
  });
});
