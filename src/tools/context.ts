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
}

/** The View every editor-opening tool points at. */
export const VIEW_URI = "ui://interactive-editor/panel.html";
