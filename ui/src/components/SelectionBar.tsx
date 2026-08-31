import { useLayoutEffect, useRef, useState } from "react";
import { describePassages, rangeOf, type Passage } from "../../../shared/passages.js";

const MAX_NOTE_HEIGHT = 160;

interface SelectionBarProps {
  /** The live selection, not yet pinned. */
  pending: Passage | null;
  /** Regions already pinned, in the order they were added. */
  passages: Passage[];
  path: string;
  sending: boolean;
  onAttach: (passage: Passage) => void;
  onRemove: (id: string) => void;
  onSend: (note: string) => void;
  onDismiss: () => void;
}

/**
 * Select a passage in either pane and this appears: what you have pointed at, a
 * box to say what you want done with it, and a button that drops the whole thing
 * into the chat as if you had typed it.
 *
 * It sits under the panes rather than floating over the text — a popover would
 * cover the lines you are trying to talk about, which is the one thing it must
 * not do.
 */
export function SelectionBar({
  pending,
  passages,
  path,
  sending,
  onAttach,
  onRemove,
  onSend,
  onDismiss,
}: SelectionBarProps) {
  const [note, setNote] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // The box grows with the instruction. Asking for "instructions per region" and
  // then handing over a one-line slot is its own kind of broken.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, MAX_NOTE_HEIGHT)}px`;
  }, [note]);

  const alreadyAttached = pending !== null && passages.some((p) => p.id === pending.id);
  const outgoing = pending && !alreadyAttached ? [...passages, pending] : passages;

  const submit = () => {
    if (sending || outgoing.length === 0) return;
    onSend(note.trim());
    setNote("");
  };

  return (
    <div className="selection">
      {passages.length > 0 ? (
        <div className="selection-chips">
          {passages.map((p) => (
            <span className="selection-chip" key={p.id} data-source={p.source}>
              {rangeOf(p)}
              <button
                type="button"
                className="selection-chip-drop"
                onClick={() => onRemove(p.id)}
                aria-label={`Remove ${rangeOf(p)}`}
              >
                ✕
              </button>
            </span>
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
          ref={areaRef}
          className="selection-input"
          rows={1}
          value={note}
          placeholder={`Ask Claude about ${describePassages(outgoing)} of ${basename(path)}`}
          aria-label="What should Claude do with these passages"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, shift+Enter is a newline. An instruction is often more
            // than one line, and losing it to a stray Return is worse than the
            // extra keystroke of reaching for shift.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          disabled={sending}
        />
        <button className="btn" type="submit" disabled={sending || outgoing.length === 0}>
          {sending ? "Sending…" : "Send to Claude"}
        </button>
        <button className="btn btn-quiet" type="button" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </form>
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
