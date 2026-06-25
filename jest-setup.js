/* reanimated + worklets: моки для unit-тестов без нативного слоя */
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));

/* In-memory мок MMKV: сторы тестируются без нативного модуля */
jest.mock('react-native-mmkv', () => {
  class MMKV {
    constructor() { this.map = new Map(); }
    set(k, v) { this.map.set(k, v); }
    getString(k) { const v = this.map.get(k); return typeof v === 'string' ? v : undefined; }
    getNumber(k) { const v = this.map.get(k); return typeof v === 'number' ? v : undefined; }
    getBoolean(k) { const v = this.map.get(k); return typeof v === 'boolean' ? v : undefined; }
    remove(k) { return this.map.delete(k); }
    contains(k) { return this.map.has(k); }
    getAllKeys() { return [...this.map.keys()]; }
    clearAll() { this.map.clear(); }
  }
  return { MMKV, createMMKV: () => new MMKV() };
});

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'ru', languageTag: 'ru-RU' }],
}));

/* react-native-svg: лёгкие host-стабы для UI-импортов в jest. */
jest.mock('react-native-svg', () => {
  const React = require('react');
  const stub = (name) => {
    const Comp = ({ children, ...props }) => React.createElement(name, props, children);
    Comp.displayName = name;
    return Comp;
  };
  const Svg = stub('Svg');
  return {
    __esModule: true, default: Svg, Svg,
    Path: stub('Path'), G: stub('G'), Circle: stub('Circle'), Rect: stub('Rect'),
    Text: stub('SvgText'), Line: stub('Line'), Defs: stub('Defs'),
    LinearGradient: stub('LinearGradient'), Stop: stub('Stop'),
  };
});
