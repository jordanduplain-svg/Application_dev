import { useEffect, useRef, useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import type { Cv } from '@candio/shared';
import { api } from '../lib/api';

// Clé localStorage : « ne plus me demander » avant suppression d'un CV.
const DELETE_SKIP_KEY = 'carreer-ops:cv-delete-skip-confirm';

/**
 * Score de qualité + recommandations calculés LOCALEMENT depuis le CV extrait
 * (sans IA → toujours disponible, instantané). Sert de repli quand l'IA n'a pas
 * produit de review (timeout, CV analysé avant la feature…).
 *
 * Barème /100 : compétences (40), expériences (35), formation (15), langues (10).
 */
function computeHeuristicReview(parsed: NonNullable<Cv['parsed']>): { score: number; recommendations: string[] } {
  const nSkills = parsed.skills?.length ?? 0;
  const nExp = parsed.experiences?.length ?? 0;
  const nEdu = parsed.education?.length ?? 0;
  const nLang = parsed.languages?.length ?? 0;

  let score = 0;
  score += Math.min(nSkills, 8) / 8 * 40;     // 8+ compétences = max
  score += Math.min(nExp, 3) / 3 * 35;        // 3+ expériences = max
  score += nEdu > 0 ? 15 : 0;
  score += Math.min(nLang, 2) / 2 * 10;       // 2+ langues = max
  score = Math.round(score);

  const recommendations: string[] = [];
  if (nSkills < 5) recommendations.push('Ajoute plus de compétences techniques (vise au moins 5-8 mots-clés).');
  if (nExp < 2) recommendations.push('Détaille davantage tes expériences (intitulé, entreprise, durée, résultats chiffrés).');
  if (nEdu === 0) recommendations.push('Ajoute ta formation / tes diplômes.');
  if (nLang === 0) recommendations.push('Indique les langues que tu maîtrises et ton niveau.');
  if (recommendations.length === 0) {
    recommendations.push('CV bien rempli — pense à quantifier tes résultats (chiffres, %, volumes).');
    recommendations.push('Adapte l\'ordre des compétences selon le poste visé.');
  }
  return { score, recommendations };
}

/**
 * CV-MULTI : page de gestion des CV nommés.
 *
 * L'utilisateur crée plusieurs CV (un par type de poste : Data Analyst, Chef de
 * projet…), importe un PDF pour chacun (analysé par l'IA), puis choisit lequel
 * utiliser par campagne (sélecteur dans le formulaire de campagne).
 *
 * ROUAGE : `cv:importFile` copie le PDF puis enfile la tâche `cv-parse` (extraction IA) ;
 * la page suit `task:progress` type `cv-parse` pour passer le badge « Analyse… » → « ✓ Analysé »
 * sans rechargement manuel. C'est le `parsed` produit ici qui rendra les lettres personnalisées.
 */
export default function CvPage() {
  const [cvs, setCvs] = useState<Cv[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // CV-REVIEW : une analyse IA est-elle en cours + libellé du moteur IA actif.
  const [analyzing, setAnalyzing] = useState(false);
  const [aiEngine, setAiEngine] = useState<string>('');
  // Chronomètre temps réel pendant l'analyse (rassure que ça n'a pas freezé).
  const [elapsedSec, setElapsedSec] = useState(0);
  // Modale de confirmation de suppression (remplace le dialog natif Windows).
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const isMounted = useRef(true);

  // StrictMode (dev) fait setup→cleanup→re-setup : on REMET true au montage,
  // sinon le cleanup laisse isMounted=false et tous les setCvs sont ignorés
  // (→ la liste restait vide alors que cv:list renvoyait bien les CV).
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Chrono : compte les secondes tant qu'une analyse est en cours.
  useEffect(() => {
    if (!analyzing) { setElapsedSec(0); return; }
    const start = Date.now();
    setElapsedSec(0);
    const t = setInterval(() => setElapsedSec(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [analyzing]);

  // Charge le libellé du moteur IA actif (pour informer pendant l'analyse).
  useEffect(() => {
    void api.invoke('settings:getStatus').then((st) => {
      if (!isMounted.current) return;
      setAiEngine(st.aiProvider === 'ollama'
        ? `Ollama — ${st.ollamaModel}` : `OpenAI — ${st.aiModel}`);
    }).catch(() => {});
  }, []);

  const load = async () => {
    try {
      const list = await api.invoke('cv:list');
      if (isMounted.current) setCvs(list);
    } catch (e) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Erreur de chargement des CV');
    }
  };
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  useEffect(() => { void load(); }, []);

  // Suit l'analyse CV (tâche de fond) : bandeau pendant, refresh à la fin.
  useEffect(() => {
    return api.on('task:progress', (p) => {
      if (p.type !== 'cv-parse') return;
      if (!isMounted.current) return;
      if (p.status === 'running') {
        setAnalyzing(true);
      } else {
        setAnalyzing(false);
        if (p.status === 'failed') setError(p.message);
        void loadRef.current();
      }
    });
  }, []);

  const createCv = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await api.invoke('cv:create', { name });
      setNewName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la création');
    } finally {
      if (isMounted.current) setCreating(false);
    }
  };

  // Crée le CV puis ouvre directement le sélecteur de PDF (flux en une étape).
  // Si l'utilisateur annule le dialog, on supprime le CV créé (pas d'orphelin vide).
  const createAndImport = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const cv = await api.invoke('cv:create', { name });
      const { imported } = await api.invoke('cv:importFile', { id: cv.id });
      if (!imported) {
        // Annulé → rollback : on retire le CV vide qu'on venait de créer.
        await api.invoke('cv:delete', { id: cv.id });
      } else {
        setNewName('');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la création / import');
    } finally {
      if (isMounted.current) setCreating(false);
    }
  };

  const importFile = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.invoke('cv:importFile', { id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'import du PDF');
    } finally {
      if (isMounted.current) setBusyId(null);
    }
  };

  const reanalyze = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await api.invoke('cv:reanalyze', { id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la relance');
    } finally {
      if (isMounted.current) setBusyId(null);
    }
  };

  // Suppression effective (sans confirmation).
  const doDelete = async (id: string) => {
    setBusyId(id);
    try {
      await api.invoke('cv:delete', { id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la suppression');
    } finally {
      if (isMounted.current) setBusyId(null);
    }
  };

  // Demande de suppression : modale in-app, sauf si l'utilisateur a coché
  // « ne plus me demander » (mémorisé dans localStorage).
  const requestDelete = (id: string, name: string) => {
    if (localStorage.getItem(DELETE_SKIP_KEY) === '1') {
      void doDelete(id);
    } else {
      setConfirmDelete({ id, name });
    }
  };

  // Confirmation depuis la modale.
  const confirmDeleteNow = async () => {
    if (!confirmDelete) return;
    if (dontAskAgain) {
      try { localStorage.setItem(DELETE_SKIP_KEY, '1'); } catch { /* ignore */ }
    }
    const id = confirmDelete.id;
    setConfirmDelete(null);
    await doDelete(id);
  };

  const saveRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) { setRenamingId(null); return; }
    try {
      await api.invoke('cv:rename', { id, name });
      setRenamingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors du renommage');
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>Mes CV</h2>
        <div className="page-sub">
          Un CV par type de poste — importe le PDF, l'IA extrait tes compétences, puis tu choisis quel CV utiliser pour chaque campagne.
        </div>
      </div>

      <div className="cv-wrap">
      {error && <p className="error">{error}</p>}

      {/* CV-REVIEW : bandeau pendant l'analyse IA (indique le moteur utilisé). */}
      {analyzing && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          background: '#eef4ff', border: '1px solid #0a84ff', borderRadius: '8px',
          padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: '#0a3d8f',
        }}>
          <span style={{ fontSize: '18px' }}>⏳</span>
          <span>
            <strong>L'IA analyse ton CV… ({elapsedSec}s)</strong> Extraction des compétences, score et recommandations.
            {aiEngine && <> Moteur : <strong>{aiEngine}</strong>.</>}
            {' '}Ça prend quelques secondes à 1-2 min — c'est normal, ne ferme pas l'app.
          </span>
        </div>
      )}

      {/* Création d'un nouveau CV (nom) */}
      <div className="form-section" style={{ '--m': '#5856d6', marginBottom: '16px' } as React.CSSProperties}>
        <div className="form-section-title"><span className="fst-ico"><FilePlus2 size={16} /></span>Ajouter un CV</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Nom du CV (ex : CV Data Analyst)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createAndImport(); }}
            style={{ flex: 1, minWidth: '220px' }}
          />
          <button
            onClick={createAndImport}
            disabled={creating || !newName.trim()}
            style={{ whiteSpace: 'nowrap' }}
          >
            <FilePlus2 size={15} />{creating ? 'Import en cours…' : 'Créer et importer le PDF'}
          </button>
          <button onClick={createCv} disabled={creating || !newName.trim()} className="btn-secondary" style={{ fontSize: '13px' }}>
            Créer sans PDF
          </button>
        </div>
        <small style={{ color: 'var(--text-sub)', display: 'block', marginTop: '8px' }}>
          « Créer et importer » crée le CV puis ouvre le sélecteur de PDF (l'IA l'analyse ensuite).
        </small>
      </div>

      {/* Encart : créer un CV au format ATS — toujours visible (avec ou sans CV). */}
      <div style={{
        marginBottom: '16px', padding: '16px 18px', borderRadius: '10px',
        background: '#eef4ff', border: '1px solid #0a84ff',
      }}>
        <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '6px' }}>
          📝 Besoin d'un CV au format ATS ?
          {' '}<span style={{
            fontSize: '11px', fontWeight: 700, color: '#fff', background: '#34c759',
            borderRadius: '10px', padding: '2px 8px', verticalAlign: 'middle',
          }}>GRATUIT</span>
        </div>
        <p style={{ fontSize: '13px', color: '#444', lineHeight: 1.6, margin: '0 0 8px' }}>
          Les recruteurs utilisent des logiciels (ATS) qui scannent automatiquement les CV.
          Un CV «&nbsp;joli&nbsp;» mais mal structuré est souvent mal lu, voire écarté.
        </p>
        <div style={{
          fontSize: '12px', color: '#856404', background: '#fff8e1',
          border: '1px solid #ffc107', borderRadius: '8px', padding: '8px 10px', margin: '0 0 12px', lineHeight: 1.5,
        }}>
          ⚠️ <strong>Évite les CV à colonnes, images, graphiques, icônes ou polices fantaisie</strong> :
          les ATS ne les lisent pas correctement. Privilégie <strong>une seule colonne</strong>, du
          <strong> texte sélectionnable</strong> (pas une image), des titres de sections clairs.
        </div>
        <button
          onClick={() => { void api.invoke('shell:openExternal', {
            url: 'https://cvdesignr.com/fr/login?forbidden=1&to=%2Ffr%2Fcv-editor%2Fcv_y917reKKwOz5W3#download',
          }).catch((e) => setError(e instanceof Error ? e.message : 'Erreur')); }}
          style={{ background: '#0a84ff', color: '#fff', border: 'none', borderRadius: '8px',
            padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
        >
          🔗 Créer mon CV gratuitement sur CVDesignR →
        </button>
      </div>

      {/* Liste des CV */}
      {cvs.length === 0 ? (
        <p style={{ color: '#888' }}>Aucun CV pour le moment — ajoute-en un ci-dessus.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {cvs.map((cv) => {
            const analyzed = !!cv.parsed;
            return (
              <li key={cv.id} className="card" style={{
                borderLeft: `4px solid ${analyzed ? '#34c759' : cv.hasFile ? '#ff9f0a' : '#ccc'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  {/* Nom (édition inline) */}
                  {renamingId === cv.id ? (
                    <input
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(cv.id); if (e.key === 'Escape') setRenamingId(null); }}
                      onBlur={() => void saveRename(cv.id)}
                      style={{ fontSize: '15px', fontWeight: 600, minWidth: '200px' }}
                    />
                  ) : (
                    <strong style={{ fontSize: '15px' }}>{cv.name}</strong>
                  )}

                  {/* Badge état */}
                  <span style={{
                    fontSize: '11px', padding: '2px 8px', borderRadius: '12px',
                    background: analyzed ? 'rgba(52,199,89,0.15)' : cv.hasFile ? 'rgba(255,159,10,0.15)' : '#eee',
                    color: analyzed ? '#34c759' : cv.hasFile ? '#b8860b' : '#888',
                  }}>
                    {analyzed ? '✓ Analysé' : cv.hasFile ? 'Analyse en cours…' : 'Aucun PDF'}
                  </span>

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {/* Ouvrir le PDF dans une fenêtre de l'app */}
                    {cv.hasFile && (
                      <button
                        onClick={() => { void api.invoke('cv:openFile', { id: cv.id }).catch((e) => setError(e instanceof Error ? e.message : 'Erreur')); }}
                        style={{ fontSize: '12px', background: '#34c759', color: '#fff', border: 'none' }}
                      >
                        👁 Ouvrir
                      </button>
                    )}
                    <button onClick={() => importFile(cv.id)} disabled={busyId === cv.id} style={{ fontSize: '12px' }}>
                      {busyId === cv.id ? '…' : cv.hasFile ? 'Remplacer le PDF' : 'Importer le PDF'}
                    </button>
                    {/* Relance l'analyse si le PDF est là (échec IA, ou re-générer score/reco). */}
                    {cv.hasFile && (
                      <button
                        onClick={() => reanalyze(cv.id)}
                        disabled={busyId === cv.id}
                        title={analyzed ? 'Relancer l\'analyse (re-génère score et recommandations)' : 'Relancer l\'analyse IA (si elle a échoué)'}
                        style={{ fontSize: '12px', background: analyzed ? 'transparent' : '#ff9f0a',
                          color: analyzed ? '#555' : '#fff', border: analyzed ? '1px solid #ccc' : 'none' }}
                      >
                        ↻ {analyzed ? 'Ré-analyser' : 'Relancer l\'analyse'}
                      </button>
                    )}
                    <button
                      onClick={() => { setRenamingId(cv.id); setRenameValue(cv.name); }}
                      style={{ fontSize: '12px', background: 'transparent', border: '1px solid #ccc', color: '#555' }}
                    >
                      Renommer
                    </button>
                    <button
                      onClick={() => requestDelete(cv.id, cv.name)}
                      disabled={busyId === cv.id}
                      style={{ fontSize: '12px', background: '#ff453a', color: '#fff' }}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>

                {/* Compétences extraites */}
                {analyzed && cv.parsed && (
                  <p style={{ fontSize: '12px', color: '#666', margin: '8px 0 0' }}>
                    <strong>Compétences :</strong> {cv.parsed.skills.slice(0, 10).join(', ') || '—'}
                    {cv.parsed.skills.length > 10 ? '…' : ''}
                    {' · '}<strong>{cv.parsed.experiences.length}</strong> expérience(s)
                  </p>
                )}

                {/* CV-REVIEW : score qualité + recommandations.
                    Review IA si disponible, sinon calcul heuristique local (toujours présent). */}
                {analyzed && cv.parsed && (() => {
                  const review = cv.parsed.review ?? computeHeuristicReview(cv.parsed);
                  const s = review.score;
                  const color = s >= 75 ? '#34c759' : s >= 50 ? '#ff9f0a' : '#ff453a';
                  const isAi = !!cv.parsed.review;
                  return (
                    <div style={{ marginTop: '10px', padding: '10px 12px', background: '#f8f9fa', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600 }}>Score qualité :</span>
                        <span style={{ fontSize: '15px', fontWeight: 700, color }}>{s}/100</span>
                        <span style={{ flex: 1, height: '6px', background: '#e5e5ea', borderRadius: '3px', maxWidth: '160px' }}>
                          <span style={{ display: 'block', height: '100%', width: `${s}%`, background: color, borderRadius: '3px' }} />
                        </span>
                        <span style={{ fontSize: '10px', color: '#999' }}>
                          {isAi ? 'évalué par l\'IA' : 'estimation'}
                        </span>
                      </div>
                      {review.recommendations.length > 0 && (
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#555' }}>Recommandations :</span>
                          <ul style={{ margin: '4px 0 0', paddingLeft: '18px', fontSize: '12px', color: '#666', lineHeight: 1.5 }}>
                            {review.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </li>
            );
          })}
        </ul>
      )}

      {/* Modale de confirmation de suppression (in-app, remplace le dialog Windows). */}
      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '12px', padding: '22px 24px',
              maxWidth: '420px', width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: '17px' }}>🗑️ Supprimer ce CV ?</h3>
            <p style={{ fontSize: '14px', color: '#444', lineHeight: 1.5, margin: '0 0 14px' }}>
              <strong>{confirmDelete.name}</strong> sera supprimé définitivement.
              Les campagnes qui l'utilisaient n'auront plus de CV sélectionné.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px',
              color: '#555', marginBottom: '16px', cursor: 'pointer' }}>
              <input type="checkbox" checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                style={{ width: 'auto' }} />
              Ne plus me demander
            </label>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)}
                style={{ background: 'transparent', border: '1px solid #ccc', color: '#555',
                  borderRadius: '8px', padding: '8px 16px', cursor: 'pointer' }}>
                Annuler
              </button>
              <button onClick={() => void confirmDeleteNow()}
                style={{ background: '#ff453a', color: '#fff', border: 'none',
                  borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
      </div>{/* fin .cv-wrap */}
    </section>
  );
}
