import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, findOpenProposal } from "../proposals.js";
import type { ToolContext } from "./context.js";
import { panelResult } from "./results.js";

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
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ path }) => {
      /*
       * The host renders the panel when the tool is *called*, and the opening
       * call now waits for the human — so the panel is alive well before any
       * result carrying a proposal id exists. It is handed the arguments
       * instead, and trades them for the proposal here.
       */
      const proposal = findOpenProposal(path);
      if (!proposal) {
        return {
          content: [{ type: "text", text: "No proposal is open." }],
          structuredContent: { open: false },
        } satisfies CallToolResult;
      }

      return panelResult(buildEditorState(guard, proposal), "Claimed the open proposal.");
    },
  );
}
