import { afterAll, assert, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { CommitReceipt, EditorState } from "../../shared/types.js";

const SERVER = fileURLToPath(new URL("../../dist/src/server.js", import.meta.url));

let root: string;
let client: Client;

async function connect(args: string[]): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER, ...args],
    stderr: "ignore",
  });
  const connected = new Client({ name: "editor-tests", version: "1.0.0" }, { capabilities: {} });
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
const text = (result: CallToolResult) =>
  (result.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("\n");

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
  return state(await call("propose_write", args));
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
    expect(content.text, "the View must not load external scripts").not.toMatch(
      /<script[^>]+src=["']http/i,
    );
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
    expect(state(opened).proposal.mode).toBe("create");
  });

  it("refuses a path outside the roots", async () => {
    const escaped = await openPanel({ path: join(root, "..", "escape.txt"), content: "x" });
    expect(escaped.proposal.target.absolute).toBeNull();
    expect(escaped.findings.some((f) => f.rule === "path" && f.severity === "blocker")).toBe(true);
  });

  it.each([".env", join(".git", "config"), "id_rsa"])("refuses %s", async (denied) => {
    const blocked = await openPanel({ path: join(root, denied), content: "x" });
    expect(blocked.proposal.target.absolute).toBeNull();
  });
});

describe("opening a file to read and edit", () => {
  it("loads the current contents into the editor without writing", async () => {
    const target = join(root, "readme-me.txt");
    await writeFile(target, "on disk\n", "utf8");

    const opened = state(await call("open_file", { path: target }));

    expect(opened.proposal.content).toBe("on disk\n");
    expect(opened.proposal.baseline).toBe("on disk\n");
    expect(opened.diff, "an untouched file has no diff").toEqual([]);
    expect(opened.proposal.mode).toBe("overwrite");
  });

  it("keeps the file body out of the model's half of the result", async () => {
    const target = join(root, "private-ish.txt");
    await writeFile(target, "sentinel-contents-do-not-leak\n", "utf8");

    const opened = await call("open_file", { path: target });

    expect(text(opened)).not.toContain("sentinel-contents-do-not-leak");
    expect(text(opened)).toMatch(/Opened .* in the interactive editor/);
    expect(text(opened)).toMatch(/read_file/);
  });

  it("saves what the human typed over the loaded contents", async () => {
    const target = join(root, "opened-then-edited.txt");
    await writeFile(target, "before\n", "utf8");

    const opened = state(await call("open_file", { path: target }));
    const id = opened.proposal.proposalId;

    await call("editor_attach", { proposalId: id });
    await call("editor_update", { proposalId: id, content: "after\n" });
    const receipt = state(
      await call("editor_commit", { proposalId: id }),
    ) as unknown as CommitReceipt;

    expect(receipt.editedByHuman).toBe(true);
    expect(await readFile(target, "utf8")).toBe("after\n");
  });

  it("refuses to open something outside the roots", async () => {
    const opened = state(await call("open_file", { path: join(root, "..", "nope.txt") }));
    expect(opened.proposal.target.absolute).toBeNull();
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

    await call("editor_attach", { proposalId: id });
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

    await call("editor_attach", { proposalId: id });
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

    await call("editor_attach", { proposalId: id });
    await call("editor_commit", { proposalId: id });
    await refusal("editor_commit", { proposalId: id }, /already been resolved/i);
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

    await call("editor_attach", { proposalId: id });
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
    await call("editor_attach", { proposalId: id });

    await writeFile(target, "somebody else got here first\n", "utf8");

    await refusal("editor_commit", { proposalId: id }, /changed on disk/i);
    expect(await readFile(target, "utf8")).toBe("somebody else got here first\n");
  });

  it("blocks a retarget that lands outside the roots", async () => {
    const opened = await openPanel({ path: join(root, "movable.txt"), content: "content\n" });
    const id = opened.proposal.proposalId;
    await call("editor_attach", { proposalId: id });

    const retargeted = state(
      await call("editor_update", { proposalId: id, path: join(root, "..", "elsewhere.txt") }),
    );

    expect(retargeted.proposal.target.absolute).toBeNull();
    await refusal("editor_commit", { proposalId: id }, /not a writable path|Refusing to write/);
  });
});

describe("deletion", () => {
  it("needs an explicit acknowledgement before it removes anything", async () => {
    const target = join(root, "doomed.txt");
    await writeFile(target, "still here\n", "utf8");

    const opened = state(await call("propose_delete", { path: target }));
    const id = opened.proposal.proposalId;

    expect(opened.findings.find((f) => f.id === "delete")?.severity).toBe("blocker");

    await call("editor_attach", { proposalId: id });
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
    expect((await call("read_file", { path: join(root, "..", "secret.txt") })).isError).toBe(true);
  });

  it("lists its roots", async () => {
    const listed = await call("list_roots", {});
    expect((listed.structuredContent as { roots: string[] }).roots).toEqual([root]);
  });
});

describe("dry run", () => {
  it("runs the whole flow without touching disk", async () => {
    const dryRoot = await mkdtemp(join(tmpdir(), "interactive-editor-dry-"));
    const dryClient = await connect(["--root", dryRoot, "--dry-run"]);
    const target = join(dryRoot, "phantom.txt");

    const opened = (await dryClient.callTool({
      name: "propose_write",
      arguments: { path: target, content: "not real\n" },
    })) as CallToolResult;
    const id = (opened.structuredContent as unknown as EditorState).proposal.proposalId;

    await dryClient.callTool({ name: "editor_attach", arguments: { proposalId: id } });
    const receipt = (await dryClient.callTool({
      name: "editor_commit",
      arguments: { proposalId: id },
    })) as CallToolResult;

    expect((receipt.structuredContent as unknown as CommitReceipt).dryRun).toBe(true);
    await expect(readFile(target, "utf8")).rejects.toThrow(/ENOENT/);

    await dryClient.close();
    await rm(dryRoot, { recursive: true, force: true });
  });
});
