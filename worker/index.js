import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Store, id, enrichSession } from './store.js';
import { parseGpx, parseCsv } from './gpx.js';
import { analyzeSession, duelCompare, formatMs } from './analysis.js';

const app = new Hono();

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, city: u.city };
}

async function requireUser(c) {
  const header = c.req.header('Authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || getCookie(c, 'pitlane_token');
  const user = await Store.authUser(c.env.DB, token);
  if (!user) return null;
  return { user, token };
}

function json(c, data, status = 200) {
  return c.json(data, status);
}

app.use('*', async (c, next) => {
  await Store.ensureSeed(c.env.DB);
  await next();
});

app.options('/api/*', (c) => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': c.req.header('Origin') || '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
});

app.post('/api/auth/request', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(c, { error: 'Укажите корректный email' }, 400);
  const token = id(32);
  await Store.putMagic(c.env.DB, token, email);
  const base = c.env.PUBLIC_URL || new URL(c.req.url).origin;
  return json(c, {
    ok: true,
    message: 'Ссылка для входа готова. В демо SMTP нет — откройте её ниже.',
    magicUrl: `${base.replace(/\/$/, '')}/auth/verify?token=${token}`,
    demo: true,
  });
});

app.post('/api/auth/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (!token) return json(c, { error: 'Нет токена' }, 400);
  const row = await Store.getMagic(c.env.DB, token);
  if (!row || row.used) return json(c, { error: 'Ссылка недействительна' }, 400);
  if (new Date(row.expires_at) < new Date()) return json(c, { error: 'Ссылка истекла' }, 400);
  await Store.useMagic(c.env.DB, token, row);
  let user = await Store.userByEmail(c.env.DB, row.email);
  if (!user) {
    user = { id: id(), email: row.email, name: row.email.split('@')[0], city: null, created_at: new Date().toISOString() };
    await Store.saveUser(c.env.DB, user);
  }
  const sessionToken = id(40);
  await Store.putAuth(c.env.DB, sessionToken, user.id);
  setCookie(c, 'pitlane_token', sessionToken, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 30 * 24 * 3600, secure: true });
  return json(c, { ok: true, token: sessionToken, user: publicUser(user) });
});

app.get('/api/me', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  return json(c, { user: publicUser(auth.user) });
});

app.post('/api/me', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const user = { ...auth.user, name: String(body.name || '').trim().slice(0, 80) || null, city: String(body.city || '').trim().slice(0, 80) || null };
  await Store.saveUser(c.env.DB, user);
  return json(c, { user: publicUser(user) });
});

app.post('/api/auth/logout', async (c) => {
  const auth = await requireUser(c);
  if (auth?.token) await Store.delAuth(c.env.DB, auth.token);
  deleteCookie(c, 'pitlane_token', { path: '/' });
  return json(c, { ok: true });
});

app.get('/api/tracks', async (c) => {
  const tracks = await Store.tracks(c.env.DB);
  return json(c, { tracks: tracks.sort((a, b) => a.name.localeCompare(b.name)) });
});

app.get('/api/cars', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  return json(c, { cars: await Store.carsByUser(c.env.DB, auth.user.id) });
});

app.post('/api/cars', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const b = await c.req.json().catch(() => ({}));
  if (!b.make || !b.model) return json(c, { error: 'Марка и модель обязательны' }, 400);
  const car = {
    id: id(),
    user_id: auth.user.id,
    make: String(b.make).trim(),
    model: String(b.model).trim(),
    year: b.year ? parseInt(b.year, 10) : null,
    engine: b.engine ? String(b.engine).trim() : null,
    drivetrain: b.drivetrain ? String(b.drivetrain).trim() : null,
    power_hp: b.power_hp ? parseInt(b.power_hp, 10) : null,
    photo_url: b.photo_url || null,
    created_at: new Date().toISOString(),
  };
  await Store.saveCar(c.env.DB, car);
  return json(c, { car });
});

app.patch('/api/cars/:cid', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const car = await Store.car(c.env.DB, c.req.param('cid'));
  if (!car || car.user_id !== auth.user.id) return json(c, { error: 'Машина не найдена' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const fields = ['make', 'model', 'year', 'engine', 'drivetrain', 'power_hp', 'photo_url'];
  for (const f of fields) if (b[f] !== undefined) car[f] = b[f] === '' ? null : b[f];
  await Store.saveCar(c.env.DB, car);
  return json(c, { car });
});

app.delete('/api/cars/:cid', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const car = await Store.car(c.env.DB, c.req.param('cid'));
  if (!car || car.user_id !== auth.user.id) return json(c, { error: 'Не найдено' }, 404);
  await Store.deleteCar(c.env.DB, car);
  return json(c, { ok: true });
});

