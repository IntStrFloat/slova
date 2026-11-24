import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { track, trackOnce } from '@/features/analytics';
import { MARATHON } from '@/core/config/marathon';
import { getMarathonStatus, useMarathon } from '@/features/marathon';
import { startFocusedRefresh } from '@/features/retention-ui/foregroundRefresh';
import { AppButton, AppText, colors, GlassPanel, Icon } from '@/ui';

export function MarathonEntry() {
  const router = useRouter();
  const marathon = useMarathon();
  const [now, setNow] = useState(Date.now);
  useFocusEffect(useCallback(() => startFocusedRefresh(() => {
    const at = Date.now();
    setNow(at);
    if (at >= MARATHON.startAtMs && at < MARATHON.endAtMs) {
      trackOnce('feature_eligible', MARATHON.id, { feature: 'marathon', eligibility_version: MARATHON.id,
        eventInstanceId: MARATHON.id, occurredAtMs: at });
    }
  }), []));
  const event = getMarathonStatus(marathon, now);
  if (event.status === 'ended' && event.completionCount === 0) return null;
  return <GlassPanel tone="cream" style={{ gap: 8, borderBottomWidth: 3 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name="events" size={24} color={colors.plum} />
      <AppText preset="title" style={{ flex: 1, fontSize: 18, color: colors.brown }}>Марафон слов</AppText>
    </View>
    <AppText preset="body" style={{ color: colors.brown, fontSize: 14 }}>
      {event.status === 'upcoming' ? '26 октября — 1 ноября · 7 этапов и 150 монет'
        : event.status === 'active' ? `Пройдено ${event.tiers.filter((tier) => tier.completed).length} из 7 этапов · до 150 монет`
          : `Марафон завершён · ${event.tiers.filter((tier) => tier.completed).length} из 7 этапов`}
    </AppText>
    <AppButton label={event.status === 'upcoming' ? 'Условия марафона' : event.status === 'active' ? 'Открыть марафон' : 'Итоги марафона'}
      variant="glass" icon="events" onPress={() => {
        track('marathon_entry_clicked', { status: event.status, source: 'home' });
        router.push('/marathon' as never);
      }} />
  </GlassPanel>;
}
