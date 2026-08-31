import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { buildEditorState, createProposal } from "../proposals.js";
import { VIEW_URI, type ToolContext } from "./context.js";
import { openedFileResult } from "./results.js";

export function registerOpenFile(server: McpServer, { guard }: ToolContext): void {
  registerAppTool(
    server,
    "open_file",
    {
      title: "Open a file for the human to edit",
      description:
        "Open a file in the review panel so the human can read it and change it by hand. Loads the " +
        "current contents into the editor; nothing is written until they press the button. Use this " +
        "when they want to look at or edit a file themselves rather than have you rewrite it — and " +
        "note that the file body goes to the panel, not into your context, so use read_file if you " +
        "need to see it too.",
      inputSchema: {
        path: z
          .string()
          .describe("File to open. Absolute, or relative to the first configured root."),
        note: z
          .string()
          .optional()
          .describe("Optional line shown above the editor, e.g. what they asked for."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      });
      // Deliberately not openerResult: opening a file to read it yourself should
      // not report it back as a diff either.
      return openedFileResult(buildEditorState(guard, proposal));
    },
  );
}
