import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useHostStyleVariables } from "@modelcontextprotocol/ext-apps/react";
import type { EditorState, ProposalHandle } from "../../../shared/types.js";
import { IS_PREVIEW, hostBridge, previewBridge, previewState, type Bridge } from "../bridge.js";
import { messageOf } from "../lib/results.js";

const PUSH_DEBOUNCE_MS = 500;

/** How long to keep asking for the proposal. Must outlast the server's grace. */
const CLAIM_TIMEOUT_MS = 30_000;
const CLAIM_RETRY_MS = 100;

/** The openers send a handle, the panel's own calls send full state. Accept either. */
type OpeningPayload = Partial<ProposalHandle> & Partial<EditorState>;

export interface ProposalSession {
  /** Null until the attach round trip lands. */
  state: EditorState | null;
  /** What the opening tool sent: enough to name the file while we wait. */
  handle: ProposalHandle | null;
  bridge: Bridge | null;
  content: string;
  setContent: (next: string) => void;
  ack: boolean;
  setAck: (next: boolean) => void;
  /** The host connection failed; nothing else will work. */
  hostError: Error | null;
  /** Where the panel has got to, so a stall says which step it stalled on. */
  phase: "connecting" | "claiming" | "attaching" | "ready";
  failure: string | null;
  setFailure: (next: string | null) => void;
}

/**
 * Getting a proposal and keeping the server's copy of it current.
 *
 * The opening tool hands the panel a claim ticket rather than the proposal —
 * `structuredContent` goes to the model as well as to us, and the file has no
 * business being in its context three times over. The bytes arrive on attach,
 * which the panel has to call anyway because attaching is what unlocks the
 * commit tool server-side.
 *
 * @param paused stop syncing edits upward — set once a commit has landed.
 */
export function useProposalSession(paused: boolean): ProposalSession {
  const [state, setState] = useState<EditorState | null>(null);
  const [handle, setHandle] = useState<ProposalHandle | null>(null);
  const [content, setContent] = useState("");
  const [ack, setAck] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** The path the opening tool was called with, from the arguments the host hands us. */
  const [openedPath, setOpenedPath] = useState<string | undefined>(undefined);
  const [phase, setPhase] = useState<ProposalSession["phase"]>("connecting");

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
    appInfo: { name: "interactive-editor", version: "0.4.2" },
    capabilities: {},
    onAppCreated: (instance) => {
      // Arguments arrive before any result does — and now the result does not
      // arrive at all until the human has decided, because the opening call is
      // waiting on this panel. The path is how we find the proposal we are for.
      instance.ontoolinput = (params) => {
        const path = (params.arguments as { path?: unknown } | undefined)?.path;
        if (typeof path === "string") setOpenedPath(path);
      };

      instance.ontoolresult = (result) => {
        const payload = result.structuredContent as unknown as OpeningPayload | undefined;
        if (!payload) return;
        if (payload.proposal) adopt(payload as EditorState);
        else if (payload.proposalId) setHandle(payload as ProposalHandle);
      };
    },
  });

  useHostStyleVariables(app);

  const bridge: Bridge | null = useMemo(() => {
    if (IS_PREVIEW) return previewBridge();
    return app ? hostBridge(app) : null;
  }, [app]);

  // Preview runs the View in a plain browser tab with fixture data, so the
  // layout can be worked on without a host in the loop.
  useEffect(() => {
    if (IS_PREVIEW) adopt(previewState());
  }, [adopt]);

  const proposalId = state?.proposal.proposalId ?? handle?.proposalId;
  const ready = IS_PREVIEW || isConnected;

  /*
   * Claim the proposal this panel was opened for.
   *
   * The opening call used to return a handle immediately; now it waits for this
   * panel, so the result that carried the id only arrives once the human has
   * decided — long after we need it. The host mounts the View on the *call*, so
   * we are alive first and trade the arguments for the proposal instead.
   *
   * Retried, because we are racing the call that created us: the View can mount
   * before the server has finished making the proposal.
   */
  useEffect(() => {
    if (!bridge || !ready || state) return;
    let cancelled = false;
    setPhase("claiming");

    void (async () => {
      const deadline = Date.now() + CLAIM_TIMEOUT_MS;
      while (!cancelled && Date.now() < deadline) {
        try {
          const result = await bridge.callTool(
            "editor_pending",
            openedPath ? { path: openedPath } : {},
          );
          const next = result.structuredContent as unknown as EditorState | undefined;
          if (next?.proposal) {
            if (!cancelled) adopt(next);
            return;
          }
        } catch (cause) {
          if (!cancelled) setFailure(messageOf(cause));
          return;
        }
        await new Promise((r) => setTimeout(r, CLAIM_RETRY_MS));
      }
      if (!cancelled) {
        setFailure(
          "No proposal was open for this panel, and asking for one kept coming back empty.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, ready, state, openedPath, adopt]);

  // Attaching is what unlocks the commit tool server-side. Until this lands,
  // nothing can write — including from a host that ignores tool visibility. It
  // is also how the panel gets the file the opening result left out.
  useEffect(() => {
    if (!bridge || !ready || !proposalId) return;
    let cancelled = false;
    setPhase("attaching");
    void bridge
      .callTool("editor_attach", { proposalId })
      .then((result) => {
        const next = result.structuredContent as unknown as EditorState | undefined;
        if (cancelled) return;
        adopt(next);
        if (next?.proposal) setPhase("ready");
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailure(messageOf(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, ready, proposalId, adopt]);

  // Keep the server's copy current, but not on every character.
  const pushTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!bridge || !state || paused) return;
    if (content === state.proposal.content && ack === state.proposal.destructiveAcknowledged)
      return;

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
          // sends the final content anyway, and the server rechecks everything.
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
    failure,
    setFailure,
  };
}
