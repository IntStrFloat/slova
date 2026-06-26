import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { allLandmarks, type Landmark } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import { LandmarkReveal, useCollection } from '@/features/collection';
import { AppButton, AppText, colors, Icon, radius, shadowCard, WorldBackground } from '@/ui';

const CARD = 150;

export default function Collection() {
  const router = useRouter();
  const opened = useCollection((s) => s.opened);
  const items = allLandmarks();
  const [selected, setSelected] = useState<Landmark | null>(null);
  const openedCount = items.filter((l) => opened.includes(l.id)).length;

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={() => router.back()} />
          <AppText preset="title">{openedCount}/{items.length}</AppText>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <AppText preset="display">{t('collection')}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }}>
            {items.map((l) => {
              const unlocked = opened.includes(l.id);
              return (
                <Pressable
                  key={l.id}
                  disabled={!unlocked}
                  onPress={() => setSelected(l)}
                  style={[shadowCard, {
                    width: CARD,
                    borderRadius: radius.lg,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: colors.glassBorder,
                    backgroundColor: colors.glassStrong,
                  }]}
                >
                  {unlocked ? (
                    <Image source={l.image} style={{ width: CARD, height: 110 }} contentFit="cover" />
                  ) : (
                    <View style={{ width: CARD, height: 110, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="collection" size={34} color={colors.textMuted} />
                    </View>
                  )}
                  <View style={{ padding: 10 }}>
                    <AppText preset="label" numberOfLines={1}>
                      {unlocked ? l.title : '???'}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
      {selected ? <LandmarkReveal landmark={selected} onClose={() => setSelected(null)} /> : null}
    </View>
  );
}
