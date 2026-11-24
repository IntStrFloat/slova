export type CrashFrame = { file: 'index.android.bundle'; line: number; column: number };
export type SafeJsError = { schemaVersion: 1; errorKind: string; fatal: boolean;
  engine: 'hermes' | 'unknown'; frames: CrashFrame[] };

const ERROR_KINDS = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError']);
const MAX_FRAMES = 32;
const MAX_COORDINATE = 2_147_483_647;
const BUNDLE_NAMES = new Set(['index.android.bundle', 'assets://index.android.bundle', 'asset:///index.android.bundle', 'file:///android_asset/index.android.bundle']);

function property(value: unknown, key: string): unknown {
  try { return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined; }
  catch { return undefined; }
}
function coordinate(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= MAX_COORDINATE;
}
function frame(value: unknown): CrashFrame | null {
  const file = property(value, 'file');
  const line = property(value, 'lineNumber');
  const column = property(value, 'column');
  return typeof file === 'string' && BUNDLE_NAMES.has(file) && coordinate(line, 1) && coordinate(column, 0)
    ? { file: 'index.android.bundle', line, column } : null;
}

/** Only compiled bundle coordinates cross this boundary; no error text or arbitrary metadata. */
export function sanitizeJsError(input: unknown, fatalHint = false, engine: 'hermes' | 'unknown' = 'unknown'): SafeJsError {
  const name = property(input, 'name');
  const fatal = property(input, 'isFatal');
  const stack = property(input, 'stack');
  const frames: CrashFrame[] = [];
  if (Array.isArray(stack)) {
    try {
      // Error objects can supply arrays with replaced methods/accessors. Never invoke
      // their slice/iterator; even a forged length cannot exceed this index bound.
      for (let index = 0; index < MAX_FRAMES && index < stack.length; index++) {
        const safe = frame(property(stack, String(index)));
        if (safe) frames.push(safe);
      }
    } catch { /* A hostile proxy is an unknown stack, never a second reporting error. */ }
  } else if (typeof stack === 'string') {
    // Hermes bytecode offsets are already zero-based. The first (message) line is ignored.
    for (const line of stack.slice(0, 16_384).split('\n').slice(1, MAX_FRAMES + 1)) {
      const match = line.match(/^\s*at .+? \((address at )?((?:assets:\/\/|asset:\/\/\/|file:\/\/\/android_asset\/)?index\.android\.bundle):(\d+):(\d+)\)$/);
      if (!match) continue;
      const safe = frame({ file: match[2], lineNumber: Number(match[3]),
        column: Number(match[4]) - (match[1] ? 0 : 1) });
      if (safe) frames.push(safe);
    }
  }
  return { schemaVersion: 1, errorKind: typeof name === 'string' && ERROR_KINDS.has(name) ? name : 'Error',
    fatal: typeof fatal === 'boolean' ? fatal : fatalHint, engine, frames };
}
