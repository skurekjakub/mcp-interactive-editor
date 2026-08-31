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
 * This was three lines inline in `App`, and one of them was a bug: it rendered
 * "Opening …" and never read `failure`, so a claim that failed looked exactly
 * like one that was slow — a spinner forever, with the reason sitting in state
 * nothing displayed. Naming the step turns a stall into a bug report.
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
  switch (phase) {
    case "connecting":
      return "waiting for the host";
    case "claiming":
      return "asking the server which proposal this panel is for";
    default:
      return "attaching to the proposal";
  }
}