function prepareLaps(laps) {
  let best = Infinity;
  let bestIdx = -1;
  const out = (laps || []).map((l, i) => {
    const row = {
      id: l.id || id(),
      lap_number: l.lap_number || i + 1,
      time_ms: l.time_ms,
      sector1_ms: l.sector1_ms ?? null,
      sector2_ms: l.sector2_ms ?? null,
      sector3_ms: l.sector3_ms ?? null,
      is_best: 0,
      valid: l.valid === 0 ? 0 : 1,
    };
    if (row.valid && row.time_ms < best) { best = row.time_ms; bestIdx = i; }
    return row;
  });
  if (bestIdx >= 0) out[bestIdx].is_best = 1;
  return out;
}

app.get('/api/sessions', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const rows = await Store.sessionsByUser(c.env.DB, auth.user.id);
  const enriched = [];
  for (const s of rows) enriched.push(await enrichSession(c.env.DB, s));
  return json(c, { sessions: enriched });
});

app.get('/api/sessions/comparable', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const map = new Map();
  for (const s of await Store.sessionsByUser(c.env.DB, auth.user.id)) {
    const e = await enrichSession(c.env.DB, s);
    map.set(e.id, { ...e, source: 'own' });
  }
  for (const s of await Store.scoredSessions(c.env.DB)) {
    if (s.user_id === auth.user.id) continue;
    const e = await enrichSession(c.env.DB, s);
    if (!map.has(e.id)) map.set(e.id, { ...e, source: 'scored' });
  }
  const crews = await Store.crewsByUser(c.env.DB, auth.user.id);
  for (const crew of crews) {
    for (const sid of crew.shared_sessions || []) {
      const s = await Store.session(c.env.DB, sid);
      if (!s || s.user_id === auth.user.id) continue;
      const e = await enrichSession(c.env.DB, s);
      if (!map.has(e.id)) map.set(e.id, { ...e, source: 'crew' });
    }
  }
  return json(c, { sessions: [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1)) });
});

app.post('/api/sessions', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const b = await c.req.json().catch(() => ({}));
  if (!b.car_id || !b.track_id || !b.date) return json(c, { error: 'Нужны car_id, track_id, date' }, 400);
  const car = await Store.car(c.env.DB, b.car_id);
  if (!car || car.user_id !== auth.user.id) return json(c, { error: 'Машина не из вашего гаража' }, 400);
  const track = await Store.track(c.env.DB, b.track_id);
  if (!track) return json(c, { error: 'Трек не найден' }, 400);
  const session = {
    id: id(),
    user_id: auth.user.id,
    car_id: b.car_id,
    track_id: b.track_id,
    date: b.date,
    weather: b.weather || null,
    temp_c: b.temp_c != null ? Number(b.temp_c) : null,
    tire: b.tire || null,
    pressure_fl: b.pressure_fl != null ? Number(b.pressure_fl) : null,
    pressure_fr: b.pressure_fr != null ? Number(b.pressure_fr) : null,
    pressure_rl: b.pressure_rl != null ? Number(b.pressure_rl) : null,
    pressure_rr: b.pressure_rr != null ? Number(b.pressure_rr) : null,
    note: b.note || null,
    visibility: ['private', 'crew', 'public'].includes(b.visibility) ? b.visibility : 'private',
    scored: b.scored ? 1 : 0,
    source_file: null,
    created_at: new Date().toISOString(),
    laps: prepareLaps(b.laps || []),
  };
  await Store.saveSession(c.env.DB, session);
  return json(c, { session: await enrichSession(c.env.DB, session), analysis: analyzeSession(session.laps) });
});

app.get('/api/sessions/:sid', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const session = await Store.session(c.env.DB, c.req.param('sid'));
  if (!session) return json(c, { error: 'Сессия не найдена' }, 404);
  if (session.user_id !== auth.user.id && !(session.scored && session.visibility !== 'private')) {
    const crews = await Store.crewsByUser(c.env.DB, auth.user.id);
    const shared = crews.some((cr) => (cr.shared_sessions || []).includes(session.id));
    if (!shared && session.visibility === 'private') return json(c, { error: 'Сессия закрыта' }, 403);
  }
  return json(c, { session: await enrichSession(c.env.DB, session), analysis: analyzeSession(session.laps || []) });
});

