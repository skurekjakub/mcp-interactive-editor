import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorState, ProposalHandle } from "../../../shared/types.js";
import { isPreview, type Bridge } from "../bridge.js";
import { attachProposal, claimProposal } from "../lib/handshake.js";
import { previewState } from "../preview.js";
import { useHost, type DisplayMode } from "./useHost.js";

/** How long to coalesce keystrokes before pushing them to the server. */
const PUSH_DEBOUNCE_MS = 500;

/** How long to keep asking for the proposal. Must outlast the server's grace. */
const CLAIM_TIMEOUT_MS = 30_000;

/** Gap between claim attempts, in milliseconds. */
const CLAIM_RETRY_MS = 100;

/** How many times to retry an attach that failed before giving up. */
const ATTACH_ATTEMPTS = 3;

/** What the panel shows once the host has abandoned the call it was opened for. */
const CANCELLED_MESSAGE =
  "The call this panel was opened for was cancelled. Nothing will be written.";

/** The steps the panel takes on its own, before the host can cancel any of them. */
type Step = "connecting" | "claiming" | "attaching" | "ready";

/** Everything the panel knows about the proposal it is showing. */
export interface ProposalSession {
  /** Null until the attach round trip lands. */
  state: EditorState | null;
  /** What the opening tool sent: enough to name the file while waiting. */
  handle: ProposalHandle | null;
  bridge: Bridge | null;
  content: string;
  setContent: (next: string) => void;
  ack: boolean;
  setAck: (next: boolean) => void;
  /** The host connection failed; nothing else will work. */
  hostError: Error | null;
  /** Where the panel has got to, so a stall says which step it stalled on. */
  phase: Step | "cancelled";
  /** How the host is showing this panel right now. */
  displayMode: DisplayMode;
  /** Whether asking for fullscreen is worth offering at all. */
  canFullscreen: boolean;
  /** Ask the host to grow or shrink. It decides; the result is what it did. */
  toggleFullscreen: () => void;
  failure: string | null;
  setFailure: (next: string | null) => void;
}

/**
 * Gets a proposal and keeps the server's copy of it current.
 *
 * The opening tool hands the panel a claim ticket rather than the proposal —
 * `structuredContent` goes to the model as well, and the file has no business
 * being in its context three times over. The bytes arrive on attach, which the
 * panel has to call anyway because attaching is what unlocks the commit tool
 * server-side.
 *
 * @param paused - Stop syncing edits upward; set once the proposal has resolved.
 * @returns The session state and the setters the panel drives it with.
 */
export function useProposalSession(paused: boolean): ProposalSession {
  const [state, setState] = useState<EditorState | null>(null);
  const [content, setContent] = useState("");
  const [ack, setAck] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("connecting");

  // Only the first state to arrive fills the edit buffer. A later one must not:
  // by then the human may have typed, and their draft outranks a re-attach.
  const adopted = useRef(false);

  const adopt = useCallback((next: EditorState) => {
    setState(next);
    if (adopted.current) return;
    adopted.current = true;
    setContent(next.proposal.content);
    setAck(next.proposal.destructiveAcknowledged);
  }, []);

  const host = useHost(adopt, setFailure);
  const { bridge, ready, cancelled, openedPath, handle } = host;

  // Preview runs the View in a plain browser tab with fixture data, so the
  // layout can be worked on without a host in the loop.
  useEffect(() => {
    if (isPreview()) adopt(previewState());
  }, [adopt]);

  const proposalId = state?.proposal.proposalId ?? handle?.proposalId;

  /*
   * Claim the proposal this panel was opened for.
   *
   * The host mounts the View on the tool call, so the panel is alive before any
   * result carrying a proposal id exists. It trades the call's arguments for the
   * proposal instead, retrying because it races the call that created it.
   */
  useEffect(() => {
    if (!bridge || !ready || state || cancelled) return;
    let stopped = false;
    setStep("claiming");
    // A failure from an earlier attempt describes a state that has since passed;
    // leaving it pinned to the bottom of a working panel reports a broken one.
    setFailure(null);

    void claimProposal(bridge, {
      path: openedPath,
      timeoutMs: CLAIM_TIMEOUT_MS,
      retryMs: CLAIM_RETRY_MS,
      cancelled: () => stopped,
    }).then((outcome) => {
      if (stopped) return;
      switch (outcome.kind) {
        case "claimed":
          adopt(outcome.state);
          break;
        case "refused":
        case "failed":
          setFailure(outcome.reason);
          break;
        case "timed-out":
          setFailure(
            `Gave up waiting for a proposal to claim. The server last said: ${
              outcome.lastAnswer || "nothing at all"
            }`,
          );
          break;
        case "cancelled":
          break;
      }
    });

    return () => {
      stopped = true;
    };
  }, [bridge, ready, state, openedPath, adopt, cancelled]);

  // Attaching is what unlocks the commit tool server-side. Until it lands
  // nothing can write, including from a host that ignores tool visibility. It is
  // also how the panel gets the file the opening result left out.
  useEffect(() => {
    if (!bridge || !ready || !proposalId || cancelled) return;
    let stopped = false;
    setStep("attaching");
    setFailure(null);

    void attachProposal(bridge, proposalId, {
      attempts: ATTACH_ATTEMPTS,
      retryMs: CLAIM_RETRY_MS,
      cancelled: () => stopped,
    }).then((outcome) => {
      if (stopped) return;
      switch (outcome.kind) {
        case "attached":
          adopt(outcome.state);
          setStep("ready");
          break;
        case "refused":
        case "failed":
          setFailure(outcome.reason);
          break;
        case "empty":
          setFailure("The server attached to the proposal but sent nothing back to show.");
          break;
        case "cancelled":
          break;
      }
    });

    return () => {
      stopped = true;
    };
  }, [bridge, ready, proposalId, adopt, cancelled]);

  // Keep the server's copy current, but not on every character.
  const pushTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!bridge || !state || paused) return;
    if (content === state.proposal.content && ack === state.proposal.destructiveAcknowledged) {
      return;
    }

    window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      void bridge
        .callTool("editor_update", {
          proposalId: state.proposal.proposalId,
          content,
          destructiveAcknowledged: ack,
        })
        .catch(() => {
          // A failed sync is not worth interrupting an edit for. The commit
          // flushes the final content and checks that flush before writing.
        });
    }, PUSH_DEBOUNCE_MS);

    return () => window.clearTimeout(pushTimer.current);
  }, [bridge, state, content, ack, paused]);

  return {
    state,
    handle,
    bridge,
    content,
    setContent,
    ack,
    setAck,
    hostError: host.hostError,
    phase: cancelled ? "cancelled" : step,
    displayMode: host.displayMode,
    canFullscreen: host.canFullscreen,
    toggleFullscreen: host.toggleFullscreen,
    failure: failure ?? (cancelled ? CANCELLED_MESSAGE : null),
    setFailure,
  };
}
