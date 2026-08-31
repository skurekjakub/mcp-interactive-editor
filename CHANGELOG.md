# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
