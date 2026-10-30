// JIMS Step 57D6A — additive theme switch, browser only.
// Mount at the React root: no App.jsx, Finance, navigation or login edits.
import { useEffect, useState } from 'react'
import './JIMS57D6Theme.css'

const KEY = 'jims-57d6-theme-v1'
const LIGHT_CLASS = 'jims-57d6-light'
const SHELL_SELECTOR = '.layout .sidebar, .jims-shell .sidebar, .jims-dashboard-shell .sidebar, [data-jims-shell]'

function storedMode() {
  try { return window.localStorage.getItem(KEY) === 'light' ? 'light' : 'dark' }
  catch { return 'dark' }
}

export default function JIMS57D6ThemeController() {
  const [mode, setMode] = useState(storedMode)
  const [shellReady, setShellReady] = useState(false)

  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return undefined
    const detect = () => {
      const visible = Boolean(root.querySelector(SHELL_SELECTOR))
      setShellReady(prev => prev === visible ? prev : visible)
    }
    detect()
    const observer = new MutationObserver(detect)
    observer.observe(root, {childList:true, subtree:true})
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const enabled = shellReady && mode === 'light'
    document.documentElement.classList.toggle(LIGHT_CLASS, enabled)
    // The legacy black/gold login is intentionally never themed.
    return () => document.documentElement.classList.remove(LIGHT_CLASS)
  }, [mode, shellReady])

  function switchMode() {
    const next = mode === 'dark' ? 'light' : 'dark'
    setMode(next)
    try { window.localStorage.setItem(KEY, next) } catch { /* private browser mode */ }
  }

  if (!shellReady) return null
  return <button
    type="button"
    className="jims-57d6-theme-toggle"
    aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    aria-pressed={mode === 'light'}
    title={mode === 'dark' ? 'Switch JIMS to light mode' : 'Switch JIMS to dark mode'}
    onClick={switchMode}
  >
    <span className="jims-57d6-theme-icon" aria-hidden="true">{mode === 'dark' ? '☀' : '☾'}</span>
    <span>{mode === 'dark' ? 'Light mode' : 'Dark mode'}</span>
  </button>
}
