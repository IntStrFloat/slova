/* eslint-disable @typescript-eslint/no-require-imports */
// Synchronous guarded loads prevent business-store initialization before native authorization.
import { productQaAllowed } from './guard';
import { matchingQaHelpFlow } from './context';
import { createProductQaHarness, type ProductQaHarness } from './runtime';

let harness: ProductQaHarness | null = null;

export function getProductQaHarness(): ProductQaHarness | null {
  if (!productQaAllowed()) return null;
  if (harness) return harness;
  const { Alert, AppState } = require('react-native') as typeof import('react-native');
  const storage = require('@/core/storage') as typeof import('@/core/storage');
  const game = (require('@/features/game/store') as typeof import('@/features/game/store')).useGame;
  const help = require('@/features/hints/help-flow') as typeof import('@/features/hints/help-flow');
  const recovery = require('@/features/monetization/rewardRecovery') as typeof import('@/features/monetization/rewardRecovery');
  harness = createProductQaHarness({
    allowed: productQaAllowed,
    active: () => AppState.currentState === 'active',
    ads: (require('@/features/monetization/providers') as typeof import('@/features/monetization/providers')).getAds(),
    currency: (require('@/features/currency') as typeof import('@/features/currency')).useCurrency,
    wheel: (require('@/features/wheel') as typeof import('@/features/wheel')).useWheel,
    game,
    levels: (require('@/features/levels') as typeof import('@/features/levels')).useLevels,
    subscription: (require('@/features/monetization/subscription') as typeof import('@/features/monetization/subscription')).useSubscription,
    storage: storage.storage, keys: storage.KEYS,
    clearGameSnapshot: (require('@/features/game/persistence') as typeof import('@/features/game/persistence')).clearGameSnapshot,
    loadGlobalLevel: (require('@/features/levels') as typeof import('@/features/levels')).loadGlobalLevel,
    spinWheel: (require('@/features/wheel') as typeof import('@/features/wheel')).spinWheel,
    dayKey: (require('@/core/time') as typeof import('@/core/time')).dayKey,
    apiUrl: (require('@/core/config/env') as typeof import('@/core/config/env')).ENV.apiUrl,
    recover: recovery.recoverRewardedGrants,
    recoveryState: () => recovery.useRewardRecovery.getState(),
    matchingHelpContext: () => {
      const flow = matchingQaHelpFlow(help.useHelpFlows.getState().flows, game.getState().snapshot?.attemptId, help.canResumeHelpFlow);
      const select = (require('@/features/analytics/helpContext') as typeof import('@/features/analytics/helpContext')).selectHelpContext;
      return flow ? { ...select(help.helpFlowProperties(flow)) } : undefined;
    },
    validReceipt: (require('@/features/monetization/nativeRewardJournal') as typeof import('@/features/monetization/nativeRewardJournal')).isNativeRewardReceipt,
    showSimulation: (complete, dismiss) => Alert.alert('Симуляция рекламы — QA',
      'Только локально. Нативная earned-награда не создаётся.',
      [{ text: 'Закрыть без награды', style: 'cancel', onPress: dismiss }, { text: 'Завершить симуляцию', onPress: complete }],
      { cancelable: true, onDismiss: dismiss }),
  });
  return harness;
}
