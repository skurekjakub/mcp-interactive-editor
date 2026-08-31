# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.2] — 2026-08-31

### Fixed

- **The review did not actually block, and the panel sat on "Opening…" forever.**
  Both came from the same place: the grace period the server waits for a panel to
  attach was four seconds, and the panel's own retry budget was three. A first
  mount has to fetch a half-megabyte UI resource, boot an iframe, run React,
  finish the `ui/initialize` handshake and only then call a tool — it lost that
  race every time. The grace expired, `propose_write` returned "nobody
  answered", and the agent carried on as though there had been no review. Both
  budgets are now 30 seconds.
- **A stall said nothing about why.** The loading branch rendered a bare
  "Opening …" and never read `failure`, so a failed claim or a failed attach
  looked exactly like a slow one. It now names the step it is on — waiting for
  the host, claiming the proposal, attaching — and shows the error when there is
  one.
- The panel kept retrying only until it had a proposal _id_. An id arriving from
  the handle with a failed attach behind it left nothing retrying, so it stayed
  on the loading screen with a proposal it never fetched. It now retries until it
  has the proposal itself.

## [0.4.1] — 2026-08-31

### Fixed

- **A highlight could become uncommentable.** 0.4.0 moved the comment box into a
  popover anchored to the selection and, in doing so, made it the only way in —
  the tray's own "+ Add" row was removed. The popover needs a rectangle to
  position against, and a selection does not always yield one, so wherever the
  anchor came back empty the highlight was silently dropped with nothing to
  click. It never showed up in preview, because a clean mouse drag always
  produces a rectangle.

  The tray takes the pending selection again. The popover is the quick path; the
  tray row is the one that is always there. Both are live at once, and either
  pins the passage.

- The diff pane listens for selections even when there is no diff to show. An
  unchanged file renders through that branch, and a pane that ignores selections
  is worse than one with nothing in it.
- `npm run bump` leaves the tree formatted. Its prettier step has never actually
  run: first through a deprecated shell invocation, then through `npx.cmd`, which
  fails on Windows with `EINVAL` — and because it threw _after_ writing, a bump
  produced a correct version and a failing `format:check`. It now runs prettier's
  entry point under node, which needs neither a shell nor a `.cmd`.

## [0.4.0] — 2026-08-31

The editor stops being a viewer and becomes the thing that decides.

### Changed

- **An opening call does not return until the review is over.** `propose_write`,
  `propose_delete` and `open_file` now hold the tool call open. Accept the draft
  with no comment and it commits, and the call returns the receipt. Comment on it
  and that **is** the rejection: nothing is written, and the call returns the
  human's words for the agent to redraft from.

  Commenting and committing are exclusive on purpose. An agent told "written,
  and here are some notes" treats the work as finished, which is the opposite of
  what someone means by taking the time to say what is wrong with it. In the
  panel, any comment disables the commit button and relabels it.

  This works because the host mounts the View when the tool is _called_, not
  when it returns, and lets the View call tools while that call is outstanding.
  The panel is therefore alive before any result exists, and claims its proposal
  through the new `editor_pending` using the arguments it was handed.

- **Send finishes the call.** It used to go through `ui/message`, which only
  ever drafts into the composer — every send needed a second click elsewhere to
  actually go anywhere. It now resolves the waiting call directly.

### Added

- **The comment box opens above the selection**, in the pane you are reading,
  rather than at the foot of the window. Highlighting three lines and then
  travelling to the bottom of the panel puts the words and the thing they are
  about as far apart as the layout allows. Placement is unit tested: above by
  preference, flipped below only when there is no room, never off-screen.
- The tray at the foot keeps the note that applies to everything, and the
  highlights already pinned.
- `--review-timeout-ms` and `--review-grace-ms`.

### Fixed

- Two ways a waiting call could hang, both closed. A host with no MCP Apps
  support has nobody to wait for and gets the diff as text exactly as before; a
  host that advertises support but never mounts the panel runs out a short grace
  period and gets the same. Neither costs the agent a ten minute stall.

