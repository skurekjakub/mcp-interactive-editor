# Working on this repository

Read `CONTRIBUTING.md` for setup and what a change needs. This file is the
operational stuff that is easy to get wrong and expensive to debug.

## Before you finish a session, ask what should outlive it

At the end of substantial work, judge whether anything learned should be written
down, and say so rather than letting it evaporate:

- **A repeatable procedure** — something a future session would otherwise have to
  work out again from scratch → a skill under `.claude/skills/`. `cut-release`,
  `multi-agent-audit` and `vacuous-test-hunt` are there already; extend one
  before adding a fourth that overlaps it.
- **A constraint or invariant this file does not yet state** → a section here.
- **A rule the build could enforce instead of a document** → prefer that. A check
  in `npm run verify` does not go stale; a paragraph does.

Nothing to record is a legitimate answer, and the common one for a small change.
When it is a close call — or the knowledge is about the user's preferences rather
than the code — ask rather than deciding alone. Do not write a skill for
something done once, and do not restate what the code, the tests or `git log`
already say.

## Comments are contracts, and the build enforces it

`docs/comment-policy.md` is the rule, and `npm run lint:comments` is the check.
It runs inside `npm run verify` and in CI, walks the TypeScript AST, and fails on
a violation.

The short version:

- A docblock on every top-level function, type, interface and component, written
  for an unknown caller. Summary sentence first, ending in a period; functions
  open it with a third-person verb (`Renders`, `Resolves`, `Returns`).
- Inline comments only where correct-looking code is wrong or wrong-looking code
  is right. Cite a locator when the constraint is external.
- **No accounting and no enumerating.** State the contract and the constraint in
  the present tense. Do not recount what went wrong before, tally how many places
  do a thing, or attach a version number to a defect. That belongs in `git log`
  and the changelog; repeating it in the source guarantees it goes stale in place.

This applies to Markdown in the repository too, including this file.

## Ship a version bump with every change, or nobody gets the change

**The declared version is a cache key, not decoration.**

Claude Code materialises an installed plugin into a version-stamped directory:

```
~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
```

That directory is rebuilt **only when the declared version changes**.
`claude plugin marketplace update` refreshes the marketplace _clone_ and does not
touch it. Merging to `main` without bumping leaves every existing install running
the tree it first installed, and the symptom is maddening: `git log` on both the
repo and the plugin clone show the commit while the running server behaves like
the old one.

Bump with:

```bash
npm run bump -- <version>
```

That moves every declaration at once and refuses to run if they already disagree.
`test/unit/release.test.ts` fails when they drift, and CI fails a pull request
that touches `src/`, `shared/` or `ui/` without moving the version. Then write
the `CHANGELOG.md` section, and:

```bash
npm run verify && npm run bundle
```

`server.json` is deliberately **not** bumped. It describes a published `.mcpb`
with a `fileSha256`, so it should lag until that release actually exists —
pointing it at a tag that was never cut makes the registry manifest wrong rather
than merely stale.

To pick a new version up locally: `claude plugin update interactive-editor`, then
restart the host. `list_roots` reports the running server's version, which is the
only way to confirm the update took.

## `bundle/` is checked in and CI fails if it drifts

Claude Code installs plugins by cloning with no build step, so `bundle/` is the
artifact that actually runs. Changed anything in `src/` or `ui/`? Run
`npm run bundle` and commit the result.

`npm run pack` builds first, and checks its inputs before deleting `bundle/`.
Anything that regenerates the bundle must keep that order: failing after the
delete leaves the repository holding an artifact with no manifest and no panel,
which is worse than not running at all and looks identical to success until
somebody installs it.

## Two invariants that are the whole point of the project

**Never put a file body in `structuredContent`.** It has two readers: the panel
paints from it, and the host hands the same object to the model. Returning a
whole `EditorState` from an opening tool charges the model for the file several
times over — `content`, `originalContent` and `baseline` — and can exceed a
tool-result limit outright. Opening tools return a `ProposalHandle`; the panel
redeems it via the `editor_attach` it already calls on mount, and that call is
the one place the whole file legitimately crosses. The same reasoning strips
`content` from a receipt travelling back through a blocking opener.

**`attached` is not a security boundary.** `visibility: ["app"]` is a request to
the host, not a guarantee. A host without MCP Apps support hands the agent every
tool, `editor_attach` included, so an agent can mark its own proposal reviewed.
The load-bearing check in `commit()` is the host capability: if the client never
declared `text/html;profile=mcp-app` at initialize, no panel rendered, nobody saw
the diff, and the write is refused. That check requires the declared `mimeTypes`
list to actually contain the type — MCP Apps § Client Capabilities marks the
field REQUIRED, and `getUiCapability` validates nothing, so an absent list is a
malformed declaration rather than a permissive one. `--terminal-approval` is the
documented, weaker opt-out. End-to-end tests walk the whole attack — propose,
self-attach, commit — and assert the refusal. Do not weaken them.

## Do not make a tool call wait for the panel by default

Blocking requires the host to keep forwarding the panel's own calls _during_ the
call that created the panel, and the MCP Apps spec explicitly refuses to promise
that:

> The Host MAY forward any message from the View ... it MAY decide to block some
> messages or subject them to further user approval.

