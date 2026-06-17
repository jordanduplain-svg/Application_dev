import { useEffect, useMemo, useRef, useState } from 'react';
import type { LeadRow } from '@candio/shared';
import { api } from '../lib/api';
import { FR_REGIONS, FR_DEPTS_BY_REGION } from '../lib/geo';

// Index inverse de la géographie FR : code/nom de département → région admin.
// Permet de résoudre la région d'un lead même si le CSV n'a que le département.
const DEPT_CODE_TO_REGION: Record<string, string> = {};
const DEPT_NAME_TO_REGION: Record<string, string> = {};
for (const [region, depts] of Object.entries(FR_DEPTS_BY_REGION)) {
  for (const d of depts) {
    DEPT_CODE_TO_REGION[d.code] = region;
    DEPT_NAME_TO_REGION[d.name.toLowerCase()] = region;
  }
}

/** Région administrative d'un lead (regionAdmin, sinon résolue depuis le département). */
function leadRegion(l: LeadRow): string {
  if (l.regionAdmin && FR_REGIONS.includes(l.regionAdmin)) return l.regionAdmin;
  if (l.deptCode && DEPT_CODE_TO_REGION[l.deptCode]) return DEPT_CODE_TO_REGION[l.deptCode];
  if (l.deptName && DEPT_NAME_TO_REGION[l.deptName.toLowerCase()]) return DEPT_NAME_TO_REGION[l.deptName.toLowerCase()];
  return '';
}

/** Nom de département d'un lead (deptName, sinon résolu depuis le code). */
function leadDept(l: LeadRow): string {
  if (l.deptName) return l.deptName;
  if (l.deptCode) {
    for (const depts of Object.values(FR_DEPTS_BY_REGION)) {
      const m = depts.find((d) => d.code === l.deptCode);
      if (m) return m.name;
    }
  }
  return '';
}

/**
 * LEADS-VIEW : consultation des entreprises scrapées (master CSV).
 * Tri par colonne, filtres (secteur, ville, source, email présent), recherche,
 * sélection multiple et suppression (réécrit le CSV master).
 */
type SortKey = 'name' | 'sector' | 'city' | 'totalScore' | 'emailSource';

