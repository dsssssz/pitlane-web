/** KV JSON helpers + list indexes for pitlane-web */

export function id(n = 12) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => (b % 36).toString(36)).join('');
}

export async function getJSON(kv, key) {
  const v = await kv.get(key, 'json');
  return v;
}

export async function putJSON(kv, key, value, opts) {
  await kv.put(key, JSON.stringify(value), opts);
}

export async function del(kv, key) {
  await kv.delete(key);
}

async function listIds(kv, key) {
  return (await getJSON(kv, key)) || [];
}

async function addId(kv, key, itemId) {
  const arr = await listIds(kv, key);
  if (!arr.includes(itemId)) {
    arr.push(itemId);
    await putJSON(kv, key, arr);
  }
}

async function removeId(kv, key, itemId) {
  const arr = (await listIds(kv, key)).filter((x) => x !== itemId);
  await putJSON(kv, key, arr);
}

export const Store = {
  async ensureSeed(kv) {
    const flag = await kv.get('meta:seeded');
    if (flag) return;
    const tracks = [
      { id: 'moscow-raceway', name: 'Moscow Raceway', city: 'Волоколамск', length_m: 4070 },
      { id: 'adm', name: 'ADM Raceway', city: 'Мячково', length_m: 3280 },
      { id: 'sochi', name: 'Sochi Autodrom', city: 'Сочи', length_m: 5848 },
      { id: 'igora', name: 'Igora Drive', city: 'Ленобласть', length_m: 4086 },
      { id: 'kazan', name: 'Kazan Ring', city: 'Казань', length_m: 3476 },
    ];
    await putJSON(kv, 'tracks:all', tracks);
    for (const t of tracks) await putJSON(kv, `track:${t.id}`, t);

    async function makeUser(email, name, city) {
      const u = { id: id(), email, name, city, created_at: new Date().toISOString() };
      await putJSON(kv, `user:${u.id}`, u);
      await putJSON(kv, `user:email:${email}`, u.id);
      await addId(kv, 'users:all', u.id);
      return u;
    }
    async function makeCar(userId, data) {
      const c = { id: id(), user_id: userId, ...data, created_at: new Date().toISOString() };
      await putJSON(kv, `car:${c.id}`, c);
      await addId(kv, `cars:user:${userId}`, c.id);
      return c;
    }
    function makeLaps(raw) {
      let best = Infinity;
      let bestIdx = 0;
      const laps = raw.map((l, i) => {
        const row = { id: id(), ...l, is_best: 0, valid: 1 };
        if (l.time_ms < best) { best = l.time_ms; bestIdx = i; }
        return row;
      });
      if (laps[bestIdx]) laps[bestIdx].is_best = 1;
      return laps;
    }

    const demoA = await makeUser('demo@pitlane.local', 'Алексей', 'Москва');
    const demoB = await makeUser('demo2@pitlane.local', 'Марина', 'Москва');
    const carA = await makeCar(demoA.id, {
      make: 'BMW', model: 'M2 Competition', year: 2020,
      engine: 'S55 3.0 twin-turbo', drivetrain: 'RWD', power_hp: 410, photo_url: null,
    });
    const carB = await makeCar(demoB.id, {
      make: 'BMW', model: 'M2 Competition', year: 2019,
      engine: 'S55 3.0 twin-turbo', drivetrain: 'RWD', power_hp: 410, photo_url: null,
    });

    const lapsA = makeLaps([
      { lap_number: 1, time_ms: 108350, sector1_ms: 36010, sector2_ms: 36020, sector3_ms: 36320 },
      { lap_number: 2, time_ms: 108727, sector1_ms: 36150, sector2_ms: 36180, sector3_ms: 36397 },
      { lap_number: 3, time_ms: 108433, sector1_ms: 36080, sector2_ms: 36090, sector3_ms: 36263 },
      { lap_number: 4, time_ms: 108312, sector1_ms: 35960, sector2_ms: 35909, sector3_ms: 36443 },
    ]);
    const lapsB = makeLaps([
      { lap_number: 1, time_ms: 109400, sector1_ms: 36400, sector2_ms: 36500, sector3_ms: 36500 },
      { lap_number: 2, time_ms: 109520, sector1_ms: 36450, sector2_ms: 36550, sector3_ms: 36520 },
      { lap_number: 3, time_ms: 109610, sector1_ms: 36500, sector2_ms: 36580, sector3_ms: 36530 },
      { lap_number: 4, time_ms: 109480, sector1_ms: 36420, sector2_ms: 36520, sector3_ms: 36540 },
    ]);

    async function makeSession(user, car, laps, extra) {
      const s = {
        id: id(),
        user_id: user.id,
        car_id: car.id,
        track_id: 'moscow-raceway',
        date: '2026-06-14',
        weather: 'ясно',
        temp_c: extra.temp_c,
        tire: 'Cup 2',
        pressure_fl: 2.1, pressure_fr: 2.1, pressure_rl: 2.0, pressure_rr: 2.0,
        note: extra.note,
        visibility: 'public',
        scored: 1,
        source_file: 'demo.gpx',
        created_at: new Date().toISOString(),
        laps,
      };
      await putJSON(kv, `session:${s.id}`, s);
      await addId(kv, `sessions:user:${user.id}`, s.id);
      await addId(kv, 'sessions:scored', s.id);
      await addId(kv, 'sessions:demo', s.id);
      return s;
    }

    const sidA = await makeSession(demoA, carA, lapsA, { temp_c: 22, note: 'DEMO — утро, прогрев+серия' });
    const sidB = await makeSession(demoB, carB, lapsB, { temp_c: 24, note: 'DEMO — вторая сессия дня' });

    const crew = {
      id: id(10),
      name: 'DEMO Экипаж MRW',
      owner_id: demoA.id,
      invite_code: 'DEMOCREW',
      created_at: new Date().toISOString(),
      members: [demoA.id, demoB.id],
      shared_sessions: [sidA.id, sidB.id],
    };
    await putJSON(kv, `crew:${crew.id}`, crew);
    await putJSON(kv, `crew:invite:DEMOCREW`, crew.id);
    await addId(kv, `crews:user:${demoA.id}`, crew.id);
    await addId(kv, `crews:user:${demoB.id}`, crew.id);

    await kv.put('meta:seeded', '1');
  },

  tracks: (kv) => getJSON(kv, 'tracks:all').then((t) => t || []),
  track: (kv, tid) => getJSON(kv, `track:${tid}`),

  async userById(kv, uid) { return getJSON(kv, `user:${uid}`); },
  async userByEmail(kv, email) {
    const uid = await getJSON(kv, `user:email:${email}`);
    if (!uid) return null;
    return getJSON(kv, `user:${uid}`);
  },
  async saveUser(kv, user) {
    await putJSON(kv, `user:${user.id}`, user);
    await putJSON(kv, `user:email:${user.email}`, user.id);
    await addId(kv, 'users:all', user.id);
  },

  async putMagic(kv, token, email) {
    await putJSON(kv, `magic:${token}`, { email, expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), used: 0 }, { expirationTtl: 3600 });
  },
  async getMagic(kv, token) { return getJSON(kv, `magic:${token}`); },
  async useMagic(kv, token, row) {
    await putJSON(kv, `magic:${token}`, { ...row, used: 1 }, { expirationTtl: 60 });
  },
  async putAuth(kv, token, userId) {
    await putJSON(kv, `auth:${token}`, { user_id: userId, created_at: new Date().toISOString() }, { expirationTtl: 30 * 24 * 3600 });
  },
  async authUser(kv, token) {
    if (!token) return null;
    const s = await getJSON(kv, `auth:${token}`);
    if (!s) return null;
    return getJSON(kv, `user:${s.user_id}`);
  },
  async delAuth(kv, token) { await del(kv, `auth:${token}`); },

  async carsByUser(kv, userId) {
    const ids = await listIds(kv, `cars:user:${userId}`);
    const out = [];
    for (const cid of ids) {
      const c = await getJSON(kv, `car:${cid}`);
      if (c) out.push(c);
    }
    return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  },
  async car(kv, cid) { return getJSON(kv, `car:${cid}`); },
  async saveCar(kv, car) {
    await putJSON(kv, `car:${car.id}`, car);
    await addId(kv, `cars:user:${car.user_id}`, car.id);
  },
  async deleteCar(kv, car) {
    await del(kv, `car:${car.id}`);
    await removeId(kv, `cars:user:${car.user_id}`, car.id);
  },

  async sessionsByUser(kv, userId) {
    const ids = await listIds(kv, `sessions:user:${userId}`);
    const out = [];
    for (const sid of ids) {
      const s = await getJSON(kv, `session:${sid}`);
      if (s) out.push(s);
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : -1));
  },
  async session(kv, sid) { return getJSON(kv, `session:${sid}`); },
  async saveSession(kv, session) {
    await putJSON(kv, `session:${session.id}`, session);
    await addId(kv, `sessions:user:${session.user_id}`, session.id);
    if (session.scored) await addId(kv, 'sessions:scored', session.id);
    else await removeId(kv, 'sessions:scored', session.id);
    if (String(session.note || '').includes('DEMO')) await addId(kv, 'sessions:demo', session.id);
  },
  async scoredSessions(kv) {
    const ids = await listIds(kv, 'sessions:scored');
    const out = [];
    for (const sid of ids) {
      const s = await getJSON(kv, `session:${sid}`);
      if (s && s.scored) out.push(s);
    }
    return out;
  },
  async demoSession(kv) {
    const ids = await listIds(kv, 'sessions:demo');
    if (!ids.length) return null;
    return getJSON(kv, `session:${ids[0]}`);
  },

  async crewsByUser(kv, userId) {
    const ids = await listIds(kv, `crews:user:${userId}`);
    const out = [];
    for (const cid of ids) {
      const c = await getJSON(kv, `crew:${cid}`);
      if (c) out.push(c);
    }
    return out;
  },
  async crew(kv, cid) { return getJSON(kv, `crew:${cid}`); },
  async crewByInvite(kv, code) {
    const cid = await getJSON(kv, `crew:invite:${code}`);
    if (!cid) return null;
    return getJSON(kv, `crew:${cid}`);
  },
  async saveCrew(kv, crew) {
    await putJSON(kv, `crew:${crew.id}`, crew);
    await putJSON(kv, `crew:invite:${crew.invite_code}`, crew.id);
    for (const m of crew.members || []) await addId(kv, `crews:user:${m}`, crew.id);
  },
};

export async function enrichSession(kv, s) {
  if (!s) return null;
  const track = await Store.track(kv, s.track_id);
  const car = await Store.car(kv, s.car_id);
  const user = await Store.userById(kv, s.user_id);
  return {
    ...s,
    track_name: track?.name,
    track_city: track?.city,
    make: car?.make,
    model: car?.model,
    car_year: car?.year,
    drivetrain: car?.drivetrain,
    power_hp: car?.power_hp,
    user_name: user?.name,
    user_city: user?.city,
  };
}
