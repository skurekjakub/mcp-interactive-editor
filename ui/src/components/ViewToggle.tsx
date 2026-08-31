/** Which panes the human has asked to see. */
export type View = "split" | "edit" | "diff";

/**
 * Renders the control that chooses which panes are shown.
 *
 * @param props - Component properties.
 * @param props.view - The current choice.
 * @returns The toggle group.
 */
export function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
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
