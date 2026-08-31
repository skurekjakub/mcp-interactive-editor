import { afterAll, assert, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, ClientCapabilities, Tool } from "@modelcontextprotocol/sdk/types.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { CommitReceipt, EditorState, ProposalHandle } from "../../shared/types.js";

/**
 * Every test here runs twice: once against the compiled `dist/`, and once
 * against the flat tree that the `.mcpb` and the Claude Code plugin actually
 * execute. The two layouts differ on disk, and that difference already shipped a
 * panel that resolved to the wrong file and rendered nothing. If it only passes
 * for one of these, it is not passing.
 *
 * The bundle is run from a COPY outside the repository, and that is the entire
 * point of testing it.
 *
 * Run it in place and `../../dist/ui/index.html` resolves — from
 * `<repo>/bundle/server` up to `<repo>/dist/ui` — onto the real panel. That path
 * does not exist inside the shipped archive. So a server that had lost the flat
 * layout candidate would still satisfy every assertion here while the `.mcpb`
 * was broken, which is the packaging defect this parameterisation exists for.
 * Testing in place cannot see it;
 * only a copy with nothing above it can.
 */
const PACKED_ROOT = mkdtempSync(join(tmpdir(), "interactive-editor-packed-"));
cpSync(fileURLToPath(new URL("../../bundle/", import.meta.url)), PACKED_ROOT, { recursive: true });

afterAll(() => {
  rmSync(PACKED_ROOT, { recursive: true, force: true });
});

const ENTRY_POINTS = [
  ["dist", fileURLToPath(new URL("../../dist/src/server.js", import.meta.url))],
  ["the packed bundle", join(PACKED_ROOT, "server", "index.js")],
] as const;

