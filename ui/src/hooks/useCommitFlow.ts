import { useCallback, useState } from "react";
import type { CommitReceipt, EditorState } from "../../../shared/types.js";
import type { Bridge } from "../bridge.js";
import { messageOf, textOf } from "../lib/results.js";

interface CommitFlowInput {
  bridge: Bridge | null;
  state: EditorState | null;
  content: string;
  ack: boolean;
  onCommitted: (receipt: CommitReceipt) => void;
  onFailure: (message: string | null) => void;
}

export interface CommitFlow {
  busy: boolean;
  commit: () => Promise<void>;
  discard: () => Promise<void>;
}

/**
 * Walking through the one-way door, and closing it behind you.
 *
 * The server re-checks everything this sends — staleness, blockers, the root
 * containment — so nothing here is load-bearing for safety. What it is
 * responsible for is telling the model what actually landed, because a human
 * may have committed something other than what was proposed and the rest of the
 * conversation would otherwise be built on a file that does not exist.
 */
export function useCommitFlow({
  bridge,
  state,
  content,
  ack,
  onCommitted,
  onFailure,
}: CommitFlowInput): CommitFlow {
  const [busy, setBusy] = useState(false);

  const commit = useCallback(async () => {
    if (!bridge || !state) return;
    setBusy(true);
    onFailure(null);
    try {
      // Flush the final content first, so the server commits exactly what is on
      // screen rather than whatever the debounce last managed to send.
      await bridge.callTool("editor_update", {
        proposalId: state.proposal.proposalId,
        content,
        destructiveAcknowledged: ack,
      });
      const result = await bridge.callTool("editor_commit", {
        proposalId: state.proposal.proposalId,
      });

      if (result.isError) {
        onFailure(textOf(result));
        return;
      }

      const committed = result.structuredContent as unknown as CommitReceipt;
      onCommitted(committed);

      await bridge.updateModelContext({
        content: [
          {
            type: "text",
            text:
              `${committed.mode === "delete" ? "Deleted" : "Wrote"} ${committed.display}` +
              `${committed.dryRun ? " (dry run, nothing reached disk)" : ""}. ` +
              (committed.editedByHuman
                ? `The human edited the proposal before approving it. What actually landed:\n\n${committed.content}`
                : "Committed as proposed."),
          },
        ],
        structuredContent: {
          path: committed.display,
          sha256: committed.sha256,
          editedByHuman: committed.editedByHuman,
        },
      });
    } catch (cause) {
      onFailure(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [bridge, state, content, ack, onCommitted, onFailure]);

  const discard = useCallback(async () => {
    if (!bridge || !state) return;
    setBusy(true);
    try {
      await bridge.callTool("editor_discard", { proposalId: state.proposal.proposalId });
      await bridge.sendMessage(
        `I discarded the proposed write to ${state.proposal.target.display}. Nothing was written.`,
      );
    } catch (cause) {
      onFailure(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [bridge, state, onFailure]);

  return { busy, commit, discard };
}
