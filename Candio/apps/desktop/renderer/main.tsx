import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient } from './lib/query-client';
import './styles.css';

// M5 : logs renderer dans le même fichier que le main process via electron-log.
import log from 'electron-log/renderer';

// M5 : capturer les erreurs JavaScript non gérées dans le renderer.
window.addEventListener('error', (e) => {
  log.error('[renderer] Erreur non gérée', e.error);
});

// M5 : capturer les promesses rejetées non gérées dans le renderer.
window.addEventListener('unhandledrejection', (e) => {
  log.warn('[renderer] Promise rejetée', e.reason);
});

// Bootstrap React. StrictMode aide à détecter les effets non idempotents.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* MOD-01 : QueryClientProvider pour react-query (migration incrémentale). */}
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
