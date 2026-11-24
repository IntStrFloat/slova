import { NativeModules, Platform } from 'react-native';
import app from '../../../../app.json';
import { pushContentContext } from '../context';
import { parsePushMessage } from '../payload';

jest.mock('@/features/levels/store', () => ({ useLevels: { getState: () => ({ currentLevel: 600, completed: [] }) } }));
jest.mock('@/features/dailypuzzle', () => ({ useDailyPuzzle: { getState: () => ({ solvedDates: [] }) }, selectDailyContent: () => ({}) }));
jest.mock('@/core/config/runtimePolicy', () => ({ getRetentionUnlocks: () => ({ daily: 0, event: 0 }) }));
jest.mock('@/core/config/worlds', () => ({ totalCampaignLevels: () => 1500 }));

const configuredVersion = app.expo.android.versionCode;
const platform = Platform.OS;
const previousBridge = NativeModules.RustorePush;
const minimum = (version: number) => parsePushMessage({ messageId: 'native-version',
  data: { route: '/wheel', min_version_code: String(version) } }, pushContentContext());

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  NativeModules.RustorePush = { getNativeVersionCode: jest.fn(() => 34) };
  app.expo.android.versionCode = 33;
});
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
  NativeModules.RustorePush = previousBridge;
  app.expo.android.versionCode = configuredVersion;
});

test('actual Android34 accepts minimum34 even while the bundled config says33', () => {
  expect(pushContentContext().versionCode).toBe(34);
  expect(minimum(34)).toMatchObject({ route: '/wheel', reason: 'accepted' });
});

test('actual Android33 refuses minimum34 even when newer JS config says34', () => {
  NativeModules.RustorePush.getNativeVersionCode.mockReturnValue(33);
  app.expo.android.versionCode = 34;
  expect(minimum(34)).toMatchObject({ route: '/', reason: 'version_unavailable' });
});

test.each([undefined, null, 0, -1, 3.4, NaN, Infinity, 2_147_483_648, '34', 'bad'])('unknown or invalid native version %s fails closed', (value) => {
  NativeModules.RustorePush.getNativeVersionCode.mockReturnValue(value);
  expect(pushContentContext().versionCode).toBe(0);
  expect(minimum(1)).toMatchObject({ route: '/', reason: 'version_unavailable' });
});

test('an old bridge without the capability safely refuses version-gated content', () => {
  NativeModules.RustorePush = {};
  expect(minimum(1)).toMatchObject({ route: '/', reason: 'version_unavailable' });
});

test('a failing native getter safely refuses version-gated content', () => {
  NativeModules.RustorePush.getNativeVersionCode.mockImplementation(() => { throw Error('unavailable'); });
  expect(minimum(1)).toMatchObject({ route: '/', reason: 'version_unavailable' });
});

test('PWA does not call the Android bridge or claim a native binary version', () => {
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  expect(pushContentContext().versionCode).toBe(0);
  expect(minimum(1)).toMatchObject({ route: '/', reason: 'version_unavailable' });
  expect(NativeModules.RustorePush.getNativeVersionCode).not.toHaveBeenCalled();
});