app.patch('/api/sessions/:sid', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const session = await Store.session(c.env.DB, c.req.param('sid'));
  if (!session || session.user_id !== auth.user.id) return json(c, { error: 'Не найдено' }, 404);
  const b = await c.req.json().catch(() => ({}));
  for (const f of ['weather', 'temp_c', 'tire', 'pressure_fl', 'pressure_fr', 'pressure_rl', 'pressure_rr', 'note', 'visibility', 'scored', 'date']) {
    if (b[f] !== undefined) {
      if (f === 'scored') session.scored = b[f] ? 1 : 0;
      else if (f === 'visibility') session.visibility = ['private', 'crew', 'public'].includes(b[f]) ? b[f] : 'private';
      else session[f] = b[f];
    }
  }
  if (Array.isArray(b.laps)) session.laps = prepareLaps(b.laps);
  await Store.saveSession(c.env.DB, session);
  return json(c, { session: await enrichSession(c.env.DB, session), analysis: analyzeSession(session.laps || []) });
});

app.post('/api/sessions/:sid/upload', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const session = await Store.session(c.env.DB, c.req.param('sid'));
  if (!session || session.user_id !== auth.user.id) return json(c, { error: 'Не найдено' }, 404);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file) return json(c, { error: 'Нет файла' }, 400);
  const name = (file.name || '').toLowerCase();
  const text = await file.text();
  const result = name.endsWith('.csv') && !text.includes('<gpx') ? parseCsv(text) : parseGpx(text);
  if (!result.ok) return json(c, { error: result.error, pointCount: result.pointCount, hint: 'Можно добавить круг вручную на этой же странице.' }, 400);
  session.laps = prepareLaps(result.laps);
  session.source_file = file.name || 'upload';
  await Store.saveSession(c.env.DB, session);
  return json(c, {
    ok: true,
    pointCount: result.pointCount,
    lapCount: result.laps.length,
    session: await enrichSession(c.env.DB, session),
    analysis: analyzeSession(session.laps),
  });
});

app.post('/api/sessions/:sid/manual-lap', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const session = await Store.session(c.env.DB, c.req.param('sid'));
  if (!session || session.user_id !== auth.user.id) return json(c, { error: 'Не найдено' }, 404);
  const b = await c.req.json().catch(() => ({}));
  function parseTimeInput(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Math.round(v);
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const m = s.match(/^(\d+):(\d{2})(?:[\.:](\d{1,3}))?$/);
    if (m) {
      const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      return parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + ms;
    }
    const f = parseFloat(s.replace(',', '.'));
    return Number.isFinite(f) ? Math.round(f * 1000) : null;
  }
  const time_ms = parseTimeInput(b.time);
  if (!time_ms || time_ms < 5000) return json(c, { error: 'Укажите время круга, напр. 1:48.320' }, 400);
  const existing = session.laps || [];
  existing.push({
    lap_number: existing.length + 1,
    time_ms,
    sector1_ms: parseTimeInput(b.sector1),
    sector2_ms: parseTimeInput(b.sector2),
    sector3_ms: parseTimeInput(b.sector3),
    valid: 1,
  });
  session.laps = prepareLaps(existing);
  await Store.saveSession(c.env.DB, session);
  return json(c, { session: await enrichSession(c.env.DB, session), analysis: analyzeSession(session.laps) });
});

app.get('/api/demo/example', async (c) => {
  const s = await Store.demoSession(c.env.DB);
  if (!s) return json(c, { example: null });
  return json(c, { example: { session: await enrichSession(c.env.DB, s), analysis: analyzeSession(s.laps || []) } });
});

app.get('/api/crews', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  return json(c, { crews: await Store.crewsByUser(c.env.DB, auth.user.id) });
});

app.post('/api/crews', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const b = await c.req.json().catch(() => ({}));
  const crew = {
    id: id(10),
    name: String(b.name || '').trim() || 'Экипаж',
    owner_id: auth.user.id,
    invite_code: id(8),
    created_at: new Date().toISOString(),
    members: [auth.user.id],
    shared_sessions: [],
  };
  await Store.saveCrew(c.env.DB, crew);
  return json(c, { crew });
});

app.get('/api/crews/:cid', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const crew = await Store.crew(c.env.DB, c.req.param('cid'));
  if (!crew || !(crew.members || []).includes(auth.user.id)) return json(c, { error: 'Вы не в этом экипаже' }, 403);
  const members = [];
  for (const mid of crew.members || []) {
    const u = await Store.userById(c.env.DB, mid);
    if (u) members.push({ id: u.id, name: u.name, city: u.city, email: u.email });
  }
  const sessions = [];
  for (const sid of crew.shared_sessions || []) {
    const s = await Store.session(c.env.DB, sid);
    if (s) sessions.push(await enrichSession(c.env.DB, s));
  }
  const cars = [];
  for (const mid of crew.members || []) {
    for (const car of await Store.carsByUser(c.env.DB, mid)) {
      const owner = await Store.userById(c.env.DB, mid);
      cars.push({ ...car, owner_name: owner?.name });
    }
  }
  return json(c, { crew, members, sessions, cars });
});

