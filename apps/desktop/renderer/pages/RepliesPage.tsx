import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, Reply, MessageSquare } from 'lucide-react';
import DOMPurify from 'dompurify';
import type { Application, ThreadMessage } from '@candio/shared';
import { api } from '../lib/api';
import { MANUAL_STATUS_OPTIONS } from '../lib/campaignDetail';
import { stripQuotedReply, classifyReplySentiment } from '../../src/tasks/reply-matching';

// Pastille de sentiment de la réponse (heuristique, sans IA).
const SENTIMENT = {
  positive:  { color: '#1D9E75', bg: '#e8f8ee', label: 'Intérêt' },
  rejection: { color: '#c4271c', bg: '#ffe5e3', label: 'Refus' },
  neutral:   { color: '#8a8a8e', bg: '#f0f0f2', label: 'Neutre' },
} as const;

// PERF-1 : pagination côté client.
const PAGE_SIZE = 20;

// CANNED-01 : modèles de réponse rapide (répondre en 1 clic, éditables ensuite).
const CANNED_REPLIES: { label: string; body: string }[] = [
  { label: 'Dispo entretien', body: 'Bonjour,\n\nMerci pour votre retour. Je suis disponible pour un entretien à votre convenance — n\'hésitez pas à me proposer un créneau, en visio ou sur place.\n\nBien cordialement,' },
  { label: 'Demander des précisions', body: 'Bonjour,\n\nMerci pour votre message. Pourriez-vous me préciser les prochaines étapes du processus ainsi que le détail du poste ?\n\nBien cordialement,' },
  { label: 'Remercier / rester en contact', body: 'Bonjour,\n\nMerci pour votre retour. Je reste à votre disposition et à l\'écoute de toute opportunité future au sein de votre équipe.\n\nBien cordialement,' },
];

