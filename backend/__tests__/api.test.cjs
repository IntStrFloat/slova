const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { createApi, divisionFor, weekKey } = require('../runtime/api.cjs');
const { createCatalogValidators, INTRO_CATALOG, INTRO_CATALOGS } = require('../runtime/content-catalog.cjs');
const { createMemoryStore } = require('../runtime/store.cjs');
const { checksumForManifest, publishWordPolicy } = require('../runtime/word-policy.cjs');

const REPLACEMENT = String.fromCharCode(0xfffd); // символ-замена битого UTF-8
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function mkApi() {
  return createApi({ store: createMemoryStore(), now: () => new Date('2026-06-26T10:00:00Z') });
}

function policyManifest(revision = 1) {
  const manifest = {
    schemaVersion: 1,
    locale: 'ru',
    contentVersion: '2026.07.13',
    revision,
    publishedAt: '2026-07-13T00:00:00.000Z',
    expiresAt: '2026-08-13T00:00:00.000Z',
    checksum: '',
    allow: [{ word: 'слово', rewardEligible: true }],
    deny: [{ word: 'брань', reason: 'profanity' }],
    fallbackByGlobalLevel: {},
  };
  manifest.checksum = checksumForManifest(manifest);
  return manifest;
}

function wordReport(reportId = crypto.randomUUID(), word = 'слово') {
  return {
    reportId,
    createdAt: '2026-06-26T10:00:00.000Z',
    locale: 'ru',
    normalizedWord: word,
    reportKind: 'missing_valid',
    currentClassification: 'invalid',
    globalLevel: 1,
    world: 'world1',
    mode: 'normal',
    contentVersion: '2026.07.13',
    levelFingerprint: 'a'.repeat(64),
    policyRevision: null,
    appVersion: '0.1.0',
  };
}
const J = (r) => JSON.parse(r.body);

test('health без авторизации', async () => {
  const api = mkApi();
  const r = await api.handle({ method: 'GET', url: '/api/health' });
  assert.equal(r.status, 200);
  assert.equal(J(r).ok, true);
});

test('word policy выдаётся публично с ETag и не публикует невалидную revision', async () => {
  const store = createMemoryStore();
  const manifest = policyManifest();
  assert.equal((await publishWordPolicy(store, manifest)).ok, true);
  assert.equal((await publishWordPolicy(store, manifest)).error, 'non_monotonic_policy_revision');
  const api = createApi({ store, featureFlags: { remoteWordPolicy: true } });
  const first = await api.handle({ method: 'GET', url: '/api/content/word-policy?locale=ru&contentVersion=2026.07.13' });
  assert.equal(first.status, 200);
  assert.equal(J(first).checksum, manifest.checksum);
  const cached = await api.handle({ method: 'GET', url: '/api/content/word-policy?locale=ru&contentVersion=2026.07.13', headers: { 'if-none-match': first.headers.etag } });
  assert.equal(cached.status, 304);
});

test('word reports validate content, are idempotent, and stay in moderation storage', async () => {
  const store = createMemoryStore();
  const moderationStore = createMemoryStore();
  const api = createApi({
    store,
    moderationStore,
    featureFlags: { wordReports: true },
    validateReportContext: (report) => report.globalLevel === 1,
    now: () => new Date('2026-06-26T10:00:00Z'),
  });
  const { auth } = await boot(api, 'Репорт');
  const report = wordReport();
  const headers = { ...auth, 'idempotency-key': report.reportId };
  const submitted = await Promise.all([
    api.handle({ method: 'POST', url: '/api/word-reports', headers, body: JSON.stringify(report), ip: '203.0.113.10' }),
    api.handle({ method: 'POST', url: '/api/word-reports', headers, body: JSON.stringify(report), ip: '203.0.113.10' }),
  ]);
  assert.deepEqual(submitted.map((response) => response.status).sort(), [200, 201]);
  const replay = await api.handle({ method: 'POST', url: '/api/word-reports', headers, body: JSON.stringify(report), ip: '203.0.113.10' });
  assert.equal(replay.status, 200);
  assert.equal(J(replay).duplicate, true);
  assert.equal(store.read().wordReports, undefined);
  assert.equal(moderationStore.read().wordReports.byId[report.reportId].normalizedWord, 'слово');
});

