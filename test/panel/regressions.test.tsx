import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../ui/src/App.js";
import { OpeningStatus } from "../../ui/src/components/OpeningStatus.js";
import { ReviewPanes } from "../../ui/src/components/ReviewPanes.js";
import { previewState } from "../../ui/src/preview.js";

/**
 * One test per defect that reached a release through `ui/`.
 *
 * The node suite drives the server over stdio and never renders a component, so
 * everything in `ui/src` is unreachable from it. That gap is the argument for
 * these cases.
 *
 * Rendering `App` with no host puts it in preview mode — no frame means no host
 * under jsdom — so it comes up on the fixture proposal with a real diff, real
 * findings and the real bridge stub.
 */
afterEach(cleanup);

describe("the editor is never taken away", () => {
  it("still takes typing in the diff-only view", async () => {
    /*
     * Typed rather than inspected. `Editor` is never handed a `disabled` prop,
     * so reading that property back asserts a structural constant and passes
     * against an editor nobody can type into — which is the defect itself:
     * a change on screen that cannot be touched, the one thing the panel exists
     * to allow. `readOnly` is no better, because `fireEvent` ignores it.
     */
    const user = userEvent.setup();
    render(<App />);
    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    const before = editor.value;

    // Act.
    await user.click(screen.getByRole("button", { name: "diff" }));
    await user.click(editor);
    await user.keyboard("{End}# typed");

    // Assert.
    const after = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    expect(after.value, "the keystrokes must reach the draft").not.toBe(before);
    expect(after.value).toContain("# typed");
  });

  it("still shows the diff alongside it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "diff" }));
    expect(screen.getByText("Against disk")).toBeTruthy();
  });

  /*
   * A delete has no draft, so the editor pane is absent. The view toggle lives
   * in the pane headers, so hiding the diff pane as well takes the only control
   * that could bring either one back off the screen with it.
   */
  it("keeps a pane on screen for a delete asked to show only the editor", () => {
    // Arrange.
    const state = previewState();

    // Act.
    const { container } = render(
      <ReviewPanes
        view="edit"
        onViewChange={() => {}}
        content=""
        onContentChange={() => {}}
        onSelect={() => {}}
        hunks={state.diff}
        target={state.proposal.target}
        isDelete
      />,
    );

    // Assert.
    expect(container.querySelectorAll(".pane").length).toBeGreaterThan(0);
    expect(screen.getByRole("group", { name: /pane layout/i })).toBeTruthy();
  });
});

describe("the editor behaves like a text field", () => {
  /*
   * Tab inserting at the caret is correct for a caret and destructive for a
   * range: it replaces every selected line with two spaces. React controls the
   * value, so the browser's own undo does not reliably bring them back.
   */
  it("indents a selected block instead of replacing it", () => {
    // Arrange.
    render(<App />);
    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    const before = editor.value;
    const firstThree = nthNewline(before, 3);

    // Act.
    editor.setSelectionRange(0, firstThree);
    fireEvent.keyDown(editor, { key: "Tab" });

    // Assert.
    const after = (screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement).value;
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain(before.slice(0, 20).split("\n")[0]);
    expect(after.startsWith("  ")).toBe(true);
  });

  it("lets shift+Tab leave the field", () => {
    // Arrange: swallowing it makes the editor a keyboard trap (WCAG 2.1.2).
    render(<App />);
    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    const before = editor.value;

    // Act.
    editor.setSelectionRange(0, 0);
    fireEvent.keyDown(editor, { key: "Tab", shiftKey: true });

    // Assert.
    expect((screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement).value).toBe(
      before,
    );
  });

  it("keeps focus in the editor for a keyboard selection", () => {
    // Arrange: the popover autofocusing on keyup would swallow the rest of a
    // shift+arrow selection.
    render(<App />);
    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    editor.focus();

    // Act.
    editor.setSelectionRange(0, 16);
    fireEvent.keyUp(editor, { key: "ArrowDown", shiftKey: true });

    // Assert.
    expect(document.activeElement).toBe(editor);
  });
});

