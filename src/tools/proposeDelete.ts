import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, createProposal } from "../proposals.js";
import { VIEW_URI, type ToolContext } from "./context.js";
import { errorResult, openerResult, outcomeDescription } from "./results.js";
import { waitForReview } from "./awaitReview.js";

/**
 * Registers the tool that opens a review panel for deleting a file.
 *
 * @param server - The MCP server to register against.
 * @param context - Guard, visibility settings and review timing.
 */
export function registerProposeDelete(server: McpServer, context: ToolContext): void {
  const { guard } = context;
  registerAppTool(
    server,
    "propose_delete",
    {
      title: "Propose a file deletion",
      description:
        "Opens a review panel for deleting a file. Shows the human everything that would be lost " +
        "and waits for an explicit confirmation. Never deletes anything itself. " +
        outcomeDescription(context),
      inputSchema: {
        path: z.string().describe("File to delete."),
        rationale: z.string().optional().describe("Why this file should go."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ path, rationale }) => {
      const target = await guard.describe(path);

      // Deleting something that is not there is not a deletion, and reporting it
      // as one tells the agent a file was removed that never existed.
      if (target.absolute && !target.exists) {
        return errorResult(`${target.display} does not exist, so there is nothing to delete.`);
      }

      const baseline = target.absolute && target.exists ? await guard.read(target.absolute) : "";
      const proposal = await createProposal(guard, {
        path,
        content: "",
        mode: "delete",
        rationale,
        target,
        baseline,
      });
      const opened = openerResult(buildEditorState(guard, proposal));
      return waitForReview(context, proposal.proposalId, opened);
    },
  );
}
