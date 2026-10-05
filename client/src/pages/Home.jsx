import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, deltaClass } from '../lib/api'

export default function Home({ user }) {
  const [example, setExample] = useState(null)

  useEffect(() => {
    api('/demo/example').then((d) => setExample(d.example)).catch(() => {})
  }, [])

  const a = example?.analysis
  const s = example?.session

  return (
    <>
      <section className="hero">
        <h1>Круг честнее стока</h1>
        <p className="lede">
          Паспорт машины, лог круга, дельта к себе и к тем же модель+резина на том же треке.
          Без уличного 0–100 в центре.
        </p>
        <div className="hero-actions">
          <Link to={user ? '/garage' : '/auth'}>
            <button type="button">Завести машину</button>
          </Link>
          <Link to="/tops">
            <button type="button" className="ghost">Топ трека</button>
          </Link>
        </div>
      </section>

      <div className="section-title">Живой пример разбора</div>
      {a && s ? (
        <div className="panel">
          <div className="muted small">
            {s.track_name} · {s.make} {s.model} · {s.tire} · {s.date}
          </div>
          <div className="time-xl">{a.best?.time_label || '—'}</div>
          <div className="muted small">лучший круг сессии</div>
          <div className="spacer" />
          <table className="lap-table">
            <thead>
              <tr>
                <th>Круг</th>
                <th>Время</th>
                <th>Δ к себе</th>
                <th>S1</th>
                <th>S2</th>
                <th>S3</th>
              </tr>
            </thead>
            <tbody>
              {(a.laps || []).slice(0, 5).map((l) => (
                <tr key={l.id || l.lap_number} className={l.is_best ? 'best' : ''}>
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
          <p className="coach">{a.coach}</p>
        </div>
      ) : (
        <div className="panel muted">Демо-сессия появится после seed.</div>
      )}
    </>
  )
}
