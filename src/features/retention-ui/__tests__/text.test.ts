import { ruCount } from '../text';

it('uses Russian count forms across one, few, teen, and many progress states', () => {
  expect(ruCount(0, 'очко', 'очка', 'очков')).toBe('0 очков');
  expect(ruCount(1, 'очко', 'очка', 'очков')).toBe('1 очко');
  expect(ruCount(3, 'очко', 'очка', 'очков')).toBe('3 очка');
  expect(ruCount(5, 'очко', 'очка', 'очков')).toBe('5 очков');
  expect(ruCount(11, 'очко', 'очка', 'очков')).toBe('11 очков');
  expect(ruCount(21, 'очко', 'очка', 'очков')).toBe('21 очко');
  expect(ruCount(24, 'очко', 'очка', 'очков')).toBe('24 очка');
});
