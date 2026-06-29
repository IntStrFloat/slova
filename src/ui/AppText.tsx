import { Text, TextProps, TextStyle } from 'react-native';

import { colors, fonts } from './theme';

type Preset = 'display' | 'title' | 'body' | 'label' | 'tileLetter' | 'coin';

// Тень для белого текста поверх фото — гарантирует читаемость (аудитория 35+).
const onPhotoShadow = {
  textShadowColor: 'rgba(6,11,20,0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
} as const;

const presets: Record<Preset, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 30, color: colors.text, ...onPhotoShadow },
  title: { fontFamily: fonts.title, fontSize: 20, color: colors.text, ...onPhotoShadow },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.text },
  label: { fontFamily: fonts.label, fontSize: 15, color: colors.text },
  tileLetter: { fontFamily: fonts.tile, fontSize: 28, color: colors.tileInk },
  coin: { fontFamily: fonts.label, fontSize: 15, color: colors.amber },
};

export function AppText({
  preset = 'body',
  style,
  ...rest
}: TextProps & { preset?: Preset }) {
  return <Text {...rest} style={[presets[preset], style]} />;
}
