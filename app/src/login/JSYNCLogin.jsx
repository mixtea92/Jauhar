import { useState } from 'react'
import artwork from '../assets/JIMS_Login_Reference.png'
import './JSYNCLogin.css'

// JIMS Step 50B: UI only. App.jsx still owns all authentication and Supabase logic.
export default function JSYNCLogin({
  username,
  password,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  loading = false,
  error = '',
}) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <main className="jims-login-screen">
      <div className="jims-login-stage">
        <img className="jims-login-artwork" src={artwork} alt="" aria-hidden="true" draggable="false" />
        <div
          className="jims-mobile-brand"
          style={{ backgroundImage: 'linear-gradient(to bottom, transparent 65%, #070605 100%), url("' + artwork + '")' }}
          aria-hidden="true"
        />

        <form
          className="jims-login-form"
          onSubmit={onSubmit}
          aria-label="JIMS secure login"
          autoComplete="on"
        >
          <div className="jims-mobile-form-heading">
            <span>SECURE ACCESS</span>
            <h1>Welcome back</h1>
            <p>Sign in to JAUHAR Integrated Management System</p>
          </div>

          <label className="jims-login-label jims-username-label" htmlFor="jims-login-username">
            Username
          </label>
          <input
            id="jims-login-username"
            name="username"
            className="jims-login-input jims-login-username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            value={username}
            onChange={e => onUsernameChange(e.target.value)}
            placeholder="Username"
            required
            disabled={loading}
          />

          <label className="jims-login-label jims-password-label" htmlFor="jims-login-password">
            Password
          </label>
          <div className="jims-password-wrap">
            <input
              id="jims-login-password"
              name="password"
              className="jims-login-input jims-login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={e => onPasswordChange(e.target.value)}
              placeholder="Password"
              required
              disabled={loading}
            />
            <button
              type="button"
              className="jims-password-eye"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              title={showPassword ? 'Hide password' : 'Show password'}
              disabled={loading}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 3l18 18"/><path d="M10.6 5.2A11.5 11.5 0 0 1 12 5c4.7 0 8.4 2.7 10 7a12 12 0 0 1-3.1 4.7"/><path d="M6.1 6.5A12.5 12.5 0 0 0 2 12c1.5 4.3 5.3 7 10 7a10 10 0 0 0 3-.4"/><path d="M10 10a2.8 2.8 0 0 0 4 4"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>

          <button className="jims-login-submit" type="submit" disabled={loading} aria-label={loading ? 'Signing in' : 'Login'}>
            <span className="jims-submit-label">{loading ? 'SIGNING IN…' : 'LOGIN'}</span>
            {!loading && <span className="jims-submit-arrow" aria-hidden="true">→</span>}
          </button>

          {error && <div className="jims-login-error" role="alert">{error}</div>}
        </form>
      </div>
    </main>
  )
}
