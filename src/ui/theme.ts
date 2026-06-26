/**
 * Дизайн-токены (спека 04, редизайн v2).
 * Направление: тёплый «travel»-каузальный word-game — живописный градиентный фон
 * (города/достопримечательности) + glass-панели + янтарные плитки-буквы.
 * Палитра: word-green #15803D + letter-amber #F4B740 (design-system ui-ux-pro-max).
 * Цвета — только отсюда.
 */
export const colors = {
  // бренд
  green: '#1C8A4A',
  greenDark: '#0F5C2E',
  amber: '#F4B740',
  amberDeep: '#D97706',
  ink: '#10233A',

  // текст
  text: '#FFFFFF',
  textInk: '#10233A',
  textMuted: 'rgba(255,255,255,0.80)',
  onAmber: '#10233A',
  onGreen: '#FFFFFF',

  // glass-поверхности поверх живописного фона
  glass: 'rgba(255,255,255,0.16)',
  glassStrong: 'rgba(18,30,52,0.55)',
  glassBorder: 'rgba(255,255,255,0.30)',
  scrim: 'rgba(8,14,26,0.55)',

  // статусы
  success: '#34D27B',
  danger: '#FF6B6B',

  // кроссворд
  gridEmpty: 'rgba(255,255,255,0.15)',
  gridStroke: 'rgba(255,255,255,0.32)',
  gridFilled: '#F4B740',
  gridText: '#10233A',

  // диск букв
  tile: '#FFFFFF',
  tileActive: '#F4B740',
  tileInk: '#10233A',
  tileShadow: 'rgba(8,14,26,0.35)',
  linkLine: '#FFFFFF',

  // легаси-алиасы (на случай старых ссылок)
  bgTop: '#2A3F6B',
  bgBottom: '#101826',
  surface: 'rgba(18,30,52,0.55)',
  surfaceAlt: 'rgba(255,255,255,0.16)',
  primary: '#1C8A4A',
  primaryText: '#FFFFFF',
  accent: '#F4B740',
  gridCell: 'rgba(255,255,255,0.15)',
  diskTile: '#FFFFFF',
  diskTileActive: '#F4B740',
} as const;

export const space = [0, 4, 8, 12, 16, 24, 32, 48] as const;
export const radius = { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 } as const;

export const fonts = {
  display: 'Unbounded_800ExtraBold',
  title: 'Unbounded_700Bold',
  body: 'Fredoka_500Medium',
  label: 'Fredoka_600SemiBold',
} as const;

export type WorldTheme = {
  name: string;
  sky: [string, string, string];
  silhouette: string;
  sun: string;
  landmark: 'paris' | 'city' | 'kremlin';
};

/** Темы миров: градиент неба + цвет силуэта + достопримечательность (спека 07). */
export const worldThemes: Record<string, WorldTheme> = {
  world1: { name: 'Париж', sky: ['#F7B05B', '#E87A5D', '#6B3A86'], silhouette: '#241634', sun: '#FFE7A6', landmark: 'paris' },
  world2: { name: 'Нью-Йорк', sky: ['#5AA9E6', '#3B6FB0', '#152A47'], silhouette: '#0E1D33', sun: '#FFF2C2', landmark: 'city' },
  world3: { name: 'Москва', sky: ['#8A86D6', '#5B4E8C', '#221A39'], silhouette: '#181230', sun: '#FFE7A6', landmark: 'kremlin' },
};

export function worldTheme(world: string): WorldTheme {
  return worldThemes[world] ?? worldThemes.world1;
}
