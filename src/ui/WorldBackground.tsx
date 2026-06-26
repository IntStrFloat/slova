import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

import { worldTheme } from './theme';

/**
 * Живописный фон мира (новый ассет, спека 04/07): градиентное небо + солнце +
 * облака + силуэт достопримечательности. Лицензионно-чистая векторная графика,
 * масштабируется без потерь. `dim` — затемняющий скрим для читаемости игрового поля.
 */
export function WorldBackground({ world, dim = false }: { world: string; dim?: boolean }) {
  const t = worldTheme(world);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 200" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.sky[0]} />
            <Stop offset="0.5" stopColor={t.sky[1]} />
            <Stop offset="1" stopColor={t.sky[2]} />
          </LinearGradient>
          <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.silhouette} stopOpacity="0" />
            <Stop offset="1" stopColor={t.silhouette} stopOpacity="0.9" />
          </LinearGradient>
        </Defs>

        {/* небо */}
        <Rect x="0" y="0" width="100" height="200" fill="url(#sky)" />

        {/* солнце */}
        <Circle cx="74" cy="42" r="16" fill={t.sun} opacity={0.95} />
        <Circle cx="74" cy="42" r="24" fill={t.sun} opacity={0.18} />

        {/* облака */}
        <Ellipse cx="24" cy="34" rx="16" ry="5.5" fill="#FFFFFF" opacity={0.22} />
        <Ellipse cx="34" cy="40" rx="12" ry="4.5" fill="#FFFFFF" opacity={0.16} />
        <Ellipse cx="60" cy="22" rx="10" ry="3.6" fill="#FFFFFF" opacity={0.16} />

        {/* мягкое затемнение к низу — под glass-панели */}
        <Rect x="0" y="120" width="100" height="80" fill="url(#ground)" />

        <Skyline landmark={t.landmark} color={t.silhouette} />

        {dim ? <Rect x="0" y="0" width="100" height="200" fill="#0A0F1A" opacity={0.45} /> : null}
      </Svg>
    </View>
  );
}

function Skyline({ landmark, color }: { landmark: string; color: string }) {
  if (landmark === 'paris') {
    return (
      <>
        {/* дальние дома */}
        <Rect x="0" y="176" width="100" height="24" fill={color} opacity={0.65} />
        <Rect x="8" y="166" width="12" height="34" fill={color} opacity={0.8} />
        <Rect x="80" y="170" width="14" height="30" fill={color} opacity={0.8} />
        {/* Эйфелева башня */}
        <Path
          d="M50 110 L47 134 L44 176 L40 200 L46 200 L48.5 150 L51.5 150 L54 200 L60 200 L56 176 L53 134 Z"
          fill={color}
        />
        <Rect x="45.5" y="146" width="9" height="3" fill={color} />
        <Rect x="43" y="172" width="14" height="3.4" fill={color} />
        <Rect x="49.4" y="100" width="1.2" height="12" fill={color} />
      </>
    );
  }
  if (landmark === 'kremlin') {
    return (
      <>
        <Rect x="0" y="178" width="100" height="22" fill={color} opacity={0.7} />
        {[12, 34, 56, 78].map((x, i) => (
          <Path
            key={i}
            d={`M${x} 200 L${x} 158 L${x + 5} 150 L${x + 10} 158 L${x + 10} 200 Z`}
            fill={color}
          />
        ))}
        {[17, 39, 61, 83].map((x, i) => (
          <Circle key={i} cx={x} cy="146" r="1.8" fill="#F4B740" />
        ))}
      </>
    );
  }
  // city skyline
  const rects = [
    [4, 168], [14, 150], [24, 174], [33, 140], [44, 160], [55, 132], [66, 156], [77, 146], [88, 170],
  ];
  return (
    <>
      <Rect x="0" y="184" width="100" height="16" fill={color} opacity={0.7} />
      {rects.map(([x, y], i) => (
        <Rect key={i} x={x} y={y} width="9" height={200 - y} fill={color} opacity={0.9} />
      ))}
    </>
  );
}
