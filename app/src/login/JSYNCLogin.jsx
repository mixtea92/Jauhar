import { useState } from 'react'
import artwork from '../assets/JSYNC_Login_Artwork.png'
import './JSYNCLogin.css'

/**
 * JSYNC Login - appearance only.
 * The parent App owns auth/session logic. No Supabase calls are made here.
 * Visual art uses the exact reference image; inputs/buttons are real DOM controls.
 */
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
    <main className="jsync-page">
      <div className="jsync-artboard">
        <img
          className="jsync-artwork"
          src={artwork}
          alt="JAUHAR Medical Clinic — JSYNC, Jauhar Integrated Management Dashboard"
          draggable="false"
        />

        <form
          className="jsync-form-overlay"
          onSubmit={onSubmit}
          aria-label="JSYNC secure login"
          autoComplete="on"
        >
          {/* Keep the gold borders and labels in the reference image.
              These overlays cover ONLY the baked-in placeholder text. */}
          <label htmlFor="jsync-username" className="jsync-sr-only">Username</label>
          <input
            id="jsync-username"
            className="jsync-overlay-input jsync-username-input"
            type="text"
            name="username"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            placeholder="Enter username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            required
            disabled={loading}
          />

          <label htmlFor="jsync-password" className="jsync-sr-only">Password</label>
          <input
            id="jsync-password"
            className="jsync-overlay-input jsync-password-input"
            type={showPassword ? 'text' : 'password'}
            name="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
            required
            disabled={loading}
          />

          <button
            className="jsync-password-toggle"
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            disabled={loading}
            title={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.7 5.2A11.2 11.2 0 0 1 12 5c5 0 8.7 3 10 7a12.7 12.7 0 0 1-3 4.7" />
                <path d="M6.3 6.4C4.3 7.7 2.9 9.5 2 12c1.3 4 5 7 10 7 1 0 2-.1 2.9-.4" />
                <path d="M10 10a2.8 2.8 0 0 0 4 4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>

          <button
            type="submit"
            className={`jsync-login-hotspot${loading ? ' jsync-is-loading' : ''}`}
            disabled={loading}
            aria-label={loading ? 'Signing in' : 'Login'}
          >
            <span className="jsync-loading-label">{loading ? 'Signing in…' : ''}</span>
          </button>

          {error && (
            <div className="jsync-error" role="alert">{error}</div>
          )}
        </form>
      </div>
    </main>
  )
}
