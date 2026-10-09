/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { worldById } from '@/core/config/worlds';
import { useRetention } from '@/features/retention';
import { WorldBackground } from '@/ui/WorldBackground';

import { coverImageForId } from '../coverArt';
import { useCollection } from '../store';

jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: ({ source }: any) => <View testID="background-photo" source={source} /> };
});
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: ({ colors }: any) => <View testID="background-scrim" colors={colors} /> };
});

function backgroundPhoto(tree: ReactTestRenderer): number {
  return tree.root.findByProps({ testID: 'background-photo' }).props.source;
}

describe('selected cover in the world background', () => {
  beforeEach(() => {
    useCollection.setState({ opened: [], selectedCoverId: null });
    useRetention.setState({ ownedCollectibles: {} });
  });

  it('uses the earned cover across the app and restores default art when cleared', () => {
    const defaultArt = worldById('world1')!.image;
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<WorldBackground world="world1" image={defaultArt} dim />); });
    expect(backgroundPhoto(tree)).toBe(defaultArt);
    expect(tree.root.findByProps({ testID: 'background-scrim' }).props.colors).toEqual([
      'rgba(38,21,44,0.42)', 'rgba(38,21,44,0.16)', 'rgba(29,17,40,0.52)',
    ]);

    act(() => { useRetention.setState({ ownedCollectibles: { 'journey-cover-1': { source: 'journey', earnedDay: '2026-09-26' } } }); });
    act(() => { useCollection.getState().selectCover('journey-cover-1'); });
    expect(backgroundPhoto(tree)).toBe(coverImageForId('journey-cover-1', useRetention.getState().ownedCollectibles));
    expect(tree.root.findByProps({ testID: 'background-scrim' }).props.colors).toEqual([
      'rgba(25,16,35,0.66)', 'rgba(25,16,35,0.40)', 'rgba(25,16,35,0.72)',
    ]);

    act(() => { useCollection.getState().selectCover(null); });
    expect(backgroundPhoto(tree)).toBe(defaultArt);
    act(() => { tree.unmount(); });
  });
});
