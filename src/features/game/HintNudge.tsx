import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, FadeInUp, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { AppText, colors } from '@/ui';

/** Caller owns eligibility/timing and anchors this bubble immediately above the bulb. */
export function HintNudge({ visible, onPress, style }: {
  visible: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  if (!visible) return null;
  const entrance = reducedMotion ? undefined : FadeInUp.duration(200)
    .easing(Easing.bezier(0.23, 1, 0.32, 1))
    .withInitialValues({ opacity: 0, transform: [{ translateY: 6 }] });
  const exit = reducedMotion ? undefined : FadeOut.duration(150).easing(Easing.bezier(0.23, 1, 0.32, 1));

  return (
    <Animated.View
      testID="hint-nudge"
      entering={reducedMotion ? undefined : entrance}
      exiting={reducedMotion ? undefined : exit}
      pointerEvents="box-none"
      style={[styles.anchor, style]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Не идёт слово? Попробуйте подсказку"
        accessibilityLiveRegion="polite"
        style={({ pressed }) => [styles.bubble, { backgroundColor: pressed ? colors.creamDeep : colors.cream }]}
      >
        <AppText preset="label" style={styles.title}>Не идёт слово?</AppText>
        <AppText preset="body" style={styles.message}>Попробуйте подсказку</AppText>
      </Pressable>
      <View pointerEvents="none" style={styles.tail} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: { maxWidth: 190, zIndex: 5 },
  bubble: {
    minHeight: 44, paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 12, borderWidth: 1, borderColor: colors.goldBorder,
    shadowColor: colors.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18, shadowRadius: 4, elevation: 3,
  },
  title: { color: colors.brown, fontSize: 11, lineHeight: 15 },
  message: { color: colors.brown, fontSize: 11, lineHeight: 15 },
  tail: {
    position: 'absolute', left: 21, bottom: -4, width: 8, height: 8,
    backgroundColor: colors.cream, borderRightWidth: 1, borderBottomWidth: 1,
    borderColor: colors.goldBorder, transform: [{ rotate: '45deg' }],
  },
});
