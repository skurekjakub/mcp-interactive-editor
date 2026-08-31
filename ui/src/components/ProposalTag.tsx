import type { DiffStats, Proposal } from "../../../shared/types.js";

interface ProposalTagProps {
  proposal: Proposal;
  stats: DiffStats;
  dryRun: boolean;
  /** Hidden entirely when the host never offered fullscreen — see useProposalSession. */
  canFullscreen: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
}

/**
 * The lockout tag. It says what is being held, why, and how much of the file
 * moves — the three things you need before deciding whether to look closer.
 */
export function ProposalTag({
  proposal,
  stats,
  dryRun,
  canFullscreen,
  fullscreen,
  onToggleFullscreen,
}: ProposalTagProps) {
  return (
    <div className="tag" data-state={proposal.target.absolute ? "held" : "refused"}>
      <span className="tag-state">{proposal.target.absolute ? "Held" : "Refused"}</span>
      <div className="tag-body">
        <div className="tag-path">
          {proposal.target.display} <span className="tag-mode">· {proposal.mode}</span>
        </div>
        {proposal.rationale ? <p className="tag-rationale">{proposal.rationale}</p> : null}
        {dryRun ? <p className="tag-rationale">Dry run — committing will not touch disk.</p> : null}
      </div>
      <div className="tag-meta">
        <span className={stats.added ? "count-add" : "count-flat"}>+{stats.added}</span>
        <span className={stats.removed ? "count-cut" : "count-flat"}>−{stats.removed}</span>
        {canFullscreen ? (
          <button
            type="button"
            className="btn btn-quiet tag-expand"
            onClick={onToggleFullscreen}
            title={fullscreen ? "Back to inline" : "Take over the window"}
            aria-label={fullscreen ? "Back to inline" : "Take over the window"}
          >
            {fullscreen ? "⤡" : "⤢"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
