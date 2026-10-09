import type { Level } from '@/core/engine/types';

import {
  constraintCaption,
  feedbackAnnouncement,
  feedbackCaption,
  gridAccessibilitySummary,
} from '../accessibility';

const level: Level = {
  id: 1,
  world: 'world1',
  letters: ['к', 'о', 'т'],
  difficulty: 1,
  grid: {
    rows: 1,
    cols: 3,
    cells: [
      { row: 0, col: 0, ch: 'к' },
      { row: 0, col: 1, ch: 'о' },
      { row: 0, col: 2, ch: 'т' },
    ],
  },
  answers: [
    {
      word: 'кот',
      dir: 'H',
      cells: [
        { row: 0, col: 0, ch: 'к' },
        { row: 0, col: 1, ch: 'о' },
        { row: 0, col: 2, ch: 'т' },
      ],
    },
  ],
  bonusPool: ['ток'],
};

describe('game accessibility helpers', () => {
  test('returns distinct captions and live-region messages for every outcome', () => {
    expect(feedbackCaption('grid')).toBe('Слово в сетке');
    expect(feedbackCaption('bonus')).toBe('Бонусное слово');
    expect(feedbackCaption('duplicate')).toBe('Уже было');
    expect(feedbackCaption('invalid')).toBe('Не подходит');
    expect(feedbackCaption('blocked')).toBe('Слово недоступно');
    expect(feedbackCaption('constraint')).toBe('Сначала короткое слово');

    expect(feedbackAnnouncement('кот', 'grid')).toBe('Слово КОТ добавлено в сетку.');
    expect(feedbackAnnouncement('ток', 'bonus')).toBe('Слово ТОК засчитано как бонусное.');
    expect(feedbackAnnouncement('кот', 'duplicate')).toBe('Слово КОТ уже было найдено.');
    expect(feedbackAnnouncement('тт', 'invalid')).toBe('Слово ТТ не подходит.');
    expect(feedbackAnnouncement('имя', 'blocked')).toBe('Слово ИМЯ недоступно для этой игры.');
    expect(feedbackAnnouncement('дом', 'constraint', { expectedLength: 3 })).toBe('Сначала нужно слово из 3 букв.');
  });

  test('builds a concise grid summary and constraint caption', () => {
    expect(constraintCaption(4)).toBe('Сначала слово из 4 букв');
    expect(gridAccessibilitySummary(level, { '0,0': 'к', '0,1': 'о' })).toBe(
      'Кроссворд: заполнено 2 из 3 клеток. Собрано 0 из 1 слова.',
    );
  });
});
