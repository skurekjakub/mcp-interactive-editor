import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, getProposal, updateProposal } from "../proposals.js";
import type { ToolContext } from "./context.js";
import { panelResult } from "./results.js";

export function registerEditorUpdate(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "editor_update",
    {
      title: "Update a pending proposal",
      description: "Called by the panel as the human edits. Not for agent use.",
      inputSchema: {
        proposalId: z.string(),
        content: z.string().optional(),
        path: z.string().optional(),
        destructiveAcknowledged: z.boolean().optional(),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId, content, path, destructiveAcknowledged }) => {
      const current = getProposal(proposalId);
      let next = updateProposal(proposalId, {
        ...(content !== undefined ? { content } : {}),
        ...(destructiveAcknowledged !== undefined ? { destructiveAcknowledged } : {}),
      });

      // Retargeting re-runs the whole guard, including the deny list, and pulls
      // a fresh baseline so the diff matches the new file rather than the old.
      if (path !== undefined && path !== current.target.requested) {
        const target = await guard.describe(path);
        const baseline = target.absolute && target.exists ? await guard.read(target.absolute) : "";
        next = updateProposal(proposalId, {
          target,
          baseline,
          mode: next.mode === "delete" ? "delete" : target.exists ? "overwrite" : "create",
        });
      }

      return panelResult(buildEditorState(guard, next), "Updated.");
    },
  );
}
