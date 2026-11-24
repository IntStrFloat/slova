import { sanitizeJsError } from '../policy';

describe('crash payload boundary', () => {
  test('keeps Hermes coordinates and drops messages, causes, URLs and arbitrary frame names', () => {
    const input = { name: 'TypeError', message: 'receipt=private-token user@example.org', isFatal: true,
      cause: { receipt: 'private-token' }, extraData: { token: 'private-token' }, componentStack: 'user@example.org',
      stack: [{ file: 'index.android.bundle', lineNumber: 1, column: 812, methodName: 'private-token' },
        { file: 'https://private.example/save?token=private-token', lineNumber: 2, column: 3 }] };
    const result = sanitizeJsError(input);
    expect(result).toEqual({ schemaVersion: 1, errorKind: 'TypeError', fatal: true,
      engine: 'unknown', frames: [{ file: 'index.android.bundle', line: 1, column: 812 }] });
    expect(JSON.stringify(result)).not.toMatch(/private|receipt|example|cause|componentStack/);
  });

  test('parses real Hermes bytecode frames without changing zero-based offsets', () => {
    const error = new Error('not sent');
    error.stack = 'Error: not sent\n    at boom (address at index.android.bundle:1:2891)\n    at native (native)';
    expect(sanitizeJsError(error, true, 'hermes').frames).toEqual([
      { file: 'index.android.bundle', line: 1, column: 2891 },
    ]);
  });

  test('bounds malicious input, frame counts and coordinates and tolerates throwing getters', () => {
    const hostile = new Proxy({}, { get() { throw new Error('private-token'); } });
    expect(() => sanitizeJsError(hostile)).not.toThrow();
    expect(sanitizeJsError(hostile)).toEqual({ schemaVersion: 1, errorKind: 'Error', fatal: false, engine: 'unknown', frames: [] });
    const frames = Array.from({ length: 100 }, () => ({ file: 'index.android.bundle', lineNumber: 1, column: 42 }));
    expect(sanitizeJsError({ stack: frames }).frames).toHaveLength(32);
    expect(sanitizeJsError({ name: 'user@example.org', stack: [
      { file: 'index.android.bundle', lineNumber: -1, column: 1 },
      { file: 'index.android.bundle', lineNumber: 1, column: Infinity },
    ] }).frames).toEqual([]);
  });

  test('normalizes only known bundled asset URLs and source columns, never arbitrary URLs', () => {
    const error = new Error('secret');
    error.stack = 'Error: secret\n    at boom (assets://index.android.bundle:4:19)';
    expect(sanitizeJsError(error).frames).toEqual([{ file: 'index.android.bundle', line: 4, column: 18 }]);
    expect(sanitizeJsError({ stack: [{ file: 'file:///android_asset/index.android.bundle', lineNumber: 1, column: 42 }] }).frames)
      .toEqual([{ file: 'index.android.bundle', line: 1, column: 42 }]);
    expect(sanitizeJsError({ stack: [{ file: 'assets://index.android.bundle?token=secret', lineNumber: 1, column: 42 }] }).frames)
      .toEqual([]);
  });

  test('does not trust array slice methods and bounds traversal of hostile frame arrays', () => {
    const stack = Array.from({ length: 100 }, () => ({ file: 'index.android.bundle', lineNumber: 1, column: 4 }));
    const poisonedSlice = jest.fn(() => Array.from({ length: 100 }, () => stack[0]));
    stack.slice = poisonedSlice;
    expect(sanitizeJsError({ stack }).frames).toHaveLength(32);
    expect(poisonedSlice).not.toHaveBeenCalled();
    Object.defineProperty(stack, '0', { get() { throw new Error('private accessor'); } });
    expect(() => sanitizeJsError({ stack })).not.toThrow();
    expect(sanitizeJsError({ stack }).frames).toHaveLength(31);
    const proxy = new Proxy(stack, { get(target, key, receiver) {
      if (key === 'length') throw new Error('private length');
      return Reflect.get(target, key, receiver);
    } });
    expect(sanitizeJsError({ stack: proxy }).frames).toEqual([]);
  });
});
