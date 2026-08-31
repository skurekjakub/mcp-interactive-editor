import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { SERVER_VERSION } from "../version.js";
import type { ToolContext } from "./context.js";

/**
 * Registers the diagnostic tool that reports roots and host capability.
 *
 * The version is included because two installs of this editor — a `.mcpb`
 * extension and a plugin — update on separate cycles, and there is otherwise no
 * way to confirm which build is answering.
 *
 * @param server - The MCP server to register against.
 * @param context - Guard and the host capability probe.
 */
export function registerListRoots(server: McpServer, context: ToolContext): void {
  const { guard } = context;

  registerAppTool(
    server,
    "list_roots",
    {
      title: "List writable roots",
      description:
        "The directories this editor will write inside, and whether the connected host can " +
        "actually render the review panel. Call this first when the editor does not appear.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async () => {
      const rendersPanel = context.canRenderPanel();

      // Whether a panel can ever appear decides whether a write can ever land,
      // so say it plainly rather than making someone infer it from a refusal.
      const verdict = rendersPanel
        ? "This host renders the panel: proposals open an editor and can be committed there."
        : context.terminalApproval
          ? "This host does NOT render the panel. --terminal-approval is on, so commits fall " +
            "back to your client's own approve/deny prompt."
          : "This host does NOT render the panel, so no proposal can be committed. Nothing is " +
            "broken — that is the designed refusal. Use a host with MCP Apps support, or start " +
            "the server with --terminal-approval to use your client's prompt as the gate.";

      return {
        content: [
          {
            type: "text",
            text:
              `mcp-interactive-editor ${SERVER_VERSION}\n\n` +
              `Writable roots:\n${guard.roots.map((r) => `  ${r}`).join("\n")}\n\n${verdict}` +
              (guard.dryRun ? "\n\nDRY RUN: commits are simulated, nothing reaches disk." : ""),
          },
        ],
        structuredContent: {
          serverVersion: SERVER_VERSION,
          roots: guard.roots,
          dryRun: guard.dryRun,
          rendersPanel,
          terminalApproval: context.terminalApproval,
          blockOnReview: context.blockOnReview,
        },
      };
    },
  );
}
