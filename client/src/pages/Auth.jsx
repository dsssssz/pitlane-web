import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, setToken } from '../lib/api'

export default function Auth({ setUser, verify }) {
  const [email, setEmail] = useState('')
  const [magicUrl, setMagicUrl] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [params] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    const token = params.get('token')
    if (!token && !verify) return
    if (!token) return
    setBusy(true)
    api('/auth/verify', { method: 'POST', body: { token } })
      .then((d) => {
        setToken(d.token)
        setUser(d.user)
        navigate('/garage')
      })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false))
  }, [params, verify, setUser, navigate])

  async function requestLink(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const d = await api('/auth/request', { method: 'POST', body: { email } })
      setMagicUrl(d.magicUrl)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  async function openMagic() {
    if (!magicUrl) return
    const u = new URL(magicUrl, window.location.origin)
    const token = u.searchParams.get('token')
    if (!token) return
    setBusy(true)
    try {
      const d = await api('/auth/verify', { method: 'POST', body: { token } })
      setToken(d.token)
      setUser(d.user)
      navigate('/garage')
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h1 style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>Вход</h1>
      <p className="muted">Email и magic link. Telegram не обязателен.</p>
      <form onSubmit={requestLink} style={{ marginTop: '1.5rem' }}>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@mail.ru"
            required
            autoComplete="email"
          />
        </div>
        {err && <p className="err">{err}</p>}
        <button type="submit" disabled={busy}>Получить ссылку</button>
      </form>
      {magicUrl && (
        <div className="magic-box">
          <div className="muted small" style={{ marginBottom: 8 }}>Демо без SMTP — нажмите войти:</div>
          <button type="button" onClick={openMagic} disabled={busy}>Открыть magic link</button>
          <div style={{ marginTop: 10 }} className="small muted">{magicUrl}</div>
        </div>
      )}
    </div>
  )
}
