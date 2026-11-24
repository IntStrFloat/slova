/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { storage } from '@/core/storage';
import { createHelpFlow, latestResumableHelpFlow, useHelpFlows } from '@/features/hints/help-flow';
import { resolveHelpUxVariant } from '@/features/hints/help-experiment';
import { NoCoinsModal } from '../NoCoinsModal';
jest.mock('@/ui', () => ({ ...require('@/ui/theme'), AppText: require('react-native').Text, GlassPanel: require('react-native').View,
  Icon: () => null, AppButton: (props: Record<string, unknown>) => require('react').createElement('Button', props) }));
test('real resolver clamps persisted/caller clarity without an assignment, including Home recovery and no-flow', async () => {
  storage.clearAll(); useHelpFlows.setState({ flows: {} });
  const flow = createHelpFlow({ id: 'legacy:origin', attemptId: 'legacy:attempt', levelId: 6, levelKey: 'campaign:6', mode: 'campaign',
    contentVersion: 'legacy_content', requestedHint: 'letter', displayedCost: 50, balance: 20,
    entrySource: 'game_help', previouslyCompleted: null, uxVariant: 'clarity' });
  expect(resolveHelpUxVariant(flow)).toBe('control'); expect(resolveHelpUxVariant(null)).toBe('control');
  expect(latestResumableHelpFlow()).toBeNull();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<NoCoinsModal priceCoins={50} currentCoins={20} uxVariant="clarity"
    originInteractionId={flow.id} canWatchAd={false} onWatchAd={() => {}} onWheel={() => {}} onShop={() => {}} onClose={() => {}} />); });
  const text = tree.root.findAllByType(Text).map((node) => String(node.props.children)).join(' ');
  expect(text).toContain('Чтобы открыть'); expect(text).not.toContain('Не хватает 30');
  expect(tree.root.findAllByProps({ testID: 'no-coins-viewport' })).toHaveLength(0);
  act(() => tree.unmount());
});
