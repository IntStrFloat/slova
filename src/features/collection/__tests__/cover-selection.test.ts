import { getJSON, KEYS, removeKey, storage } from '@/core/storage';
import { useRetention } from '@/features/retention';

import { coverImageForId } from '../coverArt';
import { loadCollectionSaved, useCollection } from '../store';

describe('cosmetic cover selection', () => {
  beforeEach(() => {
    removeKey(KEYS.collection);
    useCollection.setState({ opened: [], selectedCoverId: null });
    useRetention.setState({ ownedCollectibles: {} });
  });

  it('uses only earned published cover art and rejects ordinary postcard IDs', () => {
    expect(coverImageForId('journey-cover-1', {})).toBeNull();
    expect(coverImageForId('journey-1-1', { 'journey-1-1': true })).toBeNull();
    expect(useCollection.getState().selectCover('journey-cover-1')).toBe(false);
    expect(useCollection.getState().selectedCoverId).toBeNull();

    useRetention.setState({ ownedCollectibles: { 'journey-cover-1': { source: 'journey', earnedDay: '2026-09-26' } } });
    expect(coverImageForId('journey-cover-1', useRetention.getState().ownedCollectibles)).not.toBeNull();
    expect(useCollection.getState().selectCover('journey-cover-1')).toBe(true);
    expect(useCollection.getState().selectedCoverId).toBe('journey-cover-1');
  });

  it('preserves cover choice with legacy landmarks and rehydrates it on restart', () => {
    useRetention.setState({ ownedCollectibles: { 'journey-cover-1': { source: 'journey', earnedDay: '2026-09-26' } } });
    expect(useCollection.getState().selectCover('journey-cover-1')).toBe(true);
    useCollection.getState().unlock('arc');
    expect(getJSON(KEYS.collection, { opened: [], selectedCoverId: null })).toEqual({
      opened: ['arc'], selectedCoverId: 'journey-cover-1',
    });
    expect(loadCollectionSaved()).toEqual({ opened: ['arc'], selectedCoverId: 'journey-cover-1' });
    expect(useCollection.getState().selectCover(null)).toBe(true);
    expect(loadCollectionSaved().selectedCoverId).toBeNull();
  });

  it('falls back to default if a saved cover is no longer owned', () => {
    useRetention.setState({ ownedCollectibles: { 'journey-cover-1': { source: 'journey', earnedDay: '2026-09-26' } } });
    useCollection.getState().selectCover('journey-cover-1');
    useRetention.setState({ ownedCollectibles: {} });
    expect(loadCollectionSaved().selectedCoverId).toBeNull();
    expect(coverImageForId(useCollection.getState().selectedCoverId, useRetention.getState().ownedCollectibles)).toBeNull();
  });

  it('does not show a cover choice until its write succeeds, then retries cleanly', () => {
    useRetention.setState({ ownedCollectibles: { 'journey-cover-1': { source: 'journey', earnedDay: '2026-09-26' } } });
    const write = jest.spyOn(storage, 'set').mockImplementationOnce(() => { throw new Error('MMKV unavailable'); });
    try {
      expect(useCollection.getState().selectCover('journey-cover-1')).toBe(false);
      expect(useCollection.getState().selectedCoverId).toBeNull();
      expect(loadCollectionSaved().selectedCoverId).toBeNull();
      expect(useCollection.getState().selectCover('journey-cover-1')).toBe(true);
      expect(useCollection.getState().selectedCoverId).toBe('journey-cover-1');
      expect(loadCollectionSaved().selectedCoverId).toBe('journey-cover-1');
    } finally {
      write.mockRestore();
    }
  });

  it('does not expose a legacy landmark before its write succeeds', () => {
    const write = jest.spyOn(storage, 'set').mockImplementationOnce(() => { throw new Error('MMKV unavailable'); });
    try {
      expect(useCollection.getState().maybeUnlockAtLevel('world1', 10)).toBeNull();
      expect(useCollection.getState().has('eiffel')).toBe(false);
      expect(loadCollectionSaved().opened).toEqual([]);
      expect(useCollection.getState().maybeUnlockAtLevel('world1', 10)).toBe('eiffel');
      expect(loadCollectionSaved().opened).toEqual(['eiffel']);
    } finally {
      write.mockRestore();
    }
  });

  it('does not show an unpersisted choice when a storage write silently drops', () => {
    useRetention.setState({ ownedCollectibles: { 'journey-cover-1': { source: 'journey', earnedDay: '2026-09-26' } } });
    const write = jest.spyOn(storage, 'set').mockImplementationOnce(() => {});
    try {
      expect(useCollection.getState().selectCover('journey-cover-1')).toBe(false);
      expect(useCollection.getState().selectedCoverId).toBeNull();
      expect(useCollection.getState().selectCover('journey-cover-1')).toBe(true);
      expect(loadCollectionSaved().selectedCoverId).toBe('journey-cover-1');
    } finally {
      write.mockRestore();
    }
  });
});
