import type { ProposalSession } from "../hooks/useProposalSession.js";

/** Properties of the pre-proposal status screen. */
interface OpeningStatusProps {
  display: string | undefined;
  phase: ProposalSession["phase"];
  failure: string | null;
}

/**
 * Renders what the panel shows before it has a proposal.
 *
 * Names the step it is waiting on and shows any failure alongside it. Both are
 * load-bearing: a screen that only says "Opening…" makes a claim that failed
 * look exactly like one that is slow, and the reason sits in state nobody reads.
 *
 * @param props - The file being opened, how far the session has got, and any failure.
 * @returns The status screen.
 */
export function OpeningStatus({ display, phase, failure }: OpeningStatusProps) {
  return (
    <div className="status">
      <div>Opening {display ?? "the editor"}…</div>
      <div className="status-phase">{describePhase(phase)}</div>
      {failure ? <div className="status-error">{failure}</div> : null}
    </div>
  );
}

/**
 * Names the step the panel is waiting on.
 *
 * @param phase - Where the session has got to.
 * @returns A phrase for the reader.
 */
function describePhase(phase: ProposalSession["phase"]): string {
  // Every case named rather than defaulted. A default here answered "cancelled"
  // with "attaching to the proposal", so a panel whose call had been abandoned
  // reported itself as busy making progress.
  switch (phase) {
    case "connecting":
      return "waiting for the host";
    case "claiming":
      return "asking the server which proposal this panel is for";
    case "attaching":
      return "attaching to the proposal";
    case "ready":
      return "ready";
    case "cancelled":
      return "the call this panel belongs to was cancelled";
  }
}