export default function LeadsPage({ onGoToScraping }: { onGoToScraping?: () => void }) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [fSector, setFSector] = useState('');
  // Filtres géographiques hiérarchiques (région → département → ville).
  const [fRegion, setFRegion] = useState('');
  const [fDept, setFDept] = useState('');
  const [fCity, setFCity] = useState('');
  const [fSource, setFSource] = useState('');
  const [onlyEmail, setOnlyEmail] = useState(false);
  // Qualité : ne montrer que les leads à domaine louche (homonyme à vérifier).
  const [onlySuspect, setOnlySuspect] = useState(false);
  // SECTOR-AUTO : clés des leads déjà présents dans une campagne (badge + teinte).
  const [usedKeys, setUsedKeys] = useState<Set<string>>(new Set());
  const [hideUsed, setHideUsed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('totalScore');
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState('');
  // SCRAPE-DESC : fiche IA affichée dans une modale (lecture par lead).
  const [viewLead, setViewLead] = useState<LeadRow | null>(null);
  // Confirmation inline avant de régénérer (écrase) toutes les fiches.
  const [confirmRegen, setConfirmRegen] = useState(false);
  // Confirmation inline + état avant d'effacer les fiches affichées.
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearingDesc, setClearingDesc] = useState(false);
  // Suggestion de modèle plus léger si l'IA a galéré (modèle trop lourd pour ce PC).
  const [modelSuggestion, setModelSuggestion] = useState('');
  const isMounted = useRef(true);

  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [list, used] = await Promise.all([
        api.invoke('scraping:listLeads'),
        api.invoke('scraping:listUsedLeadKeys').catch(() => [] as string[]),
      ]);
      if (isMounted.current) { setLeads(list); setUsedKeys(new Set(used)); setSelected(new Set()); }
    } catch (e) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Erreur de chargement');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  // Affiche la progression de l'enrichissement ET recharge la liste à la fin du run.
  // Recharger sur `done` est crucial : si on a quitté la page pendant le run, la
  // promesse d'invoke initiale est « perdue » (composant démonté) → c'est cet
  // écouteur (re-souscrit au retour) qui rafraîchit les leads une fois terminé.
  useEffect(() => {
    return api.on('scraping:progress', (data) => {
      if (!isMounted.current || !enriching) return;
      setEnrichMsg(data.line);
      if (data.done) {
        setEnriching(false);
        void load();
      }
    });
  }, [enriching]);

  // Reconnexion : si un enrichissement tourne déjà (page quittée puis rouverte),
  // on réaffiche l'état « en cours » → l'écouteur ci-dessus prend le relais.
  useEffect(() => {
    api.invoke('scraping:enrichStatus').then(({ running }) => {
      if (running && isMounted.current) {
        setEnriching(true);
        setEnrichMsg('⏳ Enrichissement en cours en arrière-plan… (lancé précédemment)');
      }
    }).catch(() => {});
  }, []);

  const sectors = useMemo(() => [...new Set(leads.map((l) => l.sector).filter(Boolean))].sort(), [leads]);
  const sources = useMemo(() => [...new Set(leads.map((l) => l.source).filter(Boolean))].sort(), [leads]);

  // Régions FR présentes dans les leads (résolues via la géographie).
  const regionsPresent = useMemo(() => {
    const set = new Set(leads.map(leadRegion).filter(Boolean));
    return FR_REGIONS.filter((r) => set.has(r));
  }, [leads]);

  // Départements de la région sélectionnée, présents dans les leads.
  const deptsPresent = useMemo(() => {
    if (!fRegion) return [];
    const present = new Set(leads.filter((l) => leadRegion(l) === fRegion).map((l) => leadDept(l)).filter(Boolean));
    return (FR_DEPTS_BY_REGION[fRegion] ?? []).filter((d) => present.has(d.name));
  }, [leads, fRegion]);

  // Villes présentes selon région/département sélectionnés.
  const citiesPresent = useMemo(() => {
    const pool = leads.filter((l) =>
      (!fRegion || leadRegion(l) === fRegion) && (!fDept || leadDept(l) === fDept));
    return [...new Set(pool.map((l) => l.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [leads, fRegion, fDept]);

  // Filtrage + tri.
  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = leads.filter((l) =>
      (!q || l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q) || l.contactName.toLowerCase().includes(q))
      && (!fSector || l.sector === fSector)
      && (!fRegion || leadRegion(l) === fRegion)
      && (!fDept || leadDept(l) === fDept)
      && (!fCity || l.city === fCity)
      && (!fSource || l.source === fSource)
      && (!onlyEmail || !!l.email)
      && (!onlySuspect || l.domainSuspect)
      && (!hideUsed || !usedKeys.has(l.key)));
    r = [...r].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'totalScore') cmp = a.totalScore - b.totalScore;
      else if (sortKey === 'city') cmp = (leadRegion(a) + a.city).localeCompare(leadRegion(b) + b.city, 'fr');
      else cmp = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), 'fr');
      return sortAsc ? cmp : -cmp;
    });
    return r;
  }, [leads, search, fSector, fRegion, fDept, fCity, fSource, onlyEmail, onlySuspect, hideUsed, usedKeys, sortKey, sortAsc]);

  // SECTOR-AUTO : nombre de leads déjà présents dans une campagne.
  const usedCount = useMemo(() => leads.filter((l) => usedKeys.has(l.key)).length, [leads, usedKeys]);

  // Nombre de leads à domaine louche (pour le filtre/compteur).
  const suspectCount = useMemo(() => leads.filter((l) => l.domainSuspect).length, [leads]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(k === 'name' || k === 'sector' || k === 'city'); }
  };
  const sortArrow = (k: SortKey) => sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : '';

  const allVisibleSelected = view.length > 0 && view.every((l) => selected.has(l.key));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allVisibleSelected) view.forEach((l) => next.delete(l.key));
    else view.forEach((l) => next.add(l.key));
    setSelected(next);
  };
  const toggleOne = (key: string) => {
    const next = new Set(selected);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelected(next);
  };

  // Nb de leads avec site mais sans description — cible de l'enrichissement.
  const missingDesc = useMemo(
    () => leads.filter((l) => l.website && !l.description).length, [leads]);
  // Nb de leads ayant déjà une fiche — cible de la régénération.
  const withDesc = useMemo(() => leads.filter((l) => !!l.description).length, [leads]);
  // Nb de fiches de plus de 7 jours (ou sans date) — cible de la mise à jour.
  const STALE_DAYS = 7;
  const ageDays = (iso: string): number | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return (Date.now() - t) / 86400000;
  };
  const staleCount = useMemo(
    () => leads.filter((l) => l.description && (ageDays(l.descriptionUpdatedAt) ?? Infinity) >= STALE_DAYS).length,
    [leads],
  );
  // Leads avec fiche générale dont les actualités datent de plus de 7 jours (ou jamais vérifiées).
  const staleNewsCount = useMemo(
    () => leads.filter((l) => l.description && (ageDays(l.newsUpdatedAt) ?? Infinity) >= STALE_DAYS).length,
    [leads],
  );
  // Sépare la fiche combinée en 2 notes : générale + actualités (au marqueur 📰).
  const splitFiche = (desc: string): { general: string; news: string } => {
    if (!desc) return { general: '', news: '' };
    const i = desc.indexOf('Actualités récentes');
    if (i === -1) return { general: desc.trim(), news: '' };
    const general = desc.slice(0, i).replace(/📰\s*$/, '').trim();
    const news = desc.slice(i + 'Actualités récentes'.length).replace(/^\s*:\s*/, '').trim();
    return { general, news };
  };
  // Libellé d'âge lisible pour une fiche.
  const fmtAge = (iso: string): string => {
    const d = ageDays(iso);
    if (d === null) return 'date inconnue';
    if (d < 1) return "aujourd'hui";
    const n = Math.floor(d);
    return n === 1 ? 'il y a 1 jour' : `il y a ${n} jours`;
  };

  const enrichDescriptions = async (opts: { force?: boolean; maxAgeDays?: number; newsOnly?: boolean; keys?: string[] } = {}) => {
    const { force = false, maxAgeDays, newsOnly = false, keys } = opts;
    setConfirmRegen(false);
    setModelSuggestion('');
    setEnriching(true);
    setEnrichMsg(keys ? `Enrichissement de ${keys.length} lead(s) affiché(s)…`
      : newsOnly ? `Mise à jour des actualités > ${maxAgeDays ?? 7}j…`
      : force ? 'Régénération…' : maxAgeDays ? `Mise à jour des fiches > ${maxAgeDays}j…` : 'Démarrage…');
    setError(null);
    try {
      const { enriched, iaCount, suggestion } = await api.invoke('scraping:enrichDescriptions', { force, maxAgeDays, newsOnly, keys });
      if (isMounted.current) {
        const noun = newsOnly ? 'actu(s)' : 'fiche(s)';
        setEnrichMsg(
          enriched === 0 ? `Aucune nouvelle ${noun} (déjà à jour ou rien trouvé).`
          : iaCount === 0 ? `⚠️ ${enriched} ${noun} en TEXTE BRUT — l'IA n'a pas répondu (Ollama lancé ?).`
          : iaCount === enriched ? `✅ ${enriched} ${noun} rédigée(s) par l'IA.`
          : `✅ ${enriched} ${noun} : ${iaCount} par l'IA, ${enriched - iaCount} en texte brut.`,
        );
        setModelSuggestion(suggestion || '');
      }
      await load();
    } catch (e) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Erreur lors de l\'enrichissement');
    } finally {
      if (isMounted.current) setEnriching(false);
    }
  };

  // Bascule vers le modèle plus léger suggéré (modèle actuel trop lourd pour ce PC).
  const switchToLighter = async () => {
    if (!modelSuggestion) return;
    try {
      await api.invoke('scraping:setDescribeModel', { model: modelSuggestion });
      if (isMounted.current) {
        setEnrichMsg(`✅ Modèle des descriptions changé pour ${modelSuggestion}. Relance « 🔄 Régénérer tout » pour réessayer.`);
        setModelSuggestion('');
      }
    } catch (e) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Impossible de changer de modèle');
    }
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      await api.invoke('scraping:deleteLeads', { keys: [...selected] });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la suppression');
    } finally {
      if (isMounted.current) setDeleting(false);
    }
  };

  // Efface les FICHES (descriptions) des leads actuellement affichés (filtrés), sans
  // supprimer les leads. Respecte les filtres : seuls les leads visibles sont vidés.
  const clearShownDescriptions = async () => {
    const keys = view.filter((l) => l.description).map((l) => l.key);
    if (keys.length === 0) { setConfirmClear(false); return; }
    setClearingDesc(true);
    setConfirmClear(false);
    setError(null);
    try {
      const { cleared } = await api.invoke('scraping:clearDescriptions', { keys });
      if (isMounted.current) setEnrichMsg(`🗑 ${cleared} fiche(s) effacée(s) parmi les leads affichés.`);
      await load();
    } catch (e) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Erreur lors de la suppression des fiches');
    } finally {
      if (isMounted.current) setClearingDesc(false);
    }
  };

  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #ddd',
    fontSize: '12px', color: '#555', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' };
  const td: React.CSSProperties = { padding: '5px 8px', borderBottom: '1px solid #eee', fontSize: '12.5px', verticalAlign: 'top' };
  const selStyle: React.CSSProperties = { padding: '6px 8px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '13px' };

  return (
    <section>
      <div className="page-head">
        <h2>Leads scrapés</h2>
        <div className="page-sub">{leads.length} entreprise(s) collectée(s) — enrichis les fiches IA, filtre, et importe dans une campagne.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <button onClick={() => void load()} className="btn-secondary" style={{ fontSize: '12px' }} disabled={enriching}>↻ Recharger</button>
        <button onClick={() => void enrichDescriptions({})} disabled={enriching || leads.length === 0}
          title="Rédige une fiche IA pour TOUTES les entreprises sans fiche (tout le master)"
          style={{ fontSize: '12px', background: '#0a84ff', color: '#fff', border: 'none',
            borderRadius: '6px', padding: '6px 12px', cursor: enriching ? 'default' : 'pointer' }}>
          {enriching ? '✨ En cours…' : `✨ Enrichir les manquantes${missingDesc > 0 ? ` (${missingDesc})` : ''}`}
        </button>
        {(() => {
          const missingShown = view.filter((l) => l.website && !l.description);
          if (missingShown.length === 0 || missingShown.length === missingDesc) return null;
          return (
            <button onClick={() => void enrichDescriptions({ keys: missingShown.map((l) => l.key) })} disabled={enriching}
              title="Rédige une fiche IA uniquement pour les leads AFFICHÉS (respecte les filtres) — rapide"
              style={{ fontSize: '12px', background: '#5856d6', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '6px 12px', cursor: enriching ? 'default' : 'pointer' }}>
              🎯 Enrichir les affichés ({missingShown.length})
            </button>
          );
        })()}
        {staleCount > 0 && (
          <button onClick={() => void enrichDescriptions({ maxAgeDays: STALE_DAYS })} disabled={enriching}
            title={`Régénère les fiches de plus de ${STALE_DAYS} jours (et les vides), sans toucher les récentes`}
            style={{ fontSize: '12px', background: '#fff', color: '#b35900', border: '1px solid #ffb84d',
              borderRadius: '6px', padding: '6px 12px', cursor: enriching ? 'default' : 'pointer' }}>
            🕒 Mettre à jour les fiches &gt; {STALE_DAYS}j ({staleCount})
          </button>
        )}
        {staleNewsCount > 0 && (
          <button onClick={() => void enrichDescriptions({ newsOnly: true, maxAgeDays: STALE_DAYS })} disabled={enriching}
            title={`Régénère UNIQUEMENT les actualités de plus de ${STALE_DAYS} jours (garde la fiche entreprise)`}
            style={{ fontSize: '12px', background: '#fff', color: '#b35900', border: '1px solid #b35900',
              borderRadius: '6px', padding: '6px 12px', cursor: enriching ? 'default' : 'pointer' }}>
            📰 Actus &gt; {STALE_DAYS}j ({staleNewsCount})
          </button>
        )}
        {withDesc > 0 && !confirmRegen && (
          <button onClick={() => setConfirmRegen(true)} disabled={enriching}
            title="Refait TOUTES les fiches existantes avec le prompt actuel (écrase les anciennes notes)"
            style={{ fontSize: '12px', background: '#fff', color: '#0a84ff', border: '1px solid #0a84ff',
              borderRadius: '6px', padding: '6px 12px', cursor: enriching ? 'default' : 'pointer' }}>
            🔄 Régénérer tout ({withDesc})
          </button>
        )}
        {confirmRegen && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span style={{ color: '#b35900' }}>Écraser les {withDesc} fiche(s) ?</span>
            <button onClick={() => void enrichDescriptions({ force: true })}
              style={{ fontSize: '12px', background: '#ff9500', color: '#fff', border: 'none',
                borderRadius: '6px', padding: '6px 10px', cursor: 'pointer' }}>
              Oui, régénérer
            </button>
            <button onClick={() => setConfirmRegen(false)}
              style={{ fontSize: '12px', padding: '6px 10px', borderRadius: '6px', border: '1px solid #ccc', cursor: 'pointer' }}>
              Annuler
            </button>
          </span>
        )}
        {onGoToScraping && (
          <button onClick={onGoToScraping} style={{ fontSize: '12px', marginLeft: 'auto' }}>
            ← Retour au scraping
          </button>
        )}
      </div>
      {enriching && (
        <p style={{ color: '#0a84ff', fontSize: '12.5px', margin: '4px 0 0', fontFamily: 'monospace' }}>
          {enrichMsg}
        </p>
      )}
      {!enriching && enrichMsg && (
        <p style={{ color: '#555', fontSize: '12.5px', margin: '4px 0 0' }}>{enrichMsg}</p>
      )}
      {modelSuggestion && (
        <div style={{ marginTop: '8px', padding: '10px 12px', borderRadius: '8px',
          background: '#fff7e6', border: '1px solid #ffd591', fontSize: '13px', color: '#7a4f00',
          display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span>⚠️ Le modèle de descriptions semble <strong>trop lourd pour ton PC</strong> (l'IA a basculé en texte brut). Passer à un modèle plus léger et rapide ?</span>
          <button onClick={() => void switchToLighter()}
            style={{ background: '#ff9500', color: '#fff', border: 'none', borderRadius: '6px',
              padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Passer à {modelSuggestion}
          </button>
          <button onClick={() => setModelSuggestion('')}
            style={{ background: 'transparent', border: '1px solid #d9a441', color: '#7a4f00',
              borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px' }}>
            Ignorer
          </button>
        </div>
      )}
      <p style={{ color: '#666', fontSize: '13px', margin: '6px 0 14px' }}>
        Toutes les entreprises collectées par le scraping (fichier master). Trie, filtre,
        et supprime celles qui ne t'intéressent pas.
      </p>

      {error && <p className="error">{error}</p>}

      {/* Barre de filtres */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
        <input placeholder="🔍 Rechercher (nom, email, contact)…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ ...selStyle, minWidth: '240px', flex: 1 }} />
        <select value={fSector} onChange={(e) => setFSector(e.target.value)} style={selStyle}>
          <option value="">Tous secteurs</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {/* Géo hiérarchique : Région → Département → Ville */}
        <select value={fRegion} onChange={(e) => { setFRegion(e.target.value); setFDept(''); setFCity(''); }} style={selStyle}>
          <option value="">Toutes régions</option>
          {regionsPresent.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={fDept} onChange={(e) => { setFDept(e.target.value); setFCity(''); }} style={selStyle} disabled={!fRegion}>
          <option value="">{fRegion ? 'Tous départements' : '— région d\'abord —'}</option>
          {deptsPresent.map((d) => <option key={d.code} value={d.name}>{d.code} — {d.name}</option>)}
        </select>
        <select value={fCity} onChange={(e) => setFCity(e.target.value)} style={selStyle}>
          <option value="">Toutes villes</option>
          {citiesPresent.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fSource} onChange={(e) => setFSource(e.target.value)} style={selStyle}>
          <option value="">Toutes sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ fontSize: '12px', color: '#555', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyEmail} onChange={(e) => setOnlyEmail(e.target.checked)} style={{ width: 'auto' }} />
          Avec email
        </label>
        {suspectCount > 0 && (
          <label style={{ fontSize: '12px', color: '#b8860b', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}
            title="Leads dont le domaine du site ne correspond pas au nom (homonyme probable à vérifier)">
            <input type="checkbox" checked={onlySuspect} onChange={(e) => setOnlySuspect(e.target.checked)} style={{ width: 'auto' }} />
            ⚠ Sites douteux ({suspectCount})
          </label>
        )}
        {usedCount > 0 && (
          <label style={{ fontSize: '12px', color: '#1a7a3a', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}
            title="Entreprises déjà présentes dans une campagne (déjà contactées ou prêtes à l'être) — exclues de l'import auto des nouvelles campagnes">
            <input type="checkbox" checked={hideUsed} onChange={(e) => setHideUsed(e.target.checked)} style={{ width: 'auto' }} />
            Masquer les déjà utilisées ({usedCount})
          </label>
        )}
      </div>

      {/* Barre d'action sélection */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px', minHeight: '30px' }}>
        <span style={{ fontSize: '13px', color: '#555' }}>
          {view.length} affiché(s){selected.size > 0 ? ` · ${selected.size} sélectionné(s)` : ''}
        </span>
        {selected.size > 0 && (
          <button onClick={() => void deleteSelected()} disabled={deleting}
            style={{ background: '#ff453a', color: '#fff', border: 'none', borderRadius: '6px',
              padding: '6px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
            {deleting ? 'Suppression…' : `🗑 Supprimer ${selected.size}`}
          </button>
        )}
        {/* Effacer les fiches des leads AFFICHÉS (respecte les filtres en cours). */}
        {(() => {
          const n = view.filter((l) => l.description).length;
          if (n === 0) return null;
          if (confirmClear) {
            return (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', marginLeft: 'auto' }}>
                <span style={{ color: '#b35900' }}>Effacer les {n} fiche(s) affichée(s) ?</span>
                <button onClick={() => void clearShownDescriptions()} disabled={clearingDesc}
                  style={{ fontSize: '12px', background: '#ff9500', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}>
                  {clearingDesc ? 'Suppression…' : 'Oui, effacer'}
                </button>
                <button onClick={() => setConfirmClear(false)}
                  style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #ccc', cursor: 'pointer' }}>
                  Annuler
                </button>
              </span>
            );
          }
          return (
            <button onClick={() => setConfirmClear(true)} disabled={enriching || clearingDesc}
              title="Efface les fiches (descriptions) des leads actuellement affichés — respecte les filtres. Les leads sont conservés."
              style={{ marginLeft: 'auto', fontSize: '12px', background: '#fff', color: '#ff453a',
                border: '1px solid #ff453a', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}>
              🗑 Supprimer les fiches affichées ({n})
            </button>
          );
        })()}
      </div>

      {loading ? (
        <p style={{ color: '#888' }}>Chargement…</p>
      ) : view.length === 0 ? (
        <p style={{ color: '#888' }}>
          Aucun lead {leads.length > 0 ? 'ne correspond aux filtres' : '— lance un scraping d\'abord'}.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, cursor: 'default' }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} style={{ width: 'auto' }} />
                </th>
                <th style={th} onClick={() => toggleSort('name')}>Entreprise{sortArrow('name')}</th>
                <th style={th}>Email</th>
                <th style={th} onClick={() => toggleSort('sector')}>Secteur{sortArrow('sector')}</th>
                <th style={th} onClick={() => toggleSort('city')}>Localisation{sortArrow('city')}</th>
                <th style={th} onClick={() => toggleSort('emailSource')}>Source email{sortArrow('emailSource')}</th>
                <th style={th} onClick={() => toggleSort('totalScore')}>Score{sortArrow('totalScore')}</th>
                <th style={{ ...th, cursor: 'default' }}>Fiche entreprise</th>
                <th style={{ ...th, cursor: 'default' }}>Fiche actualités</th>
              </tr>
            </thead>
            <tbody>
              {view.map((l) => {
                const used = usedKeys.has(l.key);
                return (
                <tr key={l.key} style={{
                  background: selected.has(l.key) ? 'rgba(255,69,58,0.06)' : used ? 'rgba(52,199,89,0.07)' : 'transparent',
                  borderLeft: used ? '3px solid #34c759' : '3px solid transparent',
                }}>
                  <td style={td}>
                    <input type="checkbox" checked={selected.has(l.key)} onChange={() => toggleOne(l.key)} style={{ width: 'auto' }} />
                  </td>
                  <td style={td}>
                    <strong>{l.name}</strong>
                    {used && (
                      <span title="Déjà présente dans une campagne — exclue de l'import automatique des nouvelles campagnes."
                        style={{ marginLeft: '6px', fontSize: '11px', color: '#1a7a3a', background: '#e7f9ed',
                          border: '1px solid #34c759', borderRadius: '10px', padding: '0 6px', whiteSpace: 'nowrap' }}>
                        ✓ utilisée
                      </span>
                    )}
                    {l.domainSuspect && (
                      <span title="Le domaine du site ne correspond pas au nom — homonyme probable, à vérifier avant d'enrichir/envoyer."
                        style={{ marginLeft: '6px', fontSize: '11px', color: '#b8860b', background: '#fff8e1',
                          border: '1px solid #f0c000', borderRadius: '10px', padding: '0 6px', whiteSpace: 'nowrap' }}>
                        ⚠ site douteux
                      </span>
                    )}
                    {l.website && <div style={{ fontSize: '11px', color: '#888' }}>{l.website.replace(/^https?:\/\//, '')}</div>}
                    {l.contactName && <div style={{ fontSize: '11px', color: '#888' }}>{l.contactName}{l.contactRole ? ` · ${l.contactRole}` : ''}</div>}
                  </td>
                  <td style={td}>{l.email || <span style={{ color: '#ff9500' }}>—</span>}</td>
                  <td style={td}>{l.sector || l.activityDomain || '—'}</td>
                  <td style={td}>
                    {l.city || leadDept(l) || '—'}
                    {(leadDept(l) || leadRegion(l)) && (
                      <div style={{ fontSize: '11px', color: '#888' }}>
                        {[leadDept(l), leadRegion(l)].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td style={td}><span style={{ fontSize: '11px', color: '#666' }}>{l.emailSource || '—'}</span></td>
                  <td style={td}><strong>{l.totalScore}</strong></td>
                  {(() => {
                    const { general, news } = splitFiche(l.description);
                    const d = ageDays(l.descriptionUpdatedAt);
                    const stale = (d ?? Infinity) >= STALE_DAYS;
                    return (
                      <>
                        {/* Colonne 1 : fiche entreprise (note générale) */}
                        <td style={td}>
                          {general ? (
                            <>
                              <button onClick={() => setViewLead(l)} title="Lire la fiche entreprise"
                                style={{ fontSize: '12px', padding: '3px 8px', borderRadius: '6px',
                                  border: '1px solid #0a84ff', background: '#fff', color: '#0a84ff', cursor: 'pointer' }}>
                                📄 Fiche
                              </button>
                              <div style={{ fontSize: '10.5px', color: stale ? '#b35900' : '#999', marginTop: '2px' }}
                                title={l.descriptionUpdatedAt || 'date inconnue'}>
                                {stale ? '⚠ ' : ''}{fmtAge(l.descriptionUpdatedAt)}
                              </div>
                            </>
                          ) : <span style={{ color: '#ccc', fontSize: '12px' }} title="Pas encore enrichie">—</span>}
                        </td>
                        {/* Colonne 2 : fiche actualités (note actu) */}
                        <td style={td}>
                          {news ? (() => {
                            const nd = ageDays(l.newsUpdatedAt);
                            const newsStale = (nd ?? Infinity) >= STALE_DAYS;
                            return (
                              <>
                                <button onClick={() => setViewLead(l)} title="Lire l'analyse des actualités"
                                  style={{ fontSize: '12px', padding: '3px 8px', borderRadius: '6px',
                                    border: '1px solid #b35900', background: '#fff', color: '#b35900', cursor: 'pointer' }}>
                                  📰 Actus
                                </button>
                                <div style={{ fontSize: '10.5px', color: newsStale ? '#b35900' : '#999', marginTop: '2px' }}
                                  title={l.newsUpdatedAt || 'date inconnue'}>
                                  {newsStale ? '⚠ ' : ''}{fmtAge(l.newsUpdatedAt)}
                                </div>
                              </>
                            );
                          })() : <span style={{ color: '#ccc', fontSize: '12px' }}
                                title={general ? 'Aucune actualité trouvée sur le site' : 'Pas encore enrichie'}>—</span>}
                        </td>
                      </>
                    );
                  })()}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* SCRAPE-DESC : modale de lecture de la fiche IA d'un lead. */}
      {viewLead && (
        <div
          onClick={() => setViewLead(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '12px', padding: '20px 24px', maxWidth: '640px',
              width: '100%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>{viewLead.name}</h3>
              {viewLead.website && (
                <a href="#" onClick={(e) => { e.preventDefault(); void api.invoke('shell:openExternal', { url: viewLead.website }); }}
                  style={{ fontSize: '12px', color: '#0a84ff' }}>
                  {viewLead.website.replace(/^https?:\/\//, '')} ↗
                </a>
              )}
            </div>
            <p style={{ fontSize: '11px', color: '#888', margin: '4px 0 12px' }}>
              Fiches d'analyse générées par l'IA (à partir du site) · personnalisent §2 (activité) et §3 (actu) des emails.
              {viewLead.descriptionUpdatedAt && <> · générées {fmtAge(viewLead.descriptionUpdatedAt)}</>}
            </p>
            {(() => {
              const { general, news } = splitFiche(viewLead.description);
              return (
                <>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#0a84ff', margin: '0 0 4px' }}>📄 Fiche entreprise</div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '13.5px', lineHeight: 1.55, color: '#222' }}>
                    {general || 'Pas de fiche pour ce lead.'}
                  </div>
                  {news && (
                    <>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#b35900', margin: '16px 0 4px' }}>📰 Fiche actualités</div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: '13.5px', lineHeight: 1.55, color: '#222' }}>{news}</div>
                    </>
                  )}
                </>
              );
            })()}
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button onClick={() => setViewLead(null)}
                style={{ padding: '7px 16px', borderRadius: '6px', border: 'none',
                  background: '#0a84ff', color: '#fff', cursor: 'pointer', fontSize: '13px' }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
