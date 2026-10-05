const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const db = require('./db');
const { parseGpx, parseCsv } = require('./gpx');
const { analyzeSession, duelCompare, formatMs } = require('./analysis');

const PORT = process.env.PORT || 8787;
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

function seedTracks() {
  const tracks = [
    { id: 'moscow-raceway', name: 'Moscow Raceway', city: 'Волоколамск', length_m: 4070 },
    { id: 'adm', name: 'ADM Raceway', city: 'Мячково', length_m: 3280 },
    { id: 'sochi', name: 'Sochi Autodrom', city: 'Сочи', length_m: 5848 },
    { id: 'igora', name: 'Igora Drive', city: 'Ленобласть', length_m: 4086 },
    { id: 'kazan', name: 'Kazan Ring', city: 'Казань', length_m: 3476 },
  ];
  const ins = db.prepare(
    `INSERT OR IGNORE INTO tracks (id, name, city, length_m) VALUES (@id, @name, @city, @length_m)`
  );
  for (const t of tracks) ins.run(t);
}
seedTracks();

// auto-seed demo if no DEMO sessions
(function autoSeed() {
  const n = db.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE note LIKE '%DEMO%'`).get().c;
  if (n === 0) {
    try {
      require('./seed');
    } catch (e) {
      console.warn('auto-seed skipped', e.message);
    }
  }
})();

function authUser(req) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || req.cookies?.pitlane_token || null;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions_auth s JOIN users u ON u.id = s.user_id WHERE s.token = ?`
    )
    .get(token);
  return row || null;
}

function requireAuth(req, res, next) {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Нужен вход' });
  req.user = user;
  next();
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, city: u.city };
}

