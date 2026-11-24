import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';
import { getRuntimePolicy, subscribeRuntimePolicy, type PolicyParameter } from '@/core/config/runtimePolicy';
import { useRetention } from '@/features/retention';
import { recordRetentionEligibilityUse } from './consumption';

const parameters: Record<'home' | 'quests' | 'event', readonly PolicyParameter[]> = {
  home: ['retention_quests_unlock_wins', 'retention_event_unlock_wins'],
  quests: ['retention_quests_unlock_wins'], event: ['retention_event_unlock_wins'],
};

/** Runs after the visible screen consumed its eligibility result, never while React renders. */
export function useRetentionPolicyExposure(screen: keyof typeof parameters): void {
  const snapshot = useSyncExternalStore(subscribeRuntimePolicy, getRuntimePolicy, getRuntimePolicy);
  const { questInstances, eventInstances } = useRetention();
  useFocusEffect(useCallback(() => {
    if (!snapshot.assignment) return;
    recordRetentionEligibilityUse({ questInstances, eventInstances },
      parameters[screen].filter((parameter) => parameter === snapshot.parameter), 'retention_gate');
  }, [screen, snapshot, questInstances, eventInstances]));
}
