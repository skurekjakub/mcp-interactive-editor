import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../../ui/src/App.js";
import { OpeningStatus } from "../../ui/src/components/OpeningStatus.js";

/**
 * One test per regression that shipped.
 *
 * All three lived in `ui/`, which nothing could reach: the node suite drives the
 * server over stdio and never renders a component. They went out while the whole
 * suite was green, which is the argument for this file existing at all.
 *
 * Rendering `App` with no host puts it in preview mode — `IS_PREVIEW` is
 * `window.parent === window`, true under jsdom — so it comes up on the fixture
 * proposal with a real diff, real findings and the real bridge stub.
 */
afterEach(cleanup);

describe("the editor is never taken away (shipped before 0.3.0)", () => {
  it("keeps a typeable editor in the diff-only view", async () => {
    render(<App />);

    // "diff" used to remove the editor outright, leaving a change on screen that
    // could not be touched — the one thing the panel exists to allow.
    fireEvent.click(screen.getByRole("button", { name: "diff" }));

    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    expect(editor.readOnly).toBe(false);
  });

  it("still shows the diff alongside it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "diff" }));
    expect(screen.getByText("Against disk")).toBeTruthy();
  });
});

describe("a highlight is always commentable (shipped in 0.4.0)", () => {
  it("offers a way to attach a comment for a selection in the editor", () => {
    render(<App />);

    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    editor.setSelectionRange(0, 16);
    fireEvent.select(editor);

    /*
     * 0.4.0 moved this into a popover anchored to the selection and deleted the
     * tray's own row in the same change, so a selection that yielded no usable
     * rectangle had nowhere left to go. Whatever the anchor does, there must be
     * an add affordance on screen.
     */
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
    expect(row?.getAttribute("data-answered")).toBe("false");
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

    expect(row.getAttribute("data-answered")).toBe("true");
    const send = screen.getByRole("button", { name: /send to claude/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
  });

  it("makes committing and commenting exclusive", () => {
    render(<App />);

    const editor = screen.getByLabelText("Proposed file contents") as HTMLTextAreaElement;
    editor.setSelectionRange(0, 16);
    fireEvent.select(editor);
    fireEvent.click(screen.getAllByRole("button", { name: /^\+ Add$/ })[0]);

    const row = document.querySelector(".selection-row") as HTMLElement;
    fireEvent.change(within(row).getByRole("textbox"), { target: { value: "no" } });

    // Commenting is declining. Committing anyway would be the contradiction.
    const commit = document.querySelector("button.commit") as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    expect(commit.textContent).toMatch(/send the comments/i);
  });
});

describe("a stall says why (shipped in 0.4.x)", () => {
  it("names the step it is waiting on", () => {
    render(<OpeningStatus display="deploy.yml" phase="claiming" failure={null} />);

    expect(screen.getByText(/Opening/)).toBeTruthy();
    expect(screen.getByText(/which proposal this panel is for/)).toBeTruthy();
  });

  it("shows the failure instead of spinning silently", () => {
    // The bug: this branch rendered "Opening …" and never read `failure`, so a
    // dead panel and a slow one looked identical.
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
