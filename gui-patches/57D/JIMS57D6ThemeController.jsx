// JIMS Step 57D6B — opt-in LIGHT theme, existing black/gold DARK stays default.
// Isolated React root sibling; no edits to App.jsx, Finance workflows or login.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './JIMS57D6Theme.css'

const PREFERENCE_KEY = 'jims-57d6-theme-v1'
const LIGHT_CLASS = 'jims-57d6-light'
const SHELL_SELECTOR = '.layout .sidebar, .jims-shell .sidebar, .jims-dashboard-shell .sidebar, [data-jims-shell], .sidebar'

function readStoredTheme() {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export default function JIMS57D6ThemeController() {
  const [mode, setMode] = useState(readStoredTheme)
  const [shell, setShell] = useState({ ready:false, topbar:null })

  // Observe App route/login transitions, without editing its business logic.
  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (!appRoot) return undefined
    const detect = () => {
      const ready = Boolean(appRoot.querySelector(SHELL_SELECTOR))
      const topbar = ready ? appRoot.querySelector('.topbar') : null
      setShell(previous =>
        previous.ready === ready && previous.topbar === topbar
          ? previous : { ready, topbar }
      )
    }
    detect()
    const observer = new MutationObserver(detect)
    observer.observe(appRoot, { childList:true, subtree:true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle(
      LIGHT_CLASS, shell.ready && mode === 'light'
    )
    return () => document.documentElement.classList.remove(LIGHT_CLASS)
  }, [shell.ready, mode])

  function toggleTheme() {
    const next = mode === 'dark' ? 'light' : 'dark'
    setMode(next)
    try {
      window.localStorage.setItem(PREFERENCE_KEY, next)
    } catch {
      // Private browsing / storage disabled: switch still works this session.
    }
  }

  // The premium locked black/gold login is never changed.
  if (!shell.ready) return null

  const toggle = (
    <button
      type="button"
      className={'jims-57d6-theme-toggle'+(shell.topbar?'':' jims-57d6-theme-toggle--floating')}
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={mode === 'light'}
      title={mode === 'dark' ? 'Switch JIMS to light mode' : 'Switch JIMS to dark mode'}
      onClick={toggleTheme}
    >
      <span className="jims-57d6-theme-icon" aria-hidden="true">
        {mode === 'dark' ? '☀' : '☾'}
      </span>
      <span>{mode === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </button>
  )
  return shell.topbar ? createPortal(toggle, shell.topbar) : toggle
}
