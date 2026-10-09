import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { colors, radius, shadowCard } from './theme';

type ButtonVariant = 'primary' | 'accent' | 'glass';

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: colors.playGreenDark,
  accent: colors.amber,
  glass: colors.glassStrong,
};
const VARIANT_EDGE: Record<ButtonVariant, string> = {
  primary: colors.playGreen,
  accent: colors.amberDeep,
  glass: colors.glassBorder,
};
const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: colors.onGreen,
  accent: colors.onAmber,
  glass: colors.text,
};
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  const scale = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => { if (!disabled && !reducedMotion) scale.set(withTiming(0.97, { duration: 110 })); }}
      onPressOut={() => { scale.set(withTiming(1, { duration: 140 })); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.btn,
        shadowCard,
        {
          backgroundColor: disabled ? colors.glass : VARIANT_BG[variant],
          minHeight: large ? 62 : 52,
          paddingVertical: large ? 16 : 12,
          paddingHorizontal: large ? 28 : 22,
          borderColor: disabled ? colors.glassBorder : VARIANT_EDGE[variant],
          opacity: disabled ? 0.62 : 1,
        },
        style,
        animatedStyle,
      ]}
    >
      {icon ? <Icon name={icon} size={large ? 26 : 22} color={disabled ? colors.disabled : VARIANT_FG[variant]} /> : null}
      <AppText
        preset={large ? 'title' : 'label'}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={{ color: disabled ? colors.disabled : VARIANT_FG[variant], flexShrink: 1, textAlign: 'center' }}
      >
        {label}
      </AppText>
    </AnimatedPressable>
  );
}

/** Тактильная «clay»-панель поверх фото (матовое стекло + кант + мягкая тень). */
export function GlassPanel({
  children,
  style,
  strong = false,
  tone = 'dark',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
  tone?: 'dark' | 'cream';
}) {
  return (
    <View
      style={[
        styles.glass,
        shadowCard,
        tone === 'cream' ? styles.creamPanel : {
          backgroundColor: strong ? colors.glassStrong : colors.glass,
          borderColor: colors.glassBorder,
        },
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
      <AppText preset="coin" style={{ color: colors.text }}>{value}</AppText>
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
    borderWidth: 1,
    borderBottomWidth: 4,
  },
  glass: {
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: 1,
  },
  creamPanel: {
    backgroundColor: colors.cream,
    borderColor: colors.goldBorder,
  },
  coin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(35,25,42,0.72)',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
});
