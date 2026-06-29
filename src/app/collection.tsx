import { Image } from 'expo-image';
import { useGoBack } from '@/core/nav';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { allLandmarks, type Landmark } from '@/core/config/worlds';
import { t } from '@/core/i18n';
import { LandmarkReveal, useCollection } from '@/features/collection';
import { useLevels } from '@/features/levels';
import { AppButton, AppText, colors, Icon, radius, shadowCard, WorldBackground, worldTheme } from '@/ui';

const CARD = 150;

export default function Collection() {
  const goBack = useGoBack();
  const opened = useCollection((s) => s.opened);
  const completed = useLevels((s) => s.completed.length);
  const items = allLandmarks();
  const [selected, setSelected] = useState<Landmark | null>(null);
  const openedCount = items.filter((l) => opened.includes(l.id)).length;

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
          <AppButton label={t('map')} variant="glass" icon="back" onPress={goBack} />
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
                  <View style={{ width: CARD, height: 116, backgroundColor: colors.glass }}>
                    <Image
                      source={l.image}
                      style={{ width: CARD, height: 116, opacity: unlocked ? 1 : 0.32 }}
                      contentFit="cover"
                    />
                    {!unlocked ? (
                      <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,11,20,0.28)' }}>
                        <Icon name="lock" size={30} color={colors.text} />
                      </View>
                    ) : null}
                  </View>
                  <View style={{ padding: 10, gap: 4 }}>
                    <AppText preset="label" numberOfLines={1}>
                      {unlocked ? l.title : '???'}
                    </AppText>
                    <AppText preset="body" style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
                      {unlocked ? worldTheme(l.world).name : `Осталось ${Math.max(0, l.untilLevel - completed)} ур.`}
                    </AppText>
                    {unlocked ? (
                      <AppText preset="body" style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={2}>
                        {l.fact}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
      {selected ? <LandmarkReveal landmark={selected} onClose={() => setSelected(null)} isNew={false} /> : null}
    </View>
  );
}