// Page Réponses : liste des candidatures dont une réponse a été détectée par IMAP.
//
// ROUAGE : `application:listReplied` charge les candidatures REPLIED ; le bouton « Relever »
// déclenche `application:pollReplies` (force un cycle IMAP) et la page écoute `reply:received`
// pour se rafraîchir en direct. Sur chaque réponse : qualification (`manualStatus`), réponse
// au recruteur, suivi d'entretien + export `.ics`. L'affichage dé-cite (stripQuotedReply) et
// assainit le HTML (DOMPurify) — on montre le vrai message du recruteur, sans risque XSS.
export default function RepliesPage() {
  const [replies, setReplies] = useState<Application[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  // UX-10 : notes de suivi par candidature (id → texte saisi en cours).
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  // Réponses dont on affiche la citation complète (par défaut on masque l'email cité).
  const [showQuoted, setShowQuoted] = useState<Set<string>>(new Set());
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

  // REMIND-01 : pose/efface un rappel (« me rappeler de répondre dans X jours »). Optimiste.
  const setRemind = async (id: string, days: number | null) => {
    const iso = days === null ? null : new Date(Date.now() + days * 864e5).toISOString();
    setReplies((prev) => prev.map((r) => r.id === id ? { ...r, remindAt: iso } : r));
    try {
      await api.invoke('application:setRemindAt', { id, remindAt: iso });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du rappel');
      await load();
    }
  };

  // THREAD-01 : fil de conversation complet, chargé à la demande par candidature.
  const [threads, setThreads] = useState<Record<string, ThreadMessage[]>>({});
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());
  const toggleThread = async (id: string) => {
    setOpenThreads((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    if (!threads[id]) {
      try { const t = await api.invoke('application:getThread', { id }); setThreads((p) => ({ ...p, [id]: t })); }
      catch (e) { setError(e instanceof Error ? e.message : 'Erreur lors du chargement du fil'); }
    }
  };

  // Qualification directe de la réponse (manualStatus) depuis cette page — même liste
  // et même canal que la page Détail de campagne. Optimiste : maj locale immédiate.
  const setManualStatus = async (id: string, manualStatus: string) => {
    setReplies((prev) => prev.map((r) => r.id === id ? { ...r, manualStatus: manualStatus || null } : r));
    try {
      await api.invoke('application:setManualStatus', { id, manualStatus: manualStatus || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du changement de statut');
      await load(); // rollback via rechargement si l'écriture a échoué
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
      await load(); // REPLY-OUT : recharge pour afficher ma réponse + basculer le badge
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'envoi');
    } finally {
      setSendingReply(false);
    }
  };

  // B7 : seuil de troncature aligné sur MAX_REPLY_LENGTH du backend.
  const TRUNCATION_THRESHOLD = 49_990;

  // UX-10 : détecter si le contenu contient du HTML pour l'afficher correctement.
  function renderContent(content: string | null, id: string) {
    if (!content) return null;
    const isTruncated = content.length >= TRUNCATION_THRESHOLD;
    // Détecter de VRAIES balises HTML (et pas « <https://… > » des URLs en texte brut,
    // qui faisait basculer la réponse en mode HTML → 1 seule ligne illisible + citation
    // non coupée).
    const hasHtml = /<\/?(?:p|div|br|span|a|table|tr|td|th|tbody|thead|ul|ol|li|h[1-6]|b|i|u|strong|em|img|blockquote|hr|pre|font|body|html|head|style)\b[^>]*>/i.test(content);

    // Texte brut : on n'affiche que le vrai message (citation de l'email d'origine
    // masquée), avec un bouton pour la révéler. Le HTML est laissé tel quel (sanitisé).
    const quotedShown = showQuoted.has(id);
    const stripped = hasHtml ? content : stripQuotedReply(content);
    const hasQuote = !hasHtml && stripped !== content.trim();
    const shown = hasHtml || quotedShown ? content : stripped;
    const toggle = () => setShowQuoted((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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
          <div style={{
            maxHeight: '260px', overflow: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            background: '#f6f7f9', border: '1px solid #ececf0', borderRadius: '10px',
            padding: '12px 14px', fontSize: '13.5px', lineHeight: 1.55, color: '#1d1d1f',
          }}>
            {shown}
          </div>
        )}
        {hasQuote && (
          <button onClick={toggle} className="btn-secondary" style={{ fontSize: '11px', marginTop: '6px', padding: '3px 8px' }}>
            {quotedShown ? '▲ Masquer la citation' : '▾ Afficher le message complet (avec citation)'}
          </button>
        )}
      </>
    );
  }

  // FM6 + F4 : filtre plein-texte (entreprise, objet ET contenu de la réponse) + tri.
  // Dernière activité du fil = max(réponse recruteur, ma réponse) → un fil que je viens
  // de répondre OU qui vient de recevoir une réponse remonte en haut.
  const lastActivity = (r: Application) =>
    Math.max(new Date(r.repliedAt ?? 0).getTime(), new Date(r.myRepliedAt ?? 0).getTime());
  const q = search.toLowerCase();
  const filteredReplies = replies
    .filter((r) => !q || [r.companyName, r.subject, r.replyContent]
      .some((v) => (v ?? '').toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sortBy === 'date_asc') return lastActivity(a) - lastActivity(b);
      if (sortBy === 'date_desc') return lastActivity(b) - lastActivity(a);
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
            placeholder="Rechercher (entreprise, objet, contenu des réponses)…"
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
        {paginatedReplies.map((a) => {
          const sent = SENTIMENT[classifyReplySentiment(stripQuotedReply(a.replyContent))];
          // REPLY-OUT : « Répondu » si j'ai répondu APRÈS le dernier message reçu ;
          // sinon « En attente de réponse » (le fil attend mon retour).
          // ponytail: repliedAt n'est posé qu'à la 1ʳᵉ réponse recruteur → une 2ᵉ réponse
          // ne rebascule pas le badge tant que le polling ne met pas repliedAt à jour.
          const myAt = a.myRepliedAt ? new Date(a.myRepliedAt).getTime() : 0;
          const recAt = a.repliedAt ? new Date(a.repliedAt).getTime() : 0;
          const iReplied = myAt > 0 && myAt >= recAt;
          const replyBadge = iReplied
            ? { label: '✓ Répondu', color: '#1D9E75', bg: '#e8f8ee' }
            : { label: '⏳ En attente de réponse', color: '#b26a00', bg: '#fff4e0' };
          return (
          <li key={a.id} style={{ flexDirection: 'column', alignItems: 'stretch', borderLeft: `4px solid ${sent.color}`, gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <MessageSquare size={16} color={sent.color} />
              <strong style={{ fontSize: '15px' }}>{a.companyName}</strong>
              <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: sent.bg, color: sent.color }}>
                {sent.label}
              </span>
              {/* REPLY-OUT : badge d'état de MA réponse (se met à jour après envoi/retour). */}
              <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: replyBadge.bg, color: replyBadge.color }}>
                {replyBadge.label}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-sub)' }}>
                {a.repliedAt ? new Date(a.repliedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              {/* Qualification de la réponse (Entretien, Offre reçue, Refusé, Accepté) — en haut à droite. */}
              <select value={a.manualStatus ?? ''} onChange={(e) => void setManualStatus(a.id, e.target.value)}
                title="Statut de cette réponse" style={{ fontSize: '12px', padding: '3px 6px' }}>
                {MANUAL_STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-sub)', marginTop: '-2px' }}>{a.subject}</div>

            {/* UX-10 : rendu intelligent du contenu (HTML ou texte brut). */}
            {renderContent(a.replyContent, a.id)}

            {/* REPLY-OUT : ma réponse au recruteur, affichée dans le fil (alignée à droite). */}
            {a.myReplyContent && (
              <div style={{ marginTop: '8px', marginLeft: 'auto', maxWidth: '85%' }}>
                <div style={{ fontSize: '11px', color: '#5856d6', fontWeight: 600, textAlign: 'right', marginBottom: '3px' }}>
                  <Reply size={12} style={{ verticalAlign: '-1px' }} /> Votre réponse
                  {a.myRepliedAt && ` · ${new Date(a.myRepliedAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                </div>
                <div style={{
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: '#eef0ff', border: '1px solid #dcdfff', borderRadius: '10px',
                  padding: '10px 12px', fontSize: '13.5px', lineHeight: 1.55, color: '#1d1d1f',
                  maxHeight: '220px', overflow: 'auto',
                }}>
                  {a.myReplyContent}
                </div>
              </div>
            )}

            {/* REMIND-01 : rappel / snooze — « me rappeler de répondre ». */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
              {a.remindAt ? (
                <span style={{ fontSize: '12px', color: '#b26a00', background: '#fff4e0', border: '1px solid #ffd591',
                  borderRadius: '999px', padding: '2px 10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  ⏰ Rappel le {new Date(a.remindAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                  <button onClick={() => void setRemind(a.id, null)} title="Effacer le rappel"
                    style={{ background: 'none', border: 'none', color: '#b26a00', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: 0 }}>✕</button>
                </span>
              ) : (
                <>
                  <span style={{ fontSize: '11px', color: 'var(--text-sub)' }}>⏰ Me rappeler :</span>
                  <button onClick={() => void setRemind(a.id, 2)} className="btn-secondary" style={{ fontSize: '11px', padding: '2px 8px' }}>dans 2 j</button>
                  <button onClick={() => void setRemind(a.id, 7)} className="btn-secondary" style={{ fontSize: '11px', padding: '2px 8px' }}>1 semaine</button>
                </>
              )}
            </div>

            {/* THREAD-01 : fil de conversation complet (candidature → réponses → mes réponses). */}
            <button onClick={() => void toggleThread(a.id)} className="btn-secondary"
              style={{ fontSize: '11px', marginTop: '8px', padding: '3px 8px', alignSelf: 'flex-start' }}>
              {openThreads.has(a.id) ? '▲ Masquer le fil' : '💬 Voir le fil complet'}
            </button>
            {openThreads.has(a.id) && threads[a.id] && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                {threads[a.id].map((m) => {
                  const out = m.direction === 'OUT';
                  return (
                    <div key={m.id} style={{ alignSelf: out ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                      <div style={{ fontSize: '10.5px', color: out ? '#5856d6' : '#555', marginBottom: '2px', textAlign: out ? 'right' : 'left' }}>
                        {out ? 'Vous' : (m.fromEmail || 'Recruteur')} · {new Date(m.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div style={{
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13px', lineHeight: 1.5,
                        background: out ? '#eef0ff' : '#f6f7f9', border: `1px solid ${out ? '#dcdfff' : '#ececf0'}`,
                        borderRadius: '10px', padding: '9px 12px', maxHeight: '220px', overflow: 'auto',
                      }}>
                        {stripQuotedReply(m.body)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

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
                    <br />
                    <button
                      onClick={() => { void api.invoke('report:interviewIcs', { id: a.id }).catch((e) => setError(e instanceof Error ? e.message : 'Erreur .ics')); }}
                      style={{ marginTop: '6px', fontSize: '12px' }}
                    >
                      📆 Ajouter au calendrier
                    </button>
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
                {/* CANNED-01 : modèles de réponse rapide — insèrent un texte éditable. */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-sub)', alignSelf: 'center' }}>Modèle :</span>
                  {CANNED_REPLIES.map((t) => (
                    <button key={t.label} onClick={() => setReplyBody(t.body)} className="btn-secondary"
                      title="Insère ce modèle (modifiable)" style={{ fontSize: '11px', padding: '2px 8px' }}>
                      {t.label}
                    </button>
                  ))}
                </div>
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
          );
        })}
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
