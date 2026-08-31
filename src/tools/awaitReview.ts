import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReviewOutcome } from "../../shared/types.js";
import { getProposal } from "../proposals.js";
import { awaitReview, resolveReview } from "../review.js";
import type { ToolContext } from "./context.js";
import { describeReceipt } from "./results.js";

/**
 * Hold the tool call open until the panel says what happened.
 *
 * Two things have to be true before waiting is safe. The host must be able to
 * render at all — otherwise there is nobody to wait for, and a terminal agent
 * should get the diff as text rather than a call that hangs. And a panel must
 * actually turn up: a host can advertise MCP Apps and still not mount this
 * particular View, and "declared support" is a promise, not an attachment. So
 * the wait proper starts only once the panel has attached, and until then there
 * is a short grace period after which the call returns as it always did.
 */
export async function waitForReview(
  context: ToolContext,
  proposalId: string,
  opened: CallToolResult,
): Promise<CallToolResult> {
  // Opt-in, and off by default: see ToolContext.blockOnReview. A host that will
  // not dispatch the panel's calls during the opening call turns a review into a
  // dead panel, which is worse than a review that does not block.
  if (!context.blockOnReview || !context.canRenderPanel()) return opened;

  // Registered before the grace poll, so a panel that attaches and resolves
  // immediately cannot slip through the gap.
  const settled = awaitReview(proposalId, context.reviewTimeoutMs);

  if (!(await attachedWithin(proposalId, context.reviewGraceMs))) {
    resolveReview(proposalId, {
      kind: "unanswered",
      why: "This host advertises MCP Apps but no editor attached to the proposal.",
    });
  }

  return describeOutcome(await settled, opened);
}

async function attachedWithin(proposalId: string, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (getProposal(proposalId).attached) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return getProposal(proposalId).attached;
}

/**
 * What the agent is told, and it is deliberately blunt about the difference
 * between "done" and "do it again". A rejected draft that reads like a success
 * is how an agent moves on from work that never landed.
 */
export function describeOutcome(outcome: ReviewOutcome, opened: CallToolResult): CallToolResult {
  switch (outcome.kind) {
    case "committed":
      return {
        content: [{ type: "text", text: describeReceipt(outcome.receipt) }],
        structuredContent: outcome.receipt as unknown as Record<string, unknown>,
      };

    case "changes-requested":
      return {
        content: [
          {
            type: "text",
            text:
              "The human read this and asked for changes. Nothing was written.\n\n" +
              `${outcome.message}\n\n` +
              "Redraft and propose again. Do not commit anything in the meantime, and " +
              "do not re-propose the same content.",
          },
        ],
        structuredContent: { outcome: "changes-requested", message: outcome.message },
      };

    case "discarded":
      return {
        content: [
          {
            type: "text",
            text:
              "The human discarded this. Nothing was written." +
              (outcome.reason ? ` Reason: ${outcome.reason}` : "") +
              " Do not propose it again unless they ask.",
          },
        ],
        structuredContent: { outcome: "discarded", reason: outcome.reason ?? null },
      };

    case "unanswered":
      // Fall back to the opening result: the diff is still the most useful thing
      // to hand back, and nothing was written either way.
      return opened;
  }
}
