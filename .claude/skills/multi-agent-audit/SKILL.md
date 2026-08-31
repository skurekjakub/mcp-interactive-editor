---
name: multi-agent-audit
description: Use when auditing this repo with several independent agents at once — bug hunts, refactor sweeps, tooling reviews, test-quality passes — and then triaging and applying what they report. Covers how to brief them, how to rank findings by corroboration, and the verify-before-acting rule.
---

# Multi-agent audit

Several agents read the whole surface independently, then their findings are
triaged and applied. The value is in the independence: a claim two agents reach
separately, without seeing each other's work, is a much stronger signal than a
claim one agent reached with more confidence.

## Briefing the agents

Dispatch them in **one message, multiple tool calls**, so they run concurrently.
Give each a distinct lens — overlapping lenses waste tokens, disjoint ones miss
the seams:

- **Bugs and sanitization** — reproduce, don't theorise. Unbounded input,
  quadratic scans, races, path handling, anything that can throw where a refusal
  should be rendered.
- **Refactoring and cleanup** — duplication, dead exports, untestable seams,
  docblocks that no longer match the code.
- **Tooling and static analysis** — what a linter or type flag would catch that
  nothing currently does. Have it verify version support and config shapes rather
  than trusting blog posts.
- **Test quality** — see the `vacuous-test-hunt` skill.
- Optionally an unscoped whole-repo agent, purely for corroboration.

Tell every agent:

- Verify against the **vendored specs** in `../ext-apps` and
  `../modelcontextprotocol`, not from memory. Web search where the vendored copy
  is silent.
- **Reproduce before reporting.** A finding with a transcript beats a finding
  with an argument. Ask for the commands and the output.
- **Report, do not write.** Concurrent agents editing one tree corrupt each
  other's findings and yours. They may write to a scratch directory.
- Anchor findings to a commit, and say so — the tree will move under them.

## Triage

1. **Corroboration first.** Anything two agents found independently goes to the
   top of the list, regardless of how either ranked it.
2. **Then severity**, weighted by whether it can lose a user's work: silent
   wrong writes, then fail-open configuration, then resource exhaustion, then
   everything else.
3. **Reproduced beats reasoned.** A finding with a transcript outranks a
   confident one without.

## Applying

**Verify every claim against current source before acting on it.** Agents
snapshot the tree and it moves under them; a report will confidently describe
code you already changed. Read the file. If the claim no longer holds, say so
and move on — do not apply a fix for a bug that is not there.

Agents also make ordinary mistakes. This session one reported annotations
missing from three tools and named the wrong third. The count was right and the
important one was right; the detail was not. Check, then act.

Work in groups, running `npm run verify` between them, so a failure names a
small set of changes rather than fifty.

When a finding says "delete this dead thing", ask first whether it should be
**used** instead. A stats flag nothing consumed turned out to mark a real change
the panel rendered as an empty diff — the fix was a finding, not a deletion.

## Reporting back

Say what was applied, what was verified-and-rejected, and what was left. A
finding you decided not to act on is a decision the user should see, not
something to quietly drop.
