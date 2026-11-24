import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import type { UpdateActionResult, UpdatesSnapshot } from '../coordinator';
import { UpdateAction } from '../UpdateAction';
import { getUpdatesSnapshot, openManualUpdate, requestUpdate } from '../runtime';
jest.mock('../runtime', () => ({ getUpdatesSnapshot: jest.fn(), subscribeUpdates: () => () => {}, requestUpdate: jest.fn(), openManualUpdate: jest.fn() }));
jest.mock('@/ui/Icon', () => ({ Icon: () => null }));
const ready: UpdatesSnapshot = { status: 'downloaded', versionCode: '35', busy: false, revision: 1, canAct: true, manualAvailable: true };
beforeEach(() => { jest.clearAllMocks(); (getUpdatesSnapshot as jest.Mock).mockReturnValue(ready); });
test('rendering downloaded never calls completion; only explicit tap passes the live safe predicate', async () => {
  let tree!: ReactTestRenderer; let safe = true;
  const predicate = () => safe, onAttempted = jest.fn();
  (requestUpdate as jest.Mock).mockImplementation(async (guard: () => boolean): Promise<UpdateActionResult> => ({ result: 'unavailable', reason: guard() ? 'other_guard' : 'unsafe_point', attempted: false }));
  await act(async () => { tree = renderer.create(<UpdateAction attemptId="ui-result-1" isSafePoint={predicate} onAttempted={onAttempted} />); });
  expect(requestUpdate).not.toHaveBeenCalled(); safe = false;
  await act(async () => { tree.root.findAllByProps({ accessibilityLabel: 'Установить обновление' })[0].props.onPress(); });
  expect(requestUpdate).toHaveBeenCalledWith(predicate, { versionCode: '35', action: 'install' }, 'ui-result-1'); expect(onAttempted).not.toHaveBeenCalled();
});
test('disabled/cooldown hides the action; an actual attempted form suppresses the next unsolicited result prompt', async () => {
  let tree!: ReactTestRenderer; const onAttempted = jest.fn();
  (getUpdatesSnapshot as jest.Mock).mockReturnValue({ ...ready, canAct: false, manualAvailable: false });
  await act(async () => { tree = renderer.create(<UpdateAction attemptId="ui-result-1" isSafePoint={() => true} onAttempted={onAttempted} />); });
  expect(tree.toJSON()).toBeNull();
  (getUpdatesSnapshot as jest.Mock).mockReturnValue(ready);
  (requestUpdate as jest.Mock).mockResolvedValue({ result: 'flow_ended_unconfirmed', reason: 'flow_returned', attempted: true });
  await act(async () => { tree.update(<UpdateAction attemptId="ui-result-1" isSafePoint={() => true} onAttempted={onAttempted} />); });
  await act(async () => { tree.root.findAllByProps({ accessibilityLabel: 'Установить обновление' })[0].props.onPress(); });
  expect(onAttempted).toHaveBeenCalledTimes(1);
});
test('manual listing fallback also needs an explicit tap and reports only actual launch acceptance', async () => {
  let tree!: ReactTestRenderer; const onAttempted = jest.fn();
  (getUpdatesSnapshot as jest.Mock).mockReturnValue({ ...ready, status: 'unavailable', canAct: false });
  (openManualUpdate as jest.Mock).mockResolvedValue(true);
  await act(async () => { tree = renderer.create(<UpdateAction attemptId="ui-result-1" isSafePoint={() => true} onAttempted={onAttempted} />); });
  expect(openManualUpdate).not.toHaveBeenCalled();
  await act(async () => { tree.root.findAllByProps({ accessibilityLabel: 'Открыть RuStore' })[0].props.onPress(); });
  expect(onAttempted).toHaveBeenCalledTimes(1); expect(requestUpdate).not.toHaveBeenCalled();
});
