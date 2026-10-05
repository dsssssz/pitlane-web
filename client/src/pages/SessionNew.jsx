import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

export default function SessionNew({ user }) {
  const nav = useNavigate()
  const loc = useLocation()
  const [cars, setCars] = useState([])
  const [tracks, setTracks] = useState([])
  const [err, setErr] = useState('')
  const [form, setForm] = useState({
    car_id: loc.state?.carId || '',
    track_id: 'moscow-raceway',
    date: new Date().toISOString().slice(0, 10),
    weather: '',
    temp_c: '',
    tire: 'Cup 2',
    pressure_fl: '2.1',
    pressure_fr: '2.1',
    pressure_rl: '2.0',
    pressure_rr: '2.0',
    note: '',
    visibility: 'private',
    scored: false,
  })

  if (!user) return <Navigate to="/auth" replace />

  useEffect(() => {
    Promise.all([api('/cars'), api('/tracks')])
      .then(([c, t]) => {
        setCars(c.cars)
        setTracks(t.tracks)
        if (!form.car_id && c.cars[0]) setForm((f) => ({ ...f, car_id: c.cars[0].id }))
      })
      .catch((e) => setErr(e.message))
  }, [])

  async function create(e) {
    e.preventDefault()
    setErr('')
    if (!form.car_id) return setErr('Сначала заведите машину в гараже')
    try {
      const d = await api('/sessions', {
        method: 'POST',
        body: {
          ...form,
          temp_c: form.temp_c === '' ? null : Number(form.temp_c),
          pressure_fl: form.pressure_fl === '' ? null : Number(form.pressure_fl),
          pressure_fr: form.pressure_fr === '' ? null : Number(form.pressure_fr),
          pressure_rl: form.pressure_rl === '' ? null : Number(form.pressure_rl),
          pressure_rr: form.pressure_rr === '' ? null : Number(form.pressure_rr),
          scored: !!form.scored,
        },
      })
      nav(`/session/${d.session.id}`)
    } catch (ex) {
      setErr(ex.message)
    }
  }

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((f) => ({ ...f, [k]: v }))
  }

  return (
    <div>
      <h1 style={{ fontWeight: 600 }}>Новая сессия</h1>
      <p className="muted">Трек, условия, резина. Файл GPX/CSV — на следующем экране.</p>
      <form className="panel" onSubmit={create} style={{ marginTop: '1.25rem' }}>
        <div className="row">
          <div className="field">
            <label>Машина</label>
            <select required value={form.car_id} onChange={set('car_id')}>
              <option value="">—</option>
              {cars.map((c) => (
                <option key={c.id} value={c.id}>{c.make} {c.model}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Трек</label>
            <select required value={form.track_id} onChange={set('track_id')}>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field"><label>Дата</label>
            <input type="date" value={form.date} onChange={set('date')} required /></div>
          <div className="field"><label>Погода</label>
            <input value={form.weather} onChange={set('weather')} placeholder="ясно / облачно" /></div>
          <div className="field"><label>t°, C</label>
            <input value={form.temp_c} onChange={set('temp_c')} /></div>
        </div>
        <div className="field"><label>Резина</label>
          <input value={form.tire} onChange={set('tire')} placeholder="Cup 2 / R888R / SportContact" /></div>
        <div className="row">
          <div className="field"><label>P FL</label><input value={form.pressure_fl} onChange={set('pressure_fl')} /></div>
          <div className="field"><label>P FR</label><input value={form.pressure_fr} onChange={set('pressure_fr')} /></div>
          <div className="field"><label>P RL</label><input value={form.pressure_rl} onChange={set('pressure_rl')} /></div>
          <div className="field"><label>P RR</label><input value={form.pressure_rr} onChange={set('pressure_rr')} /></div>
        </div>
        <div className="field"><label>Заметка</label>
          <textarea rows={2} value={form.note} onChange={set('note')} /></div>
        <div className="row">
          <div className="field">
            <label>Приватность</label>
            <select value={form.visibility} onChange={set('visibility')}>
              <option value="private">private (по умолчанию)</option>
              <option value="crew">экипаж</option>
              <option value="public">public</option>
            </select>
          </div>
          <div className="field" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 12 }}>
            <label style={{ textTransform: 'none', letterSpacing: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.scored} onChange={set('scored')} style={{ width: 'auto' }} />
              В зачёт (топ трека)
            </label>
          </div>
        </div>
        {err && <p className="err">{err}</p>}
        <button type="submit">Создать сессию</button>
      </form>
    </div>
  )
}
