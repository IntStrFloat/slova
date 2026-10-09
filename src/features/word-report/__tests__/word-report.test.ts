import { getJSON, storage } from '@/core/storage';
import { getIntroLevel } from '@/features/onboarding/introPack';
import legacyEarlyLevels from '../../../../assets/content/legacy-early-levels.json';
import { useProfile } from '@/features/profile';
import {
  canReportWord,
  flushWordReports,
  sendWordReport,
  type WordReportContext,
  type WordReportInput,
} from '../index';

const context: WordReportContext = {
  globalLevel: 6,
  world: 'world1',
  mode: 'normal',
  contentVersion: 'dict-v3',
  levelFingerprint: 'a'.repeat(64),
  policyRevision: null,
};

function input(word = 'СЛОВО'): WordReportInput {
  return { word, reportKind: 'missing_valid', currentClassification: 'invalid', context };
}

function reply(status: number, body: object = {}): Response {
  return { status, json: async () => body } as Response;
}

const originalFetch = globalThis.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  storage.clearAll();
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock;
  useProfile.setState({ profile: {
    userId: 'user-1', authToken: 'test-token', nickname: 'Игрок', tag: '1234',
  } });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('explicit report includes authenticated, idempotent content context and normalized word', async () => {
  fetchMock.mockResolvedValue(reply(201, { status: 'received', duplicate: false }));
  const outcome = await sendWordReport(input('ЁЛКА'));
  expect(outcome.status).toBe('sent');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/api\/word-reports$/);
  expect(request.headers.authorization).toBe('Bearer test-token');
  const payload = JSON.parse(request.body);
  expect(payload).toMatchObject({
    normalizedWord: 'елка', globalLevel: 6, world: 'world1', mode: 'normal',
    contentVersion: 'dict-v3', levelFingerprint: context.levelFingerprint,
    locale: 'ru', appVersion: expect.any(String),
  });
  expect(payload.reportId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(request.headers['idempotency-key']).toBe(payload.reportId);
  expect(JSON.stringify(payload)).not.toContain('ЁЛКА');
  expect(getJSON<{ pending: unknown[] }>('word-report.outbox.v1', { pending: [] }).pending).toHaveLength(0);
});

test('offline retry keeps the same report UUID and does not claim success early', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  const queued = await sendWordReport(input());
  expect(queued.status).toBe('queued');
  const saved = getJSON<{ pending: { report: { reportId: string } }[] }>('word-report.outbox.v1', { pending: [] });
  expect(saved.pending).toHaveLength(1);
  expect(saved.pending[0].report.reportId).toBe(queued.reportId);

  fetchMock.mockResolvedValue(reply(201, { status: 'received', duplicate: false }));
  await flushWordReports();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].headers['idempotency-key']).toBe(queued.reportId);
  expect(getJSON<{ pending: unknown[] }>('word-report.outbox.v1', { pending: [] }).pending).toHaveLength(0);
  expect((await sendWordReport(input())).status).toBe('duplicate');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a failed durable enqueue reports save failure and does not attempt the network', async () => {
  const write = jest.spyOn(storage, 'set').mockImplementationOnce(() => { throw new Error('disk full'); });
  const failed = await sendWordReport(input('море'));
  expect(failed.status).toBe('save_failed');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(getJSON<{ pending: unknown[] }>('word-report.outbox.v1', { pending: [] }).pending).toHaveLength(0);
  write.mockRestore();

  fetchMock.mockResolvedValue(reply(201, { duplicate: false }));
  expect((await sendWordReport(input('море'))).status).toBe('sent');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('a failed acceptance write leaves a durable report for same-ID server replay', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  const queued = await sendWordReport(input('море'));
  expect(queued.status).toBe('queued');

  const write = jest.spyOn(storage, 'set').mockImplementationOnce(() => { throw new Error('disk full'); });
  fetchMock.mockResolvedValueOnce(reply(201, { duplicate: false }));
  const uncertain = await sendWordReport(input('море'));
  expect(uncertain).toEqual({ status: 'save_failed', reportId: queued.reportId });
  expect(getJSON<{ pending: { report: { reportId: string } }[] }>('word-report.outbox.v1', { pending: [] })
    .pending[0].report.reportId).toBe(queued.reportId);
  write.mockRestore();

  fetchMock.mockResolvedValueOnce(reply(200, { duplicate: true }));
  expect((await sendWordReport(input('море'))).status).toBe('duplicate');
  expect(fetchMock.mock.calls.map(([, request]) => request.headers['idempotency-key']))
    .toEqual([queued.reportId, queued.reportId, queued.reportId]);
  expect(getJSON<{ pending: unknown[] }>('word-report.outbox.v1', { pending: [] }).pending).toHaveLength(0);
});

