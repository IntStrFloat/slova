import { useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LetterDisk } from '@/features/game/LetterDisk';
import type { FeedbackKind } from '@/features/game/accessibility';
import { AppButton, AppText, colors, GlassPanel, WorldBackground } from '@/ui';

import { firstUnsolvedIntroWord } from './onboardingHelp';
import { getIntroLevel } from './introPack';

const PRACTICE_LEVEL = getIntroLevel(1)!;

/** A local exercise: no campaign store, snapshot, currency, or reward writes. */
export function PracticeLesson({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const diskSize = Math.max(180, Math.min(width - 40, height <= 700 ? 265 : 310));
  const [solved, setSolved] = useState<string[]>([]);
  const solvedRef = useRef<string[]>([]);
  const [demoRequestId, setDemoRequestId] = useState(0);
  const interacted = useRef(false);
  const firstDemoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    firstDemoTimer.current = setTimeout(() => {
      firstDemoTimer.current = null;
      if (!interacted.current) setDemoRequestId((value) => value + 1);
    }, 500);
    return () => {
      if (firstDemoTimer.current) clearTimeout(firstDemoTimer.current);
    };
  }, []);

  const onUserInteraction = () => {
    interacted.current = true;
    if (firstDemoTimer.current) {
      clearTimeout(firstDemoTimer.current);
      firstDemoTimer.current = null;
    }
  };

  const onWord = (word: string): FeedbackKind => {
    onUserInteraction();
    if (!PRACTICE_LEVEL.answers.some((answer) => answer.word === word)) return 'invalid';
    if (solvedRef.current.includes(word)) return 'duplicate';
    const next = [...solvedRef.current, word];
    solvedRef.current = next;
    setSolved(next);
    return 'grid';
  };

  const demoWord = firstUnsolvedIntroWord(PRACTICE_LEVEL, solved) ?? 'кот';
  return (
    <View style={{ flex: 1 }}>
      <WorldBackground world="world1" dim />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 14 }}
        >
          <AppText preset="display" style={{ textAlign: 'center', fontSize: 27 }}>Тренировка жеста</AppText>
          <GlassPanel tone="cream" style={{ width: '100%', maxWidth: 360, paddingVertical: 16, paddingHorizontal: 18, gap: 5 }}>
            <AppText preset="title" style={{ textAlign: 'center', color: colors.brown, fontSize: 19 }}>
              {solved.length === 0 ? 'Составь слово «КОТ»' : solved.length === 1 ? 'Теперь найди ещё одно слово' : 'Оба слова найдены!'}
            </AppText>
            <AppText preset="body" style={{ textAlign: 'center', color: colors.brown, fontSize: 14 }}>
              Проведи по буквам, не отрывая пальца. Здесь можно пробовать без потери прогресса.
            </AppText>
          </GlassPanel>
          <LetterDisk
            letters={PRACTICE_LEVEL.letters}
            onWord={onWord}
            size={diskSize}
            demoWord={demoWord}
            demoRequestId={demoRequestId}
            onUserInteraction={onUserInteraction}
          />
          <View style={{ width: '100%', maxWidth: 360, gap: 8 }}>
            <AppButton label="Показать жест" variant="glass" icon="play" onPress={() => setDemoRequestId((value) => value + 1)} />
            <AppButton label="Готово" variant="primary" icon="check" onPress={onDone} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
