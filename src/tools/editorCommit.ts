import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { ToolContext } from "./context.js";
import { commit } from "./commit.js";
import { describeReceipt } from "./results.js";

export function registerEditorCommit(
  server: McpServer,
  { guard, commitVisibility }: ToolContext,
): void {
  registerAppTool(
    server,
    "editor_commit",
    {
      title: "Commit the reviewed write",
      description:
        "The editor. Writes the human-approved content to disk. Called only by the panel, only " +
        "on an explicit click. Not for agent use — the host blocks agent calls to this tool.",
      inputSchema: { proposalId: z.string() },
      _meta: { ui: { visibility: commitVisibility } },
    },
    async ({ proposalId }) => {
      const receipt = await commit(guard, proposalId);
      return {
        content: [{ type: "text", text: describeReceipt(receipt) }],
        structuredContent: receipt as unknown as Record<string, unknown>,
      } satisfies CallToolResult;
    },
  );
}
