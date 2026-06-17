import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, Reply, MessageSquare } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { Application } from '@candio/shared';
import { api } from '../lib/api';

// PERF-1 : pagination côté client.
const PAGE_SIZE = 20;

// Page Réponses : liste des candidatures dont une réponse a été détectée par IMAP.
export default function RepliesPage() {
  const [replies, setReplies] = useState<Application[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  // UX-10 : notes de suivi par candidature (id → texte saisi en cours).
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  // FM6 : filtre texte et sélecteur de tri.
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'company' | 'status'>('date_desc');
  // PERF-1 : pagination.
  const [page, setPage] = useState(0);

  const load = async () => {
    try {
      // PERF-M1 : le canal retourne maintenant { items, total }.
      const result = await api.invoke('application:listReplied');
      setReplies(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement');
    }
  };

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    return api.on('task:progress', (p) => {
      if (p.type === 'poll-replies' && p.status !== 'running') void loadRef.current();
    });
  }, []);

  const pollNow = async () => {
    if (polling) return;
    setPolling(true);
    setError(null);
    try {
      await api.invoke('replies:pollNow');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du relevé');
    } finally {
      setPolling(false);
    }
  };

  // UX-10 : enregistrer une note de suivi.
  const saveNote = async (applicationId: string) => {
    const note = noteInputs[applicationId] ?? '';
    setSavingNoteId(applicationId);
    try {
      await api.invoke('application:addFollowUpNote', { id: applicationId, note });
      // Recharger pour mettre à jour le followUpNote affiché.
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement de la note');
    } finally {
      setSavingNoteId(null);
    }
  };

  // FM-08 : suivi d'entretien par candidature.
  const [interviewForms, setInterviewForms] = useState<Record<string, { date: string; location: string; notes: string }>>({});
  const [savingInterviewId, setSavingInterviewId] = useState<string | null>(null);

  const getInterviewForm = (a: Application) => interviewForms[a.id] ?? {
    date: a.interviewDate ? a.interviewDate.slice(0, 16) : '',
    location: a.interviewLocation ?? '',
    notes: a.interviewNotes ?? '',
  };

  const saveInterview = async (applicationId: string) => {
    const f = interviewForms[applicationId];
    if (!f) return;
    setSavingInterviewId(applicationId);
    try {
      await api.invoke('application:setInterview', {
        id: applicationId,
        interviewDate: f.date ? new Date(f.date).toISOString() : null,
        interviewLocation: f.location || null,
        interviewNotes: f.notes || null,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement');
    } finally {
      setSavingInterviewId(null);
    }
  };

  // UX-S9 : réponse rapide au recruteur.
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const sendReply = async (applicationId: string) => {
    if (!replyBody.trim()) return;
    setSendingReply(true);
    try {
      await api.invoke('application:replyToRecruiter', { id: applicationId, body: replyBody });
      setReplyingId(null);
      setReplyBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'envoi');
    } finally {
      setSendingReply(false);
    }
  };

  // B7 : seuil de troncature aligné sur MAX_REPLY_LENGTH du backend.
  const TRUNCATION_THRESHOLD = 49_990;

  // UX-10 : détecter si le contenu contient du HTML pour l'afficher correctement.
  function renderContent(content: string | null) {
    if (!content) return null;
    const isTruncated = content.length >= TRUNCATION_THRESHOLD;
    const hasHtml = /<[a-z][\s\S]*>/i.test(content);
    return (
      <>
        {/* B7 : avertissement si le message dépasse la limite de stockage. */}
        {isTruncated && (
          <p style={{ fontSize: '11px', color: '#ff9f0a', margin: '2px 0' }}>
            (message tronqué — seuls les 50 000 premiers caractères sont affichés)
          </p>
        )}
        {hasHtml ? (
          <div
            // SEC-1v2 : DOMPurify sanitise le HTML avant injection (XSS).
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}
            style={{ maxHeight: '200px', overflow: 'auto', wordBreak: 'break-word' }}
          />
        ) : (
          <pre style={{ maxHeight: '200px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {content}
          </pre>
        )}
      </>
    );
  }

  // FM6 : filtre et tri côté client.
  const filteredReplies = replies
    .filter((r) => !search || r.companyName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'date_asc') return new Date(a.repliedAt ?? 0).getTime() - new Date(b.repliedAt ?? 0).getTime();
      if (sortBy === 'date_desc') return new Date(b.repliedAt ?? 0).getTime() - new Date(a.repliedAt ?? 0).getTime();
      if (sortBy === 'company') return a.companyName.localeCompare(b.companyName);
      if (sortBy === 'status') return (a.manualStatus ?? '').localeCompare(b.manualStatus ?? '');
      return 0;
    });

  // PERF-1 : pagination des réponses filtrées.
  const totalPages = Math.max(1, Math.ceil(filteredReplies.length / PAGE_SIZE));
  const paginatedReplies = filteredReplies.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <section>
      <div className="page-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2>Réponses reçues</h2>
          <div className="page-sub">Les réponses détectées par IMAP — qualifie, prends des notes, réponds directement.</div>
        </div>
        <button onClick={pollNow} disabled={polling}>
          <RefreshCw size={15} className={polling ? 'spin' : undefined} />
          {polling ? 'Relevé en cours…' : 'Relever maintenant'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {/* FM6 : barre de recherche et sélecteur de tri. */}
      <div style={{ display: 'flex', gap: '8px', margin: '12px 0', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '160px', display: 'flex' }}>
          <Search size={15} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-sub)', pointerEvents: 'none' }} />
          <input
            placeholder="Rechercher par entreprise…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            style={{ flex: 1, paddingLeft: '32px' }}
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          style={{ minWidth: '160px' }}
        >
          <option value="date_desc">Date (récent d'abord)</option>
          <option value="date_asc">Date (ancien d'abord)</option>
          <option value="company">Entreprise (A-Z)</option>
          <option value="status">Statut manuel</option>
        </select>
      </div>

      {filteredReplies.length === 0 && (
        <p>{replies.length === 0 ? 'Aucune réponse pour le moment.' : 'Aucune réponse ne correspond à la recherche.'}</p>
      )}
      <ul>
        {paginatedReplies.map((a) => (
          <li key={a.id} style={{ flexDirection: 'column', alignItems: 'stretch', borderLeft: '4px solid #5856d6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <MessageSquare size={15} color="#5856d6" />
              <strong>{a.companyName}</strong>
              <span style={{ color: 'var(--text-sub)', fontSize: '13px' }}>— {a.subject}</span>
              <span className="status status-replied" style={{ marginLeft: 'auto' }}>Réponse reçue</span>
            </div>
            <small>
              Reçu le {a.repliedAt ? new Date(a.repliedAt).toLocaleString('fr-FR') : ''}
            </small>

            {/* UX-10 : rendu intelligent du contenu (HTML ou texte brut). */}
            {renderContent(a.replyContent)}

            {/* UX-10 : note de suivi. */}
            <div style={{ marginTop: '8px' }}>
              {a.followUpNote && (
                <p style={{ fontStyle: 'italic', color: '#888', marginBottom: '4px' }}>
                  Note : {a.followUpNote}
                </p>
              )}
              <textarea
                rows={2}
                placeholder="Note de suivi…"
                value={noteInputs[a.id] ?? a.followUpNote ?? ''}
                onChange={(e) => setNoteInputs((prev) => ({ ...prev, [a.id]: e.target.value }))}
                style={{ width: '100%', resize: 'vertical' }}
              />
              <button
                onClick={() => saveNote(a.id)}
                disabled={savingNoteId === a.id}
                style={{ marginTop: '4px' }}
              >
                {savingNoteId === a.id ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>

            {/* FM-08 : suivi d'entretien (visible si manualStatus === 'INTERVIEWED'). */}
            {a.manualStatus === 'INTERVIEWED' && (
              <div style={{ marginTop: '8px', background: '#fff8e1', border: '1px solid #ffc107', borderRadius: '6px', padding: '10px' }}>
                <h4 style={{ margin: '0 0 8px', fontSize: '13px', color: '#856404' }}>Suivi d'entretien</h4>
                {/* Afficher les infos sauvegardées si elles existent. */}
                {a.interviewDate && !interviewForms[a.id] && (
                  <p style={{ fontSize: '12px', color: '#555', marginBottom: '6px' }}>
                    📅 {new Date(a.interviewDate).toLocaleString('fr-FR')}
                    {a.interviewLocation && ` — 📍 ${a.interviewLocation}`}
                    {a.interviewNotes && <><br />{a.interviewNotes}</>}
                  </p>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <input
                    type="datetime-local"
                    value={getInterviewForm(a).date}
                    onChange={(e) => setInterviewForms((prev) => ({ ...prev, [a.id]: { ...getInterviewForm(a), date: e.target.value } }))}
                    style={{ fontSize: '13px' }}
                  />
                  <input
                    type="text"
                    placeholder="Lieu (ex : visio, Paris 9e…)"
                    value={getInterviewForm(a).location}
                    onChange={(e) => setInterviewForms((prev) => ({ ...prev, [a.id]: { ...getInterviewForm(a), location: e.target.value } }))}
                    style={{ fontSize: '13px' }}
                  />
                  <textarea
                    rows={2}
                    placeholder="Notes sur l'entretien…"
                    value={getInterviewForm(a).notes}
                    onChange={(e) => setInterviewForms((prev) => ({ ...prev, [a.id]: { ...getInterviewForm(a), notes: e.target.value } }))}
                    style={{ fontSize: '13px', resize: 'vertical' }}
                  />
                  <button
                    onClick={() => void saveInterview(a.id)}
                    disabled={savingInterviewId === a.id}
                    style={{ alignSelf: 'flex-start', background: '#ffc107', color: '#000' }}
                  >
                    {savingInterviewId === a.id ? 'Enregistrement…' : 'Enregistrer entretien'}
                  </button>
                </div>
              </div>
            )}

            {/* UX-S9 : répondre au recruteur. */}
            {replyingId === a.id ? (
              <div style={{ marginTop: '8px' }}>
                <textarea
                  rows={3}
                  placeholder="Votre réponse…"
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  style={{ width: '100%', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button
                    onClick={() => void sendReply(a.id)}
                    disabled={sendingReply || !replyBody.trim()}
                    style={{ background: '#34c759', color: '#fff' }}
                  >
                    {sendingReply ? 'Envoi…' : 'Envoyer la réponse'}
                  </button>
                  <button onClick={() => { setReplyingId(null); setReplyBody(''); }}>Annuler</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setReplyingId(a.id); setReplyBody(''); }}
                style={{ marginTop: '8px', fontSize: '12px', background: '#5856d6', boxShadow: '0 1px 2px rgba(88,86,214,0.3)', alignSelf: 'flex-start' }}
              >
                <Reply size={14} />Répondre au recruteur
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* PERF-1 : pagination des réponses. */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: '8px', margin: '8px 0', alignItems: 'center' }}>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            ← Précédent
          </button>
          <span>Page {page + 1} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
            Suivant →
          </button>
        </div>
      )}
    </section>
  );
}
