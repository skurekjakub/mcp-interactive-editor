# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-08-31

Four more audits — bug hunting, refactoring, tooling and test quality — each
verified against the vendored specifications, and every defect below reproduced
before it was changed.

### Fixed

- **A flag could eat the next flag.** `--deny --dry-run` took `--dry-run` as the
  deny pattern and left a server that writes to disk when it was asked to
  simulate. A value that begins with a dash and a letter is now refused, naming
  the flag that followed and pointing at `--flag=value` for the rare case where
  that really is the value.
- **Two live drafts of one file could both commit.** The supersede check
  re-resolved the requested path against the working directory while the guard
  resolved it against the configured root. Where those differ — which is the
  shipped `.mcpb` configuration — two spellings of one file compared unequal,
  nothing was superseded, and the older draft landed last over the newer one with
  both reporting success. Resolved targets are now compared directly, and without
  case folding, which would have closed a live review on a case-sensitive
  filesystem.
- **A CRLF file rewritten to LF showed an empty diff and no findings.** Lines are
  compared with their terminators stripped, so every line ending in the file
  could change while the panel reported no change at all — under a live Save
  button. It now says so, and offers to keep the file's own endings.
- **The trailing-whitespace check was quadratic.** A long run of spaces the line
  did not end with took minutes rather than milliseconds, on a scan that runs on
  every keystroke in the panel and again before every commit. It is a linear pass
  now, and preserves CRLF and the final newline.
- **The diff budget bounded each side rather than the table.** A short file
  against an enormous one was under the per-side limit on one side and allocated
  gigabytes. The bound is on the product now.
- **A missing path segment lost a character** when the walk up reached the
  filesystem root, because a root already ends with its separator. The write went
  to a path nobody asked for — and, with the wrong root, one still inside it.
- **Two concurrent commits both cleared the resolved check**, which is not
  reached until after the write. On POSIX that is one approved proposal, two
  writes and two receipts. A proposal is now claimed before the first `await`.
- **Nothing capped what a tool call carried.** `path` and `content` had no
  bounds, so a proposal could be larger than any file this editor would agree to
  open, and an over-long path failed at `rename` with a raw errno quoting an
  internal temp name. Both are bounded at the schema now.
- **The model diff was capped in lines, not characters**, so a single enormous
  line was handed over whole with no truncation note.
- **The panel round-tripped twice on every mount.** Both the claim and the attach
  effect wrote the phase they depended on, so each cancelled its own first call
  and started again — two re-reads of the file, and two attaches whose stored
  baselines could differ.
- **A cancelled session reported itself as attaching.** The phase description
  defaulted, so the one phase that means "stop waiting" read as progress.
- **The panel and the model gave different accounts of a refused path.** The
  model was told which check refused it; the human got a single collapsed
  sentence. Both now read the same explanation.
- **The commit gate had no type behind it.** The SDK's capability helper names a
  type its own package does not export, so its return value resolved to the error
  type and every property read off it checked against nothing. The shape is
  verified explicitly now, and covered by unit tests rather than only by a
  subprocess.
- **CI ran the panel suite on an unsupported Node.** `.nvmrc` pinned 20.10.0
  while jsdom, undici and whatwg-url all require newer. Pinned to 22 with
  `engine-strict` so the mismatch cannot come back quietly.

### Changed

- Assembling the editor state, explaining a refusal and describing a commit each
  live in one place in `shared/`. There were four copies of the first, and one of
  them had already reintroduced a line-count defect fixed elsewhere.
- Command-line parsing moved to `src/cli.ts`, reading its environment, working
  directory and home directory as arguments — so every decision it makes is
  reachable from a unit test rather than only from a spawned server.
- `src/tools/results.ts` is now `src/tools/wording.ts`, which is what its own
  module docblock already called it, and no longer collides with the panel's
  `results.ts`.
- The commit tool declares its annotations. Under `--terminal-approval` the
  client's own approve/deny prompt is the entire gate, and that prompt is
  rendered from them.
- A proposal dropped to make room is remembered as superseded, so a panel holding
  its id is told what happened rather than that the server does not know it.
- The unused `files` field is gone from `package.json`, and the README no longer
  documents a command-line binary that does not exist.

### Added

- ESLint, type-aware, in `npm run verify` and CI, along with `knip` for dead
  exports and `npm audit --omit=dev` for what actually ships.
