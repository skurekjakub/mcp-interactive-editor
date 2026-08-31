import type { FsGuard } from "../fsGuard.js";

/**
 * What every tool module is handed.
 *
 * One object rather than a growing list of positional arguments, so adding a
 * tool stays one new file plus one line in `index.ts`, and so a tool cannot
 * quietly reach for something it was not given.
 */
export interface ToolContext {
  guard: FsGuard;
  /**
   * Who may call `editor_commit`. Defaults to app-only, which is the whole point.
   * `--terminal-approval` widens it for hosts that cannot render the editor, and
   * trades the editable review for the client's own approve/deny prompt.
   */
  commitVisibility: Array<"model" | "app">;
  /**
   * Whether the connected host actually renders MCP Apps.
   *
   * A thunk, not a value: capabilities are only known after `initialize`, which
   * happens after the tools are registered.
   */
  canRenderPanel: () => boolean;
  /** True when `--terminal-approval` was passed and the client's prompt is the gate. */
  terminalApproval: boolean;
  /**
   * How long an opening tool call waits for the human before giving up. The wait
   * is the point — the agent learns what happened to its draft in the result of
   * the call it already made — but a walked-away review has to end eventually.
   */
  reviewTimeoutMs: number;
  /**
   * How long to wait for a panel to attach before concluding this host is not
   * going to show one, whatever it advertised at initialize.
   */
  reviewGraceMs: number;
}

/** The View every editor-opening tool points at. */
export const VIEW_URI = "ui://interactive-editor/panel.html";
