import React, { type ReactNode } from 'react';
import log from 'electron-log/renderer';

/**
 * N3 : garde de rendu globale. Sans elle, une exception dans n'importe quel
 * composant fait planter tout l'arbre React → fenêtre blanche sans recours.
 * Ici on affiche l'erreur + un bouton « Recharger » (et on la logge).
 */
export class ErrorBoundary extends React.Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    log.error('[renderer] Erreur de rendu React', err, info.componentStack);
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    return (
      <div role="alert" style={{ padding: '32px', maxWidth: '640px', margin: '40px auto', fontFamily: 'inherit' }}>
        <h2 style={{ marginTop: 0 }}>Une erreur est survenue</h2>
        <p style={{ color: 'var(--text-sub, #666)' }}>
          L'application a rencontré un problème d'affichage. Tes données sont intactes — recharge la fenêtre pour continuer.
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2, #f4f4f6)', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', color: '#b00' }}>
          {err.message}
        </pre>
        <button onClick={() => location.reload()} style={{ marginTop: '8px' }}>Recharger l'application</button>
      </div>
    );
  }
}
