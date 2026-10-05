import { XMLParser } from 'fast-xml-parser';

const R = 6371000;
function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function asArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function parseTime(t) {
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

function extractPoints(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['trk', 'trkseg', 'trkpt', 'rte', 'rtept'].includes(name),
  });
  const doc = parser.parse(xml);
  const gpx = doc.gpx || doc.GPX;
  if (!gpx) throw new Error('Не GPX: нет корневого элемента gpx');
  const points = [];
  for (const trk of asArray(gpx.trk)) {
    for (const seg of asArray(trk.trkseg)) {
      for (const pt of asArray(seg.trkpt)) {
        const lat = parseFloat(pt['@_lat']);
        const lon = parseFloat(pt['@_lon']);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        points.push({ lat, lon, t: parseTime(pt.time), ele: pt.ele != null ? parseFloat(pt.ele) : null });
      }
    }
  }
  if (!points.length) {
    for (const rte of asArray(gpx.rte)) {
      for (const pt of asArray(rte.rtept)) {
        const lat = parseFloat(pt['@_lat']);
        const lon = parseFloat(pt['@_lon']);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        points.push({ lat, lon, t: parseTime(pt.time), ele: null });
      }
    }
  }
  return points;
}

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}

function timeAtDistance(pts, targetDist) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = haversine(pts[i - 1], pts[i]);
    if (d + seg >= targetDist) {
      const ratio = seg > 0 ? (targetDist - d) / seg : 0;
      const t0 = pts[i - 1].t;
      const t1 = pts[i].t;
      if (t0 != null && t1 != null) return Math.round(t0 + (t1 - t0) * ratio);
      return null;
    }
    d += seg;
  }
  return pts[pts.length - 1]?.t ?? null;
}

function measureLap(pts, lapNumber) {
  if (pts.length < 5) return null;
  if (pts[0].t == null || pts[pts.length - 1].t == null) return null;
  const time_ms = pts[pts.length - 1].t - pts[0].t;
  const len = pathLength(pts);
  const s1 = timeAtDistance(pts, len / 3);
  const s2 = timeAtDistance(pts, (2 * len) / 3);
  const t0 = pts[0].t;
  const tEnd = pts[pts.length - 1].t;
  let sector1_ms = null, sector2_ms = null, sector3_ms = null;
  if (s1 != null && s2 != null && t0 != null) {
    sector1_ms = s1 - t0;
    sector2_ms = s2 - s1;
    sector3_ms = tEnd - s2;
  }
  return { lap_number: lapNumber, time_ms, sector1_ms, sector2_ms, sector3_ms, distance_m: Math.round(len), valid: 1 };
}

function detectLaps(points, opts = {}) {
  const minLapDist = opts.minLapDistM ?? 800;
  const closeM = opts.closeM ?? 25;
  if (points.length < 20) return { laps: [] };
  const start = points[0];
  let distFromLapStart = 0;
  const boundaries = [0];
  for (let i = 1; i < points.length; i++) {
    distFromLapStart += haversine(points[i - 1], points[i]);
    const dStart = haversine(points[i], start);
    if (distFromLapStart >= minLapDist && dStart <= closeM) {
      boundaries.push(i);
      distFromLapStart = 0;
      i += 5;
    }
  }
  const laps = [];
  for (let b = 0; b < boundaries.length - 1; b++) {
    const slice = points.slice(boundaries[b], boundaries[b + 1] + 1);
    const lap = measureLap(slice, b + 1);
    if (lap && lap.time_ms > 20000 && lap.time_ms < 600000) laps.push(lap);
  }
  return { laps };
}

export function parseGpx(xml, opts) {
  const points = extractPoints(xml);
  if (points.length < 10) return { ok: false, error: 'Слишком мало точек в GPX', points: [] };
  const timed = points.filter((p) => p.t != null).length;
  if (timed < points.length * 0.5) {
    return { ok: false, error: 'В GPX мало временных меток — загрузите файл с time или введите круг вручную', pointCount: points.length };
  }
  const { laps } = detectLaps(points, opts);
  if (!laps.length) {
    const len = pathLength(points);
    if (len >= 800 && points[0].t != null && points[points.length - 1].t != null) {
      const one = measureLap(points, 1);
      if (one) return { ok: true, laps: [one], pointCount: points.length, distance_m: Math.round(len) };
    }
    return { ok: false, error: 'Не удалось выделить круги. Проверьте, что трек замкнут, или введите время вручную.', pointCount: points.length, distance_m: Math.round(len) };
  }
  return { ok: true, laps, pointCount: points.length, distance_m: Math.round(pathLength(points)) };
}

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, error: 'CSV пустой' };
  const header = lines[0].toLowerCase().split(/[,;\t]/).map((h) => h.trim());
  function parseTimeCell(v) {
    v = String(v).trim();
    if (/^\d+$/.test(v)) return parseInt(v, 10);
    const m = v.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
    if (m) {
      const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      return parseInt(m[1], 10) * 60000 + parseInt(m[2], 10) * 1000 + ms;
    }
    const f = parseFloat(v.replace(',', '.'));
    if (Number.isFinite(f) && f < 1000) return Math.round(f * 1000);
    if (Number.isFinite(f)) return Math.round(f);
    return null;
  }
  const idxLap = header.findIndex((h) => /lap|круг|num/i.test(h));
  const idxTime = header.findIndex((h) => /time|время|lap_time/i.test(h));
  const idxS1 = header.findIndex((h) => /s1|sector1|сектор.?1/i.test(h));
  const idxS2 = header.findIndex((h) => /s2|sector2|сектор.?2/i.test(h));
  const idxS3 = header.findIndex((h) => /s3|sector3|сектор.?3/i.test(h));
  if (idxTime < 0) return { ok: false, error: 'В CSV нужна колонка time / время' };
  const laps = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/[,;\t]/);
    const time_ms = parseTimeCell(cols[idxTime]);
    if (time_ms == null || time_ms < 1000) continue;
    laps.push({
      lap_number: idxLap >= 0 ? parseInt(cols[idxLap], 10) || i : i,
      time_ms,
      sector1_ms: idxS1 >= 0 ? parseTimeCell(cols[idxS1]) : null,
      sector2_ms: idxS2 >= 0 ? parseTimeCell(cols[idxS2]) : null,
      sector3_ms: idxS3 >= 0 ? parseTimeCell(cols[idxS3]) : null,
      valid: 1,
    });
  }
  if (!laps.length) return { ok: false, error: 'Не удалось прочитать круги из CSV' };
  return { ok: true, laps, pointCount: 0 };
}
