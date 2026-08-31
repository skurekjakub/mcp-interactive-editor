import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { getProposal, resolveProposal } from "../proposals.js";
import { resolveReview } from "../review.js";
import type { ToolContext } from "./context.js";

/**
 * Registers the tool the panel calls when the human closes without writing.
 *
 * The result reports whether an opening call was waiting, so the panel knows
 * whether the agent has already been told. Without it the panel sends a chat
 * message as well and the agent hears about one discard twice.
 *
 * @param server - The MCP server to register against.
 * @param _context - Unused; discarding touches no files.
 */
export function registerEditorDiscard(server: McpServer, _context: ToolContext): void {
  registerAppTool(
    server,
    "editor_discard",
    {
      title: "Discard a proposal",
      description: "Called by the panel when the human closes without writing. Not for agent use.",
      inputSchema: { proposalId: z.string(), reason: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId, reason }) => {
      const proposal = getProposal(proposalId);
      resolveProposal(proposalId, "discarded");
      const delivered = resolveReview(proposalId, {
        kind: "discarded",
        ...(reason ? { reason } : {}),
      });

      return {
        content: [
          {
            type: "text",
            text:
              `Discarded. Nothing was written to ${proposal.target.display}.` +
              (reason ? ` Reason: ${reason}` : ""),
          },
        ],
        structuredContent: { delivered },
      } satisfies CallToolResult;
    },
  );
}
