import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { App } from './App';
import { init } from './state/store';

init();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
// Offline support + automatic updates when a new version is deployed.
if ('serviceWorker' in navigator && import.meta.env.PROD) registerSW({ immediate: true });
