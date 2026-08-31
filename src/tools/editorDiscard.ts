import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { getProposal, updateProposal } from "../proposals.js";
import { resolveReview } from "../review.js";
import type { ToolContext } from "./context.js";

export function registerEditorDiscard(server: McpServer, _ctx: ToolContext): void {
  registerAppTool(
    server,
    "editor_discard",
    {
      title: "Discard a proposal",
      description: "Called by the panel when the human closes without writing. Not for agent use.",
      inputSchema: { proposalId: z.string(), reason: z.string().optional() },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId, reason }) => {
      const proposal = getProposal(proposalId);
      updateProposal(proposalId, { committedAt: new Date().toISOString() });
      resolveReview(proposalId, { kind: "discarded", ...(reason ? { reason } : {}) });
      return {
        content: [
          {
            type: "text",
            text:
              `Discarded. Nothing was written to ${proposal.target.display}.` +
              (reason ? ` Reason: ${reason}` : ""),
          },
        ],
      } satisfies CallToolResult;
    },
  );
}
