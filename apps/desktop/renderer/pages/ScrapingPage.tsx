/**
 * ScrapingPage — Interface de scraping d'entreprises.
 *
 * Permet de :
 * - Configurer le scraper (secteur, ville, sources, clé Hunter.io)
 * - Lancer / annuler le script Python en temps réel (log live)
 * - Visualiser le CSV généré et l'importer dans une campagne
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClipboardList, BarChart3, Play, Square, Loader2, Rocket,
  Briefcase, Layers, MapPin, Users, Radio, Hash, Clock, ArrowDownWideNarrow,
} from 'lucide-react';
import type { ScrapingConfig } from '@candio/shared';
import { api } from '../lib/api';
import { COUNTRIES, FR_DEPTS_BY_REGION, FR_REGIONS, FR_CITIES } from '../lib/geo';
import { INDUSTRY_GROUPS, INDUSTRY_CHOICES } from '../lib/sectors';
import { HelpNote } from '../components/Help';

// Sources de collecte : job boards (offres actives) vs annuaires (toutes entreprises).
const ALL_SOURCES = [
  // Webhook — parse les alertes emploi reçues par email (le plus fiable)
  { id: 'email_alerts', label: 'Alertes email 📬',      hint: 'Parse ta boîte mail (WTTJ, Indeed…)', type: 'jobboard' },
  // Job boards — uniquement les entreprises qui recrutent activement
  { id: 'wttj',         label: 'Welcome to the Jungle', hint: 'Tech / Data / Startups',              type: 'jobboard' },
  { id: 'apec',         label: 'APEC',                  hint: 'Cadres & ingénieurs',                 type: 'jobboard' },
  { id: 'indeed',       label: 'Indeed France',         hint: '⚠ Cloudflare — peu de résultats',     type: 'jobboard' },
  // Annuaires — toutes entreprises du secteur, même sans offre active
  { id: 'societe',      label: 'Registre SIRENE',       hint: 'Toutes entreprises FR 🇫🇷',           type: 'directory' },
];

// ── Géographie ────────────────────────────────────────────────────────────────
// COUNTRIES / FR_DEPTS_BY_REGION / FR_REGIONS / FR_CITIES sont importés de
// ../lib/geo (partagés avec CampaignsPage). La valeur envoyée au scraper reste
// `config.city` (string) : nom du département choisi, sinon nom de la région.

// Choix de nombre d'entreprises proposés dans la liste déroulante (plafonné à 600).
const MAX_CHOICES = [10, 25, 50, 100, 150, 200, 300, 400, 500, 600];
const maxLabel = (n: number) => `${n} entreprises`;

// Plafond de temps de crawl PAR entreprise (secondes). Plus haut = meilleure
// couverture email mais Phase 4 plus lente. 25 s = bon compromis par défaut.
const CRAWL_BUDGET_CHOICES = [
  { value: 12, label: '12 s — rapide' },
  { value: 25, label: '25 s — équilibré (défaut)' },
  { value: 45, label: '45 s — couverture +' },
  { value: 90, label: '90 s — maximal (lent)' },
];

// Nombre de pages lues par source par run. Plafonné à 5. Le curseur avance des
// pages réellement lues → rien n'est sauté entre les runs, même si le plafond
// per_code coupe la lecture avant la dernière page.
const PAGES_PER_RUN_CHOICES = [
  { value: 1, label: '1 page — très rapide (peu d\'entreprises)' },
  { value: 2, label: '2 pages — équilibré' },
  { value: 3, label: '3 pages — large' },
  { value: 4, label: '4 pages — très large' },
  { value: 5, label: '5 pages — large' },
  { value: 10, label: '10 pages — exhaustif (lent)' },
];
// Nombre maximum de secteurs d'activité sélectionnables simultanément.
const MAX_INDUSTRY_SELECTION = 3;

// Limite de temps globale du run (0 = illimité).
const MAX_RUNTIME_CHOICES = [
  { value: 0,   label: '⏱ Illimité (défaut)' },
  { value: 10,  label: '10 min' },
  { value: 20,  label: '20 min' },
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 h' },
  { value: 120, label: '2 h' },
];

// INDUSTRY_GROUPS / INDUSTRY_CHOICES : importés de ../lib/sectors (source unique,
// partagée avec le sélecteur de secteurs préférés des campagnes).

// Retrouve la région correspondant à la valeur `city` (nom de région OU nom de
// département présent dans une région). '' si saisie libre (ex. « Lyon »).
function regionOfCity(city: string): string {
  if (FR_REGIONS.includes(city)) return city;
  return FR_REGIONS.find((r) => FR_DEPTS_BY_REGION[r].some((d) => d.name === city)) || '';
}

export default function ScrapingPage({ onGoToLeads }: { onGoToLeads?: () => void }) {
  const [config, setConfig] = useState<ScrapingConfig | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [csvPath, setCsvPath] = useState<string | null>(null);
  const [linesCount, setLinesCount] = useState(0);
  // Voyant de santé : résultat de la dernière exécution (persisté entre sessions).
  const [lastRun, setLastRun] = useState<{ at: string; ok: boolean; count: number; error: string | null } | null>(null);
  // Chemins master persistants (disponibles même sans run dans la session courante).
  const [masterPaths, setMasterPaths] = useState<{ csvPath: string | null; htmlPath: string | null } | null>(null);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  // Réinitialisation des curseurs de pagination des sources.
  const [resettingPagination, setResettingPagination] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const isMounted = useRef(true);
  // Dropdown secteurs d'activité — ouverture/fermeture.
  const [sectorOpen, setSectorOpen] = useState(false);
  const sectorRef = useRef<HTMLDivElement | null>(null);
  // Détecté dans le log : le modèle Ollama de crawl est trop lourd → proposer un switch.
  const [crawlModelHeavy, setCrawlModelHeavy] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);

  // ── Chargement initial ──────────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    const load = async () => {
      const [cfg, status, master] = await Promise.all([
        api.invoke('scraping:getConfig'),
        api.invoke('scraping:getStatus'),
        api.invoke('scraping:getMasterPaths'),
      ]);
      if (!isMounted.current) return;
      setMasterPaths(master);
      setLastRun(status.lastRun);
      // Source LinkedIn+SMTP retirée : on la purge des configs déjà enregistrées
      // (sinon elle resterait active côté scraper pour qui l'avait cochée).
      const hadLinkedin = (cfg.emailSources ?? []).includes('linkedin');
      const cleaned = hadLinkedin
        ? { ...cfg, emailSources: (cfg.emailSources ?? []).filter((s) => s !== 'linkedin') }
        : cfg;
      setConfig(cleaned);
      if (hadLinkedin) void api.invoke('scraping:saveConfig', cleaned).catch(() => {});
      if (status.status === 'running') {
        setRunning(true);
      }
      if (status.csvPath) {
        setCsvPath(status.csvPath);
        setLinesCount(status.linesCount);
      }
      // SCRAPE-06 : vérifier si un checkpoint du jour existe pour ce sector+city.
      const hasCheckpoint = await api.invoke('scraping:checkpointExists', {
        sector: cfg.sector,
        city:   cfg.city,
      }).catch(() => false);
      if (isMounted.current) setResumeAvailable(hasCheckpoint);
    };
    void load();
    return () => { isMounted.current = false; };
  }, []);

  // ── Écoute des événements de progression ───────────────────────────────────
  useEffect(() => {
    return api.on('scraping:progress', (data) => {
      setLog((prev) => [...prev, data.line]);
      // Modèle de crawl trop lourd/lent → on propose un modèle plus léger.
      if (data.line && /trop lourd|LLM (?:de crawl )?désactivé/i.test(data.line)) {
        setCrawlModelHeavy(true);
      }
      if (data.done) {
        setRunning(false);
        if (data.csvPath) {
          setCsvPath(data.csvPath);
          // Le checkpoint est effacé par le script Python après succès.
          setResumeAvailable(false);
          // Recharger le status + master paths après complétion.
          api.invoke('scraping:getStatus').then((s) => {
            if (isMounted.current) setLinesCount(s.linesCount);
          }).catch(() => {});
          api.invoke('scraping:getMasterPaths').then((m) => {
            if (isMounted.current) setMasterPaths(m);
          }).catch(() => {});
        }
      }
    });
  }, []);

  // ── Re-vérification checkpoint quand sector ou city changent ─────────────
  useEffect(() => {
    if (!config) return;
    api.invoke('scraping:checkpointExists', { sector: config.sector, city: config.city })
      .then((exists) => { if (isMounted.current) setResumeAvailable(exists); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.sector, config?.city]);

  // Ferme le dropdown secteurs au clic en dehors.
  useEffect(() => {
    if (!sectorOpen) return;
    const handler = (e: MouseEvent) => {
      if (sectorRef.current && !sectorRef.current.contains(e.target as Node)) {
        setSectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sectorOpen]);

  // ── Auto-scroll du log ─────────────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  // ── Actions ────────────────────────────────────────────────────────────────

  // Bascule le modèle de crawl vers un modèle plus léger (Ollama trop lent).
  const switchToLighterCrawlModel = useCallback(async () => {
    if (!config) return;
    const next = { ...config, ollamaModel: 'qwen2.5:3b' };
    setSwitchingModel(true);
    try {
      setConfig(next);
      await api.invoke('scraping:saveConfig', next);
      setCrawlModelHeavy(false);
      setLog((prev) => [...prev, 'ℹ️  Modèle de crawl basculé sur qwen2.5:3b (plus léger). Relance le scraping pour réessayer.']);
    } finally {
      if (isMounted.current) setSwitchingModel(false);
    }
  }, [config]);

  const launch = useCallback(async () => {
    if (!config) return;
    setLog([]);
    setCrawlModelHeavy(false);
    setCsvPath(null);
    setLinesCount(0);
    setRunning(true);
    try {
      await api.invoke('scraping:launch', config);
      await api.invoke('scraping:saveConfig', config);
    } catch (e) {
      setLog((prev) => [...prev, `❌ Erreur : ${e instanceof Error ? e.message : String(e)}`]);
      setRunning(false);
    }
  }, [config]);

  // SCRAPE-06 : reprendre depuis le checkpoint sauvegardé.
  const resume = useCallback(async () => {
    if (!config) return;
    setLog([]);
    setCsvPath(null);
    setLinesCount(0);
    setRunning(true);
    setResumeAvailable(false);
    try {
      await api.invoke('scraping:resume', config);
      await api.invoke('scraping:saveConfig', config);
    } catch (e) {
      setLog((prev) => [...prev, `❌ Erreur : ${e instanceof Error ? e.message : String(e)}`]);
      setRunning(false);
    }
  }, [config]);

  const cancel = useCallback(async () => {
    await api.invoke('scraping:cancel').catch(() => {});
    setRunning(false);
  }, []);

  // Mise à jour du master CSV : re-enrichit le candio_leads.csv existant pour combler
  // les emails manquants + backfill localisation/secteur. À lancer régulièrement.
  const updateMaster = useCallback(async () => {
    if (!config) return;
    const master = masterPaths?.csvPath || (await api.invoke('scraping:getMasterPaths')).csvPath;
    if (!master) {
      setLog(['⚠ Aucun CSV master trouvé. Lance d\'abord un scraping pour en créer un.']);
      return;
    }
    setLog([]);
    setCsvPath(null);
    setLinesCount(0);
    setRunning(true);
    try {
      await api.invoke('scraping:enrichCsv', { csvPath: master, config });
      await api.invoke('scraping:saveConfig', config);
    } catch (e) {
      setLog((prev) => [...prev, `❌ Erreur : ${e instanceof Error ? e.message : String(e)}`]);
      setRunning(false);
    }
  }, [config, masterPaths]);

  // Réinitialise les curseurs de pagination des sources → recherches dès la page 1.
  const resetPagination = useCallback(async () => {
    setResettingPagination(true);
    try {
      const { cleared } = await api.invoke('scraping:resetPagination');
      setLog((prev) => [
        ...prev,
        cleared > 0
          ? `✅ Pagination réinitialisée — ${cleared} curseur(s) effacé(s). Les recherches repartent de la page 1.`
          : `ℹ Aucun curseur de pagination à réinitialiser (déjà à zéro).`,
      ]);
    } catch (e) {
      setLog((prev) => [...prev, `❌ Erreur : ${e instanceof Error ? e.message : String(e)}`]);
    }
    if (isMounted.current) setResettingPagination(false);
  }, []);

  if (!config) {
    return <div style={{ padding: '24px' }}>Chargement…</div>;
  }

  const toggleSource = (id: string) => {
    const src = config.sources.includes(id)
      ? config.sources.filter((s) => s !== id)
      : [...config.sources, id];
    setConfig({ ...config, sources: src });
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1180px' }}>
      <div className="page-head" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <h2>Scraping d'entreprises</h2>
          <div className="page-sub">
            Lance le script Python <code>scrape_leads.py</code> directement depuis l'app.
            Le CSV généré peut être importé dans n'importe quelle campagne.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {/* Accès à la page de consultation des leads scrapés. */}
          <button onClick={() => onGoToLeads?.()}>
            <ClipboardList size={15} />Mes leads scrapés
          </button>
          {/* Rapport HTML du scraper (listing des leads collectés, candio_leads.html). */}
          <button
            className="btn-secondary"
            onClick={async () => {
              const m = masterPaths ?? await api.invoke('scraping:getMasterPaths');
              if (m?.htmlPath) await api.invoke('shell:open', m.htmlPath).catch(() => {});
            }}
            disabled={!masterPaths?.htmlPath}
            title={masterPaths?.htmlPath ? 'Ouvre le rapport HTML du scraping (liste des leads collectés)' : 'Lance un scraping pour générer le rapport'}>
            <BarChart3 size={15} />Rapport de scraping
          </button>
        </div>
      </div>

      {/* Voyant de santé : dernière exécution du scraper (persisté entre sessions). */}
      {lastRun && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-4)', fontSize: '13px', color: 'var(--text-muted, #888)' }}>
          <span>{lastRun.ok ? '🟢' : '🔴'}</span>
          <span>
            Dernier scraping&nbsp;: {new Date(lastRun.at).toLocaleString('fr-FR')}
            {lastRun.ok
              ? ` — ${lastRun.count} entreprise${lastRun.count > 1 ? 's' : ''}`
              : ` — échec${lastRun.error ? ` (${lastRun.error})` : ''}`}
          </span>
        </div>
      )}

      {/* ── Configuration (cartes titrées numérotées pour une hiérarchie claire) ── */}
      <section style={{ marginBottom: '28px' }}>

        {/* Ligne 1 : ① Recherche (gauche) + ② Sources (droite), côte à côte */}
        <div className="scrape-cols">

        {/* ① Recherche */}
        <div style={cardStyle('#2b8aff')}>
        <SectionHeader n={1} title="Recherche" subtitle="Le poste ciblé, la zone géographique et le volume" accent="#2b8aff" />
        <HelpNote summary="💡 Comment remplir cette section ?" accent="#2b8aff">
          <p style={{ margin: '0 0 6px' }}>Tu dis <strong>QUOI</strong> et <strong>OÙ</strong> chercher :</p>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            <li><strong>Poste ciblé</strong> : le métier visé (ex. « data analyst »). Sert à filtrer les offres et à personnaliser les lettres.</li>
            <li><strong>Zone</strong> : région, département ou ville. Plus c’est large, plus il y a de résultats.</li>
            <li><strong>Volume max</strong> : combien d’entreprises au maximum. Commence petit (50) pour tester — un gros volume prend du temps.</li>
          </ul>
        </HelpNote>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', alignItems: 'start' }}>
          <div style={subGroupStyle}>🎯 Cible</div>
          <label>
            <span style={labelStyle}>
              Poste ciblé{' '}
              <span style={{ fontWeight: 400, color: '#888' }}>(job boards : WTTJ, Indeed, APEC…)</span>
            </span>
            <input
              value={config.sector}
              onChange={(e) => setConfig({ ...config, sector: e.target.value })}
              placeholder="data analyst, finance, marketing…"
              style={inputStyle}
            />
          </label>
          <label>
            <span style={labelStyle}>Taille d'entreprise visée <span style={{ fontWeight: 400, color: '#888' }}>(annuaire SIRENE)</span></span>
            <select
              value={config.sizeTarget ?? 'all'}
              onChange={(e) => setConfig({ ...config, sizeTarget: e.target.value as NonNullable<typeof config.sizeTarget> })}
              style={inputStyle}
            >
              <option value="all">Toutes tailles</option>
              <option value="pme">TPE/PME (0–250 salariés) — + d'emails publics</option>
              <option value="eti">ETI (250–5000)</option>
              <option value="grand">Grand groupe (5000+)</option>
            </select>
            <span style={{ fontSize: '11px', color: '#888' }}>
              Les PME publient bien plus souvent un email réel ; les grands groupes n'ont que des formulaires.
            </span>
          </label>
          {/* Secteur d'activité — menu déroulant multi-sélection (filtre NAF SIRENE). */}
          <div ref={sectorRef} style={{ position: 'relative', zIndex: 20, gridColumn: '1 / -1' }}>
            <span style={labelStyle}>
              Secteur d'activité des entreprises cibles{' '}
              <span style={{ fontWeight: 400, color: '#888' }}>(filtre SIRENE par code NAF)</span>
            </span>
            <p style={{ fontSize: '11px', color: '#888', margin: '2px 0 6px' }}>
              Vide = même secteur que le poste ciblé (ex: "data analyst" → IT uniquement).
            </p>

            {/* Bouton déclencheur */}
            {(() => {
              const sel = (config.industry ?? '').split(',').map((s) => s.trim()).filter(Boolean);
              const label = sel.length === 0
                ? 'Auto (même que le poste ciblé)'
                : sel.length === 1
                  ? (INDUSTRY_CHOICES.find((c) => c.value === sel[0])?.label ?? sel[0])
                  : `${sel.length} secteurs sélectionnés`;
              return (
                <button
                  type="button"
                  onClick={() => setSectorOpen((v) => !v)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 10px',
                    border: '1px solid', borderColor: sel.length ? '#007aff' : '#d1d1d6',
                    borderRadius: '6px', background: '#fff', cursor: 'pointer',
                    fontSize: '13px', color: sel.length ? '#007aff' : '#555',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontWeight: sel.length ? 600 : 400,
                  }}
                >
                  <span>{label}</span>
                  <span style={{ fontSize: '10px', color: '#888', marginLeft: '8px' }}>
                    {sectorOpen ? '▲' : '▼'}
                  </span>
                </button>
              );
            })()}

            {/* Panneau déroulant */}
            {sectorOpen && (() => {
              const sel = (config.industry ?? '').split(',').map((s) => s.trim()).filter(Boolean);
              const atMax = sel.length >= MAX_INDUSTRY_SELECTION;
              const toggle = (value: string) => {
                const isSel = sel.includes(value);
                // Bloque l'ajout d'un 3e secteur (limite anti-explosion de la collecte).
                if (!isSel && atMax) return;
                const next = isSel ? sel.filter((v) => v !== value) : [...sel, value];
                setConfig({ ...config, industry: next.join(',') });
              };
              return (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: '#fff', border: '1px solid #d1d1d6', borderRadius: '8px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  maxHeight: '320px', overflowY: 'auto',
                  padding: '6px 0',
                }}>
                  {/* En-tête : compteur + effacer */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '4px 12px 8px', borderBottom: '1px solid #f0f0f0',
                  }}>
                    <span style={{ fontSize: '11px', color: atMax ? '#ff9500' : '#888' }}>
                      {sel.length}/{MAX_INDUSTRY_SELECTION} secteur(s){atMax ? ' — maximum atteint' : ''}
                    </span>
                    {sel.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setConfig({ ...config, industry: '' })}
                        style={{
                          fontSize: '11px', color: '#ff453a', background: 'none',
                          border: 'none', cursor: 'pointer', padding: 0,
                        }}
                      >
                        ✕ Effacer
                      </button>
                    )}
                  </div>

                  {/* Groupes + cases à cocher */}
                  {INDUSTRY_GROUPS.map((group) => (
                    <div key={group.group}>
                      <div style={{
                        padding: '6px 12px 2px', fontSize: '11px',
                        fontWeight: 700, color: '#888', textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>
                        {group.group}
                      </div>
                      {group.items.map((item) => {
                        const checked = sel.includes(item.value);
                        const disabled = !checked && atMax;  // 3e choix bloqué
                        return (
                          <label
                            key={item.value}
                            title={disabled ? `Maximum ${MAX_INDUSTRY_SELECTION} secteurs — décochez-en un d'abord` : ''}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '8px',
                              padding: '5px 14px', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '13px',
                              background: checked ? 'rgba(0,122,255,0.06)' : 'transparent',
                              color: disabled ? '#c5c5cc' : (checked ? '#007aff' : '#1d1d1f'),
                              fontWeight: checked ? 600 : 400,
                              opacity: disabled ? 0.55 : 1,
                            }}
                            onMouseEnter={(e) => { if (!checked && !disabled) (e.currentTarget as HTMLLabelElement).style.background = '#f5f5f7'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLLabelElement).style.background = checked ? 'rgba(0,122,255,0.06)' : 'transparent'; }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggle(item.value)}
                              style={{ accentColor: '#007aff', width: '14px', height: '14px' }}
                            />
                            {item.label}
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div style={subGroupStyle}>📍 Localisation</div>
          {/* Localisation : Pays → Région → Département (listes déroulantes).
              La valeur envoyée reste config.city (nom de dépt, sinon de région). */}
          <label>
            <span style={labelStyle}>Pays</span>
            <select
              value="France"
              onChange={() => { /* France uniquement pour l'instant */ }}
              style={inputStyle}
            >
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            <span style={labelStyle}>Région</span>
            <select
              value={regionOfCity(config.city)}
              onChange={(e) => setConfig({ ...config, city: e.target.value })}
              style={inputStyle}
            >
              <option value="">— Toute la France —</option>
              {FR_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {regionOfCity(config.city) && (
            <label>
              <span style={labelStyle}>Département (optionnel)</span>
              <select
                value={FR_DEPTS_BY_REGION[regionOfCity(config.city)]
                  .find((d) => d.name === config.city)?.code || ''}
                onChange={(e) => {
                  const region = regionOfCity(config.city);
                  const dept = FR_DEPTS_BY_REGION[region].find((d) => d.code === e.target.value);
                  // Dépt choisi → city = nom du dépt ; sinon → toute la région.
                  setConfig({ ...config, city: dept ? dept.name : region });
                }}
                style={inputStyle}
              >
                <option value="">— Toute la région —</option>
                {FR_DEPTS_BY_REGION[regionOfCity(config.city)].map((d) => (
                  <option key={d.code} value={d.code}>{d.code} — {d.name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span style={labelStyle}>… ou ville précise</span>
            <select
              value={regionOfCity(config.city) ? '' : config.city}
              onChange={(e) => setConfig({ ...config, city: e.target.value })}
              style={inputStyle}
            >
              <option value="">— (utiliser la région / le département) —</option>
              {FR_CITIES.slice().sort((a, b) => a.localeCompare(b, 'fr')).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              {/* Ville déjà saisie hors liste : on l'affiche pour ne pas la perdre */}
              {config.city && !regionOfCity(config.city) && !FR_CITIES.includes(config.city) && (
                <option value={config.city}>{config.city}</option>
              )}
            </select>
          </label>
          <div style={subGroupStyle}>⚙️ Volume &amp; limites de collecte</div>
          <label>
            <span style={labelStyle}>Nombre max d'entreprises</span>
            <select
              value={MAX_CHOICES.includes(config.max) ? String(config.max) : 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') setConfig({ ...config, max: Number(e.target.value) });
              }}
              style={inputStyle}
            >
              {MAX_CHOICES.map((n) => <option key={n} value={n}>{maxLabel(n)}</option>)}
              {!MAX_CHOICES.includes(config.max) && (
                <option value="custom">{config.max} (perso.)</option>
              )}
            </select>
          </label>
          <label>
            <span style={labelStyle}>Budget crawl / entreprise</span>
            <select
              value={String(config.crawlBudgetSec ?? 25)}
              onChange={(e) => setConfig({ ...config, crawlBudgetSec: Number(e.target.value) })}
              style={inputStyle}
            >
              {CRAWL_BUDGET_CHOICES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              {!CRAWL_BUDGET_CHOICES.some((o) => o.value === (config.crawlBudgetSec ?? 25)) && (
                <option value={config.crawlBudgetSec}>{config.crawlBudgetSec} s (perso.)</option>
              )}
            </select>
            <span style={{ fontSize: '11px', color: '#888' }}>
              Plafond de temps de crawl par entreprise en Phase 4. Plus haut = plus d'emails trouvés, mais plus lent.
            </span>
          </label>

          {/* Pages par run — contrôle PAGES_PER_RUN passé au scraper Python. */}
          <label>
            <span style={labelStyle}>Pages lues par source / run</span>
            <select
              value={config.pagesPerRun ?? 2}
              onChange={(e) => setConfig({ ...config, pagesPerRun: Number(e.target.value) })}
              style={inputStyle}
            >
              {PAGES_PER_RUN_CHOICES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span style={{ fontSize: '11px', color: '#888' }}>
              SIRENE : 25 résultats / page / code NAF. 5 pages = jusqu'à 125 résultats / code NAF.
              La case « Pages suivantes des sources » fait avancer le curseur entre les runs pour toujours découvrir de nouvelles entreprises.
            </span>
          </label>

          {/* Limite de temps globale du run */}
          <label>
            <span style={labelStyle}>Limite de temps du run</span>
            <select
              value={config.maxRuntimeMin ?? 0}
              onChange={(e) => setConfig({ ...config, maxRuntimeMin: Number(e.target.value) })}
              style={inputStyle}
            >
              {MAX_RUNTIME_CHOICES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span style={{ fontSize: '11px', color: '#888' }}>
              Le scraper s'arrête proprement et exporte ce qu'il a collecté. « Illimité » = tourne jusqu'à la fin.
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer',
            padding: '8px', background: '#fafafa', borderRadius: '8px', border: '1px solid #e6e6eb' }}>
            <input
              type="checkbox"
              checked={config.exploreNewPages ?? false}
              onChange={(e) => setConfig({ ...config, exploreNewPages: e.target.checked })}
              style={{ marginTop: '2px' }}
            />
            <span>
              <strong style={{ fontSize: '13px', display: 'block' }}>🔄 Explorer de nouvelles pages (sites)</strong>
              <span style={{ fontSize: '11px', color: '#888' }}>
                Re-visite les entreprises déjà vues SANS email, sur des pages non encore explorées
                de leur SITE → plus d'adresses sur les boîtes connues. Un peu plus lent.
              </span>
            </span>
          </label>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px',
            padding: '8px', background: '#f0fdf4', borderRadius: '8px',
            border: '1px solid #34c75944',
          }}>
            <span style={{ fontSize: '16px', flexShrink: 0 }}>✅</span>
            <span>
              <strong style={{ fontSize: '13px', display: 'block', color: '#166534' }}>
                Pagination automatique — toujours active
              </strong>
              <span style={{ fontSize: '11px', color: '#166534' }}>
                Chaque run reprend automatiquement aux pages suivantes de SIRENE / APEC / WTTJ / Indeed.
                Utilise « Réinitialiser la pagination » pour repartir de la page 1.
              </span>
            </span>
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer',
            padding: '8px', borderRadius: '8px', border: '1px solid',
            borderColor: config.llmProvider ? '#5856d6' : '#e6e6eb',
            background: config.llmProvider ? '#f5f4ff' : '#fafafa' }}>
            <input
              type="checkbox"
              checked={!!config.llmProvider}
              onChange={(e) => setConfig({ ...config, llmProvider: e.target.checked ? (config.llmProvider || 'ollama') : '' })}
              style={{ marginTop: '2px' }}
            />
            <span>
              <strong style={{ fontSize: '13px', display: 'block' }}>
                🤖 Assistant IA (LLM){config.llmProvider ? ` — ${config.llmProvider}` : ''}
              </strong>
              <span style={{ fontSize: '11px', color: '#888', display: 'block' }}>
                Aide à extraire l'email/le recruteur quand le crawl échoue.
              </span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                marginTop: '4px', fontSize: '11px', fontWeight: 500,
                color: '#ff6b2b', background: '#fff4ee',
                border: '1px solid #ff6b2b44', borderRadius: '5px', padding: '2px 7px',
              }}>
                ⚠ GPU requis — RTX 3060 ou supérieure recommandée (trop lent sur CPU)
              </span>
            </span>
          </label>
          <label>
            <span style={labelStyle}>
              Clé Hunter.io{' '}
              <a href="https://hunter.io" target="_blank" rel="noreferrer"
                style={{ fontSize: '11px', color: '#007aff' }}>
                (50 crédits/mois en gratuit)
              </a>
            </span>
            <input
              type="password"
              value={config.hunterKey}
              onChange={(e) => setConfig({ ...config, hunterKey: e.target.value })}
              placeholder="Laisser vide pour pattern fallback"
              style={inputStyle}
            />
            {/* Activation Hunter — co-localisée avec la clé (source unique de vérité :
                emailSources 'hunter'). L'ancienne case du menu « Emails » a été retirée. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px',
              cursor: 'pointer', fontSize: '12.5px' }}>
              <input
                type="checkbox"
                checked={(config.emailSources ?? []).includes('hunter')}
                onChange={(e) => {
                  const cur = config.emailSources ?? [];
                  setConfig({ ...config, emailSources: e.target.checked
                    ? [...cur, 'hunter'] : cur.filter((s) => s !== 'hunter') });
                }}
              />
              <span>Utiliser Hunter.io pour l'enrichissement des emails</span>
              <InfoTip text="Interroge Hunter.io pour les emails déjà connus sur le domaine de l'entreprise. Si aucun site n'est encore connu, Hunter essaie d'abord de deviner le domaine à partir du nom. Nécessite une clé ci-dessus. Le plafond ci-dessous protège ton quota." />
            </label>
          </label>
          <label>
            <span style={labelStyle}>
              Plafond recherches Hunter / run
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={config.hunterMaxSearches ?? 20}
              onChange={(e) => setConfig({
                ...config,
                hunterMaxSearches: Math.max(0, Math.floor(Number(e.target.value) || 0)),
              })}
              style={inputStyle}
            />
            <span style={{ fontSize: '11px', color: '#888', display: 'block', marginTop: '2px' }}>
              Limite le nombre d'appels Hunter par scraping (protège ton quota mensuel).
              Le quota réel restant est lu automatiquement et jamais dépassé.
              Augmente cette valeur si tu as un plan payant. 0 = ne pas utiliser Hunter.
            </span>
          </label>
        </div>
        </div>{/* fin ① Recherche */}

        {/* Colonne droite : ② Sources + cockpit de lancement (rail collant) */}
        <div className="scrape-rail">
        {/* ② Sources de collecte */}
        <div style={cardStyle('#1aa179')}>
          <SectionHeader n={2} title="Sources de collecte" subtitle="Où aller chercher les entreprises" accent="#1aa179" />
          <HelpNote summary="💡 Quelles sources choisir ? (important)" accent="#1aa179">
            <p style={{ margin: '0 0 6px' }}>Deux familles, très différentes :</p>
            <ul style={{ margin: '0 0 6px', paddingLeft: '18px' }}>
              <li><strong>Job boards</strong> (Welcome to the Jungle, APEC, Indeed) : entreprises qui <strong>recrutent activement</strong>, avec un site web → beaucoup d’emails trouvés et des leads pertinents.</li>
              <li><strong>Registre SIRENE</strong> (Société.com) : <strong>toutes</strong> les entreprises françaises, mais la plupart sans site ni email (artisans, micro-boîtes) → beaucoup de « aucun email ».</li>
            </ul>
            <p style={{ margin: 0 }}>👉 <strong>Débutant : coche les job boards.</strong> Garde SIRENE en complément seulement si tu veux du volume brut.</p>
          </HelpNote>

          {/* Job boards */}
          <p style={{ fontSize: '11px', color: '#888', margin: '6px 0 4px' }}>
            📋 <strong>Job boards</strong> — uniquement les entreprises qui recrutent activement
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
            {ALL_SOURCES.filter((s) => s.type === 'jobboard').map((s) => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
                background: config.sources.includes(s.id) ? '#007aff' : '#e8e8ed',
                color: config.sources.includes(s.id) ? '#fff' : '#333',
                fontSize: '13px',
              }}>
                <input type="checkbox" checked={config.sources.includes(s.id)}
                  onChange={() => toggleSource(s.id)} style={{ display: 'none' }} />
                <strong>{s.label}</strong>
                <span style={{ opacity: 0.75, fontSize: '11px' }}>{s.hint}</span>
              </label>
            ))}
          </div>

          {/* Annuaires */}
          <p style={{ fontSize: '11px', color: '#888', margin: '4px 0' }}>
            🏢 <strong>Annuaires</strong> — toutes les entreprises du secteur, même sans offre active
            <span style={{ color: '#34c759', marginLeft: '6px' }}>← idéal pour candidatures spontanées</span>
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {ALL_SOURCES.filter((s) => s.type === 'directory').map((s) => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
                background: config.sources.includes(s.id) ? '#34c759' : '#e8e8ed',
                color: config.sources.includes(s.id) ? '#fff' : '#333',
                fontSize: '13px',
              }}>
                <input type="checkbox" checked={config.sources.includes(s.id)}
                  onChange={() => toggleSource(s.id)} style={{ display: 'none' }} />
                <strong>{s.label}</strong>
                <span style={{ opacity: 0.75, fontSize: '11px' }}>{s.hint}</span>
              </label>
            ))}
          </div>
        </div>{/* fin ② Sources */}

        {/* Cockpit — résume la config ET lance le scraping (rail de pilotage). */}
        <div className="cockpit">
          <h4><span className="rocket-chip"><Rocket size={16} /></span>Prêt à lancer</h4>
          <ul className="cockpit-recap">
            <li><span className="ico"><Briefcase size={15} color="#a78bfa" /></span><span className="k">Poste</span><span className="v">{config.sector || '—'}</span></li>
            <li><span className="ico"><Layers size={15} color="#60a5fa" /></span><span className="k">Secteurs</span><span className={`v${(config.industry ?? '').trim() ? '' : ' muted'}`}>{
              (config.industry ?? '').trim()
                ? (config.industry ?? '').split(',').map((s) => s.trim()).filter(Boolean)
                    .map((v) => INDUSTRY_CHOICES.find((c) => c.value === v)?.label ?? v)
                    .join(', ')
                : 'Auto (même que le poste)'
            }</span></li>
            <li><span className="ico"><MapPin size={15} color="#f472b6" /></span><span className="k">Zone</span><span className="v">{config.city || 'France entière'}</span></li>
            <li><span className="ico"><Users size={15} color="#2dd4bf" /></span><span className="k">Taille</span><span className="v">{
              config.sizeTarget === 'pme' ? 'TPE/PME (0–250)' :
              config.sizeTarget === 'eti' ? 'ETI (250–5000)' :
              config.sizeTarget === 'grand' ? 'Grand groupe (5000+)' : 'Toutes tailles'
            }</span></li>
            <li><span className="ico"><Radio size={15} color="#fbbf24" /></span><span className="k">Sources</span><span className={`v${config.sources.length ? '' : ' warn'}`}>{config.sources.length
              ? `${config.sources.length} sélectionnée${config.sources.length > 1 ? 's' : ''}`
              : '⚠ aucune'}</span></li>
            <li><span className="ico"><Hash size={15} color="#fb923c" /></span><span className="k">Volume max</span><span className="v">{config.max} entreprises</span></li>
            <li><span className="ico"><Clock size={15} color="#34d399" /></span><span className="k">Durée max</span><span className="v">{(config.maxRuntimeMin ?? 0) === 0 ? 'Illimitée' : `${config.maxRuntimeMin} min`}</span></li>
          </ul>
          <button onClick={launch} disabled={running || config.sources.length === 0} className="cockpit-launch">
            {running ? <><Loader2 size={17} className="spin" />Scraping en cours…</> : <><Play size={17} fill="currentColor" />Lancer le scraping</>}
          </button>
          {running && (
            <button onClick={cancel} className="btn-danger" style={{ width: '100%', justifyContent: 'center', marginTop: '8px', marginLeft: 0, padding: '11px 0', borderRadius: '11px' }}>
              <Square size={14} fill="currentColor" />Annuler
            </button>
          )}
          <p className="cockpit-hint">Tous les réglages détaillés ci-dessous sont facultatifs.</p>
        </div>
        </div>{/* fin colonne droite */}
        </div>{/* fin ligne 1 : Recherche + Sources */}

        {/* Clé Pappers.fr (visible uniquement si la source est sélectionnée) */}
        {config.sources.includes('pappers') && (
          <div style={{ marginBottom: '14px', padding: '10px', background: '#fff0f0', borderRadius: '8px', border: '1px solid #ff453a44' }}>
            <label>
              <span style={labelStyle}>
                Clé API Pappers.fr{' '}
                <a href="https://www.pappers.fr/api" target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: '#007aff' }}>
                  (500 req/mois gratuits)
                </a>
              </span>
              <input
                type="password"
                value={config.pappersKey ?? ''}
                onChange={(e) => setConfig({ ...config, pappersKey: e.target.value })}
                placeholder="Clé API Pappers.fr"
                style={inputStyle}
              />
            </label>
            <p style={{ fontSize: '11px', color: '#888', margin: '6px 0 0' }}>
              Enrichit chaque entreprise avec le nom et le rôle du dirigeant (DG, CEO…) depuis SIRENE.
            </p>
          </div>
        )}

        {/* Extraction IA (LLM) déplacée sous ③ Emails (cf. options repliées) */}

        {/* Config Alertes email (webhook) — visible si la source est sélectionnée */}
        {config.sources.includes('email_alerts') && (
          <div style={{ marginBottom: '14px', padding: '10px', background: '#f0f9f0', borderRadius: '8px', border: '1px solid #34c75944' }}>
            <span style={{ ...labelStyle, display: 'block', marginBottom: '6px' }}>
              📬 Alertes email — lit ta boîte mail pour extraire les offres
            </span>
            <p style={{ fontSize: '11px', color: '#666', margin: '0 0 10px' }}>
              Configure des alertes emploi sur WTTJ, Indeed, APEC, LinkedIn (ex : "data analyst Paris").
              L'app lit ces emails via ta connexion IMAP (déjà configurée dans <strong>Réglages</strong>)
              et en extrait les entreprises automatiquement. Plus fiable que le scraping web.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px' }}>
              <label>
                <span style={{ fontSize: '11px', color: '#888' }}>Dossier IMAP</span>
                <input
                  value={config.alertsFolder ?? 'INBOX'}
                  onChange={(e) => setConfig({ ...config, alertsFolder: e.target.value })}
                  placeholder="INBOX (ou 'Job Alerts')"
                  style={inputStyle}
                />
              </label>
              <label>
                <span style={{ fontSize: '11px', color: '#888' }}>Depuis (jours)</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={config.alertsSinceDays ?? 7}
                  onChange={(e) => setConfig({ ...config, alertsSinceDays: Number(e.target.value) })}
                  style={inputStyle}
                />
              </label>
            </div>
            <p style={{ fontSize: '11px', color: '#888', margin: '8px 0 0' }}>
              ⚠ Nécessite que l'IMAP soit configuré dans Réglages. Astuce : crée un dossier/filtre
              dédié "Job Alerts" dans ta messagerie pour de meilleurs résultats.
            </p>
          </div>
        )}

        {/* (Le lancement est dans le cockpit du rail droit — toujours visible.) */}

        {/* ③ ⚙️ Réglages détaillés — une seule grosse zone d'accordéons (listes déroulantes). */}
        <div style={cardStyle('#6c5ce0')}>
          <SectionHeader n={3} title="Emails & enrichissement"
            subtitle="Où chercher les emails et comment enrichir — tout est optionnel" accent="#6c5ce0" />
          <HelpNote summary="💡 Faut-il toucher à ça pour débuter ?" accent="#6c5ce0">
            <p style={{ margin: '0 0 6px' }}><strong>Non — les valeurs par défaut conviennent.</strong> Les seuls réglages utiles au début :</p>
            <ul style={{ margin: 0, paddingLeft: '18px' }}>
              <li><strong>Limite de temps du run</strong> : borne la durée. Le scraper s’arrête proprement et garde ce qu’il a trouvé.</li>
              <li><strong>Plafond recherches Hunter</strong> : seulement si tu as une clé Hunter.io (sinon laisse — 0 = ne s’en sert pas).</li>
              <li><strong>Assistant IA (LLM)</strong> : laisse <strong>désactivé</strong> sans bon GPU (trop lent sur CPU).</li>
            </ul>
          </HelpNote>

        {/* Un seul bloc à plat (même grille 2 col + sous-titres que ① Recherche),
            plus d'accordéons. Toutes les cases visibles d'un coup d'œil. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', alignItems: 'start' }}>

          {/* ── Groupe : méthodes d'obtention d'email ── */}
          <div style={subGroupStyle}>📧 Où chercher les emails</div>
          <p style={{ gridColumn: '1 / -1', fontSize: '11px', color: '#888', margin: '0' }}>
            Essayées en cascade. 🎯 Hunter.io se règle en haut (« Recherche »), à côté de sa clé.
          </p>

          {/* Crawler web */}
          {(() => {
            const on = (config.emailSources ?? []).includes('web_crawl');
            return (
              <label style={optionRow(on)}>
                <input type="checkbox" checked={on} style={optionCheck}
                  onChange={(e) => {
                    const cur = config.emailSources ?? [];
                    setConfig({ ...config, emailSources: e.target.checked ? [...cur, 'web_crawl'] : cur.filter((s) => s !== 'web_crawl') });
                  }}
                />
                <span style={optionBody}>
                  <span style={optionTitle}>🌐 Crawler web<InfoTip text="Visite le site web déjà connu de l'entreprise et cherche une page contact/équipe/RH. Gratuit et illimité, mais ne trouve rien si l'entreprise n'a pas de site (ou si on ne l'a pas encore trouvé)." /></span>
                  <span style={optionDesc}>Cherche /contact, /equipe, /rh… sur le site de l'entreprise</span>
                </span>
              </label>
            );
          })()}

          {/* Pattern fallback — accent ambre (risqué) */}
          {(() => {
            const on = (config.emailSources ?? []).includes('pattern');
            return (
              <label style={optionRow(on, '#e0a020')}>
                <input type="checkbox" checked={on} style={optionCheck}
                  onChange={(e) => {
                    const cur = config.emailSources ?? [];
                    setConfig({ ...config, emailSources: e.target.checked ? [...cur, 'pattern'] : cur.filter((s) => s !== 'pattern') });
                  }}
                />
                <span style={optionBody}>
                  <span style={optionTitle}>⚪ Pattern fallback<InfoTip text="Invente une adresse du type rh@domaine.com sans vérifier qu'elle existe. Risque de bounce élevé. Ces emails devinés sont marqués « non réels » et retirés par l'exclusion ci-dessous." /></span>
                  <span style={optionDesc}>Génère rh@domaine.com si rien trouvé — risque de bounce élevé</span>
                </span>
              </label>
            );
          })()}

          {/* Exclusion — pleine largeur. Fortement recommandée : sans elle, les campagnes
              écrivent des lettres pour des adresses jamais vérifiées → bloquées à l'envoi
              (« à vérifier ») ou pire, parties puis rebondies. */}
          <label style={{ ...optionRow(config.skipNoEmail ?? false, '#2e9e4f'), gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={config.skipNoEmail ?? false} style={optionCheck}
              onChange={(e) => setConfig({ ...config, skipNoEmail: e.target.checked })}
            />
            <span style={optionBody}>
              <span style={optionTitle}>
                ✅ Exclure les entreprises sans email réel <strong>(fortement recommandé)</strong>
                <InfoTip text="À la fin du scraping, retire du CSV toute entreprise dont l'email n'a pas été CONFIRMÉ (trouvé par Crawler web ou Hunter.io). Toutes les adresses DEVINÉES sont retirées si cette case est cochée : Pattern fallback (rh@domaine.com), catch-all (domaine qui accepte tout sans vérification), et LinkedIn pattern (prenom.nom@ déduit, non confirmé). Sans cette case, ces entreprises restent dans le CSV, entrent en campagne, et l'envoi de leur email sera bloqué plus tard (marqué « à vérifier ») ou pire, partira et rebondira." />
              </span>
              <span style={optionDesc}>
                Retire du CSV final TOUT email deviné/non confirmé (Pattern, catch-all, LinkedIn pattern) —
                sans ça, ces entreprises entrent quand même en campagne et bloquent l'envoi plus tard.
              </span>
            </span>
          </label>

          {/* ── Groupe : options d'enrichissement ── */}
          <div style={subGroupStyle}>⚡ Options d'enrichissement</div>

          {/* Fast Crawl */}
          <label style={optionRow(config.fastCrawl ?? true)}>
            <input type="checkbox" checked={config.fastCrawl ?? true} style={optionCheck}
              onChange={(e) => setConfig({ ...config, fastCrawl: e.target.checked })}
            />
            <span style={optionBody}>
              <span style={optionTitle}>⚡ Fast Crawl</span>
              <span style={optionDesc}>requests+BS4 avant navigateur headless (~6× plus rapide sur les sites simples)</span>
            </span>
          </label>

          {/* Trouver le recruteur */}
          <label style={optionRow(config.findRecruiter ?? true)}>
            <input type="checkbox" checked={config.findRecruiter ?? true} style={optionCheck}
              onChange={(e) => setConfig({ ...config, findRecruiter: e.target.checked })}
            />
            <span style={optionBody}>
              <span style={optionTitle}>👤 Trouver le recruteur</span>
              <span style={optionDesc}>Scrape /equipe, /about pour extraire le nom du DRH/Talent (+30% d'ouverture)</span>
            </span>
          </label>

          {/* GitHub — pleine largeur (contient le token) */}
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={optionRow(config.useGithub ?? false)}>
              <input type="checkbox" checked={config.useGithub ?? false} style={optionCheck}
                onChange={(e) => setConfig({ ...config, useGithub: e.target.checked })}
              />
              <span style={optionBody}>
                <span style={optionTitle}>🐙 Chercher l'email via GitHub</span>
                <span style={optionDesc}>Page org GitHub de l'entreprise (60 req/h sans token, 5 000/h avec)</span>
              </span>
            </label>
            {config.useGithub && (
              <label style={{ paddingLeft: '2px' }}>
                <span style={labelStyle}>
                  GitHub Token (optionnel){' '}
                  <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: '#007aff' }}>
                    (créer un token)
                  </a>
                </span>
                <input
                  type="password"
                  value={config.githubToken ?? ''}
                  onChange={(e) => setConfig({ ...config, githubToken: e.target.value })}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  style={inputStyle}
                />
              </label>
            )}
          </div>

          {/* ── Groupe : tri des résultats ── */}
          <div style={subGroupStyle}>🔽 Tri des résultats</div>
          <label style={{ ...optionRow(!config.skipScoring), gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={!config.skipScoring} style={optionCheck}
              onChange={(e) => setConfig({ ...config, skipScoring: !e.target.checked })}
            />
            <span style={optionBody}>
              <span style={{ ...optionTitle, gap: '7px' }}>
                <ArrowDownWideNarrow size={15} color="#0a84ff" />Trier par fiabilité d'email + fraîcheur
              </span>
              <span style={optionDesc}>
                {config.skipScoring
                  ? 'Désactivé — les entreprises sont exportées dans l\'ordre de collecte.'
                  : 'Les plus prometteuses (email vérifié, offre récente, bonne taille, ATS) remontent en tête pour être contactées en premier.'}
              </span>
            </span>
          </label>

        </div>{/* fin grille à plat */}

        </div>{/* fin ③ Réglages détaillés */}
      </section>


      {/* ── Boutons d'action ── */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* (Le bouton « Lancer » principal est remonté juste après ③ Emails.) */}

        {/* (Import CSV Entreprise déplacé dans la page Leads.) */}

        {/* Mise à jour du master CSV — re-enrichit pour combler les emails manquants */}
        {!running && masterPaths?.csvPath && (
          <button
            onClick={updateMaster}
            title="Recharge le CSV master et relance l'enrichissement sur les entreprises sans email réel (résolution site + crawl + pattern). Backfill aussi la localisation/secteur. À lancer régulièrement."
            style={{
              padding: '10px 18px', fontSize: '14px', fontWeight: 600,
              background: '#5856d6', color: '#fff', border: 'none',
              borderRadius: '8px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            🔄 Mettre à jour le CSV
          </button>
        )}

        {/* Bouton Reprendre — visible uniquement si un checkpoint du jour existe */}
        {!running && resumeAvailable && (
          <button
            onClick={resume}
            title="Reprend le dernier scraping interrompu depuis la phase sauvegardée (checkpoint du jour)"
            style={{
              padding: '10px 18px', fontSize: '14px', fontWeight: 600,
              background: '#ff9f0a', color: '#fff', border: 'none',
              borderRadius: '8px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            ⏩ Reprendre
            <span style={{ fontSize: '11px', fontWeight: 400, opacity: 0.85 }}>
              (checkpoint du jour)
            </span>
          </button>
        )}

        {running && (
          <button
            onClick={cancel}
            style={{
              padding: '10px 16px', fontSize: '13px',
              background: '#ff453a', color: '#fff', border: 'none',
              borderRadius: '8px', cursor: 'pointer',
            }}
          >
            ■  Annuler
          </button>
        )}

        {/* Réinitialiser la pagination — les recherches « pages dès N » repartent de 1 */}
        {!running && (
          <button
            onClick={resetPagination}
            disabled={resettingPagination}
            title="Remet à zéro les curseurs « pages suivantes des sources ». Utile quand une recherche est partie loin dans la pagination (ex : « pages dès 15 ») et ne ramène plus de nouvelles entreprises — elle repartira de la page 1."
            style={{
              padding: '8px 14px', fontSize: '12px',
              background: resettingPagination ? '#888' : '#fff6f0',
              color: resettingPagination ? '#fff' : '#ff6b2b',
              border: '1px solid #ff6b2b44', borderRadius: '8px',
              cursor: resettingPagination ? 'not-allowed' : 'pointer',
            }}
          >
            {resettingPagination ? '⟳  Réinitialisation…' : '↩️ Réinitialiser la pagination'}
          </button>
        )}

        {!running && csvPath && (
          <>
            <span style={{ fontSize: '13px', color: '#34c759' }}>
              ✅ CSV prêt — {linesCount} entreprise{linesCount > 1 ? 's' : ''}
            </span>
            <button
              onClick={async () => {
                const htmlPath = await api.invoke('scraping:getHtmlPreview');
                if (htmlPath) {
                  // Ouvrir le fichier HTML dans le navigateur par défaut via shell
                  await api.invoke('shell:open', htmlPath).catch(() => {});
                }
              }}
              style={{
                padding: '8px 14px', fontSize: '12px',
                background: '#eef4ff', color: '#007aff',
                border: '1px solid #007aff44', borderRadius: '8px', cursor: 'pointer',
              }}
            >
              🔍 Aperçu HTML
            </button>
            <button
              onClick={async () => {
                if (!csvPath || !config) return;
                setLog([]);
                setRunning(true);
                await api.invoke('scraping:enrichCsv', { csvPath, config }).catch((e: Error) => {
                  setLog([`❌ Erreur : ${e.message}`]);
                  setRunning(false);
                });
              }}
              disabled={running}
              style={{
                padding: '8px 14px', fontSize: '12px',
                background: '#f5f0ff', color: '#5856d6',
                border: '1px solid #5856d644', borderRadius: '8px', cursor: 'pointer',
              }}
            >
              🔄 Ré-enrichir les sans-email
            </button>
          </>
        )}
      </div>

      {/* Modèle de crawl trop lourd → suggestion d'un modèle plus léger. */}
      {crawlModelHeavy && (
        <div style={{
          marginBottom: '16px', padding: '12px 16px', borderRadius: '10px',
          background: '#fff7e6', border: '1px solid #ffd591', color: '#7a4f00', fontSize: '13px', lineHeight: 1.5,
        }}>
          ⚠️ <strong>Le modèle IA de crawl ({config?.ollamaModel || 'Ollama'}) est trop lourd/lent pour ce PC</strong> —
          la détection des recruteurs (Phase 4c) a été désactivée pour ce run. Le scraping a continué sans (regex/NER).
          {config?.ollamaModel !== 'qwen2.5:3b' ? (
            <div style={{ marginTop: '8px' }}>
              <button onClick={() => void switchToLighterCrawlModel()} disabled={switchingModel}
                style={{ fontSize: '12px', background: '#fa8c16', color: '#fff', border: 'none',
                  borderRadius: '6px', padding: '6px 12px', cursor: switchingModel ? 'default' : 'pointer' }}>
                {switchingModel ? 'Bascule…' : '→ Passer à qwen2.5:3b (plus léger)'}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '6px' }}>
              Tu utilises déjà un modèle léger. Garde Ollama lancé avant le scraping (évite le démarrage à froid),
              ou désactive le LLM de crawl dans les réglages IA.
            </div>
          )}
        </div>
      )}

      {/* ── Log live ── */}
      {log.length > 0 && (
        <section style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '8px' }}>Journal d'exécution</h3>
          <div style={{
            background: '#1c1c1e', color: '#e5e5ea', borderRadius: '10px',
            padding: '12px 16px', fontFamily: 'monospace', fontSize: '12px',
            maxHeight: '320px', overflowY: 'auto', lineHeight: '1.7',
          }}>
            {log.map((line, i) => (
              <div key={i} style={{
                color: line.startsWith('❌') ? '#ff453a'
                  : line.startsWith('✅') ? '#34c759'
                  : line.startsWith('⚠') ? '#ff9f0a'
                  : '#e5e5ea',
              }}>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      )}

      {/* (Bloc « Derniers résultats » retiré : les leads se consultent dans la page Leads.) */}

      {/* ── Info Python ── */}
      <section style={{ marginTop: '20px', padding: '12px 16px',
        background: '#fff3cd', borderRadius: '8px', fontSize: '13px', color: '#856404' }}>
        <strong>Prérequis Python :</strong>{' '}
        Python 3.10+ doit être installé et accessible depuis le terminal.<br />
        <code style={{ fontSize: '11px', display: 'block', margin: '4px 0', wordBreak: 'break-all' }}>
          pip install scrapling requests dnspython python-whois &amp;&amp; pip install "scrapling[fetchers]" &amp;&amp; scrapling install
        </code>
        <span style={{ fontSize: '12px', marginTop: '4px', display: 'block', color: '#6c5800' }}>
          <strong>Optionnel (Wappalyzer — détection de stack via HTTP headers) :</strong>{' '}
          <code style={{ fontSize: '11px' }}>pip install python-wappalyzer</code>
        </span>
        <span style={{ fontSize: '12px', marginTop: '4px', display: 'block' }}>
          <strong>Pipeline email :</strong> crawl web → WHOIS → Hunter.io → GitHub → SMTP batch → pattern fallback
        </span>
      </section>
    </div>
  );
}

// ── Composant scoring ──────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '12.5px', color: '#444', marginBottom: '5px', fontWeight: 600,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: '9px',
  border: '1px solid #d1d1d6', fontSize: '13.5px', boxSizing: 'border-box',
};
// Sous-titre de groupe (pleine largeur dans une grille) pour segmenter une carte.
const subGroupStyle: React.CSSProperties = {
  gridColumn: '1 / -1', fontSize: '11px', fontWeight: 700, color: '#3b6fd4',
  textTransform: 'uppercase', letterSpacing: '0.6px',
  marginTop: '10px', paddingBottom: '6px', borderBottom: '1px solid #e3e9f6',
};
// Résumé d'accordéon (liste déroulante) dans la zone Réglages détaillés.
const accordionSummaryStyle: React.CSSProperties = {
  cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#1d1d1f',
  padding: '10px 4px', borderBottom: '1px solid #f0f0f0', listStyle: 'none',
};
// Tuile-option unique pour TOUTES les cases à cocher de la section ③.
// flexDirection 'row' explicite : contourne le CSS global `label { flex-direction: column }`
// qui, sinon, empile la case au-dessus du texte et centre tout (rendu incohérent).
// `accent` = couleur de surlignage quand cochée (bleu par défaut, ambre pour les options « attention »).
const optionRow = (on: boolean, accent = '#0a84ff'): React.CSSProperties => ({
  display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: '10px',
  cursor: 'pointer', padding: '11px 13px', borderRadius: '10px',
  border: `1px solid ${on ? accent : '#e4e4ea'}`,
  background: on ? `${accent}12` : '#fbfbfd',
  transition: 'border-color 0.12s, background 0.12s',
});
// Éléments internes d'une tuile-option (structure identique partout).
const optionCheck: React.CSSProperties = { marginTop: '2px', flexShrink: 0, width: '15px', height: '15px', cursor: 'pointer' };
const optionBody: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 };
const optionTitle: React.CSSProperties = { display: 'flex', alignItems: 'center', fontSize: '13px', fontWeight: 600, color: '#1d1d1f' };
const optionDesc: React.CSSProperties = { fontSize: '11px', color: '#6b6b70', lineHeight: 1.45 };

// Bulle d'aide au survol — tooltip natif du navigateur (title), disparaît
// tout seul quand la souris s'éloigne. Pas de librairie, pas d'état.
function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0,
        background: '#e6e6eb', color: '#666', fontSize: '10px', fontWeight: 700,
        cursor: 'help', marginLeft: '5px', verticalAlign: 'middle',
      }}
      onClick={(e) => e.preventDefault()}
    >?</span>
  );
}

