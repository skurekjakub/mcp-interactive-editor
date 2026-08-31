import { useLayoutEffect, useRef, useState } from "react";
import {
  isAnswered,
  rangeOf,
  sortPassages,
  unanswered,
  type Passage,
} from "../../../shared/passages.js";

const MAX_NOTE_HEIGHT = 120;

interface SelectionBarProps {
  /** The live selection, not yet pinned. */
  pending: Passage | null;
  /** Regions already pinned. Shown in reading order, not the order they were clicked. */
  passages: Passage[];
  path: string;
  sending: boolean;
  onAttach: (passage: Passage) => void;
  onAnnotate: (id: string, note: string) => void;
  onRemove: (id: string) => void;
  onSend: (note: string) => void;
  onDismiss: () => void;
}

/**
 * Highlights on their way to the chat, and what is being asked about each one.
 *
 * It docks to the bottom of the panel and stays there while you work: every
 * highlight is a row with its own comment box, and sending waits until none of
 * them are empty. A pile of quotes with one paragraph underneath makes the
 * reader guess which remark belongs to which region, and a tray that vanishes
 * makes you re-select everything to add the one you forgot.
 */
export function SelectionBar({
  pending,
  passages,
  path,
  sending,
  onAttach,
  onAnnotate,
  onRemove,
  onSend,
  onDismiss,
}: SelectionBarProps) {
  const [note, setNote] = useState("");

  const ordered = sortPassages(passages);
  const alreadyAttached = pending !== null && passages.some((p) => p.id === pending.id);
  const waiting = unanswered(passages);
  const nothingPinned = passages.length === 0;
  const blocked = nothingPinned || waiting.length > 0;

  const submit = () => {
    if (sending || blocked) return;
    onSend(note.trim());
    setNote("");
  };

  return (
    <div className="selection" data-blocked={String(blocked)}>
      <div className="selection-head">
        <span className="selection-count">
          {passages.length === 0
            ? "Highlight something in either pane"
            : `${passages.length} highlighted in ${basename(path)}`}
        </span>
        {waiting.length > 0 ? (
          <span className="selection-waiting">
            {waiting.length} still {waiting.length === 1 ? "needs a comment" : "need comments"}
          </span>
        ) : null}
      </div>

      {ordered.length > 0 ? (
        <div className="selection-rows">
          {ordered.map((passage) => (
            <PassageRow
              key={passage.id}
              passage={passage}
              disabled={sending}
              onAnnotate={onAnnotate}
              onRemove={onRemove}
            />
          ))}
        </div>
      ) : null}

      {pending ? (
        <div className="selection-quote">
          <span className="selection-range">{rangeOf(pending)}</span>
          <code className="selection-excerpt">{excerpt(pending.text)}</code>
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => onAttach(pending)}
            disabled={alreadyAttached}
          >
            {alreadyAttached ? "Added" : "+ Add"}
          </button>
        </div>
      ) : null}

      <form
        className="selection-ask"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          className="selection-input"
          rows={1}
          value={note}
          placeholder="Anything else, about all of them together? Optional."
          aria-label="An optional message about all the highlights together"
          onChange={(event) => setNote(event.target.value)}
          disabled={sending}
        />
        <button
          className="btn"
          type="submit"
          disabled={sending || blocked}
          title={
            nothingPinned
              ? "Add at least one highlight first"
              : waiting.length > 0
                ? "Every highlight needs a comment before this can go"
                : undefined
          }
        >
          {sending ? "Sending…" : "Send to Claude"}
        </button>
        <button className="btn btn-quiet" type="button" onClick={onDismiss} aria-label="Clear all">
          ✕
        </button>
      </form>
    </div>
  );
}

interface PassageRowProps {
  passage: Passage;
  disabled: boolean;
  onAnnotate: (id: string, note: string) => void;
  onRemove: (id: string) => void;
}

/**
 * One highlight and the comment attached to it. Enter is a newline here rather
 * than a send: this is the field you are composing in, and there is a button for
 * the other thing.
 */
function PassageRow({ passage, disabled, onAnnotate, onRemove }: PassageRowProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const note = passage.note ?? "";

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, MAX_NOTE_HEIGHT)}px`;
  }, [note]);

  return (
    <div className="selection-row" data-answered={String(isAnswered(passage))}>
      <div className="selection-quote">
        <span className="selection-range">{rangeOf(passage)}</span>
        <code className="selection-excerpt">{excerpt(passage.text)}</code>
        <button
          type="button"
          className="selection-chip-drop"
          onClick={() => onRemove(passage.id)}
          aria-label={`Remove ${rangeOf(passage)}`}
          disabled={disabled}
        >
          ✕
        </button>
      </div>
      <textarea
        ref={areaRef}
        className="selection-input selection-note"
        rows={1}
        value={note}
        placeholder={`What about ${rangeOf(passage)}?`}
        aria-label={`Comment on ${rangeOf(passage)}`}
        onChange={(event) => onAnnotate(passage.id, event.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

/** One line of preview. The full passage is what gets sent, not this. */
function excerpt(text: string): string {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const trimmed = firstLine.length > 96 ? `${firstLine.slice(0, 96)}…` : firstLine;
  return text.includes("\n") ? `${trimmed} …` : trimmed;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
