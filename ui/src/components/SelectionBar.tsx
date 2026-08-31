import { useEffect, useRef, useState } from "react";
import type { Passage } from "./Editor.js";

interface SelectionBarProps {
  passage: Passage;
  path: string;
  sending: boolean;
  onSend: (passage: Passage, note: string) => void;
  onDismiss: () => void;
}

/**
 * Select a passage in the editor and this appears: the quoted lines, a box to
 * say what you want done with them, and a button that drops the whole thing into
 * the chat as if you had typed it.
 *
 * It sits under the panes rather than floating over the text — a popover would
 * cover the lines you are trying to talk about, which is the one thing it must
 * not do.
 */
export function SelectionBar({ passage, path, sending, onSend, onDismiss }: SelectionBarProps) {
  const [note, setNote] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // A fresh selection starts a fresh question.
  useEffect(() => {
    setNote("");
  }, [passage.start, passage.end]);

  const lineCount = passage.endLine - passage.startLine + 1;
  const range =
    passage.startLine === passage.endLine
      ? `line ${passage.startLine}`
      : `lines ${passage.startLine}–${passage.endLine}`;

  return (
    <div className="selection">
      <div className="selection-quote">
        <span className="selection-range">
          {range} · {lineCount === 1 ? "1 line" : `${lineCount} lines`}
        </span>
        <code className="selection-excerpt">{excerpt(passage.text)}</code>
      </div>

      <form
        className="selection-ask"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(passage, note.trim());
        }}
      >
        <input
          ref={inputRef}
          className="selection-input"
          value={note}
          placeholder={`Ask Claude about this passage of ${path.split("/").pop()}`}
          aria-label="What should Claude do with this passage"
          onChange={(event) => setNote(event.target.value)}
          disabled={sending}
        />
        <button className="btn" type="submit" disabled={sending}>
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
