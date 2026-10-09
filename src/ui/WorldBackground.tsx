import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { WORLDS, worldById } from '@/core/config/worlds';
import { publishedCoverImage } from '@/features/collection/coverArt';
import { useCollection } from '@/features/collection/store';
import { useRetention } from '@/features/retention';

/** Scenic world art with a shaded text zone. An earned cover remains the player's choice. */
export function WorldBackground({
  world,
  image,
  dim = false,
}: {
  world: string;
  image?: number;
  dim?: boolean;
}) {
  const selectedCoverId = useCollection((state) => state.selectedCoverId);
  const coverOwned = useRetention((state) => selectedCoverId !== null && Boolean(state.ownedCollectibles[selectedCoverId]));
  const selectedArt = coverOwned ? publishedCoverImage(selectedCoverId) : null;
  const photo = selectedArt ?? image ?? worldById(world)?.image ?? WORLDS[0].image;
  const scrim: [string, string, string] = selectedArt
    ? ['rgba(25,16,35,0.66)', 'rgba(25,16,35,0.40)', 'rgba(25,16,35,0.72)']
    : dim
      ? ['rgba(38,21,44,0.42)', 'rgba(38,21,44,0.16)', 'rgba(29,17,40,0.52)']
      : ['rgba(38,21,44,0.32)', 'rgba(38,21,44,0.08)', 'rgba(29,17,40,0.42)'];
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
