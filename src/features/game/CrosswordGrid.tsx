import { Fragment } from 'react';
import { View } from 'react-native';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { cellKey, type Level } from '@/core/engine';
import { colors, fonts } from '@/ui';

export function CrosswordGrid({
  level,
  filled,
  maxWidth = 340,
}: {
  level: Level;
  filled: Record<string, string>;
  maxWidth?: number;
}) {
  const { cols, cells } = level.grid;
  const gap = 5;
  const cell = Math.min(42, Math.floor((maxWidth - (cols + 1) * gap) / cols));
  const w = cols * cell + (cols + 1) * gap;
  const h = level.grid.rows * cell + (level.grid.rows + 1) * gap;

  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        {cells.map((c) => {
          const x = gap + c.col * (cell + gap);
          const y = gap + c.row * (cell + gap);
          const has = filled[cellKey(c)] === c.ch;
          return (
            <Fragment key={cellKey(c)}>
              <Rect
                x={x}
                y={y}
                width={cell}
                height={cell}
                rx={8}
                fill={has ? colors.gridFilled : colors.gridEmpty}
                stroke={has ? colors.gridFilled : colors.gridStroke}
                strokeWidth={1.5}
              />
              {has ? (
                <SvgText
                  x={x + cell / 2}
                  y={y + cell / 2 + cell * 0.2}
                  fontSize={cell * 0.58}
                  fontFamily={fonts.title}
                  fill={colors.gridText}
                  textAnchor="middle"
                >
                  {c.ch.toUpperCase()}
                </SvgText>
              ) : null}
            </Fragment>
          );
        })}
      </Svg>
    </View>
  );
}