// ——— Auth (magic link, demo-friendly) ———
app.post('/api/auth/request', (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Укажите корректный email' });
  }
  const token = nanoid(32);
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO magic_tokens (token, email, expires_at) VALUES (?, ?, ?)`).run(
    token,
    email,
    expires
  );
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  // In MVP without SMTP we return the link so the UI can show it.
  const magicUrl = `${base.replace(/\/$/, '')}/auth/verify?token=${token}`;
  res.json({
    ok: true,
    message: 'Ссылка для входа готова. В демо SMTP нет — откройте её ниже.',
    magicUrl,
    demo: true,
  });
});

app.post('/api/auth/verify', (req, res) => {
  const token = String(req.body.token || req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Нет токена' });
  const row = db.prepare(`SELECT * FROM magic_tokens WHERE token = ?`).get(token);
  if (!row || row.used) return res.status(400).json({ error: 'Ссылка недействительна' });
  if (new Date(row.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Ссылка истекла' });
  }
  db.prepare(`UPDATE magic_tokens SET used = 1 WHERE token = ?`).run(token);
  let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(row.email);
  if (!user) {
    const id = nanoid(12);
    db.prepare(`INSERT INTO users (id, email, name) VALUES (?, ?, ?)`).run(
      id,
      row.email,
      row.email.split('@')[0]
    );
    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  }
  const sessionToken = nanoid(40);
  db.prepare(`INSERT INTO sessions_auth (token, user_id) VALUES (?, ?)`).run(sessionToken, user.id);
  res.cookie('pitlane_token', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 3600 * 1000,
  });
  res.json({ ok: true, token: sessionToken, user: publicUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/me', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80);
  const city = String(req.body.city || '').trim().slice(0, 80);
  db.prepare(`UPDATE users SET name = ?, city = ? WHERE id = ?`).run(name || null, city || null, req.user.id);
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer || req.cookies?.pitlane_token;
  if (token) db.prepare(`DELETE FROM sessions_auth WHERE token = ?`).run(token);
  res.clearCookie('pitlane_token');
  res.json({ ok: true });
});

// ——— Tracks ———
app.get('/api/tracks', (_req, res) => {
  res.json({ tracks: db.prepare(`SELECT * FROM tracks ORDER BY name`).all() });
});

// ——— Cars / Garage ———
app.get('/api/cars', requireAuth, (req, res) => {
  const cars = db.prepare(`SELECT * FROM cars WHERE user_id = ? ORDER BY created_at DESC`).all(req.user.id);
  res.json({ cars });
});

app.post('/api/cars', requireAuth, (req, res) => {
  const { make, model, year, engine, drivetrain, power_hp, photo_url } = req.body || {};
  if (!make || !model) return res.status(400).json({ error: 'Марка и модель обязательны' });
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO cars (id, user_id, make, model, year, engine, drivetrain, power_hp, photo_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.user.id,
    String(make).trim(),
    String(model).trim(),
    year ? parseInt(year, 10) : null,
    engine ? String(engine).trim() : null,
    drivetrain ? String(drivetrain).trim() : null,
    power_hp ? parseInt(power_hp, 10) : null,
    photo_url || null
  );
  const car = db.prepare(`SELECT * FROM cars WHERE id = ?`).get(id);
  res.json({ car });
});

app.patch('/api/cars/:id', requireAuth, (req, res) => {
  const car = db.prepare(`SELECT * FROM cars WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
  if (!car) return res.status(404).json({ error: 'Машина не найдена' });
  const fields = ['make', 'model', 'year', 'engine', 'drivetrain', 'power_hp', 'photo_url'];
  const updates = [];
  const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      vals.push(req.body[f] === '' ? null : req.body[f]);
    }
  }
  if (updates.length) {
    vals.push(car.id);
    db.prepare(`UPDATE cars SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  }
  res.json({ car: db.prepare(`SELECT * FROM cars WHERE id = ?`).get(car.id) });
});

app.delete('/api/cars/:id', requireAuth, (req, res) => {
  const r = db.prepare(`DELETE FROM cars WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Sessions ———
function sessionRow(id) {
  return db
    .prepare(
      `SELECT s.*, t.name AS track_name, t.city AS track_city,
              c.make, c.model, c.year AS car_year, c.drivetrain, c.power_hp,
              u.name AS user_name, u.city AS user_city
       FROM sessions s
       JOIN tracks t ON t.id = s.track_id
       JOIN cars c ON c.id = s.car_id
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(id);
}

function lapsFor(sessionId) {
  return db
    .prepare(`SELECT * FROM laps WHERE session_id = ? ORDER BY lap_number`)
    .all(sessionId);
}

function saveLaps(sessionId, laps) {
  db.prepare(`DELETE FROM laps WHERE session_id = ?`).run(sessionId);
  const ins = db.prepare(
    `INSERT INTO laps (id, session_id, lap_number, time_ms, sector1_ms, sector2_ms, sector3_ms, is_best, valid)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  );
  let bestIdx = -1;
  let bestTime = Infinity;
  laps.forEach((l, i) => {
    if (l.valid !== 0 && l.time_ms < bestTime) {
      bestTime = l.time_ms;
      bestIdx = i;
    }
  });
  laps.forEach((l, i) => {
    const id = nanoid(12);
    ins.run(
      id,
      sessionId,
      l.lap_number || i + 1,
      l.time_ms,
      l.sector1_ms ?? null,
      l.sector2_ms ?? null,
      l.sector3_ms ?? null,
      l.valid === 0 ? 0 : 1
    );
    l._id = id;
    if (i === bestIdx) {
      db.prepare(`UPDATE laps SET is_best = 1 WHERE id = ?`).run(id);
    }
  });
}

app.get('/api/sessions', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, t.name AS track_name, c.make, c.model
       FROM sessions s
       JOIN tracks t ON t.id = s.track_id
       JOIN cars c ON c.id = s.car_id
       WHERE s.user_id = ?
       ORDER BY s.date DESC, s.created_at DESC`
    )
    .all(req.user.id);
  res.json({ sessions: rows });
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.car_id || !b.track_id || !b.date) {
    return res.status(400).json({ error: 'Нужны car_id, track_id, date' });
  }
  const car = db.prepare(`SELECT * FROM cars WHERE id = ? AND user_id = ?`).get(b.car_id, req.user.id);
  if (!car) return res.status(400).json({ error: 'Машина не из вашего гаража' });
  const track = db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(b.track_id);
  if (!track) return res.status(400).json({ error: 'Трек не найден' });

  const id = nanoid(12);
  db.prepare(
    `INSERT INTO sessions (
      id, user_id, car_id, track_id, date, weather, temp_c, tire,
      pressure_fl, pressure_fr, pressure_rl, pressure_rr, note, visibility, scored
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.user.id,
    b.car_id,
    b.track_id,
    b.date,
    b.weather || null,
    b.temp_c != null ? Number(b.temp_c) : null,
    b.tire || null,
    b.pressure_fl != null ? Number(b.pressure_fl) : null,
    b.pressure_fr != null ? Number(b.pressure_fr) : null,
    b.pressure_rl != null ? Number(b.pressure_rl) : null,
    b.pressure_rr != null ? Number(b.pressure_rr) : null,
    b.note || null,
    b.visibility === 'crew' || b.visibility === 'public' ? b.visibility : 'private',
    b.scored ? 1 : 0
  );

  if (Array.isArray(b.laps) && b.laps.length) {
    saveLaps(id, b.laps);
  }

  const session = sessionRow(id);
  const laps = lapsFor(id);
  res.json({ session, analysis: analyzeSession(laps) });
});

// ——— Comparable sessions for duel picker ———
app.get('/api/sessions/comparable', requireAuth, (req, res) => {
  const own = db
    .prepare(
      `SELECT s.id, s.date, s.tire, s.track_id, t.name AS track_name, c.make, c.model, u.name AS user_name, 'own' AS source
       FROM sessions s
       JOIN tracks t ON t.id = s.track_id
       JOIN cars c ON c.id = s.car_id
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ?`
    )
    .all(req.user.id);
  const scored = db
    .prepare(
      `SELECT s.id, s.date, s.tire, s.track_id, t.name AS track_name, c.make, c.model, u.name AS user_name, 'scored' AS source
       FROM sessions s
       JOIN tracks t ON t.id = s.track_id
       JOIN cars c ON c.id = s.car_id
       JOIN users u ON u.id = s.user_id
       WHERE s.scored = 1 AND s.user_id != ?`
    )
    .all(req.user.id);
  const shared = db
    .prepare(
      `SELECT DISTINCT s.id, s.date, s.tire, s.track_id, t.name AS track_name, c.make, c.model, u.name AS user_name, 'crew' AS source
       FROM crew_shared_sessions css
       JOIN crew_members cm ON cm.crew_id = css.crew_id AND cm.user_id = ?
       JOIN sessions s ON s.id = css.session_id
       JOIN tracks t ON t.id = s.track_id
       JOIN cars c ON c.id = s.car_id
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id != ?`
    )
    .all(req.user.id, req.user.id);
  const map = new Map();
  for (const row of [...own, ...shared, ...scored]) map.set(row.id, row);
  res.json({ sessions: [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1)) });
});


