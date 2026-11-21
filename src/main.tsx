import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import { App } from './App';
import { init, refreshReports, reloadFromCloud, setBeforeReports } from './state/store';
import { setOnApplied, startSyncLoop, syncBeforeReports } from './sync/client';

// Cloud sync (does nothing until it is turned on in Settings → Cloud sync)
setOnApplied(reloadFromCloud);
setBeforeReports(syncBeforeReports);
startSyncLoop();

init();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Weekly reports: a week is finalized as soon as it has ended (Friday 11:59:59 PM New York).
// With cloud sync on, the cloud also does this on schedule even when no phone is open.
// On the phone the check runs when the app opens, every minute while it is open, and when it
// returns to the foreground — so a week that ended while the phone was off is finalized on open.
setInterval(() => void refreshReports(), 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshReports();
});

// Offline support + automatic updates when a new version is deployed.
if ('serviceWorker' in navigator && import.meta.env.PROD) registerSW({ immediate: true });
