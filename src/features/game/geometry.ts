export type TilePos = { x: number; y: number };

/** Раскладка N плиток-букв по окружности (12 часов — старт, по часовой). */
export function tilePositions(n: number, radius: number, center: number): TilePos[] {
  return Array.from({ length: n }, (_, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: center + radius * Math.cos(ang), y: center + radius * Math.sin(ang) };
  });
}

/** Индекс плитки под точкой (radius — радиус попадания), либо -1. */
export function hitTile(pos: TilePos[], x: number, y: number, r: number): number {
  for (let i = 0; i < pos.length; i++) {
    const dx = pos[i].x - x;
    const dy = pos[i].y - y;
    if (dx * dx + dy * dy <= r * r) return i;
  }
  return -1;
}

/** Слово из выбранных индексов и набора букв диска. */
export function wordFromSelection(letters: string[], selection: number[]): string {
  return selection.map((i) => letters[i]).join('');
}
