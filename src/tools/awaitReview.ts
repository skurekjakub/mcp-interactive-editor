import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReviewOutcome } from "../../shared/types.js";
import { getProposal } from "../proposals.js";
import { awaitReview, isAwaitingReview, resolveReview } from "../review.js";
import type { ToolContext } from "./context.js";
import { describeCommit } from "../../shared/receipt.js";

/** How often to check whether a panel has attached, in milliseconds. */
const ATTACH_POLL_MS = 25;

/**
 * Holds a tool call open until the panel reports what happened.
 *
 * Two things must be true before waiting is safe. The host has to be able to
 * render at all, or there is nobody to wait for and a terminal agent should get
 * the diff as text rather than a call that hangs. And a panel has to actually
 * turn up: a host can advertise MCP Apps and still not mount this particular
 * View, so declared support is a promise rather than an attachment. The wait
 * proper therefore starts only once the panel has attached, with a short grace
 * period before the call gives up and returns the diff.
 *
 * @param context - Whether to block, and how long to wait.
 * @param proposalId - The proposal whose review to wait on.
 * @param opened - The result to fall back to when nobody answers.
 * @returns The outcome of the review, or the opening result.
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

  const attached = await attachedWithin(proposalId, context.reviewGraceMs);

  // Only declare nobody home while the review is genuinely still outstanding. A
  // human who discards before the panel finishes attaching has already answered,
  // and overwriting that with "no editor attached" would burn the whole grace
  // period to report the wrong outcome.
  if (!attached && isAwaitingReview(proposalId)) {
    resolveReview(proposalId, {
      kind: "unanswered",
      why: "This host advertises MCP Apps but no editor attached to the proposal.",
    });
  }

  return describeOutcome(await settled, opened);
}

/**
 * Waits for a panel to attach to a proposal.
 *
 * Returns early once the review has resolved by any route, so an answer that
 * arrives before the attachment does not sit out the remaining grace period.
 *
 * @param proposalId - The proposal to watch.
 * @param graceMs - How long to keep checking.
 * @returns True when a panel attached within the grace period.
 */
async function attachedWithin(proposalId: string, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (getProposal(proposalId).attached) return true;
    if (!isAwaitingReview(proposalId)) return false;
    await new Promise((r) => setTimeout(r, ATTACH_POLL_MS));
  }
  return getProposal(proposalId).attached;
}

/**
 * Renders a review outcome for the agent.
 *
 * Deliberately blunt about the difference between "done" and "do it again": a
 * rejected draft that reads like a success is how an agent moves on from work
 * that never landed.
 *
 * @param outcome - How the review ended.
 * @param opened - The opening result, returned when nobody answered.
 * @returns What the agent is told.
 */
function describeOutcome(outcome: ReviewOutcome, opened: CallToolResult): CallToolResult {
  switch (outcome.kind) {
    case "committed": {
      // The body has already been through the panel. Sending it back through the
      // opener would put the whole file into the model's context, which is the
      // cost the claim-ticket handle exists to avoid.
      const { content: _body, ...receipt } = outcome.receipt;
      return {
        content: [{ type: "text", text: describeCommit(outcome.receipt) }],
        structuredContent: receipt,
      };
    }

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
