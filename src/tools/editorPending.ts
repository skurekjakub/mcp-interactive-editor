import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, findOpenProposal, openProposals } from "../proposals.js";
import type { ToolContext } from "./context.js";
import { panelResult } from "./wording.js";

/**
 * Registers the tool a panel uses to claim the proposal it was opened for.
 *
 * @param server - The MCP server to register against.
 * @param context - Guard, for building the state to hand back.
 */
export function registerEditorPending(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "editor_pending",
    {
      title: "Claim the proposal this panel was opened for",
      description:
        "Called by the panel when it mounts before the opening call returns. Not for agent use.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Narrow to one file, from the arguments the panel was handed."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ path }) => {
      /*
       * The host renders the panel when the tool is *called*, and the opening
       * call now waits for the human — so the panel is alive well before any
       * result carrying a proposal id exists. It is handed the arguments
       * instead, and trades them for the proposal here.
       */
      const proposal = await findOpenProposal(path);
      if (!proposal) {
        /*
         * Say what is actually here. "No proposal is open" is true of both the
         * ordinary case — the panel asked before the server finished creating
         * it — and the bad one, where several are open and none matched the path
         * the host handed back. Those want opposite responses, and a panel that
         * cannot tell them apart retries for thirty seconds and then reports
         * that asking kept coming back empty.
         */
        const open = await openProposals();
        return {
          content: [
            {
              type: "text",
              text:
                open.length === 0
                  ? "No proposal is open yet."
                  : `No open proposal matches ${path ?? "(no path given)"}. ` +
                    `Open: ${open.map((p) => p.target.requested).join(", ")}`,
            },
          ],
          structuredContent: {
            open: false,
            openCount: open.length,
            openPaths: open.map((p) => p.target.requested),
          },
        } satisfies CallToolResult;
      }

      return panelResult(buildEditorState(guard, proposal), "Claimed the open proposal.");
    },
  );
}
