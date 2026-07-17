import { useEffect, useState } from 'react';
import type { Application } from '@candio/shared';
import { api } from '../lib/api';
import { MANUAL_STATUS_OPTIONS, manualStatusColor } from '../lib/campaignDetail';
import { effectiveSentiment } from '@candio/shared';

/**
 * PIPELINE-01 : vue Kanban des réponses reçues, par statut manuel. Colonnes :
 * À qualifier → Entretien → Offre reçue → Accepté / Refusé. Chaque carte porte un sélecteur
 * pour déplacer la candidature (pas de drag-and-drop → aucune dépendance, ponytail).
 * Alimenté par les mêmes données que la page Réponses (application:listReplied).
 */
const COLUMNS: { value: string; label: string }[] = [
  { value: '', label: 'À qualifier' },
  { value: 'INTERVIEWED', label: 'Entretien' },
  { value: 'OFFER', label: 'Offre reçue' },
  { value: 'ACCEPTED', label: 'Accepté' },
  { value: 'REJECTED', label: 'Refusé' },
];

export default function PipelinePage() {
  const [replies, setReplies] = useState<Application[]>([]);
  const [error, setError] = useState<string | null>(null);
  // PIPELINE-DND : drag-and-drop natif (HTML5, sans dépendance). draggingId = carte en cours
  // de glissement ; overCol = colonne survolée (surbrillance de dépôt).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.invoke('application:listReplied');
      setReplies(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement');
    }
  };
  useEffect(() => { void load(); }, []);

  const move = async (id: string, manualStatus: string) => {
    setReplies((prev) => prev.map((r) => r.id === id ? { ...r, manualStatus: manualStatus || null } : r));
    try {
      await api.invoke('application:setManualStatus', { id, manualStatus: manualStatus || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du déplacement');
      await load();
    }
  };

  // PIPELINE-FILTER : « À qualifier » ne montre que les réponses d'INTÉRÊT (heuristique).
  // Refus/neutres restent visibles avec leur pastille sur la page Réponses, mais n'encombrent
  // pas le pipeline, qui suit les pistes d'entreprise. Aucun statut écrit en base (pas de faux
  // REJECTED qui fausserait les stats) : simple filtre d'affichage.
  const byColumn = (value: string) => replies.filter((r) => {
    if ((r.manualStatus ?? '') !== value) return false;
    if (value === '') return effectiveSentiment(r) === 'positive';
    // « Refusé » : n'affiche QUE les pistes qui avaient un INTÉRÊT (sentiment positif) et que
    // tu as rejetées — celles qui faisaient partie de ton pipeline. Les anciens refus en masse
    // (réponses de refus/neutres) restent cachés : ils n'ont jamais été des pistes à suivre.
    if (value === 'REJECTED') return effectiveSentiment(r) === 'positive';
    return true;
  });

  // Dépôt sur une colonne : déplace la carte glissée si elle change d'étape.
  const dropOn = (colValue: string, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    setOverCol(null); setDraggingId(null);
    if (!id) return;
    const app = replies.find((r) => r.id === id);
    if (app && (app.manualStatus ?? '') !== colValue) void move(id, colValue);
  };

  return (
    <section>
      <div className="page-head">
        <h2>Pipeline</h2>
        <div className="page-sub">Vos <strong>pistes d'intérêt</strong> par étape — <strong>glissez-déposez</strong> une carte d'une colonne à l'autre (ou utilisez le sélecteur). Les refus et réponses neutres restent sur la page <strong>Réponses</strong> et n'apparaissent pas ici.</div>
      </div>
      {error && <p className="error">{error}</p>}
      {replies.length === 0 ? (
        <p style={{ color: 'var(--text-sub)' }}>Aucune réponse reçue pour le moment.</p>
      ) : (
        <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
          {COLUMNS.map((col) => {
            const cards = byColumn(col.value);
            const color = manualStatusColor(col.value || null);
            const isOver = overCol === col.value;
            return (
              <div key={col.value}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!isOver) setOverCol(col.value); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol((c) => c === col.value ? null : c); }}
                onDrop={(e) => dropOn(col.value, e)}
                style={{ minWidth: '240px', flex: '1 0 240px',
                background: isOver ? `${color}14` : 'var(--surface, #f6f7f9)', borderRadius: '12px', padding: '10px',
                border: isOver ? `2px dashed ${color}` : '1px solid var(--border, #ececf0)', transition: 'background 0.12s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
                  <strong style={{ fontSize: '13px' }}>{col.label}</strong>
                  <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-sub)' }}>{cards.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {cards.map((a) => (
                    <div key={a.id}
                      draggable
                      onDragStart={(e) => { setDraggingId(a.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', a.id); }}
                      onDragEnd={() => { setDraggingId(null); setOverCol(null); }}
                      style={{ background: 'var(--card, #fff)', border: '1px solid var(--border, #ececf0)',
                      borderRadius: '10px', padding: '9px 11px', borderLeft: `3px solid ${color}`,
                      cursor: 'grab', opacity: draggingId === a.id ? 0.4 : 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{a.companyName}</div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-sub)', margin: '2px 0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {a.subject}
                      </div>
                      {a.repliedAt && (
                        <div style={{ fontSize: '10.5px', color: 'var(--text-sub)', marginBottom: '6px' }}>
                          {new Date(a.repliedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                        </div>
                      )}
                      <select value={a.manualStatus ?? ''} onChange={(e) => void move(a.id, e.target.value)}
                        aria-label={`Déplacer ${a.companyName}`} style={{ fontSize: '11px', width: '100%' }}>
                        {MANUAL_STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                      </select>
                    </div>
                  ))}
                  {cards.length === 0 && <div style={{ fontSize: '11.5px', color: 'var(--text-sub)', padding: '6px 2px' }}>—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
