import { Fragment, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated, {
  createAnimatedComponent,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { cellKey, type Level } from '@/core/engine';
import { colors, fonts } from '@/ui';

import { gridAccessibilitySummary } from './accessibility';
import { calculateCrosswordGridSize, crosswordLetterFontSize } from './layout';

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
  const { fontScale } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const reveal = useSharedValue(filled ? 1 : 0);
  useEffect(() => {
    if (filled) {
      reveal.value = reducedMotion ? 1 : withDelay(
        recentOrder != null ? recentOrder * 70 : 0,
        withTiming(1, { duration: 260, easing: Easing.bezier(0.23, 1, 0.32, 1) }),
      );
    } else {
      reveal.value = 0;
    }
  }, [filled, recentOrder, reducedMotion, reveal]);

  const fillProps = useAnimatedProps(() => ({
    opacity: reveal.value,
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
        rx={7}
        fill={colors.cream}
        stroke={hinted ? colors.goldBorder : colors.creamDeep}
        strokeWidth={hinted ? 2.2 : 1.2}
      />
      <AnimatedRect
        animatedProps={fillProps}
        x={x}
        y={y}
        width={cell}
        height={cell}
        rx={7}
        fill={colors.plum}
        stroke={colors.plumDeep}
        strokeWidth={1.5}
      />
      {filled ? (
        <AnimatedSvgText
          animatedProps={textProps}
          x={x + cell / 2}
          y={y + cell / 2 + cell * 0.2}
          fontSize={crosswordLetterFontSize(cell, fontScale)}
          fontFamily={fonts.tile}
          fill={colors.cream}
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
  const { cell, width: w, height: h } = calculateCrosswordGridSize({
    cols,
    rows: level.grid.rows,
    maxWidth,
    maxHeight,
  });

  // Р›С‘РіРєРёР№ В«РїСѓР»СЊСЃВ» СЃРµС‚РєРё РїСЂРё РїРѕСЏРІР»РµРЅРёРё РЅРѕРІС‹С… Р±СѓРєРІ (game feel, СЃРїРµРєР° 09).
  const filledCount = Object.keys(filled).length;
  const prevCount = useRef(filledCount);
  const prevKeys = useRef(new Set(Object.keys(filled)));
  const [recent, setRecent] = useState<Record<string, number>>({});
  const pulse = useSharedValue(1);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const keys = Object.keys(filled);
    if (filledCount > prevCount.current) {
      const added = keys.filter((key) => !prevKeys.current.has(key));
      if (added.length > 0) {
        setRecent(Object.fromEntries(added.map((key, index) => [key, index])));
        const timer = setTimeout(() => setRecent({}), 800);
        if (!reducedMotion) {
          pulse.value = withSequence(
            withTiming(1.015, { duration: 120 }),
            withTiming(1, { duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1) }),
          );
        }
        prevKeys.current = new Set(keys);
        prevCount.current = filledCount;
        return () => clearTimeout(timer);
      }
    }
    prevKeys.current = new Set(keys);
    prevCount.current = filledCount;
  }, [filled, filledCount, pulse, reducedMotion]);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const accessibilityLabel = gridAccessibilitySummary(level, filled);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Сетка обновляется автоматически, когда вы собираете слова."
      accessibilityValue={{ min: 0, max: level.grid.cells.length, now: filledCount }}
    >
      <Animated.View
        importantForAccessibility="no-hide-descendants"
        style={[{ width: w, height: h }, animStyle]}
      >
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
    </View>
  );
}
