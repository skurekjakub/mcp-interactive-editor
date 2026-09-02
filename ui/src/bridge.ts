/**
 * @module
 *
 * The one seam between the panel and the outside world.
 *
 * There are two implementations. The real one, here, talks to the host. The
 * preview one in `preview.ts` runs the same logic in memory so `npm run preview`
 * gives the whole editor in a browser tab with no MCP host, no Claude Desktop,
 * and no risk to any file.
 */
import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult, ContentBlock } from "@modelcontextprotocol/sdk/types.js";

/** Everything the View needs from the outside world, behind one small interface. */
export interface Bridge {
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  updateModelContext(params: {
    content?: ContentBlock[];
    structuredContent?: Record<string, unknown>;
  }): Promise<unknown>;
  sendMessage(text: string): Promise<unknown>;
}

/**
 * Reports whether the panel is running outside a host.
 *
 * A function rather than a module constant so it is evaluated per call. Frozen
 * at import time it is unfaithful under a test runner, where the panel is always
 * top-level: the entire host path — claiming, retrying, refusals, attach —
 * becomes unreachable, and that is the code every shipped regression came from.
 *
 * @returns True when no host frames this View.
 */
export function isPreview(): boolean {
  return typeof window !== "undefined" && window.parent === window;
}

/**
 * Wraps a connected host as a bridge.
 *
 * @param app - The connected MCP App instance.
 * @returns A bridge that forwards to the host.
 */
export function hostBridge(app: App): Bridge {
  return {
    callTool: (name, args) => app.callServerTool({ name, arguments: args }),
    updateModelContext: (params) => app.updateModelContext(params),
    sendMessage: (text) => app.sendMessage({ role: "user", content: [{ type: "text", text }] }),
  };
}
