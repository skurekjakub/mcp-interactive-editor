/**
 * @module
 *
 * Where a tool call waits while a human decides.
 *
 * This is what makes the panel a gate rather than a viewer under
 * `--block-on-review`: the opening call returns what happened in the editor
 * rather than the fact that it opened. The agent learns that its draft was
 * rejected, and why, in the result of the call it already made.
 *
 * A blocking wait is a promise held by the process that must return, so this is
 * the one piece of state that lives in memory rather than in the store: only the
 * process the opening call landed on can end it.
 */
import type { ReviewOutcome } from "../shared/types.js";

/** Long enough to actually read a diff, short enough that a walked-away review ends. */
export const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * How long to wait for a panel to mount and attach.
 *
 * Generous on purpose. A first mount fetches a half-megabyte UI resource, boots
 * an iframe, runs React, finishes the `ui/initialize` handshake and only then
 * calls a tool. A grace period shorter than that loses the race every time: it
 * expires, the call reports that nobody answered, and the review that was meant
 * to block does not.
 */
export const REVIEW_GRACE_MS = 30_000;

/** One outstanding review, and how to end it. */
interface Waiting {
  resolve: (outcome: ReviewOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

const waiting = new Map<string, Waiting>();

/**
 * Registers a review and returns a promise for its outcome.
 *
 * @param proposalId - The proposal being reviewed.
 * @param timeoutMs - How long to wait before reporting that nobody answered.
 * @returns The outcome, once something decides it.
 * @throws {Error} When a review is already outstanding for that proposal.
 */
export function awaitReview(
  proposalId: string,
  timeoutMs: number = REVIEW_TIMEOUT_MS,
): Promise<ReviewOutcome> {
  if (waiting.has(proposalId)) {
    throw new Error(`Already waiting on a review for ${proposalId}.`);
  }

  return new Promise<ReviewOutcome>((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(proposalId);
      resolve({
        kind: "unanswered",
        why: `Nobody responded in the editor within ${Math.round(timeoutMs / 60_000)} minutes.`,
      });
    }, timeoutMs);

    // A review nobody is coming back to must not keep the server alive.
    timer.unref?.();
    waiting.set(proposalId, { resolve, timer });
  });
}

/**
 * Ends a wait with an outcome.
 *
 * @param proposalId - The proposal being resolved.
 * @param outcome - What happened in the editor.
 * @returns False when nothing was waiting, so the caller is not the gate.
 */
export function resolveReview(proposalId: string, outcome: ReviewOutcome): boolean {
  const found = waiting.get(proposalId);
  if (!found) return false;

  clearTimeout(found.timer);
  waiting.delete(proposalId);
  found.resolve(outcome);
  return true;
}

/**
 * Reports whether a review is still outstanding.
 *
 * @param proposalId - The proposal to check.
 * @returns True while something is waiting on it.
 */
export function isAwaitingReview(proposalId: string): boolean {
  return waiting.has(proposalId);
}
