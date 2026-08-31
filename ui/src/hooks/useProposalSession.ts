import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useHostStyleVariables } from "@modelcontextprotocol/ext-apps/react";
import type { EditorState, ProposalHandle } from "../../../shared/types.js";
import { isPreview, hostBridge, previewBridge, previewState, type Bridge } from "../bridge.js";
import { call } from "../lib/call.js";
import { messageOf, textOf } from "../lib/results.js";
import { PANEL_VERSION } from "../lib/version.js";

/** How long to coalesce keystrokes before pushing them to the server. */
const PUSH_DEBOUNCE_MS = 500;

/** How long to keep asking for the proposal. Must outlast the server's grace. */
const CLAIM_TIMEOUT_MS = 30_000;

/** Gap between claim attempts, in milliseconds. */
const CLAIM_RETRY_MS = 100;

/** How many times to retry an attach that failed before giving up. */
const ATTACH_ATTEMPTS = 3;

/** The openers send a handle, the panel's own calls send full state. Accept either. */
type OpeningPayload = Partial<ProposalHandle> & Partial<EditorState>;

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
  phase: "connecting" | "claiming" | "attaching" | "ready" | "cancelled";
  /** How the host is showing this panel right now. */
  displayMode: "inline" | "fullscreen" | "pip";
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
  const [handle, setHandle] = useState<ProposalHandle | null>(null);
  const [content, setContent] = useState("");
  const [ack, setAck] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The path the opening tool was called with, from the arguments the host hands over. */
  const [openedPath, setOpenedPath] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<ProposalSession["phase"]>("connecting");
  const [displayMode, setDisplayMode] = useState<ProposalSession["displayMode"]>("inline");
  const [availableModes, setAvailableModes] = useState<string[]>([]);

  // Only the first state to arrive fills the edit buffer. A later one must not:
  // by then the human may have typed, and their draft outranks a re-attach.
  const adopted = useRef(false);

  const adopt = useCallback((next: EditorState | undefined) => {
    if (!next?.proposal) return;
    setState(next);
    if (adopted.current) return;
    adopted.current = true;
    setContent(next.proposal.content);
    setAck(next.proposal.destructiveAcknowledged);
  }, []);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "interactive-editor", version: PANEL_VERSION },
    // Declaring these is what makes fullscreen offerable at all: a host will not
    // grow a panel that never said it could handle being grown.
    capabilities: { availableDisplayModes: ["inline", "fullscreen"] },
    onAppCreated: (instance) => {
      const readContext = () => {
        const ctx = instance.getHostContext();
        if (ctx?.displayMode) setDisplayMode(ctx.displayMode);
        setAvailableModes(ctx?.availableDisplayModes ?? []);
      };

      /*
       * addEventListener rather than the `on*` setters, which the SDK marks
       * deprecated. The setters are also a single slot: any other assignment
       * silently replaces the handler already installed.
       */
      instance.addEventListener("hostcontextchanged", readContext);

      // Arguments arrive before any result does, and under --block-on-review the
      // result does not arrive until the human has decided. The path is how this
      // panel finds the proposal it exists for.
      instance.addEventListener("toolinput", (params) => {
        const path = (params.arguments as { path?: unknown } | undefined)?.path;
        if (typeof path === "string") setOpenedPath(path);
      });

      instance.addEventListener("toolresult", (params) => {
        const payload = params.structuredContent as unknown as OpeningPayload | undefined;
        if (!payload) return;
        if (payload.proposal) adopt(payload as EditorState);
        else if (payload.proposalId) setHandle(payload as ProposalHandle);
      });

      // A stopped agent leaves the panel offering an editor for a call nobody is
      // waiting on, and a commit through it would land with no conversation to
      // report back to.
      instance.addEventListener("toolcancelled", () => {
        setPhase("cancelled");
        setFailure("The call this panel was opened for was cancelled. Nothing will be written.");
      });
    },
  });

  useHostStyleVariables(app);

  // The context is only populated once the handshake lands, so read it again
  // when the connection settles rather than only when it changes.
  useEffect(() => {
    if (!app || !isConnected) return;
    const ctx = app.getHostContext();
    if (ctx?.displayMode) setDisplayMode(ctx.displayMode);
    setAvailableModes(ctx?.availableDisplayModes ?? []);
  }, [app, isConnected]);

  const toggleFullscreen = useCallback(() => {
    if (!app) return;
    const next = displayMode === "fullscreen" ? "inline" : "fullscreen";
    void app
      .requestDisplayMode({ mode: next })
      // The host decides. Believe its answer, not the request.
      .then((result) => setDisplayMode(result.mode))
      .catch((cause: unknown) => setFailure(messageOf(cause)));
  }, [app, displayMode]);

  const bridge: Bridge | null = useMemo(() => {
    if (isPreview()) return previewBridge();
    return app ? hostBridge(app) : null;
  }, [app]);

  // Preview runs the View in a plain browser tab with fixture data, so the
  // layout can be worked on without a host in the loop.
  useEffect(() => {
    if (isPreview()) adopt(previewState());
  }, [adopt]);

  const proposalId = state?.proposal.proposalId ?? handle?.proposalId;
  const ready = isPreview() || isConnected;

  /*
   * Claim the proposal this panel was opened for.
   *
   * The host mounts the View on the tool call, so the panel is alive before any
   * result carrying a proposal id exists. It trades the call's arguments for the
   * proposal instead.
   *
   * Retried, because this races the call that created it: the View can mount
   * before the server has finished making the proposal.
   */
  useEffect(() => {
    if (!bridge || !ready || state || phase === "cancelled") return;
    let cancelled = false;
    setPhase("claiming");
    // A failure from an earlier attempt describes a state that has since passed;
    // leaving it pinned to the bottom of a working panel reports a broken one.
    setFailure(null);

    void (async () => {
      const deadline = Date.now() + CLAIM_TIMEOUT_MS;
      let lastAnswer = "";
      while (!cancelled && Date.now() < deadline) {
        try {
          const claim = await call(
            bridge,
            "editor_pending",
            openedPath ? { path: openedPath } : {},
          );
          // A refused call is not an empty one. Retrying for thirty seconds and
          // then blaming an empty answer hides what the host actually said.
          if (claim.refusal) {
            if (!cancelled) setFailure(claim.refusal);
            return;
          }

          const next = claim.result.structuredContent as unknown as EditorState | undefined;
          if (next?.proposal) {
            if (!cancelled) adopt(next);
            return;
          }
          // Keep the server's own account of what it has open, so the timeout
          // below can say something better than "empty".
          lastAnswer = textOf(claim.result);
        } catch (cause) {
          if (!cancelled) setFailure(messageOf(cause));
          return;
        }
        await new Promise((r) => setTimeout(r, CLAIM_RETRY_MS));
      }
      if (!cancelled) {
        setFailure(
          `Gave up waiting for a proposal to claim. The server last said: ${
            lastAnswer || "nothing at all"
          }`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, ready, state, openedPath, adopt, phase]);

  // Attaching is what unlocks the commit tool server-side. Until it lands
  // nothing can write, including from a host that ignores tool visibility. It is
  // also how the panel gets the file the opening result left out.
  useEffect(() => {
    if (!bridge || !ready || !proposalId || phase === "cancelled") return;
    let cancelled = false;
    setPhase("attaching");
    setFailure(null);

    void (async () => {
      for (let attempt = 1; attempt <= ATTACH_ATTEMPTS && !cancelled; attempt += 1) {
        try {
          const attached = await call(bridge, "editor_attach", { proposalId });
          if (cancelled) return;

          if (attached.refusal) {
            if (attempt === ATTACH_ATTEMPTS) setFailure(attached.refusal);
            continue;
          }

          const next = attached.result.structuredContent as unknown as EditorState | undefined;
          if (next?.proposal) {
            adopt(next);
            setPhase("ready");
            return;
          }
          if (attempt === ATTACH_ATTEMPTS) {
            setFailure("The server attached to the proposal but sent nothing back to show.");
          }
        } catch (cause) {
          if (cancelled) return;
          if (attempt === ATTACH_ATTEMPTS) setFailure(messageOf(cause));
        }
        await new Promise((r) => setTimeout(r, CLAIM_RETRY_MS));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, ready, proposalId, adopt, phase]);

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
    hostError: error,
    phase,
    displayMode,
    canFullscreen: availableModes.includes("fullscreen"),
    toggleFullscreen,
    failure,
    setFailure,
  };
}
