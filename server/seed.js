/**
 * Seed demo users, cars, GPX-derived sessions for home example.
 * Run: npm run seed
 */
const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { parseGpx } = require('./gpx');

function wipeDemo() {
  db.exec(`
    DELETE FROM laps WHERE session_id IN (SELECT id FROM sessions WHERE note LIKE '%DEMO%');
    DELETE FROM crew_shared_sessions WHERE session_id IN (SELECT id FROM sessions WHERE note LIKE '%DEMO%');
    DELETE FROM sessions WHERE note LIKE '%DEMO%';
  `);
}

/** Synthetic closed-ish lap around a point (Moscow Raceway-ish coords). */
function synthGpx({ laps = 4, lapMs = 108320, noise = 400, startLat = 55.8825, startLon = 36.5415 }) {
  const points = [];
  const ptsPerLap = 120;
  let t0 = Date.parse('2026-06-14T10:00:00Z');
  for (let lap = 0; lap < laps; lap++) {
    const thisLapMs = lapMs + Math.round((Math.sin(lap * 1.7) * noise) / 2) + lap * 80;
    for (let i = 0; i < ptsPerLap; i++) {
      const frac = i / ptsPerLap;
      const ang = frac * Math.PI * 2;
      // elongated loop ~4km-ish in meters projection rough
      const lat = startLat + Math.sin(ang) * 0.012 + Math.sin(ang * 3) * 0.001;
      const lon = startLon + Math.cos(ang) * 0.018 + Math.cos(ang * 2) * 0.0015;
      const t = new Date(t0 + Math.round(frac * thisLapMs)).toISOString();
      points.push(
        `    <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><time>${t}</time></trkpt>`
      );
    }
    t0 += thisLapMs + 500; // tiny gap
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="pitlane-seed">
  <trk><name>Demo</name><trkseg>
${points.join('\n')}
  </trkseg></trk>
</gpx>`;
}

function ensureUser(email, name, city) {
  let u = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (!u) {
    const id = nanoid(12);
    db.prepare(`INSERT INTO users (id, email, name, city) VALUES (?, ?, ?, ?)`).run(
      id,
      email,
      name,
      city
    );
    u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  } else {
    db.prepare(`UPDATE users SET name = ?, city = ? WHERE id = ?`).run(name, city, u.id);
    u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(u.id);
  }
  return u;
}

function ensureCar(userId, data) {
  let car = db
    .prepare(`SELECT * FROM cars WHERE user_id = ? AND make = ? AND model = ?`)
    .get(userId, data.make, data.model);
  if (!car) {
    const id = nanoid(12);
    db.prepare(
      `INSERT INTO cars (id, user_id, make, model, year, engine, drivetrain, power_hp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, data.make, data.model, data.year, data.engine, data.drivetrain, data.power_hp);
    car = db.prepare(`SELECT * FROM cars WHERE id = ?`).get(id);
  }
  return car;
}

function saveLaps(sessionId, laps) {
  db.prepare(`DELETE FROM laps WHERE session_id = ?`).run(sessionId);
  const ins = db.prepare(
    `INSERT INTO laps (id, session_id, lap_number, time_ms, sector1_ms, sector2_ms, sector3_ms, is_best, valid)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`
  );
  let best = Infinity;
  let bestId = null;
  for (let i = 0; i < laps.length; i++) {
    const l = laps[i];
    const id = nanoid(12);
    ins.run(
      id,
      sessionId,
      l.lap_number || i + 1,
      l.time_ms,
      l.sector1_ms ?? null,
      l.sector2_ms ?? null,
      l.sector3_ms ?? null
    );
    if (l.time_ms < best) {
      best = l.time_ms;
      bestId = id;
    }
  }
  if (bestId) db.prepare(`UPDATE laps SET is_best = 1 WHERE id = ?`).run(bestId);
}

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

wipeDemo();
seedTracks();


const demoA = ensureUser('demo@pitlane.local', 'Алексей', 'Москва');
const demoB = ensureUser('demo2@pitlane.local', 'Марина', 'Москва');

const carA = ensureCar(demoA.id, {
  make: 'BMW',
  model: 'M2 Competition',
  year: 2020,
  engine: 'S55 3.0 twin-turbo',
  drivetrain: 'RWD',
  power_hp: 410,
});
const carB = ensureCar(demoB.id, {
  make: 'BMW',
  model: 'M2 Competition',
  year: 2019,
  engine: 'S55 3.0 twin-turbo',
  drivetrain: 'RWD',
  power_hp: 410,
});

