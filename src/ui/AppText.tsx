import { StyleSheet, Text, TextProps, TextStyle } from 'react-native';

import { colors, fonts } from './theme';

type Preset = 'display' | 'title' | 'body' | 'label' | 'tileLetter' | 'coin';

// Scenic backgrounds need a short dark shadow on display text.
const onPhotoShadow = {
  textShadowColor: 'rgba(32,18,39,0.5)',
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 5,
} as const;

const presets: Record<Preset, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 32, color: colors.text },
  title: { fontFamily: fonts.title, fontSize: 21, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.text },
  label: { fontFamily: fonts.label, fontSize: 16, color: colors.text },
  tileLetter: { fontFamily: fonts.tile, fontSize: 30, color: colors.tileInk },
  coin: { fontFamily: fonts.label, fontSize: 16, color: colors.text },
};

export function AppText({
  preset = 'body',
  style,
  ...rest
}: TextProps & { preset?: Preset }) {
  const overrideColor = StyleSheet.flatten(style)?.color;
  const shadow = (preset === 'display' || preset === 'title')
    && (overrideColor == null || overrideColor === colors.text)
    ? onPhotoShadow
    : null;
  return <Text {...rest} style={[presets[preset], shadow, style]} />;
}
