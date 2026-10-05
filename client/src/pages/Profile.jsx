import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../lib/api'

export default function Profile({ user, setUser }) {
  const [name, setName] = useState(user?.name || '')
  const [city, setCity] = useState(user?.city || '')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    setName(user?.name || '')
    setCity(user?.city || '')
  }, [user])

  if (!user) return <Navigate to="/auth" replace />

  async function save(e) {
    e.preventDefault()
    setErr('')
    setMsg('')
    try {
      const d = await api('/me', { method: 'POST', body: { name, city } })
      setUser(d.user)
      setMsg('Сохранено')
    } catch (ex) {
      setErr(ex.message)
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ fontWeight: 600 }}>Профиль</h1>
      <p className="muted small">{user.email}</p>
      <form onSubmit={save} style={{ marginTop: '1.5rem' }}>
        <div className="field">
          <label>Имя</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Город</label>
          <input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button type="submit">Сохранить</button>
      </form>
    </div>
  )
}
