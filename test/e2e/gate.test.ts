import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommitReceipt, EditorState, ProposalHandle } from "../../shared/types.js";
import { ENTRY_POINTS, textOf, useServer } from "./harness.js";

/**
 * The gate. `propose_write` does not return when the panel opens, it returns
 * what happened in it — so the agent learns its draft was rejected in the
 * result of the call it already made, rather than in a message someone has to
 * tell it to go and read.
 *
 * These drive it the way the panel does: start the call, do not await it,
 * claim the proposal, act, then see what the call became.
 */
describe.each(ENTRY_POINTS)("the review gate, running from %s", (_label, SERVER) => {
  /*
   * Generous timings, because the grace period pulls two ways.
   *
   * Everywhere else it is pinned small so a test that never attaches a panel
   * falls straight through instead of sitting out the real wait. Here a panel
   * does attach, and it has to win a race against that same timer: claiming
   * costs several round trips to a child process, and a grace that expires
   * first resolves the review as unanswered before anyone can answer it.
   * One knob, two opposite requirements.
   */
  const rig = useServer(SERVER, {
    args: ["--block-on-review", "--review-grace-ms", "10000", "--review-timeout-ms", "15000"],
  });

  /**
   * What the panel does on mount, before any result carrying an id exists.
   * Retried, because the panel is racing the tool call that created it — the
   * host mounts the View on the call, not on the proposal being ready.
   */
  const claim = async (path: string) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const found = await rig.call("editor_pending", { path });
      const payload = found.structuredContent as unknown as EditorState | undefined;
      if (payload?.proposal) return payload.proposal.proposalId;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no proposal ever opened for ${path}`);
  };

  it("commenting rejects the draft and hands the words back to the agent", async () => {
    const target = join(rig.root, "redraft-me.txt");
    const opening = rig.call("propose_write", { path: target, content: "first attempt\n" });

    const id = await claim(target);
    await rig.call("editor_attach", { proposalId: id });
    await rig.call("editor_request_changes", {
      proposalId: id,
      message: "line 1: too terse, say why it exists",
    });

    const result = await opening;

    expect(textOf(result)).toMatch(/asked for changes/i);
    expect(textOf(result)).toContain("too terse, say why it exists");
    expect(textOf(result), "the agent must be told to redraft").toMatch(/redraft/i);
    expect(
      (result.structuredContent as { outcome?: string })?.outcome,
      "a rejection must not read as a receipt",
    ).toBe("changes-requested");
    await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("accepting without comment commits, and the call returns the receipt", async () => {
    const target = join(rig.root, "accepted.txt");
    const opening = rig.call("propose_write", {
      path: target,
      content: "accepted as proposed\n",
    });

    const id = await claim(target);
    await rig.call("editor_attach", { proposalId: id });
    await rig.call("editor_commit", { proposalId: id });

    const result = await opening;

    expect(textOf(result)).toMatch(/^Wrote /);
    expect((result.structuredContent as unknown as CommitReceipt).ok).toBe(true);
    expect(await readFile(target, "utf8")).toBe("accepted as proposed\n");
  });

  it("discarding ends the call too, so nothing is left hanging", async () => {
    const target = join(rig.root, "thrown-away.txt");
    const opening = rig.call("propose_write", { path: target, content: "nope\n" });

    const id = await claim(target);
    await rig.call("editor_attach", { proposalId: id });
    await rig.call("editor_discard", { proposalId: id, reason: "wrong file" });

    const result = await opening;

    expect(textOf(result)).toMatch(/discarded/i);
    expect(textOf(result)).toContain("wrong file");
    await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("a rejected proposal cannot then be committed by a stale panel", async () => {
    const target = join(rig.root, "rejected-then-committed.txt");
    const opening = rig.call("propose_write", { path: target, content: "should never land\n" });

    const id = await claim(target);
    await rig.call("editor_attach", { proposalId: id });
    await rig.call("editor_request_changes", { proposalId: id, message: "no" });
    await opening;

    const late = await rig.call("editor_commit", { proposalId: id });
    expect(late.isError, `a stale commit should have been refused, got: ${textOf(late)}`).toBe(
      true,
    );
    expect(textOf(late)).toMatch(/was already (committed|discarded|changes-requested|superseded)/i);
    await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
  });
});

describe.each(ENTRY_POINTS)("a panel that never comes, running from %s", (_label, SERVER) => {
  const rig = useServer(SERVER);

  it("returns the diff instead of hanging when no panel ever attaches", async () => {
    // The host said it renders MCP Apps; no View turned up. That is a promise
    // broken by the host, and it must not cost the agent a ten minute stall.
    const opened = await rig.call("propose_write", {
      path: join(rig.root, "no-panel-came.txt"),
      content: "still useful as text\n",
    });

    expect(textOf(opened)).toMatch(/nothing has been written/i);
    expect(textOf(opened)).toContain("+still useful as text");
  });
});

/*
 * Every suite above runs with --block-on-review, which no shipped configuration
 * passes: neither the plugin manifest nor the `.mcpb` sets it. The default is
 * the opposite, so without this block the mode that every install actually runs
 * has no end-to-end coverage at all.
 */
describe.each(ENTRY_POINTS)("the shipped default, which does not block (%s)", (_label, SERVER) => {
  const rig = useServer(SERVER, { args: [] });

  it("returns the diff promptly instead of waiting for a human", async () => {
    // Arrange.
    const started = Date.now();

    // Act.
    const opened = await rig.call("propose_write", {
      path: join(rig.root, "prompt.txt"),
      content: "hello\n",
    });

    // Assert: the wait is opt-in, so this must not sit out any grace period.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(textOf(opened)).toMatch(/Editor open/);
    expect(opened.isError).toBeFalsy();
  });

  it("describes itself to the model as non-blocking", async () => {
    // Assert: a description promising to wait, on a server that returns
    // immediately, tells the model its next observation is a verdict when it
    // is a diff.
    const { tools } = await rig.client.listTools();
    const description = tools.find((t) => t.name === "propose_write")?.description ?? "";

    expect(description).toMatch(/returns as soon as the panel is open/i);
    expect(description).not.toMatch(/does not return until/i);
  });

  it("reports that comments had nowhere to go, rather than claiming delivery", async () => {
    // Arrange.
    const opened = await rig.call("propose_write", {
      path: join(rig.root, "commented.txt"),
      content: "draft\n",
    });
    const id = (opened.structuredContent as unknown as ProposalHandle).proposalId;
    await rig.call("editor_attach", { proposalId: id });

    // Act.
    const sent = await rig.call("editor_request_changes", {
      proposalId: id,
      message: "not like that",
    });

    /*
     * Assert: nothing was waiting on the review, so the panel has to be told
     * to deliver the words itself. Claiming delivery here loses them.
     */
    expect((sent.structuredContent as { delivered?: boolean }).delivered).toBe(false);
    await expect(readFile(join(rig.root, "commented.txt"), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("still refuses a commit that no panel ever attached to", async () => {
    // Arrange.
    const opened = await rig.call("propose_write", {
      path: join(rig.root, "unattached.txt"),
      content: "should not land\n",
    });
    const id = (opened.structuredContent as unknown as ProposalHandle).proposalId;

    // Act.
    const result = await rig.call("editor_commit", { proposalId: id });

    // Assert.
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/never opened in the editor/i);
  });

  it("reports its own version, so an install can be confirmed", async () => {
    // Assert: without this there is no way to tell which build is answering.
    const roots = await rig.call("list_roots");
    const reported = roots.structuredContent as { serverVersion?: string };
    expect(reported.serverVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(reported).toMatchObject({ rendersPanel: true, blockOnReview: false });
  });
});
