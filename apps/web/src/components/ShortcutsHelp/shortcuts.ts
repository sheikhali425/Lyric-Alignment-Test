/** Single source of truth for the shortcut list shown in the help dialog and hints. Implemented in hooks/useEditorShortcuts.ts. */
export interface ShortcutItem {
  /** Alternative key combos, e.g. ['Enter', 'J']. */
  keys: string[];
  description: string;
}
export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Timing a sheet',
    items: [
      { keys: ['Space'], description: 'Play / pause' },
      { keys: ['Enter', 'J'], description: 'Stamp the start of the next line (the one marked ▶), then advance' },
      { keys: ['K'], description: 'Stamp the end of the line just stamped (marks a gap)' },
      { keys: ['P'], description: 'Play the selected lines (or from the cursor line)' },
    ],
  },
  {
    title: 'Nudging',
    items: [
      { keys: ['←', '→'], description: 'Nudge selected lines ∓10 ms (Shift: 100 ms). With nothing selected: seek ∓1 s (Shift: 5 s)' },
      { keys: ['Alt + ←', 'Alt + →'], description: 'Move only the start edge ∓10 ms (Shift: 100 ms)' },
      { keys: ['[', ']'], description: 'Move only the end edge ∓10 ms (Shift: 100 ms)' },
    ],
  },
  {
    title: 'Selection and structure',
    items: [
      { keys: ['↑', '↓'], description: 'Move the selection through the lines' },
      { keys: ['Shift + ↑', 'Shift + ↓'], description: 'Extend the selection' },
      { keys: ['Alt + ↑', 'Alt + ↓'], description: 'Move the selected lines up / down' },
      { keys: ['⌘/Ctrl + A'], description: 'Select all lines' },
      { keys: ['Esc'], description: 'Clear the selection / close a dialog' },
      { keys: ['F2'], description: 'Edit the text of the selected line (Enter commits, Esc cancels)' },
      { keys: ['M'], description: 'Merge the selected consecutive lines (one line: with the next)' },
      { keys: ['S'], description: 'Split the selected line at the playhead' },
      { keys: ['Backspace', 'Delete'], description: 'Clear timing of the selected lines' },
      { keys: ['Shift + Delete'], description: 'Delete the selected lines' },
    ],
  },
  {
    title: 'General',
    items: [
      { keys: ['⌘/Ctrl + Z'], description: 'Undo' },
      { keys: ['⌘/Ctrl + Shift + Z', 'Ctrl + Y'], description: 'Redo' },
      { keys: ['⌘/Ctrl + S'], description: 'Save' },
      { keys: ['⌘/Ctrl + O'], description: 'Open the load-track dialog' },
      { keys: ['+', '-'], description: 'Zoom the timeline in / out' },
      { keys: ['?'], description: 'Show this help' },
    ],
  },
];
