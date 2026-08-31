import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Whatever came back from a rejected promise, as something showable. */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The reason a tool refused, or null if it did not.
 *
 * A refusal is `isError: true` with the reason in the text blocks — not a thrown
 * rejection — so code that only has a `catch` sees nothing at all. The panel
 * spent thirty seconds retrying `editor_pending` and reporting "kept coming back
 * empty" while the host was answering, every hundred milliseconds, with the
 * actual reason.
 */
export function refusalIn(result: CallToolResult): string | null {
  if (!result.isError) return null;
  const said = textOf(result).trim();
  return said.length > 0 ? said : "The host refused the call without saying why.";
}

/**
 * A tool that refuses comes back as `isError: true` with the reason in the text
 * blocks rather than as a thrown rejection, so the panel reads it from there.
 */
export function textOf(result: CallToolResult): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