test('missing auth retains confirmed report until profile becomes available', async () => {
  useProfile.setState({ profile: null });
  const queued = await sendWordReport(input());
  expect(queued.status).toBe('auth_required');
  expect(fetchMock).not.toHaveBeenCalled();
  useProfile.setState({ profile: {
    userId: 'user-1', authToken: 'new-token', nickname: 'Игрок', tag: '1234',
  } });
  fetchMock.mockResolvedValue(reply(201));
  await flushWordReports();
  expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer new-token');
  expect(fetchMock.mock.calls[0][1].headers['idempotency-key']).toBe(queued.reportId);
});

test('server rate limit pauses retries and new submissions locally', async () => {
  fetchMock.mockResolvedValue(reply(429, { error: 'report_user_rate_limited', retryAfterSeconds: 3600 }));
  const first = await sendWordReport(input());
  expect(first).toMatchObject({ status: 'rate_limited', retryAfterSeconds: 3600 });
  const second = await sendWordReport(input('море'));
  expect(second.status).toBe('rate_limited');
  await flushWordReports();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('rate-limit state write failure is reported and reuses the persisted report ID', async () => {
  const realSet = storage.set.bind(storage);
  let writes = 0;
  const write = jest.spyOn(storage, 'set').mockImplementation((key, value) => {
    writes += 1;
    if (writes === 2) throw new Error('disk full');
    realSet(key, value);
  });
  fetchMock.mockResolvedValue(reply(429, { retryAfterSeconds: 3600 }));
  const uncertain = await sendWordReport(input('море'));
  expect(uncertain.status).toBe('save_failed');
  const saved = getJSON<{ pending: { report: { reportId: string } }[] }>('word-report.outbox.v1', { pending: [] });
  expect(saved.pending).toHaveLength(1);
  write.mockRestore();

  const limited = await sendWordReport(input('море'));
  expect(limited.status).toBe('rate_limited');
  expect(fetchMock.mock.calls.map(([, request]) => request.headers['idempotency-key']))
    .toEqual([saved.pending[0].report.reportId, saved.pending[0].report.reportId]);
  expect((await sendWordReport(input('дома'))).status).toBe('rate_limited');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('rejects invalid text and unsupported intro content before any network request', async () => {
  expect((await sendWordReport(input('кошка@example.com'))).status).toBe('invalid');
  expect((await sendWordReport(input('ко'))).status).toBe('invalid');
  const intro = { ...context, contentVersion: 'intro-v1', levelFingerprint: 'intro-v1:1:кот' };
  expect(canReportWord(intro)).toBe(false);
  expect((await sendWordReport({ ...input('кот'), context: intro })).status).toBe('unsupported_content');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('all five assigned intro fingerprints match the backend catalog and can be reported', async () => {
  const backend = jest.requireActual('../../../../backend/runtime/content-catalog.cjs') as {
    INTRO_CATALOG: { levels: Record<number, { fingerprint: string; world: string }> };
  };
  fetchMock.mockResolvedValue(reply(201, { duplicate: false }));
  for (let id = 1; id <= 5; id += 1) {
    const level = getIntroLevel(id)!;
    const intro = {
      ...context,
      globalLevel: id,
      contentVersion: level.contentVersion!,
      levelFingerprint: level.fingerprint!,
      world: level.world,
    };
    expect(backend.INTRO_CATALOG.levels[id].fingerprint).toBe(level.fingerprint);
    expect(canReportWord(intro)).toBe(true);
    expect((await sendWordReport({ ...input(level.answers[0].word), context: intro })).status).toBe('sent');
  }
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

test('all five archived intro puzzles remain reportable after an update', async () => {
  const backend = jest.requireActual('../../../../backend/runtime/content-catalog.cjs') as {
    INTRO_CATALOGS: Record<string, { levels: Record<number, { fingerprint: string }> }>;
  };
  fetchMock.mockResolvedValue(reply(201, { duplicate: false }));
  for (const level of legacyEarlyLevels.intro) {
    const intro = { ...context, globalLevel: level.globalId, contentVersion: level.contentVersion,
      levelFingerprint: level.fingerprint, world: level.world };
    expect(backend.INTRO_CATALOGS['intro-v1'].levels[level.id].fingerprint).toBe(level.fingerprint);
    expect(canReportWord(intro)).toBe(true);
    expect(canReportWord({ ...intro, contentVersion: 'intro-v2' })).toBe(false);
    expect((await sendWordReport({ ...input(level.answers[0].word), context: intro })).status).toBe('sent');
  }
  expect(fetchMock).toHaveBeenCalledTimes(5);
});

test('an accepted report is submitted only once from this profile', async () => {
  fetchMock.mockResolvedValue(reply(201, { duplicate: false }));
  expect((await sendWordReport(input('море'))).status).toBe('sent');
  expect((await sendWordReport(input('МОРЕ'))).status).toBe('duplicate');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('a damaged persisted queue is ignored instead of sending unconfirmed text', async () => {
  storage.set('word-report.outbox.v1', JSON.stringify({
    version: 1,
    day: '2026-09-26',
    pending: [{ key: 'tampered', report: { normalizedWord: 'произвольный текст' } }],
  }));
  await flushWordReports();
  expect(fetchMock).not.toHaveBeenCalled();
});
