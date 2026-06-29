import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KEYS, setString } from '@/core/storage';
import { AppButton, AppText, colors, GlassPanel, Icon, WorldBackground, type IconName } from '@/ui';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'wand', title: 'Составляйте слова', text: 'Проводите пальцем по буквам на диске, чтобы собрать слово.' },
  { icon: 'collection', title: 'Заполняйте кроссворд', text: 'Верные слова встают в сетку. Найдите все — и уровень пройден.' },
  { icon: 'bulb', title: 'Подсказки выручат', text: 'Застряли? Подсказка откроет букву или целое слово — за монеты.' },
  { icon: 'coin', title: 'Монеты и бонусы', text: 'Зарабатывайте монеты за уровни и бонусные слова, тратьте на подсказки.' },
  { icon: 'leaderboard', title: 'Путешествуйте по миру', text: 'Открывайте достопримечательности и соревнуйтесь с другими игроками.' },
];

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const cur = STEPS[step];
  const last = step === STEPS.length - 1;

  const next = () => {
    if (last) {
      setString(KEYS.onboardingDone, '1');
      router.replace('/');
    } else {
      setStep(step + 1);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 24 }}>
        <GlassPanel strong style={{ alignItems: 'center', gap: 16, paddingVertical: 36, paddingHorizontal: 28 }}>
          <Icon name={cur.icon} size={64} color={colors.amber} />
          <AppText preset="display" style={{ textAlign: 'center' }}>{cur.title}</AppText>
          <AppText preset="body" style={{ color: colors.textMuted, textAlign: 'center' }}>{cur.text}</AppText>
        </GlassPanel>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i === step ? colors.amber : colors.glassBorder }}
            />
          ))}
        </View>
        <AppButton label={last ? 'Начать' : 'Далее'} icon={last ? 'play' : 'wand'} large onPress={next} />
      </SafeAreaView>
    </View>
  );
}
