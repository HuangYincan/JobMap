/** Arrow / Enter / Escape for a search combobox. Pure so both desktop and mobile can share it. */

export function nextSuggestionIndex(
  current: number,
  length: number,
  direction: 1 | -1,
): number {
  if (length <= 0) return -1;
  if (current < 0) return direction > 0 ? 0 : length - 1;
  return (current + direction + length) % length;
}

export type SuggestKeyAction =
  | { type: 'move'; index: number }
  | { type: 'pick'; index: number }
  | { type: 'commit' }
  | { type: 'close' }
  | { type: 'none' };

export function suggestKeyAction(
  key: string,
  current: number,
  length: number,
): SuggestKeyAction {
  if (key === 'ArrowDown') return { type: 'move', index: nextSuggestionIndex(current, length, 1) };
  if (key === 'ArrowUp') return { type: 'move', index: nextSuggestionIndex(current, length, -1) };
  if (key === 'Escape') return { type: 'close' };
  if (key === 'Enter') {
    if (current >= 0 && current < length) return { type: 'pick', index: current };
    return { type: 'commit' };
  }
  return { type: 'none' };
}
