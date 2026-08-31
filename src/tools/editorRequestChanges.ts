import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { getProposal, updateProposal } from "../proposals.js";
import { resolveReview } from "../review.js";
import type { ToolContext } from "./context.js";

export function registerEditorRequestChanges(server: McpServer, _context: ToolContext): void {
  registerAppTool(
    server,
    "editor_request_changes",
    {
      title: "Send the human's comments back and reject the draft",
      description:
        "Called by the panel when the human comments instead of accepting. Not for agent use.",
      inputSchema: {
        proposalId: z.string(),
        message: z.string().describe("The human's comments, already quoted against their lines."),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId, message }) => {
      const proposal = getProposal(proposalId);

      /*
       * Commenting is declining. There is no path where a draft lands *and*
       * carries remarks: an agent told "written, and here are some notes" treats
       * the work as finished, which is exactly the wrong reading of someone
       * taking the time to say what is wrong with it.
       *
       * Marking it resolved also closes the door behind us, so a stale panel
       * cannot come back and commit the content that was just rejected.
       */
      updateProposal(proposalId, { committedAt: new Date().toISOString() });
      const waited = resolveReview(proposalId, { kind: "changes-requested", message });

      return {
        content: [
          {
            type: "text",
            text: waited
              ? `Sent back for a redraft. Nothing was written to ${proposal.target.display}.`
              : // No opening call was waiting — a terminal host, or one that
                // already timed out. Say so rather than pretending it landed.
                `Nothing was waiting on this review, so the comments have nowhere to go. ` +
                `Nothing was written to ${proposal.target.display}.`,
          },
        ],
        structuredContent: { delivered: waited },
      } satisfies CallToolResult;
    },
  );
}