app.post('/api/crews/join', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const b = await c.req.json().catch(() => ({}));
  const code = String(b.code || b.invite_code || '').trim();
  const crew = await Store.crewByInvite(c.env.DB, code);
  if (!crew) return json(c, { error: 'Инвайт не найден' }, 404);
  if (!(crew.members || []).includes(auth.user.id)) crew.members = [...(crew.members || []), auth.user.id];
  await Store.saveCrew(c.env.DB, crew);
  return json(c, { crew });
});

app.post('/api/crews/:cid/share-session', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const crew = await Store.crew(c.env.DB, c.req.param('cid'));
  if (!crew || !(crew.members || []).includes(auth.user.id)) return json(c, { error: 'Не в экипаже' }, 403);
  const b = await c.req.json().catch(() => ({}));
  const session = await Store.session(c.env.DB, b.session_id);
  if (!session || session.user_id !== auth.user.id) return json(c, { error: 'Сессия не найдена' }, 404);
  if (!(crew.shared_sessions || []).includes(session.id)) crew.shared_sessions = [...(crew.shared_sessions || []), session.id];
  if (session.visibility === 'private') {
    session.visibility = 'crew';
    await Store.saveSession(c.env.DB, session);
  }
  await Store.saveCrew(c.env.DB, crew);
  return json(c, { ok: true });
});

app.post('/api/duel', async (c) => {
  const auth = await requireUser(c);
  if (!auth) return json(c, { error: 'Нужен вход' }, 401);
  const b = await c.req.json().catch(() => ({}));
  const a = await Store.session(c.env.DB, b.session_a);
  const bb = await Store.session(c.env.DB, b.session_b);
  if (!a || !bb) return json(c, { error: 'Сессия не найдена' }, 404);
  if (a.track_id !== bb.track_id) return json(c, { error: 'Дуэль только на одном треке' }, 400);
  const cmp = duelCompare(a.laps || [], bb.laps || []);
  const track = await Store.track(c.env.DB, a.track_id);
  return json(c, {
    track: { id: a.track_id, name: track?.name },
    session_a: await enrichSession(c.env.DB, a),
    session_b: await enrichSession(c.env.DB, bb),
    ...cmp,
  });
});

app.get('/api/tops', async (c) => {
  const track_id = c.req.query('track_id');
  const model = String(c.req.query('model') || '').trim();
  const tire = String(c.req.query('tire') || '').trim();
  if (!track_id || !model || !tire) {
    return json(c, { error: 'Топ только с фильтром: track_id + model + tire', required: ['track_id', 'model', 'tire'] }, 400);
  }
  const scored = await Store.scoredSessions(c.env.DB);
  const entries = [];
  for (const s of scored) {
    if (s.track_id !== track_id) continue;
    if (String(s.tire || '').toLowerCase() !== tire.toLowerCase()) continue;
    const car = await Store.car(c.env.DB, s.car_id);
    if (!car || String(car.model).toLowerCase() !== model.toLowerCase()) continue;
    const best = (s.laps || []).find((l) => l.is_best) || (s.laps || []).slice().sort((x, y) => x.time_ms - y.time_ms)[0];
    if (!best) continue;
    const user = await Store.userById(c.env.DB, s.user_id);
    const track = await Store.track(c.env.DB, s.track_id);
    entries.push({
      session_id: s.id,
      date: s.date,
      tire: s.tire,
      temp_c: s.temp_c,
      weather: s.weather,
      make: car.make,
      model: car.model,
      year: car.year,
      power_hp: car.power_hp,
      drivetrain: car.drivetrain,
      user_name: user?.name,
      user_city: user?.city,
      time_ms: best.time_ms,
      lap_number: best.lap_number,
      track_name: track?.name,
    });
  }
  entries.sort((a, b) => a.time_ms - b.time_ms);
  return json(c, {
    filter: { track_id, model, tire },
    entries: entries.slice(0, 50).map((e, i) => ({
      rank: i + 1,
      ...e,
      time_label: formatMs(e.time_ms),
      caption: `${e.make} ${e.model}${e.year ? ' ' + e.year : ''} · ${e.tire}`,
    })),
  });
});

app.all('/api/*', (c) => json(c, { error: 'Not found' }, 404));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx);
    }
    // static assets / SPA
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('PITLANE Web', { status: 200 });
  },
};
