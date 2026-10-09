import { calculateCrosswordGridSize, calculateGameLayout, crosswordLetterFontSize, letterDiskFontSize, minimumLetterDiskSize, preferredLetterDiskSize } from '../layout';
import { loadGlobalLevel, totalLevelCount } from '@/features/levels/loader';
import { tilePositions } from '../geometry';

describe('game layout', () => {
  test('scales the preferred wheel size with letter count while preserving a playable minimum', () => {
    const sizes = [3, 4, 5, 6, 7, 8].map((count) => preferredLetterDiskSize(count));
    expect(sizes).toEqual([250, 280, 295, 320, 335, 350]);
    for (const count of [3, 4, 5, 6, 7, 8]) {
      expect(preferredLetterDiskSize(count)).toBeGreaterThanOrEqual(minimumLetterDiskSize(count, 700));
    }
  });

  test('enlarges glyphs independently of hit geometry and keeps large text inside cells', () => {
    for (const size of [195, 225, 250, 280, 320, 350]) {
      const tileRadius = Math.max(21, Math.min(34, size * 0.106));
      const previous = Math.max(27, tileRadius * 1.1);
      expect(letterDiskFontSize(size)).toBeGreaterThanOrEqual(previous * 1.15);
      expect(letterDiskFontSize(size)).toBeLessThanOrEqual(previous * 1.2);
      expect(letterDiskFontSize(size, 2)).toBeLessThanOrEqual(tileRadius * 1.6);
      expect(letterDiskFontSize(size, 2)).toBeGreaterThan(letterDiskFontSize(size));
    }
    for (const cell of [24, 32, 42]) {
      expect(crosswordLetterFontSize(cell)).toBeGreaterThan(cell * 0.58);
      expect(crosswordLetterFontSize(cell, 2)).toBeLessThanOrEqual(cell - 6);
    }
  });

  test('keeps a readable early board and a larger wheel on a 320 by 568 phone', () => {
    const layout = calculateGameLayout({
      width: 320, availableHeight: 432, cols: 3, rows: 3,
      bonusHeight: 0, hintHeight: 0, objectiveHeight: 0, captionHeight: 40,
      minDiskSize: 225, maxDiskSize: 250,
    });
    expect(layout.occupiedHeight).toBeLessThanOrEqual(432);
    expect(layout.diskSize).toBeGreaterThanOrEqual(225);
    expect(layout.grid.cell).toBeGreaterThanOrEqual(24);
    expect(letterDiskFontSize(layout.diskSize)).toBeGreaterThanOrEqual(31);
  });

  test('keeps the level-24 layout within a short wide Android viewport', () => {
    const layout = calculateGameLayout({
      availableHeight: 793,
      bonusHeight: 36,
      cols: 5,
      hintHeight: 78,
      objectiveHeight: 0,
      rows: 7,
      width: 497,
    });

    expect(layout.occupiedHeight).toBeLessThanOrEqual(793);
    expect(layout.diskSize).toBeGreaterThanOrEqual(280);
    expect(layout.grid.height).toBeGreaterThanOrEqual(208);
  });

  test('shrinks the wheel before making crossword cells unreadably small', () => {
    const roomy = calculateGameLayout({
      availableHeight: 793,
      bonusHeight: 36,
      cols: 5,
      hintHeight: 78,
      objectiveHeight: 0,
      rows: 7,
      width: 497,
    });
    const compact = calculateGameLayout({
      availableHeight: 650,
      bonusHeight: 36,
      cols: 5,
      hintHeight: 70,
      objectiveHeight: 0,
      rows: 7,
      width: 497,
    });

    expect(compact.occupiedHeight).toBeLessThanOrEqual(650);
    expect(compact.diskSize).toBeLessThan(roomy.diskSize);
    expect(compact.grid.cell).toBeGreaterThanOrEqual(24);
  });

  test('keeps objective, bonus progress, hints, and the wheel within a level-400 viewport', () => {
    const layout = calculateGameLayout({
      availableHeight: 793,
      bonusHeight: 60,
      cols: 8,
      hintHeight: 78,
      objectiveHeight: 60,
      rows: 6,
      width: 393,
    });

    expect(layout.occupiedHeight).toBeLessThanOrEqual(793);
    expect(layout.grid.cell).toBeGreaterThanOrEqual(24);
  });

  test('keeps a playable wheel on a compact level-400 viewport', () => {
    const layout = calculateGameLayout({
      availableHeight: 673,
      bonusHeight: 60,
      cols: 8,
      hintHeight: 78,
      objectiveHeight: 0,
      rows: 6,
      width: 411,
    });

    expect(layout.occupiedHeight).toBeLessThanOrEqual(673);
    expect(layout.diskSize).toBeGreaterThanOrEqual(280);
    expect(layout.grid.cell).toBeGreaterThanOrEqual(24);
  });

  test('grid size reports the real SVG bounds after cell clamping', () => {
    expect(
      calculateCrosswordGridSize({
        cols: 5,
        maxHeight: 245,
        maxWidth: 465,
        rows: 7,
      }),
    ).toEqual({ cell: 29, height: 243, width: 175 });
  });

  test.each([20, 60])('reserves %i dp for the first daily caption above a compact grid', (captionHeight) => {
    const layout = calculateGameLayout({
      availableHeight: 420,
      bonusHeight: 0,
      captionHeight,
      cols: 4,
      hintHeight: 0,
      objectiveHeight: 0,
      rows: 3,
      width: 320,
      minDiskSize: 195,
      maxDiskSize: 235,
    });

    expect(layout.occupiedHeight).toBeLessThanOrEqual(420);
    expect(layout.diskSize).toBeGreaterThanOrEqual(195);
    expect(layout.grid.cell).toBeGreaterThanOrEqual(24);
  });

  test('fits level 16 and its bonus row on a short 320 dp screen', () => {
    const level = loadGlobalLevel(16)!;
    const layout = calculateGameLayout({
      availableHeight: 430,
      bonusHeight: 60,
      cols: level.grid.cols,
      hintHeight: 0,
      objectiveHeight: 0,
      rows: level.grid.rows,
      width: 320,
      minDiskSize: minimumLetterDiskSize(level.letters.length, 430),
    });

    expect(level.letters).toHaveLength(4);
    expect(layout.occupiedHeight).toBeLessThanOrEqual(430);
    expect(layout.grid.cell).toBeGreaterThanOrEqual(24);
    expect(layout.diskSize).toBeGreaterThanOrEqual(195);
  });

  test.each([320, 360, 393, 411])('keeps every campaign wheel playable at width %i', (width) => {
    for (let id = 1; id <= totalLevelCount(); id += 1) {
      const level = loadGlobalLevel(id)!;
      const layout = calculateGameLayout({
        width,
        availableHeight: 440,
        rows: level.grid.rows,
        cols: level.grid.cols,
        bonusHeight: 60,
        objectiveHeight: 60,
        hintHeight: 0,
        minDiskSize: minimumLetterDiskSize(level.letters.length, 440),
        maxDiskSize: preferredLetterDiskSize(level.letters.length),
      });
      expect(layout.diskSize).toBeGreaterThanOrEqual(minimumLetterDiskSize(level.letters.length, 440));
      expect(layout.diskSize).toBeLessThanOrEqual(width - layout.horizontalInset * 2);
      expect(layout.grid.cell).toBeGreaterThanOrEqual(24);
      const tileRadius = Math.max(21, Math.min(34, layout.diskSize * 0.106));
      const hitRadius = tileRadius + 10;
      expect(hitRadius * 2).toBeGreaterThanOrEqual(48);
      const positions = tilePositions(level.letters.length, layout.diskSize / 2 - tileRadius - 10, layout.diskSize / 2);
      for (let i = 0; i < positions.length; i += 1) {
        const a = positions[i];
        const b = positions[(i + 1) % positions.length];
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(tileRadius * 2 + 4);
      }
    }
  });

  test('preserves letter and grid sizes when the board needs scrolling on a short screen', () => {
    const layout = calculateGameLayout({
      availableHeight: 440,
      width: 320,
      rows: 9,
      cols: 10,
      objectiveHeight: 60,
      bonusHeight: 60,
      hintHeight: 0,
    });
    expect(layout.diskSize).toBe(280);
    expect(layout.grid.cell).toBe(24);
    expect(layout.occupiedHeight).toBeGreaterThan(440);
  });
});
