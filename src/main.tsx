import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tokens first, then the kit, then the app's own sheet: CSS imported from components inside App comes
// later still, so a surface's stylesheet can always override the kit it builds on.
import './ui/tokens.css'
import './ui/kit.css'
import './styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
