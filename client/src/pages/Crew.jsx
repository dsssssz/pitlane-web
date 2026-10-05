import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'

export default function Crew({ user }) {
  const { id } = useParams()
  const [crews, setCrews] = useState([])
  const [detail, setDetail] = useState(null)
  const [name, setName] = useState('Мой экипаж')
  const [code, setCode] = useState('')
  const [sessions, setSessions] = useState([])
  const [shareId, setShareId] = useState('')
  const [err, setErr] = useState('')
  const [inviteUrl, setInviteUrl] = useState('')

  if (!user) return <Navigate to="/auth" replace />

  async function loadList() {
    const d = await api('/crews')
    setCrews(d.crews)
  }

  async function loadDetail(cid) {
    const d = await api(`/crews/${cid}`)
    setDetail(d)
    const url = `${window.location.origin}/crew?join=${d.crew.invite_code}`
    setInviteUrl(url)
  }

  useEffect(() => {
    loadList().catch((e) => setErr(e.message))
    api('/sessions').then((d) => setSessions(d.sessions)).catch(() => {})
    const join = new URLSearchParams(window.location.search).get('join')
    if (join) setCode(join)
  }, [])

  useEffect(() => {
    if (id) loadDetail(id).catch((e) => setErr(e.message))
  }, [id])

  async function create(e) {
    e.preventDefault()
    setErr('')
    try {
      const d = await api('/crews', { method: 'POST', body: { name } })
      await loadList()
      await loadDetail(d.crew.id)
    } catch (ex) {
      setErr(ex.message)
    }
  }

  async function join(e) {
    e.preventDefault()
    setErr('')
    try {
      const d = await api('/crews/join', { method: 'POST', body: { code } })
      await loadList()
      await loadDetail(d.crew.id)
    } catch (ex) {
      setErr(ex.message)
    }
  }

  async function share(e) {
    e.preventDefault()
    if (!detail?.crew || !shareId) return
    try {
      await api(`/crews/${detail.crew.id}/share-session`, {
        method: 'POST',
        body: { session_id: shareId },
      })
      await loadDetail(detail.crew.id)
    } catch (ex) {
      setErr(ex.message)
    }
  }

  return (
    <div>
      <h1 style={{ fontWeight: 600 }}>Экипаж</h1>
      <p className="muted">Создайте экипаж, киньте инвайт-ссылку, откройте сессии тем, кто в связке.</p>
      {err && <p className="err">{err}</p>}

      <div className="duel-grid" style={{ marginTop: '1.5rem' }}>
        <form className="panel" onSubmit={create}>
          <h3>Создать</h3>
          <div className="field"><label>Название</label>
            <input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <button type="submit">Создать экипаж</button>
        </form>
        <form className="panel" onSubmit={join}>
          <h3>Войти по коду</h3>
          <div className="field"><label>Инвайт-код</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="DEMOCREW" /></div>
          <button type="submit" className="ghost">Присоединиться</button>
        </form>
      </div>

      <div className="section-title">Ваши экипажи</div>
      <ul className="list-clean">
        {crews.map((c) => (
          <li key={c.id}>
            <span>{c.name}</span>
            <button type="button" className="ghost" onClick={() => loadDetail(c.id)}>Открыть</button>
          </li>
        ))}
        {!crews.length && <li className="muted">Пока нет экипажей</li>}
      </ul>

      {detail && (
        <div className="panel" style={{ marginTop: '1.5rem' }}>
          <h2>{detail.crew.name}</h2>
          <p className="muted small">Код: <span className="time-md">{detail.crew.invite_code}</span></p>
          {inviteUrl && (
            <div className="magic-box">{inviteUrl}</div>
          )}
          <div className="section-title">Участники</div>
          <ul className="list-clean">
            {detail.members.map((m) => (
              <li key={m.id}>
                <span>{m.name || m.email}</span>
                <span className="muted small">{m.city || ''}</span>
              </li>
            ))}
          </ul>
          <div className="section-title">Машины</div>
          <ul className="list-clean">
            {detail.cars.map((c) => (
              <li key={c.id}>
                <span>{c.make} {c.model}</span>
                <span className="muted small">{c.owner_name}</span>
              </li>
            ))}
          </ul>
          <div className="section-title">Открытые сессии</div>
          <ul className="list-clean">
            {detail.sessions.map((s) => (
              <li key={s.id}>
                <span>{s.track_name} · {s.user_name} · {s.date}</span>
                <Link to={`/session/${s.id}`}>Разбор</Link>
              </li>
            ))}
            {!detail.sessions.length && <li className="muted">Пока никто не открыл сессию</li>}
          </ul>
          <form onSubmit={share} className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Поделиться своей сессией</label>
              <select value={shareId} onChange={(e) => setShareId(e.target.value)}>
                <option value="">—</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{s.track_name} · {s.date}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="ghost">Открыть экипажу</button>
          </form>
        </div>
      )}
    </div>
  )
}
