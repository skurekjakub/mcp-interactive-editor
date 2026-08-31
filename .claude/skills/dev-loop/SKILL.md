---
name: dev-loop
description: Use when iterating on this editor — seeing a change actually render, without packing a .mcpb and reinstalling it into a host. Covers the three loops (preview, inspector, installed host), which one answers which question, and the traps in each.
---

# Seeing a change work

Three loops, cheapest first. Reach for the cheapest one that can answer the
question you actually have.

## 1. Panel only — `npm run preview`

```bash
npm run preview          # http://localhost:5178
```

Vite with HMR against a fixture proposal. No MCP host, no server, no file at
risk: `isPreview()` is true whenever nothing frames the View, and
`previewBridge()` answers tool calls in memory with the same lint and diff
modules the server uses.

Answers layout, styling, findings, the diff, keyboard behaviour. **Cannot**
answer anything about the host bridge — claiming, attaching, refusals, commits.

## 2. The whole protocol — HTTP plus the MCP Inspector

The inspector renders MCP Apps (it bundles `@modelcontextprotocol/ext-apps`), so
this is the panel running inside a real host, with the real claim and attach
round trips.

Two terminals:

```bash
npm run dev:http         # server on http://127.0.0.1:3001/mcp, root = cwd
```

```bash
npm run dev:inspect      # inspector on http://127.0.0.1:6274
```

Then: toggle **interactive-editor** to Connected → **Apps** tab → pick a tool →
fill the arguments → **Open App**.

`mcp.json` in the repo root is what points the inspector at the server. The
inspector's own catalog lives at `~/.mcp-inspector/mcp.json`; `--config` makes
the session read-only, which is why the UI says so and why edits there are not
saved.

A browser cannot spawn a process, which is the entire reason `--http` exists.
Stdio remains the default because that is what an installed host spawns.

**Iterating:** rebuild and reconnect. Nothing is installed, so there is no cache
and no version bump in the way.

### Checking the app metadata alone

Faster than the UI when the question is "does the host see a panel at all":

```bash
node node_modules/@modelcontextprotocol/inspector/clients/cli/build/index.js \
  --transport http --server-url http://127.0.0.1:3001/mcp \
  --method tools/call --tool-name propose_write \
  --tool-arg path=x.md --tool-arg content=hi --app-info
```

`{"hasApp":true,...,"resourceUri":"ui://interactive-editor/panel.html"}` is the
answer you want. It exits 2 when the tool has no app. The CLI trips a libuv
assertion on exit under Windows — that is the inspector's teardown, not ours,
and the JSON is already out by then.

## 3. The real thing — an installed host

Only when the question is specifically about Claude Desktop or Claude Code:
`.mcpb` packaging, the plugin cache, `user_config`, the client's own approval
prompt. Everything else is answered more cheaply above.

Cut a release and install the artifact — see the `cut-release` skill.

## Traps

**A port already held.** The server says so in a sentence; the inspector does
not. Clear it rather than guessing:

```bash
netstat -ano | grep ":3001" | grep LISTENING
```

Leftover servers from an earlier run are the usual cause, and a probe against a
stale one is deeply confusing — it answers correctly, from the wrong build.
Check `serverInfo.version` when anything looks impossible.

**A panel outliving its server.** Installing or updating the extension restarts
the server, and any panel already on screen holds an id the new process never
issued. The refusal says so. It is not a bug to chase — reopen the proposal.

**The inspector's Add-server form.** Setting Transport by clicking or scripting
the control does not always reach React state: the label changes and the fields
stay on stdio. Use `mcp.json` and `--config` instead of the form.

**`npx` on Windows.** Invoking the inspector through `npx` mangles arguments and
can leave its clients unbuilt. It is a devDependency for that reason; call the
binary or the script path directly.
