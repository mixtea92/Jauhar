#!/usr/bin/env node
'use strict'
// JIMS GUI Step 50B — Login page only. No auth, App, dashboard, PV, CV, database edits.
const fs = require('node:fs')
const path = require('node:path')
const root = process.cwd()
const loginDir = path.join(root, 'app', 'src', 'login')
const assetsDir = path.join(root, 'app', 'src', 'assets')
const jsxPath = path.join(loginDir, 'JSYNCLogin.jsx')
const cssPath = path.join(loginDir, 'JSYNCLogin.css')
const webp = path.join(assetsDir, 'JIMS_Login_Reference.webp')
const png = path.join(assetsDir, 'JIMS_Login_Reference.png')
const dryRun = process.argv.includes('--dry-run')
function fail(message) { console.error('STOP: ' + message); process.exit(1) }
if (!fs.existsSync(jsxPath) || !fs.existsSync(cssPath)) fail('Run from /workspaces/Jauhar. Login files not found.')
const art = fs.existsSync(webp) ? 'JIMS_Login_Reference.webp' : fs.existsSync(png) ? 'JIMS_Login_Reference.png' : null
if (!art) fail('Upload JIMS_Login_Reference.webp or .png to app/src/assets first. No code changed.')
const src = fs.readFileSync(jsxPath, 'utf8')
if (!src.includes('export default function JSYNCLogin') || !src.includes('onUsernameChange') || !src.includes('onSubmit')) {
  fail('Existing login code has a different structure; refuse to overwrite.')
}
const jsx=String.raw`import { useState } from 'react'
import artwork from '../assets/__ASSET__'
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
`.replace('__ASSET__', art)

