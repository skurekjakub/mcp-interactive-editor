import { assert, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CommitReceipt, ProposalHandle } from "../../shared/types.js";
import {
  BLOCKING_ARGS,
  ENTRY_POINTS,
  NO_PANEL,
  attach,
  handleOf,
  openPanel,
  peek,
  refusal,
  spawnServer,
  stateOf,
  textOf,
  useServer,
} from "./harness.js";

describe.each(ENTRY_POINTS)("committing, running from %s", (_label, SERVER) => {
  const rig = useServer(SERVER);

  describe("the write", () => {
    it("refuses to commit a proposal no View ever attached to", async () => {
      const opened = await openPanel(rig.call, {
        path: join(rig.root, "unattached.txt"),
        content: "nope\n",
      });
      await refusal(
        rig.call,
        "editor_commit",
        { proposalId: opened.proposal.proposalId },
        /never opened in the editor/i,
      );
    });

    it("writes the file once the View attaches and commits", async () => {
      const target = join(rig.root, "nested", "created.txt");
      const opened = await openPanel(rig.call, { path: target, content: "first line\n" });
      const id = opened.proposal.proposalId;

      await attach(rig.call, id);
      const receipt = stateOf(
        await rig.call("editor_commit", { proposalId: id }),
      ) as unknown as CommitReceipt;

      expect(receipt.ok).toBe(true);
      expect(receipt.editedByHuman).toBe(false);
      expect(await readFile(target, "utf8")).toBe("first line\n");
    });

    it("commits what the human edited, not what the model proposed", async () => {
      const target = join(rig.root, "edited.txt");
      const opened = await openPanel(rig.call, { path: target, content: "model wrote this\n" });
      const id = opened.proposal.proposalId;

      await attach(rig.call, id);
      await rig.call("editor_update", {
        proposalId: id,
        content: "the human wrote this instead\n",
      });
      const receipt = stateOf(
        await rig.call("editor_commit", { proposalId: id }),
      ) as unknown as CommitReceipt;

      expect(receipt.editedByHuman).toBe(true);
      expect(await readFile(target, "utf8")).toBe("the human wrote this instead\n");
    });

    it("will not commit the same proposal twice", async () => {
      const opened = await openPanel(rig.call, {
        path: join(rig.root, "once.txt"),
        content: "once\n",
      });
      const id = opened.proposal.proposalId;

      await attach(rig.call, id);
      await rig.call("editor_commit", { proposalId: id });
      await refusal(
        rig.call,
        "editor_commit",
        { proposalId: id },
        /was already (committed|discarded|changes-requested|superseded)/i,
      );
    });

    it("does not know about proposals from a previous run", async () => {
      await refusal(
        rig.call,
        "editor_attach",
        { proposalId: "00000000-0000-0000-0000-000000000000" },
        /Unknown proposal/,
      );
    });
  });

  describe("guarding the one-way door", () => {
    it("blocks a write that removes most of a file until it is acknowledged", async () => {
      const target = join(rig.root, "big.txt");
      const original = `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")}\n`;
      await writeFile(target, original, "utf8");

      const opened = await openPanel(rig.call, { path: target, content: "line 0\n" });
      const id = opened.proposal.proposalId;

      const blocker = opened.findings.find((f) => f.id === "large-deletion");
      assert(blocker, "expected a large-deletion finding");
      expect(blocker.severity).toBe("blocker");

      await attach(rig.call, id);
      await refusal(rig.call, "editor_commit", { proposalId: id }, /Refusing to write/);
      expect(await readFile(target, "utf8"), "nothing may land while blocked").toBe(original);

      await rig.call("editor_update", { proposalId: id, destructiveAcknowledged: true });
      const receipt = stateOf(
        await rig.call("editor_commit", { proposalId: id }),
      ) as unknown as CommitReceipt;

      expect(receipt.ok).toBe(true);
      expect(await readFile(target, "utf8")).toBe("line 0\n");
    });

    it("refuses to commit when the file changed while the editor was open", async () => {
      const target = join(rig.root, "raced.txt");
      await writeFile(target, "original\n", "utf8");

      const opened = await openPanel(rig.call, { path: target, content: "proposed\n" });
      const id = opened.proposal.proposalId;
      await attach(rig.call, id);

      await writeFile(target, "somebody else got here first\n", "utf8");

      await refusal(rig.call, "editor_commit", { proposalId: id }, /changed on disk/i);
      expect(await readFile(target, "utf8")).toBe("somebody else got here first\n");
    });

    it("will not let an update move the proposal to another file", async () => {
      // Arrange: a proposal against a file the human has been shown.
      const target = join(rig.root, "movable.txt");
      const opened = await openPanel(rig.call, { path: target, content: "content\n" });
      const id = opened.proposal.proposalId;
      await attach(rig.call, id);

      // Act: ask the same proposal to point somewhere else entirely.
      const elsewhere = join(rig.root, "elsewhere.txt");
      const after = stateOf(
        await rig.call("editor_update", { proposalId: id, path: elsewhere, content: "moved\n" }),
      );

      /*
       * Assert: the reviewed file and the written file must be the same file.
       * The only human-visible decision point is the client's prompt for
       * editor_commit, whose whole input is an opaque proposal id — so a
       * proposal that could be re-pointed after the diff was approved would
       * write a file nobody was shown.
       */
      expect(after.proposal.target.absolute).toBe(opened.proposal.target.absolute);
      await rig.call("editor_commit", { proposalId: id });
      expect(await readFile(target, "utf8")).toBe("moved\n");
      await expect(readFile(elsewhere, "utf8")).rejects.toThrow(/ENOENT/);
    });
  });

  describe("deletion", () => {
    it("needs an explicit acknowledgement before it removes anything", async () => {
      const target = join(rig.root, "doomed.txt");
      await writeFile(target, "still here\n", "utf8");

      const id = handleOf(await rig.call("propose_delete", { path: target })).proposalId;
      const opened = await peek(rig.call, id);

      expect(opened.findings.find((f) => f.id === "delete")?.severity).toBe("blocker");

      await attach(rig.call, id);
      await refusal(rig.call, "editor_commit", { proposalId: id }, /Refusing to write/);
      expect(await readFile(target, "utf8")).toBe("still here\n");

      await rig.call("editor_update", { proposalId: id, destructiveAcknowledged: true });
      await rig.call("editor_commit", { proposalId: id });
      await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
    });
  });

  describe("dry run", () => {
    it("runs the whole flow without touching disk", async () => {
      const dryRoot = await mkdtemp(join(tmpdir(), "interactive-editor-dry-"));
      const dryClient = await spawnServer(SERVER, [
        "--root",
        dryRoot,
        ...BLOCKING_ARGS,
        "--dry-run",
      ]);
      const target = join(dryRoot, "phantom.txt");
      try {
        const opened = (await dryClient.callTool({
          name: "propose_write",
          arguments: { path: target, content: "not real\n" },
        })) as CallToolResult;
        const id = (opened.structuredContent as unknown as ProposalHandle).proposalId;

        await dryClient.callTool({ name: "editor_attach", arguments: { proposalId: id } });
        const receipt = (await dryClient.callTool({
          name: "editor_commit",
          arguments: { proposalId: id },
        })) as CallToolResult;

        expect((receipt.structuredContent as unknown as CommitReceipt).dryRun).toBe(true);
        await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
      } finally {
        await dryClient.close();
        await rm(dryRoot, { recursive: true, force: true });
      }
    });
  });

  /**
   * The failure that matters most, because it is the one the marketing claim rests
   * on. `visibility: ["app"]` is a request to the host, not a guarantee: a host
   * that does not implement MCP Apps hands `editor_attach` to the agent too, so
   * `attached` alone is a flag the agent can set about itself. What it cannot
   * author is the capability its own client declared at initialize.
   */
  describe("a host that cannot render the panel", () => {
    it("refuses to commit, because nobody ever saw the diff", async () => {
      const blindRoot = await mkdtemp(join(tmpdir(), "interactive-editor-blind-"));
      const blind = await spawnServer(SERVER, ["--root", blindRoot, ...BLOCKING_ARGS], NO_PANEL);
      const target = join(blindRoot, "unseen.txt");
      try {
        const opened = (await blind.callTool({
          name: "propose_write",
          arguments: { path: target, content: "never reviewed\n" },
        })) as CallToolResult;
        const id = (opened.structuredContent as unknown as ProposalHandle).proposalId;

        // The agent can reach the app-only tool in such a host. That is the problem,
        // and marking itself attached must not be enough to get through the door.
        await blind.callTool({ name: "editor_attach", arguments: { proposalId: id } });
        const committed = (await blind.callTool({
          name: "editor_commit",
          arguments: { proposalId: id },
        })) as CallToolResult;

        expect(committed.isError, "a commit with no panel must be refused").toBe(true);
        expect(textOf(committed)).toMatch(/does not render MCP Apps/i);
        await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
      } finally {
        // Without this, a failed assertion above leaks a live server process.
        await blind.close();
        await rm(blindRoot, { recursive: true, force: true });
      }
    });

    it("writes anyway once --terminal-approval makes the client's prompt the gate", async () => {
      const optedIn = await mkdtemp(join(tmpdir(), "interactive-editor-terminal-"));
      const terminal = await spawnServer(
        SERVER,
        ["--root", optedIn, ...BLOCKING_ARGS, "--terminal-approval"],
        NO_PANEL,
      );
      const target = join(optedIn, "approved.txt");
      try {
        const opened = (await terminal.callTool({
          name: "propose_write",
          arguments: { path: target, content: "opted in\n" },
        })) as CallToolResult;
        const id = (opened.structuredContent as unknown as ProposalHandle).proposalId;

        await terminal.callTool({ name: "editor_attach", arguments: { proposalId: id } });
        await terminal.callTool({ name: "editor_commit", arguments: { proposalId: id } });

        expect(await readFile(target, "utf8")).toBe("opted in\n");
      } finally {
        await terminal.close();
        await rm(optedIn, { recursive: true, force: true });
      }
    });
  });
});
