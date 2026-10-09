import type { IconName } from '@/ui';
import type { Level } from '@/core/engine/types';

export interface ObjectiveProgress {
  complete: boolean;
  failed: boolean;
  icon: IconName;
  label: string;
  progressText: string;
  reward: number;
}

export function levelObjectiveProgress(
  level: Level,
  {
    foundBonus,
    hintsUsed,
    mistakes,
    solvedWords,
  }: {
    foundBonus: number;
    hintsUsed: number;
    mistakes: number;
    solvedWords: number;
  },
): ObjectiveProgress | null {
  if (level.mechanic === 'bonus_chest') {
    const target = Math.max(1, Math.min(level.bonusTarget ?? 2, level.rewardedBonus?.length ?? level.bonusPool.length));
    const complete = foundBonus >= target;
    return {
      complete,
      failed: false,
      icon: 'chest',
      label: 'Бонусный сундук',
      progressText: `${Math.min(foundBonus, target)}/${target} бонусных слов`,
      reward: complete ? 30 : 0,
    };
  }

  if (level.mechanic === 'ordered') {
    const total = level.answerOrder?.length ?? level.answers.length;
    const complete = solvedWords >= total;
    return {
      complete,
      failed: false,
      icon: 'order',
      label: 'Цепочка слов',
      progressText: complete ? 'Цепочка собрана' : `${solvedWords}/${total} по возрастанию длины`,
      reward: complete ? 35 : 0,
    };
  }

  if (level.mechanic === 'mastery') {
    const failed = hintsUsed > 0 || mistakes > 0;
    const finished = solvedWords >= level.answers.length;
    const complete = finished && !failed;
    return {
      complete,
      failed,
      icon: 'mastery',
      label: 'Испытание мастера',
      progressText: failed
        ? 'Награда потеряна: была ошибка или подсказка'
        : finished
          ? 'Пройдено без ошибок и подсказок'
          : 'Пройдите без ошибок и подсказок',
      reward: complete ? 50 : 0,
    };
  }

  return null;
}