describe("a highlight is always commentable", () => {
  it("offers a way to attach a comment for a selection in the editor", () => {
    // Arrange.
    render(<App />);
    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;

    // Act.
    editor.setSelectionRange(0, 16);
    fireEvent.select(editor);

    // Assert: whatever the anchor does, an add affordance must be on screen.
    const add = screen.getAllByRole("button", { name: /add/i });
    expect(add.length, "a selection with no way to comment on it is the bug").toBeGreaterThan(0);
  });

  it("pins the passage, and then asks for a comment on it", () => {
    render(<App />);

    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    editor.setSelectionRange(0, 16);
    fireEvent.select(editor);

    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[0]);

    // Once pinned it becomes a row with its own comment box, and sending waits
    // for that box to be filled.
    const row = document.querySelector(".selection-row");
    expect(row, "the pinned highlight should have its own row").toBeTruthy();
    expect(screen.getByText(/needs a comment/i)).toBeTruthy();

    const send = screen.getByRole("button", { name: /send to claude/i }) as HTMLButtonElement;
    expect(send.disabled, "sending with an uncommented highlight must be blocked").toBe(true);
  });

  it("unblocks sending once the comment is written", () => {
    render(<App />);

    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    editor.setSelectionRange(0, 16);
    fireEvent.select(editor);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[0]);

    const row = document.querySelector(".selection-row") as HTMLElement;
    const note = within(row).getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: "why this line?" } });

    const send = screen.getByRole("button", { name: /send to claude/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
  });

  it("makes committing and commenting exclusive", async () => {
    render(<App />);

    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    editor.setSelectionRange(0, 16);
    fireEvent.select(editor);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[0]);

    const row = document.querySelector(".selection-row") as HTMLElement;
    fireEvent.change(within(row).getByRole("textbox"), { target: { value: "no" } });

    // Commenting is declining, so this press must not write. Asserted on where
    // the panel lands rather than on a disabled button: a button that cannot be
    // pressed satisfies exclusivity by offering nothing at all, which is how the
    // only remaining action came to do nothing.
    fireEvent.click(document.querySelector("button.commit") as HTMLButtonElement);

    // "Sent back" and the receipt are different terminal screens, so landing on
    // the first is the assertion that no write happened.
    expect(await screen.findByText("Sent back")).toBeTruthy();
    expect(screen.getByText(/nothing was written/i)).toBeTruthy();
  });
});

describe("a stall says why", () => {
  it("names the step it is waiting on", () => {
    render(<OpeningStatus display="deploy.yml" phase="claiming" failure={null} />);

    expect(screen.getByText(/Opening/)).toBeTruthy();
    expect(screen.getByText(/which proposal this panel is for/)).toBeTruthy();
  });

  it("shows the failure instead of spinning silently", () => {
    // A branch that rendered "Opening…" and never read `failure` made a dead
    // panel and a slow one look identical.
    render(<OpeningStatus display="deploy.yml" phase="claiming" failure="No proposal was open." />);
    expect(screen.getByText("No proposal was open.")).toBeTruthy();
  });

  it("says nothing about failure when there is none", () => {
    const { container } = render(
      <OpeningStatus display="deploy.yml" phase="attaching" failure={null} />,
    );
    expect(container.querySelector(".status-error")).toBeNull();
  });
});

/**
 * Finds the offset just past the nth newline.
 *
 * @param text - The text to scan.
 * @param n - How many newlines to pass.
 * @returns The offset, or the text length when there are fewer.
 */
function nthNewline(text: string, n: number): number {
  let at = -1;
  for (let i = 0; i < n; i += 1) {
    const next = text.indexOf("\n", at + 1);
    if (next === -1) return text.length;
    at = next;
  }
  return at;
}

/*
 * The seam between the tray and the threshold.
 *
 * Both halves were correct in isolation: the tray sent when asked, and the
 * threshold rendered whatever label its props described. Nothing rendered them
 * together, so a button carrying the send's label while wired to the commit —
 * and disabled besides — went unnoticed. Testing it needs the whole panel.
 */
describe("commenting leaves an action that works", () => {
  /**
   * Pins a highlight and comments on it.
   *
   * @param comment - What to write against the highlight.
   */
  function commentOnSomething(comment: string) {
    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    editor.setSelectionRange(0, 16);
    fireEvent.select(editor);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[0]);

    const box = document.querySelector(".selection-row textarea") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: comment } });
  }

  it("offers the send on the threshold, and performs it", async () => {
    // Arrange.
    render(<App />);
    commentOnSomething("why this line?");

    // Act.
    const button = document.querySelector("button.commit") as HTMLButtonElement;

    // Assert: the label promises the send, so the press has to make it happen.
    expect(button.textContent).toMatch(/send the comments/i);
    expect(button.disabled, "the only action left cannot be disabled").toBe(false);

    fireEvent.click(button);
    expect(await screen.findByText("Sent back")).toBeTruthy();
  });

  it("says which door is shut while a highlight is still uncommented", () => {
    // Arrange: one commented, one not.
    render(<App />);
    commentOnSomething("why this line?");

    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    editor.setSelectionRange(20, 40);
    fireEvent.select(editor);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[0]);

    // Assert: committing is gone because a comment declines the draft, and the
    // send refuses a half-answered tray. Both shut and silent is the dead end.
    const button = document.querySelector("button.commit") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toMatch(/comment on every highlight/i);
  });
});
