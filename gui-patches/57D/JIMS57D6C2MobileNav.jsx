// JIMS 57D6C2 — mobile-only navigation drawer.
// Reuses the live sidebar DOM, nav handlers, role guards and existing badge counts.
// No App.jsx edits, no duplicate menus, no data access, no desktop UI changes.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './JIMS57D6C2MobileNav.css'

const BREAKPOINT = '(max-width: 800px)'
const OPEN_CLASS = 'jims-57d6c2-mobile-open'
const SIDEBAR_ID = 'jims-57d6c2-navigation'

function mobileNow() {
  return typeof window !== 'undefined' && window.matchMedia(BREAKPOINT).matches
}

export default function JIMS57D6C2MobileNav() {
  const [mobile, setMobile] = useState(mobileNow)
  const [open, setOpen] = useState(false)
  const [nodes, setNodes] = useState({ sidebar:null, topbar:null })

  useEffect(() => {
    const media = window.matchMedia(BREAKPOINT)
    const onChange = () => {
      setMobile(media.matches)
      if (!media.matches) setOpen(false)
    }
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // Observe actual JIMS workspace transitions. No markup replacement.
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return undefined
    const detect = () => {
      const sidebar = root.querySelector('.jims-shell .sidebar')
      const topbar = root.querySelector('.jims-shell > .content > .topbar')
      setNodes(old => old.sidebar === sidebar && old.topbar === topbar
        ? old : { sidebar, topbar })
      if (!sidebar || !topbar) setOpen(false)
    }
    detect()
    const observer = new MutationObserver(detect)
    observer.observe(root, { childList:true, subtree:true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const sidebar = nodes.sidebar
    if (!sidebar) return undefined
    const previousId = sidebar.getAttribute('id')
    if (!previousId) sidebar.id = SIDEBAR_ID
    return () => {
      if (!previousId && sidebar.id === SIDEBAR_ID) sidebar.removeAttribute('id')
    }
  }, [nodes.sidebar])

  useEffect(() => {
    if (!mobile || !open || !nodes.sidebar) {
      document.documentElement.classList.remove(OPEN_CLASS)
      return undefined
    }
    const sidebar = nodes.sidebar
    document.documentElement.classList.add(OPEN_CLASS)
    const previousTabIndex = sidebar.getAttribute('tabindex')
    sidebar.setAttribute('tabindex', '-1')

    // First keyboard focus lands inside the drawer, not on the covered page.
    const frame = requestAnimationFrame(() => {
      sidebar.querySelector('.jims-57d6c2-close')?.focus({ preventScroll:true })
    })
    function handleKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusables = [...sidebar.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]'
      )].filter(element => {
        const style = window.getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          element.getClientRects().length > 0
      })
      if (!focusables.length) {
        event.preventDefault()
        sidebar.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === sidebar)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    // Auto-close after selecting a REAL route, not while expanding a submenu.
    function handleSidebarClick(event) {
      const button = event.target instanceof Element
        ? event.target.closest('button.nav-item') : null
      if (button && !button.hasAttribute('aria-expanded')) setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    sidebar.addEventListener('click', handleSidebarClick)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKey)
      sidebar.removeEventListener('click', handleSidebarClick)
      document.documentElement.classList.remove(OPEN_CLASS)
      if (previousTabIndex === null) sidebar.removeAttribute('tabindex')
      else sidebar.setAttribute('tabindex', previousTabIndex)
      const trigger = nodes.topbar?.querySelector('.jims-57d6c2-menu-button')
      if (trigger && document.contains(trigger)) trigger.focus({ preventScroll:true })
    }
  }, [mobile, open, nodes.sidebar, nodes.topbar])

  // The login screen and desktop never get a hamburger or backdrop.
  if (!mobile || !nodes.sidebar || !nodes.topbar) return null

  const toggle = (
    <button
      type="button"
      className="jims-57d6c2-menu-button"
      aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
      aria-controls={nodes.sidebar.id || SIDEBAR_ID}
      aria-expanded={open}
      onClick={() => setOpen(current => !current)}
    >
      <span className="jims-57d6c2-menu-symbol" aria-hidden="true">☰</span>
      <span>Menu</span>
    </button>
  )

  const close = (
    <button
      type="button"
      className="jims-57d6c2-close"
      aria-label="Close navigation menu"
      onClick={() => setOpen(false)}
    >
      <span aria-hidden="true">×</span>
    </button>
  )

  return <>
    {createPortal(toggle, nodes.topbar)}
    {createPortal(close, nodes.sidebar)}
    {open && createPortal(
      <button
        type="button"
        className="jims-57d6c2-backdrop"
        aria-label="Close navigation menu"
        onClick={() => setOpen(false)}
      />,
      document.body
    )}
  </>
}
