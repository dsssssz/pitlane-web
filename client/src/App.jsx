import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { api, getToken, setToken } from './lib/api'
import Home from './pages/Home'
import Auth from './pages/Auth'
import Profile from './pages/Profile'
import Garage from './pages/Garage'
import SessionNew from './pages/SessionNew'
import SessionView from './pages/SessionView'
import Crew from './pages/Crew'
import Duel from './pages/Duel'
import Tops from './pages/Tops'

function Shell({ user, setUser, children }) {
  const navigate = useNavigate()
  async function logout() {
    try { await api('/auth/logout', { method: 'POST', body: {} }) } catch {}
    setToken(null)
    setUser(null)
    navigate('/')
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/" className="brand">PITLANE</NavLink>
        <nav className="nav">
          {user && <>
            <NavLink to="/garage">Гараж</NavLink>
            <NavLink to="/session/new">Сессия</NavLink>
            <NavLink to="/crew">Экипаж</NavLink>
            <NavLink to="/duel">Дуэль</NavLink>
            <NavLink to="/tops">Топ</NavLink>
            <NavLink to="/profile">{user.name || 'Профиль'}</NavLink>
            <a href="#logout" onClick={(e) => { e.preventDefault(); logout() }}>Выход</a>
          </>}
          {!user && <NavLink to="/auth">Вход</NavLink>}
        </nav>
      </header>
      <div className="nav-mobile">
        {user ? <>
          <NavLink to="/garage">Гараж</NavLink>
          <NavLink to="/session/new">Сессия</NavLink>
          <NavLink to="/crew">Экипаж</NavLink>
          <NavLink to="/duel">Дуэль</NavLink>
          <NavLink to="/tops">Топ</NavLink>
          <NavLink to="/profile">Профиль</NavLink>
        </> : <NavLink to="/auth">Вход</NavLink>}
      </div>
      <main className="main">{children}</main>
      <footer className="footer">Трек-день · паспорт · круг · дельта · экипаж</footer>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!getToken()) { setReady(true); return }
      try {
        const { user } = await api('/me')
        if (!cancelled) setUser(user)
      } catch {
        setToken(null)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!ready) {
    return <div className="main muted" style={{ paddingTop: '4rem' }}>Загрузка…</div>
  }

  return (
    <Shell user={user} setUser={setUser}>
      <Routes>
        <Route path="/" element={<Home user={user} />} />
        <Route path="/auth" element={<Auth setUser={setUser} />} />
        <Route path="/auth/verify" element={<Auth setUser={setUser} verify />} />
        <Route path="/profile" element={<Profile user={user} setUser={setUser} />} />
        <Route path="/garage" element={<Garage user={user} />} />
        <Route path="/session/new" element={<SessionNew user={user} />} />
        <Route path="/session/:id" element={<SessionView user={user} />} />
        <Route path="/crew" element={<Crew user={user} />} />
        <Route path="/crew/:id" element={<Crew user={user} />} />
        <Route path="/duel" element={<Duel user={user} />} />
        <Route path="/tops" element={<Tops />} />
      </Routes>
    </Shell>
  )
}
