import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { EditorState, ProposalHandle } from "../../shared/types.js";
import { ENTRY_POINTS, callOn, spawnServer, textOf } from "./harness.js";

/*
 * A host is allowed to run this server twice, and one of them does.
 *
 * Claude Desktop starts every configured server from two managers that do not
 * coordinate and leaves both alive, so the model's call and the panel's calls
 * can land on different processes. A proposal held in one process's memory is
 * then invisible to the process being asked to attach to it, and the panel spins
 * on a claim that can never succeed while the agent is told the id is unknown.
 *
 * These run two real processes for that reason. Driving one client twice would
 * pass against a purely in-memory store and prove nothing.
 */
describe.each(ENTRY_POINTS)("two server processes, one host (%s)", (_label, SERVER) => {
  let root: string;
  let model: Client;
  let panel: Client;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "interactive-editor-split-"));
    // Identical arguments, which is what the two managers pass: the settings are
    // what the siblings agree on, so this is the condition under test.
    model = await spawnServer(SERVER, ["--root", root]);
    panel = await spawnServer(SERVER, ["--root", root]);
  });

  afterAll(async () => {
    await model?.close();
    await panel?.close();
    await rm(root, { recursive: true, force: true });
  });

  it("lets the panel claim a proposal the other process opened", async () => {
    // Arrange: the model's call lands on one process.
    await callOn(model)("propose_write", { path: "claim-me.txt", content: "hello\n" });

    // Act: the panel asks the other one, with only the path it was handed.
    const claimed = await callOn(panel)("editor_pending", { path: "claim-me.txt" });

    // Assert: an empty answer here is the 30-second spin on "Opening…".
    const state = claimed.structuredContent as unknown as EditorState | undefined;
    expect(state?.proposal?.target.requested).toBe("claim-me.txt");
  });

  it("commits a proposal the other process opened", async () => {
    // Arrange.
    const opened = await callOn(model)("propose_write", {
      path: "written-across.txt",
      content: "landed\n",
    });
    const { proposalId } = opened.structuredContent as unknown as ProposalHandle;

    // Act: attach and commit from the process that never saw it created.
    const attached = await callOn(panel)("editor_attach", { proposalId });
    const committed = await callOn(panel)("editor_commit", { proposalId });

    // Assert.
    expect(attached.isError ?? false).toBe(false);
    expect(committed.isError ?? false).toBe(false);
    expect(await readFile(join(root, "written-across.txt"), "utf8")).toBe("landed\n");
  });

  it("writes an approved proposal once, however many processes are asked", async () => {
    // Arrange: one approval, attached from the panel's process.
    const opened = await callOn(model)("propose_write", {
      path: "exactly-once.txt",
      content: "first\n",
    });
    const { proposalId } = opened.structuredContent as unknown as ProposalHandle;
    await callOn(panel)("editor_attach", { proposalId });
    await callOn(panel)("editor_commit", { proposalId });

    // Act: the other process is asked to write the same approval again.
    const second = await callOn(model)("editor_commit", { proposalId });

    // Assert: two receipts for one approval is the failure this guards. The
    // resolution has to be visible across the split, not just within a process.
    expect(second.isError).toBe(true);
    expect(textOf(second)).toMatch(/already committed/i);
    expect(await readFile(join(root, "exactly-once.txt"), "utf8")).toBe("first\n");
  });

  it("keeps servers with different roots apart", async () => {
    // Arrange: a second root is a different server, however it was started.
    const elsewhere = await mkdtemp(join(tmpdir(), "interactive-editor-other-"));
    const stranger = await spawnServer(SERVER, ["--root", elsewhere]);

    try {
      // Act.
      await callOn(model)("propose_write", { path: "not-yours.txt", content: "x\n" });
      const claimed = await callOn(stranger)("editor_pending", { path: "not-yours.txt" });

      // Assert: sharing across roots would let a server claim, and then write,
      // a proposal for a directory it was never allowed to touch.
      expect(claimed.structuredContent).toMatchObject({ open: false, openCount: 0 });
    } finally {
      await stranger.close();
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});