app.get('/api/sessions/:id', requireAuth, (req, res) => {
  const session = sessionRow(req.params.id);
  if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
  const canSee =
    session.user_id === req.user.id ||
    session.visibility === 'public' ||
    (session.visibility === 'crew' &&
      db
        .prepare(
          `SELECT 1 FROM crew_shared_sessions css
           JOIN crew_members cm ON cm.crew_id = css.crew_id
           WHERE css.session_id = ? AND cm.user_id = ?`
        )
        .get(session.id, req.user.id));
  // also allow if both in same crew and shared
  const shared =
    session.user_id === req.user.id ||
    !!db
      .prepare(
        `SELECT 1 FROM crew_members a
         JOIN crew_members b ON a.crew_id = b.crew_id
         JOIN crew_shared_sessions css ON css.crew_id = a.crew_id AND css.session_id = ?
         WHERE a.user_id = ? AND b.user_id = ?`
      )
      .get(session.id, session.user_id, req.user.id);

  if (!canSee && !shared && session.user_id !== req.user.id) {
    // scored public tops still readable via top endpoint; direct private blocked
    if (!(session.scored && session.visibility !== 'private')) {
      return res.status(403).json({ error: 'Сессия закрыта' });
    }
  }
  const laps = lapsFor(session.id);
  res.json({ session, analysis: analyzeSession(laps) });
});

app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Не найдено' });
  const allowed = [
    'weather',
    'temp_c',
    'tire',
    'pressure_fl',
    'pressure_fr',
    'pressure_rl',
    'pressure_rr',
    'note',
    'visibility',
    'scored',
    'date',
  ];
  const updates = [];
  const vals = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      let v = req.body[f];
      if (f === 'scored') v = v ? 1 : 0;
      if (f === 'visibility' && !['private', 'crew', 'public'].includes(v)) v = 'private';
      vals.push(v);
    }
  }
  if (updates.length) {
    vals.push(session.id);
    db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  }
  if (Array.isArray(req.body.laps)) saveLaps(session.id, req.body.laps);
  const laps = lapsFor(session.id);
  res.json({ session: sessionRow(session.id), analysis: analyzeSession(laps) });
});

