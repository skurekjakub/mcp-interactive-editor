import { useCallback, useLayoutEffect, useRef } from "react";
import { passageFromSelection, type Passage } from "../../../shared/passages.js";
import type { SelectionAnchor } from "../lib/anchor.js";

/** One level of indentation, in spaces. */
const INDENT = "  ";

/** Properties of the editor pane. */
interface EditorProps {
  value: string;
  readOnly?: boolean;
  onChange: (next: string) => void;
  onSelect?: (
    passage: Passage | null,
    anchor: SelectionAnchor | null,
    fromPointer: boolean,
  ) => void;
}

/**
 * Renders a textarea with a line gutter.
 *
 * Deliberately not a code editor. The job is to make small corrections to
 * something a model wrote, and a textarea does that with no surprises about
 * keybindings, selection, or IME. Tab indents rather than moving focus, because
 * leaving the field mid-edit is the one thing that would make this feel broken.
 *
 * @param props - Component properties.
 * @param props.value - The current draft.
 * @param props.readOnly - Whether editing is disabled.
 * @returns The editable draft with its gutter.
 */
export function Editor({ value, readOnly, onChange, onSelect }: EditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  /*
   * A textarea will not report where a character range sits on screen — there is
   * no rect for a selection inside one, only for the box as a whole. The last
   * place the pointer was released stands in for it, which is where the
   * selection ended and close enough to open a box beside. Keyboard selections
   * have no pointer and fall back to the top of the field.
   */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const lineCount = value === "" ? 1 : value.split("\n").length;

  // The textarea grows to its content so the pane scrolls as one surface and
  // the gutter cannot drift out of alignment with the text.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [value]);

  /*
   * Selection is read on the events that can change it, but deliberately not on
   * blur: reaching for the button that acts on a selection blurs the textarea,
   * and clearing there would make the selection vanish exactly when it is
   * needed. The browser keeps selectionStart/End across blur, so this is safe.
   */
  const syncSelection = useCallback(
    (fromPointer: boolean) => {
      if (!onSelect) return;
      const area = areaRef.current;
      if (!area) return;
      const selected = passageFromSelection(area.value, area.selectionStart, area.selectionEnd);
      onSelect(selected, selected ? anchorFor(area, pointer.current) : null, fromPointer);
    },
    [onSelect],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey) return;

    // Shift+Tab is how a keyboard user leaves a field. Swallowing it turns the
    // editor into a trap with no way out (WCAG 2.1.2).
    if (event.shiftKey) return;

    event.preventDefault();
    const area = event.currentTarget;
    const { selectionStart, selectionEnd } = area;

    /*
     * Indent every touched line when a range is selected. Replacing the range
     * with two spaces is what a naive insert does, and since React controls the
     * value the browser's own undo cannot reliably bring the lines back.
     */
    if (selectionStart !== selectionEnd) {
      const from = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const block = value.slice(from, selectionEnd);
      const indented = block.split("\n").map((entry) => INDENT + entry);
      const next = value.slice(0, from) + indented.join("\n") + value.slice(selectionEnd);
      onChange(next);
      const added = INDENT.length * indented.length;
      requestAnimationFrame(() => {
        area.selectionStart = selectionStart + INDENT.length;
        area.selectionEnd = selectionEnd + added;
      });
      onSelect?.(null, null, false);
      return;
    }

    const next = `${value.slice(0, selectionStart)}${INDENT}${value.slice(selectionEnd)}`;
    onChange(next);
    requestAnimationFrame(() => {
      area.selectionStart = area.selectionEnd = selectionStart + INDENT.length;
    });
    // An edit invalidates whatever was highlighted, and every other path that
    // changes the text says so.
    onSelect?.(null, null, false);
  };

  return (
    <div className="editor">
      <div className="gutter" aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
      </div>
      <textarea
        ref={areaRef}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Proposed file contents"
        placeholder="Empty file"
        onKeyDown={handleKeyDown}
        onSelect={() => syncSelection(false)}
        onKeyUp={() => syncSelection(false)}
        onMouseUp={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY };
          syncSelection(true);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          onSelect?.(null, null, false);
        }}
      />
    </div>
  );
}

/**
 * Chooses the rectangle a popover should be placed against.
 *
 * @param area - The textarea holding the selection.
 * @param pointer - Where the pointer was last released, if it was.
 * @returns Viewport coordinates for the selection.
 */
function anchorFor(
  area: HTMLTextAreaElement,
  pointer: { x: number; y: number } | null,
): SelectionAnchor {
  if (pointer) return { top: pointer.y - 10, bottom: pointer.y + 10, left: pointer.x };
  const rect = area.getBoundingClientRect();
  return { top: rect.top, bottom: rect.top + 20, left: rect.left };
}
