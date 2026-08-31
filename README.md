# mcp-interactive-editor

[![ci](https://github.com/skurekjakub/mcp-interactive-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/skurekjakub/mcp-interactive-editor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![MCP App](https://img.shields.io/badge/MCP-App-6E56CF)](https://apps.extensions.modelcontextprotocol.io/)

**An interactive editor in front of every file write.**

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

---

## How this actually works

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
   waiting.

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

MCP Apps need a rendering surface. This is the actual state of play:

| Host                                 | Renders | Editing | Committing    |
| ------------------------------------ | ------- | ------- | ------------- |
| Claude Desktop                       | ✅      | ✅      | ✅            |
| Claude web                           | ✅      | ✅      | ✅            |
| VS Code (Copilot)                    | ✅      | ✅      | ✅            |
| Cursor                               | ✅      | ✅      | ✅            |
| **Claude Code / any terminal agent** | ❌      | ❌      | ❌ by default |

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
prompt instead. It is a real gate, but a much weaker one: you get a yes/no on a
diff, not an editor, and it evaporates entirely if you allowlist the tool. The
plugin does not turn it on for you.

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

**Send a passage back to the chat** — select lines in the editor, a bar appears
below, type a question, press Send. It arrives in the conversation as if you had
typed it, quoted with the path and line numbers:

> From the draft open in the interactive editor — `deploy.yml`, lines 4–9:
>
> ```
> jobs:
>   deploy:
>     runs-on: ubuntu-latest
> ```
>
> why is this not pinned to a SHA?

That is `ui/message`, so it starts a normal turn and the answer arrives in the
chat next to the editor.

**After you edit**, the model is told what actually landed rather than what it
proposed — otherwise the rest of the conversation is built on a file that does
not exist.

### Making Claude reach for it

The server sends usage instructions at connect time and every tool description
says "this never writes". Usually enough. If Claude has other filesystem tools
and picks the wrong one, add to your **Project instructions**:

```
All file writes go through interactive-editor's propose_write. Never use another
filesystem tool to write, create, or delete files. After proposing, stop and
wait — do not re-propose the same write.
```

---

## Why the model cannot approve its own write

| Tool             | Callable by     | What it does                      |
| ---------------- | --------------- | --------------------------------- |
| `propose_write`  | model, editor   | Opens an editor. Writes nothing.  |
| `propose_delete` | model, editor   | Opens an editor. Deletes nothing. |
| `open_file`      | model, editor   | Loads a file into the editor.     |
| `read_file`      | model, editor   | Reads inside the roots.           |
| `list_roots`     | model, editor   | Lists the roots.                  |
| `editor_attach`  | **editor only** | Binds the editor to a proposal.   |
| `editor_update`  | **editor only** | Saves your edits.                 |
| `editor_commit`  | **editor only** | **Writes to disk.**               |
| `editor_discard` | **editor only** | Drops the proposal.               |

Editor-only tools carry `_meta.ui.visibility: ["app"]`. Under the
[MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps) the host
**must** keep those out of the model's tool list and **must** reject any call the
model makes for them. Claude cannot commit a write — not "is asked not to"; the
tool is not in its list, and the host refuses it if it guesses the name.

Belt and braces, the server also refuses to commit a proposal that no editor
ever attached to. A host that ignored `visibility` entirely still could not get a
write through without a rendered editor.

### The rest of the guarantees

- **Roots are absolute.** A path is writable only if, after full resolution
  including symlinks, it sits inside a `--root`. A symlink planted inside a root
  pointing outside it does not work.
- **A deny list on top**: `.git/`, `node_modules/`, `.env`, `.ssh/`, `id_rsa`,
  `.pem`, `.key`, `credentials`, `.aws/`, `.npmrc`.
- **Stale writes are refused.** If the file changes on disk while the editor is
  open, the commit fails: the diff you approved is not the diff that would apply.
- **Deleting most of a file needs a tick** — over half the lines, or emptying it,
  or deleting it. Small files are exempt; a checkbox in front of every one-line
  edit trains you to tick without reading.
- **Writes are atomic** — temp file plus rename, so a crash leaves the original
  intact rather than half a file.
- **Everything is rechecked server-side** at commit. The editor's checks are for
  your eyes; the server's are the ones with authority.

---

## Options

```
mcp-interactive-editor --root <dir> [--root <dir> ...] [options]

  --root <dir>                 A directory the editor may write inside. Required, repeatable.
  --root-from-cwd              Add the working directory as a root.
  --deny <substring>           Extra path substring to refuse. Repeatable.
  --allow-everything-in-roots  Drop the built-in deny list.
  --dry-run                    Run the whole flow but never touch disk.
  --terminal-approval          Expose the commit tool to the agent, for hosts with no UI.
```

`INTERACTIVE_EDITOR_DRY_RUN=true` does the same as `--dry-run`, for launchers
that cannot add a flag conditionally. `--dry-run` is the honest way to try this
on a real project: everything works, the receipt says what would have happened,
nothing changes.

---

## Development

```bash
npm install
npm run preview     # the editor at localhost:5178, fixture data, no host needed
npm test            # 85 tests, unit + end-to-end over a real stdio server
npm run verify      # typecheck + format + test, same as CI
npm run pack        # build the .mcpb bundle
```

`npm run preview` serves the editor in a plain browser tab with an in-memory
server, running the same diff and lint modules as the real thing. No host, no
risk to any file.

### Layout

```
shared/          types, line diff, lint rules — imported by BOTH the server and
                 the editor, so what you see is computed the way the server checks it
src/             fsGuard (roots, deny list, atomic write), proposals, tools, server
ui/              the editor: React, built to one self-contained HTML file
bundle/          committed distribution artifact — esbuild'd server + the editor.
                 Claude Code installs plugins by git clone with no build step.
test/unit/       shared modules and the filesystem guard
test/e2e/        a real server over stdio, driven by an MCP client
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

### Publishing

`bundle/` is committed and CI fails if it drifts from `src/`, because Claude Code
plugin users install straight from the repo tree. Run `npm run bundle` and commit
the result with any change to the server or editor.

---

## License

[MIT](LICENSE)
