import { hitTile, tilePositions, wordFromSelection } from '../geometry';

describe('geometry', () => {
  test('tilePositions раскладывает N плиток', () => {
    expect(tilePositions(3, 100, 130)).toHaveLength(3);
  });
  test('hitTile находит плитку под точкой и -1 вне', () => {
    const p = tilePositions(3, 100, 130);
    expect(hitTile(p, p[0].x, p[0].y, 24)).toBe(0);
    expect(hitTile(p, 9999, 9999, 24)).toBe(-1);
  });
  test('wordFromSelection собирает слово', () => {
    expect(wordFromSelection(['к', 'о', 'т'], [0, 1, 2])).toBe('кот');
  });
});