The server itself dispatches concurrently and answers the panel promptly while an
opener is outstanding, so the failure is not in this code. Where a host does not
forward in time, the panel cannot claim its proposal, sits on "Opening…", and the
editor — the entire product — is unusable.

So blocking is `--block-on-review`, off by default. Do not make it the default
without testing in a real host first: a passing suite proves nothing here,
because the suite drives the server directly and never renders.

The tool descriptions the model sees are generated from that setting, so they
cannot promise a wait that will not happen. Keep it that way.

**Elicitation is not the way out.** MCP's own primitive for pausing to ask is
`server.elicitInput`, and its result is exactly `accept | decline | cancel` — the
right shape. It renders the _client's_ form from a JSON schema, so adopting it
means giving up the editor. The Apps spec and the elicitation spec do not
reference each other.

## Where code goes, so it can be tested

Two vitest projects: `node` (`test/unit` + `test/e2e`, no DOM, excludes
`test/panel`) and `panel` (`test/panel`, jsdom + React). `tsconfig.test.json`
covers `shared/`, `src/`, `ui/src/lib/` and the `.mjs` scripts; the panel
typechecks under `ui/tsconfig.json`, the one with DOM and JSX.

`test/panel` exists because `ui/` is unreachable from the other two projects, and
that gap is where regressions reach releases. Rendering `<App />` under jsdom puts
it in preview mode — no frame means no host — so it comes up on the fixture
proposal with a real diff and the bridge stub, and can be driven with `fireEvent`.
`isPreview()` is a function rather than a constant so a test can drive the host
path with a stub bridge instead.

The e2e suite runs against `dist/` and against a **copy of `bundle/` placed
outside the repository**. The copy is the point: run in place and
`../../dist/ui/index.html` resolves onto the real panel, so a server that had
lost the flat-layout candidate would still pass while the shipped `.mcpb` served
nothing. It also runs both the blocking and the default non-blocking mode,
because only the second is what any install actually gets.

**Version lives in exactly two modules**: `src/version.ts` and
`ui/src/lib/version.ts`, one per half. `npm run bump` rewrites both, and the panel
compares them at runtime and says so on screen when they disagree — the two
installs have separate update cycles and genuinely do drift.

- Pure logic shared by both builds → `shared/` (`passages.ts`, `diff.ts`, `lint.ts`)
- Pure logic for the server → `src/`, e.g. `src/tools/wording.ts`
- Pure logic for the panel → `ui/src/lib/`, which is pure **by rule** — keep the
  DOM out of it, and do not import the bridge module from there
- Anything touching a boundary is a thin wrapper around a pure unit. `DiffPane`
  reads the live selection off the DOM and hands rows to `passageFromRows`; the
  arithmetic is tested, the wrapper is three lines.

One module per tool under `src/tools/`. Adding a tool is a new file plus one line
in `src/tools/index.ts` — which stays the only place that says which side of the
model/app visibility line a tool falls on.

## Say a thing once, in `shared/`

Both halves render the same facts to two different readers, and the failure mode
is silent: the panel showing one account while the server acts on another is
invisible until the moment a commit is refused on a review that looked clean.

- What a proposal looks like right now → `shared/state.ts` (`composeState`).
  The server, the preview and the panel's live recompute all go through it.
- Why a path was refused → `shared/rejection.ts`. The model reads
  `explainRejection`; the panel reads the same text as a finding.
- What a commit did → `shared/receipt.ts`. Both routes that tell the model
  render from it.

If you find yourself writing a second copy of one of these, that is the bug.

## The gate is `npm run verify`

Typecheck, ESLint, Prettier, the comment policy, knip, then the tests. All of it
runs in CI; the type-aware and dead-code passes run on Linux only, because they
read the same tsconfigs everywhere and cannot disagree between platforms.

ESLint is type-aware, and that is the point rather than a style preference: the
one rule that has already earned its keep is `no-unsafe-member-access`, which is
what noticed that the commit gate's capability check had no type behind it at
all. Two more it holds: `no-misused-promises` on the paths that write to disk,
and `switch-exhaustiveness-check`, which catches a phase nobody handled.

`knip` fails on an export nothing outside its module uses. That matters here more
than usual — every exported symbol is one the comment policy has to document for
a caller that does not exist.

**Node 22 or newer.** `.nvmrc` and `engine-strict=true` in `.npmrc` enforce it;
jsdom, undici and whatwg-url all require it, and an older Node runs the panel
suite on an unsupported runtime that works right up until it does not.

## Which host gets you what

`list_roots` answers this at runtime; do not guess.

| Surface                             | Panel renders | Can commit    |
| ----------------------------------- | ------------- | ------------- |
| Claude Desktop (chat)               | yes           | yes           |
| VS Code (Copilot)                   | yes           | yes           |
| Claude Code — terminal or code pane | no            | no, by design |

Claude Code does not declare MCP Apps support, in the terminal _or_ in Claude
Desktop's code pane. Installing the plugin there gets you the tools and no
editor, and commits are refused. To actually use the editor in Claude Desktop,
install the `.mcpb` extension — that is the copy the chat surface loads. The
Claude Code plugin and the `.mcpb` are separate installs with separate update
cycles; running both means two servers.