test('word reports accept exactly the shipped intro fingerprints and retain legacy SHA levels', async () => {
  const catalog = {
    contentVersions: {
      '2026.07.13': {
        levels: { 1: { world: 'world1', fingerprint: 'a'.repeat(64), letters: [...'слово'] } },
      },
      'intro-v1': { levels: { 1: { world: 'world1', fingerprint: 'tampered', letters: [...'кот'] } } },
    },
  };
  const moderationStore = createMemoryStore();
  const api = createApi({
    store: createMemoryStore(), moderationStore,
    featureFlags: { wordReports: true },
    ...createCatalogValidators(catalog),
    now: () => new Date('2026-06-26T10:00:00Z'),
  });
  const { auth } = await boot(api, 'Вводные');
  const words = ['кот', 'сон', 'дело', 'рост', 'клуб'];
  for (const [version, introCatalog] of Object.entries(INTRO_CATALOGS)) {
    const { auth: introAuth } = await boot(api, `Вводные ${version}`);
    for (let id = 1; id <= 5; id += 1) {
    const report = {
      ...wordReport(crypto.randomUUID(), words[id - 1]),
      globalLevel: id, contentVersion: version,
      levelFingerprint: introCatalog.levels[id].fingerprint,
    };
    const headers = { ...introAuth, 'idempotency-key': report.reportId };
    const accepted = await api.handle({ method: 'POST', url: '/api/word-reports', headers, body: JSON.stringify(report) });
    assert.equal(accepted.status, 201);
    const replay = await api.handle({ method: 'POST', url: '/api/word-reports', headers, body: JSON.stringify(report) });
    assert.equal(replay.status, 200);
    assert.equal(J(replay).duplicate, true);
    }
  }
  assert.equal(Object.keys(moderationStore.read().wordReports.byId).length, 10);

  const legacy = wordReport(crypto.randomUUID(), 'слово');
  const legacyResponse = await api.handle({
    method: 'POST', url: '/api/word-reports',
    headers: { ...auth, 'idempotency-key': legacy.reportId }, body: JSON.stringify(legacy),
  });
  assert.equal(legacyResponse.status, 201);

  for (const altered of [
    { contentVersion: 'intro-v1', levelFingerprint: 'intro-v1:1:кот:ток,кот' },
    { contentVersion: 'intro-v1', globalLevel: 2, levelFingerprint: INTRO_CATALOG.levels[1].fingerprint },
    { contentVersion: 'intro-v1', mode: 'daily', levelFingerprint: INTRO_CATALOG.levels[1].fingerprint },
    { contentVersion: 'intro-v2', mode: 'daily', levelFingerprint: INTRO_CATALOG.levels[1].fingerprint },
    { contentVersion: 'other', levelFingerprint: 'arbitrary-non-sha' },
  ]) {
    const invalid = { ...wordReport(crypto.randomUUID(), 'кот'), ...altered };
    const rejected = await api.handle({
      method: 'POST', url: '/api/word-reports',
      headers: { ...auth, 'idempotency-key': invalid.reportId }, body: JSON.stringify(invalid),
    });
    assert.equal(rejected.status, 400);
    assert.equal(J(rejected).error, 'bad_report_content');
  }
});

test('word reports accept level 1000 and reject levels beyond the campaign', async () => {
  const api = createApi({
    store: createMemoryStore(),
    moderationStore: createMemoryStore(),
    featureFlags: { wordReports: true },
    validateReportContext: (report) => report.world === 'world14',
    now: () => new Date('2026-06-26T10:00:00Z'),
  });
  const { auth } = await boot(api, 'Путешественник');
  const report = wordReport();
  report.globalLevel = 1000;
  report.world = 'world14';
  const response = await api.handle({
    method: 'POST',
    url: '/api/word-reports',
    headers: { ...auth, 'idempotency-key': report.reportId },
    body: JSON.stringify(report),
  });
  assert.equal(response.status, 201);
  const invalid = { ...wordReport(), globalLevel: 1001, world: 'world14' };
  const rejected = await api.handle({
    method: 'POST',
    url: '/api/word-reports',
    headers: { ...auth, 'idempotency-key': invalid.reportId },
    body: JSON.stringify(invalid),
  });
  assert.equal(rejected.status, 400);
  assert.equal(J(rejected).error, 'bad_report_context');
});

