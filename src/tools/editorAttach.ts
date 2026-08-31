import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, getProposal, restatTarget, updateProposal } from "../proposals.js";
import type { ToolContext } from "./context.js";
import { panelResult } from "./wording.js";

/**
 * Registers the tool the panel calls when it mounts.
 *
 * Attaching is what unlocks the commit path, so it is app-only and the state the
 * opening tool withheld travels here instead.
 *
 * @param server - The MCP server to register against.
 * @param context - Guard, for re-reading the target and building the state.
 */
export function registerEditorAttach(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "editor_attach",
    {
      title: "Attach the panel to a proposal",
      description: "Called by the panel when it mounts. Not for agent use.",
      inputSchema: { proposalId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ proposalId }) => {
      // Re-read on attach: the file may have moved on between the model proposing
      // and the human actually looking at the editor.
      const { target, baseline } = await restatTarget(guard, getProposal(proposalId));
      const proposal = updateProposal(proposalId, { target, baseline, attached: true });

      // The panel collects here the state the opening tool did not return, so
      // this is the one place the whole file legitimately travels.
      return panelResult(
        buildEditorState(guard, proposal),
        "Attached. The panel has the proposal.",
      );
    },
  );
}
