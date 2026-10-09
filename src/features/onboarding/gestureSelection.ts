/** Update a letter path. Returning to the previous tile removes the last step. */
export function advanceSelection(selection: readonly number[], index: number): number[] {
  'worklet';
  if (index < 0 || !Number.isInteger(index)) return [...selection];
  const last = selection.length - 1;
  if (selection[last] === index) return [...selection];
  if (last > 0 && selection[last - 1] === index) return selection.slice(0, -1);
  if (selection.includes(index)) return [...selection];
  return [...selection, index];
}
