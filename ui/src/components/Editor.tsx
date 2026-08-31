import { useCallback, useLayoutEffect, useRef } from "react";
import { passageFromSelection, type Passage } from "../../../shared/passages.js";

interface EditorProps {
  value: string;
  readOnly?: boolean;
  onChange: (next: string) => void;
  onSelect?: (passage: Passage | null) => void;
}

/**
 * A textarea with a line gutter. Not a code editor — deliberately. The job here
 * is to make small corrections to something a model wrote, and a textarea does
 * that with no surprises about keybindings, selection, or IME. Tab inserts two
 * spaces instead of leaving the field, because leaving the field mid-edit is
 * the one thing that would make this feel broken.
 */
export function Editor({ value, readOnly, onChange, onSelect }: EditorProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
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
   * Selection is read on the events that can change it, but deliberately NOT on
   * blur: reaching for the button that acts on a selection blurs the textarea,
   * and clearing there would make the selection vanish exactly when it is
   * needed. The browser keeps selectionStart/End across blur, so this is safe.
   */
  const syncSelection = useCallback(() => {
    if (!onSelect) return;
    const area = areaRef.current;
    if (!area) return;
    onSelect(passageFromSelection(area.value, area.selectionStart, area.selectionEnd));
  }, [onSelect]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab" || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    const area = event.currentTarget;
    const { selectionStart, selectionEnd } = area;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    onChange(next);
    requestAnimationFrame(() => {
      area.selectionStart = area.selectionEnd = selectionStart + 2;
    });
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
        onSelect={syncSelection}
        onKeyUp={syncSelection}
        onMouseUp={syncSelection}
        onChange={(event) => {
          onChange(event.target.value);
          onSelect?.(null);
        }}
      />
    </div>
  );
}