## [0.3.0] — 2026-08-31

Everything here came from watching someone actually use the panel.

### Added

- **Every highlight carries its own comment.** There was one note box for the
  whole batch, so a message came out as a pile of quotes with a single paragraph
  underneath and the reader had to guess which remark belonged to which region.
  Each highlight is now a row with its own field, and the comment is rendered as
  a blockquote directly beneath the passage it is about.
- **The tray docks to the foot of the panel and stays there.** It used to vanish
  when the selection cleared, which meant re-selecting everything to add the
  comment you forgot.
- **Sending waits until every highlight has a comment.** The button says which
  ones are outstanding rather than going quietly with half the question missing.

### Changed

- **Passages are sent in reading order, not clicking order.** Highlighting line
  7 and then line 3 produced a message that opened at line 7, so "the first one"
  meant nothing and the reader had to jump around the file to follow their own
  question.
- **The editor is never taken away.** The `diff` view used to remove it outright,
  leaving a change on screen that could not be typed into — the one thing the
  panel exists to allow. It now shrinks to give the diff room and stays editable.
- The message header is the same shape for one passage as for ten, so a comment
  can sit under any of them without the layout shifting.

## [0.2.1] — 2026-08-31

### Fixed

- **The panel never rendered from the shipped bundle.** `0.2.0` went out looking
  for the panel HTML at `../../ui/index.html` and `../../dist/ui/index.html`,
  which are the nested `dist/` layout. The `.mcpb` and the Claude Code plugin
  both run the flat layout — `<root>/server/index.js` beside `<root>/ui` — so
  the packed server looked outside its own archive, found nothing, threw, and
  the host reported `Unsupported UI resource content length: 0`. The panel was
  in the archive the whole time, all 497 KB of it. Introduced when `tools.ts`
  became `tools/`, and invisible because Claude Code never renders, so the
  loader was never called there.
- The panel loader now says which failure it hit — nothing found, the vite entry
  stub, or a build too small to be complete. They want opposite fixes and all a
  host surfaces is that the resource came back empty.
- The loader also rejects a truncated build rather than serving it. Two of its
  candidate paths resolve above the package root, and "non-empty HTML" was too
  weak a test for something that gets handed the app-only tools.
- `npm run bump` computes every edit before writing any of them. It used to
  write five files and then abort on the sixth, and because its "already at that
  version" guard reads `package.json` — which the failed run had advanced — the
  obvious retry exited 0 and left the rest stale for good.

### Changed

- **The end-to-end suite runs against the shipped tree as well as `dist/`**, from
  a copy outside the repository. Nothing ever executed what actually ships, which
  is how the panel bug reached a release — and running `bundle/` in place would
  not have caught it either, because from `<repo>/bundle/server` the candidate
  `../../dist/ui/index.html` reaches the repo's real panel. That escape hatch
  does not exist inside the archive. Verified by reintroducing the regression:
  green in place, red from a copy. 62 e2e tests now, the whole suite twice.

## [0.2.0] — 2026-08-31

### Security

- **A commit is now gated on the host, not on a flag the agent can set.**
  `visibility: ["app"]` is a request to the host, not a guarantee: a host with no
  MCP Apps support hands the agent every tool, `editor_attach` among them, so the
  agent could mark its own proposal attached and walk through. Verified live —
  `editor_attach` called by a model returned `attached: true`. `commit()` now
  asks the one thing an agent cannot author: whether its own client declared
  support for `text/html;profile=mcp-app` at initialize. No panel support, no
  write. `--terminal-approval` remains the documented, weaker opt-out.
- The README claimed the editor "can never attach, so nothing can be committed."
  The first half was false and the second was only holding because nothing had
  tried it. Corrected to describe the real mechanism.

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

[Unreleased]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/skurekjakub/mcp-interactive-editor/releases/tag/v0.1.0
