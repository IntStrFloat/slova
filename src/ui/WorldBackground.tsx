import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

/**
 * Фон мира — фотореалистичный игровой арт + градиентный
 * скрим для читаемости текста (контраст ≥4.5:1, важно для аудитории 35+).
 * `dim` — усиленное затемнение для игрового поля.
 * `image` — явный арт (напр. достопримечательность текущего блока уровней);
 * если не задан — фон мира по `world`. Смена `image` даёт плавный кроссфейд.
 */
const WORLD_PHOTOS: Record<string, number> = {
  world1: require('../../assets/worlds/paris.jpg'),
  world2: require('../../assets/worlds/newyork.jpg'),
  world3: require('../../assets/worlds/moscow.jpg'),
};

export function WorldBackground({
  world,
  image,
  dim = false,
}: {
  world: string;
  image?: number;
  dim?: boolean;
}) {
  const photo = image ?? WORLD_PHOTOS[world] ?? WORLD_PHOTOS.world1;
  const scrim: [string, string, string] = dim
    ? ['rgba(10,14,24,0.66)', 'rgba(10,14,24,0.58)', 'rgba(10,14,24,0.82)']
    : ['rgba(10,14,24,0.52)', 'rgba(10,14,24,0.30)', 'rgba(10,14,24,0.78)'];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        source={photo}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={250}
        cachePolicy="memory-disk"
      />
      <LinearGradient colors={scrim} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
    </View>
  );
}
