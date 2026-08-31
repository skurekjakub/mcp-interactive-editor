# Contributing

## Getting set up

```bash
npm install
npm run build
npm test
```

Node 20.10 or newer (`.nvmrc` pins it).

## Working on the editor

```bash
npm run preview
```

Serves the editor at `http://localhost:5178` with fixture data and an in-memory
server that runs the same diff and lint modules as the real one. No MCP host
needed and no file is ever at risk. Preview mode triggers on `window.parent ===
window` — inside a real host the editor is always framed.

## Working on the server

```bash
npm run build && npm start -- --root ./scratch --dry-run
```

`--dry-run` runs the whole flow and never touches disk.

## Before you push

```bash
npm run verify
```

That is typecheck, format check, and the full suite — the same three things CI
runs. If you changed anything in `src/` or `ui/`, also run:

```bash
npm run bundle
```

and commit the result. `bundle/` is a checked-in distribution artifact because
Claude Code installs plugins by cloning the repo with no build step, and CI fails
if it drifts.

## What a change needs

**A test.** The unit tests in `test/unit` cover `shared/` and the filesystem
guard directly. The end-to-end tests in `test/e2e` drive a real compiled server
over stdio with an MCP client — that is where anything about who can call what
belongs, because it is the only place the actual tool surface is visible.

**A reason it cannot escape.** This project's entire value is that the model
cannot write a file on its own. Any change that adds a tool, widens
`_meta.ui.visibility`, or touches `FsGuard` needs a test proving the guard still
holds. If you are adding a way to bypass the review, it has to be an explicit
opt-in flag, off by default, and documented as weaker — the way
`--terminal-approval` is.

**A note in `CHANGELOG.md`** under `[Unreleased]`.

## Style

Prettier decides formatting; `npm run format` applies it. Beyond that: comments
explain _why_, not _what_. The codebase leans on a small number of load-bearing
comments at the places where the reasoning is not visible in the code — the
visibility split in `src/tools.ts`, the blur behaviour in the editor's selection
handling, the prefix/suffix trim in `shared/diff.ts`. Keep that density; do not
narrate the obvious.
