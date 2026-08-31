import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, getProposal, refreshTarget, updateProposal } from "../proposals.js";
import type { ToolContext } from "./context.js";
import { panelResult } from "./results.js";

export function registerEditorAttach(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "editor_attach",
    {
      title: "Attach the panel to a proposal",
      description: "Called by the panel when it mounts. Not for agent use.",
      inputSchema: { proposalId: z.string() },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId }) => {
      // Re-stat on attach: the file may have moved on between the model
      // proposing and the human actually looking at the editor.
      await refreshTarget(guard, getProposal(proposalId));
      const proposal = updateProposal(proposalId, { attached: true });
      // This is also where the panel collects the state the opening tool did not
      // return, so it is the one place the whole file legitimately goes over.
      return panelResult(
        buildEditorState(guard, proposal),
        "Attached. The panel has the proposal.",
      );
    },
  );
}
