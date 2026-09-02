/**
 * @module
 *
 * The two round trips a panel makes before it can show anything: claiming the
 * proposal it was opened for, then attaching to it.
 *
 * Pure, so both can be driven by a stub caller and a fake clock under a test.
 * The hook that owns the panel's lifetime turns each outcome into state;
 * nothing here touches React or the DOM.
 */
import type { EditorState } from "../../../shared/types.js";
import { call, type ToolCaller } from "./call.js";
import { messageOf, stateIn, textOf } from "./results.js";

/** The clock a retrying round trip reads, so a test can supply a faster one. */
export interface RetryClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const REAL_CLOCK: RetryClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** How a claim ended. */
export type ClaimOutcome =
  | { kind: "claimed"; state: EditorState }
  /** The host refused the call outright, which is not the same as an empty answer. */
  | { kind: "refused"; reason: string }
  | { kind: "failed"; reason: string }
  /** Nothing to claim within the time allowed; carries the server's last answer. */
  | { kind: "timed-out"; lastAnswer: string }
  | { kind: "cancelled" };

/** How long and how often to keep asking, and when to stop caring. */
export interface ClaimOptions {
  /** Narrows the claim to one file, from the arguments the panel was handed. */
  path?: string;
  timeoutMs: number;
  retryMs: number;
  /** Reports whether the caller has stopped wanting the answer. */
  cancelled: () => boolean;
  clock?: RetryClock;
}

/**
 * Claims the proposal a panel was opened for, retrying until one exists.
 *
 * The host mounts the View on the tool call, so the panel is alive before the
 * server has finished making the proposal; the first few asks routinely come
 * back empty. A refusal is different from an empty answer and ends the claim
 * at once: retrying for the whole timeout and then blaming an empty answer
 * hides what the host actually said.
 *
 * @param caller - How to reach the host.
 * @param options - The path to narrow to, the timing, and the cancellation flag.
 * @returns How the claim ended.
 */
export async function claimProposal(
  caller: ToolCaller,
  options: ClaimOptions,
): Promise<ClaimOutcome> {
  const clock = options.clock ?? REAL_CLOCK;
  const deadline = clock.now() + options.timeoutMs;
  let lastAnswer = "";

  while (!options.cancelled() && clock.now() < deadline) {
    let claim;
    try {
      claim = await call(caller, "editor_pending", options.path ? { path: options.path } : {});
    } catch (cause) {
      return { kind: "failed", reason: messageOf(cause) };
    }
    if (options.cancelled()) return { kind: "cancelled" };
    if (claim.refusal) return { kind: "refused", reason: claim.refusal };

    const state = stateIn(claim.result);
    if (state) return { kind: "claimed", state };

    // The server's own account of what it has open, so a timeout can say
    // something better than "empty".
    lastAnswer = textOf(claim.result);
    await clock.sleep(options.retryMs);
  }

  return options.cancelled() ? { kind: "cancelled" } : { kind: "timed-out", lastAnswer };
}

/** How an attach ended. */
export type AttachOutcome =
  | { kind: "attached"; state: EditorState }
  | { kind: "refused"; reason: string }
  | { kind: "failed"; reason: string }
  /** The server accepted the attach but answered with no state to show. */
  | { kind: "empty" }
  | { kind: "cancelled" };

/** How many times to try, how long between tries, and when to stop caring. */
export interface AttachOptions {
  attempts: number;
  retryMs: number;
  /** Reports whether the caller has stopped wanting the answer. */
  cancelled: () => boolean;
  clock?: RetryClock;
}

/**
 * Attaches to a proposal, retrying a refusal or a failure a few times.
 *
 * Attaching is what unlocks the commit tool server-side, and it is how the
 * panel gets the file the opening result left out. A refusal is retried here,
 * unlike a claim, because the first attach can race the server's own
 * bookkeeping for the proposal it just created; the last outcome is what is
 * reported when every attempt fails.
 *
 * @param caller - How to reach the host.
 * @param proposalId - The proposal to attach to.
 * @param options - The attempt budget, the timing, and the cancellation flag.
 * @returns How the attach ended.
 */
export async function attachProposal(
  caller: ToolCaller,
  proposalId: string,
  options: AttachOptions,
): Promise<AttachOutcome> {
  const clock = options.clock ?? REAL_CLOCK;
  let last: AttachOutcome = { kind: "empty" };

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    if (options.cancelled()) return { kind: "cancelled" };
    try {
      const attached = await call(caller, "editor_attach", { proposalId });
      if (options.cancelled()) return { kind: "cancelled" };
      if (attached.refusal) {
        last = { kind: "refused", reason: attached.refusal };
      } else {
        const state = stateIn(attached.result);
        if (state) return { kind: "attached", state };
        last = { kind: "empty" };
      }
    } catch (cause) {
      if (options.cancelled()) return { kind: "cancelled" };
      last = { kind: "failed", reason: messageOf(cause) };
    }
    if (attempt < options.attempts) await clock.sleep(options.retryMs);
  }

  return last;
}
