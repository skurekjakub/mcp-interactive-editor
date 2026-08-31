import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE, getUiCapability } from "@modelcontextprotocol/ext-apps/server";
import type { FsGuard } from "../fsGuard.js";
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

export type { ToolContext } from "./context.js";
export { VIEW_URI } from "./context.js";

/**
 * Settings that decide who may call the writing tools.
 *
 * The `model`/`app` visibility split is the entire security model. Model-visible
 * tools never touch disk; they open a review panel and read inside the roots.
 * App-only tools are the ones that write, and the MCP Apps spec requires the
 * host to keep them out of the agent's tool list and to reject any call the
 * agent makes for them, so the only caller that exists is the View.
 */
export interface ToolOptions {
  /**
   * Who may call `editor_commit`. Defaults to app-only, which is the whole point.
   * `--terminal-approval` widens it for hosts that cannot render the editor, and
   * trades the editable review for the client's own approve/deny prompt.
   */
  commitVisibility: Array<"model" | "app">;
  /**
   * True when `--terminal-approval` was passed. Without it, a host that cannot
   * render the panel is refused a commit outright rather than trusted.
   */
  terminalApproval?: boolean;
  /** How long an opening call waits for the human. Defaults to REVIEW_TIMEOUT_MS. */
  reviewTimeoutMs?: number;
  /** How long to wait for a panel to attach. Defaults to REVIEW_GRACE_MS. */
  reviewGraceMs?: number;
  /** Hold opening calls open until the human decides. Off unless asked for. */
  blockOnReview?: boolean;
}

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
export function registerTools(
  server: McpServer,
  guard: FsGuard,
  options: ToolOptions = { commitVisibility: ["app"] },
): void {
  const context: ToolContext = {
    guard,
    commitVisibility: options.commitVisibility,
    terminalApproval: options.terminalApproval ?? false,
    reviewTimeoutMs: options.reviewTimeoutMs ?? REVIEW_TIMEOUT_MS,
    reviewGraceMs: options.reviewGraceMs ?? REVIEW_GRACE_MS,
    blockOnReview: options.blockOnReview ?? false,
    canRenderPanel: () => hostRendersPanel(server),
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

/**
 * Reports whether the connected host renders MCP Apps.
 *
 * `visibility: ["app"]` is a request to the host, not a guarantee — a host that
 * does not implement MCP Apps hands every tool to the agent, `editor_attach`
 * included, and the agent can then mark its own proposal as reviewed. A client's
 * declared capabilities are the one input the agent does not get to author, so
 * that is what the commit path asks.
 *
 * MCP Apps § Client Capabilities marks `mimeTypes` REQUIRED, and
 * `getUiCapability` performs no validation of its own. An absent list is
 * therefore a malformed declaration, not a permissive one: treating it as
 * support would let `extensions: {"io.modelcontextprotocol/ui": {}}` open the
 * commit path on a host that renders nothing.
 *
 * @param server - The server whose connected client is being questioned.
 * @returns True only when the client declared the App resource mime type.
 * @gate Carries the "nobody commits what nobody saw" invariant.
 */
function hostRendersPanel(server: McpServer): boolean {
  const ui = getUiCapability(server.server.getClientCapabilities());
  return ui?.mimeTypes?.includes(RESOURCE_MIME_TYPE) === true;
}
