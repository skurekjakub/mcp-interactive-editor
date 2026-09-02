import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Finding } from "../../shared/types.js";
import { Threshold } from "../../ui/src/components/Threshold.js";

/**
 * @module
 *
 * The one-way door, and every condition that has to keep it shut.
 *
 * The server re-checks all of it, so none of this is the last line of defence.
 * What it does hold is the promise the panel makes: a button that is offered is
 * a button that works. Offering one the server will refuse teaches the reflex of
 * pressing through refusals, which is the reflex this whole editor exists to
 * prevent.
 */
afterEach(cleanup);

/** A review with nothing standing between the draft and disk. */
const CLEAR = {
  findings: [] as Finding[],
  ack: false,
  onAck: () => {},
  isDelete: false,
  blocked: false,
  hasComments: false,
  busy: false,
  writable: true,
  unchanged: false,
  label: "Write 3 lines to deploy.yml",
  commentsIncomplete: false,
  onSendComments: () => {},
  onCommit: () => {},
  onDiscard: () => {},
};

const blocker: Finding = {
  id: "create-exists",
  rule: "path",
  severity: "blocker",
  message: "deploy.yml already exists.",
};

const destructive: Finding = {
  id: "large-deletion",
  rule: "destructive",
  severity: "blocker",
  message: "This removes 99 of 100 lines (99%).",
};

/**
 * Renders the threshold over a clear review with one condition changed.
 *
 * @param over - The single condition under test.
 * @returns The commit button.
 */
function commitButton(over: Partial<typeof CLEAR> = {}): HTMLButtonElement {
  render(<Threshold {...CLEAR} {...over} />);
  return document.querySelector("button.commit") as HTMLButtonElement;
}

describe("the one-way door", () => {
  it("opens when nothing is wrong", () => {
    // Act.
    const commit = commitButton();

    // Assert.
    expect(commit.disabled).toBe(false);
    expect(commit.textContent).toBe(CLEAR.label);
  });

  it("stays shut while a finding forbids the write", () => {
    // Act.
    const commit = commitButton({ blocked: true, findings: [blocker] });

    // Assert: and it says which finding, because a dead button with no reason
    // beside it is indistinguishable from a broken panel.
    expect(commit.disabled).toBe(true);
    expect(screen.getByText(blocker.message)).toBeTruthy();
  });

  it("stays shut when the path was refused, because there is nothing to write to", () => {
    // Act.
    const commit = commitButton({ writable: false });

    // Assert.
    expect(commit.disabled).toBe(true);
  });

  it("stays shut while a commit is already in flight", () => {
    // Act.
    const commit = commitButton({ busy: true });

    // Assert.
    expect(commit.disabled).toBe(true);
    expect(commit.textContent).toMatch(/working/i);
  });

  it("stays shut on a file nobody has changed", () => {
    // Act.
    const commit = commitButton({ unchanged: true });

    // Assert.
    expect(commit.disabled).toBe(true);
    expect(commit.textContent).toMatch(/no changes/i);
  });

  it("becomes the send once a comment declines the draft", () => {
    // Act.
    const commit = commitButton({ hasComments: true });

    // Assert: commenting is declining, so committing is gone — but the button
    // offering the only remaining action has to perform it. Labelled as the send
    // and disabled, it was the one press that could do nothing.
    expect(commit.disabled).toBe(false);
    expect(commit.textContent).toMatch(/send the comments/i);
  });

  it("sends the comments rather than committing them", () => {
    // Arrange.
    const onSendComments = vi.fn();
    const onCommit = vi.fn();

    // Act.
    fireEvent.click(commitButton({ hasComments: true, onSendComments, onCommit }));

    // Assert.
    expect(onSendComments).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shuts while a send is already in flight", () => {
    // A second press during the round trip resolves one proposal twice, and the
    // failure lands on a screen the first send has already replaced.
    const commit = commitButton({ hasComments: true, busy: true });

    expect(commit.disabled).toBe(true);
  });

  it("says which door is shut while a highlight has no comment yet", () => {
    // Act.
    const commit = commitButton({ hasComments: true, commentsIncomplete: true });

    // Assert: the send refuses a half-answered tray and committing is already
    // gone. Silence here leaves both shut with nothing saying which to open.
    expect(commit.disabled).toBe(true);
    expect(commit.textContent).toMatch(/comment on every highlight/i);
  });

  it("hands the press through when it opens", () => {
    // Arrange.
    const onCommit = vi.fn();

    // Act.
    fireEvent.click(commitButton({ onCommit }));

    // Assert.
    expect(onCommit).toHaveBeenCalledOnce();
  });
});

describe("acknowledging a destructive write", () => {
  it("asks in the first person, naming the act", () => {
    // Act.
    commitButton({ blocked: true, findings: [destructive], isDelete: true });

    // Assert: a box that says "confirm" is ticked without reading; one that says
    // what is about to happen has to be read to be agreed with.
    expect(screen.getByText(/I mean to/)).toBeTruthy();
    expect(screen.getByText(/delete this file/)).toBeTruthy();
  });

  it("reports the tick upward rather than deciding on its own", () => {
    // Arrange.
    const onAck = vi.fn();
    render(<Threshold {...CLEAR} blocked findings={[destructive]} onAck={onAck} />);

    // Act.
    fireEvent.click(screen.getByRole("checkbox"));

    // Assert.
    expect(onAck).toHaveBeenCalledWith(true);
  });

  it("keeps the door shut until the acknowledgement has come back down", () => {
    // Arrange: ticking the box is a request. The server decides whether it
    // counted, and the answer arrives back as a prop.

    // Act.
    const commit = commitButton({ blocked: true, findings: [destructive], ack: false });

    // Assert.
    expect(commit.disabled).toBe(true);
  });

  it("asks about lines rather than the file when the write is not a delete", () => {
    // Act.
    commitButton({ blocked: true, findings: [destructive], isDelete: false });

    // Assert.
    expect(screen.getByText(/remove those lines/)).toBeTruthy();
  });
});

describe("discarding", () => {
  it("stays available while the review is blocked, because it writes nothing", () => {
    // Act.
    commitButton({ blocked: true, findings: [blocker] });

    // Assert: a panel with both ways out shut is a panel nobody can leave.
    const discard = screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement;
    expect(discard.disabled).toBe(false);
  });

  it("waits while a commit is in flight", () => {
    // Act.
    commitButton({ busy: true });

    // Assert.
    expect((screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
