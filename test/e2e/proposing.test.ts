import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommitReceipt } from "../../shared/types.js";
import {
  ENTRY_POINTS,
  attach,
  handleOf,
  openPanel,
  peek,
  stateOf,
  textOf,
  useServer,
} from "./harness.js";

describe.each(ENTRY_POINTS)("proposing, running from %s", (_label, SERVER) => {
  const rig = useServer(SERVER);

  describe("a write", () => {
    it("does not touch disk", async () => {
      const target = join(rig.root, "untouched.txt");
      await openPanel(rig.call, { path: target, content: "hello\n" });
      await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
    });

    it("reports the diff and says nothing was written", async () => {
      const opened = await rig.call("propose_write", {
        path: join(rig.root, "greeting.txt"),
        content: "hello\n",
      });

      expect(textOf(opened)).toMatch(/nothing has been written/i);
      expect(textOf(opened)).toContain("+hello");
      expect(handleOf(opened).mode).toBe("create");
    });

    it("refuses a path outside the roots", async () => {
      const opened = await rig.call("propose_write", {
        path: join(rig.root, "..", "escape.txt"),
        content: "x",
      });
      expect(handleOf(opened).refused).toBe(true);

      const escaped = await peek(rig.call, handleOf(opened).proposalId);
      expect(escaped.proposal.target.absolute).toBeNull();
      expect(escaped.findings.some((f) => f.rule === "path" && f.severity === "blocker")).toBe(
        true,
      );
    });

    it.each([".env", join(".git", "config"), "id_rsa"])("refuses %s", async (denied) => {
      const blocked = await openPanel(rig.call, { path: join(rig.root, denied), content: "x" });
      expect(blocked.proposal.target.absolute).toBeNull();
    });
  });

  /**
   * `structuredContent` is read by the panel *and* by the model, so whatever an
   * opening tool puts there is charged to the conversation on every proposal.
   * Returning the whole `EditorState` bills the file three times over — content,
   * originalContent and baseline — which is what these pin down.
   */
  describe("what the opening tools cost the model", () => {
    it("hands back a handle, not the file", async () => {
      const target = join(rig.root, "budget.txt");
      const onDisk = `${Array.from({ length: 30 }, (_, i) => `existing line ${i}`).join("\n")}\n`;
      await writeFile(target, onDisk, "utf8");

      const opened = await rig.call("propose_write", {
        path: target,
        content: `${onDisk}appended\n`,
      });

      const keys = Object.keys(opened.structuredContent!).sort();
      expect(keys).toEqual(["display", "mode", "proposalId"]);
      expect(JSON.stringify(opened.structuredContent)).not.toContain("existing line 0");
    });

    it("still gives the panel everything, on attach", async () => {
      const target = join(rig.root, "attach-gets-it-all.txt");
      await writeFile(target, "on disk\n", "utf8");

      const opened = await rig.call("propose_write", { path: target, content: "proposed\n" });
      const attached = await attach(rig.call, handleOf(opened).proposalId);

      expect(attached.proposal.baseline).toBe("on disk\n");
      expect(attached.proposal.content).toBe("proposed\n");
      expect(attached.diff.length).toBeGreaterThan(0);
    });

    it("caps the diff it prints back at the model", async () => {
      const body = `${Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n")}\n`;
      const opened = await rig.call("propose_write", {
        path: join(rig.root, "enormous.txt"),
        content: body,
      });
      const printed = textOf(opened);

      expect(printed.split("\n").length).toBeLessThan(120);
      expect(printed).toMatch(/more diff lines/);
      expect(printed, "the head of the diff is still there").toContain("+line 0");
      expect(printed, "the tail is not").not.toContain("+line 499");
    });

    it("says nothing about the file when the panel talks to itself", async () => {
      const target = join(rig.root, "panel-chatter.txt");
      const opened = await rig.call("propose_write", { path: target, content: "quiet\n" });
      const id = handleOf(opened).proposalId;

      expect(textOf(await rig.call("editor_attach", { proposalId: id }))).not.toContain("quiet");
      expect(
        textOf(await rig.call("editor_update", { proposalId: id, content: "still quiet\n" })),
      ).toBe("Updated.");
    });
  });

  describe("opening a file to read and edit", () => {
    it("loads the current contents into the editor without writing", async () => {
      const target = join(rig.root, "readme-me.txt");
      await writeFile(target, "on disk\n", "utf8");

      const opened = await peek(
        rig.call,
        handleOf(await rig.call("open_file", { path: target })).proposalId,
      );

      expect(opened.proposal.content).toBe("on disk\n");
      expect(opened.proposal.baseline).toBe("on disk\n");
      expect(opened.diff, "an untouched file has no diff").toEqual([]);
      expect(opened.proposal.mode).toBe("overwrite");
    });

    it("keeps the file body out of the whole result, not just the text half", async () => {
      const target = join(rig.root, "private-ish.txt");
      await writeFile(target, "sentinel-contents-do-not-leak\n", "utf8");

      const opened = await rig.call("open_file", { path: target });

      expect(textOf(opened)).not.toContain("sentinel-contents-do-not-leak");
      expect(
        JSON.stringify(opened.structuredContent),
        "structuredContent reaches the model too",
      ).not.toContain("sentinel-contents-do-not-leak");
      expect(textOf(opened)).toMatch(/Opened .* in the interactive editor/);
      expect(textOf(opened)).toMatch(/read_file/);
    });

    it("saves what the human typed over the loaded contents", async () => {
      const target = join(rig.root, "opened-then-edited.txt");
      await writeFile(target, "before\n", "utf8");

      const id = handleOf(await rig.call("open_file", { path: target })).proposalId;

      await attach(rig.call, id);
      await rig.call("editor_update", { proposalId: id, content: "after\n" });
      const receipt = stateOf(
        await rig.call("editor_commit", { proposalId: id }),
      ) as unknown as CommitReceipt;

      expect(receipt.editedByHuman).toBe(true);
      expect(await readFile(target, "utf8")).toBe("after\n");
    });

    it("refuses to open something outside the roots", async () => {
      const opened = await rig.call("open_file", { path: join(rig.root, "..", "nope.txt") });
      expect(handleOf(opened).refused).toBe(true);
      expect(
        (await peek(rig.call, handleOf(opened).proposalId)).proposal.target.absolute,
      ).toBeNull();
    });
  });

  describe("reading", () => {
    it("reads inside the roots and refuses outside them", async () => {
      const target = join(rig.root, "readable.txt");
      await writeFile(target, "readable\n", "utf8");

      expect(textOf(await rig.call("read_file", { path: target }))).toBe("readable\n");
      expect(
        (await rig.call("read_file", { path: join(rig.root, "..", "secret.txt") })).isError,
      ).toBe(true);
    });

    it("lists its roots", async () => {
      const listed = await rig.call("list_roots", {});
      expect((listed.structuredContent as { roots: string[] }).roots).toEqual([rig.root]);
    });
  });

  describe("claiming a proposal from the panel", () => {
    it("says what it has open when nothing matches, rather than a bare no", async () => {
      /*
       * "No proposal is open" is true both when the panel asked too early and
       * when several are open and none matched the path the host handed back.
       * Those want opposite responses, so the answer has to tell them apart.
       *
       * Two proposals, because a lone one is handed over whatever path is asked
       * for. Opening one and relying on earlier tests to have left others behind
       * makes this pass only in a full run, and only in one order.
       */
      const first = join(rig.root, "claimable-one.txt");
      const second = join(rig.root, "claimable-two.txt");
      await rig.call("propose_write", { path: first, content: "one\n" });
      await rig.call("propose_write", { path: second, content: "two\n" });

      const answer = await rig.call("editor_pending", {
        path: join(rig.root, "not-a-real-file.txt"),
      });
      const payload = answer.structuredContent as { open: boolean; openPaths?: string[] };

      expect(payload.open).toBe(false);
      expect(payload.openPaths, "it must report what it does have").toEqual(
        expect.arrayContaining([first, second]),
      );
      expect(textOf(answer)).toMatch(/no open proposal matches/i);
    });

    it("hands over the proposal when the path does match", async () => {
      const target = join(rig.root, "claim-by-path.txt");
      await rig.call("propose_write", { path: target, content: "two\n" });

      const claimed = await rig.call("editor_pending", { path: target });
      expect(stateOf(claimed).proposal.target.requested).toBe(target);
    });
  });
});