- Tests for the command line, the commit gate's host check, the proposal store,
  the input bounds and the commit threshold. The threshold had five conditions
  keeping the button shut and no test held any of them.
- A finding for a change that alters only the newline at the end of a file, which
  the diff cannot show.

### Testing

- Removed assertions that could not fail: an editor `disabled` property never
  set, a truthiness check on an already-filtered list, a temp-file check keyed to
  a string copied out of the implementation, and a declaration-count floor below
  the true count. Each was replaced by one that fails when the behaviour breaks.
- The review-gate tests get their own server. They shared a grace period pinned
  short for the opposite reason and lost the race roughly one shuffled run in
  three.
- The claim test now opens two proposals. With one open it took the single-open
  fallback and passed only because earlier tests had left proposals behind.

## [0.6.0] - 2026-08-31

Four independent audits of the whole surface — server, panel, build and one
deliberately unscoped — checked against the vendored MCP Apps and MCP
specifications. Where two agents reached the same conclusion independently it is
noted below. Everything here was reproduced before it was changed.

### Security

- **A malformed UI capability opened the commit gate.** `hostRendersPanel`
  treated an absent `mimeTypes` list as support, so a client declaring
  `extensions: {"io.modelcontextprotocol/ui": {}}` — no mime types at all —
  passed the check that exists to prove a panel can render. MCP Apps § Client
  Capabilities marks the field REQUIRED and `getUiCapability` validates nothing,
  so an absent list is a malformed declaration, not a permissive one. The gate
  now requires the declared list to contain `text/html;profile=mcp-app`.
- **`editor_update` could re-point a proposal at another file.** The reviewed
  file and the written file could differ, while the only human-visible decision
  point — the client's approval prompt for `editor_commit` — shows an opaque
  identifier and no path. The target is now immutable; changing it means opening
  a new proposal, which shows a new diff.
- **`--root=` with an empty value silently made the working directory
  writable**, which is what an operator writing `--root="$PROJECT_DIR"` gets
  from an unset variable. `--deny=` put the empty string in the deny list and
  refused every path in the roots, reported as "outside the roots". Both are
  now startup failures.

### Fixed

- **Saving twice walked through the stale-file refusal and destroyed the other
  writer's change.** The pre-commit re-stat persisted the fresh baseline before
  the comparison, so the second attempt compared the new file against itself and
  wrote. The re-stat is now pure, and a staleness refusal closes the proposal.
- **A refused flush before a commit was ignored**, so the server wrote whatever
  the debounce last managed to send — bytes nobody had looked at — under a green
  receipt. Every panel tool call now goes through one helper that cannot
  silently drop a refusal. _(Found independently by the panel and whole-repo
  audits.)_
- **Refusals carrying no text were reported as the empty string**, which reads
  as "no failure" to anything rendering on truthiness: the button reset and
  nothing appeared. _(Two audits.)_
- **A commit result without a receipt produced a TypeError as the user-facing
  message**, on a call that had in fact written the file.
- **Tab replaced a multi-line selection with two spaces**, and React's
  controlled value made the browser's own undo unreliable. Tab now indents each
  touched line, and Shift+Tab moves focus instead of being swallowed (WCAG
  2.1.2).
- **A delete proposal in the editor-only view rendered an empty panel** with no
  way back, because the view toggle lives in the pane headers and unmounted with
  them.
- **Discarding did nothing observable.** The server resolved the proposal while
  the panel left the review editable with a live commit button.
- **A trailing newline was counted as an extra line everywhere** — the receipt,
  the on-disk size, the `@@` headers, the destructive-deletion ratio, and a
  phantom empty row in the diff. A change that only adds or removes the final
  newline is now reported rather than silently producing an empty diff. _(Two
  audits.)_
- **Commenting on a removal and its replacement produced a backwards line
  range** whose two ends came from different files. Ranges are now reported
  against the new file. Selections ending on a newline no longer name a line
  that was not selected.
- **Every rejection was reported as "outside the roots"**, including files
  sitting inside a root that the deny list caught — printed directly above the
  root containing them. Rejections now name the check that refused them, and the
  deny pattern that matched. _(Two audits.)_
- **Deny patterns matched bare substrings**, so `shortcuts.keymap.ts`,
  `notes.environment.md` and `notes.pemberton.md` were refused. Patterns are now
  anchored to whole filenames and extensions. _(Two audits.)_
