const crypto = require('node:crypto');

const POINTS_PER_LEVEL = 100;
const MAX_LEVELS = 100_000;
const MAX_DELTA_PER_SUBMIT = 100; // санити-лимит против накрутки

const DIVISIONS = [
  ['Бронза', 0],
  ['Серебро', 1000],
  ['Золото', 3000],
  ['Платина', 8000],
  ['Алмаз', 20000],
];

function divisionFor(score) {
  let d = DIVISIONS[0][0];
  for (const [name, min] of DIVISIONS) if (score >= min) d = name;
  return d;
}

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}
function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

function weekKey(date) {
  const d = new Date(date);
  const dow = (d.getUTCDay() + 6) % 7; // понедельник = 0
  d.setUTCDate(d.getUTCDate() - dow);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// U+FFFD появляется только при декодировании битого UTF-8 — в корректном вводе его нет.
const BROKEN_NICK = /[\uFFFD\u0000-\u001F\u007F]/;

function validateNickname(raw) {
  const v = String(raw ?? '').trim();
  if (v.length < 2 || v.length > 16) return { ok: false, error: 'bad_nickname' };
  if (BROKEN_NICK.test(v)) return { ok: false, error: 'bad_nickname' };
  return { ok: true, value: v };
}

// Защита на выдаче: уже сохранённые битые ники не должны утекать в клиент «кракозябрами».
function safeNick(nickname) {
  const v = String(nickname ?? '');
  if (!v || BROKEN_NICK.test(v)) return 'Игрок';
  return v;
}

function lowerHeaders(h) {
  const out = {};
  for (const k of Object.keys(h)) out[String(k).toLowerCase()] = h[k];
  return out;
}

function publicProfile(u) {
  return {
    userId: u.id,
    nickname: safeNick(u.nickname),
    tag: u.tag,
    levels: u.levels,
    score: u.score,
    division: divisionFor(u.score),
  };
}

function teamPublic(data, t) {
  const members = t.members.map((m) => ({
    nickname: data.users[m] ? safeNick(data.users[m].nickname) : '—',
    score: data.users[m] ? data.users[m].score : 0,
  }));
  return {
    id: t.id,
    name: t.name,
    leaderId: t.leaderId,
    memberCount: t.members.length,
    totalScore: members.reduce((s, m) => s + m.score, 0),
    members,
  };
}

function eventBoard(data, userId, nowDate) {
  const week = weekKey(nowDate);
  const rows = Object.values(data.users)
    .map((u) => ({
      userId: u.id,
      nickname: safeNick(u.nickname),
      tag: u.tag,
      score: u.weekly && u.weekly.week === week ? Math.max(0, u.score - u.weekly.base) : 0,
    }))
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  rows.forEach((r, i) => (r.rank = i + 1));
  const me = rows.find((r) => r.userId === userId) || null;
  return {
    event: { id: `weekly-${week}`, title: 'Турнир недели', metric: 'Очки за неделю', week },
    board: rows.slice(0, 50),
    me,
  };
}

function buildSnapshot(data, userId, scope, nowDate) {
  const week = weekKey(nowDate);
  const rows = Object.values(data.users).map((u) => {
    const weekly = u.weekly && u.weekly.week === week ? u.score - u.weekly.base : 0;
    return {
      userId: u.id,
      nickname: safeNick(u.nickname),
      tag: u.tag,
      score: scope === 'weekly' ? Math.max(0, weekly) : u.score,
      division: divisionFor(u.score),
    };
  });
  rows.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  rows.forEach((r, i) => (r.rank = i + 1));
  const top = rows.slice(0, 100);
  const meIdx = rows.findIndex((r) => r.userId === userId);
  const me = meIdx >= 0 ? rows[meIdx] : null;
  const neighbors =
    meIdx >= 0 ? rows.slice(Math.max(0, meIdx - 2), meIdx + 3) : [];
  return { scope, week, top, me, neighbors, total: rows.length };
}

function createApi(options) {
  const store = options.store;
  const apiKey = options.apiKey ?? '';
  const now = options.now ?? (() => new Date());

  function json(status, body) {
    return {
      status,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type,authorization,x-api-key',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      },
      body: body == null ? '' : JSON.stringify(body),
    };
  }

  function authenticate(data, header) {
    if (!header) return null;
    const t = String(header).replace(/^Bearer\s+/i, '');
    const h = hashToken(t);
    const u = Object.values(data.users).find((u) => u.tokenHash === h);
    return u ? { user: u, token: t } : null;
  }

  async function handle(request) {
    const method = String(request.method ?? 'GET').toUpperCase();
    const url = new URL(request.url ?? '/', 'http://localhost');
    const p = url.pathname;
    const headers = lowerHeaders(request.headers ?? {});

    if (method === 'OPTIONS') return json(204, null);
    if (p === '/api/health') return json(200, { ok: true, mode: 'record-progress' });
    if (apiKey && headers['x-api-key'] !== apiKey) return json(401, { error: 'invalid_api_key' });

    let body = {};
    if (request.body) {
      try {
        body = JSON.parse(request.body);
      } catch {
        return json(400, { error: 'invalid_json' });
      }
    }

    if (method === 'POST' && p === '/api/profile/bootstrap') {
      const nick = validateNickname(body.nickname);
      if (!nick.ok) return json(400, { error: nick.error });
      const data = store.read();
      const id = crypto.randomUUID();
      const authToken = randomToken();
      data.users[id] = {
        id,
        nickname: nick.value,
        tag: String(Math.floor(1000 + Math.random() * 9000)),
        tokenHash: hashToken(authToken),
        levels: 0,
        score: 0,
        weekly: { week: weekKey(now()), base: 0 },
        save: null,
        teamId: null,
        createdAt: now().toISOString(),
      };
      store.write(data);
      return json(200, { profile: publicProfile(data.users[id]), authToken });
    }

    const data = store.read();
    const session = authenticate(data, headers.authorization);
    if (!session) return json(401, { error: 'invalid_auth' });
    const user = data.users[session.user.id];

    if (method === 'POST' && p === '/api/profile/rename') {
      const nick = validateNickname(body.nickname);
      if (!nick.ok) return json(400, { error: nick.error });
      user.nickname = nick.value;
      store.write(data);
      return json(200, { profile: publicProfile(user) });
    }

    if (method === 'POST' && p === '/api/progress') {
      const levels = Math.floor(Number(body.levels));
      if (!Number.isFinite(levels) || levels < 0 || levels > MAX_LEVELS) {
        return json(400, { error: 'bad_levels' });
      }
      const week = weekKey(now());
      if (!user.weekly || user.weekly.week !== week) {
        user.weekly = { week, base: user.score };
      }
      // монотонность + санити-лимит дельты (анти-чит)
      if (levels > user.levels) {
        const delta = Math.min(levels - user.levels, MAX_DELTA_PER_SUBMIT);
        user.levels += delta;
        user.score = user.levels * POINTS_PER_LEVEL; // серверо-авторитетный счёт
      }
      store.write(data);
      return json(200, buildSnapshot(data, user.id, 'global', now()));
    }

    if (method === 'GET' && p === '/api/leaderboard') {
      const scope = url.searchParams.get('scope') === 'weekly' ? 'weekly' : 'global';
      return json(200, buildSnapshot(data, user.id, scope, now()));
    }

    if (p === '/api/save') {
      if (method === 'GET') return json(200, { save: user.save });
      if (method === 'POST') {
        const incoming = body.save ?? null;
        const incomingVer = Number(body.version ?? 0);
        const curVer = user.save ? Number(user.save.version ?? 0) : -1;
        if (incomingVer >= curVer) {
          user.save = { ...incoming, version: incomingVer };
          store.write(data);
        }
        return json(200, { save: user.save });
      }
    }

    // ── События/турниры (спека 10) ──
    if (method === 'GET' && p === '/api/events/current') {
      return json(200, eventBoard(data, user.id, now()));
    }

    // ── Команды/клубы (спека 10) ──
    data.teams = data.teams || {};
    if (method === 'POST' && p === '/api/teams') {
      if (user.teamId) return json(400, { error: 'already_in_team' });
      const name = String(body.name ?? '').trim();
      if (name.length < 2 || name.length > 20) return json(400, { error: 'bad_name' });
      const id = crypto.randomUUID();
      data.teams[id] = { id, name, leaderId: user.id, members: [user.id], createdAt: now().toISOString() };
      user.teamId = id;
      store.write(data);
      return json(200, { team: teamPublic(data, data.teams[id]) });
    }
    if (method === 'GET' && p === '/api/teams') {
      const teams = Object.values(data.teams)
        .map((t) => teamPublic(data, t))
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, 50);
      return json(200, { teams });
    }
    if (method === 'GET' && p === '/api/teams/mine') {
      const t = user.teamId ? data.teams[user.teamId] : null;
      return json(200, { team: t ? teamPublic(data, t) : null });
    }
    if (method === 'POST' && /^\/api\/teams\/[^/]+\/join$/.test(p)) {
      if (user.teamId) return json(400, { error: 'already_in_team' });
      const id = p.split('/')[3];
      const t = data.teams[id];
      if (!t) return json(404, { error: 'no_team' });
      if (!t.members.includes(user.id)) t.members.push(user.id);
      user.teamId = id;
      store.write(data);
      return json(200, { team: teamPublic(data, t) });
    }
    if (method === 'POST' && /^\/api\/teams\/[^/]+\/leave$/.test(p)) {
      const t = user.teamId ? data.teams[user.teamId] : null;
      if (t) {
        t.members = t.members.filter((m) => m !== user.id);
        if (t.members.length === 0) delete data.teams[t.id];
        else if (t.leaderId === user.id) t.leaderId = t.members[0];
      }
      user.teamId = null;
      store.write(data);
      return json(200, { ok: true });
    }

    return json(404, { error: 'not_found' });
  }

  return { handle };
}

module.exports = { createApi, divisionFor, weekKey, buildSnapshot, POINTS_PER_LEVEL };
