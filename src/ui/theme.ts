import { WORLDS } from '@/core/config/worlds';

/** Travel postcard palette shared by gameplay, rewards and the collection. */
export const colors = {
  // Existing semantic aliases remain for screens outside the travel flow.
  green: '#1E7A46',
  greenDark: '#155C34',
  amber: '#EBA63D',
  amberDeep: '#C07A1E',
  ink: '#13202F',

  // Scenic word-puzzle surfaces, adapted to the game's own destinations.
  cream: '#FFF6D9',
  creamDeep: '#F5E6BE',
  brown: '#56391F',
  plum: '#4B175E',
  plumDeep: '#32103F',
  goldBorder: '#D9B735',
  playGreen: '#22AC12',
  playGreenDark: '#137607',

  // текст (на фото/тёмных панелях — белый, высокий контраст)
  text: '#FFFFFF',
  textInk: '#13202F',
  textMuted: 'rgba(255,255,255,0.84)',
  onGreen: '#FFFFFF',
  onAmber: '#13202F',

  // «clay»-панели поверх фото (тёмное матовое стекло + мягкая тень + светлый кант)
  glass: 'rgba(18,28,44,0.50)',
  glassStrong: 'rgba(14,22,36,0.72)',
  glassBorder: 'rgba(255,255,255,0.26)',
  scrim: 'rgba(10,14,24,0.55)',
  shadow: '#060B14',

  // статусы
  success: '#3FD27E',
  danger: '#FF6B6B',

  // кроссворд
  gridEmpty: 'rgba(255,248,224,0.54)',
  gridEmptyStrong: 'rgba(255,248,224,0.74)',
  gridStroke: 'rgba(255,255,255,0.84)',
  gridFilled: '#4B175E',
  gridHint: '#F8D95A',
  gridText: '#FFFFFF',

  // диск букв
  tile: '#FFFDF6',
  tileActive: '#F9D955',
  tileInk: '#1E1923',
  tileShadow: 'rgba(6,11,20,0.45)',
  linkLine: '#FFFFFF',
  disabled: 'rgba(255,255,255,0.36)',
  offline: 'rgba(235,166,61,0.18)',

  // легаси-алиасы
  bgTop: '#2A3F6B',
  bgBottom: '#0E1624',
  surface: 'rgba(14,22,36,0.72)',
  surfaceAlt: 'rgba(18,28,44,0.50)',
  primary: '#1E7A46',
  primaryText: '#FFFFFF',
  accent: '#EBA63D',
  gridCell: 'rgba(255,248,224,0.54)',
  diskTile: '#FFFDF6',
  diskTileActive: '#F9D955',
} as const;

export const space = [0, 4, 8, 12, 16, 24, 32, 48] as const;
export const radius = { sm: 10, md: 16, lg: 22, xl: 30, pill: 999 } as const;

/** Мягкая «clay»-тень для панелей и кнопок (тактильность для 35+). */
export const shadowCard = {
  shadowColor: colors.shadow,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.32,
  shadowRadius: 14,
  elevation: 8,
} as const;

export const fonts = {
  display: 'Nunito_800ExtraBold',
  title: 'Nunito_800ExtraBold',
  body: 'Nunito_600SemiBold',
  label: 'Nunito_700Bold',
  tile: 'Nunito_800ExtraBold',
} as const;

export type WorldTheme = { name: string };

/** Темы миров: название (фон — игровой арт, см. WorldBackground). */
export const worldThemes: Record<string, WorldTheme> = Object.fromEntries(
  WORLDS.map((world) => [world.id, { name: world.title }]),
);

export function worldTheme(world: string): WorldTheme {
  return worldThemes[world] ?? worldThemes.world1;
}
