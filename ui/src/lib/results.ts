import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CommitReceipt, EditorState } from "../../../shared/types.js";

/**
 * Renders whatever came back from a rejected promise as something showable.
 *
 * @param cause - The thrown value.
 * @returns A displayable message.
 */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Reports the reason a tool refused, or null when it did not.
 *
 * A refusal is `isError: true` with the reason in the text blocks — not a thrown
 * rejection — so code that only has a `catch` sees nothing at all. A refusal
 * carrying no text still returns a reason, because a caller that shows `failure`
 * only when it is truthy would otherwise report nothing.
 *
 * @param result - The tool result to inspect.
 * @returns The reason, or null when the call went through.
 */
export function refusalIn(result: CallToolResult): string | null {
  if (!result.isError) return null;
  const said = textOf(result).trim();
  return said.length > 0 ? said : "The host refused the call without saying why.";
}

/**
 * Extracts the receipt from a commit result, or null when it cannot be one.
 *
 * The panel shows this as proof of what landed and hands it to the model as the
 * account of record, so a blind cast is not good enough: a result without
 * `structuredContent` would turn into a TypeError read out as the user-facing
 * message, on a call that did in fact write the file.
 *
 * @param result - The result of a commit call.
 * @returns The receipt, or null when the result cannot carry one.
 */
export function receiptIn(result: CallToolResult): CommitReceipt | null {
  const candidate = result.structuredContent as Partial<CommitReceipt> | undefined;
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof candidate.display !== "string" || typeof candidate.sha256 !== "string") return null;
  if (typeof candidate.mode !== "string") return null;
  return candidate as CommitReceipt;
}

/**
 * Extracts the editor state from one of the panel's own results, when it carries one.
 *
 * The panel's tools answer with the whole state; a claim that found nothing
 * answers with a note instead. Only a payload naming a proposal is a state.
 *
 * @param result - The result of a claim, attach or update call.
 * @returns The state, or null when the result carries none.
 */
export function stateIn(result: CallToolResult): EditorState | null {
  const candidate = result.structuredContent as Partial<EditorState> | undefined;
  return candidate?.proposal ? (candidate as EditorState) : null;
}

/**
 * Reports whether the server already told the agent about this outcome.
 *
 * A blocking opening call returns the decision as its own result, so the panel
 * saying it again is the agent hearing it twice. Only an explicit `true` counts:
 * anything else — a server that does not set the field, a result with no
 * structured half — means nobody has said it yet, and a message that never
 * travels is the worse of the two failures.
 *
 * @param result - The result of a discard, commit or request-changes call.
 * @returns True only when the server states it has already been delivered.
 */
export function deliveredIn(result: CallToolResult): boolean {
  const candidate = result.structuredContent as { delivered?: unknown } | undefined;
  return candidate?.delivered === true;
}

/**
 * Joins every text block of a result into one string.
 *
 * A tool that refuses comes back as `isError: true` with the reason in the text
 * blocks rather than as a thrown rejection, so the panel reads it from there.
 *
 * @param result - The tool result to read.
 * @returns The concatenated text.
 */
export function textOf(result: CallToolResult): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