test('word reports reject invalid context and enforce daily user cap', async () => {
  const api = createApi({
    store: createMemoryStore(),
    moderationStore: createMemoryStore(),
    featureFlags: { wordReports: true },
    validateReportContext: (report) => report.world === 'world1',
    now: () => new Date('2026-06-26T10:00:00Z'),
  });
  const { auth } = await boot(api, 'Лимиты');
  const invalid = wordReport();
  invalid.world = 'other';
  assert.equal((await api.handle({ method: 'POST', url: '/api/word-reports', headers: { ...auth, 'idempotency-key': invalid.reportId }, body: JSON.stringify(invalid) })).status, 400);
  const words = ['слово', 'берег', 'ветер', 'город', 'дорога', 'земля', 'камень', 'лампа', 'море', 'небо', 'остров'];
  for (const word of words.slice(0, 10)) {
    const report = wordReport(crypto.randomUUID(), word);
    assert.equal((await api.handle({ method: 'POST', url: '/api/word-reports', headers: { ...auth, 'idempotency-key': report.reportId }, body: JSON.stringify(report), ip: '198.51.100.2' })).status, 201);
  }
  const overLimit = wordReport(crypto.randomUUID(), words[10]);
  assert.equal((await api.handle({ method: 'POST', url: '/api/word-reports', headers: { ...auth, 'idempotency-key': overLimit.reportId }, body: JSON.stringify(overLimit), ip: '198.51.100.2' })).status, 429);
});

test('bootstrap создаёт профиль и токен', async () => {
  const api = mkApi();
  const r = await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: JSON.stringify({ nickname: 'Игрок' }) });
  assert.equal(r.status, 200);
  const b = J(r);
  assert.ok(b.authToken);
  assert.equal(b.profile.nickname, 'Игрок');
  assert.equal(b.profile.score, 0);
});

test('bootstrap отвергает плохой ник', async () => {
  const api = mkApi();
  const r = await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: JSON.stringify({ nickname: 'x' }) });
  assert.equal(r.status, 400);
});

test('bootstrap отвергает битый UTF-8 в нике', async () => {
  const api = mkApi();
  const r = await api.handle({
    method: 'POST',
    url: '/api/profile/bootstrap',
    body: JSON.stringify({ nickname: `абв${REPLACEMENT}${REPLACEMENT}` }),
  });
  assert.equal(r.status, 400);
});

test('лидерборд маскирует уже сохранённые битые ники', async () => {
  const week = weekKey('2026-06-26T10:00:00Z');
  const mkUser = (id, nickname, tag, token) => ({
    id,
    nickname,
    tag,
    tokenHash: hashToken(token),
    levels: 1,
    score: 100,
    weekly: { week, base: 0 },
    save: null,
    teamId: null,
    createdAt: '',
  });
  const initial = {
    users: {
      me: mkUser('me', 'Я', '1000', 'tok'),
      bad: mkUser('bad', `${REPLACEMENT}${REPLACEMENT}${REPLACEMENT}`, '9369', 'x'),
    },
  };
  const api = createApi({ store: createMemoryStore(initial), now: () => new Date('2026-06-26T10:00:00Z') });
  const snap = J(await api.handle({ method: 'GET', url: '/api/leaderboard', headers: { authorization: 'Bearer tok' } }));
  const badRow = snap.top.find((r) => r.tag === '9369');
  assert.equal(badRow.nickname, 'Игрок'); // вместо «кракозябр»
});

test('без авторизации защищённые эндпойнты 401', async () => {
  const api = mkApi();
  const r = await api.handle({ method: 'GET', url: '/api/leaderboard' });
  assert.equal(r.status, 401);
});

test('progress серверо-авторитетный + санити-лимит', async () => {
  const api = mkApi();
  const boot = J(await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: JSON.stringify({ nickname: 'Тест' }) }));
  const auth = { authorization: `Bearer ${boot.authToken}` };
  // присылаем огромное число — сервер ограничивает дельту
  await api.handle({ method: 'POST', url: '/api/progress', headers: auth, body: JSON.stringify({ levels: 99999 }) });
  const snap = J(await api.handle({ method: 'GET', url: '/api/leaderboard', headers: auth }));
  // дельта ограничена 100 уровнями → score = 100*100
  assert.equal(snap.me.score, 100 * 100);
});

