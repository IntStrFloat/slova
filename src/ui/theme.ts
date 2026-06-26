/**
 * Дизайн-токены v3 — под аудиторию 30–35+ (спека 04).
 * Принципы: спокойная премиальная палитра, высокий контраст (≥4.5:1), крупная
 * типографика, тактильные «clay»-панели с мягкой тенью, реальные фото-фоны.
 * Палитра: word-green + reward-gold (design-system ui-ux-pro-max).
 * Цвета — только отсюда.
 */
export const colors = {
  // бренд (спокойные, премиальные тона)
  green: '#1E7A46',
  greenDark: '#155C34',
  amber: '#EBA63D',
  amberDeep: '#C07A1E',
  ink: '#13202F',

  // текст (на фото/тёмных панелях — белый, высокий контраст)
  text: '#FFFFFF',
  textInk: '#13202F',
  textMuted: 'rgba(255,255,255,0.84)',
  onGreen: '#FFFFFF',
  onAmber: '#13202F',

  // «clay»-панели поверх фото (тёмное матовое стекло + мягкая тень + светлый кант)
  glass: 'rgba(18,28,44,0.50)',
  glassStrong: 'rgba(14,22,36,0.72)',
  glassBorder: 'rgba(255,255,255,0.18)',
  scrim: 'rgba(10,14,24,0.55)',
  shadow: '#060B14',

  // статусы
  success: '#3FD27E',
  danger: '#FF6B6B',

  // кроссворд
  gridEmpty: 'rgba(255,251,242,0.20)',
  gridStroke: 'rgba(255,255,255,0.46)',
  gridFilled: '#EBA63D',
  gridText: '#13202F',

  // диск букв
  tile: '#FFFDF7',
  tileActive: '#EBA63D',
  tileInk: '#13202F',
  tileShadow: 'rgba(6,11,20,0.45)',
  linkLine: '#FFFFFF',

  // легаси-алиасы
  bgTop: '#2A3F6B',
  bgBottom: '#0E1624',
  surface: 'rgba(14,22,36,0.72)',
  surfaceAlt: 'rgba(18,28,44,0.50)',
  primary: '#1E7A46',
  primaryText: '#FFFFFF',
  accent: '#EBA63D',
  gridCell: 'rgba(255,251,242,0.20)',
  diskTile: '#FFFDF7',
  diskTileActive: '#EBA63D',
} as const;

export const space = [0, 4, 8, 12, 16, 24, 32, 48] as const;
export const radius = { sm: 12, md: 18, lg: 26, xl: 34, pill: 999 } as const;

/** Мягкая «clay»-тень для панелей и кнопок (тактильность для 35+). */
export const shadowCard = {
  shadowColor: colors.shadow,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.32,
  shadowRadius: 14,
  elevation: 8,
} as const;

export const fonts = {
  display: 'Lora_700Bold',
  title: 'Lora_600SemiBold',
  body: 'Nunito_500Medium',
  label: 'Nunito_700Bold',
  tile: 'Nunito_800ExtraBold',
} as const;

export type WorldTheme = { name: string };

/** Темы миров: название (фон — реальное фото, см. WorldBackground). */
export const worldThemes: Record<string, WorldTheme> = {
  world1: { name: 'Париж' },
  world2: { name: 'Нью-Йорк' },
  world3: { name: 'Москва' },
};

export function worldTheme(world: string): WorldTheme {
  return worldThemes[world] ?? worldThemes.world1;
}
