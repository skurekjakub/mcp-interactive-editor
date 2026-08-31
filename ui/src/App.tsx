import { useCallback, useMemo, useState } from "react";
import type { CommitReceipt, Finding, Proposal } from "../../shared/types.js";
import { diffLines } from "../../shared/diff.js";
import { hasBlockers, lintProposal } from "../../shared/lint.js";
import { isAnswered, type Passage } from "../../shared/passages.js";
import { IS_PREVIEW } from "./bridge.js";
import { useCommitFlow } from "./hooks/useCommitFlow.js";
import { usePassages } from "./hooks/usePassages.js";
import { useProposalSession } from "./hooks/useProposalSession.js";
import { commitLabel } from "./lib/labels.js";
import { Findings } from "./components/Findings.js";
import { ProposalTag } from "./components/ProposalTag.js";
import { Receipt } from "./components/Receipt.js";
import { SentBack } from "./components/SentBack.js";
import { CommentPopover } from "./components/CommentPopover.js";
import type { SelectionAnchor } from "./lib/anchor.js";
import { ReviewPanes } from "./components/ReviewPanes.js";
import { SelectionBar } from "./components/SelectionBar.js";
import { Threshold } from "./components/Threshold.js";
import type { View } from "./components/ViewToggle.js";

/**
 * The panel, assembled.
 *
 * Anything with a lifetime lives in a hook — getting the proposal, the tray of
 * selected passages, the walk through the commit — and anything with a shape
 * lives in a component. What is left here is the wiring plus the one derived
 * value several of them share.
 */
export function App() {
  const [view, setView] = useState<View>("split");
  const [receipt, setReceipt] = useState<CommitReceipt | null>(null);
  /** Where the live selection sits on screen, so the comment box opens beside it. */
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);

  // A committed proposal stops syncing: there is nothing left to sync it to.
  const session = useProposalSession(receipt !== null);
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
    onFailure: setFailure,
  });

  const onSelect = useCallback(
    (passage: Passage | null, at: SelectionAnchor | null) => {
      tray.select(passage);
      setAnchor(at);
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
   * Findings and the diff are computed here, on every keystroke, from the same
   * modules the server uses. That is what makes the review live: you see the
   * consequence of an edit as you make it, not after a round trip.
   *
   * The server recomputes all of it before committing anyway. This copy is for
   * the eyes; that copy is the one with authority.
   */
  const local = useMemo(() => {
    if (!state) return null;
    const proposal: Proposal = { ...state.proposal, content, destructiveAcknowledged: ack };
    const after = proposal.mode === "delete" ? "" : content;
    const { hunks, stats } = diffLines(proposal.baseline, after);
    return { proposal, hunks, stats, findings: lintProposal(proposal, stats) };
  }, [state, content, ack]);

  if (session.hostError && !IS_PREVIEW) {
    return (
      <div className="status status-error">
        Could not reach the host: {session.hostError.message}
      </div>
    );
  }
  if (!state || !local) {
    return <div className="status">Opening {handle?.display ?? "the editor"}…</div>;
  }
  if (receipt) return <Receipt receipt={receipt} />;
  // The opening call has returned with the comments; there is nothing left here.
  if (tray.rejected) return <SentBack path={state.proposal.target.display} />;

  const { proposal, findings, hunks, stats } = local;
  const isDelete = proposal.mode === "delete";
  // A file opened for reading starts identical to disk. There is nothing to
  // write until you actually change something.
  const unchanged = !isDelete && content === proposal.baseline && proposal.target.exists;

  return (
    <div className="review">
      <ProposalTag proposal={proposal} stats={stats} dryRun={state.dryRun} />

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
        hasComments={tray.passages.some(isAnswered)}
        busy={busy}
        writable={proposal.target.absolute !== null}
        unchanged={unchanged}
        label={commitLabel(proposal, content, state.dryRun)}
        onCommit={commit}
        onDiscard={discard}
      />

      {session.failure ? <div className="status status-error">{session.failure}</div> : null}
    </div>
  );
}
