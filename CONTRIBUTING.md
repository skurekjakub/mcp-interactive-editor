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
needed and no file is ever at risk. Preview mode triggers when nothing frames the
page — inside a real host the editor is always in an iframe.

## Working on the server

```bash
npm run build && npm start -- --root ./scratch --dry-run
```

`--dry-run` runs the whole flow and never touches disk.

## Before you push

```bash
npm run verify
```

That is typecheck, format check, the comment-policy check and the full suite —
the same things CI runs. If you changed anything in `src/`, `shared/` or `ui/`,
also do both of these:

```bash
npm run bump -- <version>
npm run bundle
```

and commit the results.

`bundle/` is a checked-in distribution artifact because Claude Code installs
plugins by cloning the repo with no build step, and CI fails if it drifts.

The bump is not optional and not cosmetic. Claude Code caches an installed plugin
under its declared version and rebuilds only when that number changes, so a
change shipped without a bump reaches nobody while every log says it landed. CI
fails a pull request that touches those directories without moving the version.
`AGENTS.md` has the full explanation.

## What a change needs

**A test.** `test/unit` covers `shared/`, the filesystem guard and the release
manifests directly. `test/panel` renders the React panel in jsdom, which is the
only way to reach `ui/`. `test/e2e` drives a real compiled server over stdio with
an MCP client — that is where anything about who can call what belongs, because
it is the only place the actual tool surface is visible.

**A reason it cannot escape.** This project's entire value is that the model
cannot write a file on its own. Any change that adds a tool, widens
`_meta.ui.visibility`, or touches `FsGuard` needs a test proving the guard still
holds. If you are adding a way to bypass the review, it has to be an explicit
opt-in flag, off by default, and documented as weaker — the way
`--terminal-approval` is.

**A note in `CHANGELOG.md`** under `[Unreleased]`.

## Style

Prettier decides formatting; `npm run format` applies it.

Comments follow [`docs/comment-policy.md`](docs/comment-policy.md), and
`npm run lint:comments` enforces it as part of `npm run verify`. Every top-level
declaration carries a docblock written for an unknown caller; inline comments
appear only where correct-looking code is wrong or wrong-looking code is right.
No narration, no incident retellings, no counts, no version numbers attached to
behaviour — that history lives in `git log` and `CHANGELOG.md`.