app.post('/api/sessions/:id/upload', requireAuth, upload.single('file'), (req, res) => {
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Не найдено' });
  if (!req.file) return res.status(400).json({ error: 'Нет файла' });

  const name = (req.file.originalname || '').toLowerCase();
  const text = req.file.buffer.toString('utf8');
  let result;
  if (name.endsWith('.csv') || text.includes('time') || text.includes('время')) {
    if (name.endsWith('.gpx') || text.includes('<gpx') || text.includes('<GPX')) {
      result = parseGpx(text);
    } else {
      result = parseCsv(text);
    }
  } else {
    result = parseGpx(text);
  }

  if (!result.ok) {
    return res.status(400).json({
      error: result.error,
      pointCount: result.pointCount,
      hint: 'Можно добавить круг вручную на этой же странице.',
    });
  }

  saveLaps(session.id, result.laps);
  db.prepare(`UPDATE sessions SET source_file = ? WHERE id = ?`).run(
    req.file.originalname || 'upload',
    session.id
  );
  const laps = lapsFor(session.id);
  res.json({
    ok: true,
    pointCount: result.pointCount,
    lapCount: result.laps.length,
    session: sessionRow(session.id),
    analysis: analyzeSession(laps),
  });
});

app.post('/api/sessions/:id/manual-lap', requireAuth, (req, res) => {
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Не найдено' });

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

  const time_ms = parseTimeInput(req.body.time);
  if (!time_ms || time_ms < 5000) return res.status(400).json({ error: 'Укажите время круга, напр. 1:48.320' });

  const existing = lapsFor(session.id);
  const lap = {
    lap_number: existing.length + 1,
    time_ms,
    sector1_ms: parseTimeInput(req.body.sector1),
    sector2_ms: parseTimeInput(req.body.sector2),
    sector3_ms: parseTimeInput(req.body.sector3),
    valid: 1,
  };
  saveLaps(session.id, [...existing.map((l) => ({ ...l })), lap]);
  const laps = lapsFor(session.id);
  res.json({ session: sessionRow(session.id), analysis: analyzeSession(laps) });
});

// ——— Parse preview without saving ———
app.post('/api/parse', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Нет файла' });
  const name = (req.file.originalname || '').toLowerCase();
  const text = req.file.buffer.toString('utf8');
  const result =
    name.endsWith('.csv') && !text.includes('<gpx') ? parseCsv(text) : parseGpx(text);
  res.json(result);
});

// ——— Home demo example ———
app.get('/api/demo/example', (_req, res) => {
  const demo = db
    .prepare(
      `SELECT s.id FROM sessions s WHERE s.note LIKE '%DEMO%' ORDER BY s.created_at LIMIT 1`
    )
    .get();
  if (!demo) return res.json({ example: null });
  const session = sessionRow(demo.id);
  const laps = lapsFor(demo.id);
  res.json({ example: { session, analysis: analyzeSession(laps) } });
});

