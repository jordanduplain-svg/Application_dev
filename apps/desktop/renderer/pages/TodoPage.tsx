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

type Agenda = { followUps: { id: string; companyName: string; jobTitle: string; dueDate: string }[];
                interviews: { id: string; companyName: string; date: string; location: string | null }[] };

export default function TodoPage({ onOpenCampaign }: { onOpenCampaign?: (id: string) => void }) {
  const [apps, setApps] = useState<Application[]>([]);
  const [agenda, setAgenda] = useState<Agenda>({ followUps: [], interviews: [] });
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
      const [result, ag] = await Promise.all([
        api.invoke('application:listActionRequired'),
        api.invoke('report:agenda'),
      ]);
      if (!isMounted.current) return;
      setApps(result);
      setAgenda(ag);
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

  // Nb de relances réellement dues MAINTENANT (dueDate passée) — source serveur via
  // l'agenda : couvre la 1ʳᵉ relance ET les suivantes (FOLLOWUP-N), contrairement à
  // l'ancien comptage client « SENT > 7 j » qui ignorait les relances de rang 2.
  const now = Date.now();
  const followUpEligible = agenda.followUps.filter((f) => Date.parse(f.dueDate) <= now).length;

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

      {/* F2 : agenda — entretiens à venir + prochaines relances dues. */}
      {(agenda.interviews.length > 0 || agenda.followUps.length > 0) && (
        <div className="card" style={{ marginBottom: '16px', display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px' }}>📆 Entretiens à venir</h3>
            {agenda.interviews.length === 0
              ? <p style={{ fontSize: '12px', color: 'var(--text-sub)', margin: 0 }}>Aucun entretien programmé.</p>
              : <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {agenda.interviews.slice(0, 6).map((iv) => (
                    <li key={iv.id} style={{ fontSize: '12.5px', padding: '4px 0', borderBottom: '1px solid var(--border, #eee)' }}>
                      <strong>{new Date(iv.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</strong>
                      {' — '}{iv.companyName}{iv.location ? ` · 📍 ${iv.location}` : ''}
                    </li>
                  ))}
                </ul>}
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px' }}>⏰ Prochaines relances</h3>
            {agenda.followUps.length === 0
              ? <p style={{ fontSize: '12px', color: 'var(--text-sub)', margin: 0 }}>Aucune relance planifiée.</p>
              : <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {agenda.followUps.slice(0, 6).map((f) => {
                    const due = Date.parse(f.dueDate) <= now;
                    return (
                      <li key={f.id} style={{ fontSize: '12.5px', padding: '4px 0', borderBottom: '1px solid var(--border, #eee)' }}>
                        <span style={{ color: due ? '#ff9f0a' : 'var(--text-sub)', fontWeight: due ? 700 : 400 }}>
                          {due ? 'à relancer' : new Date(f.dueDate).toLocaleDateString('fr-FR')}
                        </span>
                        {' — '}{f.companyName} <span style={{ color: '#888' }}>({f.jobTitle})</span>
                      </li>
                    );
                  })}
                </ul>}
          </div>
        </div>
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