const css=String.raw`/* Step 50B JIMS — isolated, full-bleed login-only stylesheet.
   Matches the provided 1672x941 artwork; authentication remains in App.jsx. */
html:has(.jims-login-screen),
body:has(.jims-login-screen) {
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  background: #050403 !important;
}
#root:has(.jims-login-screen) {
  width: 100% !important;
  max-width: none !important;
  min-height: 100dvh !important;
  border: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  background: #050403 !important;
}
.jims-login-screen,
.jims-login-screen * { box-sizing: border-box; }
.jims-login-screen {
  position: fixed;
  inset: 0;
  z-index: 1000;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: #050403;
  color: #f3dfae;
  font-family: Arial, Helvetica, sans-serif;
  text-align: left;
  isolation: isolate;
}
/* Object-fit cover math: wallpaper and inputs use exactly the same coordinate system. */
.jims-login-stage {
  position: absolute;
  top: 50%;
  left: 50%;
  width: max(100vw, 177.6833dvh);
  height: max(100dvh, 56.2799vw);
  transform: translate(-50%, -50%);
  overflow: hidden;
}
.jims-login-artwork {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  user-select: none;
  pointer-events: none;
}
.jims-mobile-brand, .jims-mobile-form-heading { display: none; }
.jims-login-form { position: absolute; inset: 0; margin: 0; pointer-events: none; }
.jims-login-form input, .jims-login-form button { pointer-events: auto; font-family: inherit; }
.jims-login-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.jims-login-input {
  position: absolute;
  display: block;
  margin: 0;
  border: none;
  border-radius: 0;
  padding: 0 0.45%;
  outline: none;
  color: #f9f0d6;
  background: linear-gradient(90deg, #171714 0%, #1a1917 53%, #181816 100%);
  box-shadow: none;
  font-size: clamp(12px, 1.05vw, 18px);
  font-weight: 400;
  line-height: normal;
  min-width: 0;
  min-height: 0;
  appearance: none;
}
.jims-login-input::placeholder { color: #92908b; opacity: 1; }
.jims-login-input:focus { background: #1e1c18; box-shadow: inset 0 -2px 0 #e4b452; }
.jims-login-input:disabled { opacity: 0.8; cursor: wait; }
.jims-login-username { left: 39.42%; top: 60.04%; width: 24.6%; height: 4.95%; }
.jims-login-password { left: 39.42%; top: 68.31%; width: 23.12%; height: 4.80%; }
.jims-password-eye {
  position: absolute;
  left: 62.55%;
  top: 68.35%;
  width: 2.45%;
  height: 4.75%;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 4px;
  padding: 0.15%;
  margin: 0;
  color: #bba77d;
  background: #191915;
  cursor: pointer;
}
.jims-password-eye svg { display: block; width: 80%; height: 80%; }
.jims-password-eye:hover { color: #ffe49f; }
.jims-password-eye:focus-visible, .jims-login-submit:focus-visible {
  outline: 3px solid #ffe19b;
  outline-offset: 2px;
}
.jims-login-submit {
  position: absolute;
  left: 34.91%;
  top: 75.48%;
  width: 30.25%;
  height: 7.86%;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 17px;
  background: transparent;
  color: #251402;
  cursor: pointer;
}
.jims-login-submit:hover { background: rgba(255,248,220,0.07); box-shadow: 0 0 22px rgba(255,205,78,.19); }
.jims-login-submit:disabled { cursor: wait; background: rgba(253,219,133,.2); }
.jims-submit-label, .jims-submit-arrow { display: none; }
.jims-login-submit:disabled .jims-submit-label { display: inline; color: #1f1609; font-weight: 800; font-size: clamp(13px,1.3vw,20px); }
.jims-login-error {
  position: absolute;
  top: 84.2%;
  left: 35%;
  width: 30%;
  border: 1px solid #c48860;
  border-radius: 8px;
  padding: 10px 14px;
  background: rgba(60,18,18,.94);
  color: #ffe1d7;
  font-size: clamp(12px, 1vw, 16px);
  line-height: 1.3;
  text-align: center;
  pointer-events: auto;
}
/* Portrait and mobile: same artwork is used for the original branded heading,
   with a real card below it. No tiny scaled inputs, clipped form, or white gutters. */
@media (max-width: 820px), (max-aspect-ratio: 9/10) {
  .jims-login-screen { overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
  .jims-login-stage {
    position: relative; top: auto; left: auto;
    width: 100%; min-height: 100dvh; height: auto;
    transform: none; overflow: visible;
    display: flex; flex-direction: column; align-items: center;
    padding: 0 18px 30px;
    background:
      radial-gradient(ellipse 90% 26% at 50% 4%, rgba(154,95,26,.19), transparent 75%),
      linear-gradient(180deg,#090706 0%,#050504 100%);
  }
  .jims-login-artwork { display: none; }
  .jims-mobile-brand {
    display: block;
    flex: 0 0 200px;
    width: calc(100% + 36px);
    margin: 0 -18px;
    background-position: center top, center top;
    background-repeat: no-repeat;
    background-size: 100% 100%, auto 365px;
    pointer-events: none;
  }
  .jims-login-form {
    position: relative; inset: auto;
    display: flex; flex-direction: column;
    width: min(100%, 440px); margin: 0;
    padding: 24px 23px 26px;
    border-radius: 20px;
    border: 1px solid rgba(216,161,76,.43);
    background: linear-gradient(145deg, rgba(20,18,15,.98), rgba(8,8,8,.99));
    box-shadow: 0 20px 48px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,208,124,.08);
    pointer-events: auto;
  }
  .jims-mobile-form-heading { display: block; margin-bottom: 22px; }
  .jims-mobile-form-heading span { display: block; font-size: 10px; font-weight: 750; letter-spacing: 3px; color: #b58b49; margin-bottom: 8px; }
  .jims-mobile-form-heading h1 { color: #ffe3a2; font-size: clamp(24px,6vw,31px); line-height: 1.15; margin: 0 0 7px; font-weight: 750; letter-spacing: -.6px; }
  .jims-mobile-form-heading p { color: #ada08a; font-size: 12px; line-height: 1.45; margin: 0; }
  .jims-login-label { position: static; display: block; width: auto; height: auto; clip-path: none; overflow: visible; white-space: normal; margin: 0 0 8px; color: #e3c386; font-size: 12px; font-weight: 700; }
  .jims-password-wrap { position: relative; margin-bottom: 17px; }
  .jims-login-input {
    position: static; left: auto; top: auto;
    width: 100%; height: 52px; padding: 0 15px;
    margin: 0 0 17px;
    border: 1px solid rgba(200,154,84,.48);
    border-radius: 12px;
    background: #191817;
    font-size: 16px;
  }
  .jims-login-input:focus { border-color: #f0be60; box-shadow: 0 0 0 3px rgba(231,171,65,.15); }
  .jims-password-wrap .jims-login-input { margin: 0; padding-right: 56px; }
  .jims-password-eye {
    position: absolute; left: auto; right: 5px; top: 5px;
    width: 43px; height: 42px; padding: 10px;
    background: transparent; border-radius: 10px;
  }
  .jims-password-eye svg { width: 22px; height: 22px; }
  .jims-login-submit {
    position: static; left: auto; top: auto;
    width: 100%; height: 55px;
    border-radius: 13px;
    background: linear-gradient(100deg,#d5a345 0%,#ffe49c 43%,#c68d35 100%);
    box-shadow: 0 7px 19px rgba(220,152,44,.23), inset 0 1px 0 rgba(255,255,255,.4);
    color: #211508; font-size: 15px; font-weight: 800; letter-spacing: 3px;
  }
  .jims-login-submit:hover { background: linear-gradient(100deg,#e6b95c,#fff0b9,#dfa94c); box-shadow: 0 9px 26px rgba(222,160,61,.33); }
  .jims-login-submit:disabled { opacity:.65; }
  .jims-submit-label, .jims-submit-arrow { display: inline; }
  .jims-submit-arrow { font-size: 25px; line-height: 1; margin-top: -2px; }
  .jims-login-error { position: static; width: 100%; margin-top: 16px; padding: 10px; font-size: 12px; }
}
@media (max-height: 650px) and (max-width: 820px) {
  .jims-mobile-brand { flex-basis: 160px; background-size: 100% 100%, auto 310px; }
  .jims-login-form { padding-top: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .jims-login-screen *, .jims-login-screen *::before, .jims-login-screen *::after { transition: none !important; animation: none !important; }
}
`
console.log('JIMS 50B — login-only install')
console.log('Branch check: ' + require('child_process').execFileSync('git', ['branch', '--show-current'], {cwd:root, encoding:'utf8'}).trim())
console.log('Artwork found: app/src/assets/' + art)
console.log('Files that would change: app/src/login/JSYNCLogin.jsx and JSYNCLogin.css')
if (dryRun) { console.log('DRY RUN PASSED. No files changed.'); process.exit(0) }
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backups = [[jsxPath, jsxPath + '.backup_before_jims_50B_' + stamp],
                 [cssPath, cssPath + '.backup_before_jims_50B_' + stamp]]
try {
  for (const [file, copy] of backups) fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL)
  fs.writeFileSync(jsxPath, jsx)
  fs.writeFileSync(cssPath, css)
  console.log('INSTALLED: Login-only JIMS full-bleed GUI.')
  console.log('No changes to App.jsx, PV, CV, auth, backend, or database.')
  console.log('Backups: ' + backups.map(pair => path.basename(pair[1])).join(', '))
} catch(e) {
  for (const [file, copy] of backups) if (fs.existsSync(copy)) fs.copyFileSync(copy,file)
  fail('Install rolled back: ' + e.message)
}