// ——— Crew ———
app.get('/api/crews', requireAuth, (req, res) => {
  const crews = db
    .prepare(
      `SELECT c.* FROM crews c
       JOIN crew_members m ON m.crew_id = c.id
       WHERE m.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(req.user.id);
  res.json({ crews });
});

app.post('/api/crews', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim() || 'Экипаж';
  const id = nanoid(10);
  const invite_code = nanoid(8);
  db.prepare(`INSERT INTO crews (id, name, owner_id, invite_code) VALUES (?, ?, ?, ?)`).run(
    id,
    name,
    req.user.id,
    invite_code
  );
  db.prepare(`INSERT INTO crew_members (crew_id, user_id) VALUES (?, ?)`).run(id, req.user.id);
  res.json({ crew: db.prepare(`SELECT * FROM crews WHERE id = ?`).get(id) });
});

app.get('/api/crews/:id', requireAuth, (req, res) => {
  const member = db
    .prepare(`SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Вы не в этом экипаже' });
  const crew = db.prepare(`SELECT * FROM crews WHERE id = ?`).get(req.params.id);
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.city, u.email FROM crew_members m JOIN users u ON u.id = m.user_id WHERE m.crew_id = ?`
    )
    .all(crew.id);
  const sessions = db
    .prepare(
      `SELECT s.*, t.name AS track_name, c.make, c.model, u.name AS user_name
       FROM crew_shared_sessions css
       JOIN sessions s ON s.id = css.session_id
       JOIN tracks t ON t.id = s.track_id
       JOIN cars c ON c.id = s.car_id
       JOIN users u ON u.id = s.user_id
       WHERE css.crew_id = ?
       ORDER BY s.date DESC`
    )
    .all(crew.id);
  const cars = db
    .prepare(
      `SELECT DISTINCT c.*, u.name AS owner_name FROM cars c
       JOIN crew_members m ON m.user_id = c.user_id
       JOIN users u ON u.id = c.user_id
       WHERE m.crew_id = ?`
    )
    .all(crew.id);
  res.json({ crew, members, sessions, cars });
});

app.post('/api/crews/join', requireAuth, (req, res) => {
  const code = String(req.body.code || req.body.invite_code || '').trim();
  const crew = db.prepare(`SELECT * FROM crews WHERE invite_code = ?`).get(code);
  if (!crew) return res.status(404).json({ error: 'Инвайт не найден' });
  db.prepare(`INSERT OR IGNORE INTO crew_members (crew_id, user_id) VALUES (?, ?)`).run(
    crew.id,
    req.user.id
  );
  res.json({ crew });
});

app.post('/api/crews/:id/share-session', requireAuth, (req, res) => {
  const member = db
    .prepare(`SELECT 1 FROM crew_members WHERE crew_id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: 'Не в экипаже' });
  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`)
    .get(req.body.session_id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Сессия не найдена' });
  db.prepare(`INSERT OR IGNORE INTO crew_shared_sessions (crew_id, session_id) VALUES (?, ?)`).run(
    req.params.id,
    session.id
  );
  if (session.visibility === 'private') {
    db.prepare(`UPDATE sessions SET visibility = 'crew' WHERE id = ?`).run(session.id);
  }
  res.json({ ok: true });
});


// ——— Duel ———
app.post('/api/duel', requireAuth, (req, res) => {
  const { session_a, session_b } = req.body || {};
  const a = sessionRow(session_a);
  const b = sessionRow(session_b);
  if (!a || !b) return res.status(404).json({ error: 'Сессия не найдена' });
  if (a.track_id !== b.track_id) {
    return res.status(400).json({ error: 'Дуэль только на одном треке' });
  }
  // access check simplified: owner or scored/shared
  for (const s of [a, b]) {
    if (s.user_id === req.user.id) continue;
    const ok =
      s.scored ||
      s.visibility !== 'private' ||
      db
        .prepare(
          `SELECT 1 FROM crew_shared_sessions css
           JOIN crew_members cm ON cm.crew_id = css.crew_id
           WHERE css.session_id = ? AND cm.user_id = ?`
        )
        .get(s.id, req.user.id);
    if (!ok) return res.status(403).json({ error: 'Нет доступа к одной из сессий' });
  }
  const cmp = duelCompare(lapsFor(a.id), lapsFor(b.id));
  res.json({
    track: { id: a.track_id, name: a.track_name },
    session_a: a,
    session_b: b,
    ...cmp,
  });
});

// ——— Track top (model + tire filter required) ———
app.get('/api/tops', (req, res) => {
  const track_id = req.query.track_id;
  const model = String(req.query.model || '').trim();
  const tire = String(req.query.tire || '').trim();
  if (!track_id || !model || !tire) {
    return res.status(400).json({
      error: 'Топ только с фильтром: track_id + model + tire',
      required: ['track_id', 'model', 'tire'],
    });
  }
  const rows = db
    .prepare(
      `SELECT s.id AS session_id, s.date, s.tire, s.temp_c, s.weather,
              c.make, c.model, c.year, c.power_hp, c.drivetrain,
              u.name AS user_name, u.city AS user_city,
              l.time_ms, l.lap_number,
              t.name AS track_name
       FROM sessions s
       JOIN cars c ON c.id = s.car_id
       JOIN users u ON u.id = s.user_id
       JOIN tracks t ON t.id = s.track_id
       JOIN laps l ON l.session_id = s.id AND l.is_best = 1
       WHERE s.track_id = ?
         AND s.scored = 1
         AND lower(c.model) = lower(?)
         AND lower(s.tire) = lower(?)
       ORDER BY l.time_ms ASC
       LIMIT 50`
    )
    .all(track_id, model, tire);

  res.json({
    filter: { track_id, model, tire },
    entries: rows.map((r, i) => ({
      rank: i + 1,
      ...r,
      time_label: formatMs(r.time_ms),
      caption: `${r.make} ${r.model}${r.year ? ' ' + r.year : ''} · ${r.tire}`,
    })),
  });
});

// static client in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`PITLANE API http://127.0.0.1:${PORT}`);
});