- **A directory target threw instead of returning a rendered refusal**,
  contradicting the documented contract and leaving the mounted panel with no
  handle to claim. _(Two audits.)_
- **Committing replaced the file's permissions with the process umask**, so
  editing a `0755` script through the editor left it `0644`. The temp file is
  now `chmod`-ed to match before the rename. _(Two audits.)_
- **Proposals were never evicted.** A panel the human scrolled past stayed open
  forever, each retaining the file three times over, and the second abandoned
  proposal defeated the single-open fallback the panel depends on. _(Two
  audits.)_
- **A discarded proposal reported itself as committed**, because one field meant
  both. Resolution is now recorded separately.
- **`propose_delete` on a file that does not exist reported a successful
  deletion.**
- **A discard before the panel attached burned the whole grace period** before
  the opening call returned.
- **The commit receipt shipped the whole file body back to the model** through a
  blocking opener, contradicting the tool's own description.
- **`read_file` had no size ceiling** and the target was read three or four
  times per opening call. Reads are now capped and the resolved target is passed
  through once. _(Two audits.)_
- **Non-numeric timing flags became `NaN` and silently disabled the wait they
  configured**, reporting the timeout as "within NaN minutes". _(Two audits.)_
- **A failed attach left a fully live-looking editor** whose commit the server
  would refuse. Attaching now retries, and the button reflects it.
- **A stale failure stayed pinned to a working panel**, and a cancelled tool call
  went unnoticed entirely.
- **The comment popover overflowed a narrow panel** by a fixed width that
  clamping cannot fix, stole focus mid-keyboard-selection, and was not exposed
  as a dialog.
- **An uncommented live selection rode along with a send**, contradicting the
  rule the tray enforces on screen. The tray now counts and blocks on exactly
  what would be sent.
- **A refused send discarded the typed message** with no way to recover it.
- **Typing stalled on files of a few hundred lines**, because the diff and lint
  recomputed synchronously inside render on every keystroke.

### Changed

- **`propose_write` and `propose_delete` described the opposite of what they
  do.** Their descriptions promised to wait for a human verdict while the
  shipped default returns immediately, telling the model its next observation
  would be a decision when it is a diff. Descriptions are now generated from the
  running configuration, so they cannot drift from it again.
- **`list_roots` reports the server version**, which is the only way to confirm
  a plugin update actually took.
- **A refused path is now an error result.** An agent checking only `isError`
  read a refusal as an opened panel and waited for a human who was shown
  nothing.
- **`readOnlyHint` corrected** on the tools that initiate writes.
- `_meta.ui` is served on the `resources/read` content item, which is where the
  spec's normative CSP construction reads it from.

### Added

- **A vendored comment policy (`docs/comment-policy.md`) and a checker that
  enforces it.** `npm run lint:comments` walks the TypeScript AST and fails the
  build on a missing docblock, a malformed tag section, or narration — incident
  retellings, counts, and version numbers attached to behaviour.
- **End-to-end coverage of the shipped default.** The whole suite ran with
  `--block-on-review`, which no shipped configuration passes, so the mode every
  install actually runs had none.
- **A release-manifest test.** Nothing checked that the declared versions agreed,
  and `npm run bump` reported success on a tree where only `package.json` had
  moved — leaving the plugin cache key stale for good.
- **CI now fails a pull request that changes `src/`, `shared/` or `ui/` without
  a version bump**, packs the extension so the manifest schema is validated,
  reports the artifact checksum, and fails if a containment test self-skips on
  Linux.
- Panel tests for the commit flow, the discard flow and the comment tray, driven
  through a stub bridge.
- A `.mcpbignore`, so a stray file in `bundle/` cannot ship inside the extension.

### Fixed (build)

- **`npm run pack` deleted the committed `bundle/` and then failed**, leaving the
  repository holding an artifact with no manifest and no panel — the command the
  README tells contributors to run. It now builds first and checks its inputs
  before deleting anything.
- `npm run coverage` could not run; the coverage provider was never a dependency.
- The `node` test project would have run any panel test written as `.ts` in an
  environment with no DOM.

## [0.5.2] - 2026-08-31

### Fixed

