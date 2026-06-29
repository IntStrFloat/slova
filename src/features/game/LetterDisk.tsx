import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import type { SubmitResult } from '@/core/engine/types';
import { playSfx } from '@/features/audio';
import { AppText, colors, fonts, radius } from '@/ui';

import { hitTile, tilePositions, wordFromSelection, type TilePos } from './geometry';

type FeedbackKind = SubmitResult['kind'];

/** Цвет пилюли текущего слова по результату ввода. */
function pillColor(kind: FeedbackKind | null): string {
  if (kind === 'grid' || kind === 'bonus') return colors.success;
  if (kind === 'invalid' || kind === 'duplicate') return colors.danger;
  return colors.glassStrong;
}

export function LetterDisk({
  letters,
  onWord,
  size = 300,
}: {
  letters: string[];
  onWord: (word: string) => FeedbackKind;
  size?: number;
}) {
  const tileR = Math.max(25, Math.min(34, size * 0.106));
  const hitR = tileR + 10;
  const radiusValue = size / 2 - tileR - 10;
  const center = size / 2;
  const positions = useMemo<TilePos[]>(
    () => tilePositions(letters.length, radiusValue, center),
    [letters.length, radiusValue, center],
  );
  const [selected, setSelected] = useState<number[]>([]);
  const selectedRef = useRef<number[]>([]);
  const [feedback, setFeedback] = useState<{ word: string; kind: FeedbackKind } | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shake = useSharedValue(0);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  // Пульс диска при перемешивании/смене букв уровня (game feel, спека 09).
  const lettersKey = letters.join('');
  const firstRender = useRef(true);
  const diskPulse = useSharedValue(1);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    diskPulse.value = withSequence(
      withTiming(0.94, { duration: 90 }),
      withTiming(1, { duration: 140 }),
    );
  }, [lettersKey, diskPulse]);
  const diskStyle = useAnimatedStyle(() => ({ transform: [{ scale: diskPulse.value }] }));
  const triggerShake = () => {
    cancelAnimation(shake); // не накапливать сиквенсы при частых ошибках
    shake.value = withSequence(
      withTiming(-9, { duration: 45 }),
      withRepeat(withTiming(9, { duration: 80 }), 3, true),
      withTiming(0, { duration: 45 }),
    );
  };

  // Чистим отложенный сброс фидбэка при размонтировании.
  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  const pick = (x: number, y: number) => {
    const idx = hitTile(positions, x, y, hitR);
    if (idx >= 0 && !selectedRef.current.includes(idx)) {
      selectedRef.current = [...selectedRef.current, idx];
      setSelected(selectedRef.current);
      playSfx('select');
    }
  };

  /* eslint-disable react-hooks/refs -- Gesture callbacks run from event handlers; refs hold mutable drag state. */
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin((e) => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
      setFeedback(null);
      selectedRef.current = [];
      setSelected([]);
      pick(e.x, e.y);
    })
    .onUpdate((e) => pick(e.x, e.y))
    .onEnd(() => {
      const word = wordFromSelection(letters, selectedRef.current);
      selectedRef.current = [];
      setSelected([]);
      if (word.length < 2) return;
      const kind = onWord(word);
      setFeedback({ word, kind });
      if (kind === 'invalid' || kind === 'duplicate') triggerShake();
      feedbackTimer.current = setTimeout(() => setFeedback(null), 650);
    });
  /* eslint-enable react-hooks/refs */

  const currentWord = feedback ? feedback.word : wordFromSelection(letters, selected);
  const showPill = currentWord.length > 0;

  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Animated.View
        style={[
          pillStyle,
          {
            minWidth: 90,
            opacity: showPill ? 1 : 0,
            paddingVertical: 7,
            paddingHorizontal: 18,
            borderRadius: radius.pill,
            backgroundColor: pillColor(feedback?.kind ?? null),
            borderWidth: 1,
            borderColor: colors.glassBorder,
            alignItems: 'center',
          },
        ]}
      >
        <AppText preset="label" style={{ letterSpacing: 2, fontSize: 20 }}>
          {currentWord.toUpperCase() || ' '}
        </AppText>
      </Animated.View>

      {/* Жест на нескалируемой View → координаты hit-теста не зависят от пульса диска. */}
      <GestureDetector gesture={pan}>
        <View style={{ width: size, height: size }}>
          <Animated.View style={diskStyle}>
            <Svg width={size} height={size}>
            {/* стеклянная подложка диска */}
            <Circle cx={center} cy={center} r={radiusValue + tileR + 6} fill={colors.glass} stroke={colors.glassBorder} strokeWidth={1.5} />

            {/* линия связи выбранных букв */}
            {selected.slice(1).map((idx, i) => {
              const a = positions[selected[i]];
              const b = positions[idx];
              return (
                <Line key={`l${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors.linkLine} strokeWidth={Math.max(7, size * 0.03)} strokeLinecap="round" opacity={0.72} />
              );
            })}

            {positions.map((p, i) => {
              const active = selected.includes(i);
              const r = active ? tileR + 2 : tileR;
              const y = active ? p.y - 4 : p.y;
              return (
                <Fragment key={`t${i}`}>
                  {active ? <Circle cx={p.x} cy={y} r={r + 7} fill={colors.gridHint} opacity={0.28} /> : null}
                  <Circle cx={p.x} cy={y + 4} r={r} fill={colors.tileShadow} />
                  <Circle cx={p.x} cy={y} r={r} fill={active ? colors.tileActive : colors.tile} />
                  <SvgText
                    x={p.x}
                    y={y + tileR * 0.33}
                    fontSize={Math.max(23, tileR * 0.86)}
                    fontFamily={fonts.tile}
                    fill={colors.tileInk}
                    textAnchor="middle"
                  >
                    {letters[i].toUpperCase()}
                  </SvgText>
                </Fragment>
              );
            })}
            </Svg>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}
