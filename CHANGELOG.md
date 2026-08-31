# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The editor-opening tools — `propose_write`, `propose_delete`, `open_file` —
  return a small handle as `structuredContent` instead of the whole
  `EditorState`. Hosts hand `structuredContent` to the model as well as to the
  panel, so every proposal charged the model for the file three times over
  (`content`, `originalContent`, `baseline`), and `open_file` leaked the body it
  exists to keep out. The panel redeems the handle through the `editor_attach`
  call it already made on mount, so nothing is fetched that was not being
  fetched already. A proposal against a 21 KB file went from 78,858 characters
  to 730.
- The diff printed back to the model is capped at 80 lines. The panel still
  shows all of it. A new file diffs as one long run of additions the model has
  just typed, so the tail was that content a second time.
- `editor_attach` and `editor_update` answer with one line rather than a
  rendered diff that only the panel ever received and never read.
- Selection maths and chat-message formatting moved to `shared/passages.ts`,
  where they are unit tested. The panes keep only the part that needs a browser.
- The server's `instructions` describe what the editor is for rather than what
  the model may not do.
- **One module per tool.** `src/tools.ts` became `src/tools/`, a file per tool
  plus `context.ts` (what every tool is handed), `view.ts`, `commit.ts` and
  `results.ts`. Adding a tool is now a new file and one line in `index.ts`, and
  `index.ts` is the only place that says which side of the model/app visibility
  line a tool falls on. The result shaping in `results.ts` is pure and tested.
- **The panel is components and hooks.** `App.tsx` went from ~470 lines to
  wiring: lifetimes live in `hooks/` (`useProposalSession`, `usePassages`,
  `useCommitFlow`) and shapes live in `components/` (`ProposalTag`,
  `ReviewPanes`, `Threshold`, `Receipt`, `ViewToggle`). Pure UI helpers live in
  `ui/src/lib/`, which is now covered by the test config — that directory is
  pure by rule, and anything touching the DOM stays out of it.
- Fixed a path in the panel-HTML fallback that climbed one level too far and
  would have looked outside the package when running from source.

### Added

- Select inside the diff pane, not just the editor. It is the pane you are most
  likely to want to point at, and it was the one that could not be pointed at.
- Stack several passages into one message. Each is quoted with its own line
  numbers and marked with the pane it came from.
- The note box is a textarea: Enter sends, shift+Enter is a newline. An
  instruction is often more than one line.

### Fixed

- A re-attach no longer overwrites what the human has typed into the panel.
- A quoted passage that itself contains a code fence no longer closes the quote
  early, which used to turn the rest of the message into instructions.

## [0.1.0] — 2026-08-31

First cut.

### Added

- `propose_write` and `propose_delete`: open an editable review panel instead of
  writing. Neither touches disk.
- `open_file`: load a file into the panel for the human to edit, deliberately
  keeping the body out of the model's result.
- Live diff against what is on disk, recomputed on every keystroke from the same
  modules the server uses to check the commit.
- Select a passage in the editor and send it to the chat with a question, quoted
  with path and line numbers.
- Panel-only commit path (`_meta.ui.visibility: ["app"]`), so the model cannot
  approve its own write; plus a server-side refusal for any proposal no panel
  attached to.
- `FsGuard`: root containment through symlinks, a deny list for `.git`,
  `node_modules`, `.env`, keys and credentials, and atomic temp-and-rename
  writes.
- Findings with one-click fixes: trailing newline, mixed line endings, CRLF into
  an LF file, trailing whitespace, indentation disagreeing with the file.
- Blockers for large deletions, emptying a file, deleting a file, stale files
  that changed while the editor was open, paths outside the roots, and null bytes.
- `--dry-run` / `INTERACTIVE_EDITOR_DRY_RUN`, `--root-from-cwd`, `--deny`,
  `--allow-everything-in-roots`.
- `--terminal-approval` for hosts that cannot render the panel, trading the
  editable review for the client's own approve/deny prompt.
- Distribution: `.mcpb` bundle for one-click install in Claude Desktop, a Claude
  Code plugin marketplace, a VS Code install deeplink, and `server.json` for the
  MCP registry.

[Unreleased]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/skurekjakub/mcp-interactive-editor/releases/tag/v0.1.0
