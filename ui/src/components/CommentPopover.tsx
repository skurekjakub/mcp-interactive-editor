import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rangeOf, type Passage } from "../../../shared/passages.js";
import { placePopover, type SelectionAnchor } from "../lib/anchor.js";

const WIDTH = 340;

interface CommentPopoverProps {
  passage: Passage;
  anchor: SelectionAnchor;
  onAdd: (passage: Passage, note: string) => void;
  onDismiss: () => void;
}

/**
 * The comment box, at the passage rather than at the far end of the panel.
 *
 * Highlighting a few lines and then travelling to the bottom of the window to
 * say something about them puts the words and the thing they are about as far
 * apart as the layout allows. This opens where you are looking, above the
 * selection so it never covers it.
 */
export function CommentPopover({ passage, anchor, onAdd, onDismiss }: CommentPopoverProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [at, setAt] = useState(() =>
    placePopover(anchor, { width: WIDTH, height: 120 }, viewport()),
  );

  // Measure, then place: the height depends on how much has been typed, and a
  // box placed from a guessed height drifts over the selection as it grows.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    setAt(placePopover(anchor, { width: WIDTH, height: box.offsetHeight }, viewport()));
  }, [anchor, note]);

  // A fresh selection is a fresh question, and the box is useless unless you can
  // start typing into it immediately.
  useEffect(() => {
    setNote("");
    areaRef.current?.focus();
  }, [passage.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const add = () => onAdd(passage, note.trim());

  return (
    <div
      ref={boxRef}
      className="popover"
      data-placement={at.placement}
      style={{ top: at.top, left: at.left, width: WIDTH }}
      // The panes clear the pending selection on mouseup; without this, reaching
      // for the box would dismiss the box.
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
    >
      <div className="popover-head">
        <span className="selection-range">{rangeOf(passage)}</span>
        <button
          type="button"
          className="selection-chip-drop"
          onClick={onDismiss}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <textarea
        ref={areaRef}
        className="selection-input"
        rows={2}
        value={note}
        placeholder={`What about ${rangeOf(passage)}?`}
        aria-label={`Comment on ${rangeOf(passage)}`}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          // Enter commits the comment, shift+Enter is a newline: this is a small
          // box for a short remark, and reaching for a button every time is the
          // friction that stops people leaving comments at all.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            add();
          }
        }}
      />

      <div className="popover-actions">
        <button className="btn" type="button" onClick={add}>
          {note.trim() ? "Add comment" : "Add without a comment"}
        </button>
      </div>
    </div>
  );
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}