// ── Tokens de mise en page (hiérarchie claire : cartes titrées numérotées) ────
// Carte de groupe colorée : fond blanc, coin arrondi, accent latéral teinté.
function cardStyle(accent = '#0a6ae0'): React.CSSProperties {
  return {
    background: '#fff', border: '1px solid #d1d1d6', borderLeft: `4px solid ${accent}`,
    borderRadius: '16px', padding: '20px 22px', marginBottom: '16px',
    boxShadow: '0 1px 3px rgba(17,17,26,0.05), 0 1px 2px rgba(17,17,26,0.04)',
  };
}

// En-tête de carte : pastille numérotée colorée sur un bandeau teinté assorti.
function SectionHeader({ n, title, subtitle, accent = '#0a6ae0' }: { n: number; title: string; subtitle?: string; accent?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px',
      background: `${accent}12`, border: `1px solid ${accent}26`,
      borderRadius: '12px', padding: '11px 13px',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '30px', height: '30px', borderRadius: '10px',
        background: accent, color: '#fff', fontSize: '14px', fontWeight: 700, flexShrink: 0,
        boxShadow: `0 2px 7px ${accent}66`,
      }}>{n}</span>
      <div>
        <h3 style={{ margin: 0, fontSize: '16.5px', fontWeight: 700, color: '#1d1d1f', letterSpacing: '-0.3px' }}>{title}</h3>
        {subtitle && <p style={{ margin: '2px 0 0', fontSize: '12.5px', color: '#86868b' }}>{subtitle}</p>}
      </div>
    </div>
  );
}
