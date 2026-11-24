import { StyleSheet } from 'react-native';
import Animated, { Easing, FadeInDown, FadeOutUp, useReducedMotion } from 'react-native-reanimated';

import { AppText, colors } from '@/ui';
import type { Level } from '@/core/engine';

import { mockLevelCompletionPercent } from './levelCompletionPercent';

/** Caller positions this outside gameplay layout and controls first-start timing. */
export function LevelStartNote({ level, visible }: { level: Level; visible: boolean }) {
  const reducedMotion = useReducedMotion();
  if (!visible) return null;
  const percent = mockLevelCompletionPercent(level);
  const challenge = `${percent}% игроков прошли этот уровень. ${percent <= 50 ? 'Примете вызов?' : 'А вы?'}`;
  const enter = reducedMotion ? undefined : FadeInDown.duration(200)
    .easing(Easing.bezier(0.23, 1, 0.32, 1))
    .withInitialValues({ opacity: 0, transform: [{ translateY: -8 }] });
  const exit = reducedMotion ? undefined : FadeOutUp.duration(150).easing(Easing.bezier(0.23, 1, 0.32, 1));

  return (
    <Animated.View
      testID="level-start-note"
      accessible
      accessibilityRole="text"
      accessibilityLabel={challenge}
      pointerEvents="none"
      entering={reducedMotion ? undefined : enter}
      exiting={reducedMotion ? undefined : exit}
      style={styles.card}
    >
      <AppText preset="label" style={styles.message}>{challenge}</AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center', maxWidth: 320, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 14, borderWidth: 1, borderColor: colors.glassBorder,
    backgroundColor: colors.glassStrong,
  },
  message: { color: colors.cream, fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
