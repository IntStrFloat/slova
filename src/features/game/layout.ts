const GRID_GAP = 5;
const MIN_GRID_CELL = 24;
const MAX_GRID_CELL = 42;
// Eight letters need a comfortable ring even when the crossword must scroll.
const MIN_DISK_SIZE = 280;
const MAX_DISK_SIZE = 350;

/** A short letter set needs less visual space than a dense wheel. */
export function preferredLetterDiskSize(letterCount: number): number {
  if (letterCount <= 3) return 250;
  if (letterCount === 4) return 280;
  if (letterCount === 5) return 295;
  if (letterCount === 6) return 320;
  if (letterCount === 7) return 335;
  return MAX_DISK_SIZE;
}

/** Reserve more of a short screen for the crossword when the wheel has few letters. */
export function minimumLetterDiskSize(letterCount: number, availableHeight: number): number {
  const compact = availableHeight <= 600;
  if (letterCount <= 4) return compact ? 225 : 240;
  if (letterCount <= 6) return compact ? 225 : 240;
  return compact ? 260 : 280;
}

/** Text scales independently of selection geometry; adjacent targets stay unchanged. */
export function letterDiskFontSize(diskSize: number, fontScale = 1): number {
  const tileRadius = Math.max(21, Math.min(34, diskSize * 0.106));
  const scale = Number.isFinite(fontScale) ? Math.max(1, Math.min(1.3, fontScale)) : 1;
  return Math.min(tileRadius * 1.6, Math.max(27, tileRadius * 1.1) * 1.17 * scale);
}

export function crosswordLetterFontSize(cell: number, fontScale = 1): number {
  const scale = Number.isFinite(fontScale) ? Math.max(1, Math.min(1.3, fontScale)) : 1;
  return Math.min(cell - 6, cell * 0.67 * scale);
}

type CrosswordGridSizeInput = {
  cols: number;
  rows: number;
  maxWidth: number;
  maxHeight?: number;
};

export type CrosswordGridSize = {
  cell: number;
  width: number;
  height: number;
};

export function calculateCrosswordGridSize({
  cols,
  rows,
  maxWidth,
  maxHeight,
}: CrosswordGridSizeInput): CrosswordGridSize {
  const byWidth = Math.floor((maxWidth - (cols + 1) * GRID_GAP) / cols);
  const byHeight = maxHeight == null
    ? MAX_GRID_CELL
    : Math.floor((maxHeight - (rows + 1) * GRID_GAP) / rows);
  const cell = Math.max(MIN_GRID_CELL, Math.min(MAX_GRID_CELL, byWidth, byHeight));

  return {
    cell,
    width: cols * cell + (cols + 1) * GRID_GAP,
    height: rows * cell + (rows + 1) * GRID_GAP,
  };
}

type GameLayoutInput = {
  availableHeight: number;
  bonusHeight: number;
  captionHeight?: number;
  cols: number;
  hintHeight: number;
  objectiveHeight: number;
  rows: number;
  width: number;
  minDiskSize?: number;
  maxDiskSize?: number;
};

export type GameLayout = {
  compact: boolean;
  contentGap: number;
  controlGap: number;
  diskSize: number;
  grid: CrosswordGridSize;
  horizontalInset: number;
  occupiedHeight: number;
  paddingBottom: number;
  paddingTop: number;
};

export function calculateGameLayout({
  availableHeight,
  bonusHeight,
  captionHeight = 0,
  cols,
  hintHeight,
  objectiveHeight,
  rows,
  width,
  minDiskSize = MIN_DISK_SIZE,
  maxDiskSize = MAX_DISK_SIZE,
}: GameLayoutInput): GameLayout {
  const compact = availableHeight <= 700;
  const horizontalInset = width <= 370 ? 10 : 16;
  const contentGap = compact ? 8 : 12;
  const controlGap = compact ? 8 : 12;
  const paddingTop = compact ? 2 : 8;
  const paddingBottom = 12;
  const maxGridWidth = Math.max(1, width - horizontalInset * 2);
  const maxDiskWidth = Math.max(1, width - horizontalInset * 2 - 18);
  const preferredDiskSize = Math.min(maxDiskSize, maxDiskWidth);
  const minimumDiskSize = Math.min(minDiskSize, preferredDiskSize);
  const preferredGrid = calculateCrosswordGridSize({
    cols,
    rows,
    maxWidth: maxGridWidth,
    maxHeight: 300,
  });
  const objectiveGap = objectiveHeight > 0 ? contentGap : 0;
  const bonusGap = bonusHeight > 0 ? contentGap : 0;
  const captionGap = captionHeight > 0 ? contentGap : 0;
  const fixedHeight =
    paddingTop
    + paddingBottom
    + contentGap
    + controlGap
    + hintHeight
    + captionGap
    + captionHeight
    + objectiveGap
    + objectiveHeight
    + bonusGap
    + bonusHeight;
  const scalableHeight = Math.max(0, availableHeight - fixedHeight);
  const preferredScalableHeight = preferredDiskSize + preferredGrid.height;
  let remainingOverflow = Math.max(0, preferredScalableHeight - scalableHeight);
  const diskShrink = Math.min(
    remainingOverflow,
    Math.max(0, preferredDiskSize - minimumDiskSize),
  );
  const diskSize = Math.round(preferredDiskSize - diskShrink);
  remainingOverflow -= diskShrink;
  const gridHeightBudget = Math.max(0, preferredGrid.height - remainingOverflow);
  const grid = calculateCrosswordGridSize({
    cols,
    rows,
    maxWidth: maxGridWidth,
    maxHeight: gridHeightBudget,
  });
  const occupiedHeight = fixedHeight + diskSize + grid.height;

  return {
    compact,
    contentGap,
    controlGap,
    diskSize,
    grid,
    horizontalInset,
    occupiedHeight,
    paddingBottom,
    paddingTop,
  };
}
