import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  CommitReceipt,
  EditorState,
  PathRejection,
  ProposalHandle,
  TargetInfo,
} from "../../shared/types.js";
import { endsWithNewline, formatUnifiedDiff } from "../../shared/diff.js";
import { diffStatsFor } from "../proposals.js";
import type { ToolContext } from "./context.js";

/**
 * @module
 *
 * Wording for the two readers of a tool result.
 *
 * `content` is the model's half: a summary and a diff. `structuredContent` is
 * the View's paint data — except hosts hand that to the model as well, so
 * returning a whole `EditorState` bills the model for the file three times over
 * on every proposal and makes `open_file` leak the body it exists to keep out.
 *
 * The opening tools therefore return a handle. The View redeems it for the full
 * state through `editor_attach`, a call it already makes on mount, so this costs
 * no round trip that was not already happening.
 *
 * Everything here is pure: given a state, what do the two readers see. Side
 * effects belong to the tools; the wording belongs here.
 */

/** How much diff the model is worth. The panel always shows all of it. */
export const MODEL_DIFF_LINE_BUDGET = 80;

/**
 * Builds the claim ticket an opening tool returns.
 *
 * @param state - The freshly opened editor state.
 * @returns Enough for the View to claim the proposal, and no file contents.
 */
export function handleFor(state: EditorState): ProposalHandle {
  const { proposal } = state;
  return {
    proposalId: proposal.proposalId,
    display: proposal.target.display,
    mode: proposal.mode,
    ...(proposal.target.absolute
      ? {}
      : { refused: true, rejection: proposal.target.rejection ?? "unresolvable" }),
  };
}

/**
 * Explains why a path was refused, naming the check that refused it.
 *
 * Collapsing every rejection into "outside the roots" reports a file inside the
 * project as being outside it, directly above the root that contains it, which
 * cannot be debugged from the message.
 *
 * @param target - The refused target.
 * @param roots - The configured writable roots, for the "outside" case.
 * @returns A sentence naming the failed check.
 */
export function explainRejection(target: TargetInfo, roots: string[]): string {
  const reason: PathRejection = target.rejection ?? "unresolvable";
  const quoted = `"${target.requested}"`;

  switch (reason) {
    case "outside-roots":
      return (
        `Refused: ${quoted} is outside the roots this editor will write to.\n` +
        `Writable roots:\n${roots.map((r) => `  ${r}`).join("\n")}`
      );
    case "denied":
      return (
        `Refused: ${quoted} matches the deny list${target.deniedBy ? ` (${target.deniedBy})` : ""}, ` +
        `so this editor will not touch it even though it is inside a writable root. ` +
        `Start the server with --deny to choose your own patterns.`
      );
    case "not-a-file":
      return `Refused: ${quoted} is a directory, not a file.`;
    case "too-large":
      return `Refused: ${quoted} is too large to review in an editor.`;
    case "unresolvable":
    default:
      return `Refused: ${quoted} could not be resolved to a path on disk.`;
  }
}

/**
 * Describes what happens after an opening call returns.
 *
 * Built from the running configuration rather than written out, because a
 * description that promises to wait while the server returns immediately tells
 * the model its next observation will be a verdict when it is a diff.
 *
 * @param context - The running tool context.
 * @returns A sentence describing how the outcome will arrive.
 */
export function outcomeDescription(context: ToolContext): string {
  return context.blockOnReview
    ? "It does not return until the human acts: either they accept it and the result is a " +
        "receipt for what landed, or they comment on it, which is a rejection — nothing is " +
        "written and the result carries what they want changed, for you to redraft."
    : "It returns as soon as the panel is open, so the result is the diff rather than the " +
        "verdict. The outcome arrives separately: a receipt if they saved, or their comments " +
        "quoted against the lines they are about. Comments mean the draft was declined and " +
        "nothing was written, so redraft from what they said rather than re-proposing.";
}

/**
 * Builds what an editor-opening tool answers with.
 *
 * A refused path is reported as an error, because an agent that checks only
 * `isError` would otherwise read a refusal as an opened panel and wait for a
 * human who was never shown anything.
 *
 * @param state - The freshly opened editor state.
 * @returns The summary and a claim ticket.
 */
export function openerResult(state: EditorState): CallToolResult {
  const refused = !state.proposal.target.absolute;
  return {
    content: [{ type: "text", text: describeState(state) }],
    structuredContent: handleFor(state) as unknown as Record<string, unknown>,
    ...(refused ? { isError: true } : {}),
  };
}

/**
 * Builds the answer for opening a file the human wants to read.
 *
 * Carries the same handle, and a text half saying a panel is open and how big
 * the file is — never what is in it.
 *
 * @param state - The freshly opened editor state.
 * @returns The summary and a claim ticket.
 */
export function openedFileResult(state: EditorState): CallToolResult {
  const { target } = state.proposal;

  const text = target.absolute
    ? `Opened ${target.display} in the interactive editor (${target.onDisk?.lines ?? 0} lines). ` +
      `The contents are in the panel, not in this result — call read_file if you need to see them. ` +
      `Wait for the human; they may edit and save, or close it without saving.`
    : explainRejection(target, state.roots);

  return {
    content: [{ type: "text", text }],
    structuredContent: handleFor(state) as unknown as Record<string, unknown>,
    ...(target.absolute ? {} : { isError: true }),
  };
}

/**
 * Builds the answer for one of the panel's own tools.
 *
 * This side gets everything, because this side is what renders it and a result
 * the panel asked for does not reach the model. The text half is one line.
 *
 * @param state - The current editor state.
 * @param note - A short line for logs.
 * @returns The full state as structured content.
 */
export function panelResult(state: EditorState, note: string): CallToolResult {
  return {
    content: [{ type: "text", text: note }],
    structuredContent: state as unknown as Record<string, unknown>,
  };
}

/**
 * Summarises an open proposal for the model.
 *
 * @param state - The editor state to describe.
 * @returns The summary, findings and a capped diff.
 */
export function describeState(state: EditorState): string {
  const { proposal, findings } = state;

  if (!proposal.target.absolute) return explainRejection(proposal.target, state.roots);

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
 * Renders the diff for the model, capped in length.
 *
 * A new file diffs as one long run of additions the model just wrote, so
 * printing all of it back is the same content a second time — and the human is
 * reading the panel rather than this.
 *
 * @param state - The editor state whose diff to render.
 * @returns Unified diff text, truncated with a note when over budget.
 */
export function diffForModel(state: EditorState): string {
  const { proposal } = state;
  const after = proposal.mode === "delete" ? "" : proposal.content;
  const full = formatUnifiedDiff(state.diff, proposal.target.display, {
    before: endsWithNewline(proposal.baseline),
    after: endsWithNewline(after),
  });
  const lines = full.split("\n");
  if (lines.length <= MODEL_DIFF_LINE_BUDGET) return full;

  return [
    ...lines.slice(0, MODEL_DIFF_LINE_BUDGET),
    `… and ${lines.length - MODEL_DIFF_LINE_BUDGET} more diff lines, shown in full in the panel.`,
  ].join("\n");
}

/**
 * Describes what a commit actually did.
 *
 * @param receipt - The receipt returned by the commit path.
 * @returns One sentence naming the file, its size and whether it was edited.
 */
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

/**
 * Builds a refusal.
 *
 * @param message - Why the call was refused.
 * @returns An error result carrying that reason.
 */
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
