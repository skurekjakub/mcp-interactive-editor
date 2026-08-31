import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { ToolContext } from "./context.js";
import { commit } from "./commit.js";
import { resolveReview } from "../review.js";
import { describeReceipt } from "./results.js";

/**
 * Registers the tool that writes an approved proposal to disk.
 *
 * @param server - The MCP server to register against.
 * @param context - Guard, visibility settings and the host capability probe.
 */
export function registerEditorCommit(server: McpServer, context: ToolContext): void {
  registerAppTool(
    server,
    "editor_commit",
    {
      title: "Commit the reviewed write",
      description:
        "The editor. Writes the human-approved content to disk. Called only by the panel, only " +
        "on an explicit click. Not for agent use — and in a host that cannot render the panel it " +
        "refuses outright, because then nobody has seen the diff.",
      inputSchema: { proposalId: z.string() },
      _meta: { ui: { visibility: context.commitVisibility } },
    },
    async ({ proposalId }) => {
      const receipt = await commit(context, proposalId);
      // Ends the wait the opening tool call is sitting in.
      resolveReview(proposalId, { kind: "committed", receipt });
      return {
        content: [{ type: "text", text: describeReceipt(receipt) }],
        structuredContent: receipt as unknown as Record<string, unknown>,
      } satisfies CallToolResult;
    },
  );
}
