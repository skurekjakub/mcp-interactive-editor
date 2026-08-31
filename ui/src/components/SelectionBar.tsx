import { useLayoutEffect, useRef, useState } from "react";
import {
  isAnswered,
  rangeOf,
  sortPassages,
  unanswered,
  type Passage,
} from "../../../shared/passages.js";

const MAX_NOTE_HEIGHT = 120;

/** Properties of the docked highlight tray. */
interface SelectionBarProps {
  /**
   * The live selection, not yet pinned.
   *
   * The popover is the quick way to comment on it, but it needs a rectangle to
   * position against and not every selection yields one. This row is the path
   * that is always there, so a highlight can never become uncommentable.
   */
  pending: Passage | null;
  /** Regions already pinned. Shown in reading order, not the order they were clicked. */
  passages: Passage[];
  /** Everything that would actually be sent, including an unpinned live selection. */
  outgoing: Passage[];
  path: string;
  sending: boolean;
  onAttach: (passage: Passage) => void;
  onAnnotate: (id: string, note: string) => void;
  onRemove: (id: string) => void;
  onSend: (note: string) => Promise<void>;
  onDismiss: () => void;
}

/**
 * Renders the highlights on their way to the chat and what is asked about each.
 *
 * The tray docks to the bottom of the panel and stays there while the human
 * works: every highlight is a row with its own comment box, and sending waits
 * until none of them are empty. A pile of quotes with one paragraph underneath
 * makes the reader guess which remark belongs to which region, and a tray that
 * vanishes forces a re-selection to add the one that was forgotten.
 *
 * @param props - Component properties.
 * @param props.outgoing - Everything that would be sent, live selection included.
 * @param props.sending - Whether a send is in flight.
 * @returns The docked tray.
 */
export function SelectionBar({
  pending,
  passages,
  outgoing,
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
  // Counted over what will actually be sent, so the "still needs a comment"
  // warning cannot disagree with what the send does.
  const waiting = unanswered(outgoing);
  const alreadyAttached = pending !== null && passages.some((p) => p.id === pending.id);
  const nothingSelected = outgoing.length === 0;
  const blocked = nothingSelected || waiting.length > 0;

  const submit = async () => {
    if (sending || blocked) return;
    const outbound = note.trim();
    // Clear only once it has gone. A refused send that has already emptied the
    // box loses a typed paragraph with no way to recover it.
    await onSend(outbound);
    setNote("");
  };

  return (
    <div className="selection" data-blocked={String(blocked)}>
      <div className="selection-head">
        <span className="selection-count">
          {outgoing.length === 0
            ? "Highlight something in either pane"
            : `${outgoing.length} highlighted in ${basename(path)}`}
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
            disabled={alreadyAttached || sending}
          >
            {alreadyAttached ? "Added" : "+ Add"}
          </button>
        </div>
      ) : null}

      <form
        className="selection-ask"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          className="selection-input"
          rows={1}
          value={note}
          placeholder="Anything that applies to all of them? Optional."
          aria-label="An optional message about all the highlights together"
          onChange={(event) => setNote(event.target.value)}
          disabled={sending}
        />
        <button
          className="btn"
          type="submit"
          disabled={sending || blocked}
          title={
            nothingSelected
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

/** Properties of one highlight row. */
interface PassageRowProps {
  passage: Passage;
  disabled: boolean;
  onAnnotate: (id: string, note: string) => void;
  onRemove: (id: string) => void;
}

/**
 * Renders one highlight and the comment attached to it.
 *
 * Enter is a newline here rather than a send: this is the field being composed
 * in, and there is a button for the other thing.
 *
 * @param props - Component properties.
 * @param props.passage - The highlighted region.
 * @returns The row and its comment box.
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

/**
 * Shortens a passage to one line of preview.
 *
 * @param text - The full passage.
 * @returns Its first line, elided.
 */
function excerpt(text: string): string {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const trimmed = firstLine.length > 96 ? `${firstLine.slice(0, 96)}…` : firstLine;
  return text.includes("\n") ? `${trimmed} …` : trimmed;
}

/**
 * Takes the file name from a path.
 *
 * @param path - A display path.
 * @returns Its last segment.
 */
function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
