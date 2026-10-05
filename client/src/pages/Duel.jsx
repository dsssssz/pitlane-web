import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, deltaClass } from '../lib/api'

export default function Duel({ user }) {
  const [sessions, setSessions] = useState([])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  if (!user) return <Navigate to="/auth" replace />

  useEffect(() => {
    api('/sessions/comparable').then((d) => setSessions(d.sessions)).catch((e) => setErr(e.message))
  }, [])

  async function run(e) {
    e.preventDefault()
    setErr('')
    setResult(null)
    try {
      const d = await api('/duel', { method: 'POST', body: { session_a: a, session_b: b } })
      setResult(d)
    } catch (ex) {
      setErr(ex.message)
    }
  }

  return (
    <div>
      <h1 style={{ fontWeight: 600 }}>Дуэль</h1>
      <p className="muted">Две сессии одного трека. Два столбца. Время — главное.</p>

      <form className="panel" onSubmit={run} style={{ marginTop: '1.25rem' }}>
        <div className="duel-grid">
          <div className="field">
            <label>Сессия A</label>
            <select required value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">—</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.track_name} · {s.user_name} · {s.make} {s.model} · {s.date}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Сессия B</label>
            <select required value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">—</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.track_name} · {s.user_name} · {s.make} {s.model} · {s.date}</option>
              ))}
            </select>
          </div>
        </div>
        {err && <p className="err">{err}</p>}
        <button type="submit">Сравнить</button>
      </form>

      {result && (
        <>
          <div className="section-title">{result.track.name}</div>
          <div className="vs">VS</div>
          <div className="duel-grid">
            <div className="panel">
              <div className="muted small">
                {result.session_a.user_name} · {result.session_a.make} {result.session_a.model}
              </div>
              <div className="time-xl">{result.a.best?.time_label || '—'}</div>
              <div className={deltaClass(result.winner === 'a' ? -1 : result.winner === 'b' ? 1 : 0)}>
                {result.winner === 'a' ? 'быстрее' : result.winner === 'tie' ? 'равны' : result.delta_label}
              </div>
              <p className="coach small">{result.a.coach}</p>
              <Link to={`/session/${result.session_a.id}`} className="small">Разбор A →</Link>
            </div>
            <div className="panel">
              <div className="muted small">
                {result.session_b.user_name} · {result.session_b.make} {result.session_b.model}
              </div>
              <div className="time-xl">{result.b.best?.time_label || '—'}</div>
              <div className={deltaClass(result.winner === 'b' ? -1 : result.winner === 'a' ? 1 : 0)}>
                {result.winner === 'b' ? 'быстрее' : result.winner === 'tie' ? 'равны' : (
                  result.delta_ms != null ? (result.delta_ms > 0 ? `−${result.delta_label.replace('+','')}` : result.delta_label.replace('−','+')) : '—'
                )}
              </div>
              <p className="coach small">{result.b.coach}</p>
              <Link to={`/session/${result.session_b.id}`} className="small">Разбор B →</Link>
            </div>
          </div>
          {result.delta_ms != null && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              Разница лучших: <span className={deltaClass(result.delta_ms)}>{result.delta_label}</span>
              {' '}(A минус B; минус = A быстрее)
            </p>
          )}
        </>
      )}
    </div>
  )
}