describe.each(ENTRY_POINTS)("running from %s", (_label, SERVER) => {
  /**
   * What a host that actually renders MCP Apps declares at initialize. The commit
   * path asks for this, so the default test client has to look like a real host —
   * and the tests that check the refusal deliberately do not.
   */
  const RENDERS_PANEL = {
    extensions: { [EXTENSION_ID]: { mimeTypes: [RESOURCE_MIME_TYPE] } },
  } as unknown as ClientCapabilities;

  /** A terminal agent: every tool reaches the model, and no panel ever appears. */
  const NO_PANEL: ClientCapabilities = {};

  let root: string;
  let client: Client;

  async function connect(args: string[], capabilities = RENDERS_PANEL): Promise<Client> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      // An opening call now waits for the human, so the timings are pinned
      // small here: a test that never attaches a panel should fall straight
      // through the grace period rather than sit out the real four seconds.
      args: [
        SERVER,
        "--block-on-review",
        "--review-grace-ms",
        "250",
        "--review-timeout-ms",
        "4000",
        ...args,
      ],
      stderr: "ignore",
    });
    const connected = new Client({ name: "editor-tests", version: "1.0.0" }, { capabilities });
    await connected.connect(transport);
    return connected;
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "interactive-editor-"));
    client = await connect(["--root", root]);
  });

  afterAll(async () => {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  });

  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>;

  const state = (result: CallToolResult) => result.structuredContent as unknown as EditorState;
  const handle = (result: CallToolResult) => result.structuredContent as unknown as ProposalHandle;
  const text = (result: CallToolResult) =>
    (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");

  /** What the panel does on mount: trade the handle in for the state behind it. */
  const attach = async (proposalId: string) => state(await call("editor_attach", { proposalId }));

  /**
   * The same state without attaching, for the tests that must stay unattached. A
   * no-op update is what the panel sends anyway, so this exercises a real path.
   */
  const peek = async (proposalId: string) => state(await call("editor_update", { proposalId }));

  /**
   * A tool that throws comes back as `isError: true` with the reason in the text,
   * not as a protocol-level rejection — which is exactly what the panel reads,
   * so assert on the same shape the View does.
   */
  async function refusal(name: string, args: Record<string, unknown>, pattern: RegExp) {
    const result = await call(name, args);
    expect(result.isError, `${name} should have refused, got: ${text(result)}`).toBe(true);
    expect(text(result)).toMatch(pattern);
    return result;
  }

  async function openPanel(args: Record<string, unknown>): Promise<EditorState> {
    return peek(handle(await call("propose_write", args)).proposalId);
  }

  const uiMeta = (tool: Tool) =>
    (tool._meta as { ui?: { visibility?: string[]; resourceUri?: string } } | undefined)?.ui;

  describe("tool surface", () => {
    it("marks every writing tool app-only so the host keeps it away from the model", async () => {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((t) => [t.name, t]));

      for (const name of ["editor_commit", "editor_update", "editor_attach", "editor_discard"]) {
        expect(uiMeta(byName.get(name)!)?.visibility, `${name} must be app-only`).toEqual(["app"]);
      }

      for (const name of [
        "propose_write",
        "propose_delete",
        "open_file",
        "read_file",
        "list_roots",
      ]) {
        expect(uiMeta(byName.get(name)!)?.visibility, `${name} should reach the model`).toContain(
          "model",
        );
      }
    });

    it("points the editor-opening tools at the View", async () => {
      const { tools } = await client.listTools();
      for (const name of ["propose_write", "propose_delete", "open_file"]) {
        const tool = tools.find((t) => t.name === name)!;
        expect(uiMeta(tool)?.resourceUri).toBe("ui://interactive-editor/panel.html");
      }

      const { resources } = await client.listResources();
      expect(resources.some((r) => r.uri === "ui://interactive-editor/panel.html")).toBe(true);
    });

    it("serves the View as self-contained MCP App HTML", async () => {
      const read = await client.readResource({ uri: "ui://interactive-editor/panel.html" });
      const [content] = read.contents as Array<{ mimeType?: string; text?: string }>;

      expect(content.mimeType).toBe("text/html;profile=mcp-app");
      expect(content.text).toContain("<!doctype html>");
      expect(content.text ?? "", "an empty View is what a host reports as length 0").not.toBe("");
      expect((content.text ?? "").length).toBeGreaterThan(10_000);
      expect(content.text ?? "", "this is the source stub, not the built panel").not.toContain(
        "/src/main.tsx",
      );
      expect(content.text, "the View must not load external scripts").not.toMatch(
        /<script[^>]+src=["']http/i,
      );
    });

    /*
     * The spec builds the sandbox CSP from what `resources/read` returns, and
     * documents the listing entry as a fallback a server may not even publish.
     * Metadata that exists only on the listing rides on that fallback.
     */
    it("carries the sandbox metadata on the content item, not only the listing", async () => {
      // Act.
      const read = await client.readResource({ uri: "ui://interactive-editor/panel.html" });
      const [content] = read.contents as Array<{
        _meta?: { ui?: { csp?: Record<string, string[]>; prefersBorder?: boolean } };
      }>;

      // Assert.
      const ui = content._meta?.ui;
      expect(ui, "the read item must carry _meta.ui").toBeTruthy();
      expect(ui?.prefersBorder).toBe(true);
      expect(ui?.csp).toEqual({ connectDomains: [], resourceDomains: [], frameDomains: [] });
    });
  });

  describe("proposing", () => {
    it("does not touch disk", async () => {
      const target = join(root, "untouched.txt");
      await openPanel({ path: target, content: "hello\n" });
      await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
    });

    it("reports the diff and says nothing was written", async () => {
      const opened = await call("propose_write", {
        path: join(root, "greeting.txt"),
        content: "hello\n",
      });

      expect(text(opened)).toMatch(/nothing has been written/i);
      expect(text(opened)).toContain("+hello");
      expect(handle(opened).mode).toBe("create");
    });

    it("refuses a path outside the roots", async () => {
      const opened = await call("propose_write", {
        path: join(root, "..", "escape.txt"),
        content: "x",
      });
      expect(handle(opened).refused).toBe(true);

      const escaped = await peek(handle(opened).proposalId);
      expect(escaped.proposal.target.absolute).toBeNull();
      expect(escaped.findings.some((f) => f.rule === "path" && f.severity === "blocker")).toBe(
        true,
      );
    });

    it.each([".env", join(".git", "config"), "id_rsa"])("refuses %s", async (denied) => {
      const blocked = await openPanel({ path: join(root, denied), content: "x" });
      expect(blocked.proposal.target.absolute).toBeNull();
    });
  });

  /**
   * `structuredContent` is read by the panel *and* by the model, so whatever an
   * opening tool puts there is charged to the conversation on every proposal.
   * Returning the whole `EditorState` billed the file three times over — content,
   * originalContent and baseline — which is what these pin down.
   */
  describe("what the opening tools cost the model", () => {
    it("hands back a handle, not the file", async () => {
      const target = join(root, "budget.txt");
      const onDisk = `${Array.from({ length: 30 }, (_, i) => `existing line ${i}`).join("\n")}\n`;
      await writeFile(target, onDisk, "utf8");

      const opened = await call("propose_write", { path: target, content: `${onDisk}appended\n` });

      const keys = Object.keys(opened.structuredContent!).sort();
      expect(keys).toEqual(["display", "mode", "proposalId"]);
      expect(JSON.stringify(opened.structuredContent)).not.toContain("existing line 0");
    });

    it("still gives the panel everything, on attach", async () => {
      const target = join(root, "attach-gets-it-all.txt");
      await writeFile(target, "on disk\n", "utf8");

      const opened = await call("propose_write", { path: target, content: "proposed\n" });
      const attached = await attach(handle(opened).proposalId);

      expect(attached.proposal.baseline).toBe("on disk\n");
      expect(attached.proposal.content).toBe("proposed\n");
      expect(attached.diff.length).toBeGreaterThan(0);
    });

    it("caps the diff it prints back at the model", async () => {
      const body = `${Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n")}\n`;
      const opened = await call("propose_write", {
        path: join(root, "enormous.txt"),
        content: body,
      });
      const printed = text(opened);

      expect(printed.split("\n").length).toBeLessThan(120);
      expect(printed).toMatch(/more diff lines/);
      expect(printed, "the head of the diff is still there").toContain("+line 0");
      expect(printed, "the tail is not").not.toContain("+line 499");
    });

    it("says nothing about the file when the panel talks to itself", async () => {
      const target = join(root, "panel-chatter.txt");
      const opened = await call("propose_write", { path: target, content: "quiet\n" });
      const id = handle(opened).proposalId;

      expect(text(await call("editor_attach", { proposalId: id }))).not.toContain("quiet");
      expect(text(await call("editor_update", { proposalId: id, content: "still quiet\n" }))).toBe(
        "Updated.",
      );
    });
  });

  describe("opening a file to read and edit", () => {
    it("loads the current contents into the editor without writing", async () => {
      const target = join(root, "readme-me.txt");
      await writeFile(target, "on disk\n", "utf8");

      const opened = await peek(handle(await call("open_file", { path: target })).proposalId);

      expect(opened.proposal.content).toBe("on disk\n");
      expect(opened.proposal.baseline).toBe("on disk\n");
      expect(opened.diff, "an untouched file has no diff").toEqual([]);
      expect(opened.proposal.mode).toBe("overwrite");
    });

    it("keeps the file body out of the whole result, not just the text half", async () => {
      const target = join(root, "private-ish.txt");
      await writeFile(target, "sentinel-contents-do-not-leak\n", "utf8");

      const opened = await call("open_file", { path: target });

      expect(text(opened)).not.toContain("sentinel-contents-do-not-leak");
      expect(
        JSON.stringify(opened.structuredContent),
        "structuredContent reaches the model too",
      ).not.toContain("sentinel-contents-do-not-leak");
      expect(text(opened)).toMatch(/Opened .* in the interactive editor/);
      expect(text(opened)).toMatch(/read_file/);
    });

    it("saves what the human typed over the loaded contents", async () => {
      const target = join(root, "opened-then-edited.txt");
      await writeFile(target, "before\n", "utf8");

      const id = handle(await call("open_file", { path: target })).proposalId;

      await attach(id);
      await call("editor_update", { proposalId: id, content: "after\n" });
      const receipt = state(
        await call("editor_commit", { proposalId: id }),
      ) as unknown as CommitReceipt;

      expect(receipt.editedByHuman).toBe(true);
      expect(await readFile(target, "utf8")).toBe("after\n");
    });

    it("refuses to open something outside the roots", async () => {
      const opened = await call("open_file", { path: join(root, "..", "nope.txt") });
      expect(handle(opened).refused).toBe(true);
      expect((await peek(handle(opened).proposalId)).proposal.target.absolute).toBeNull();
    });
  });

  describe("committing", () => {
    it("refuses to commit a proposal no View ever attached to", async () => {
      const opened = await openPanel({ path: join(root, "unattached.txt"), content: "nope\n" });
      await refusal(
        "editor_commit",
        { proposalId: opened.proposal.proposalId },
        /never opened in the editor/i,
      );
    });

    it("writes the file once the View attaches and commits", async () => {
      const target = join(root, "nested", "created.txt");
      const opened = await openPanel({ path: target, content: "first line\n" });
      const id = opened.proposal.proposalId;

      await attach(id);
      const receipt = state(
        await call("editor_commit", { proposalId: id }),
      ) as unknown as CommitReceipt;

      expect(receipt.ok).toBe(true);
      expect(receipt.editedByHuman).toBe(false);
      expect(await readFile(target, "utf8")).toBe("first line\n");
    });

    it("commits what the human edited, not what the model proposed", async () => {
      const target = join(root, "edited.txt");
      const opened = await openPanel({ path: target, content: "model wrote this\n" });
      const id = opened.proposal.proposalId;

      await attach(id);
      await call("editor_update", { proposalId: id, content: "the human wrote this instead\n" });
      const receipt = state(
        await call("editor_commit", { proposalId: id }),
      ) as unknown as CommitReceipt;

      expect(receipt.editedByHuman).toBe(true);
      expect(await readFile(target, "utf8")).toBe("the human wrote this instead\n");
    });

    it("will not commit the same proposal twice", async () => {
      const opened = await openPanel({ path: join(root, "once.txt"), content: "once\n" });
      const id = opened.proposal.proposalId;

      await attach(id);
      await call("editor_commit", { proposalId: id });
      await refusal(
        "editor_commit",
        { proposalId: id },
        /was already (committed|discarded|changes-requested|superseded)/i,
      );
    });

    it("does not know about proposals from a previous run", async () => {
      await refusal(
        "editor_attach",
        { proposalId: "00000000-0000-0000-0000-000000000000" },
        /Unknown proposal/,
      );
    });
  });

  describe("guarding the one-way door", () => {
    it("blocks a write that removes most of a file until it is acknowledged", async () => {
      const target = join(root, "big.txt");
      const original = `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")}\n`;
      await writeFile(target, original, "utf8");

      const opened = await openPanel({ path: target, content: "line 0\n" });
      const id = opened.proposal.proposalId;

      const blocker = opened.findings.find((f) => f.id === "large-deletion");
      assert(blocker, "expected a large-deletion finding");
      expect(blocker.severity).toBe("blocker");

      await attach(id);
      await refusal("editor_commit", { proposalId: id }, /Refusing to write/);
      expect(await readFile(target, "utf8"), "nothing may land while blocked").toBe(original);

      await call("editor_update", { proposalId: id, destructiveAcknowledged: true });
      const receipt = state(
        await call("editor_commit", { proposalId: id }),
      ) as unknown as CommitReceipt;

      expect(receipt.ok).toBe(true);
      expect(await readFile(target, "utf8")).toBe("line 0\n");
    });

    it("refuses to commit when the file changed while the editor was open", async () => {
      const target = join(root, "raced.txt");
      await writeFile(target, "original\n", "utf8");

      const opened = await openPanel({ path: target, content: "proposed\n" });
      const id = opened.proposal.proposalId;
      await attach(id);

      await writeFile(target, "somebody else got here first\n", "utf8");

      await refusal("editor_commit", { proposalId: id }, /changed on disk/i);
      expect(await readFile(target, "utf8")).toBe("somebody else got here first\n");
    });

    it("will not let an update move the proposal to another file", async () => {
      // Arrange: a proposal against a file the human has been shown.
      const target = join(root, "movable.txt");
      const opened = await openPanel({ path: target, content: "content\n" });
      const id = opened.proposal.proposalId;
      await attach(id);

      // Act: ask the same proposal to point somewhere else entirely.
      const elsewhere = join(root, "elsewhere.txt");
      const after = state(
        await call("editor_update", { proposalId: id, path: elsewhere, content: "moved\n" }),
      );

      /*
       * Assert: the reviewed file and the written file must be the same file.
       * The only human-visible decision point is the client's prompt for
       * editor_commit, whose whole input is an opaque proposal id — so a
       * proposal that could be re-pointed after the diff was approved would
       * write a file nobody was shown.
       */
      expect(after.proposal.target.absolute).toBe(opened.proposal.target.absolute);
      await call("editor_commit", { proposalId: id });
      expect(await readFile(target, "utf8")).toBe("moved\n");
      await expect(readFile(elsewhere, "utf8")).rejects.toThrow(/ENOENT/);
    });
  });

  describe("deletion", () => {
    it("needs an explicit acknowledgement before it removes anything", async () => {
      const target = join(root, "doomed.txt");
      await writeFile(target, "still here\n", "utf8");

      const id = handle(await call("propose_delete", { path: target })).proposalId;
      const opened = await peek(id);

      expect(opened.findings.find((f) => f.id === "delete")?.severity).toBe("blocker");

      await attach(id);
      await refusal("editor_commit", { proposalId: id }, /Refusing to write/);
      expect(await readFile(target, "utf8")).toBe("still here\n");

      await call("editor_update", { proposalId: id, destructiveAcknowledged: true });
      await call("editor_commit", { proposalId: id });
      await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
    });
  });

  describe("reading", () => {
    it("reads inside the roots and refuses outside them", async () => {
      const target = join(root, "readable.txt");
      await writeFile(target, "readable\n", "utf8");

      expect(text(await call("read_file", { path: target }))).toBe("readable\n");
      expect((await call("read_file", { path: join(root, "..", "secret.txt") })).isError).toBe(
        true,
      );
    });

    it("lists its roots", async () => {
      const listed = await call("list_roots", {});
      expect((listed.structuredContent as { roots: string[] }).roots).toEqual([root]);
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
      const blind = await connect(["--root", blindRoot], NO_PANEL);
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
        expect(text(committed)).toMatch(/does not render MCP Apps/i);
        await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
      } finally {
        // Without this, a failed assertion above leaks a live server process.
        await blind.close();
        await rm(blindRoot, { recursive: true, force: true });
      }
    });

    it("writes anyway once --terminal-approval makes the client's prompt the gate", async () => {
      const optedIn = await mkdtemp(join(tmpdir(), "interactive-editor-terminal-"));
      const terminal = await connect(["--root", optedIn, "--terminal-approval"], NO_PANEL);
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

  /**
   * The gate. `propose_write` does not return when the panel opens, it returns
   * what happened in it — so the agent learns its draft was rejected in the
   * result of the call it already made, rather than in a message someone has to
   * tell it to go and read.
   *
   * These drive it the way the panel does: start the call, do not await it,
   * claim the proposal, act, then see what the call became.
   */
  describe("the review gate", () => {
    /*
     * Its own server, because the grace period pulls two ways.
     *
     * Everywhere else it is pinned small so a test that never attaches a panel
     * falls straight through instead of sitting out the real wait. Here a panel
     * does attach, and it has to win a race against that same timer: claiming
     * costs several round trips to a child process, and a grace that expires
     * first resolves the review as unanswered before anyone can answer it.
     * One knob, two opposite requirements.
     */
    let gateRoot: string;
    let gate: Client;

    beforeAll(async () => {
      gateRoot = await mkdtemp(join(tmpdir(), "interactive-editor-gate-"));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          SERVER,
          "--root",
          gateRoot,
          "--block-on-review",
          "--review-grace-ms",
          "10000",
          "--review-timeout-ms",
          "15000",
        ],
        stderr: "ignore",
      });
      gate = new Client(
        { name: "editor-tests", version: "1.0.0" },
        { capabilities: RENDERS_PANEL },
      );
      await gate.connect(transport);
    });

    afterAll(async () => {
      await gate?.close();
      await rm(gateRoot, { recursive: true, force: true });
    });

    const gateCall = (name: string, args: Record<string, unknown> = {}) =>
      gate.callTool({ name, arguments: args }) as Promise<CallToolResult>;

    /**
     * What the panel does on mount, before any result carrying an id exists.
     * Retried, because the panel is racing the tool call that created it — the
     * host mounts the View on the call, not on the proposal being ready.
     */
    const claim = async (path: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const found = await gateCall("editor_pending", { path });
        const payload = found.structuredContent as unknown as EditorState | undefined;
        if (payload?.proposal) return payload.proposal.proposalId;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error(`no proposal ever opened for ${path}`);
    };

    it("commenting rejects the draft and hands the words back to the agent", async () => {
      const target = join(gateRoot, "redraft-me.txt");
      const opening = gateCall("propose_write", { path: target, content: "first attempt\n" });

      const id = await claim(target);
      await gateCall("editor_attach", { proposalId: id });
      await gateCall("editor_request_changes", {
        proposalId: id,
        message: "line 1: too terse, say why it exists",
      });

      const result = await opening;

      expect(text(result)).toMatch(/asked for changes/i);
      expect(text(result)).toContain("too terse, say why it exists");
      expect(text(result), "the agent must be told to redraft").toMatch(/redraft/i);
      expect(
        (result.structuredContent as { outcome?: string })?.outcome,
        "a rejection must not read as a receipt",
      ).toBe("changes-requested");
      await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
    });

    it("accepting without comment commits, and the call returns the receipt", async () => {
      const target = join(gateRoot, "accepted.txt");
      const opening = gateCall("propose_write", {
        path: target,
        content: "accepted as proposed\n",
      });

      const id = await claim(target);
      await gateCall("editor_attach", { proposalId: id });
      await gateCall("editor_commit", { proposalId: id });

      const result = await opening;

      expect(text(result)).toMatch(/^Wrote /);
      expect((result.structuredContent as unknown as CommitReceipt).ok).toBe(true);
      expect(await readFile(target, "utf8")).toBe("accepted as proposed\n");
    });

    it("discarding ends the call too, so nothing is left hanging", async () => {
      const target = join(gateRoot, "thrown-away.txt");
      const opening = gateCall("propose_write", { path: target, content: "nope\n" });

      const id = await claim(target);
      await gateCall("editor_attach", { proposalId: id });
      await gateCall("editor_discard", { proposalId: id, reason: "wrong file" });

      const result = await opening;

      expect(text(result)).toMatch(/discarded/i);
      expect(text(result)).toContain("wrong file");
      await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
    });

    it("a rejected proposal cannot then be committed by a stale panel", async () => {
      const target = join(gateRoot, "rejected-then-committed.txt");
      const opening = gateCall("propose_write", { path: target, content: "should never land\n" });

      const id = await claim(target);
      await gateCall("editor_attach", { proposalId: id });
      await gateCall("editor_request_changes", { proposalId: id, message: "no" });
      await opening;

      const late = await gateCall("editor_commit", { proposalId: id });
      expect(late.isError, `a stale commit should have been refused, got: ${text(late)}`).toBe(
        true,
      );
      expect(text(late)).toMatch(/was already (committed|discarded|changes-requested|superseded)/i);
      await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);
    });

    it("returns the diff instead of hanging when no panel ever attaches", async () => {
      // The host said it renders MCP Apps; no View turned up. That is a promise
      // broken by the host, and it must not cost the agent a ten minute stall.
      const opened = await call("propose_write", {
        path: join(root, "no-panel-came.txt"),
        content: "still useful as text\n",
      });

      expect(text(opened)).toMatch(/nothing has been written/i);
      expect(text(opened)).toContain("+still useful as text");
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
      const first = join(root, "claimable-one.txt");
      const second = join(root, "claimable-two.txt");
      await call("propose_write", { path: first, content: "one\n" });
      await call("propose_write", { path: second, content: "two\n" });

      const answer = await call("editor_pending", { path: join(root, "not-a-real-file.txt") });
      const payload = answer.structuredContent as { open: boolean; openPaths?: string[] };

      expect(payload.open).toBe(false);
      expect(payload.openPaths, "it must report what it does have").toEqual(
        expect.arrayContaining([first, second]),
      );
      expect(text(answer)).toMatch(/no open proposal matches/i);
    });

    it("hands over the proposal when the path does match", async () => {
      const target = join(root, "claim-by-path.txt");
      await call("propose_write", { path: target, content: "two\n" });

      const claimed = await call("editor_pending", { path: target });
      expect(state(claimed).proposal.target.requested).toBe(target);
    });
  });

  describe("dry run", () => {
    it("runs the whole flow without touching disk", async () => {
      const dryRoot = await mkdtemp(join(tmpdir(), "interactive-editor-dry-"));
      const dryClient = await connect(["--root", dryRoot, "--dry-run"]);
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

  /*
   * Every test above runs with --block-on-review, which no shipped
   * configuration passes: neither the plugin manifest nor the `.mcpb` sets it.
   * The default is the opposite, so without this block the mode that every
   * install actually runs has no end-to-end coverage at all.
   */
  describe("the shipped default, which does not block", () => {
    let plainRoot: string;
    let plain: Client;

    beforeAll(async () => {
      plainRoot = await mkdtemp(join(tmpdir(), "interactive-editor-plain-"));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [SERVER, "--root", plainRoot],
        stderr: "ignore",
      });
      plain = new Client(
        { name: "editor-tests", version: "1.0.0" },
        { capabilities: RENDERS_PANEL },
      );
      await plain.connect(transport);
    });

    afterAll(async () => {
      await plain?.close();
      await rm(plainRoot, { recursive: true, force: true });
    });

    const plainCall = (name: string, args: Record<string, unknown> = {}) =>
      plain.callTool({ name, arguments: args }) as Promise<CallToolResult>;

    it("returns the diff promptly instead of waiting for a human", async () => {
      // Arrange.
      const started = Date.now();

      // Act.
      const opened = await plainCall("propose_write", {
        path: join(plainRoot, "prompt.txt"),
        content: "hello\n",
      });

      // Assert: the wait is opt-in, so this must not sit out any grace period.
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(text(opened)).toMatch(/Editor open/);
      expect(opened.isError).toBeFalsy();
    });

    it("describes itself to the model as non-blocking", async () => {
      // Assert: a description promising to wait, on a server that returns
      // immediately, tells the model its next observation is a verdict when it
      // is a diff.
      const { tools } = await plain.listTools();
      const description = tools.find((t) => t.name === "propose_write")?.description ?? "";

      expect(description).toMatch(/returns as soon as the panel is open/i);
      expect(description).not.toMatch(/does not return until/i);
    });

    it("reports that comments had nowhere to go, rather than claiming delivery", async () => {
      // Arrange.
      const opened = await plainCall("propose_write", {
        path: join(plainRoot, "commented.txt"),
        content: "draft\n",
      });
      const id = (opened.structuredContent as unknown as ProposalHandle).proposalId;
      await plainCall("editor_attach", { proposalId: id });

      // Act.
      const sent = await plainCall("editor_request_changes", {
        proposalId: id,
        message: "not like that",
      });

      /*
       * Assert: nothing was waiting on the review, so the panel has to be told
       * to deliver the words itself. Claiming delivery here loses them.
       */
      expect((sent.structuredContent as { delivered?: boolean }).delivered).toBe(false);
      await expect(readFile(join(plainRoot, "commented.txt"), "utf8")).rejects.toThrow(/ENOENT/);
    });

    it("still refuses a commit that no panel ever attached to", async () => {
      // Arrange.
      const opened = await plainCall("propose_write", {
        path: join(plainRoot, "unattached.txt"),
        content: "should not land\n",
      });
      const id = (opened.structuredContent as unknown as ProposalHandle).proposalId;

      // Act.
      const result = await plainCall("editor_commit", { proposalId: id });

      // Assert.
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/never opened in the editor/i);
    });

    it("reports its own version, so an install can be confirmed", async () => {
      // Assert: without this there is no way to tell which build is answering.
      const roots = await plainCall("list_roots");
      const reported = roots.structuredContent as { serverVersion?: string };
      expect(reported.serverVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(reported).toMatchObject({ rendersPanel: true, blockOnReview: false });
    });
  });
});
