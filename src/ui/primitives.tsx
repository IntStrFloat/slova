import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { colors, radius, shadowCard } from './theme';

type ButtonVariant = 'primary' | 'accent' | 'glass';

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: colors.green,
  accent: colors.amber,
  glass: colors.glassStrong,
};
const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: colors.onGreen,
  accent: colors.onAmber,
  glass: colors.text,
};

/** Кнопка-пилюля: крупная, тактильная (тень + press-scale). Тач-таргет ≥52. */
export function AppButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  large = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  large?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.btn,
        shadowCard,
        {
          backgroundColor: disabled ? colors.glass : VARIANT_BG[variant],
          minHeight: large ? 62 : 52,
          paddingVertical: large ? 18 : 14,
          paddingHorizontal: large ? 52 : 22,
          borderWidth: variant === 'glass' ? 1 : 0,
          borderColor: colors.glassBorder,
          transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
          opacity: disabled ? 0.62 : pressed ? 0.94 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={large ? 26 : 22} color={disabled ? colors.disabled : VARIANT_FG[variant]} /> : null}
      <AppText preset={large ? 'title' : 'label'} style={{ color: disabled ? colors.disabled : VARIANT_FG[variant] }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Тактильная «clay»-панель поверх фото (матовое стекло + кант + мягкая тень). */
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
        shadowCard,
        { backgroundColor: strong ? colors.glassStrong : colors.glass },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Бейдж валюты. */
export function CoinBadge({ value }: { value: number }) {
  return (
    <View style={[styles.coin, shadowCard]}>
      <Icon name="coin" size={20} color={colors.amber} />
      <AppText preset="coin">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: radius.pill,
  },
  glass: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    padding: 18,
  },
  coin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.glassStrong,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
});
