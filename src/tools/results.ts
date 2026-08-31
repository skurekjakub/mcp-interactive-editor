import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CommitReceipt, EditorState, ProposalHandle } from "../../shared/types.js";
import { formatUnifiedDiff } from "../../shared/diff.js";
import { diffStatsFor } from "../proposals.js";

/**
 * A tool result has two readers that want opposite things.
 *
 * `content` is the model's half: a summary and a diff. `structuredContent` is
 * the View's paint data — except hosts hand that to the model as well, so
 * returning the whole `EditorState` billed the model for the file three times
 * over on every proposal (`content`, `originalContent`, `baseline`) and made
 * `open_file` leak the body it exists to keep out.
 *
 * So the opening tools return a handle. The View redeems it for the full state
 * through `editor_attach` — a call it already makes on mount, so this costs no
 * round trip that was not already happening.
 *
 * Everything below is pure: given a state, what do the two readers see. The
 * tools own the side effects; this file owns the wording.
 */

/** How much diff the model is worth. The panel always shows all of it. */
export const MODEL_DIFF_LINE_BUDGET = 80;

export function handleFor(state: EditorState): ProposalHandle {
  const { proposal } = state;
  return {
    proposalId: proposal.proposalId,
    display: proposal.target.display,
    mode: proposal.mode,
    ...(proposal.target.absolute ? {} : { refused: true }),
  };
}

/** What an editor-opening tool answers with: the summary, and a claim ticket. */
export function openerResult(state: EditorState): CallToolResult {
  return {
    content: [{ type: "text", text: describeState(state) }],
    structuredContent: handleFor(state) as unknown as Record<string, unknown>,
  };
}

/**
 * For opening a file the human wants to read. Same handle; a text half that says
 * a panel is open and how big the file is, and nothing about what is in it.
 */
export function openedFileResult(state: EditorState): CallToolResult {
  const { target } = state.proposal;

  const text = target.absolute
    ? `Opened ${target.display} in the interactive editor (${target.onDisk?.lines ?? 0} lines). ` +
      `The contents are in the panel, not in this result — call read_file if you need to see them. ` +
      `Wait for the human; they may edit and save, or close it without saving.`
    : `Refused: "${target.requested}" is outside the roots this editor will write to.`;

  return {
    content: [{ type: "text", text }],
    structuredContent: handleFor(state) as unknown as Record<string, unknown>,
  };
}

/**
 * The panel's own tools. This side gets everything, because this side is what
 * renders it, and a result the panel asked for does not go to the model. The
 * text half is one line: nothing reads it.
 */
export function panelResult(state: EditorState, note: string): CallToolResult {
  return {
    content: [{ type: "text", text: note }],
    structuredContent: state as unknown as Record<string, unknown>,
  };
}

export function describeState(state: EditorState): string {
  const { proposal, findings } = state;

  if (!proposal.target.absolute) {
    return (
      `Refused: "${proposal.target.requested}" is outside the roots this editor will write to.\n` +
      `Writable roots:\n${state.roots.map((r) => `  ${r}`).join("\n")}`
    );
  }

  const stats = diffStatsFor(proposal);
  const lines: string[] = [
    `Editor open — nothing has been written.`,
    ``,
    `  ${proposal.mode.toUpperCase()}  ${proposal.target.display}`,
    `  +${stats.added} / -${stats.removed} lines${state.dryRun ? "  (dry run)" : ""}`,
    ``,
  ];

  if (findings.length > 0) {
    lines.push("Findings:");
    for (const f of findings) {
      lines.push(`  [${f.severity}] ${f.message}`);
    }
    lines.push("");
  }

  lines.push(
    diffForModel(state),
    ``,
    `The human reviews and edits this in the editor, then presses the button. ` +
      `You cannot write the file yourself — wait for them, and do not re-propose the same write.`,
  );

  return lines.join("\n");
}

/**
 * The diff, capped. A new file diffs as one long run of additions the model just
 * typed, so printing all of it back is the same content a second time — and the
 * human is reading the panel, not this.
 */
export function diffForModel(state: EditorState): string {
  const full = formatUnifiedDiff(state.diff, state.proposal.target.display);
  const lines = full.split("\n");
  if (lines.length <= MODEL_DIFF_LINE_BUDGET) return full;

  return [
    ...lines.slice(0, MODEL_DIFF_LINE_BUDGET),
    `… and ${lines.length - MODEL_DIFF_LINE_BUDGET} more diff lines, shown in full in the panel.`,
  ].join("\n");
}

export function describeReceipt(receipt: CommitReceipt): string {
  const verb = receipt.mode === "delete" ? "Deleted" : "Wrote";
  const edited = receipt.editedByHuman
    ? " The human edited your proposal before approving it — the content above is what actually landed."
    : "";
  return (
    `${verb} ${receipt.display} (${receipt.lines} lines, ${receipt.bytes} bytes).` +
    (receipt.dryRun ? " DRY RUN — nothing reached disk." : "") +
    edited
  );
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
