import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, createProposal } from "../proposals.js";
import { VIEW_URI, type ToolContext } from "./context.js";
import { openerResult, outcomeDescription } from "./results.js";
import { waitForReview } from "./awaitReview.js";

/**
 * Registers the tool that opens a review panel for writing a file.
 *
 * @param server - The MCP server to register against.
 * @param context - Guard, visibility settings and review timing.
 */
export function registerProposeWrite(server: McpServer, context: ToolContext): void {
  const { guard } = context;

  registerAppTool(
    server,
    "propose_write",
    {
      title: "Propose a file write",
      description:
        "Opens an editable review panel for writing a file. Shows the human a diff against what " +
        "is on disk and lets them edit the proposed content directly before it lands. This tool " +
        "never writes anything itself. " +
        outcomeDescription(context),
      inputSchema: {
        path: z
          .string()
          .describe("File to write. Absolute, or relative to the first configured root."),
        content: z.string().describe("The full new contents of the file."),
        rationale: z
          .string()
          .optional()
          .describe("One or two sentences on why this write. Shown to the human above the editor."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ path, content, rationale }) => {
      const target = await guard.describe(path);
      const baseline = target.absolute && target.exists ? await guard.read(target.absolute) : "";
      const proposal = await createProposal(guard, {
        path,
        content,
        mode: target.exists ? "overwrite" : "create",
        rationale,
        target,
        baseline,
      });
      const opened = openerResult(buildEditorState(guard, proposal));
      return waitForReview(context, proposal.proposalId, opened);
    },
  );
}
