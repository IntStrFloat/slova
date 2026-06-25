import { Text, TextProps, TextStyle } from 'react-native';

import { colors, fonts } from './theme';

type Preset = 'display' | 'title' | 'body' | 'label' | 'tileLetter' | 'coin';

const presets: Record<Preset, TextStyle> = {
  display: { fontFamily: fonts.display, fontSize: 30, color: colors.text },
  title: { fontFamily: fonts.title, fontSize: 20, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 16, color: colors.text },
  label: { fontFamily: fonts.label, fontSize: 16, color: colors.text },
  tileLetter: { fontFamily: fonts.title, fontSize: 26, color: colors.primaryText },
  coin: { fontFamily: fonts.label, fontSize: 16, color: colors.primary },
};

export function AppText({
  preset = 'body',
  style,
  ...rest
}: TextProps & { preset?: Preset }) {
  return <Text {...rest} style={[presets[preset], style]} />;
}
