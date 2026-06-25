/** Токены дизайн-системы (спека 04). Цвета только отсюда. */
export const colors = {
  bgTop: '#16243b',
  bgBottom: '#101826',
  surface: '#1d2c44',
  surfaceAlt: '#26395a',
  primary: '#ffb020',
  primaryText: '#1a1300',
  accent: '#4ec5f1',
  success: '#5fd38a',
  danger: '#ef6a6a',
  text: '#f3f6fb',
  textMuted: '#9fb0c8',
  gridEmpty: '#243650',
  gridCell: '#2b3e5e',
  gridFilled: '#ffb020',
  diskTile: '#ffffff',
  diskTileActive: '#ffd97a',
  linkLine: '#ffd97a',
} as const;

export const space = [0, 4, 8, 12, 16, 24, 32, 48] as const;

export const radius = { sm: 8, md: 14, lg: 22, pill: 999 } as const;

export const fonts = {
  display: 'Unbounded_800ExtraBold',
  title: 'Unbounded_700Bold',
  body: 'Fredoka_500Medium',
  label: 'Fredoka_600SemiBold',
} as const;
