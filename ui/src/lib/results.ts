import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Whatever came back from a rejected promise, as something showable. */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
