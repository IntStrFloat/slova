import { Pressable, StyleSheet, View } from 'react-native';

import { ECONOMY } from '@/core/config/economy';
import type { Level } from '@/core/engine/types';
import { AppText, colors, Icon, radius } from '@/ui';

import { levelObjectiveProgress } from './objectives';

/** Keep the optional chest and clue in one short row above the letter disk. */
export function CompactBonusObjective({
  level,
  foundBonus,
  bankUnits,
  clue,
  cluePrice = ECONOMY.hints.clue,
  clueOpen = false,
  clueAccent = false,
  onCluePress,
}: {
  level: Level;
  foundBonus: number;
  bankUnits?: number;
  clue?: string;
  cluePrice?: number;
  clueOpen?: boolean;
  clueAccent?: boolean;
  onCluePress?: () => void;
}) {
  if (level.mechanic !== 'bonus_chest') return null;
  const objective = levelObjectiveProgress(level, {
    foundBonus, hintsUsed: 0, mistakes: 0, solvedWords: 0,
  });
  if (!objective) return null;
  const progress = objective.progressText.split(' ')[0];
  const rewardText = objective.reward > 0 ? `, награда ${objective.reward} монет` : '';
  const bankText = bankUnits == null ? '' : `, копилка ${bankUnits} из ${ECONOMY.bonusBankThreshold}`;
  const priceText = cluePrice > 0 ? `${cluePrice} монет` : 'бесплатно';

  return (
    <View testID="compact-bonus-objective" style={styles.card}>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`${objective.label}. ${objective.progressText}${rewardText}${bankText}.`}
        style={styles.summary}
      >
        <Icon name={objective.icon} size={18} color={objective.complete ? colors.playGreen : colors.brown} />
        <View style={styles.copy}>
          <AppText preset="label" style={styles.title}>Бонусный сундук</AppText>
          <AppText preset="body" style={styles.progress}>
            {progress}{bankUnits == null ? '' : ` · Копилка ${bankUnits}/${ECONOMY.bonusBankThreshold}`}
          </AppText>
        </View>
        {objective.reward > 0 ? (
          <View style={styles.reward}>
            <Icon name="coin" size={11} color={colors.brown} />
            <AppText preset="label" style={styles.progress}>+{objective.reward}</AppText>
          </View>
        ) : null}
      </View>
      {clue && onCluePress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Смысловая наводка, ${priceText}`}
          accessibilityState={{ expanded: clueOpen }}
          onPress={onCluePress}
          style={({ pressed }) => [styles.clue, {
            backgroundColor: pressed || clueAccent ? colors.creamDeep : colors.cream,
          }]}
        >
          <AppText preset="label" style={styles.clueTitle}>Наводка</AppText>
          <View style={styles.price}>
            {cluePrice > 0 ? <Icon name="coin" size={10} color={colors.brown} /> : null}
            <AppText preset="body" style={styles.cluePrice}>{cluePrice > 0 ? cluePrice : 'Бесплатно'}</AppText>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%', maxWidth: 340, alignSelf: 'center', flexDirection: 'row',
    alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 5,
    minHeight: 56, borderRadius: radius.md, backgroundColor: colors.cream,
    borderWidth: 1, borderColor: colors.goldBorder,
  },
  summary: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: colors.brown, fontSize: 12, lineHeight: 16 },
  progress: { color: colors.brown, fontSize: 10, lineHeight: 14 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  clue: {
    minHeight: 44, minWidth: 68, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.goldBorder,
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  clueTitle: { color: colors.brown, fontSize: 10, lineHeight: 14 },
  cluePrice: { color: colors.brown, fontSize: 10, lineHeight: 13 },
  price: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
