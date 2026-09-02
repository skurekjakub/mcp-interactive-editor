---
name: vacuous-test-hunt
description: Use when auditing test quality — finding assertions that cannot fail, tests that assert on internals, or tests carrying a private copy of production logic. Covers the break-the-implementation proof and the rewrite patterns.
---

# Hunting vacuous tests

A test that cannot fail is worse than no test: it reports coverage of a contract
nothing holds.

## The only proof that counts

**Break the implementation and re-run the test.** If it still passes, it was
never testing that. Do this in a scratch copy of the tree, never in the working
tree.

Every finding is reported with the break that was applied and the output. A
finding without one is a hypothesis.

### Making the scratch copy

Copy everything except `node_modules`, `.git`, `dist`, `bundle` and `coverage`,
then put a link to the real `node_modules` inside the copy — vitest resolves
through it and nothing is installed twice. On Windows, under Git Bash:

```bash
MSYS_NO_PATHCONV=1 robocopy "$(cygpath -w "$REPO")" "$(cygpath -w "$COPY")" /E /XD node_modules .git dist bundle coverage
cmd //c mklink //J "$(cygpath -w "$COPY/node_modules")" "$(cygpath -w "$REPO/node_modules")"
```

`MSYS_NO_PATHCONV` matters: without it the shell rewrites `/E` and `/XD` as
paths and robocopy copies nothing, silently. Remove the junction with
`cmd //c rmdir` before deleting the copy, so nothing recurses into the real
`node_modules` through it.

Apply each break with a scripted string replacement that refuses to run when
the target text is absent, run only the test file that should notice, and
restore the file by copying it back from the working tree. A probe that "could
not apply" is a probe that proved nothing.

## What this repo has actually shipped

- **A property the component never receives.** `expect(editor.disabled).toBe(false)`
  where `Editor` is handed no `disabled` prop — structurally always false. The
  rewrite has to _type_, with `userEvent`: `fireEvent` ignores `readOnly`, so
  asserting that property instead just moves the tautology.
- **Filtering the falsy out, then asserting truthiness.**
  `calls.filter(Boolean)` followed by `expect(result[0]).toBeTruthy()`.
- **A floor below the true count.** `expect(declared.length).toBeGreaterThanOrEqual(6)`
  against seven declarations — one site can be dropped from the checker and it
  still passes. Name the sites; do not count them.
- **An assertion keyed to a string copied out of the implementation.** A
  temp-file check filtering on `.interactive-editor.tmp` passes the moment the
  suffix is renamed, leak and all. Diff the directory before and after instead.
- **A test with a private copy of production logic.** `lint.test.ts` rebuilt
  "diff first, then lint against those stats" itself, so the assembly that
  actually gates a commit could be broken with the whole file green. Route the
  test through the real assembly.
- **A name computed from the constant under test.** A title interpolating
  `DESTRUCTIVE_DELETION_RATIO` renames the test when the threshold moves,
  instead of failing it.

## Assertions on internals

Legitimate: **call ordering that is the contract** (a context update that must
land before the component unmounts), **a call not happening**, and `_meta` —
which is the wire contract with the host, not an internal.

Not legitimate: CSS hooks like `data-answered` when the observable text and the
disabled button are asserted two lines below, and an assertion strictly subsumed
by the next one.

## Order dependence and flakes

Run the suite with `--sequence.shuffle`, several times, and run individual files
alone. Both failure modes are real here:

- A test that passed only because earlier tests had left state behind, and did
  not construct the condition it named.
- Shared fixtures pinned for one requirement being used by tests with the
  opposite one — a grace period set short so unattached tests fall through,
  used by tests that need a panel to attach within it. Give the second group its
  own server.

Four clean shuffled runs before calling a flake fixed.

## Coverage numbers lie here

`src/tools/*` and `src/server.ts` read near zero because e2e drives the server in
a **subprocess** that v8 never instruments. Ignore those rows; judge that code by
whether its logic has a seam a unit test can reach.
