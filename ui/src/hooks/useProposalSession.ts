import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useHostStyleVariables } from "@modelcontextprotocol/ext-apps/react";
import type { EditorState, ProposalHandle } from "../../../shared/types.js";
import { IS_PREVIEW, hostBridge, previewBridge, previewState, type Bridge } from "../bridge.js";
import { messageOf } from "../lib/results.js";

const PUSH_DEBOUNCE_MS = 500;

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
    appInfo: { name: "interactive-editor", version: "0.3.0" },
    capabilities: {},
    onAppCreated: (instance) => {
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

  // Attaching is what unlocks the commit tool server-side. Until this lands,
  // nothing can write — including from a host that ignores tool visibility. It
  // is also how the panel gets the file the opening result left out.
  useEffect(() => {
    if (!bridge || !ready || !proposalId) return;
    let cancelled = false;
    void bridge
      .callTool("editor_attach", { proposalId })
      .then((result) => {
        const next = result.structuredContent as unknown as EditorState | undefined;
        if (!cancelled) adopt(next);
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
    failure,
    setFailure,
  };
}
