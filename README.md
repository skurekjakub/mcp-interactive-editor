<div align="center">

```
  ███████╗██████╗ ██╗████████╗ ██████╗ ██████╗
  ██╔════╝██╔══██╗██║╚══██╔══╝██╔═══██╗██╔══██╗
  █████╗  ██║  ██║██║   ██║   ██║   ██║██████╔╝
  ██╔══╝  ██║  ██║██║   ██║   ██║   ██║██╔══██╗
  ███████╗██████╔╝██║   ██║   ╚██████╔╝██║  ██║
  ╚══════╝╚═════╝ ╚═╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝
```

### An interactive editor in front of every file write

**mcp-interactive-editor** · the model proposes, you edit the proposal by hand, and nothing reaches disk until you say so

MCP App · live diff against disk · per-line comments · human-in-the-loop · local-only

[![ci](https://github.com/skurekjakub/mcp-interactive-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/skurekjakub/mcp-interactive-editor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP App](https://img.shields.io/badge/MCP-App-6E56CF)](https://apps.extensions.modelcontextprotocol.io/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.10-3C873A)](.nvmrc)

[Install](#install) · [How it works](#how-it-works) · [Host support](#host-support-honestly) · [Guarantees](#why-the-model-cannot-approve-its-own-write) · [Options](#options) · [Development](#development)

</div>

---

Claude proposes a write. An editor opens with the proposed content on the left
and a live diff against what is actually on disk on the right. You edit the
proposal by hand — it is your text now — and nothing touches the filesystem
until you press the button.

The point is not the confirmation prompt. The point is the **editing**. When a
generated file is 95% right, fixing the last 5% by typing takes a second and
changes nothing else. Asking for it in prose costs a round trip and usually
rewrites two other things you liked.

```
┌─────────────────────────────────────────────────────────────────────┐
│▐ HELD   .github/workflows/deploy.yml · overwrite            +1  −25 │
│         Collapse the three jobs into one.                           │
├─────────────────────────────────────────────────────────────────────┤
│ BLOCKS  This removes 25 of 39 lines (64%).                          │
│ NOTE    No trailing newline.                            [ Add one ] │
├──────────────────────────────┬──────────────────────────────────────┤
│ PROPOSED — EDIT FREELY       │ AGAINST DISK                         │
│  1  # Deploy pipeline        │  7 - workflow_dispatch:              │
│  2  name: deploy             │ 10 - test:                           │
│  3                           │  9 + deploy:                         │
├──────────────────────────────┴──────────────────────────────────────┤
│ LINES 4–9 · 6 lines   what is this job for? ▸  [ Send to Claude ]   │
├─────────────────────────────────────────────────────────────────────┤
│ ☑ I have read the diff and I mean to remove those lines.            │
│                          [ Discard ]  [▨ Write 15 lines to deploy ] │
└─────────────────────────────────────────────────────────────────────┘
```

## What you get

|                                  |                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Editable proposals**           | The draft is a textarea, not a preview. Fix it in place and commit what you fixed.                                            |
| **Live diff against disk**       | Recomputed on every keystroke, by the same module the server checks with before writing.                                      |
| **Per-line comments**            | Highlight a region, attach a question to it. Comments decline the draft and send the agent back to redraft.                   |
| **A gate the agent cannot open** | The tool that writes is not in the model's tool list, and the server refuses to commit for a host that renders nothing.       |
| **Checks before the button**     | Destructive-deletion ratio, stale-file detection, line endings, trailing whitespace, indentation — each with a one-click fix. |
| **Local only**                   | The panel is one inlined HTML file served into a sandbox with every CSP domain list empty. No CDN, no fonts, no network.      |

---

## How it works

The editor is **not** something you interact with "inside a tool call". That
confusion is worth clearing up, because the whole design follows from it.

```
  YOU                CLAUDE                 HOST              MCP SERVER
   │                    │                     │                     │
   │─ "write ci.yml" ──▶│                     │                     │
   │                    │─ propose_write ────▶│──────────────────  ▶│
   │                    │◀──── diff + ui:// ──│◀──── result ────────│
   │                    │                     │                     │
   │              [Claude's turn ENDS here — the tool call is over]  │
   │                    │                     │                     │
   │                    │           renders ui:// in an iframe       │
   │◀═══════ the editor, a live web page in the transcript ════════▶│
   │                    │                     │                     │
   │─ type, edit, fix ─────────────────────── │ ─ editor_update ───▶│
   │─ press the button ────────────────────── │ ─ editor_commit ───▶│ writes
   │                    │                     │                     │
   │                    │◀─ updateModelContext ─ "here's what landed"│
```

Three things fall out of that:

1. **The tool call returns immediately.** It returns text for Claude plus a
   pointer to a `ui://` resource. Claude's turn ends. Nothing is blocked or
   waiting. (`--block-on-review` changes this — see [Options](#options).)

2. **The editor is a second, independent MCP client.** It talks to the _same_
   server over postMessage, proxied by the host. When you type and it saves,
   that is the page calling the server — Claude is not in the loop, not
   consuming tokens, not aware. You can sit in that editor for ten minutes.

3. **Two clients, two different tool lists.** That is what makes
   `visibility: ["app"]` mean something. The agent and the editor are separate
   callers, so the server can hand them different capabilities. The agent gets
   tools that open an editor. The editor gets the tool that writes.

You rejoin the conversation only when you choose to: by pressing the button
(which reports back what landed), by discarding, or by selecting a passage and
sending it to the chat.

---

## Install

### Claude Desktop — one click

Grab `mcp-interactive-editor.mcpb` from
[Releases](https://github.com/skurekjakub/mcp-interactive-editor/releases) and
double-click it, or drag it onto Claude Desktop's Extensions screen. It will ask
you to pick the folders it is allowed to write in.

Build it yourself with:

```bash
npm install && npm run pack
```

<details>
<summary>Or configure it by hand</summary>

**Settings → Developer → Edit Config**, which opens
`%APPDATA%\Claude\claude_desktop_config.json` on Windows or
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS:

```json
{
  "mcpServers": {
    "interactive-editor": {
      "command": "node",
      "args": [
        "C:\\path\\to\\mcp-interactive-editor\\bundle\\server\\index.js",
        "--root",
        "C:\\path\\to\\your-project"
      ]
    }
  }
}
```

Backslashes doubled — it is JSON. Then quit Claude Desktop completely and
reopen; closing the window is not quitting.

</details>

### VS Code (GitHub Copilot)

Clone it anywhere. `bundle/` is committed, so there is nothing to install or
build:

```bash
git clone https://github.com/skurekjakub/mcp-interactive-editor.git
```

Then add `.vscode/mcp.json` to your workspace, pointing at the clone:

```json
{
  "servers": {
    "interactive-editor": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-interactive-editor/bundle/server/index.js",
        "--root",
        "${workspaceFolder}"
      ]
    }
  }
}
```

`${workspaceFolder}` is expanded by VS Code, so the root follows whatever project
you have open. The path to the clone has to be absolute.

This repository ships its own `.vscode/mcp.json` for dogfooding: open **this**
clone in VS Code and the editor guards this project, running the `bundle/` that
is already in the workspace — no absolute path needed.

### Claude Code — plugin marketplace

```bash
/plugin marketplace add skurekjakub/mcp-interactive-editor
```

```bash
/plugin install interactive-editor@interactive-editor
```

The plugin roots the editor at your current project directory. **Read the host
support note below before you rely on it** — Claude Code cannot render the
editor.

---

## Host support, honestly

MCP Apps need a rendering surface, and this is the part where a table is easy to
write and hard to keep true. Ask the running server instead: `list_roots`
reports its version, the writable roots, and whether the connected host declared
that it renders MCP Apps at all.

| Host                                 | Renders the editor | Committing    |
| ------------------------------------ | ------------------ | ------------- |
| Claude Desktop                       | ✅                 | ✅            |
| VS Code (Copilot)                    | ✅                 | ✅            |
| **Claude Code / any terminal agent** | ❌                 | ❌ by default |

Other MCP clients vary with their MCP Apps support; `list_roots` is the answer
for the client in front of you.

In a terminal host, `propose_write` still works and still returns the diff as
text, so the agent sees what it proposed, and **nothing can be committed** — but
not for the reason it would be comfortable to assume.

`visibility: ["app"]` is a request to the host, not a guarantee. A host with no
MCP Apps support hands the agent every tool, `editor_attach` among them, so the
agent can mark its own proposal as attached and `attached` alone secures
nothing. What an agent cannot author is the capabilities its own client
declared at initialize, so that is what the commit path asks: if the host never
advertised that it renders `text/html;profile=mcp-app`, no panel ever appeared,
nobody saw the diff, and the write is refused. It degrades to a hard stop, not
an open gate — and there is an end-to-end test that walks the whole attack
(propose, self-attach, commit) to prove it.

If you want the server usable in a terminal anyway, `--terminal-approval`
exposes the commit tool to the agent and leans on your client's own approve/deny
prompt instead. It is a real gate and a much weaker one: your client prompts for
a tool call rather than showing you a diff, and it evaporates entirely if you
allowlist the tool. The plugin does not turn it on for you.

---

## Using it

Talk normally. This is a tool, not a mode.

**Propose a write** — the model writes, you correct it:

> Write a GitHub Actions workflow that runs the tests on push to main, at
> `.github/workflows/ci.yml`

**Open a file** — you edit it yourself, the model stays out of it:

> Open `src/config.ts` so I can fix it

`open_file` loads the file into the editor and deliberately does **not** put the
body in the model's result. It goes to the editor, not into the context window.
The commit button stays dead until you actually change something.

**Comment on a passage** — highlight lines in either pane and a box opens beside
the selection. Every highlight carries its own comment, and the tray at the
bottom will not send until each one has been answered. Sending **declines the
draft**: nothing is written, and the agent is handed your words to redraft from.

> From the draft open in the interactive editor — `deploy.yml`:
>
> lines 4–9:
>
> ```
> jobs:
>   deploy:
>     runs-on: ubuntu-latest
> ```
>
> > why is this not pinned to a SHA?

**After you edit**, the model is told what actually landed rather than what it
proposed — otherwise the rest of the conversation is built on a file that does
not exist.

### Making Claude reach for it

The server sends usage instructions at connect time and every tool description
says it never writes. Usually enough. If Claude has other filesystem tools and
picks the wrong one, add to your **Project instructions**:

```
All file writes go through interactive-editor's propose_write. Never use another
filesystem tool to write, create, or delete files. After proposing, stop and
wait — do not re-propose the same write.
```

---

## Why the model cannot approve its own write

| Tool                     | Callable by     | What it does                      |
| ------------------------ | --------------- | --------------------------------- |
| `propose_write`          | model, editor   | Opens an editor. Writes nothing.  |
| `propose_delete`         | model, editor   | Opens an editor. Deletes nothing. |
| `open_file`              | model, editor   | Loads a file into the editor.     |
| `read_file`              | model, editor   | Reads inside the roots.           |
| `list_roots`             | model, editor   | Roots, version, host capability.  |
| `editor_attach`          | **editor only** | Binds the editor to a proposal.   |
| `editor_update`          | **editor only** | Saves your edits.                 |
| `editor_commit`          | **editor only** | **Writes to disk.**               |
| `editor_discard`         | **editor only** | Drops the proposal.               |
| `editor_request_changes` | **editor only** | Sends your comments, declines it. |
| `editor_pending`         | **editor only** | Claims the proposal on mount.     |

Editor-only tools carry `_meta.ui.visibility: ["app"]`. Under the
[MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps) a host **MUST
NOT** put them in the agent's tool list. That is the whole of what the spec
requires, and it is worth being precise about: a host with no MCP Apps support
hands them over regardless, which is exactly why the commit path also checks the
capability the client declared at initialize — the one input an agent cannot
author for itself.

Belt and braces, the server also refuses to commit a proposal that no editor
ever attached to.

### The rest of the guarantees

- **Roots are absolute.** A path is writable only if, after full resolution
  including symlinks, it sits inside a `--root`. A symlink planted inside a root
  pointing outside it does not work.
- **A deny list on top**: `.git/`, `node_modules/`, `.env`, `.ssh/`, `id_rsa`,
  `.pem`, `.key`, `.p12`, `.pfx`, `credentials`, `.aws/`, `.npmrc`. Patterns are
  anchored to whole filenames and extensions, so `shortcuts.keymap.ts` is not
  caught by `.key`. A refusal names the pattern that matched.
- **The proposal's target is immutable.** Nothing can re-point a proposal at
  another file after the diff was shown, so the file you reviewed is the file
  that gets written.
- **Stale writes are refused.** If the file changes on disk while the editor is
  open, the commit fails and the proposal is closed: the diff you approved is
  not the diff that would apply, and a second press must not walk through it.
- **Deleting most of a file needs a tick** — over half the lines, or emptying it,
  or deleting it. Small files are exempt; a checkbox in front of every one-line
  edit trains you to tick without reading.
- **Writes are atomic and keep their permissions** — temp file, `chmod` to match
  the file being replaced, then rename. A crash leaves the original intact
  rather than half a file, and a `0755` script does not come back `0644`.
- **Everything is rechecked server-side** at commit. The editor's checks are for
  your eyes; the server's are the ones with authority.

---

## Options

There is no installed binary — this is not published to npm. The server is a
script, launched by whatever config points your host at it:

```
node bundle/server/index.js --root <dir> [--root <dir> ...] [options]

  --root <dir>                 A directory the editor may write inside. Required, repeatable.
  --root-from-cwd              Add the working directory as a root.
  --deny <pattern>             Extra filename or extension to refuse. Repeatable.
  --allow-everything-in-roots  Drop the built-in deny list.
  --dry-run                    Run the whole flow but never touch disk.
  --terminal-approval          Expose the commit tool to the agent, for hosts with no UI.
  --block-on-review            Hold the opening call open until the human decides.
  --review-timeout-ms <ms>     How long that call waits for a human. Default 600000.
  --review-grace-ms <ms>       How long to wait for the panel to attach. Default 30000.
```

`INTERACTIVE_EDITOR_DRY_RUN=true` does the same as `--dry-run`, for launchers
that cannot add a flag conditionally. `--dry-run` is the honest way to try this
on a real project: everything works, the receipt says what would have happened,
nothing changes.

<details>
<summary><b>--block-on-review</b>, and why it is off</summary>

With the flag, `propose_write` does not return until you accept or comment, so
the agent learns the verdict in the result of the call it already made rather
than in a later message.

It is off by default because it requires the host to keep dispatching tool calls
while one is still outstanding: the panel has to claim its proposal and attach
**during** the call that created it. Not every host does, and where one does not
the panel never loads and the editor is unusable. A non-blocking editor is a
smaller thing than a blocking one and it works everywhere.

Turn it on where your host allows it. The tool descriptions the model sees are
generated from this setting, so they never promise a wait that will not happen.

</details>

---

## Development

```bash
npm install
npm run preview        # the editor at localhost:5178, fixture data, no host needed
npm test               # unit, panel and end-to-end over a real stdio server
npm run verify         # typecheck + format + comment policy + tests, same as CI
npm run lint:comments  # docs/comment-policy.md, enforced
npm run pack           # build the .mcpb extension
npm run bump -- 1.2.3  # move every declared version at once
```

`npm run preview` serves the editor in a plain browser tab with an in-memory
server, running the same diff and lint modules as the real thing. No host, no
risk to any file.

### Layout

```
shared/          types, line diff, lint rules, passages — imported by BOTH the
                 server and the editor, so what you see is computed the way the
                 server checks it
src/             fsGuard (roots, deny list, atomic write), proposals, review,
                 and one module per tool under src/tools/
ui/              the editor: React, built to one self-contained HTML file
bundle/          committed distribution artifact — esbuild'd server + the editor.
                 Claude Code installs plugins by git clone with no build step.
test/unit/       shared modules, the filesystem guard, the release manifests
test/panel/      the React panel in jsdom
test/e2e/        a real server over stdio, driven by an MCP client, run twice:
                 against dist/ and against a copy of bundle/ outside the repo
docs/            the comment policy the build enforces
scripts/         bundle, version bump, comment-policy checker
.claude-plugin/  Claude Code plugin marketplace manifests
server.json      MCP registry metadata
```

`shared/` exists so the editor can recompute the diff and findings on every
keystroke without a round trip, while the server recomputes the identical thing
before committing. Same code, two audiences, one of them authoritative.

The editor ships as a single inlined HTML file because the host serves it into a
sandbox with `connectDomains`, `resourceDomains` and `frameDomains` all empty. No
CDN, no fonts, no network. An editor that can phone home would be a worse problem
than the writes it is guarding.

### House rules

Comments follow [`docs/comment-policy.md`](docs/comment-policy.md): a docblock on
every top-level declaration, inline comments only at gotchas, and no narration —
no incident retellings, no version numbers attached to behaviour, no counts.
`npm run lint:comments` walks the AST and fails the build on a violation, so the
policy stays true rather than aspirational.

### Publishing

`bundle/` is committed and CI fails if it drifts from `src/`, because Claude Code
plugin users install straight from the repo tree. Run `npm run bundle` and commit
the result with any change to the server or editor.

The declared version is load-bearing: Claude Code caches an installed plugin
under it and rebuilds only when it changes, so a change shipped without a bump
reaches nobody. `npm run bump -- <version>` moves every declaration at once,
`test/unit/release.test.ts` fails if they ever disagree, and CI fails a pull
request that touches `src/`, `shared/` or `ui/` without moving the version.

---

## License

[MIT](LICENSE)
