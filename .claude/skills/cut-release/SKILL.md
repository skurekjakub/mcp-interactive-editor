---
name: cut-release
description: Use when releasing a new version of mcp-interactive-editor — bumping the version, writing the changelog entry, rebuilding the committed bundle and committing. Covers why the version is load-bearing and what must not be hand-edited.
---

# Cut a release

The version is not decoration. Claude Code materialises an installed plugin into
`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` and rebuilds that
directory only when the declared version changes. Ship a change without a bump
and every existing install keeps running the tree it first installed — a bug
indistinguishable from "the restart did not work".

## Order

1. **Finish the work and get `npm run verify` green.** Typecheck, ESLint,
   Prettier, comment policy, knip, tests. Do not bump a red tree.

2. **`npm run bump -- <major.minor.patch>`.** Never hand-edit a version. The
   script rewrites every declaration together and refuses to run if they already
   disagree; `test/unit/release.test.ts` fails the build on drift. There are six
   declaration sites plus the marketplace entry, and the list lives in
   `scripts/versions.mjs` — add a site there, not in the bump script.

3. **Write the `CHANGELOG.md` section.** Newest first, under `## [Unreleased]`.
   Add the compare link at the foot of the file — it is easy to forget, and 0.6.0
   shipped without one.

4. **`npm run verify` again**, then **`npm run bundle`**. `bundle/` is checked in
   and CI fails if it drifts from the sources, so it must be rebuilt after the
   bump — the version is baked into it.

5. **Commit.** `git status` should show `bundle/` changed alongside the sources.

6. **`npm run pack`** if a `.mcpb` is wanted. Packing is not reproducible (zip
   mtimes), so `server.json`'s `fileSha256` cannot be re-derived locally — take
   it from the single producing CI run.

## What the changelog entry is for

Someone deciding whether to upgrade, and someone debugging after they did. So:

- Lead with what could lose their work.
- State the symptom they would have seen, not the internal cause. "A CRLF file
  rewritten to LF showed an empty diff and no findings" — not "splitLines
  normalises terminators".
- No agent names, no audit process, no counts of how many things were found.
  `docs/comment-policy.md` bans that in comments and it reads no better here.

## `server.json`

Not touched by the bump script. It describes a published `.mcpb` with a checksum,
so it moves only when the release is actually cut: version, identifier URL, and
`fileSha256` from the artifact that was uploaded.
