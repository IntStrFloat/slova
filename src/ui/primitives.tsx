import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { colors, radius } from './theme';

type ButtonVariant = 'primary' | 'accent' | 'glass';

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: colors.green,
  accent: colors.amber,
  glass: colors.glass,
};
const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: colors.onGreen,
  accent: colors.onAmber,
  glass: colors.text,
};

/** Основная кнопка-пилюля с press-scale (спека 04: scale-feedback, primary-action). */
export function AppButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  large = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  large?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: VARIANT_BG[variant],
          paddingVertical: large ? 18 : 13,
          paddingHorizontal: large ? 48 : 22,
          borderWidth: variant === 'glass' ? 1 : 0,
          borderColor: colors.glassBorder,
          transform: [{ scale: pressed ? 0.96 : 1 }],
          opacity: pressed ? 0.92 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={large ? 24 : 20} color={VARIANT_FG[variant]} /> : null}
      <AppText preset={large ? 'title' : 'label'} style={{ color: VARIANT_FG[variant] }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Стеклянная панель поверх живописного фона. */
export function GlassPanel({
  children,
  style,
  strong = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
}) {
  return (
    <View
      style={[
        styles.glass,
        { backgroundColor: strong ? colors.glassStrong : colors.glass },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Бейдж валюты (glass-пилюля + иконка + число). */
export function CoinBadge({ value }: { value: number }) {
  return (
    <View style={styles.coin}>
      <Icon name="coin" size={18} color={colors.amber} />
      <AppText preset="coin">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.pill,
  },
  glass: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: 16,
  },
  coin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.glassStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
});
