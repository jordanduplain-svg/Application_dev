/**
 * ScrapingPage — Interface de scraping d'entreprises.
 *
 * Permet de :
 * - Configurer le scraper (secteur, ville, sources, clé Hunter.io)
 * - Lancer / annuler le script Python en temps réel (log live)
 * - Visualiser le CSV généré et l'importer dans une campagne
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Campaign, ScrapingConfig, ScoringWeights, HardwareInfo } from '@candio/shared';
import { DEFAULT_SCORING_WEIGHTS } from '@candio/shared';
import { api } from '../lib/api';
import { COUNTRIES, FR_DEPTS_BY_REGION, FR_REGIONS, FR_CITIES } from '../lib/geo';
import { SCRAPING_MODEL_CATALOG, qualityStars, compatLabel } from '../lib/ollamaModels';
import { INDUSTRY_GROUPS, INDUSTRY_CHOICES } from '../lib/sectors';

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

// Choix de nombre d'entreprises proposés dans la liste déroulante (plafonné à 300).
const MAX_CHOICES = [10, 25, 50, 100, 150, 200, 300];
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
  { value: 5, label: '5 pages — maximal (défaut)' },
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

const EMAIL_SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  hunter_verified:  { label: '✅ Vérifié Hunter',     color: '#34c759' },
  linkedin_smtp:    { label: '🔗 LinkedIn+SMTP',      color: '#0077b5' },
  web_crawl:        { label: '🌐 Crawl site',         color: '#30d158' },
  whois:            { label: '🔎 WHOIS',              color: '#64d2ff' },
  snov_found:       { label: '🔵 Snov.io',            color: '#5ac8fa' },
  apollo_found:     { label: '🟣 Apollo.io',          color: '#bf5af2' },
  hunter_found:     { label: '🟡 Trouvé Hunter',      color: '#ff9f0a' },
  linkedin_pattern: { label: '🔸 LinkedIn (non vérifié)', color: '#ff9500' },
  pattern_verified: { label: '⚡ Pattern+SMTP',       color: '#ffd60a' },
  catch_all:        { label: '🟠 Catch-all',          color: '#ff6b2b' },
  pattern:          { label: '⚪ Généré auto',         color: '#888'    },
  no_email:         { label: '❌ Sans email',          color: '#ff453a' },
  manual:           { label: '✏️ Manuel',              color: '#5ac8fa' },
};

export default function ScrapingPage({ onGoToLeads }: { onGoToLeads?: () => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [config, setConfig] = useState<ScrapingConfig | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [csvPath, setCsvPath] = useState<string | null>(null);
  const [linesCount, setLinesCount] = useState(0);
  const [importCampaignId, setImportCampaignId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  // Chemins master persistants (disponibles même sans run dans la session courante).
  const [masterPaths, setMasterPaths] = useState<{ csvPath: string | null; htmlPath: string | null } | null>(null);
  const [resumeAvailable, setResumeAvailable] = useState(false);
  // Réinitialisation des curseurs de pagination des sources.
  const [resettingPagination, setResettingPagination] = useState(false);
  // Modèles Ollama installés localement (menu déroulant) + téléchargement.
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  // SCRAPE-DESC : détection hardware pour recommander un modèle de descriptions.
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [detectingHw, setDetectingHw] = useState(false);
  const [hwError, setHwError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const isMounted = useRef(true);
  // Dropdown secteurs d'activité — ouverture/fermeture.
  const [sectorOpen, setSectorOpen] = useState(false);
  const sectorRef = useRef<HTMLDivElement | null>(null);

  // ── Chargement initial ──────────────────────────────────────────────────────
  useEffect(() => {
    isMounted.current = true;
    const load = async () => {
      const [cfg, camps, status, master] = await Promise.all([
        api.invoke('scraping:getConfig'),
        api.invoke('campaign:list'),
        api.invoke('scraping:getStatus'),
        api.invoke('scraping:getMasterPaths'),
      ]);
      if (!isMounted.current) return;
      setMasterPaths(master);
      setConfig(cfg);
      setCampaigns(camps.filter((c) => c.status !== 'COMPLETED' && !c.archivedAt));
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

  // ── Liste des modèles Ollama installés (menu déroulant) ──────────────────
  const refreshOllamaModels = useCallback(() => {
    api.invoke('ollama:listModels')
      .then((models) => { if (isMounted.current) setOllamaModels(models); })
      .catch(() => {});
  }, []);
  useEffect(() => { refreshOllamaModels(); }, [refreshOllamaModels]);

  // Déclenche le téléchargement (pull) d'un modèle Ollama ; suit la progression dans le log.
  const handlePullModel = useCallback(async () => {
    const name = pullName.trim();
    if (!name || pulling) return;
    setPulling(true);
    try {
      const res = await api.invoke('ollama:pullModel', name);
      if (res.ok) {
        setPullName('');
        refreshOllamaModels();
        // Sélectionne automatiquement le modèle fraîchement téléchargé.
        setConfig((c) => (c ? { ...c, ollamaModel: name } : c));
      }
    } finally {
      if (isMounted.current) setPulling(false);
    }
  }, [pullName, pulling, refreshOllamaModels]);

  // SCRAPE-DESC : détecte le hardware (RAM/GPU) + recharge les modèles installés,
  // pour recommander un modèle de descriptions adapté à la machine (comme Réglages).
  const analyzeHardware = useCallback(async () => {
    setDetectingHw(true);
    setHwError(null);
    try {
      const hw = await api.invoke('settings:getHardwareInfo');
      if (isMounted.current) setHardware(hw);
      refreshOllamaModels();
    } catch (e) {
      if (isMounted.current) setHwError(e instanceof Error ? e.message : 'Erreur de détection');
    } finally {
      if (isMounted.current) setDetectingHw(false);
    }
  }, [refreshOllamaModels]);

  // SCRAPE-DESC : change le modèle des descriptions ET le persiste IMMÉDIATEMENT.
  // Sinon le changement n'est sauvé qu'au lancement d'un scrape → la page Leads
  // (bouton Enrichir) lit la config disque inchangée et le menu « revient » à l'ancien.
  const setDescribeModel = useCallback((model: string) => {
    setConfig((c) => {
      if (!c) return c;
      const next = { ...c, describeModel: model };
      void api.invoke('scraping:saveConfig', next).catch(() => {});
      return next;
    });
  }, []);

  // SCRAPE-DESC : télécharge le modèle de descriptions sélectionné (s'il manque).
  const handlePullDescribeModel = useCallback(async () => {
    const name = (config?.describeModel ?? '').trim();
    if (!name || pulling) return;
    setPulling(true);
    try {
      const res = await api.invoke('ollama:pullModel', name);
      if (res.ok) refreshOllamaModels();
    } finally {
      if (isMounted.current) setPulling(false);
    }
  }, [config?.describeModel, pulling, refreshOllamaModels]);

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

  const launch = useCallback(async () => {
    if (!config) return;
    setLog([]);
    setCsvPath(null);
    setLinesCount(0);
    setImportMsg(null);
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
    setImportMsg(null);
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

  // Import CSV LinkedIn Sales Navigator (ou Evaboot, PhantomBuster, Apollo, Wiza…).
  // Ouvre un dialog natif → si l'utilisateur sélectionne un fichier, lance le pipeline
  // d'enrichissement directement sur les leads du CSV (saute la collecte multi-sources).
  const linkedinImport = useCallback(async () => {
    if (!config) return;
    const csvPath = await api.invoke('dialog:openCsv', { title: 'Sélectionner un CSV LinkedIn' });
    if (!csvPath) return;   // utilisateur a annulé
    setLog([]);
    setCsvPath(null);
    setLinesCount(0);
    setImportMsg(null);
    setRunning(true);
    try {
      await api.invoke('scraping:linkedinImport', { csvPath, config });
      await api.invoke('scraping:saveConfig', config);
    } catch (e) {
      setLog((prev) => [...prev, `❌ Erreur : ${e instanceof Error ? e.message : String(e)}`]);
      setRunning(false);
    }
  }, [config]);

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
    setImportMsg(null);
    setRunning(true);
    try {
      await api.invoke('scraping:enrichCsv', { csvPath: master, config });
      await api.invoke('scraping:saveConfig', config);
    } catch (e) {
      setLog((prev) => [...prev, `❌ Erreur : ${e instanceof Error ? e.message : String(e)}`]);
      setRunning(false);
    }
  }, [config, masterPaths]);

  const importCsv = useCallback(async () => {
    if (!csvPath || !importCampaignId) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const { added, skipped } = await api.invoke('scraping:importCsv', {
        csvPath,
        campaignId: importCampaignId,
      });
      setImportMsg(`✅ ${added} entreprises importées, ${skipped} ignorées (doublons / email manquant).`);
    } catch (e) {
      setImportMsg(`❌ Erreur : ${e instanceof Error ? e.message : String(e)}`);
    }
    if (isMounted.current) setImporting(false);
  }, [csvPath, importCampaignId]);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Scraping d'entreprises</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {/* Accès à la page de consultation des leads scrapés. */}
          <button onClick={() => onGoToLeads?.()}
            style={{ background: '#0a84ff', color: '#fff', border: 'none', borderRadius: '8px',
              padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
            📋 Mes leads scrapés
          </button>
          {/* Rapport HTML de performance (généré par le scraper). */}
          <button
            onClick={async () => {
              const m = masterPaths ?? await api.invoke('scraping:getMasterPaths');
              if (m?.htmlPath) await api.invoke('shell:open', m.htmlPath).catch(() => {});
            }}
            disabled={!masterPaths?.htmlPath}
            title={masterPaths?.htmlPath ? 'Ouvre le rapport HTML de performance' : 'Lance un scraping pour générer le rapport'}
            style={{ background: 'transparent', color: '#555', border: '1px solid #ccc', borderRadius: '8px',
              padding: '8px 14px', cursor: masterPaths?.htmlPath ? 'pointer' : 'not-allowed', fontSize: '13px' }}>
            📊 Rapport performance
          </button>
        </div>
      </div>
      <p style={{ color: '#666', marginBottom: '24px', marginTop: '8px' }}>
        Lance le script Python <code>scrape_leads.py</code> directement depuis l'app.
        Le CSV généré peut être importé dans n'importe quelle campagne.
      </p>

      {/* ── Configuration (cartes titrées numérotées pour une hiérarchie claire) ── */}
      <section style={{ marginBottom: '28px' }}>

        {/* Ligne 1 : ① Recherche (gauche) + ② Sources (droite), côte à côte */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '16px', alignItems: 'start' }}>

        {/* ① Recherche */}
        <div style={cardStyle}>
        <SectionHeader n={1} title="Recherche" subtitle="Le poste ciblé, la zone géographique et le volume" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
          {/* Secteur d'activité — menu déroulant multi-sélection (filtre NAF SIRENE). */}
          <div ref={sectorRef} style={{ position: 'relative', zIndex: 20 }}>
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
              style={{ ...inputStyle, width: '160px' }}
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
              style={{ ...inputStyle, width: '220px' }}
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
              style={{ ...inputStyle, width: '280px' }}
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
              style={{ ...inputStyle, width: '220px' }}
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

        {/* Colonne droite : ② Sources + récapitulatif (comble le vide — solution B) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* ② Sources de collecte */}
        <div style={cardStyle}>
          <SectionHeader n={2} title="Sources de collecte" subtitle="Où aller chercher les entreprises" />

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

        {/* Récapitulatif live — résume ce qui va tourner (comble le vide sous Sources) */}
        <div style={{ ...cardStyle, background: '#f8fafc', marginBottom: 0, flex: 1 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: '#1d1d1f', marginBottom: '10px' }}>
            📋 Récapitulatif
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '12.5px', color: '#444', lineHeight: 1.9 }}>
            <li><strong>Poste :</strong> {config.sector || '—'}</li>
            <li><strong>Secteurs :</strong> {
              (config.industry ?? '').trim()
                ? (config.industry ?? '').split(',').map((s) => s.trim()).filter(Boolean)
                    .map((v) => INDUSTRY_CHOICES.find((c) => c.value === v)?.label ?? v)
                    .join(', ')
                : <span style={{ color: '#888' }}>Auto (même que le poste)</span>
            }</li>
            <li><strong>Zone :</strong> {config.city || 'France entière'}</li>
            <li><strong>Taille :</strong> {
              config.sizeTarget === 'pme' ? 'TPE/PME (0–250)' :
              config.sizeTarget === 'eti' ? 'ETI (250–5000)' :
              config.sizeTarget === 'grand' ? 'Grand groupe (5000+)' : 'Toutes tailles'
            }</li>
            <li><strong>Sources :</strong> {config.sources.length
              ? config.sources.join(', ')
              : <span style={{ color: '#ff453a' }}>⚠ aucune sélectionnée</span>}</li>
            <li><strong>Emails :</strong> {(config.emailSources ?? []).join(', ') || '—'}</li>
            <li><strong>Volume max :</strong> {config.max} entreprises</li>
            <li><strong>Budget crawl :</strong> {config.crawlBudgetSec ?? 25} s / entreprise</li>
            <li><strong>Pages / run :</strong> {config.pagesPerRun ?? 2} <span style={{ color: '#34c759', fontSize: '11px' }}>✅ pagination auto</span></li>
            <li><strong>Durée max :</strong> {(config.maxRuntimeMin ?? 0) === 0 ? 'Illimitée' : `${config.maxRuntimeMin} min`}</li>
          </ul>
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

        {/* ▶ Action principale — placée AVANT les réglages détaillés. */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', margin: '4px 0 18px', flexWrap: 'wrap' }}>
          <button
            onClick={launch}
            disabled={running || config.sources.length === 0}
            style={{
              padding: '13px 30px', fontSize: '15px', fontWeight: 700,
              background: running ? '#888' : '#34c759', color: '#fff', border: 'none',
              borderRadius: '10px', cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? '⟳  Scraping en cours…' : '▶  Lancer le scraping'}
          </button>
          {running && (
            <button
              onClick={cancel}
              style={{
                padding: '13px 18px', fontSize: '14px',
                background: '#ff453a', color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer',
              }}
            >
              ■  Annuler
            </button>
          )}
          <span style={{ fontSize: '12px', color: '#999' }}>
            Tous les réglages ci-dessous sont facultatifs (laissez par défaut).
          </span>
        </div>

        {/* ③ ⚙️ Réglages détaillés — une seule grosse zone d'accordéons (listes déroulantes). */}
        <div style={cardStyle}>
          <SectionHeader n={3} title="Réglages détaillés"
            subtitle="Tout est optionnel — dépliez seulement ce que vous voulez ajuster" />

        {/* 📧 Emails à récupérer */}
        <details style={{ marginBottom: '6px' }}>
          <summary style={accordionSummaryStyle}>
            📧 Emails à récupérer{' '}
            <span style={{ fontWeight: 400, fontSize: '12px', color: '#86868b' }}>— méthodes d'obtention (essayées en cascade)</span>
          </summary>
          <p style={{ fontSize: '11px', color: '#888', margin: '10px 0 8px' }}>
            Réglages crawl (budget, exploration) ci-dessus dans « Recherche ».
          </p>

          {/* Même structure que la carte ① Recherche : grille 2 colonnes + sous-titres
              gris en majuscules (subGroupStyle). Chaque méthode = une cellule-option. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

            <div style={subGroupStyle}>🆓 Tier 1 — Gratuit, aucune clé API requise</div>
            {[
              { id: 'web_crawl', label: '🌐 Crawler web', desc: 'Cherche /contact, /equipe, /rh… sur le site de l\'entreprise', color: '#34c759' },
              { id: 'hunter',    label: '🎯 Hunter.io',    desc: '25 req/mois gratuits — enrichissement + format email',        color: '#ff9f0a' },
            ].map(({ id, label, desc, color }) => {
              const on = (config.emailSources ?? []).includes(id);
              return (
                <label key={id} style={emailMethodStyle(on)}>
                  <input type="checkbox" checked={on}
                    onChange={(e) => {
                      const cur = config.emailSources ?? [];
                      setConfig({ ...config, emailSources: e.target.checked ? [...cur, id] : cur.filter((s) => s !== id) });
                    }}
                    style={{ marginTop: '2px' }}
                  />
                  <span>
                    <strong style={{ color }}>{label}</strong>
                    <span style={{ fontSize: '11px', color: '#666', display: 'block', marginTop: '2px' }}>{desc}</span>
                  </span>
                </label>
              );
            })}

            <div style={subGroupStyle}>🔗 Tier 2 — LinkedIn + vérification SMTP (gratuit, sans clé)</div>
            {(() => {
              const on = (config.emailSources ?? []).includes('linkedin');
              return (
                <label style={emailMethodStyle(on)}>
                  <input type="checkbox" checked={on}
                    onChange={(e) => {
                      const cur = config.emailSources ?? [];
                      setConfig({ ...config, emailSources: e.target.checked ? [...cur, 'linkedin'] : cur.filter((s) => s !== 'linkedin') });
                    }}
                    style={{ marginTop: '2px' }}
                  />
                  <span>
                    <strong style={{ color: '#0077b5' }}>🔗 LinkedIn+SMTP</strong>
                    <span style={{ fontSize: '11px', color: '#666', display: 'block', marginTop: '2px' }}>
                      DuckDuckGo → snippets LinkedIn → format Hunter → SMTP RCPT TO
                    </span>
                  </span>
                </label>
              );
            })()}

            <div style={subGroupStyle}>⚠️ Tier 3 — Dernier recours</div>
            {(() => {
              const on = (config.emailSources ?? []).includes('pattern');
              return (
                <label style={emailMethodStyle(on)}>
                  <input type="checkbox" checked={on}
                    onChange={(e) => {
                      const cur = config.emailSources ?? [];
                      setConfig({ ...config, emailSources: e.target.checked ? [...cur, 'pattern'] : cur.filter((s) => s !== 'pattern') });
                    }}
                    style={{ marginTop: '2px' }}
                  />
                  <span>
                    <strong style={{ color: '#888' }}>⚪ Pattern fallback</strong>
                    <span style={{ fontSize: '11px', color: '#666', display: 'block', marginTop: '2px' }}>
                      Génère rh@domaine.com si rien trouvé — risque de bounce élevé
                    </span>
                  </span>
                </label>
              );
            })()}

            {/* Exclusion — pleine largeur, en bas */}
            <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px',
              cursor: 'pointer', padding: '8px 12px', background: '#fff3cd', borderRadius: '8px', fontSize: '12px',
              border: '1px solid #ffe08a' }}>
              <input
                type="checkbox"
                checked={config.skipNoEmail ?? false}
                onChange={(e) => setConfig({ ...config, skipNoEmail: e.target.checked })}
              />
              <span>
                <strong>Exclure les entreprises sans email réel</strong>
                <span style={{ color: '#666', marginLeft: '6px' }}>
                  (si Pattern est coché, uniquement les entreprises sans site web)
                </span>
              </span>
            </label>
          </div>
        </details>{/* fin 📧 Emails */}

        {/* Les réglages IA (crawl, fiches, lettres) sont sur la page Profil. */}

        {/* ── Validation d'email (replié — optionnel) ── */}
        <details style={{ marginTop: '10px' }}>
          <summary style={accordionSummaryStyle}>
            ✅ Validation d'email <span style={{ fontWeight: 400, fontSize: '11px', color: '#86868b' }}>— optionnel</span>
          </summary>
          <div style={{ marginTop: '10px', padding: '12px', background: '#f0fff4', borderRadius: '8px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <label>
              <span style={labelStyle}>Service de validation</span>
              <select
                value={config.validator ?? 'none'}
                onChange={(e) => setConfig({ ...config, validator: e.target.value as 'none' | 'neverbounce' | 'zerobounce' })}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="none">Aucun (pattern uniquement)</option>
                <option value="neverbounce">NeverBounce (1000 gratuits)</option>
                <option value="zerobounce">ZeroBounce (100 gratuits/mois)</option>
              </select>
            </label>
            {config.validator !== 'none' && (
              <label>
                <span style={labelStyle}>Clé API {config.validator}</span>
                <input
                  type="password"
                  value={config.validatorKey ?? ''}
                  onChange={(e) => setConfig({ ...config, validatorKey: e.target.value })}
                  placeholder="Clé API du service de validation"
                  style={inputStyle}
                />
              </label>
            )}
          </div>
          </div>
        </details>

        {/* ── Enrichissement GitHub + SMTP batch (SCRAPE-05) ── */}
        <details style={{ marginTop: '8px' }}>
          <summary style={accordionSummaryStyle}>
            ⚡ Enrichissement avancé (GitHub, SMTP batch, proxies)
          </summary>
          <div style={{ marginTop: '10px', padding: '12px', background: '#f5f0ff', borderRadius: '8px' }}>

            {/* GitHub */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.useGithub ?? false}
                  onChange={(e) => setConfig({ ...config, useGithub: e.target.checked })}
                />
                <span style={{ fontWeight: 600, fontSize: '13px' }}>🐙 Chercher l'email via GitHub</span>
                <span style={{ fontSize: '11px', color: '#888' }}>
                  60 req/h sans token, 5 000/h avec token — page org GitHub de l'entreprise
                </span>
              </label>
              {config.useGithub && (
                <label>
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

            {/* SMTP batch */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '14px', cursor: 'pointer',
              padding: '8px', background: '#fff8e1', borderRadius: '6px' }}>
              <input
                type="checkbox"
                checked={config.useSmtpBatch ?? false}
                onChange={(e) => setConfig({ ...config, useSmtpBatch: e.target.checked })}
                style={{ marginTop: '2px' }}
              />
              <span>
                <strong style={{ fontSize: '13px' }}>📨 SMTP batch (12 patterns RH en parallèle)</strong>
                <span style={{ fontSize: '11px', color: '#888', display: 'block', marginTop: '2px' }}>
                  Teste rh@, recrutement@, careers@, jobs@… via SMTP RCPT TO.
                  Lent (~2 s/entreprise) mais fiable. Uniquement si aucun email trouvé ailleurs.
                </span>
              </span>
            </label>

            {/* Proxies */}
            <label>
              <span style={labelStyle}>
                Rotation de proxies{' '}
                <span style={{ fontWeight: 400, color: '#888' }}>
                  (séparés par virgules ou sauts de ligne)
                </span>
              </span>
              <textarea
                value={config.proxies ?? ''}
                onChange={(e) => setConfig({ ...config, proxies: e.target.value })}
                placeholder={'http://user:pass@proxy1:8080\nhttp://user:pass@proxy2:8080'}
                rows={3}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '11px', resize: 'vertical' }}
              />
              <span style={{ fontSize: '11px', color: '#888' }}>
                Appliqué aux appels HTTP (Hunter, crawler web, WHOIS…). La navigation browser n'est pas affectée.
              </span>
            </label>

            {/* Fast crawl + Recruiter finder */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer',
                padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd' }}>
                <input
                  type="checkbox"
                  checked={config.fastCrawl ?? true}
                  onChange={(e) => setConfig({ ...config, fastCrawl: e.target.checked })}
                  style={{ marginTop: '2px' }}
                />
                <span>
                  <strong style={{ fontSize: '13px', display: 'block' }}>⚡ Fast Crawl</strong>
                  <span style={{ fontSize: '11px', color: '#888' }}>
                    requests+BS4 avant navigateur headless (~6× plus rapide sur les sites simples)
                  </span>
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer',
                padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd' }}>
                <input
                  type="checkbox"
                  checked={config.findRecruiter ?? true}
                  onChange={(e) => setConfig({ ...config, findRecruiter: e.target.checked })}
                  style={{ marginTop: '2px' }}
                />
                <span>
                  <strong style={{ fontSize: '13px', display: 'block' }}>👤 Trouver le recruteur</strong>
                  <span style={{ fontSize: '11px', color: '#888' }}>
                    Scrape /equipe, /about pour extraire le nom du DRH/Talent (+30% d'ouverture)
                  </span>
                </span>
              </label>
            </div>

            {/* Filtre date de publication */}
            <label>
              <span style={labelStyle}>
                Filtre fraîcheur des offres{' '}
                <span style={{ fontWeight: 400, color: '#888' }}>
                  — exclure les offres publiées il y a plus de :
                </span>
              </span>
              <select
                value={config.postedWithinDays ?? 0}
                onChange={(e) => setConfig({ ...config, postedWithinDays: Number(e.target.value) })}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value={0}>Pas de filtre (tout garder)</option>
                <option value={7}>7 jours</option>
                <option value={14}>14 jours</option>
                <option value={30}>30 jours</option>
                <option value={60}>60 jours</option>
                <option value={90}>90 jours</option>
              </select>
            </label>

            {/* Blacklist */}
            <label>
              <span style={labelStyle}>
                🚫 Blacklist de domaines{' '}
                <span style={{ fontWeight: 400, color: '#888' }}>
                  — toujours exclure ces entreprises (un domaine par ligne)
                </span>
              </span>
              <textarea
                value={config.blacklistDomains ?? ''}
                onChange={(e) => setConfig({ ...config, blacklistDomains: e.target.value })}
                placeholder={'concurrent.fr\nentreprise-a-eviter.com'}
                rows={3}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '11px', resize: 'vertical' }}
              />
            </label>

            {/* Whitelist */}
            <label>
              <span style={labelStyle}>
                ⭐ Whitelist de domaines{' '}
                <span style={{ fontWeight: 400, color: '#888' }}>
                  — entreprises prioritaires, montées en tête de liste (un domaine par ligne)
                </span>
              </span>
              <textarea
                value={config.whitelistDomains ?? ''}
                onChange={(e) => setConfig({ ...config, whitelistDomains: e.target.value })}
                placeholder={'entreprise-reve.fr\nstartup-top.io'}
                rows={3}
                style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '11px', resize: 'vertical' }}
              />
            </label>

          </div>
        </details>

        {/* ── Paramètres de qualité + chemins Python ── */}
        <details style={{ marginTop: '8px' }}>
          <summary style={accordionSummaryStyle}>
            ⚙️ Paramètres avancés (qualité, performance, chemins)
          </summary>
          <div style={{ marginTop: '10px', padding: '12px', background: '#f5f5f7', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

            {/* Chemins Python */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label>
                <span style={labelStyle}>Exécutable Python</span>
                <input
                  value={config.pythonPath}
                  onChange={(e) => setConfig({ ...config, pythonPath: e.target.value })}
                  placeholder="python ou python3"
                  style={inputStyle}
                />
              </label>
              <label>
                <span style={labelStyle}>Chemin du script</span>
                <input
                  value={config.scriptPath}
                  onChange={(e) => setConfig({ ...config, scriptPath: e.target.value })}
                  placeholder="/chemin/vers/scrape_leads.py"
                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px' }}
                />
              </label>
            </div>

            {/* Clearbit + Fuzzy dedup */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd' }}>
                <input
                  type="checkbox"
                  checked={config.useClearbit ?? true}
                  onChange={(e) => setConfig({ ...config, useClearbit: e.target.checked })}
                />
                <span>
                  <strong style={{ fontSize: '13px', display: 'block' }}>Enrichissement Clearbit</strong>
                  <span style={{ fontSize: '11px', color: '#888' }}>
                    Taille + secteur via l'API gratuite Clearbit autocomplete
                  </span>
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
                padding: '8px', background: '#fff', borderRadius: '6px', border: '1px solid #ddd' }}>
                <input
                  type="checkbox"
                  checked={config.fuzzyDedup ?? true}
                  onChange={(e) => setConfig({ ...config, fuzzyDedup: e.target.checked })}
                />
                <span>
                  <strong style={{ fontSize: '13px', display: 'block' }}>Dédoublonnage flou</strong>
                  <span style={{ fontSize: '11px', color: '#888' }}>
                    Fusionne "ACME SAS" et "Acme France" (garde le mieux scoré)
                  </span>
                </span>
              </label>
            </div>

            {/* Fuzzy threshold + parallel workers */}
            {(config.fuzzyDedup ?? true) && (
              <label>
                <span style={labelStyle}>
                  Seuil de similarité des noms : <strong>{Math.round((config.fuzzyThreshold ?? 0.85) * 100)}%</strong>
                  <span style={{ fontWeight: 400, color: '#888', marginLeft: '8px' }}>
                    — plus bas = fusionne plus agressivement
                  </span>
                </span>
                <input
                  type="range"
                  min={50} max={99} step={1}
                  value={Math.round((config.fuzzyThreshold ?? 0.85) * 100)}
                  onChange={(e) => setConfig({ ...config, fuzzyThreshold: Number(e.target.value) / 100 })}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#aaa' }}>
                  <span>50% (très agressif)</span>
                  <span>85% (recommandé)</span>
                  <span>99% (strict)</span>
                </div>
              </label>
            )}

            <label>
              <span style={labelStyle}>
                Workers parallèles (MX + catch-all){' '}
                <span style={{ fontWeight: 400, color: '#888' }}>— 10 par défaut, max recommandé : 20</span>
              </span>
              <input
                type="number"
                min={1} max={50}
                value={config.parallelWorkers ?? 10}
                onChange={(e) => setConfig({ ...config, parallelWorkers: Number(e.target.value) })}
                style={{ ...inputStyle, width: '80px' }}
              />
            </label>

          </div>
        </details>
        </div>{/* fin ③ Réglages détaillés */}
      </section>

      {/* ── Scoring & tri ── */}
      <ScoringSection config={config} setConfig={setConfig} />

      {/* ── Boutons d'action ── */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* (Le bouton « Lancer » principal est remonté juste après ③ Emails.) */}

        {/* Import CSV LinkedIn Sales Navigator — saute la collecte multi-sources */}
        {!running && (
          <button
            onClick={linkedinImport}
            title="Importer un CSV LinkedIn Sales Navigator (ou Evaboot, PhantomBuster, Apollo, Wiza…). L'app enrichit ensuite les leads avec Hunter + web crawl."
            style={{
              padding: '10px 18px', fontSize: '14px', fontWeight: 600,
              background: '#0077b5', color: '#fff', border: 'none',  // bleu LinkedIn
              borderRadius: '8px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            📥 Importer CSV LinkedIn
          </button>
        )}

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

      {/* ── Import dans une campagne ── */}
      {csvPath && !running && (
        <section style={{
          marginBottom: '28px', padding: '16px',
          background: '#f0fff4', borderRadius: '10px', border: '1px solid #34c759',
        }}>
          <h3 style={{ margin: '0 0 12px', color: '#1a7a3a' }}>
            Importer les résultats dans une campagne
          </h3>
          <p style={{ fontSize: '13px', color: '#555', margin: '0 0 10px' }}>
            <code style={{ wordBreak: 'break-all', fontSize: '11px' }}>{csvPath}</code>
            {' '}— {linesCount} entreprise{linesCount > 1 ? 's' : ''}
          </p>

          {/* Légende emailSource */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {Object.entries(EMAIL_SOURCE_BADGE).map(([k, v]) => (
              <span key={k} style={{
                fontSize: '11px', padding: '2px 8px', borderRadius: '8px',
                background: v.color + '22', color: v.color, border: `1px solid ${v.color}`,
              }}>
                {v.label}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select
              value={importCampaignId}
              onChange={(e) => setImportCampaignId(e.target.value)}
              style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #ccc' }}
            >
              <option value="">— Choisir une campagne —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={importCsv}
              disabled={!importCampaignId || importing}
              style={{
                padding: '8px 18px', background: '#34c759', color: '#fff',
                border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {importing ? 'Import…' : 'Importer'}
            </button>
          </div>
          {importMsg && (
            <p style={{ marginTop: '10px', fontSize: '13px',
              color: importMsg.startsWith('✅') ? '#1a7a3a' : '#c0392b' }}>
              {importMsg}
            </p>
          )}
        </section>
      )}

      {/* ── Derniers résultats (persistants entre sessions) ── */}
      {masterPaths && (masterPaths.csvPath || masterPaths.htmlPath) && (
        <section style={{
          marginBottom: '28px', padding: '16px',
          background: '#f0f4ff', borderRadius: '10px', border: '1px solid #007aff44',
        }}>
          <h3 style={{ margin: '0 0 10px', color: '#007aff' }}>📊 Derniers résultats</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {masterPaths.htmlPath && (
              <button
                onClick={() => api.invoke('shell:open', masterPaths.htmlPath!).catch(() => {})}
                style={{
                  padding: '8px 16px', fontSize: '13px',
                  background: '#eef4ff', color: '#007aff',
                  border: '1px solid #007aff44', borderRadius: '8px', cursor: 'pointer',
                }}
              >
                🔍 Aperçu HTML
              </button>
            )}
            {masterPaths.csvPath && (
              <button
                onClick={() => api.invoke('shell:open', masterPaths.csvPath!).catch(() => {})}
                style={{
                  padding: '8px 16px', fontSize: '13px',
                  background: '#f5fff5', color: '#34c759',
                  border: '1px solid #34c75944', borderRadius: '8px', cursor: 'pointer',
                }}
              >
                📄 Ouvrir CSV
              </button>
            )}
            {masterPaths.csvPath && (
              <button
                onClick={() => {
                  const folder = masterPaths.csvPath!.replace(/[/\\][^/\\]+$/, '');
                  api.invoke('shell:open', folder).catch(() => {});
                }}
                style={{
                  padding: '8px 16px', fontSize: '13px',
                  background: '#f5f5f7', color: '#555',
                  border: '1px solid #ccc', borderRadius: '8px', cursor: 'pointer',
                }}
              >
                📁 Ouvrir le dossier
              </button>
            )}
          </div>
        </section>
      )}

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
          <strong>Pipeline email :</strong> crawl web → WHOIS → Hunter.io → LinkedIn+SMTP → GitHub → SMTP batch → pattern fallback
        </span>
      </section>
    </div>
  );
}

// ── Composant scoring ──────────────────────────────────────────────────────────

// Labels affichés dans l'UI pour chaque source email
const EMAIL_BONUS_LABELS: { key: keyof ScoringWeights['emailBonus']; label: string; color: string }[] = [
  { key: 'hunter_verified',   label: '✅ Vérifié Hunter',          color: '#34c759' },
  { key: 'linkedin_smtp',     label: '🔗 LinkedIn + SMTP',          color: '#0077b5' },
  { key: 'web_crawl',         label: '🌐 Crawlé sur le site',       color: '#30d158' },
  { key: 'catch_all',         label: '🟠 Domaine catch-all',        color: '#ff6b2b' },
  { key: 'apollo_found',      label: '🟣 Apollo.io',                color: '#bf5af2' },
  { key: 'snov_found',        label: '🔵 Snov.io',                  color: '#5ac8fa' },
  { key: 'hunter_found',      label: '🟡 Trouvé Hunter (non vérifié)',color: '#ff9f0a' },
  { key: 'whois',             label: '🔎 WHOIS',                    color: '#64d2ff' },
  { key: 'linkedin_pattern',  label: '🔸 LinkedIn (pattern)',       color: '#ff9500' },
  { key: 'pattern_verified',  label: '⚡ Pattern + SMTP',           color: '#ffd60a' },
  { key: 'pattern',           label: '⚪ Pattern auto (non vérifié)', color: '#888'  },
  { key: 'manual',            label: '✏️ Saisi manuellement',        color: '#5ac8fa' },
];

const SIZE_BONUS_LABELS: { key: keyof ScoringWeights['sizeBonus']; label: string }[] = [
  { key: '10-19',     label: '10 – 19 salariés'   },
  { key: '20-49',     label: '20 – 49 salariés'   },
  { key: '50-99',     label: '50 – 99 salariés'   },
  { key: '100-199',   label: '100 – 199 salariés' },
  { key: '200-249',   label: '200 – 249 salariés' },
  { key: '250-499',   label: '250 – 499 salariés' },
  { key: '500-999',   label: '500 – 999 salariés' },
  { key: '1000-1999', label: '1 000 – 1 999 salariés' },
  { key: '2000-4999', label: '2 000 – 4 999 salariés' },
];

function ScoringSection({
  config,
  setConfig,
}: {
  config: ScrapingConfig;
  setConfig: (c: ScrapingConfig) => void;
}) {
  // Poids actifs : soit ceux de la config, soit les défauts (pour affichage initial)
  const weights: ScoringWeights = config.scoringWeights ?? DEFAULT_SCORING_WEIGHTS;

  const setWeights = (w: ScoringWeights) => setConfig({ ...config, scoringWeights: w });

  const resetDefaults = () => setConfig({ ...config, scoringWeights: null });

  const setEmailBonus = (key: keyof ScoringWeights['emailBonus'], val: number) =>
    setWeights({ ...weights, emailBonus: { ...weights.emailBonus, [key]: val } });

  const setSizeBonus = (key: keyof ScoringWeights['sizeBonus'], val: number) =>
    setWeights({ ...weights, sizeBonus: { ...weights.sizeBonus, [key]: val } });

  const isCustom = config.scoringWeights !== null;

  return (
    <details style={{ marginBottom: '28px' }}>
      <summary style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#5856d6', padding: '4px 0' }}>
        📊 Scoring &amp; tri des résultats{' '}
        <span style={{ fontWeight: 400, fontSize: '12px', color: '#86868b' }}>— avancé, laissez par défaut</span>
      </summary>
      <div style={{ ...cardStyle, marginTop: '10px' }}>
        {isCustom && (
          <button
            onClick={resetDefaults}
            style={{
              fontSize: '12px', padding: '4px 10px', background: '#ff9f0a22',
              color: '#8a5700', border: '1px solid #ff9f0a88', borderRadius: '6px',
              cursor: 'pointer', marginBottom: '12px',
            }}
          >
            ↺ Réinitialiser les défauts
          </button>
        )}

      {/* Toggle skip scoring */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
        padding: '10px 12px', background: '#fff', borderRadius: '8px',
        border: `2px solid ${config.skipScoring ? '#ff453a' : '#007aff'}`,
        marginBottom: '14px',
      }}>
        <input
          type="checkbox"
          checked={!config.skipScoring}
          onChange={(e) => setConfig({ ...config, skipScoring: !e.target.checked })}
        />
        <span>
          <strong style={{ fontSize: '13px' }}>
            {config.skipScoring ? '⏩ Scoring désactivé' : '📊 Activer le scoring & tri automatique'}
          </strong>
          <span style={{ fontSize: '11px', color: '#888', display: 'block', marginTop: '1px' }}>
            {config.skipScoring
              ? 'Les entreprises seront exportées dans l\'ordre de collecte, sans aucun tri.'
              : 'Chaque entreprise reçoit un score basé sur la fiabilité de l\'email, la taille, l\'ATS détecté.'}
          </span>
        </span>
      </label>

      {!config.skipScoring && (
        <>
          <p style={{ fontSize: '12px', color: '#666', margin: '0 0 12px' }}>
            <strong>Score total</strong> = fraîcheur de l'offre (0–100) + pertinence stack (0–100) + bonus ci-dessous.
            {isCustom
              ? <span style={{ color: '#ff9f0a', marginLeft: '6px' }}>⚠ Poids personnalisés actifs</span>
              : <span style={{ color: '#888', marginLeft: '6px' }}>Valeurs par défaut</span>}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

            {/* ── Colonne gauche : email source bonuses ── */}
            <div>
              <p style={{ fontWeight: 600, fontSize: '12px', color: '#444', margin: '0 0 8px' }}>
                Bonus source d'email
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <tbody>
                  {EMAIL_BONUS_LABELS.map(({ key, label, color }) => (
                    <tr key={key}>
                      <td style={{ padding: '3px 0', color }}>
                        {label}
                      </td>
                      <td style={{ padding: '3px 0 3px 8px', textAlign: 'right', width: '64px' }}>
                        <input
                          type="number"
                          min={-100} max={100}
                          value={weights.emailBonus[key]}
                          onChange={(e) => setEmailBonus(key, Number(e.target.value))}
                          style={{
                            width: '56px', padding: '2px 6px', borderRadius: '4px',
                            border: weights.emailBonus[key] !== DEFAULT_SCORING_WEIGHTS.emailBonus[key]
                              ? '1px solid #ff9f0a' : '1px solid #ccc',
                            fontSize: '12px', textAlign: 'right',
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                  {/* Pénalité email invalide */}
                  <tr style={{ borderTop: '1px solid #e5e5ea', marginTop: '4px' }}>
                    <td style={{ padding: '5px 0 3px', color: '#ff453a', fontWeight: 600 }}>
                      ❌ Email invalide (pénalité)
                    </td>
                    <td style={{ padding: '5px 0 3px 8px', textAlign: 'right', width: '64px' }}>
                      <input
                        type="number"
                        min={-200} max={0}
                        value={weights.emailInvalidPenalty}
                        onChange={(e) => setWeights({ ...weights, emailInvalidPenalty: Number(e.target.value) })}
                        style={{
                          width: '56px', padding: '2px 6px', borderRadius: '4px',
                          border: weights.emailInvalidPenalty !== DEFAULT_SCORING_WEIGHTS.emailInvalidPenalty
                            ? '1px solid #ff9f0a' : '1px solid #ccc',
                          fontSize: '12px', textAlign: 'right', color: '#ff453a',
                        }}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Colonne droite : taille + ATS ── */}
            <div>
              <p style={{ fontWeight: 600, fontSize: '12px', color: '#444', margin: '0 0 8px' }}>
                Bonus taille d'entreprise
                <span style={{ fontWeight: 400, color: '#888', marginLeft: '6px' }}>
                  (sweet spot 50–500 pour les candidatures spontanées)
                </span>
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <tbody>
                  {SIZE_BONUS_LABELS.map(({ key, label }) => (
                    <tr key={key}>
                      <td style={{ padding: '3px 0', color: '#444' }}>{label}</td>
                      <td style={{ padding: '3px 0 3px 8px', textAlign: 'right', width: '64px' }}>
                        <input
                          type="number"
                          min={0} max={100}
                          value={weights.sizeBonus[key]}
                          onChange={(e) => setSizeBonus(key, Number(e.target.value))}
                          style={{
                            width: '56px', padding: '2px 6px', borderRadius: '4px',
                            border: weights.sizeBonus[key] !== DEFAULT_SCORING_WEIGHTS.sizeBonus[key]
                              ? '1px solid #ff9f0a' : '1px solid #ccc',
                            fontSize: '12px', textAlign: 'right',
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Bonus ATS */}
              <p style={{ fontWeight: 600, fontSize: '12px', color: '#444', margin: '14px 0 6px' }}>
                Autres bonus
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#444', flex: 1 }}>
                  🏢 ATS détecté (Lever, Greenhouse, Workday…)
                </span>
                <input
                  type="number"
                  min={0} max={100}
                  value={weights.atsBonus}
                  onChange={(e) => setWeights({ ...weights, atsBonus: Number(e.target.value) })}
                  style={{
                    width: '56px', padding: '2px 6px', borderRadius: '4px',
                    border: weights.atsBonus !== DEFAULT_SCORING_WEIGHTS.atsBonus
                      ? '1px solid #ff9f0a' : '1px solid #ccc',
                    fontSize: '12px', textAlign: 'right',
                  }}
                />
              </div>

              {/* Info score max */}
              <div style={{
                marginTop: '14px', padding: '10px', background: '#eef4ff',
                borderRadius: '6px', fontSize: '11px', color: '#3a5a9a',
              }}>
                <strong>Score max théorique :</strong>{' '}
                {100 + 100 + Math.max(...Object.values(weights.emailBonus))
                  + Math.max(...Object.values(weights.sizeBonus))
                  + weights.atsBonus} pts
                <br />
                <span style={{ color: '#666' }}>
                  = fraîcheur 100 + pertinence 100 + meilleur email{' '}
                  ({Math.max(...Object.values(weights.emailBonus))})
                  + meilleure taille ({Math.max(...Object.values(weights.sizeBonus))})
                  + ATS ({weights.atsBonus})
                </span>
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </details>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '12px', color: '#666', marginBottom: '4px', fontWeight: 500,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 11px', borderRadius: '8px',
  border: '1px solid #d2d2d7', fontSize: '13px', boxSizing: 'border-box',
};
// Sous-titre de groupe (pleine largeur dans une grille) pour segmenter une carte.
const subGroupStyle: React.CSSProperties = {
  gridColumn: '1 / -1', fontSize: '11px', fontWeight: 700, color: '#86868b',
  textTransform: 'uppercase', letterSpacing: '0.5px',
  marginTop: '6px', paddingBottom: '4px', borderBottom: '1px solid #f0f0f0',
};
// Résumé d'accordéon (liste déroulante) dans la zone Réglages détaillés.
const accordionSummaryStyle: React.CSSProperties = {
  cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#1d1d1f',
  padding: '10px 4px', borderBottom: '1px solid #f0f0f0', listStyle: 'none',
};
// Cellule-option (méthode email) : cliquable, surlignée si sélectionnée.
const emailMethodStyle = (on: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer',
  padding: '9px 11px', borderRadius: '8px',
  border: `1px solid ${on ? '#0a84ff' : '#e6e6eb'}`,
  background: on ? 'rgba(10,132,255,0.06)' : '#fafafa',
});

// ── Tokens de mise en page (hiérarchie claire : cartes titrées numérotées) ────
// Carte de groupe : fond blanc, bordure douce, coin arrondi, respiration.
const cardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e6e6eb', borderRadius: '12px',
  padding: '18px 20px', marginBottom: '16px',
};

// En-tête de carte avec pastille numérotée + sous-titre discret.
function SectionHeader({ n, title, subtitle }: { n: number; title: string; subtitle?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '14px' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: '22px', height: '22px', borderRadius: '50%', background: '#007aff',
        color: '#fff', fontSize: '12px', fontWeight: 700, flexShrink: 0,
      }}>{n}</span>
      <div>
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#1d1d1f', letterSpacing: '-0.01em' }}>{title}</h3>
        {subtitle && <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#86868b' }}>{subtitle}</p>}
      </div>
    </div>
  );
}
