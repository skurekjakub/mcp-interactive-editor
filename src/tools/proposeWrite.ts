import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, createProposal } from "../proposals.js";
import { VIEW_URI, type ToolContext } from "./context.js";
import { openerResult } from "./results.js";
import { waitForReview } from "./awaitReview.js";

export function registerProposeWrite(server: McpServer, context: ToolContext): void {
  const { guard } = context;

  registerAppTool(
    server,
    "propose_write",
    {
      title: "Propose a file write",
      description:
        "Open an editable review panel for writing a file. Shows the human a diff against what is " +
        "on disk, lets them edit your proposed content directly, and waits for them to decide. " +
        "This tool NEVER writes anything itself. It does not return until they act: either they " +
        "accept it and the result is a receipt for what landed, or they comment on it, which is a " +
        "rejection — nothing is written and the result carries what they want changed, for you to " +
        "redraft and propose again.",
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
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ path, content, rationale }) => {
      const target = await guard.describe(path);
      const proposal = await createProposal(guard, {
        path,
        content,
        mode: target.exists ? "overwrite" : "create",
        rationale,
      });
      const opened = openerResult(buildEditorState(guard, proposal));
      return waitForReview(context, proposal.proposalId, opened);
    },
  );
}
