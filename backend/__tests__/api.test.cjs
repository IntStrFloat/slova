const { test } = require('node:test');
const assert = require('node:assert');

const { createApi, divisionFor, weekKey } = require('../runtime/api.cjs');
const { createMemoryStore } = require('../runtime/store.cjs');

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
