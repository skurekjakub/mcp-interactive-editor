import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FsGuard } from "../fsGuard.js";
import { rendersPanel } from "../hostCapability.js";
import { REVIEW_GRACE_MS, REVIEW_TIMEOUT_MS } from "../review.js";
import type { ToolContext } from "./context.js";
import { registerEditorView } from "./view.js";
import { registerProposeWrite } from "./proposeWrite.js";
import { registerOpenFile } from "./openFile.js";
import { registerProposeDelete } from "./proposeDelete.js";
import { registerEditorAttach } from "./editorAttach.js";
import { registerEditorUpdate } from "./editorUpdate.js";
import { registerEditorCommit } from "./editorCommit.js";
import { registerEditorDiscard } from "./editorDiscard.js";
import { registerEditorRequestChanges } from "./editorRequestChanges.js";
import { registerEditorPending } from "./editorPending.js";
import { registerReadFile } from "./readFile.js";
import { registerListRoots } from "./listRoots.js";

/**
 * Settings that decide who may call the writing tools.
 *
 * The `model`/`app` visibility split is the entire security model. Model-visible
 * tools never touch disk; they open a review panel and read inside the roots.
 * App-only tools are the ones that write, and the MCP Apps spec requires the
 * host to keep them out of the agent's tool list and to reject any call the
 * agent makes for them, so the only caller that exists is the View.
 */
export type ToolOptions = Partial<Omit<ToolContext, "guard" | "canRenderPanel">>;

/**
 * Registers every tool, on the correct side of the visibility split.
 *
 * The grouping below is the only place that records which side a tool falls on,
 * so adding a tool means a new module and a new line in the right group.
 *
 * @param server - The MCP server to register against.
 * @param guard - Filesystem guard enforcing root containment for every path.
 * @param options - Who may commit, and how long opening calls wait.
 */
export function registerTools(server: McpServer, guard: FsGuard, options: ToolOptions = {}): void {
  const context: ToolContext = {
    guard,
    commitVisibility: options.commitVisibility ?? ["app"],
    terminalApproval: options.terminalApproval ?? false,
    reviewTimeoutMs: options.reviewTimeoutMs ?? REVIEW_TIMEOUT_MS,
    reviewGraceMs: options.reviewGraceMs ?? REVIEW_GRACE_MS,
    blockOnReview: options.blockOnReview ?? false,
    canRenderPanel: () => rendersPanel(server.server.getClientCapabilities()),
  };

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
  registerEditorRequestChanges(server, context);
  registerEditorPending(server, context);

  // Read-only helpers, safe for both callers.
  registerReadFile(server, context);
  registerListRoots(server, context);
}