test('progress монотонен (не падает)', async () => {
  const api = mkApi();
  const boot = J(await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: JSON.stringify({ nickname: 'Моно' }) }));
  const auth = { authorization: `Bearer ${boot.authToken}` };
  await api.handle({ method: 'POST', url: '/api/progress', headers: auth, body: JSON.stringify({ levels: 50 }) });
  await api.handle({ method: 'POST', url: '/api/progress', headers: auth, body: JSON.stringify({ levels: 10 }) });
  const snap = J(await api.handle({ method: 'GET', url: '/api/leaderboard', headers: auth }));
  assert.equal(snap.me.score, 50 * 100);
});

test('cloud save round-trip с версиями', async () => {
  const api = mkApi();
  const boot = J(await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: JSON.stringify({ nickname: 'Сейв' }) }));
  const auth = { authorization: `Bearer ${boot.authToken}` };
  await api.handle({ method: 'POST', url: '/api/save', headers: auth, body: JSON.stringify({ version: 1, save: { coins: 500 } }) });
  // более старая версия не перетирает
  await api.handle({ method: 'POST', url: '/api/save', headers: auth, body: JSON.stringify({ version: 0, save: { coins: 0 } }) });
  const got = J(await api.handle({ method: 'GET', url: '/api/save', headers: auth }));
  assert.equal(got.save.coins, 500);
});

test('division по очкам', () => {
  assert.equal(divisionFor(0), 'Бронза');
  assert.equal(divisionFor(3500), 'Золото');
  assert.equal(divisionFor(50000), 'Алмаз');
});

test('weekKey — понедельник недели (UTC)', () => {
  assert.equal(weekKey('2026-06-26T10:00:00Z'), '2026-06-22'); // пятница → пн 22 июня
});

async function boot(api, nick) {
  const b = J(await api.handle({ method: 'POST', url: '/api/profile/bootstrap', body: JSON.stringify({ nickname: nick }) }));
  return { token: b.authToken, auth: { authorization: `Bearer ${b.authToken}` } };
}

test('событие недели: board + me', async () => {
  const api = mkApi();
  const { auth } = await boot(api, 'Эвент');
  await api.handle({ method: 'POST', url: '/api/progress', headers: auth, body: JSON.stringify({ levels: 3 }) });
  const ev = J(await api.handle({ method: 'GET', url: '/api/events/current', headers: auth }));
  assert.ok(ev.event.id.startsWith('weekly-'));
  assert.equal(ev.me.score, 300);
});

test('команды: создание, вступление, сумма очков, выход', async () => {
  const api = mkApi();
  const a = await boot(api, 'Лидер');
  const b = await boot(api, 'Участник');
  // прогресс для суммы
  await api.handle({ method: 'POST', url: '/api/progress', headers: a.auth, body: JSON.stringify({ levels: 5 }) });
  await api.handle({ method: 'POST', url: '/api/progress', headers: b.auth, body: JSON.stringify({ levels: 2 }) });
  const created = J(await api.handle({ method: 'POST', url: '/api/teams', headers: a.auth, body: JSON.stringify({ name: 'Знатоки' }) }));
  const teamId = created.team.id;
  // повторное создание — already_in_team
  assert.equal((await api.handle({ method: 'POST', url: '/api/teams', headers: a.auth, body: JSON.stringify({ name: 'Ещё' }) })).status, 400);
  await api.handle({ method: 'POST', url: `/api/teams/${teamId}/join`, headers: b.auth });
  const mine = J(await api.handle({ method: 'GET', url: '/api/teams/mine', headers: b.auth }));
  assert.equal(mine.team.memberCount, 2);
  assert.equal(mine.team.totalScore, 700); // 500 + 200
  await api.handle({ method: 'POST', url: `/api/teams/${teamId}/leave`, headers: b.auth });
  const after = J(await api.handle({ method: 'GET', url: '/api/teams/mine', headers: b.auth }));
  assert.equal(after.team, null);
});
