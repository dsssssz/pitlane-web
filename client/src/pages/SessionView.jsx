import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, deltaClass, getToken } from '../lib/api'

export default function SessionView({ user }) {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [manual, setManual] = useState('1:48.000')
  const [upMsg, setUpMsg] = useState('')

  if (!user) return <Navigate to="/auth" replace />

  async function load() {
    const d = await api(`/sessions/${id}`)
    setData(d)
  }

  useEffect(() => {
    load().catch((e) => setErr(e.message))
  }, [id])

  async function onUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUpMsg('')
    setErr('')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(`/api/sessions/${id}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
        credentials: 'include',
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Ошибка загрузки')
      setData(d)
      setUpMsg(`Загружено кругов: ${d.lapCount}`)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      e.target.value = ''
    }
  }

  async function addManual(e) {
    e.preventDefault()
    setErr('')
    try {
      const d = await api(`/sessions/${id}/manual-lap`, { method: 'POST', body: { time: manual } })
      setData(d)
    } catch (ex) {
      setErr(ex.message)
    }
  }

  if (err && !data) return <p className="err">{err}</p>
  if (!data) return <p className="muted">Загрузка…</p>

  const { session: s, analysis: a } = data

  return (
    <div>
      <div className="muted small">
        <Link to="/garage">Гараж</Link> / сессия
      </div>
      <h1 style={{ fontWeight: 600, marginBottom: 4 }}>
        {s.track_name}
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {s.make} {s.model} · {s.tire || 'резина?'} · {s.date}
        {s.temp_c != null ? ` · ${s.temp_c}°C` : ''}
        {' · '}<span className="tag">{s.visibility}</span>
        {s.scored ? <> · <span className="tag">в зачёт</span></> : null}
      </p>

      <div className="section-title">Разбор</div>
      <div className="panel">
        <div className="muted small">Лучший круг</div>
        <div className="time-xl">{a.best?.time_label || '—'}</div>
        {a.best && (
          <div className="muted small">
            круг {a.best.lap_number}
            {a.best.sector1_ms != null && (
              <> · S {a.best.sector1_label} / {a.best.sector2_label} / {a.best.sector3_label}</>
            )}
          </div>
        )}
        <p className="coach">{a.coach}</p>
      </div>

      {(a.laps || []).length > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <table className="lap-table">
            <thead>
              <tr>
                <th>#</th><th>Время</th><th>Δ</th><th>S1</th><th>S2</th><th>S3</th>
              </tr>
            </thead>
            <tbody>
              {a.laps.map((l) => (
                <tr key={l.id} className={l.is_best ? 'best' : ''}>
                  <td className="label-cell">{l.lap_number}</td>
                  <td>{l.time_label}</td>
                  <td className={deltaClass(l.delta_ms)}>
                    {l.delta_ms === 0 ? 'лучш.' : l.delta_label}
                  </td>
                  <td>{l.sector1_label}</td>
                  <td>{l.sector2_label}</td>
                  <td>{l.sector3_label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title">Загрузка / ручной ввод</div>
      <div className="panel stack">
        <label className="file-btn">
          <button type="button" onClick={() => document.getElementById('gpx').click()}>
            Загрузить GPX / CSV
          </button>
          <input id="gpx" type="file" accept=".gpx,.csv,text/xml,text/csv" onChange={onUpload} />
        </label>
        {upMsg && <p className="ok">{upMsg}</p>}
        {err && <p className="err">{err}</p>}
        <form onSubmit={addManual} className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Круг вручную</label>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="1:48.320" />
          </div>
          <button type="submit" className="ghost">Добавить</button>
        </form>
        <p className="muted small">
          Парсер GPX ищет замыкание круга по старту. Если неуверен — введите время вручную.
        </p>
      </div>

      <div className="spacer" />
      <Link to="/duel"><button type="button" className="ghost">К дуэли</button></Link>
      {' '}
      <Link to="/crew"><button type="button" className="ghost">В экипаж</button></Link>
    </div>
  )
}
