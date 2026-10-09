/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import Onboarding from '../onboarding';

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text> };
});

describe('legacy onboarding route', () => {
  it('routes directly to the playable game', () => {
    let tree!: ReactTestRenderer;
    act(() => { tree = TestRenderer.create(<Onboarding />); });
    expect(tree.root.findByProps({ testID: 'redirect' }).props.children).toBe('/game');
  });
});
