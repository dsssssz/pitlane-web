import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export default function Tops() {
  const [tracks, setTracks] = useState([])
  const [trackId, setTrackId] = useState('moscow-raceway')
  const [model, setModel] = useState('M2 Competition')
  const [tire, setTire] = useState('Cup 2')
  const [entries, setEntries] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api('/tracks').then((d) => setTracks(d.tracks)).catch((e) => setErr(e.message))
  }, [])

  async function load(e) {
    e?.preventDefault()
    setErr('')
    setEntries(null)
    try {
      const q = new URLSearchParams({ track_id: trackId, model, tire })
      const d = await api(`/tops?${q}`)
      setEntries(d.entries)
    } catch (ex) {
      setErr(ex.message)
    }
  }

  useEffect(() => { load().catch(() => {}) }, [])

  return (
    <div>
      <h1 style={{ fontWeight: 600 }}>Топ трека</h1>
      <p className="muted">
        Только с фильтром модель + резина. В топ попадают сессии «в зачёт». Подпись — на чём круг.
      </p>

      <form className="panel" onSubmit={load} style={{ marginTop: '1.25rem' }}>
        <div className="row">
          <div className="field">
            <label>Трек</label>
            <select value={trackId} onChange={(e) => setTrackId(e.target.value)}>
              {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Модель</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} required />
          </div>
          <div className="field">
            <label>Резина</label>
            <input value={tire} onChange={(e) => setTire(e.target.value)} required />
          </div>
        </div>
        <button type="submit">Показать</button>
      </form>

      {err && <p className="err">{err}</p>}

      {entries && (
        <ul className="list-clean" style={{ marginTop: '1.5rem' }}>
          {entries.map((e) => (
            <li key={e.session_id + '-' + e.rank}>
              <div>
                <span className="muted" style={{ marginRight: 12 }}>#{e.rank}</span>
                <span className="time-md">{e.time_label}</span>
                <div className="muted small">{e.caption} · {e.user_name} · {e.date}</div>
              </div>
            </li>
          ))}
          {!entries.length && <li className="muted">Пусто для этой связки. Нужны сессии «в зачёт».</li>}
        </ul>
      )}
    </div>
  )
}
