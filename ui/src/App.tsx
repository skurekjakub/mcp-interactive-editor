import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp, useHostStyleVariables } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  CommitReceipt,
  EditorState,
  Finding,
  Proposal,
  ProposalHandle,
} from "../../shared/types.js";
import { diffLines } from "../../shared/diff.js";
import { hasBlockers, lintProposal } from "../../shared/lint.js";
import {
  attachPassage,
  describePassages,
  quotePassages,
  type Passage,
} from "../../shared/passages.js";
import { IS_PREVIEW, hostBridge, previewBridge, previewState, type Bridge } from "./bridge.js";
import { Editor } from "./components/Editor.js";
import { DiffPane } from "./components/DiffPane.js";
import { Findings } from "./components/Findings.js";
import { SelectionBar } from "./components/SelectionBar.js";

type View = "split" | "edit" | "diff";

/** The openers send a handle, the panel's own calls send full state. Accept either. */
type OpeningPayload = Partial<ProposalHandle> & Partial<EditorState>;

const PUSH_DEBOUNCE_MS = 500;

export function App() {
  const [state, setState] = useState<EditorState | null>(null);
  const [handle, setHandle] = useState<ProposalHandle | null>(null);
  const [content, setContent] = useState("");
  const [ack, setAck] = useState(false);
  const [view, setView] = useState<View>("split");
  const [receipt, setReceipt] = useState<CommitReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<Passage | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  // Only the first state to arrive fills the edit buffer. A later one must not:
  // by then the human may have typed, and their draft outranks a re-attach.
  const adopted = useRef(false);

  const adopt = useCallback((next: EditorState | undefined) => {
    if (!next?.proposal) return;
    setState(next);
    if (adopted.current) return;
    adopted.current = true;
    setContent(next.proposal.content);
    setAck(next.proposal.destructiveAcknowledged);
  }, []);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "interactive-editor", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (instance) => {
      // The host hands us the opening tool's result, and that result is a claim
      // ticket rather than the proposal — `structuredContent` goes to the model
      // as well as to us, and the file has no business being in its context
      // three times over. The bytes arrive on attach, below.
      instance.ontoolresult = (result) => {
        const payload = result.structuredContent as unknown as OpeningPayload | undefined;
        if (!payload) return;
        if (payload.proposal) adopt(payload as EditorState);
        else if (payload.proposalId) setHandle(payload as ProposalHandle);
      };
    },
  });

  useHostStyleVariables(app);

  const bridge: Bridge | null = useMemo(() => {
    if (IS_PREVIEW) return previewBridge();
    return app ? hostBridge(app) : null;
  }, [app]);

  // Preview runs the View in a plain browser tab with fixture data, so the
  // layout can be worked on without a host in the loop.
  useEffect(() => {
    if (IS_PREVIEW) adopt(previewState());
  }, [adopt]);

  const proposalId = state?.proposal.proposalId ?? handle?.proposalId;
  const ready = IS_PREVIEW || isConnected;

  // Attaching is what unlocks the commit tool server-side. Until this lands,
  // nothing can write — including from a host that ignores tool visibility. It
  // is also how the panel gets the file the opening result left out.
  useEffect(() => {
    if (!bridge || !ready || !proposalId) return;
    let cancelled = false;
    void bridge
      .callTool("editor_attach", { proposalId })
      .then((result) => {
        const next = result.structuredContent as unknown as EditorState | undefined;
        if (!cancelled) adopt(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFailure(messageOf(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, ready, proposalId, adopt]);

  /*
   * Findings and the diff are computed here, on every keystroke, from the same
   * modules the server uses. That is what makes the review live: you see the
   * consequence of an edit as you make it, not after a round trip.
   *
   * The server recomputes all of it before committing anyway. This copy is for
   * the eyes; that copy is the one with authority.
   */
  const local = useMemo(() => {
    if (!state) return null;
    const proposal: Proposal = { ...state.proposal, content, destructiveAcknowledged: ack };
    const after = proposal.mode === "delete" ? "" : content;
    const { hunks, stats } = diffLines(proposal.baseline, after);
    return { proposal, hunks, stats, findings: lintProposal(proposal, stats) };
  }, [state, content, ack]);

  // Keep the server's copy current, but not on every character.
  const pushTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!bridge || !state || receipt) return;
    if (content === state.proposal.content && ack === state.proposal.destructiveAcknowledged)
      return;

    window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      void bridge
        .callTool("editor_update", {
          proposalId: state.proposal.proposalId,
          content,
          destructiveAcknowledged: ack,
        })
        .catch(() => {
          // A failed sync is not worth interrupting an edit for. The commit
          // sends the final content anyway, and the server rechecks everything.
        });
    }, PUSH_DEBOUNCE_MS);

    return () => window.clearTimeout(pushTimer.current);
  }, [bridge, state, content, ack, receipt]);

  const applyFix = useCallback((finding: Finding) => {
    if (finding.fix) setContent(finding.fix.content);
  }, []);

  const pin = useCallback((next: Passage) => {
    setPassages((current) => attachPassage(current, next));
    setPending(null);
  }, []);

  const unpin = useCallback((id: string) => {
    setPassages((current) => current.filter((p) => p.id !== id));
  }, []);

  /*
   * Hand the selected passages to the chat as though the human had typed them.
   * This is `ui/message`, which starts a normal turn — so the answer arrives in
   * the conversation, next to the panel, rather than inside it. Each quote
   * carries its line numbers, because a passage without them is just a snippet.
   */
  const sendPassages = useCallback(
    async (note: string) => {
      if (!bridge || !state) return;
      // Whatever is still highlighted counts as selected, so a single region
      // needs no trip through the + button before it can be sent.
      const outgoing = pending ? attachPassage(passages, pending) : passages;
      if (outgoing.length === 0) return;

      setSending(true);
      setFailure(null);
      try {
        await bridge.sendMessage(quotePassages(state.proposal.target.display, outgoing, note));

        setPending(null);
        setPassages([]);
        setSent(`Sent ${describePassages(outgoing)} to Claude.`);
        window.setTimeout(() => setSent(null), 4000);
      } catch (cause) {
        setFailure(messageOf(cause));
      } finally {
        setSending(false);
      }
    },
    [bridge, state, passages, pending],
  );

  const commit = useCallback(async () => {
    if (!bridge || !state) return;
    setBusy(true);
    setFailure(null);
    try {
      // Flush the final content first, so the server commits exactly what is on
      // screen rather than whatever the debounce last managed to send.
      await bridge.callTool("editor_update", {
        proposalId: state.proposal.proposalId,
        content,
        destructiveAcknowledged: ack,
      });
      const result = await bridge.callTool("editor_commit", {
        proposalId: state.proposal.proposalId,
      });

      if (result.isError) {
        setFailure(textOf(result));
        return;
      }

      const committed = result.structuredContent as unknown as CommitReceipt;
      setReceipt(committed);

      // The model proposed one thing; a human may have committed another. Tell
      // it what actually landed, or the rest of the conversation is built on a
      // file that does not exist.
      await bridge.updateModelContext({
        content: [
          {
            type: "text",
            text:
              `${committed.mode === "delete" ? "Deleted" : "Wrote"} ${committed.display}` +
              `${committed.dryRun ? " (dry run, nothing reached disk)" : ""}. ` +
              (committed.editedByHuman
                ? `The human edited the proposal before approving it. What actually landed:\n\n${committed.content}`
                : "Committed as proposed."),
          },
        ],
        structuredContent: {
          path: committed.display,
          sha256: committed.sha256,
          editedByHuman: committed.editedByHuman,
        },
      });
    } catch (cause) {
      setFailure(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [bridge, state, content, ack]);

  const discard = useCallback(async () => {
    if (!bridge || !state) return;
    setBusy(true);
    try {
      await bridge.callTool("editor_discard", { proposalId: state.proposal.proposalId });
      await bridge.sendMessage(
        `I discarded the proposed write to ${state.proposal.target.display}. Nothing was written.`,
      );
    } catch (cause) {
      setFailure(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, [bridge, state]);

  if (error && !IS_PREVIEW) {
    return <div className="status status-error">Could not reach the host: {error.message}</div>;
  }
  if (!state || !local)
    return <div className="status">Opening {handle?.display ?? "the editor"}…</div>;
  if (receipt) return <Receipt receipt={receipt} />;

  const { proposal, findings, hunks, stats } = local;
  const blocked = hasBlockers(findings);
  const needsAck = findings.some((f) => f.rule === "destructive" && f.severity === "blocker");
  const isDelete = proposal.mode === "delete";
  const showEditor = !isDelete && view !== "diff";
  const showDiff = view !== "edit";
  // A file opened for reading starts identical to disk. There is nothing to
  // write until you actually change something.
  const unchanged = !isDelete && content === proposal.baseline && proposal.target.exists;

  return (
    <div className="review">
      <div className="tag" data-state={proposal.target.absolute ? "held" : "refused"}>
        <span className="tag-state">{proposal.target.absolute ? "Held" : "Refused"}</span>
        <div className="tag-body">
          <div className="tag-path">
            {proposal.target.display} <span className="tag-mode">· {proposal.mode}</span>
          </div>
          {proposal.rationale ? <p className="tag-rationale">{proposal.rationale}</p> : null}
          {state.dryRun ? (
            <p className="tag-rationale">Dry run — committing will not touch disk.</p>
          ) : null}
        </div>
        <div className="tag-meta">
          <span className={stats.added ? "count-add" : "count-flat"}>+{stats.added}</span>
          <span className={stats.removed ? "count-cut" : "count-flat"}>−{stats.removed}</span>
        </div>
      </div>

      <Findings findings={findings} onApplyFix={applyFix} />

      <div className="panes" data-single={String(!showEditor || !showDiff)}>
        {showEditor ? (
          <section className="pane">
            <header className="pane-head">
              <span className="pane-title">Proposed — edit freely</span>
              <ViewToggle view={view} onChange={setView} />
            </header>
            <div className="pane-scroll">
              <Editor value={content} onChange={setContent} onSelect={setPending} />
            </div>
          </section>
        ) : null}

        {showDiff ? (
          <section className="pane">
            <header className="pane-head">
              <span className="pane-title">Against disk</span>
              {showEditor ? (
                <span className="pane-note">
                  {proposal.target.exists
                    ? `${proposal.target.onDisk?.lines ?? 0} lines now`
                    : "new file"}
                </span>
              ) : (
                <ViewToggle view={view} onChange={setView} />
              )}
            </header>
            <div className="pane-scroll">
              <DiffPane hunks={hunks} isNewFile={!proposal.target.exists} onSelect={setPending} />
            </div>
          </section>
        ) : null}
      </div>

      {pending || passages.length > 0 ? (
        <SelectionBar
          pending={pending}
          passages={passages}
          path={proposal.target.display}
          sending={sending}
          onAttach={pin}
          onRemove={unpin}
          onSend={sendPassages}
          onDismiss={() => {
            setPending(null);
            setPassages([]);
          }}
        />
      ) : sent ? (
        <div className="sent-note">{sent}</div>
      ) : null}

      <div className="threshold">
        {needsAck ? (
          <label className="ack">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              I have read the diff and I mean to{" "}
              {isDelete ? "delete this file" : "remove those lines"}.
            </span>
          </label>
        ) : blocked ? (
          <span className="blocked-why">
            {findings.find((f) => f.severity === "blocker")?.message}
          </span>
        ) : (
          <span />
        )}

        <div className="threshold-actions">
          <button className="btn btn-quiet" type="button" onClick={discard} disabled={busy}>
            Discard
          </button>
          <button
            className={`commit${isDelete ? " commit-danger" : ""}`}
            type="button"
            onClick={commit}
            disabled={blocked || busy || unchanged || !proposal.target.absolute}
          >
            {busy
              ? "Working…"
              : unchanged
                ? "No changes to save"
                : commitLabel(proposal, content, state.dryRun)}
          </button>
        </div>
      </div>

      {failure ? <div className="status status-error">{failure}</div> : null}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Pane layout">
      {(["split", "edit", "diff"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Receipt({ receipt }: { receipt: CommitReceipt }) {
  return (
    <div className="review">
      <div className="tag" data-state="committed">
        <span className="tag-state">{receipt.dryRun ? "Dry run" : "Written"}</span>
        <div className="tag-body">
          <div className="tag-path">{receipt.display}</div>
        </div>
        <div className="tag-meta">
          <span className="count-flat">{receipt.lines} lines</span>
        </div>
      </div>
      <div className="receipt">
        <div className="receipt-line">
          <span className="receipt-key">path</span>
          <span>{receipt.path}</span>
        </div>
        <div className="receipt-line">
          <span className="receipt-key">bytes</span>
          <span>{receipt.bytes}</span>
        </div>
        <div className="receipt-line">
          <span className="receipt-key">sha256</span>
          <span>{receipt.sha256.slice(0, 16)}…</span>
        </div>
        {receipt.editedByHuman ? (
          <p className="receipt-note">
            You changed the proposal before approving it. Claude has been told what actually landed,
            not what it wrote.
          </p>
        ) : null}
        {receipt.dryRun ? <p className="receipt-note">Dry run — nothing reached disk.</p> : null}
      </div>
    </div>
  );
}

/**
 * The button says what will be true afterwards, not how big the change was.
 * "Write 15 lines to deploy.yml" is the fact you are agreeing to; the +/- counts
 * are already on the tag for anyone who wants them.
 */
function commitLabel(proposal: Proposal, content: string, dryRun: boolean): string {
  const name = proposal.target.display.split("/").pop() ?? proposal.target.display;
  if (proposal.mode === "delete") return `Delete ${name}`;
  if (dryRun) return `Simulate write to ${name}`;
  const lines = content === "" ? 0 : content.split("\n").length;
  return `Write ${lines} ${lines === 1 ? "line" : "lines"} to ${name}`;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function textOf(result: CallToolResult): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
