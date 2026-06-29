import { Fragment, useEffect, useRef, useState } from 'react';
import Animated, {
  createAnimatedComponent,
  useAnimatedStyle,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { cellKey, type Level } from '@/core/engine';
import { colors, fonts } from '@/ui';

const AnimatedRect = createAnimatedComponent(Rect);
const AnimatedSvgText = createAnimatedComponent(SvgText);

function GridCell({
  x,
  y,
  cell,
  ch,
  filled,
  recentOrder,
}: {
  x: number;
  y: number;
  cell: number;
  ch: string;
  filled: boolean;
  recentOrder?: number;
}) {
  const reveal = useSharedValue(filled ? 1 : 0);
  useEffect(() => {
    if (filled) {
      reveal.value = withDelay(
        recentOrder != null ? recentOrder * 45 : 0,
        withTiming(1, { duration: 220 }),
      );
    } else {
      reveal.value = 0;
    }
  }, [filled, recentOrder, reveal]);

  const fillProps = useAnimatedProps(() => ({
    opacity: filled ? 1 : 0,
  }));
  const textProps = useAnimatedProps(() => ({ opacity: reveal.value }));
  const hinted = recentOrder != null;

  return (
    <Fragment>
      <Rect
        x={x}
        y={y}
        width={cell}
        height={cell}
        rx={8}
        fill={colors.gridEmptyStrong}
        stroke={hinted ? colors.gridHint : colors.gridStroke}
        strokeWidth={hinted ? 2.4 : 1.5}
      />
      <AnimatedRect
        animatedProps={fillProps}
        x={x}
        y={y}
        width={cell}
        height={cell}
        rx={8}
        fill={colors.gridFilled}
        stroke={colors.gridFilled}
        strokeWidth={1.5}
      />
      {filled ? (
        <AnimatedSvgText
          animatedProps={textProps}
          x={x + cell / 2}
          y={y + cell / 2 + cell * 0.2}
          fontSize={cell * 0.58}
          fontFamily={fonts.tile}
          fill={colors.gridText}
          textAnchor="middle"
        >
          {ch.toUpperCase()}
        </AnimatedSvgText>
      ) : null}
    </Fragment>
  );
}

export function CrosswordGrid({
  level,
  filled,
  maxWidth = 340,
  maxHeight,
}: {
  level: Level;
  filled: Record<string, string>;
  maxWidth?: number;
  maxHeight?: number;
}) {
  const { cols, cells } = level.grid;
  const gap = 5;
  const byWidth = Math.floor((maxWidth - (cols + 1) * gap) / cols);
  const byHeight = maxHeight
    ? Math.floor((maxHeight - (level.grid.rows + 1) * gap) / level.grid.rows)
    : 42;
  const cell = Math.max(24, Math.min(42, byWidth, byHeight));
  const w = cols * cell + (cols + 1) * gap;
  const h = level.grid.rows * cell + (level.grid.rows + 1) * gap;

  // Лёгкий «пульс» сетки при появлении новых букв (game feel, спека 09).
  const filledCount = Object.keys(filled).length;
  const prevCount = useRef(filledCount);
  const prevKeys = useRef(new Set(Object.keys(filled)));
  const [recent, setRecent] = useState<Record<string, number>>({});
  const pulse = useSharedValue(1);
  useEffect(() => {
    const keys = Object.keys(filled);
    if (filledCount > prevCount.current) {
      const added = keys.filter((key) => !prevKeys.current.has(key));
      if (added.length > 0) {
        setRecent(Object.fromEntries(added.map((key, index) => [key, index])));
        const timer = setTimeout(() => setRecent({}), 800);
        prevKeys.current = new Set(keys);
        prevCount.current = filledCount;
        return () => clearTimeout(timer);
      }
      pulse.value = withSequence(
        withTiming(1.04, { duration: 110 }),
        withTiming(1, { duration: 150 }),
      );
    }
    prevKeys.current = new Set(keys);
    prevCount.current = filledCount;
  }, [filledCount, pulse]);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View style={[{ width: w, height: h }, animStyle]}>
      <Svg width={w} height={h}>
        {cells.map((c) => {
          const x = gap + c.col * (cell + gap);
          const y = gap + c.row * (cell + gap);
          const key = cellKey(c);
          const has = filled[key] === c.ch;
          return (
            <GridCell key={key} x={x} y={y} cell={cell} ch={c.ch} filled={has} recentOrder={recent[key]} />
          );
        })}
      </Svg>
    </Animated.View>
  );
}
