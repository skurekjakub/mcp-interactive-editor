import { z } from "zod";
import { contentInput } from "./limits.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, updateProposal } from "../proposals.js";
import type { ToolContext } from "./context.js";
import { panelResult } from "./wording.js";

/**
 * Registers the tool the panel calls as the human edits.
 *
 * The proposal's target is deliberately immutable. A tool that could re-point a
 * proposal at another path would let the file that was reviewed and the file
 * that gets written be different files, and the only human-visible decision
 * point — the client's approval prompt for `editor_commit` — shows an opaque
 * identifier, not a path. Changing the target means opening a new proposal,
 * which shows a new diff.
 *
 * @param server - The MCP server to register against.
 * @param context - Guard, for recomputing the diff after each edit.
 */
export function registerEditorUpdate(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "editor_update",
    {
      title: "Update a pending proposal",
      description: "Called by the panel as the human edits. Not for agent use.",
      inputSchema: {
        proposalId: z.string(),
        content: contentInput.optional(),
        destructiveAcknowledged: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId, content, destructiveAcknowledged }) => {
      const next = updateProposal(proposalId, {
        ...(content !== undefined ? { content } : {}),
        ...(destructiveAcknowledged !== undefined ? { destructiveAcknowledged } : {}),
      });

      return panelResult(buildEditorState(guard, next), "Updated.");
    },
  );
}
