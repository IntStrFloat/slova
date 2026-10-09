import { Pressable, View } from 'react-native';

import type { Level } from '@/core/engine/types';
import { AppText, colors, Icon, radius } from '@/ui';

import { levelObjectiveProgress } from './objectives';

export function LevelObjective({
  level,
  foundBonus,
  hintsUsed,
  mistakes,
  solvedWords,
  bankUnits,
  compact = false,
  clue,
  cluePrice,
  clueOpen = false,
  clueAccent = false,
  onCluePress,
}: {
  level: Level;
  foundBonus: number;
  hintsUsed: number;
  mistakes: number;
  solvedWords: number;
  bankUnits?: number;
  compact?: boolean;
  clue?: string;
  cluePrice?: number;
  clueOpen?: boolean;
  clueAccent?: boolean;
  onCluePress?: () => void;
}) {
  const objective = levelObjectiveProgress(level, {
    foundBonus,
    hintsUsed,
    mistakes,
    solvedWords,
  });
  if (!objective) return null;

  const statusColor = objective.failed
    ? colors.danger
    : objective.complete
      ? colors.playGreen
      : colors.brown;

  return (
    <View style={{ width: '100%', maxWidth: 340, alignSelf: 'center' }}>
      <View
        style={{
          width: '100%',
          paddingVertical: compact ? 7 : 9,
          paddingHorizontal: 13,
          borderRadius: radius.md,
          gap: 5,
          backgroundColor: colors.cream,
          borderWidth: 1,
          borderColor: colors.goldBorder,
        }}
      >
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={`${objective.label}. ${objective.progressText}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <Icon name={objective.icon} size={compact ? 18 : 20} color={statusColor} />
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <AppText preset="label" numberOfLines={2} style={{ color: colors.brown, fontSize: compact ? 12 : 13 }}>
              {objective.label}
            </AppText>
            <AppText
              preset="body"
              style={{ color: objective.failed ? colors.danger : colors.brown, fontSize: compact ? 11 : 12 }}
            >
              {objective.progressText}
            </AppText>
          </View>
          {objective.reward > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon name="coin" size={14} color={colors.brown} />
              <AppText preset="label" style={{ color: colors.brown, fontSize: 12 }}>
                +{objective.reward}
              </AppText>
            </View>
          ) : null}
        </View>
        {bankUnits != null || clue ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {bankUnits != null ? (
              <AppText preset="body" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ flex: 1, color: colors.brown, fontSize: compact ? 10 : 11 }}>
                Копилка {bankUnits}/10{clue ? '' : ' · каждые 10 слов дают 50 монет'}
              </AppText>
            ) : null}
            {clue && onCluePress ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Смысловая наводка, ${cluePrice ?? 30} монет`}
                accessibilityState={{ expanded: clueOpen }}
                onPress={onCluePress}
                style={{ minHeight: 44, minWidth: 88, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.goldBorder, backgroundColor: clueAccent ? colors.creamDeep : colors.cream, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <AppText preset="label" style={{ color: colors.brown, fontSize: 11 }}>Наводка · {cluePrice ?? 30}</AppText>
                  <Icon name="coin" size={12} color={colors.brown} />
                </View>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
