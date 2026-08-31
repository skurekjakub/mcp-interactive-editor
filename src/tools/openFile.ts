import { z } from "zod";
import { pathInput } from "./limits.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, createProposal } from "../proposals.js";
import { VIEW_URI, type ToolContext } from "./context.js";
import { openedFileResult, outcomeDescription } from "./wording.js";
import { waitForReview } from "./awaitReview.js";

/**
 * Registers the tool that opens an existing file for the human to edit.
 *
 * @param server - The MCP server to register against.
 * @param context - Guard, visibility settings and review timing.
 */
export function registerOpenFile(server: McpServer, context: ToolContext): void {
  const { guard } = context;
  registerAppTool(
    server,
    "open_file",
    {
      title: "Open a file for the human to edit",
      description:
        "Opens a file in the review panel so the human can read it and change it by hand. Loads " +
        "the current contents into the editor; nothing is written until they press the button. " +
        "Use this when they want to look at or edit a file themselves rather than have you " +
        "rewrite it. The file body goes to the panel, not into your context, so call read_file " +
        "if you need to see it too. " +
        outcomeDescription(context),
      inputSchema: {
        path: pathInput.describe(
          "File to open. Absolute, or relative to the first configured root.",
        ),
        note: z
          .string()
          .optional()
          .describe("Optional line shown above the editor, e.g. what they asked for."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ path, note }) => {
      const target = await guard.describe(path);
      const current = target.absolute && target.exists ? await guard.read(target.absolute) : "";
      const proposal = await createProposal(guard, {
        path,
        content: current,
        mode: target.exists ? "overwrite" : "create",
        rationale: note ?? "Opened for editing. Nothing changes until it is saved.",
        target,
        baseline: current,
      });
      // Deliberately not openerResult: opening a file to read it should not
      // report the contents back as a diff either.
      const opened = openedFileResult(buildEditorState(guard, proposal));
      return waitForReview(context, proposal.proposalId, opened);
    },
  );
}
