const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { createApi, divisionFor, weekKey } = require('../runtime/api.cjs');
const { createMemoryStore } = require('../runtime/store.cjs');

const REPLACEMENT = String.fromCharCode(0xfffd); // символ-замена битого UTF-8
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function mkApi() {
  return createApi({ store: createMemoryStore(), now: () => new Date('2026-06-26T10:00:00Z') });
}
const J = (r) => JSON.parse(r.body);

test('health без авторизации', async () => {
  const api = mkApi();
  const r = await api.handle({ method: 'GET', url: '/api/health' });
  assert.equal(r.status, 200);
  assert.equal(J(r).ok, true);
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
