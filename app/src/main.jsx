import JIMS57D6C2MobileNav from './JIMS57D6C2MobileNav'
import './JIMS57D6C3MobileTopbar.css'
import './JIMS57D6C4MobileDashboardActions.css'
import './JIMS57D6C6PageContentMinimal.css'
import './JIMS57D6C8ContextRestored.css'
import './JIMS57D6C5MinimalButtonCopy.css'
import JIMS57D6ThemeController from './JIMS57D6ThemeController'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './JIMS57D6ADarkFinancePolish.css'
import './JIMS57D6C1SidebarPolish.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <JIMS57D6ThemeController />
    <JIMS57D6C2MobileNav />
  </StrictMode>,
)
