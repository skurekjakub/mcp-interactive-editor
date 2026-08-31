import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FsGuard } from "../fsGuard.js";
import type { ToolContext } from "./context.js";
import { registerEditorView } from "./view.js";
import { registerProposeWrite } from "./proposeWrite.js";
import { registerOpenFile } from "./openFile.js";
import { registerProposeDelete } from "./proposeDelete.js";
import { registerEditorAttach } from "./editorAttach.js";
import { registerEditorUpdate } from "./editorUpdate.js";
import { registerEditorCommit } from "./editorCommit.js";
import { registerEditorDiscard } from "./editorDiscard.js";
import { registerReadFile } from "./readFile.js";
import { registerListRoots } from "./listRoots.js";

export type { ToolContext } from "./context.js";
export { VIEW_URI } from "./context.js";

/**
 * Two sets of tools, and the split is the entire security model.
 *
 * `visibility: ["model"]` tools can be called by the agent. None of them touch
 * disk — the most they do is open a review panel and read files inside the roots.
 *
 * `visibility: ["app"]` tools are the ones that write, and the host is required
 * by the MCP Apps spec to keep them out of the agent's tool list entirely and to
 * reject any call the agent makes for them. So the model cannot commit a write
 * even if it decides it wants to: the only caller that exists is the View, and
 * the View only calls on a click.
 *
 * One module per tool, and the grouping below is the only place that says which
 * side of the line a tool falls on. Adding a tool is a new file and a new line
 * in the right group here.
 */
export interface ToolOptions {
  /**
   * Who may call `editor_commit`. Defaults to app-only, which is the whole point.
   * `--terminal-approval` widens it for hosts that cannot render the editor, and
   * trades the editable review for the client's own approve/deny prompt.
   */
  commitVisibility: Array<"model" | "app">;
}

export function registerTools(
  server: McpServer,
  guard: FsGuard,
  options: ToolOptions = { commitVisibility: ["app"] },
): void {
  const context: ToolContext = { guard, commitVisibility: options.commitVisibility };

  registerEditorView(server);

  // Model-callable: open a review panel. These never write.
  registerProposeWrite(server, context);
  registerOpenFile(server, context);
  registerProposeDelete(server, context);

  // App-only: the editor itself. The host refuses these from the model.
  registerEditorAttach(server, context);
  registerEditorUpdate(server, context);
  registerEditorCommit(server, context);
  registerEditorDiscard(server, context);

  // Read-only helpers, safe for both callers.
  registerReadFile(server, context);
  registerListRoots(server, context);
}
