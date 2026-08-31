import type { ReviewOutcome } from "../shared/types.js";

/**
 * The tool call that opened the editor waits here until a human decides.
 *
 * This is what makes the panel a gate rather than a viewer: `propose_write` does
 * not return the moment the panel opens, it returns what happened in it. The
 * agent finds out that its draft was rejected, and why, in the result of the
 * call it already made — not in a message it has to be told to go and read.
 */

/** Long enough to actually read a diff, short enough that a walked-away review ends. */
export const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

/** Long enough for a panel to mount and attach, short enough not to stall a host that will not. */
export const REVIEW_GRACE_MS = 4000;

interface Waiting {
  resolve: (outcome: ReviewOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

const waiting = new Map<string, Waiting>();

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

/** Ends the wait. False when nothing was waiting — the caller is not the gate. */
export function resolveReview(proposalId: string, outcome: ReviewOutcome): boolean {
  const found = waiting.get(proposalId);
  if (!found) return false;

  clearTimeout(found.timer);
  waiting.delete(proposalId);
  found.resolve(outcome);
  return true;
}

export function isAwaitingReview(proposalId: string): boolean {
  return waiting.has(proposalId);
}
