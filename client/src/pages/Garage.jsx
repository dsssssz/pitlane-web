import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api } from '../lib/api'

const empty = {
  make: '', model: '', year: '', engine: '', drivetrain: 'RWD', power_hp: '',
}

export default function Garage({ user }) {
  const [cars, setCars] = useState([])
  const [form, setForm] = useState(empty)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)

  if (!user) return <Navigate to="/auth" replace />

  async function load() {
    const d = await api('/cars')
    setCars(d.cars)
  }

  useEffect(() => { load().catch((e) => setErr(e.message)) }, [])

  async function add(e) {
    e.preventDefault()
    setErr('')
    try {
      await api('/cars', {
        method: 'POST',
        body: {
          ...form,
          year: form.year ? Number(form.year) : null,
          power_hp: form.power_hp ? Number(form.power_hp) : null,
        },
      })
      setForm(empty)
      setOpen(false)
      await load()
    } catch (ex) {
      setErr(ex.message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <h1 style={{ fontWeight: 600, margin: 0 }}>Гараж</h1>
        <button type="button" className="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'Закрыть' : 'Завести машину'}
        </button>
      </div>
      <p className="muted">Паспорт: марка, модель, год, двигатель, привод, мощность. Без 3D.</p>

      {open && (
        <form className="panel" onSubmit={add} style={{ marginTop: '1.25rem' }}>
          <div className="row">
            <div className="field"><label>Марка</label>
              <input required value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} /></div>
            <div className="field"><label>Модель</label>
              <input required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
          </div>
          <div className="row">
            <div className="field"><label>Год</label>
              <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
            <div className="field"><label>Привод</label>
              <select value={form.drivetrain} onChange={(e) => setForm({ ...form, drivetrain: e.target.value })}>
                <option>RWD</option><option>FWD</option><option>AWD</option>
              </select></div>
            <div className="field"><label>Мощность, л.с.</label>
              <input value={form.power_hp} onChange={(e) => setForm({ ...form, power_hp: e.target.value })} /></div>
          </div>
          <div className="field"><label>Двигатель</label>
            <input value={form.engine} onChange={(e) => setForm({ ...form, engine: e.target.value })} placeholder="напр. S55 3.0" /></div>
          {err && <p className="err">{err}</p>}
          <button type="submit">Сохранить паспорт</button>
        </form>
      )}

      <ul className="list-clean" style={{ marginTop: '1.5rem' }}>
        {cars.map((c) => (
          <li key={c.id}>
            <div>
              <strong>{c.make} {c.model}</strong>
              <div className="muted small">
                {[c.year, c.engine, c.drivetrain, c.power_hp ? `${c.power_hp} л.с.` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
            <Link to="/session/new" state={{ carId: c.id }}>Сессия →</Link>
          </li>
        ))}
        {!cars.length && <li className="muted">Пока пусто — заведите первую машину.</li>}
      </ul>
    </div>
  )
}
