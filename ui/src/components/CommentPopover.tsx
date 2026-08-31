import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rangeOf, type Passage } from "../../../shared/passages.js";
import { placePopover, type SelectionAnchor } from "../lib/anchor.js";

/** Width the box takes when the panel is wide enough for it. */
const WIDTH = 340;

/** Properties of the comment popover. */
interface CommentPopoverProps {
  passage: Passage;
  anchor: SelectionAnchor;
  /** True when the selection came from a pointer, so focus may be taken. */
  fromPointer: boolean;
  onAdd: (passage: Passage, note: string) => void;
  onDismiss: () => void;
}

/**
 * Renders the comment box at the passage rather than at the far end of the panel.
 *
 * Highlighting a few lines and then travelling to the bottom of the window to
 * say something about them puts the words and the thing they are about as far
 * apart as the layout allows. This opens where the reader is looking, above the
 * selection so it never covers it.
 *
 * @param props - Component properties.
 * @param props.passage - The highlighted region being commented on.
 * @param props.anchor - Where that region sits in the viewport.
 * @param props.fromPointer - Whether focus may be moved into the box.
 * @returns The floating comment box.
 */
export function CommentPopover({
  passage,
  anchor,
  fromPointer,
  onAdd,
  onDismiss,
}: CommentPopoverProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusTo = useRef<Element | null>(null);
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

  useEffect(() => {
    setNote("");
    /*
     * Only take focus from a pointer selection. Extending a selection with
     * shift+arrow fires a keyup per keypress, so autofocusing on a keyboard
     * selection pulls the caret out of the editor on the first one and the rest
     * of the keystrokes are typed into this box instead.
     */
    if (!fromPointer) return;
    returnFocusTo.current = document.activeElement;
    areaRef.current?.focus();
  }, [passage.id, fromPointer]);

  // Focus has to go back somewhere it can be used. Left alone it falls to the
  // document body, where the next Tab restarts from the top of the panel.
  useEffect(() => {
    return () => {
      const previous = returnFocusTo.current;
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    };
  }, []);

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
      role="dialog"
      aria-label={`Comment on ${rangeOf(passage)}`}
      data-placement={at.placement}
      style={{ top: at.top, left: at.left, width: at.width }}
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

/**
 * Reads the current viewport size.
 *
 * @returns The window's inner dimensions.
 */
function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}
