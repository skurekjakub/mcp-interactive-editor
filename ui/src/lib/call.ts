import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { refusalIn } from "./results.js";

/**
 * The one capability needed from a bridge to call a tool.
 *
 * Structural rather than an import of `Bridge`, because everything under `lib/`
 * is pure by rule and typechecks under the server's config: reaching for the
 * bridge module would drag the DOM in behind it.
 */
export interface ToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

/** What a tool call answered, and whether it was refused. */
export interface ToolOutcome {
  /** Why the call was refused, or null if it went through. */
  refusal: string | null;
  result: CallToolResult;
}

/**
 * Calls a tool and reports whether it was refused.
 *
 * One way in, so there is one way to notice a refusal.
 *
 * A refusal is `isError: true` with the reason in the text blocks, not a thrown
 * rejection, so a bare `await bridge.callTool(...)` inside a `try` is
 * indistinguishable from a success. Going through here makes that impossible to
 * forget, which matters most for the calls whose failure is otherwise invisible:
 * a refused write still leaves a panel that looks like it worked.
 *
 * `refusal` is a non-empty string whenever the call did not go through — never
 * the empty string a refusal carrying no text would otherwise produce.
 *
 * @param bridge - How to reach the host.
 * @param name - The tool to call.
 * @param args - Arguments for that tool.
 * @returns The result, and why it was refused when it was.
 */
export async function call(
  bridge: ToolCaller,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const result = await bridge.callTool(name, args);
  return { refusal: refusalIn(result), result };
}
