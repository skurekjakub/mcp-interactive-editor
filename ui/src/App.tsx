import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { CommitReceipt, Finding, Proposal } from "../../shared/types.js";
import { diffLines } from "../../shared/diff.js";
import { hasBlockers, lintProposal } from "../../shared/lint.js";
import { isAnswered, type Passage } from "../../shared/passages.js";
import { isPreview } from "./bridge.js";
import { useCommitFlow } from "./hooks/useCommitFlow.js";
import { usePassages } from "./hooks/usePassages.js";
import { useProposalSession } from "./hooks/useProposalSession.js";
import { commitLabel } from "./lib/labels.js";
import { PANEL_VERSION } from "./lib/version.js";
import { Findings } from "./components/Findings.js";
import { ProposalTag } from "./components/ProposalTag.js";
import { OpeningStatus } from "./components/OpeningStatus.js";
import { Receipt } from "./components/Receipt.js";
import { SentBack } from "./components/SentBack.js";
import { CommentPopover } from "./components/CommentPopover.js";
import type { SelectionAnchor } from "./lib/anchor.js";
import { ReviewPanes } from "./components/ReviewPanes.js";
import { SelectionBar } from "./components/SelectionBar.js";
import { Threshold } from "./components/Threshold.js";
import type { View } from "./components/ViewToggle.js";

/**
 * Renders the panel.
 *
 * Anything with a lifetime lives in a hook — getting the proposal, the tray of
 * selected passages, the walk through the commit — and anything with a shape
 * lives in a component. What is left here is the wiring plus the one derived
 * value several of them share.
 *
 * @returns The whole review surface, or whichever terminal screen has replaced it.
 */
export function App() {
  const [view, setView] = useState<View>("split");
  const [receipt, setReceipt] = useState<CommitReceipt | null>(null);
  const [discarded, setDiscarded] = useState(false);
  /** Where the live selection sits on screen, so the comment box opens beside it. */
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  /** Whether that selection came from a pointer, which decides if focus may move. */
  const [fromPointer, setFromPointer] = useState(false);

  // A resolved proposal stops syncing: there is nothing left to sync it to.
  const session = useProposalSession(receipt !== null || discarded);
  const { state, handle, bridge, content, setContent, ack, setAck, setFailure } = session;

  const tray = usePassages(
    bridge,
    state?.proposal.proposalId,
    state?.proposal.target.display,
    setFailure,
  );

  const { busy, commit, discard } = useCommitFlow({
    bridge,
    state,
    content,
    ack,
    onCommitted: setReceipt,
    onDiscarded: () => setDiscarded(true),
    onFailure: setFailure,
  });

  const onSelect = useCallback(
    (passage: Passage | null, at: SelectionAnchor | null, byPointer: boolean) => {
      tray.select(passage);
      setAnchor(at);
      setFromPointer(byPointer);
    },
    [tray.select],
  );

  const onAddComment = useCallback(
    (passage: Passage, note: string) => {
      tray.pin(note ? { ...passage, note } : passage);
      setAnchor(null);
    },
    [tray.pin],
  );

  const applyFix = useCallback(
    (finding: Finding) => {
      if (finding.fix) setContent(finding.fix.content);
    },
    [setContent],
  );

  /*
   * Findings and the diff are computed here, from the same modules the server
   * uses. That is what makes the review live: the consequence of an edit shows
   * as it is made rather than after a round trip.
   *
   * Deferred, because both are O(n²) in the changed region and a file of a few
   * hundred lines costs tens of milliseconds per keystroke. React paints the
   * keystroke first and catches the diff up behind it, so typing stays immediate
   * while the panes lag by a frame.
   *
   * The server recomputes all of it before committing anyway. This copy is for
   * the eyes; that copy is the one with authority.
   */
  const deferred = useDeferredValue(content);
  const local = useMemo(() => {
    if (!state) return null;
    const proposal: Proposal = {
      ...state.proposal,
      content: deferred,
      destructiveAcknowledged: ack,
    };
    const after = proposal.mode === "delete" ? "" : deferred;
    const { hunks, stats } = diffLines(proposal.baseline, after);
    return { proposal, hunks, stats, findings: lintProposal(proposal, stats) };
  }, [state, deferred, ack]);

  if (session.hostError && !isPreview()) {
    return (
      <div className="status status-error">
        Could not reach the host: {session.hostError.message}
      </div>
    );
  }
  if (!state || !local) {
    return (
      <OpeningStatus display={handle?.display} phase={session.phase} failure={session.failure} />
    );
  }
  if (receipt) return <Receipt receipt={receipt} failure={session.failure} />;
  if (discarded) return <SentBack path={state.proposal.target.display} outcome="discarded" />;
  // The opening call has returned with the comments; there is nothing left here.
  if (tray.rejected) return <SentBack path={state.proposal.target.display} outcome="commented" />;

  const { proposal, findings, hunks, stats } = local;
  const isDelete = proposal.mode === "delete";
  // A file opened for reading starts identical to disk. There is nothing to
  // write until something actually changes.
  const unchanged = !isDelete && content === proposal.baseline && proposal.target.exists;

  return (
    <div className="review">
      {state.serverVersion !== PANEL_VERSION ? (
        /*
         * Two installs, two update cycles. When they drift the behaviour matches
         * neither release, and every symptom looks like a bug in whichever half
         * is being read. Say it out loud instead.
         */
        <div className="status status-error">
          This panel is {PANEL_VERSION} but the server is {state.serverVersion}. Reinstall so both
          halves are the same build — until then, expect either one to misbehave.
        </div>
      ) : null}

      <ProposalTag
        proposal={proposal}
        stats={stats}
        dryRun={state.dryRun}
        canFullscreen={session.canFullscreen}
        fullscreen={session.displayMode === "fullscreen"}
        onToggleFullscreen={session.toggleFullscreen}
      />

      <Findings findings={findings} onApplyFix={applyFix} />

      <ReviewPanes
        view={view}
        onViewChange={setView}
        content={content}
        onContentChange={setContent}
        onSelect={onSelect}
        hunks={hunks}
        target={proposal.target}
        isDelete={isDelete}
      />

      {tray.pending && anchor ? (
        <CommentPopover
          passage={tray.pending}
          anchor={anchor}
          fromPointer={fromPointer}
          onAdd={onAddComment}
          onDismiss={() => {
            tray.select(null);
            setAnchor(null);
          }}
        />
      ) : null}

      {tray.active ? (
        <SelectionBar
          pending={tray.pending}
          passages={tray.passages}
          outgoing={tray.outgoing}
          onAttach={tray.pin}
          path={proposal.target.display}
          sending={tray.sending}
          onAnnotate={tray.annotate}
          onRemove={tray.unpin}
          onSend={tray.send}
          onDismiss={tray.clear}
        />
      ) : null}

      <Threshold
        findings={findings}
        ack={ack}
        onAck={setAck}
        isDelete={isDelete}
        blocked={hasBlockers(findings)}
        hasComments={tray.outgoing.some(isAnswered)}
        busy={busy}
        // Attaching is what unlocks the commit tool server-side, so a panel that
        // never attached must not offer a button the server will refuse.
        writable={proposal.target.absolute !== null && state.proposal.attached}
        unchanged={unchanged}
        label={commitLabel(proposal, content, state.dryRun)}
        onCommit={commit}
        onDiscard={discard}
      />

      {session.failure ? <div className="status status-error">{session.failure}</div> : null}
    </div>
  );
}
