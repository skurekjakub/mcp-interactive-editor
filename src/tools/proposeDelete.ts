import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, createProposal } from "../proposals.js";
import { VIEW_URI, type ToolContext } from "./context.js";
import { openerResult } from "./results.js";

export function registerProposeDelete(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "propose_delete",
    {
      title: "Propose a file deletion",
      description:
        "Open a review panel for deleting a file. Shows the human everything that would be lost and " +
        "waits for an explicit confirmation. Never deletes anything itself.",
      inputSchema: {
        path: z.string().describe("File to delete."),
        rationale: z.string().optional().describe("Why this file should go."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ path, rationale }) => {
      const proposal = await createProposal(guard, {
        path,
        content: "",
        mode: "delete",
        rationale,
      });
      return openerResult(buildEditorState(guard, proposal));
    },
  );
}
