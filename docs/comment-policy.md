# Comment Policy

Comments in this repository follow strict structural rules. Every comment describes the contract of the symbol it sits on, not the story around it.

Comments come in two shapes:

1. **JSDoc on every function, type, interface, and component**, written as API documentation for an unknown caller.
2. **Inline comments at gotchas** — where correct-looking code is wrong or wrong-looking code is right.

Everything else is a policy violation.

Run `npm run lint:comments` to check a working tree against this document. It is part of `npm run verify`, so a violation fails the build.

---

## 1. JSDoc Structure and Template

Every function (exported or private), type, interface, and React component requires a docblock.

### The Canonical Docblock Template

```ts
/**
 * Summary sentence in third-person indicative, ending with a period.
 *
 * Detailed prose explaining invariants, constraints, and side effects.
 * Write for an unknown caller arriving from any call site.
 *
 * @param paramName - Parameter description without types (hyphen separator).
 * @returns Description of returned value and its guarantees.
 * @throws {ErrorType} When specific failure condition occurs (starts with "When").
 */
```

### Formatting Rules

1. **Summary Sentence (First Line):**
   - Must be on its own line immediately after `/**`.
   - Must lead with a verb phrase describing the result in third-person indicative (e.g. `Resolves`, `Compiles`, `Transforms`, `Extracts`), never imperative (`Resolve`) and never narrative (`This function will resolve...`).
   - Must end with a period.
2. **Mandatory Blank Line:**
   - A blank comment line (` *`) must separate the summary sentence from further prose, and separate prose from tags.
3. **Tags Section (Always Last):**
   - Tags go at the bottom of the block and never interleave with prose.
   - Format `@param name - text` (hyphen separator, omit types because TypeScript carries them).
   - Format `@throws {Type} When ...` (always starts with the word "When").

---

## 2. Standard Tag Reference

| Tag              | Syntax                           | Requirement                                                        |
| ---------------- | -------------------------------- | ------------------------------------------------------------------ |
| `@param`         | `@param name - Description.`     | Required for non-obvious parameters. Omit types.                   |
| `@returns`       | `@returns Description.`          | Required for functions returning a value, unless a trivial getter. |
| `@throws`        | `@throws {Type} When condition.` | Required for every error the function can throw.                   |
| `@typeParam`     | `@typeParam T - Description.`    | Required for generic constraints that aren't self-evident.         |
| `@see`           | `@see {@link Symbol}`            | Sibling contract reference.                                        |
| `@deprecated`    | `@deprecated Use X instead.`     | Must specify replacement.                                          |
| `{@link Symbol}` | `{@link SymbolName}`             | Preferred inline link syntax for repository symbols.               |

### Repository-Specific Tags

| Tag       | Meaning                                                                                      |
| --------- | -------------------------------------------------------------------------------------------- |
| `@module` | Module-level docblock at the top of a file defining overall module invariants.               |
| `@gate`   | Placed on functions that enforce a review-gate invariant. States which invariant they carry. |

---

## 3. Practical Examples by Construct

### Function with Parameters, Return, and Error

```ts
/**
 * Resolves a requested path against the writable roots.
 *
 * Rejections carry a reason rather than throwing, because the View renders the
 * refusal rather than crashing on it.
 *
 * @param requested - Path as the model supplied it, absolute or root-relative.
 * @returns The resolved target, or a rejection naming which check failed.
 * @throws {PathRejected} When the caller is internal and cannot render a refusal.
 */
function describe(requested: string): TargetInfo {
  // ...
}
```

### Interface & Exported Type

```ts
/**
 * A claim ticket for a proposal, sent in place of the proposal itself.
 */
export interface ProposalHandle {
  /** Opaque identifier the View trades for the full state. */
  proposalId: string;
  /** Path as it should be shown to a human, relative to its root. */
  display: string;
}
```

### React Component

```tsx
/**
 * Renders the proposed draft beside its diff against disk.
 *
 * A delete has no draft to show and collapses to the diff alone.
 *
 * @param props - Component properties.
 * @param props.view - Which panes the human has asked for.
 * @returns The two-pane review surface.
 */
function ReviewPanes({ view }: ReviewPanesProps) {
  // ...
}
```

---

## 4. Inline Comments (Gotchas Only)

Inline comments mark lines where correct-looking code is wrong, or wrong-looking code is right.

- Sit immediately above the line or block they explain.
- Explain the constraint or gotcha, not the happy-path narrative.
- Include locators (spec sections, vendor doc paths, issue numbers) when citing external constraints.

```ts
// MCP Apps § Tool Calls: the host MAY block a View's message, so a call that
// waits on the panel can never be assumed to be dispatched.
if (!context.blockOnReview) return opened;
```

```ts
// A textarea exposes no rect for a selection, only for the box, so the last
// pointer release stands in for where the selection ended.
const pointer = useRef<{ x: number; y: number } | null>(null);
```

---

## 5. Test Comment Markers (Arrange / Act / Assert)

Tests under `test/` use structural phase markers:

```ts
it("refuses to commit when the flush was refused", async () => {
  // Arrange: a bridge that refuses only the final flush.
  const bridge = refusing("editor_update");

  // Act.
  await result.current.commit();

  // Assert.
  expect(bridge.calls).not.toContain("editor_commit");
});
```

### Rules for Test Markers

- Include the period in the comment (`// Arrange.`, `// Act.`, `// Assert.`).
- If an explanation is needed, use a colon: `// Arrange: a passthrough before a responder.`
- Only label phases that actually exist (do not create empty marker lines).

---

## 6. What Never Ships

| Narrative Urge                                      | Where It Belongs                              |
| --------------------------------------------------- | --------------------------------------------- |
| "Why we chose this approach over another"           | Commit body                                   |
| "Step 3 of the compilation pipeline"                | Nowhere (narrative call-stack assumption)     |
| "This used to be implemented with regex"            | Git history                                   |
| "The 0.5.2 bug", "shipped in 0.3.0"                 | Git history and the changelog                 |
| "Temporary workaround for Node 22.4"                | PR description or issue tracker               |
| "The panel spent thirty seconds retrying"           | Git history                                   |
| Counts and tallies ("85 tests", "three call sites") | Nowhere (they are wrong the moment they land) |
| `// ── Section Banners ──`                          | Nowhere (delete banners)                      |

**No accounting, no enumerating.** A comment states the contract and the constraint in the present tense. It does not recount what went wrong before, tally how many places do a thing, or attach version numbers to defects. That history is in `git log`; repeating it in the source guarantees it goes stale in place, and it reads as an apology rather than a specification.

---

## 7. Checklist for Code Review

- [ ] Every function has a JSDoc block with a summary sentence ending in a period.
- [ ] Blank line exists between summary sentence and prose description.
- [ ] Summary sentence uses a third-person indicative verb (`Extracts`, `Compiles`, `Returns`).
- [ ] Tags are positioned at the bottom of the docblock.
- [ ] `@param` uses a `-` separator without types.
- [ ] `@throws` starts with `When ...`.
- [ ] No narrative call-stack assumptions or flow-tracing.
- [ ] No incident retellings, version numbers on defects, or counts.
- [ ] Test files carry `// Arrange.`, `// Act.`, `// Assert.` markers.
- [ ] All external claims cite verifiable locators (e.g. MCP Apps § Tool Calls).
