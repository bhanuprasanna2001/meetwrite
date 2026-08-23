/** Move through a finite list with deterministic wrap-around. */
export function moveSelection(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}
