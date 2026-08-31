import { useCallback, useState } from "react";
import type { CommitReceipt, EditorState } from "../../../shared/types.js";
import type { Bridge } from "../bridge.js";
import { call } from "../lib/call.js";
import { messageOf, receiptIn, textOf } from "../lib/results.js";

/** Everything the commit flow needs to walk a proposal to disk. */
interface CommitFlowInput {
  bridge: Bridge | null;
  state: EditorState | null;
  content: string;
  ack: boolean;
  onCommitted: (receipt: CommitReceipt) => void;
  onDiscarded: () => void;
  onFailure: (message: string | null) => void;
}

/** The two ways out of a review, and whether one is in progress. */
export interface CommitFlow {
  busy: boolean;
  commit: () => Promise<void>;
  discard: () => Promise<void>;
}

/**
 * Walks a proposal through the one-way door, and closes it behind.
 *
 * The server re-checks everything this sends — staleness, blockers, the root
 * containment — so nothing here is load-bearing for safety. What it is
 * responsible for is telling the model what actually landed, because a human
 * may have committed something other than what was proposed and the rest of the
 * conversation would otherwise be built on a file that does not exist.
 *
 * @param input - The bridge, the proposal, and where to report each outcome.
 * @returns The commit and discard operations, and whether one is running.
 */
export function useCommitFlow({
  bridge,
  state,
  content,
  ack,
  onCommitted,
  onDiscarded,
  onFailure,
}: CommitFlowInput): CommitFlow {
  const [busy, setBusy] = useState(false);

  const commit = useCallback(async () => {
    if (!bridge || !state) return;
    setBusy(true);
    onFailure(null);
    try {
      /*
       * Flush what is on screen before committing it. If the flush does not land
       * the server still holds whatever the debounce last managed to send, so
       * committing anyway would write bytes nobody has looked at — under a
       * receipt claiming they were reviewed. Refusing here is the only place
       * that can tell the difference.
       */
      const flushed = await call(bridge, "editor_update", {
        proposalId: state.proposal.proposalId,
        content,
        destructiveAcknowledged: ack,
      });
      if (flushed.refusal) {
        onFailure(
          `Could not send your edits to the server, so nothing was written. ${flushed.refusal}`,
        );
        return;
      }

      const committed = await call(bridge, "editor_commit", {
        proposalId: state.proposal.proposalId,
      });
      if (committed.refusal) {
        onFailure(committed.refusal);
        return;
      }

      const receipt = receiptIn(committed.result);
      if (!receipt) {
        onFailure(
          `The server reported a commit but sent no receipt, so what landed cannot be shown. ${textOf(committed.result)}`.trim(),
        );
        return;
      }

      /*
       * Tell the model before the panel switches to the receipt. Past that
       * point this component is unmounted and a failure here has nowhere left
       * to render, which would leave the model believing the file still holds
       * what it proposed.
       */
      await bridge.updateModelContext({
        content: [
          {
            type: "text",
            text:
              `${receipt.mode === "delete" ? "Deleted" : "Wrote"} ${receipt.display}` +
              `${receipt.dryRun ? " (dry run, nothing reached disk)" : ""}. ` +
              (receipt.editedByHuman
                ? `The human edited the proposal before approving it. What actually landed:\n\n${receipt.content}`
                : "Committed as proposed."),
          },
        ],
        structuredContent: {
          path: receipt.display,
          sha256: receipt.sha256,
          editedByHuman: receipt.editedByHuman,
        },
      });

      onCommitted(receipt);
    } catch (cause) {
      onFailure(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [bridge, state, content, ack, onCommitted, onFailure]);

  const discard = useCallback(async () => {
    if (!bridge || !state) return;
    setBusy(true);
    onFailure(null);
    try {
      const dropped = await call(bridge, "editor_discard", {
        proposalId: state.proposal.proposalId,
      });
      if (dropped.refusal) {
        onFailure(dropped.refusal);
        return;
      }

      /*
       * If an opening call was waiting, it has just returned saying this was
       * discarded and the agent already knows. Only when nothing was waiting do
       * the words still have to travel.
       */
      const delivered = (dropped.result.structuredContent as { delivered?: boolean } | undefined)
        ?.delivered;
      if (delivered !== true) {
        await bridge.sendMessage(
          `I discarded the proposed write to ${state.proposal.target.display}. Nothing was written.`,
        );
      }

      onDiscarded();
    } catch (cause) {
      onFailure(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [bridge, state, onDiscarded, onFailure]);

  return { busy, commit, discard };
}
