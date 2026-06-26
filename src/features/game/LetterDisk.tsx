import { Fragment, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import { colors, fonts } from '@/ui';

import { hitTile, tilePositions, wordFromSelection, type TilePos } from './geometry';

const SIZE = 300;
const TILE_R = 32;
const HIT_R = 40;
const RADIUS = SIZE / 2 - TILE_R - 10;

export function LetterDisk({
  letters,
  onWord,
}: {
  letters: string[];
  onWord: (word: string) => void;
}) {
  const center = SIZE / 2;
  const positions = useMemo<TilePos[]>(
    () => tilePositions(letters.length, RADIUS, center),
    [letters.length, center],
  );
  const [selected, setSelected] = useState<number[]>([]);
  const selectedRef = useRef<number[]>([]);

  const pick = (x: number, y: number) => {
    const idx = hitTile(positions, x, y, HIT_R);
    if (idx >= 0 && !selectedRef.current.includes(idx)) {
      selectedRef.current = [...selectedRef.current, idx];
      setSelected(selectedRef.current);
    }
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .onBegin((e) => {
      selectedRef.current = [];
      pick(e.x, e.y);
    })
    .onUpdate((e) => pick(e.x, e.y))
    .onEnd(() => {
      const word = wordFromSelection(letters, selectedRef.current);
      selectedRef.current = [];
      setSelected([]);
      if (word.length >= 2) onWord(word);
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE}>
          {/* стеклянная подложка диска */}
          <Circle cx={center} cy={center} r={RADIUS + TILE_R + 6} fill={colors.glass} stroke={colors.glassBorder} strokeWidth={1.5} />

          {/* линия связи выбранных букв */}
          {selected.slice(1).map((idx, i) => {
            const a = positions[selected[i]];
            const b = positions[idx];
            return (
              <Line key={`l${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors.linkLine} strokeWidth={9} strokeLinecap="round" opacity={0.92} />
            );
          })}

          {positions.map((p, i) => {
            const active = selected.includes(i);
            const r = active ? TILE_R + 1 : TILE_R;
            return (
              <Fragment key={`t${i}`}>
                <Circle cx={p.x} cy={p.y + 3} r={r} fill={colors.tileShadow} />
                <Circle cx={p.x} cy={p.y} r={r} fill={active ? colors.tileActive : colors.tile} />
                <SvgText
                  x={p.x}
                  y={p.y + 10}
                  fontSize={28}
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
      </View>
    </GestureDetector>
  );
}
