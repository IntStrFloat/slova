/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { ECONOMY } from '@/core/config/economy';

import { NoCoinsModal } from '../NoCoinsModal';
import { useRewardedReady } from '../useRewardedReady';

let mockReady = false;
const mockListeners = new Set<() => void>();
const mockUnsubscribe = jest.fn();
let mockProvider: {
  isRewardedReady: () => boolean;
  subscribeRewardedReady?: (listener: () => void) => () => void;
};

jest.mock('../providers', () => ({ getAds: () => mockProvider }));
jest.mock('@/features/analytics', () => ({ track: () => {} }));
jest.mock('@/ui', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    ...require('@/ui/theme'),
    AppText: Text, GlassPanel: View, Icon: () => null,
    AppButton: (props: Record<string, unknown>) => React.createElement('Button', props),
  };
});

const onClose = jest.fn();
const rewardLabel = `Посмотреть рекламу → +${ECONOMY.rewardedCoins} монет`;

function OpenHintModal({ revision = 0 }: { revision?: number }) {
  const ready = useRewardedReady();
  return <NoCoinsModal priceCoins={40} currentCoins={revision} canWatchAd={ready}
    onWatchAd={() => {}} onWheel={() => {}} onShop={() => {}} onClose={onClose} />;
}

let tree: renderer.ReactTestRenderer | undefined;
function mount() {
  act(() => { tree = renderer.create(<OpenHintModal />); });
}

function rewardButtons() {
  return tree!.root.findAll((node) => typeof node.type === 'string' && node.props.label === rewardLabel);
}

beforeEach(() => {
  mockReady = false;
  mockListeners.clear();
  mockUnsubscribe.mockClear();
  onClose.mockClear();
  mockProvider = {
    isRewardedReady: () => mockReady,
    subscribeRewardedReady: (listener) => {
      mockListeners.add(listener);
      return () => { mockListeners.delete(listener); mockUnsubscribe(); };
    },
  };
});

afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
});

test('an open hint modal gains its rewarded button after a delayed load and loses it when consumed', async () => {
  mount();
  expect(rewardButtons()).toHaveLength(0);
  await act(async () => {
    await Promise.resolve();
    mockReady = true;
    mockListeners.forEach((listener) => listener());
  });
  expect(rewardButtons()).toHaveLength(1);
  expect(tree!.root.findAllByType(NoCoinsModal)).toHaveLength(1);
  expect(onClose).not.toHaveBeenCalled();

  act(() => {
    mockReady = false;
    mockListeners.forEach((listener) => listener());
  });
  expect(rewardButtons()).toHaveLength(0);
  expect(mockListeners.size).toBe(1);
  act(() => tree!.unmount());
  tree = undefined;
  expect(mockListeners.size).toBe(0);
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

test('reads a provider without subscriptions on normal React renders', () => {
  mockProvider = { isRewardedReady: () => mockReady };
  mount();
  expect(rewardButtons()).toHaveLength(0);
  mockReady = true;
  act(() => tree!.update(<OpenHintModal revision={1} />));
  expect(rewardButtons()).toHaveLength(1);
});
