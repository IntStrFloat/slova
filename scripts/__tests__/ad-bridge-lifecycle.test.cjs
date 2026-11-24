const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function openBridge(nativeOverrides = {}) {
  const listeners = new Map();
  const calls = [];
  const native = {
    showAd: async (id) => { calls.push(['show', id]); },
    disposeAd: async (id) => { calls.push(['dispose', id]); },
    hasActiveInterstitialShow: async () => true,
    ...nativeOverrides,
  };
  class NativeEventEmitter {
    addListener(name, callback) {
      const group = listeners.get(name) ?? new Set();
      listeners.set(name, group);
      group.add(callback);
      return { remove: () => group.delete(callback) };
    }
  }
  const exports = {};
  const source = readFileSync(path.join(__dirname,
    '../../node_modules/yandex-mobile-ads/lib/commonjs/interstitial/InterstitialAd.js'), 'utf8');
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      if (name === '../util') return { isSupportedPlatform() {} };
      if (name === '../YandexMobileAdsModule') return { YandexInterstitialAdModule: native };
      if (name === 'react-native') return { NativeEventEmitter, NativeModules: { YandexEventEmitter: {} } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return {
    Ad: exports.InterstitialAd,
    calls,
    emit: (name, data) => {
      for (const callback of [...(listeners.get(`RNYandexMobileAds-Interstitial-${name}`) ?? [])]) callback(data);
    },
    count: () => [...listeners.values()].reduce((sum, group) => sum + group.size, 0),
  };
}

test('native active state is read without creating or showing another ad', async () => {
  const bridge = openBridge();
  assert.equal(await bridge.Ad.hasActiveShow(), true);
  assert.deepEqual(bridge.calls, []);
  const idle = openBridge({ hasActiveInterstitialShow: async () => false });
  assert.equal(await idle.Ad.hasActiveShow(), false);
});

test('disposing an in-flight ad keeps its callbacks until native deletion confirms termination', async () => {
  const bridge = openBridge();
  const ad = await bridge.Ad.create('active', { adUnitId: 'demo' });
  let dismissed = 0;
  ad.onAdDismissed = () => { dismissed += 1; };
  await ad.show();
  await ad.dispose();
  assert.deepEqual(bridge.calls, [['show', 'active'], ['dispose', 'active']]);
  bridge.emit('onAdDismissed', { adId: 'active' });
  assert.equal(dismissed, 1);
  bridge.emit('onAdDeleted', { adId: 'active' });
  assert.equal(bridge.count(), 0);
  assert.equal(ad.adInfo, undefined);
  await ad.dispose();
  assert.equal(bridge.calls.length, 2);
  await assert.rejects(ad.show());
});

test('native deletion isolates old ad callbacks from the next ad', async () => {
  const bridge = openBridge();
  const old = await bridge.Ad.create('old');
  const next = await bridge.Ad.create('next');
  let oldShown = 0;
  let nextShown = 0;
  old.onAdShown = () => { oldShown += 1; };
  next.onAdShown = () => { nextShown += 1; };
  bridge.emit('onAdDeleted', { adId: 'old' });
  bridge.emit('onAdShown', { adId: 'old' });
  bridge.emit('onAdShown', { adId: 'next' });
  assert.equal(oldShown, 0);
  assert.equal(nextShown, 1);
  bridge.emit('onAdDeleted', { adId: 'next' });
  assert.equal(bridge.count(), 0);
});

test('bridge errors propagate and unavailable native ownership never means safely idle', async () => {
  const failure = new Error('Native fullscreen check failed');
  const bridge = openBridge({ hasActiveInterstitialShow: async () => { throw failure; } });
  await assert.rejects(bridge.Ad.hasActiveShow(), (error) => error === failure);
  const legacy = openBridge({ hasActiveInterstitialShow: undefined, disposeAd: undefined });
  await assert.rejects(legacy.Ad.hasActiveShow(), /unavailable/);
  const ad = await legacy.Ad.create('legacy');
  await assert.rejects(ad.dispose(), /unavailable/);
});