- **The panel treated a refused call as an empty one.** A tool that refuses
  answers with `isError: true` and the reason in its text blocks, not a thrown
  rejection — so a `catch` sees nothing. Both the claim loop and the attach path
  read only `structuredContent`, found none, and carried on: thirty seconds of
  retries ending in "asking for one kept coming back empty", while the host had
  been answering with the actual reason ten times a second. Both now surface it
  the moment it arrives.

  This is the same mistake as the loading screen that swallowed its own error,
  one layer further down: the display was fixed and the swallow was left.

- **`editor_pending` said "no proposal is open" for two different situations.**
  It means one thing when the panel asked before the server had finished
  creating the proposal, and something else entirely when several are open and
  none matched the path the host handed back — and they want opposite responses.
  It now reports how many are open and which paths it has, and the panel repeats
  the server's own words instead of its own guess when it gives up.

## [0.5.1] - 2026-08-31

Five things that were owed.

### Added

- **The panel has tests.** Nothing in `ui/` was reachable from the suite, and
  three regressions shipped through that gap while 187 tests stayed green: a
  highlight that could not be commented on, a loading screen that swallowed its
  own error, and a view that removed the editor. Each is now a named test in
  `test/panel`, rendered under jsdom. Reintroducing all three turns five of the
  nine red, which is the only evidence that a regression test is worth having.
- **The panel says when it is a different build from the server.** `EditorState`
  carries `serverVersion`; the panel compares it to its own and puts a line on
  screen when they disagree. The `.mcpb` and the Claude Code plugin update
  independently, and a stale half looks exactly like a bug in the other one — it
  cost two debugging sessions before anything said so.

### Fixed

- **A path the host had renamed could strand the panel forever.**
  `editor_pending` matched `target.requested` by string equality against
  whatever the host handed back in `tool-input`. Any normalisation — slashes,
  case, relative to absolute — missed, and the panel then retried a string it
  could never match until it died on the loading screen. It now compares
  resolved paths, and falls back to the single open proposal when there is
  exactly one, since it can only be that one. With several open it still guesses
  nothing: the panel may be asking before its own proposal exists, and handing it
  someone else's puts it on the wrong file.
- **Tests no longer leak server processes.** Three tests build their own client
  inside the test body and tidy up on the last line, so any failing assertion
  left a live stdio child behind — doubled since the suite began running against
  two entry points. They are wrapped in `try`/`finally`.

### Changed

- Version lives in one module per half, `src/version.ts` and
  `ui/src/lib/version.ts`, instead of being a literal inside unrelated code that
  the bump script had to pattern-match.
- `AGENTS.md` records why a tool call must not wait for the panel, with the
  measurements, the line of spec that makes it a host decision, and why
  elicitation is not the way out.

## [0.5.0] - 2026-08-31

### Changed

- **Holding the tool call open is now opt-in, and off by default.** 0.4.0 made
  every opening call wait for the human. It works — a plain MCP client gets an
  answer from `editor_pending` in 4ms while `propose_write` is still open — but
  it needs the _host_ to keep dispatching the panel's calls during the call that
  created the panel, and the MCP Apps spec requires no such thing: "The Host MAY
  forward any message from the View... it MAY decide to block some messages or
  subject them to further user approval." At least one host does not forward
  them in time. The panel never claims its proposal, sits on "Opening...", and
  the editor is unusable.

  A non-blocking editor is a smaller thing than a blocking one and it works
  everywhere, so that is the default. `--block-on-review` turns the gate back on
  where the host allows it.

  MCP's own answer to "pause and ask the human" is elicitation, which the SDK
  exposes as `server.elicitInput` and whose result is exactly `accept | decline
| cancel`. It is not used here: elicitation renders the _client's_ form from a
  JSON schema, so taking it would mean giving up the editor, which is the entire
  product. The MCP Apps spec and the elicitation spec do not currently compose.

- **Send always delivers.** It resolves the waiting call when there is one, and
  posts the comments as a message when there is not, so the same button does the
  right thing in both modes.

### Added

- **Fullscreen.** The panel now declares `availableDisplayModes` and offers a
  toggle in the tag bar, which asks the host via `ui/request-display-mode` and
  believes the answer rather than the request. The button is hidden entirely
  where the host never offered the mode.

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

[Unreleased]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/skurekjakub/mcp-interactive-editor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/skurekjakub/mcp-interactive-editor/releases/tag/v0.1.0
