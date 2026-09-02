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
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { EditorState, ProposalHandle } from "../../shared/types.js";
import { explainRejection } from "../../shared/rejection.js";
import { proposedContent } from "../../shared/state.js";
import { formatUnifiedDiff } from "../../shared/unifiedDiff.js";
import type { ToolContext } from "./context.js";

/** How much diff the model is worth. The panel always shows all of it. */
export const MODEL_DIFF_LINE_BUDGET = 80;

/**
 * The same budget in characters, for a diff whose lines are enormous.
 *
 * A line budget alone counts a two-megabyte single-line file as one line and
 * hands all of it over, which is the whole cost the claim ticket exists to
 * avoid — and it does it silently, with no truncation note.
 */
export const MODEL_DIFF_CHAR_BUDGET = 8_000;

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
 * Describes what happens after an opening call returns.
 *
 * Built from the running configuration rather than written out, because a
 * description that promises to wait while the server returns immediately tells
 * the model its next observation will be a verdict when it is a diff.
 *
 * @param context - Whether opening calls block on the review.
 * @returns A sentence describing how the outcome will arrive.
 */
export function outcomeDescription(context: Pick<ToolContext, "blockOnReview">): string {
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
 * Describes the editor to the model when the session initialises.
 *
 * Ends with the same account of the outcome the tool descriptions carry, so the
 * two cannot disagree about whether an opening call waits.
 *
 * @param context - Whether opening calls block on the review.
 * @returns The server's `instructions` string.
 */
export function serverInstructions(context: Pick<ToolContext, "blockOnReview">): string {
  return (
    "propose_write opens an editable review panel: the human gets a live diff against disk, " +
    "edits your draft in place, and either saves it or comments on it. Reach for it when a " +
    "write is worth a second pair of eyes, and open_file when they would rather write the " +
    "change themselves.\n\n" +
    outcomeDescription(context)
  );
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
    structuredContent: handleFor(state),
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
    structuredContent: handleFor(state),
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
    structuredContent: state,
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

  const { stats } = state;
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
  const full = formatUnifiedDiff(state.diff, proposal.target.display, {
    before: proposal.baseline,
    after: proposedContent(proposal),
  });
  const lines = full.split("\n");
  if (lines.length <= MODEL_DIFF_LINE_BUDGET && full.length <= MODEL_DIFF_CHAR_BUDGET) return full;

  const kept: string[] = [];
  let spent = 0;
  for (const text of lines.slice(0, MODEL_DIFF_LINE_BUDGET)) {
    if (spent + text.length > MODEL_DIFF_CHAR_BUDGET) break;
    kept.push(text);
    spent += text.length + 1;
  }

  const dropped = lines.length - kept.length;
  return [
    ...kept,
    dropped > 0
      ? `… and ${dropped} more diff lines, shown in full in the panel.`
      : `… truncated at ${MODEL_DIFF_CHAR_BUDGET} characters. The panel shows all of it.`,
  ].join("\n");
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
