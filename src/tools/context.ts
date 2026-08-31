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
  /**
   * Whether an opening call waits for the human at all.
   *
   * Off by default, and that default is the result of a real failure. Holding
   * the call open requires the host to keep dispatching tool calls while one is
   * still outstanding — the panel has to claim its proposal and attach *during*
   * the call that created it. The MCP server does exactly that (a plain client
   * gets an answer in 4ms while an opener is open), but a host is free to
   * serialise, and at least one does: the panel's calls never arrive, it sits on
   * "Opening…", and the editor is unusable.
   *
   * A non-blocking editor is a smaller thing than a blocking one, and it works
   * everywhere. Turn it on with --block-on-review where the host allows it.
   */
  blockOnReview: boolean;
}

/** The View every editor-opening tool points at. */
export const VIEW_URI = "ui://interactive-editor/panel.html";
