# Working on this repository

Read `CONTRIBUTING.md` for setup, the test layout, and what a change needs. This
file is the operational stuff that is easy to get wrong and expensive to debug.

## Ship a version bump with every change, or nobody gets the change

**The declared version is a cache key, not decoration.**

Claude Code materialises an installed plugin into a version-stamped directory:

```
~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
```

That directory is rebuilt **only when the declared version changes**.
`claude plugin marketplace update` refreshes the marketplace _clone_ and does not
touch it. So if you merge to `main` without bumping, every existing install keeps
running the tree it first installed — and the symptom is maddening, because
`git log` on both the repo and the plugin clone show your commit while the
running server behaves like the old one.

This has already happened once. Two commits shipped, `main` had them, the clone
had them, and the live server had only the first, because both left the version
at `0.1.0`.

Bump with:

```bash
npm run bump -- 0.3.0
```

That touches every place the version is load-bearing: `package.json`,
`package-lock.json`, `.claude-plugin/plugin.json` (the cache key),
`.claude-plugin/marketplace.json`, and the two literals where the running code
names itself over the wire. Then write the `CHANGELOG.md` section, and:

```bash
npm run verify && npm run bundle
```

`server.json` is deliberately **not** bumped. It describes a published `.mcpb`
with a `fileSha256`, so it should lag until that release actually exists —
pointing it at a tag that was never cut makes the registry manifest wrong rather
than merely stale.

To pick a new version up locally: `claude plugin update interactive-editor`, then
restart the host. Confirm you are on the new code by calling `list_roots`, which
reports the version's behaviour rather than its number.

## `bundle/` is checked in and CI fails if it drifts

Claude Code installs plugins by cloning with no build step, so `bundle/` is the
artifact that actually runs. Changed anything in `src/` or `ui/`? Run
`npm run bundle` and commit the result.

## Two invariants that are the whole point of the project

**Never put a file body in `structuredContent`.** It has two readers: the panel
paints from it, and the host hands the same object to the model. Returning the
whole `EditorState` from an opening tool charged the model for the file three
times over (`content`, `originalContent`, `baseline`) — 78,858 characters for a
21 KB file, enough to blow a tool-result limit. Opening tools return a
`ProposalHandle`; the panel redeems it via the `editor_attach` it already calls
on mount. `editor_attach` is the one place the whole file legitimately crosses.

**`attached` is not a security boundary.** `visibility: ["app"]` is a request to
the host, not a guarantee. A host without MCP Apps support hands the agent every
tool, `editor_attach` included, so an agent can mark its own proposal reviewed.
The load-bearing check in `commit()` is the host capability: if the client never
declared `text/html;profile=mcp-app` at initialize, no panel rendered, nobody saw
the diff, and the write is refused. `--terminal-approval` is the documented,
weaker opt-out. There are end-to-end tests that walk the whole attack — propose,
self-attach, commit — and assert the refusal. Do not weaken them.

## Where code goes, so it can be tested

`tsconfig.test.json` covers `shared/`, `src/`, and `ui/src/lib/`. It does **not**
cover React or anything DOM-touching.

- Pure logic shared by both builds → `shared/` (`passages.ts`, `diff.ts`, `lint.ts`)
- Pure logic for the server → `src/`, e.g. `src/tools/results.ts`
- Pure logic for the panel → `ui/src/lib/`, which is pure **by rule** — keep the
  DOM out of it
- Anything touching a boundary is a thin wrapper around a pure unit. `DiffPane`
  reads the live selection off the DOM and hands rows to `passageFromRows`; the
  arithmetic is tested, the wrapper is three lines.

One module per tool under `src/tools/`. Adding a tool is a new file plus one line
in `src/tools/index.ts` — which stays the only place that says which side of the
model/app visibility line a tool falls on.

## Which host gets you what

`list_roots` answers this at runtime; do not guess.

| Surface                             | Panel renders | Can commit    |
| ----------------------------------- | ------------- | ------------- |
| Claude Desktop (chat), Claude web   | yes           | yes           |
| VS Code (Copilot), Cursor           | yes           | yes           |
| Claude Code — terminal or code pane | no            | no, by design |

Claude Code does not declare MCP Apps support, in the terminal _or_ in Claude
Desktop's code pane. Installing the plugin there gets you the tools and no
editor, and commits are refused. To actually use the editor in Claude Desktop,
install the `.mcpb` extension — that is the copy the chat surface loads. The
Claude Code plugin and the `.mcpb` are separate installs with separate update
cycles; running both means two servers.
