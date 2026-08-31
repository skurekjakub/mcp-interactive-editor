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

3. **Write the `CHANGELOG.md` section.** Newest first, under `## [Unreleased]`,
   heading `## [x.y.z] - YYYY-MM-DD`. The release workflow lifts this section
   verbatim as the release notes and refuses to run without it, so the heading
   format is load-bearing. Add the compare link at the foot of the file.

4. **`npm run verify` again**, then **`npm run bundle`**. `bundle/` is checked in
   and CI fails if it drifts from the sources, so it must be rebuilt after the
   bump — the version is baked into it.

5. **Commit and push**, and wait for CI to be green on all three platforms.
   `git status` should show `bundle/` changed alongside the sources.

6. **`gh workflow run release.yml -f version=<x.y.z>`.** That is the whole
   release. Dispatch-only on purpose: releasing on a tag push makes the tag the
   decision, and a tag cannot be withdrawn once an install has resolved it. The
   workflow refuses a version the tree does not declare, one already tagged, and
   one the changelog does not describe — then verifies, packs, writes
   `server.json` from the artifact's hash, commits it, tags, and uploads.

7. **`git pull`**, because the workflow committed `server.json` to the branch.

## Nothing about the release may be committed after the tag

`server.json` names the artifact and its `fileSha256`, so it cannot be written
before the artifact exists — and if it is written _after_ the tag, the tagged
tree describes the **previous** release. Check out that tag and you get a
`server.json` pointing at the old download with the old checksum, permanently.

The workflow resolves it by doing everything in one run: pack, hash, write,
commit, _then_ tag. If you ever release by hand, keep that order. The rule
generalises — anything describing the release belongs in the commit the tag
lands on, not after it.

Packing is not reproducible (zip entries carry mtimes), so the hash must come
from the artifact that is actually uploaded. A second local `npm run pack`
produces a different file and therefore a checksum registry clients will reject.

## Cross-platform failures you will only see in CI

`npm run verify` passing locally is not the gate. Both CI platforms rewrite temp
paths in ways a dev machine usually does not:

- **macOS** resolves `/var/folders/...` into `/private/var/folders/...`.
- **The Windows runner** hands out 8.3 short paths — `RUNNER~1` for
  `runneradmin`.

`FsGuard` canonicalises its roots for exactly this reason, so any fixture that
compares a resolved target against a raw `mkdtemp` path passes locally and fails
on both runners. Have test fixtures `realpath` their root.

## What the changelog entry is for

Someone deciding whether to upgrade, and someone debugging after they did. So:

- Lead with what could lose their work.
- State the symptom they would have seen, not the internal cause. "A CRLF file
  rewritten to LF showed an empty diff and no findings" — not "splitLines
  normalises terminators".
- No agent names, no audit process, no counts of how many things were found.
  `docs/comment-policy.md` bans that in comments and it reads no better here.
