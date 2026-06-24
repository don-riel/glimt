import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Settings } from './Settings'
import './styles.css'

// Trivial hash routing: popup at '', settings at '#settings'. Replace with a
// real router when the UI grows.
const isSettings = window.location.hash.replace('#', '') === 'settings'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isSettings ? <Settings /> : <App />}</StrictMode>,
)
