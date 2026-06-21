import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, Send } from 'lucide-react';
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
  // FOLLOWUP-BATCH : relance en lot des candidatures éligibles.
  const [followingUp, setFollowingUp] = useState(false);
  const [followUpMsg, setFollowUpMsg] = useState<string | null>(null);

  const isMounted = useRef(true);
  // BUG : remettre isMounted=true au (re)montage — sinon le double mount/unmount
  // de React 18 StrictMode (dev) le fige à false → setLoading(false) ignoré →
  // « Chargement… » éternel. (Même pattern que les autres pages.)
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

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

  // FOLLOWUP-BATCH : nb de candidatures réellement relançables — mêmes critères
  // que le serveur (SENT depuis + de 7 jours). BUG-C fix : on ne comptait que
  // le statut SENT, ce qui sur-estimait le nombre annoncé sur le bouton.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const followUpEligible = apps.filter(
    (a) => a.status === 'SENT' && a.sentAt && Date.now() - new Date(a.sentAt).getTime() > SEVEN_DAYS_MS,
  ).length;

  const followUpAll = async () => {
    setFollowingUp(true);
    setFollowUpMsg(null);
    try {
      const r = await api.invoke('application:followUpAllEligible');
      setFollowUpMsg(
        r.enqueued === 0
          ? (r.remaining === 0
              ? 'Plafond d\'envois du jour atteint — réessaie demain.'
              : 'Aucune candidature éligible à relancer.')
          : `${r.enqueued} relance(s) en cours${r.enqueued < r.eligible ? ` (sur ${r.eligible} éligibles — limité au quota du jour)` : ''}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la relance en lot');
    } finally {
      if (isMounted.current) setFollowingUp(false);
    }
    await load();
  };

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

  if (loading) return <section><div className="page-head"><h2>À traiter</h2></div><p>Chargement…</p></section>;

  return (
    <section>
      <div className="page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2>À traiter ({apps.length})</h2>
          <div className="page-sub">
            Candidatures nécessitant une action : relances en attente, réponses à qualifier, échecs à renvoyer.
          </div>
        </div>
        {followUpEligible > 0 && (
          <button onClick={followUpAll} disabled={followingUp} title="Envoie une relance à toutes les candidatures sans réponse depuis + de 7 jours (limité au quota d'envoi du jour)">
            <Send size={15} className={followingUp ? 'spin' : undefined} />
            {followingUp ? 'Relance…' : `Relancer les éligibles (${followUpEligible})`}
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}
      {followUpMsg && (
        <p style={{ fontSize: '13px', color: 'var(--text-sub)', background: '#f2f2f7', borderRadius: '9px', padding: '8px 12px', marginBottom: '12px' }}>{followUpMsg}</p>
      )}

      {apps.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-sub)', padding: '36px', alignItems: 'center' }}>
          <CircleCheck size={40} color="#1D9E75" />
          <p style={{ fontWeight: 600 }}>Tout est à jour — aucune action requise.</p>
        </div>
      ) : (
        <ul>
          {apps.map((a) => (
            <li key={a.id} style={{ marginBottom: '12px', borderLeft: `4px solid ${actionColor(a)}`, alignItems: 'flex-start' }}>
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
                    className="btn-secondary"
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
                    className="btn-danger"
                    style={{ fontSize: '12px' }}
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
