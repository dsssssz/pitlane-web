function formatMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(Math.round(ms));
  const m = Math.floor(abs / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const frac = abs % 1000;
  if (m > 0) return `${sign}${m}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}`;
  return `${sign}${s}.${String(frac).padStart(3, '0')}`;
}

function formatDelta(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '';
  const abs = Math.abs(Math.round(ms));
  const s = Math.floor(abs / 1000);
  const frac = abs % 1000;
  return `${sign}${s}.${String(frac).padStart(3, '0')}`;
}

/** Coach copy — only from measured deltas, no invented physics. */
function coachText(laps, best) {
  if (!laps.length) {
    return 'Кругов нет. Загрузите GPX/CSV или введите время вручную.';
  }
  const lines = [];
  const valid = laps.filter((l) => l.valid !== 0);
  if (!best) {
    return 'Не удалось выбрать лучший круг.';
  }

  const bestLap = valid.find((l) => l.id === best.id) || best;
  lines.push(`Лучший круг: ${formatMs(bestLap.time_ms)} (круг ${bestLap.lap_number}).`);

  if (valid.length >= 2) {
    const times = valid.map((l) => l.time_ms);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const variance =
      times.reduce((a, t) => a + (t - mean) ** 2, 0) / times.length;
    const std = Math.sqrt(variance);
    if (std < 500) {
      lines.push(`Стабильность высокая: разброс около ${formatMs(Math.round(std))} между кругами.`);
    } else if (std < 1500) {
      lines.push(`Разброс кругов около ${formatMs(Math.round(std))} — есть запас стабильности.`);
    } else {
      lines.push(`Круги гуляют на ~${formatMs(Math.round(std))}. Сверьте лучший с соседними — где теряется время.`);
    }
  }

  // sector vs best
  const withSectors = valid.filter(
    (l) => l.sector1_ms != null && l.sector2_ms != null && l.sector3_ms != null
  );
  if (withSectors.length && bestLap.sector1_ms != null) {
    const last = withSectors[withSectors.length - 1];
    if (last.id !== bestLap.id) {
      const d1 = last.sector1_ms - bestLap.sector1_ms;
      const d2 = last.sector2_ms - bestLap.sector2_ms;
      const d3 = last.sector3_ms - bestLap.sector3_ms;
      const sectors = [
        { n: 1, d: d1 },
        { n: 2, d: d2 },
        { n: 3, d: d3 },
      ];
      const worst = sectors.reduce((a, b) => (b.d > a.d ? b : a));
      const bestS = sectors.reduce((a, b) => (b.d < a.d ? b : a));
      if (worst.d > 200) {
        lines.push(
          `На последнем круге сектор ${worst.n} медленнее лучшего на ${formatDelta(worst.d)} — смотрите линию и торможение именно там.`
        );
      }
      if (bestS.d < -100) {
        lines.push(
          `Сектор ${bestS.n} на последнем круге быстрее лучшего на ${formatDelta(Math.abs(bestS.d))} — это опорная зона.`
        );
      }
    } else if (valid.length >= 2) {
      lines.push('Лучший круг — последний. Зафиксируйте, что отличалось в подготовке и линии.');
    }
  }

  const slower = valid.filter((l) => l.time_ms - bestLap.time_ms > 1000);
  if (slower.length >= 2) {
    lines.push(
      `${slower.length} круг(ов) медленнее лучшего больше чем на 1 с — сравните их сектора с лучшим, не весь круг сразу.`
    );
  }

  if (lines.length === 1) {
    lines.push('Дельта к себе на экране. Когда будет второй круг — сравните сектора.');
  }

  return lines.join(' ');
}

function analyzeSession(laps) {
  const valid = laps.filter((l) => l.valid !== 0);
  if (!valid.length) {
    return { best: null, deltas: [], coach: coachText([], null), laps: [] };
  }
  let best = valid[0];
  for (const l of valid) {
    if (l.time_ms < best.time_ms) best = l;
  }
  const annotated = laps.map((l) => {
    const delta = l.time_ms - best.time_ms;
    return {
      ...l,
      is_best: l.id === best.id || (l.lap_number === best.lap_number && l.time_ms === best.time_ms) ? 1 : 0,
      delta_ms: delta,
      delta_label: formatDelta(delta),
      time_label: formatMs(l.time_ms),
      sector1_label: formatMs(l.sector1_ms),
      sector2_label: formatMs(l.sector2_ms),
      sector3_label: formatMs(l.sector3_ms),
    };
  });
  return {
    best: {
      ...best,
      time_label: formatMs(best.time_ms),
      sector1_label: formatMs(best.sector1_ms),
      sector2_label: formatMs(best.sector2_ms),
      sector3_label: formatMs(best.sector3_ms),
    },
    laps: annotated,
    coach: coachText(annotated, best),
  };
}

function duelCompare(aLaps, bLaps) {
  const a = analyzeSession(aLaps);
  const b = analyzeSession(bLaps);
  if (!a.best || !b.best) {
    return { a, b, delta_ms: null, winner: null };
  }
  const delta_ms = a.best.time_ms - b.best.time_ms;
  let winner = 'tie';
  if (delta_ms < 0) winner = 'a';
  else if (delta_ms > 0) winner = 'b';
  return {
    a,
    b,
    delta_ms,
    delta_label: formatDelta(delta_ms),
    winner,
  };
}

module.exports = { formatMs, formatDelta, analyzeSession, duelCompare, coachText };
