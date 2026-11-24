/* eslint-disable @typescript-eslint/no-require-imports */
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

let mockAllowed = true;
const mockRouter = { replace: jest.fn() };
const mockSnapshot = { mode: 'off', status: 'not_started', level: 6, coins: 20 };
const mockHarness = { snapshot: jest.fn(() => mockSnapshot), subscribe: jest.fn(() => () => {}),
  prepareCampaign: jest.fn(() => true), useSimulation: jest.fn(() => true), armVendor: jest.fn(() => true),
  prepareSmallSpin: jest.fn(() => true), releaseHold: jest.fn(async () => true), openFormFixture: jest.fn(() => true), stop: jest.fn() };
const mockLoad = jest.fn(() => mockHarness);
jest.mock('../guard', () => ({ productQaAllowed: () => mockAllowed }));
jest.mock('../loadRuntime', () => ({ getProductQaHarness: () => mockLoad() }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/ui', () => {
  const React = require('react');
  return { colors: { brown: '#56391F' },
    AppText: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('Text', props, children),
    AppButton: ({ disabled, onPress, ...props }: { disabled?: boolean; onPress?: () => void }) =>
      React.createElement('Button', { ...props, disabled, onPress: disabled ? undefined : onPress }) };
});
const { ProductQaPanel } = require('../ProductQaPanel') as typeof import('../ProductQaPanel');
let tree: ReactTestRenderer | null = null;
const button = (label: string) => tree!.root.findAllByType('Button' as never).find((node) => node.props.label === label)!;
async function press(label: string) {
  const target = button(label);
  expect(target.props.disabled).toBe(false);
  await act(async () => { await target.props.onPress(); });
}
beforeEach(() => { jest.clearAllMocks(); mockAllowed = true; mockHarness.openFormFixture.mockReturnValue(true); });
afterEach(() => { if (tree) act(() => tree!.unmount()); tree = null; });

test('ordinary guard denies even runtime loading and removes reachable QA callbacks', () => {
  mockAllowed = false;
  act(() => { tree = TestRenderer.create(<ProductQaPanel active />); });
  expect(mockLoad).not.toHaveBeenCalled();
  for (const target of tree!.root.findAllByType('Button' as never)) {
    expect(target.props.disabled).toBe(true);
    expect(target.props.onPress).toBeUndefined();
  }
});
test('visible controls are explicit and navigate to actual Game only on a separate enabled press', async () => {
  act(() => { tree = TestRenderer.create(<ProductQaPanel active />); });
  expect(mockHarness.prepareCampaign).not.toHaveBeenCalled();
  expect(mockHarness.useSimulation).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  await press('Подготовить QA: уровень 6, 20 монет');
  expect(mockHarness.prepareCampaign).toHaveBeenCalledTimes(1);
  await press('Симулированная реклама: ready');
  expect(mockHarness.useSimulation).toHaveBeenCalledWith('ready');
  expect(mockRouter.replace).not.toHaveBeenCalled();
  await press('В actual Game (QA профиль)');
  expect(mockRouter.replace).toHaveBeenCalledWith('/game?mode=normal');
});
test('a stale enabled handler rechecks native guard before business work', async () => {
  act(() => { tree = TestRenderer.create(<ProductQaPanel active />); });
  const handler = button('Подготовить QA: уровень 6, 20 монет').props.onPress;
  expect(button('Подготовить QA: уровень 6, 20 монет').props.disabled).toBe(false);
  mockAllowed = false;
  await act(async () => handler());
  expect(mockHarness.prepareCampaign).not.toHaveBeenCalled();
});
test('inactive controls and rejected form fixture cannot navigate or request checkout', async () => {
  act(() => { tree = TestRenderer.create(<ProductQaPanel active={false} />); });
  expect(button('Настоящая demo: удержать следующий reward').props.onPress).toBeUndefined();
  act(() => tree!.update(<ProductQaPanel active />));
  mockHarness.openFormFixture.mockReturnValue(false);
  await press('Открыть P6 форму: без оплаты и preflight');
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