const gpxDir = path.join(__dirname, '..', 'seeds');
fs.mkdirSync(gpxDir, { recursive: true });

const gpx1 = synthGpx({ laps: 5, lapMs: 107850, noise: 600 });
const gpx2 = synthGpx({ laps: 4, lapMs: 108900, noise: 500, startLat: 55.8828, startLon: 36.542 });
fs.writeFileSync(path.join(gpxDir, 'demo-mrw-a.gpx'), gpx1);
fs.writeFileSync(path.join(gpxDir, 'demo-mrw-b.gpx'), gpx2);

function createSession({ user, car, trackId, date, tire, note, gpx, scored, visibility, weather, temp_c }) {
  const parsed = parseGpx(gpx);
  if (!parsed.ok) {
    console.warn('GPX parse failed, using manual laps', parsed.error);
  }
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO sessions (
      id, user_id, car_id, track_id, date, weather, temp_c, tire,
      pressure_fl, pressure_fr, pressure_rl, pressure_rr, note, visibility, scored, source_file
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2.1, 2.1, 2.0, 2.0, ?, ?, ?, ?)`
  ).run(
    id,
    user.id,
    car.id,
    trackId,
    date,
    weather,
    temp_c,
    tire,
    note,
    visibility,
    scored ? 1 : 0,
    'demo.gpx'
  );
  const laps =
    parsed.ok && parsed.laps.length
      ? parsed.laps
      : [
          { lap_number: 1, time_ms: 109120, sector1_ms: 35200, sector2_ms: 37100, sector3_ms: 36820 },
          { lap_number: 2, time_ms: 107850, sector1_ms: 34850, sector2_ms: 36600, sector3_ms: 36400 },
          { lap_number: 3, time_ms: 108410, sector1_ms: 35100, sector2_ms: 36850, sector3_ms: 36460 },
          { lap_number: 4, time_ms: 108020, sector1_ms: 34920, sector2_ms: 36710, sector3_ms: 36390 },
        ];
  saveLaps(id, laps);
  return id;
}

const sidA = createSession({
  user: demoA,
  car: carA,
  trackId: 'moscow-raceway',
  date: '2026-06-14',
  tire: 'Cup 2',
  note: 'DEMO — утро, прогрев+серия',
  gpx: gpx1,
  scored: 1,
  visibility: 'public',
  weather: 'ясно',
  temp_c: 22,
});

const sidB = createSession({
  user: demoB,
  car: carB,
  trackId: 'moscow-raceway',
  date: '2026-06-14',
  tire: 'Cup 2',
  note: 'DEMO — вторая сессия дня',
  gpx: gpx2,
  scored: 1,
  visibility: 'public',
  weather: 'ясно',
  temp_c: 24,
});

// crew
let crew = db.prepare(`SELECT * FROM crews WHERE name = ?`).get('DEMO Экипаж MRW');
if (!crew) {
  const id = nanoid(10);
  const invite = 'DEMOCREW';
  db.prepare(`INSERT INTO crews (id, name, owner_id, invite_code) VALUES (?, ?, ?, ?)`).run(
    id,
    'DEMO Экипаж MRW',
    demoA.id,
    invite
  );
  crew = db.prepare(`SELECT * FROM crews WHERE id = ?`).get(id);
}
db.prepare(`INSERT OR IGNORE INTO crew_members (crew_id, user_id) VALUES (?, ?)`).run(crew.id, demoA.id);
db.prepare(`INSERT OR IGNORE INTO crew_members (crew_id, user_id) VALUES (?, ?)`).run(crew.id, demoB.id);
db.prepare(`INSERT OR IGNORE INTO crew_shared_sessions (crew_id, session_id) VALUES (?, ?)`).run(
  crew.id,
  sidA
);
db.prepare(`INSERT OR IGNORE INTO crew_shared_sessions (crew_id, session_id) VALUES (?, ?)`).run(
  crew.id,
  sidB
);

console.log('Seed OK');
console.log('  demo sessions:', sidA, sidB);
console.log('  crew invite:', crew.invite_code);
console.log('  login emails: demo@pitlane.local / demo2@pitlane.local (magic link)');
