import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// F6 — PWA service worker registration. Idempotent (browser dedupes
// re-registers); no-op in environments without serviceWorker support
// (older mobile, file:// protocol, etc.).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* silent */ });
  });
}

