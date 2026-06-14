import { useCallback, useEffect, useRef, useState } from 'react';
import type { Application } from '@candio/shared';
import { api } from '../lib/api';
import { statusLabel } from '../lib/status';

// UX-5v3 : page centralisée des candidatures nécessitant une action.

// Libellé de l'action requise selon le contexte de la candidature.
function actionLabel(a: Application): string {
  if (a.status === 'FAILED') return 'Renvoi requis (échec)';
  if (a.status === 'REPLIED' && !a.manualStatus) return 'Réponse à qualifier';
  if (a.status === 'SENT') return 'Relance possible (> 7 jours)';
  return 'Action requise';
}

function actionColor(a: Application): string {
  if (a.status === 'FAILED') return '#ff453a';
  if (a.status === 'REPLIED') return '#007aff';
  return '#ff9f0a';
}

export default function TodoPage({ onOpenCampaign }: { onOpenCampaign?: (id: string) => void }) {
  const [apps, setApps] = useState<Application[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  // loadRef : closure stable pour le listener task:progress.
  const loadRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    try {
      const result = await api.invoke('application:listActionRequired');
      if (!isMounted.current) return;
      setApps(result);
      setError(null);
    } catch (e) {
      if (isMounted.current)
        setError(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => { loadRef.current = load; });
  useEffect(() => { void load(); }, [load]);

  // Se rafraîchit quand une tâche d'envoi se termine.
  useEffect(() => {
    return api.on('task:progress', (p) => {
      if (p.status !== 'running' && p.type === 'send-email') {
        void loadRef.current();
      }
    });
  }, []);

  const sendOne = async (appId: string) => {
    setSendingId(appId);
    try {
      await api.invoke('application:send', { id: appId });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'envoi');
    } finally {
      if (isMounted.current) setSendingId(null);
    }
    await load();
  };

  if (loading) return <section><h2>À traiter</h2><p>Chargement…</p></section>;

  return (
    <section>
      <h2>À traiter ({apps.length})</h2>
      <p style={{ color: '#555', fontSize: '13px', marginBottom: '16px' }}>
        Candidatures nécessitant une action : relances en attente, réponses à qualifier, échecs à renvoyer.
      </p>

      {error && <p className="error">{error}</p>}

      {apps.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: '#555', padding: '32px' }}>
          <p style={{ fontSize: '1.5em' }}>✓</p>
          <p>Tout est à jour — aucune action requise.</p>
        </div>
      ) : (
        <ul>
          {apps.map((a) => (
            <li key={a.id} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {/* Badge d'action requise. */}
                <span style={{
                  fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                  background: actionColor(a), color: '#fff', fontWeight: 'bold',
                }}>
                  {actionLabel(a)}
                </span>

                <strong>{a.companyName}</strong>
                <span style={{ fontSize: '13px', color: '#555' }}>{a.subject}</span>
                <span className={`status status-${a.status.toLowerCase()}`}>{statusLabel(a.status)}</span>

                {/* Bouton navigation vers la campagne. */}
                {onOpenCampaign && (
                  <button
                    onClick={() => onOpenCampaign(a.campaignId)}
                    style={{ fontSize: '12px' }}
                  >
                    Voir la campagne
                  </button>
                )}

                {/* Renvoi direct pour les échecs. */}
                {a.status === 'FAILED' && (
                  <button
                    onClick={() => sendOne(a.id)}
                    disabled={sendingId === a.id}
                    style={{ background: '#ff453a', color: '#fff', fontSize: '12px' }}
                  >
                    {sendingId === a.id ? 'Envoi…' : 'Renvoyer'}
                  </button>
                )}
              </div>

              {/* Informations contextuelles. */}
              <div style={{ fontSize: '12px', color: '#888', marginTop: '2px', marginLeft: '8px' }}>
                {a.sentAt && `Envoyé le ${new Date(a.sentAt).toLocaleDateString('fr-FR')}`}
                {a.repliedAt && ` · Réponse le ${new Date(a.repliedAt).toLocaleDateString('fr-FR')}`}
                {a.errorMessage && <span style={{ color: '#ff453a' }}> · Erreur : {a.errorMessage}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
