import { useEffect, useState } from 'react';
import {
  Cpu, Send, Inbox, Gauge, Save, Radar, ScrollText, Lock, Wrench, AlertTriangle, ListChecks,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { SettingsStatus, SmtpInput, ImapInput, DkimInput, HardwareInfo } from '@candio/shared';
import { api } from '../lib/api';
import { MODEL_CATALOG, qualityStars, compatLabel, type ModelSpec } from '../lib/ollamaModels';
import OptOutManager from '../components/OptOutManager';

// DESIGN-2 : liseré latéral coloré + en-tête de section à icône (style harmonisé).
const cardAccent = (c: string): CSSProperties => ({ borderLeft: `4px solid ${c}` });
const shStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px' };

// Styles partagés des champs de formulaire (libellés clairs au-dessus des inputs).
const fieldLabel: CSSProperties = {
  display: 'block', fontSize: '13px', fontWeight: 600, color: '#333',
  margin: '10px 0 3px',
};
const fieldHint: CSSProperties = { fontWeight: 400, color: '#888', fontSize: '12px' };
// Corrige l'alignement de la checkbox (le CSS global met les input en width 100%).
const checkboxRow: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: '8px',
  fontSize: '13px', color: '#333', margin: '12px 0', cursor: 'pointer',
};
const checkboxStyle: CSSProperties = { width: 'auto', marginTop: '2px', flexShrink: 0 };
// Bandeau vert affiché quand SMTP/IMAP est déjà enregistré (champs vidés par sécurité).
const configuredBanner: CSSProperties = {
  background: '#e8f8ee', border: '1px solid #34c759', borderRadius: '8px',
  padding: '10px 12px', marginBottom: '12px', fontSize: '13px', color: '#166534', lineHeight: 1.5,
};

// Traduit les erreurs SMTP/IMAP techniques en messages actionnables en français.
function friendlyMailError(raw: string | undefined): string {
  const msg = raw ?? 'Erreur inconnue';
  const low = msg.toLowerCase();
  // Gmail : identifiants refusés (mot de passe normal au lieu d'app password).
  if (low.includes('535') || low.includes('badcredentials') || low.includes('username and password not accepted')) {
    return "Identifiants refusés par Gmail. Tu dois utiliser un MOT DE PASSE D'APPLICATION "
      + "(16 lettres, généré sur myaccount.google.com/apppasswords après avoir activé la "
      + "validation en 2 étapes) — et NON ton mot de passe Gmail habituel. Saisis-le sans les espaces.";
  }
  if (low.includes('enotfound') || low.includes('getaddrinfo') || low.includes('eai_again')) {
    return "Serveur introuvable. Vérifie l'adresse du serveur (ex: smtp.gmail.com) et ta connexion internet.";
  }
  if (low.includes('etimedout') || low.includes('timeout') || low.includes('econnrefused')) {
    return "Connexion impossible (port bloqué ou serveur injoignable). Vérifie le port (587 pour Gmail) "
      + "et que la case SSL/TLS correspond bien (décochée pour 587, cochée pour 465).";
  }
  if (low.includes('certificate') || low.includes('self-signed') || low.includes('ssl')) {
    return "Problème de certificat SSL. Essaie de décocher la case SSL/TLS et utilise le port 587.";
  }
  return msg; // sinon on garde le message brut
}

// Page Réglages : clé OpenAI, SMTP, IMAP, option scraping. Aucun secret n'est
// JAMAIS relu côté UI (seuls les drapeaux openaiKeySet/smtpConfigured/… sont
// remontés). Re-saisir = remplacer.
export default function SettingsPage() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [openaiKey, setOpenaiKey] = useState('');
  // Claude : clé Anthropic (saisie, jamais relue côté UI).
  const [anthropicKey, setAnthropicKey] = useState('');
  const [savingAnthropic, setSavingAnthropic] = useState(false);
  // Gemini / Groq : clés cloud gratuites (saisie, jamais relue côté UI).
  const [geminiKey, setGeminiKey] = useState('');
  const [savingGemini, setSavingGemini] = useState(false);
  const [groqKey, setGroqKey] = useState('');
  const [savingGroq, setSavingGroq] = useState(false);
  const [smtp, setSmtp] = useState<SmtpInput>({
    host: '', port: 587, secure: false, user: '', pass: '',
  });
  const [imap, setImap] = useState<ImapInput>({
    host: '', port: 993, secure: true, user: '', pass: '',
  });
  const [smtpTest, setSmtpTest] = useState<string | null>(null);
  // UX-4 : état du test IMAP.
  const [imapTest, setImapTest] = useState<string | null>(null);
  // H2 : état d'erreur global.
  const [error, setError] = useState<string | null>(null);
  // M3 : états de chargement.
  const [savingKey, setSavingKey] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [savingImap, setSavingImap] = useState(false);
  const [testingImap, setTestingImap] = useState(false);
  const [togglingScrap, setTogglingScrap] = useState(false);
  const [togglingAutoFollowUp, setTogglingAutoFollowUp] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  // SEC : sauvegarde chiffrée par mot de passe.
  const [encPass, setEncPass] = useState('');
  const [isEncBacking, setIsEncBacking] = useState(false);
  const [isEncRestoring, setIsEncRestoring] = useState(false);
  const [encStatus, setEncStatus] = useState<string | null>(null);
  // UX-11 : intervalle de polling.
  const [pollInterval, setPollInterval] = useState(10);
  const [savingPollInterval, setSavingPollInterval] = useState(false);
  // INT-3 : modèle IA.
  const [aiModel, setAiModel] = useState('gpt-4o');
  const [savingAiModel, setSavingAiModel] = useState(false);
  // OLLAMA-1 : provider IA local.
  const [aiProvider, setAiProvider] = useState('openai');
  const [ollamaModel, setOllamaModel] = useState('llama3.2:3b');
  const [ollamaHost, setOllamaHost] = useState('http://127.0.0.1:11434');
  const [savingOllama, setSavingOllama] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
  const [ollamaMessage, setOllamaMessage] = useState<string | null>(null);
  // GPU-SETUP : mise en place du GPU Intel Arc (Ollama IPEX-LLM).
  const [gpuBusy, setGpuBusy] = useState(false);
  const [gpuMsg, setGpuMsg] = useState('');
  // OLLAMA-2 : détection hardware.
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [detectingHw, setDetectingHw] = useState(false);
  const [hwError, setHwError] = useState<string | null>(null);
  // OLLAMA-2 : téléchargement de modèles — progress par modelId.
  const [pulling, setPulling] = useState<Record<string, { progress: number; status: string }>>({});
  // ADM-2 : visionneuse de logs.
  const [logs, setLogs] = useState<string[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  // ADM-3 : reset.
  const [resetting, setResetting] = useState(false);
  // (Limite quotidienne désormais 100 % automatique — plus de réglage manuel.)
  // SEC-N1 : effacer la clé OpenAI.
  const [clearingKey, setClearingKey] = useState(false);
  // (Hunter.io déplacé dans la page Scraping.)
  // SEC-M1 : verrouillage automatique.
  const [lockPin, setLockPin] = useState('');
  const [lockTimeout, setLockTimeout] = useState(15);
  const [savingLock, setSavingLock] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  // ADM-S2 : santé configuration.
  // (les valeurs viennent de settingsStatus)
  // MOD-05 : état du formulaire DKIM.
  const [dkim, setDkim] = useState<DkimInput>({ domainName: '', keySelector: '', privateKey: '' });
  const [savingDkim, setSavingDkim] = useState(false);
  const [dkimMessage, setDkimMessage] = useState<string | null>(null);

  // ADM-S13 : maintenance.
  const [maintenanceStats, setMaintenanceStats] = useState<{ companiesWithoutEmail: number; failedApplications: number; oldArchivedCampaigns: number } | null>(null);
  const [loadingMaintenance, setLoadingMaintenance] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);

  const load = async () => {
    const st = await api.invoke('settings:getStatus');
    setStatus(st);
    // UX-11 : sync l'intervalle depuis le statut.
    setPollInterval(st.imapPollIntervalMinutes);
    // INT-3 : sync le modèle depuis le statut.
    setAiModel(st.aiModel);
    // OLLAMA-1 : sync provider + config Ollama.
    setAiProvider(st.aiProvider ?? 'openai');
    setOllamaModel(st.ollamaModel ?? 'llama3.2:3b');
    setOllamaHost(st.ollamaHost ?? 'http://127.0.0.1:11434');
    // SEC-M1 : sync le timeout de verrouillage.
    setLockTimeout(st.lockTimeoutMinutes ?? 15);
  };
  useEffect(() => { void load(); }, []);

  // OLLAMA-1 : charge AUTO les modèles installés dès qu'Ollama est sélectionné →
  // affiche un menu déroulant clair au lieu d'un champ texte vide (UX confuse).
  useEffect(() => {
    if (aiProvider === 'ollama' && ollamaModels.length === 0) {
      api.invoke('settings:getOllamaModels')
        .then(({ models }) => setOllamaModels(models))
        .catch(() => { /* Ollama non lancé → le bouton « Lister » reste dispo */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiProvider]);

  // B5 : réinitialise les résultats des tests dès que la config change.
  useEffect(() => { setSmtpTest(null); }, [smtp]);
  useEffect(() => { setImapTest(null); }, [imap]);

  const smtpReady = smtp.host && smtp.user && smtp.pass;
  const imapReady = imap.host && imap.user && imap.pass;

  const saveOpenai = async () => {
    if (!openaiKey) return;
    setSavingKey(true);
    setError(null);
    try {
      await api.invoke('settings:setOpenaiKey', { key: openaiKey });
      setOpenaiKey('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde');
    } finally { setSavingKey(false); }
  };

  // Claude : enregistrer / effacer la clé Anthropic.
  const saveAnthropic = async () => {
    if (!anthropicKey) return;
    setSavingAnthropic(true);
    setError(null);
    try {
      await api.invoke('settings:setAnthropicKey', { key: anthropicKey });
      setAnthropicKey('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde');
    } finally { setSavingAnthropic(false); }
  };

  const clearAnthropic = async () => {
    setSavingAnthropic(true);
    try {
      await api.invoke('settings:clearAnthropicKey');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setSavingAnthropic(false); }
  };

  // Gemini : enregistrer / effacer la clé Google.
  const saveGemini = async () => {
    if (!geminiKey) return;
    setSavingGemini(true);
    setError(null);
    try {
      await api.invoke('settings:setGeminiKey', { key: geminiKey });
      setGeminiKey('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde');
    } finally { setSavingGemini(false); }
  };
  const clearGemini = async () => {
    setSavingGemini(true);
    try {
      await api.invoke('settings:clearGeminiKey');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setSavingGemini(false); }
  };

  // Groq : enregistrer / effacer la clé.
  const saveGroq = async () => {
    if (!groqKey) return;
    setSavingGroq(true);
    setError(null);
    try {
      await api.invoke('settings:setGroqKey', { key: groqKey });
      setGroqKey('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde');
    } finally { setSavingGroq(false); }
  };
  const clearGroq = async () => {
    setSavingGroq(true);
    try {
      await api.invoke('settings:clearGroqKey');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setSavingGroq(false); }
  };

  const saveSmtp = async () => {
    if (!smtpReady) return;
    setSavingSmtp(true);
    setError(null);
    try {
      await api.invoke('settings:setSmtp', smtp);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde SMTP');
    } finally { setSavingSmtp(false); }
  };

  const testSmtp = async () => {
    setTestingSmtp(true);
    try {
      const result = await api.invoke('settings:testSmtp', smtp);
      setSmtpTest(result.ok ? '✓ Connexion OK' : `✗ ${friendlyMailError(result.error)}`);
    } finally { setTestingSmtp(false); }
  };

  const saveImap = async () => {
    if (!imapReady) return;
    setSavingImap(true);
    setError(null);
    try {
      await api.invoke('settings:setImap', imap);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde IMAP');
    } finally { setSavingImap(false); }
  };

  // UX-4 : test IMAP.
  const testImap = async () => {
    setTestingImap(true);
    try {
      const result = await api.invoke('settings:testImap', imap);
      setImapTest(result.ok ? '✓ Connexion OK' : `✗ ${friendlyMailError(result.error)}`);
    } finally { setTestingImap(false); }
  };

  const backup = async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);
    setBackupStatus(null);
    try {
      const result = await api.invoke('db:backup');
      setBackupStatus(result ? `✓ Sauvegardé : ${result.path}` : null);
    } catch (e) {
      setBackupStatus(`✗ ${e instanceof Error ? e.message : 'Erreur lors de la sauvegarde'}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  // SEC-1 : restauration d'une sauvegarde.
  const restore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    setRestoreStatus(null);
    try {
      const result = await api.invoke('db:restore');
      setRestoreStatus(result.success
        ? '✓ Sauvegarde restaurée avec succès'
        : `✗ ${result.error ?? 'Erreur lors de la restauration'}`
      );
    } catch (e) {
      setRestoreStatus(`✗ ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally {
      setIsRestoring(false);
    }
  };

  // SEC : sauvegarde chiffrée par mot de passe (AES-256-GCM, portable).
  const backupEncrypted = async () => {
    if (isEncBacking) return;
    if (encPass.length < 8) { setEncStatus('✗ Mot de passe trop court (8 caractères minimum).'); return; }
    setIsEncBacking(true); setEncStatus(null);
    try {
      const result = await api.invoke('db:backupEncrypted', { passphrase: encPass });
      setEncStatus(result ? `✓ Sauvegarde chiffrée : ${result.path}` : null);
      if (result) setEncPass('');
    } catch (e) {
      setEncStatus(`✗ ${e instanceof Error ? e.message : 'Erreur lors de la sauvegarde chiffrée'}`);
    } finally { setIsEncBacking(false); }
  };

  const restoreEncrypted = async () => {
    if (isEncRestoring) return;
    if (!encPass) { setEncStatus('✗ Saisissez le mot de passe de la sauvegarde.'); return; }
    setIsEncRestoring(true); setEncStatus(null);
    try {
      const result = await api.invoke('db:restoreEncrypted', { passphrase: encPass });
      setEncStatus(result.success
        ? '✓ Sauvegarde chiffrée restaurée — redémarrage…'
        : `✗ ${result.error ?? 'Erreur lors de la restauration'}`);
    } catch (e) {
      setEncStatus(`✗ ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally { setIsEncRestoring(false); }
  };

  const toggleAutoFollowUp = async () => {
    if (!status || togglingAutoFollowUp) return;
    setTogglingAutoFollowUp(true);
    setError(null);
    try {
      await api.invoke('settings:setAutoFollowUp', { enabled: !status.autoFollowUpEnabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setTogglingAutoFollowUp(false); }
  };

  const toggleScraping = async () => {
    if (!status || togglingScrap) return;
    setTogglingScrap(true);
    setError(null);
    try {
      await api.invoke('settings:setScrapingEnabled', { enabled: !status.scrapingEnabled });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setTogglingScrap(false); }
  };

  // UX-11 : enregistrer l'intervalle de polling.
  const savePollInterval = async () => {
    setSavingPollInterval(true);
    try {
      await api.invoke('settings:setImapPollInterval', { minutes: pollInterval });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setSavingPollInterval(false); }
  };

  // INT-3 : enregistrer le modèle IA.
  const saveAiModel = async () => {
    setSavingAiModel(true);
    try {
      await api.invoke('settings:setAiModel', { model: aiModel });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally { setSavingAiModel(false); }
  };

  // OLLAMA-2 : détecte le hardware et charge les modèles installés en une fois.
  const analyzeHardware = async () => {
    setDetectingHw(true);
    setHwError(null);
    try {
      const [hw, { models }] = await Promise.all([
        api.invoke('settings:getHardwareInfo'),
        api.invoke('settings:getOllamaModels').catch(() => ({ models: [] as string[] })),
      ]);
      setHardware(hw);
      setOllamaModels(models);
    } catch (e) {
      setHwError(e instanceof Error ? e.message : 'Erreur de détection');
    } finally {
      setDetectingHw(false);
    }
  };

  // OLLAMA-2 : télécharge un modèle via l'API Ollama en streaming (NDJSON).
  const pullModel = async (modelId: string) => {
    const host = ollamaHost.replace(/\/$/, '');
    setPulling((prev) => ({ ...prev, [modelId]: { progress: 0, status: 'Connexion à Ollama…' } }));
    try {
      const res = await fetch(`${host}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId }),
      });
      if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Stream non disponible');
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line) as { status?: string; total?: number; completed?: number };
            const pct = d.total && d.completed ? Math.round((d.completed / d.total) * 100) : undefined;
            // Libellés français des étapes Ollama
            const statusFr: Record<string, string> = {
              'pulling manifest': 'Récupération du manifeste…',
              'verifying sha256 digest': 'Vérification de l\'intégrité…',
              'writing manifest': 'Écriture du manifeste…',
              'removing any unused layers': 'Nettoyage…',
              'success': '✅ Téléchargement terminé !',
            };
            const label = d.status
              ? (statusFr[d.status] ?? (d.status.startsWith('pulling ') ? 'Téléchargement en cours…' : d.status))
              : '';
            setPulling((prev) => ({
              ...prev,
              [modelId]: { progress: pct ?? prev[modelId]?.progress ?? 0, status: label },
            }));
            if (d.status === 'success') {
              setOllamaModels((prev) => [...new Set([...prev, modelId])]);
            }
          } catch { /* ligne NDJSON incomplète */ }
        }
      }
    } catch (e) {
      setPulling((prev) => ({
        ...prev,
        [modelId]: { progress: 0, status: `❌ ${e instanceof Error ? e.message : 'Erreur'}` },
      }));
      return;
    }
    // Retire l'état de pull après 3s (laisse le message "terminé" visible)
    setTimeout(() => {
      setPulling((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }, 3000);
  };

  // GPU-SETUP : installe + démarre Ollama sur le GPU Intel Arc (un clic).
  const setupIntelGpu = async () => {
    setGpuBusy(true);
    setGpuMsg('⚙️ Démarrage…');
    try {
      const r = await api.invoke('ollama:setupIntelGpu');
      setGpuMsg(r.message);
      fetchOllamaModels();
    } catch (e) {
      setGpuMsg('❌ ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGpuBusy(false);
    }
  };
  // Affiche les étapes live de la mise en place GPU (poussées via 'scraping:progress').
  useEffect(() => {
    return api.on('scraping:progress', (data) => {
      if (gpuBusy && !data.done) setGpuMsg(data.line);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpuBusy]);

  // OLLAMA-1 : récupère la liste des modèles disponibles sur Ollama.
  const fetchOllamaModels = async () => {
    setLoadingOllamaModels(true);
    setOllamaMessage(null);
    try {
      const { models } = await api.invoke('settings:getOllamaModels');
      setOllamaModels(models);
      if (models.length === 0) setOllamaMessage('Aucun modèle installé. Lance : ollama pull llama3.2:3b');
    } catch (e) {
      setOllamaMessage(e instanceof Error ? e.message : 'Erreur Ollama');
    } finally { setLoadingOllamaModels(false); }
  };

  // OLLAMA-1 : sauvegarde provider + config Ollama en une fois.
  const saveOllamaConfig = async () => {
    setSavingOllama(true);
    setOllamaMessage(null);
    try {
      await api.invoke('settings:setAiProvider', { provider: aiProvider });
      if (aiProvider === 'ollama') {
        await api.invoke('settings:setOllamaHost', { host: ollamaHost });
        await api.invoke('settings:setOllamaModel', { model: ollamaModel });
      }
      await load();
      setOllamaMessage('Configuration enregistrée.');
    } catch (e) {
      setOllamaMessage(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde');
    } finally { setSavingOllama(false); }
  };

  // ADM-2 : afficher les logs.
  const showLogs = async () => {
    if (loadingLogs) return;
    setLoadingLogs(true);
    try {
      const lines = await api.invoke('logs:tail', { lines: 200 });
      setLogs(lines);
    } finally { setLoadingLogs(false); }
  };

  // ADM-4v3 : export global JSON.
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const exportAll = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportStatus(null);
    try {
      const result = await api.invoke('db:exportAll');
      setExportStatus(result ? `✓ Export créé : ${result.path}` : null);
    } catch (e) {
      setExportStatus(`✗ ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally {
      setIsExporting(false);
    }
  };

  // MOD-05 : enregistrer la config DKIM.
  const saveDkim = async () => {
    if (!dkim.domainName || !dkim.keySelector || !dkim.privateKey) return;
    setSavingDkim(true);
    setDkimMessage(null);
    try {
      await api.invoke('settings:setDkim', dkim);
      setDkim({ domainName: '', keySelector: '', privateKey: '' });
      setDkimMessage('Configuration DKIM enregistrée.');
      await load();
    } catch (e) {
      setDkimMessage(`Erreur : ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally { setSavingDkim(false); }
  };

  // MOD-05 : effacer la config DKIM.
  const clearDkim = async () => {
    setSavingDkim(true);
    setDkimMessage(null);
    try {
      await api.invoke('settings:clearDkim');
      setDkimMessage('Configuration DKIM supprimée.');
      await load();
    } catch (e) {
      setDkimMessage(`Erreur : ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally { setSavingDkim(false); }
  };

  // (Limite quotidienne désormais automatique — voir RAMP_CYCLE dans secrets.ts.)

  // ADM-3 : réinitialiser les données.
  // BUG-01 fix : confirmation obligatoire avant suppression irréversible de toutes les données.
  const resetData = async () => {
    if (resetting) return;
    const confirmed = await api.invoke('dialog:confirm', {
      title: 'Réinitialisation irréversible',
      message:
        'ATTENTION : toutes vos données (campagnes, entreprises, candidatures) seront supprimées définitivement.\n\nCette action est irréversible et ne peut pas être annulée.',
    });
    if (!confirmed) return;
    setResetting(true);
    try {
      await api.invoke('db:reset');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la réinitialisation');
    } finally { setResetting(false); }
  };

  // SEC-N1 : effacer la clé OpenAI.
  const clearKey = async () => {
    if (clearingKey) return;
    setClearingKey(true);
    try {
      await api.invoke('settings:clearOpenaiKey');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la suppression');
    } finally { setClearingKey(false); }
  };

  // (Hunter.io déplacé dans la page Scraping — handlers retirés d'ici.)

  // SEC-M1 : enregistrer le PIN de verrouillage.
  const saveLockPin = async () => {
    if (!lockPin) return;
    setSavingLock(true);
    setLockMessage(null);
    try {
      await api.invoke('settings:setLockPin', { pin: lockPin });
      await api.invoke('settings:setLockTimeout', { minutes: lockTimeout });
      setLockPin('');
      setLockMessage('PIN de verrouillage configuré.');
      await load();
    } catch (e) {
      setLockMessage(`Erreur : ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally { setSavingLock(false); }
  };

  // SEC-M1 : désactiver le verrouillage.
  const clearLock = async () => {
    setSavingLock(true);
    setLockMessage(null);
    try {
      await api.invoke('settings:clearLockPin');
      setLockMessage('Verrouillage désactivé.');
      await load();
    } catch (e) {
      setLockMessage(`Erreur : ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally { setSavingLock(false); }
  };

  // ADM-S13 : charger les statistiques de maintenance.
  const loadMaintenanceStats = async () => {
    if (loadingMaintenance) return;
    setLoadingMaintenance(true);
    setMaintenanceMessage(null);
    try {
      const stats = await api.invoke('maintenance:getStats');
      setMaintenanceStats(stats);
    } catch (e) {
      setMaintenanceMessage(`Erreur : ${e instanceof Error ? e.message : 'Erreur'}`);
    } finally { setLoadingMaintenance(false); }
  };

  // ADM-S13 : purge des candidatures FAILED.
  const purgeFailed = async () => {
    try {
      const r = await api.invoke('maintenance:purgeFailedApplications');
      setMaintenanceMessage(`${r.deleted} candidature(s) FAILED supprimée(s).`);
      await loadMaintenanceStats();
    } catch (e) {
      setMaintenanceMessage(`Erreur : ${e instanceof Error ? e.message : 'Erreur'}`);
    }
  };

  // ADM-S13 : purge des campagnes archivées depuis plus de 90 jours.
  const purgeOldArchived = async () => {
    try {
      const r = await api.invoke('maintenance:purgeOldArchived', { daysOld: 90 });
      setMaintenanceMessage(`${r.deleted} campagne(s) archivée(s) supprimée(s).`);
      await loadMaintenanceStats();
    } catch (e) {
      setMaintenanceMessage(`Erreur : ${e instanceof Error ? e.message : 'Erreur'}`);
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>Réglages</h2>
        <div className="page-sub">Moteur IA, envoi (SMTP), détection des réponses (IMAP), sécurité et maintenance.</div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="settings-grid">
      {/* OLLAMA-1 : section provider IA (OpenAI ou Ollama local). */}
      <div className="card span-all" style={cardAccent('#5856d6')}>
        <h3 style={shStyle}><Cpu size={17} color="#5856d6" />Moteur IA</h3>
        <p style={{ fontSize: '13px', color: '#555', margin: '0 0 12px', lineHeight: 1.5 }}>
          Ce moteur sert à <strong>rédiger les emails de candidature</strong> et à
          <strong> analyser les CV</strong>. Les modèles utilisés pour le <strong>scraping</strong> et
          les <strong>descriptions d'entreprise</strong> se règlent dans la page <em>Scraping</em>.
          <br />
          💡 Les modèles Ollama sont <strong>partagés sur ta machine</strong> : un modèle téléchargé
          ici (ou dans la page Scraping) est ensuite disponible partout — pas besoin de le retélécharger.
        </p>

        {/* Toggle OpenAI / Ollama */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
          <label style={{ cursor: 'pointer', fontWeight: aiProvider === 'openai' ? 700 : 400 }}>
            <input
              type="radio" name="aiProvider" value="openai"
              checked={aiProvider === 'openai'}
              onChange={() => setAiProvider('openai')}
              style={{ marginRight: '6px' }}
            />
            OpenAI (cloud)
          </label>
          <label style={{ cursor: 'pointer', fontWeight: aiProvider === 'anthropic' ? 700 : 400 }}>
            <input
              type="radio" name="aiProvider" value="anthropic"
              checked={aiProvider === 'anthropic'}
              onChange={() => setAiProvider('anthropic')}
              style={{ marginRight: '6px' }}
            />
            Claude (cloud)
          </label>
          <label style={{ cursor: 'pointer', fontWeight: aiProvider === 'gemini' ? 700 : 400 }}>
            <input
              type="radio" name="aiProvider" value="gemini"
              checked={aiProvider === 'gemini'}
              onChange={() => setAiProvider('gemini')}
              style={{ marginRight: '6px' }}
            />
            Gemini (gratuit)
          </label>
          <label style={{ cursor: 'pointer', fontWeight: aiProvider === 'groq' ? 700 : 400 }}>
            <input
              type="radio" name="aiProvider" value="groq"
              checked={aiProvider === 'groq'}
              onChange={() => setAiProvider('groq')}
              style={{ marginRight: '6px' }}
            />
            Groq (gratuit)
          </label>
          <label style={{ cursor: 'pointer', fontWeight: aiProvider === 'ollama' ? 700 : 400 }}>
            <input
              type="radio" name="aiProvider" value="ollama"
              checked={aiProvider === 'ollama'}
              onChange={() => setAiProvider('ollama')}
              style={{ marginRight: '6px' }}
            />
            Ollama (local, gratuit)
          </label>
        </div>

        {/* Section OpenAI */}
        {aiProvider === 'openai' && (
          <>
            <h4>Clé OpenAI {status?.openaiKeySet && '✓'}</h4>
            <input
              type="password"
              placeholder={status?.openaiKeySet ? '(clé déjà enregistrée — saisir pour remplacer)' : 'sk-...'}
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
            <button onClick={saveOpenai} disabled={!openaiKey || savingKey}>
              {savingKey ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {status?.openaiKeySet && (
              <button
                onClick={clearKey}
                disabled={clearingKey}
                style={{ marginLeft: '8px', background: '#ff453a', color: '#fff', fontSize: '12px' }}
              >
                {clearingKey ? 'Suppression…' : 'Effacer la clé'}
              </button>
            )}

            <h4 style={{ marginTop: '12px' }}>Modèle OpenAI</h4>
            <select value={aiModel.startsWith('gpt') ? aiModel : 'gpt-4o'} onChange={(e) => setAiModel(e.target.value)}>
              <option value="gpt-4o">GPT-4o (recommandé)</option>
              <option value="gpt-4o-mini">GPT-4o mini (plus rapide, moins cher)</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo (économique)</option>
            </select>
            <button onClick={saveAiModel} disabled={savingAiModel} style={{ marginLeft: '8px' }}>
              {savingAiModel ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {status && <small style={{ marginLeft: '8px', color: '#888' }}>Actuel : {status.aiModel}</small>}
          </>
        )}

        {/* Section Claude (Anthropic) */}
        {aiProvider === 'anthropic' && (
          <>
            <h4>Clé Anthropic {status?.anthropicKeySet && '✓'}</h4>
            <p style={{ fontSize: '12px', color: '#888', margin: '0 0 6px' }}>
              Depuis console.anthropic.com → API Keys. La clé commence par « sk-ant- ».
            </p>
            <input
              type="password"
              placeholder={status?.anthropicKeySet ? '(clé déjà enregistrée — saisir pour remplacer)' : 'sk-ant-...'}
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
            />
            <button onClick={saveAnthropic} disabled={!anthropicKey || savingAnthropic}>
              {savingAnthropic ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {status?.anthropicKeySet && (
              <button
                onClick={clearAnthropic}
                disabled={savingAnthropic}
                style={{ marginLeft: '8px', background: '#ff453a', color: '#fff', fontSize: '12px' }}
              >
                Effacer la clé
              </button>
            )}

            <h4 style={{ marginTop: '12px' }}>Modèle Claude</h4>
            <select value={aiModel.startsWith('claude') ? aiModel : 'claude-sonnet-4-6'} onChange={(e) => setAiModel(e.target.value)}>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (qualité max)</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (rapide)</option>
            </select>
            <button onClick={saveAiModel} disabled={savingAiModel} style={{ marginLeft: '8px' }}>
              {savingAiModel ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {status && <small style={{ marginLeft: '8px', color: '#888' }}>Actuel : {status.aiModel}</small>}
          </>
        )}

        {/* Section Gemini (Google, gratuit) */}
        {aiProvider === 'gemini' && (
          <>
            <h4>Clé Google Gemini {status?.geminiKeySet && '✓'}</h4>
            <p style={{ fontSize: '12px', color: '#888', margin: '0 0 6px' }}>
              Gratuit : aistudio.google.com → « Get API key ». ⚠️ Le palier gratuit peut réutiliser
              tes données (CV) pour améliorer les modèles Google.
            </p>
            <input
              type="password"
              placeholder={status?.geminiKeySet ? '(clé déjà enregistrée — saisir pour remplacer)' : 'AIza...'}
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
            <button onClick={saveGemini} disabled={!geminiKey || savingGemini}>
              {savingGemini ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {status?.geminiKeySet && (
              <button onClick={clearGemini} disabled={savingGemini}
                style={{ marginLeft: '8px', background: '#ff453a', color: '#fff', fontSize: '12px' }}>
                Effacer la clé
              </button>
            )}
            <h4 style={{ marginTop: '12px' }}>Modèle Gemini</h4>
            <select value={aiModel.startsWith('gemini') ? aiModel : 'gemini-2.0-flash'} onChange={(e) => setAiModel(e.target.value)}>
              <option value="gemini-2.0-flash">Gemini 2.0 Flash (gratuit, recommandé)</option>
              <option value="gemini-1.5-flash">Gemini 1.5 Flash (gratuit)</option>
            </select>
            <button onClick={saveAiModel} disabled={savingAiModel} style={{ marginLeft: '8px' }}>
              {savingAiModel ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {status && <small style={{ marginLeft: '8px', color: '#888' }}>Actuel : {status.aiModel}</small>}
          </>
        )}

        {/* Section Groq (gratuit, rapide) */}
        {aiProvider === 'groq' && (
          <>
            <h4>Clé Groq {status?.groqKeySet && '✓'}</h4>
            <p style={{ fontSize: '12px', color: '#888', margin: '0 0 6px' }}>
              Gratuit : console.groq.com → « API Keys ». La clé commence par « gsk_ ».
            </p>
            <input
              type="password"
              placeholder={status?.groqKeySet ? '(clé déjà enregistrée — saisir pour remplacer)' : 'gsk_...'}
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
            />
            <button onClick={saveGroq} disabled={!groqKey || savingGroq}>
              {savingGroq ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {status?.groqKeySet && (
              <button onClick={clearGroq} disabled={savingGroq}
                style={{ marginLeft: '8px', background: '#ff453a', color: '#fff', fontSize: '12px' }}>
                Effacer la clé
              </button>
            )}
            <h4 style={{ marginTop: '12px' }}>Modèle Groq</h4>
            <select value={aiModel.startsWith('llama') ? aiModel : 'llama-3.3-70b-versatile'} onChange={(e) => setAiModel(e.target.value)}>
              <option value="llama-3.3-70b-versatile">Llama 3.3 70B (gratuit, recommandé)</option>
              <option value="llama-3.1-8b-instant">Llama 3.1 8B (gratuit, instantané)</option>
            </select>
            <button onClick={saveAiModel} disabled={savingAiModel} style={{ marginLeft: '8px' }}>
              {savingAiModel ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {status && <small style={{ marginLeft: '8px', color: '#888' }}>Actuel : {status.aiModel}</small>}
          </>
        )}

        {/* Section Ollama */}
        {aiProvider === 'ollama' && (
          <>
            {/* GPU-SETUP : accélération GPU Intel Arc en un clic (Ollama IPEX-LLM). */}
            <div style={{ background: '#f0f7ff', border: '1px solid #0a84ff33', borderRadius: '8px',
              padding: '10px 14px', marginBottom: '14px' }}>
              <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>⚡ Accélération GPU (Intel Arc)</div>
              <p style={{ fontSize: '12px', color: '#555', margin: '0 0 8px', lineHeight: 1.5 }}>
                Par défaut, Ollama tourne sur le CPU (lent) sur les GPU Intel Arc. Ce bouton installe
                et démarre une version d'Ollama qui utilise ton <strong>GPU Intel Arc</strong> (≈3× plus rapide),
                en réutilisant tes modèles déjà téléchargés. Réservé aux PC avec GPU Intel Arc.
              </p>
              <button onClick={() => void setupIntelGpu()} disabled={gpuBusy}
                style={{ fontSize: '13px', padding: '7px 14px', borderRadius: '6px', border: 'none',
                  background: gpuBusy ? '#ccc' : '#0a84ff', color: '#fff', cursor: gpuBusy ? 'default' : 'pointer' }}>
                {gpuBusy ? '⏳ Mise en place… (1-2 min)' : '⚡ Activer mon GPU Intel Arc'}
              </button>
              {gpuMsg && <p style={{ fontSize: '12px', color: gpuMsg.startsWith('❌') ? '#ff453a' : '#555', margin: '8px 0 0' }}>{gpuMsg}</p>}
            </div>

            <h4>Hôte Ollama</h4>
            <input
              placeholder="http://127.0.0.1:11434"
              value={ollamaHost}
              onChange={(e) => setOllamaHost(e.target.value)}
              style={{ width: '240px' }}
            />

            {/* ── OLLAMA-2 : Sélecteur de modèle avec recommandations hardware ── */}
            <h4 style={{ marginTop: '16px' }}>Modèle — recommandations pour ta machine</h4>

            <button
              onClick={analyzeHardware}
              disabled={detectingHw}
              style={{ fontSize: '13px', marginBottom: '10px' }}
            >
              {detectingHw ? '🔍 Analyse en cours…' : '🔍 Analyser ma machine'}
            </button>
            {hwError && <p style={{ color: '#ff453a', fontSize: '12px', marginBottom: '8px' }}>{hwError}</p>}

            {/* Résumé hardware — couleurs explicites pour compatibilité thème clair/sombre */}
            {hardware && (
              <div style={{
                background: '#1c1c1e', border: '1px solid #3a3a3c', borderRadius: '8px',
                padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#e0e0e0',
              }}>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', color: '#e0e0e0' }}>
                  <span>🖥️ RAM : <strong style={{ color: '#fff' }}>{hardware.totalRamGb} GB</strong></span>
                  {hardware.gpuName
                    ? <span>🎮 GPU : <strong style={{ color: '#fff' }}>{hardware.gpuName}</strong>
                        {hardware.gpuVramGb !== null && <> · <strong style={{ color: '#34c759' }}>{hardware.gpuVramGb} GB VRAM</strong></>}
                      </span>
                    : <span style={{ color: '#aaa' }}>🎮 GPU : non détecté — inférence CPU</span>
                  }
                </div>
                {hardware.gpuVendor === 'intel' && (
                  <p style={{ color: '#ff9f0a', fontSize: '11px', margin: '6px 0 0' }}>
                    ⚠️ Intel Arc : support Ollama partiel sous Windows. Les modèles fonctionnent en CPU si le driver SYCL n'est pas installé.
                  </p>
                )}
              </div>
            )}

            {/* Liste des recommandations */}
            {hardware && (() => {
              const gpuModels   = MODEL_CATALOG.filter((m) => compatLabel(m, hardware) === 'gpu');
              const cpuModels   = MODEL_CATALOG.filter((m) => compatLabel(m, hardware) === 'cpu');
              const installedSet = new Set(ollamaModels);

              const renderModel = (spec: ModelSpec) => {
                const isInstalled = installedSet.has(spec.id)
                  || ollamaModels.some((m) => m.startsWith(spec.id.split(':')[0]));
                const isSelected  = ollamaModel === spec.id;
                const pullState   = pulling[spec.id];
                const isPulling   = !!pullState;

                return (
                  <div
                    key={spec.id}
                    onClick={() => setOllamaModel(spec.id)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '10px',
                      padding: '10px 12px', borderRadius: '6px', cursor: 'pointer',
                      border: `1px solid ${isSelected ? '#0a84ff' : '#3a3a3c'}`,
                      background: isSelected ? 'rgba(10,132,255,0.12)' : '#2c2c2e',
                      marginBottom: '6px', color: '#e0e0e0',
                    }}
                  >
                    {/* Indicateur sélection */}
                    <span style={{ fontSize: '16px', marginTop: '1px', flexShrink: 0 }}>
                      {isSelected ? '🔵' : '⚪'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* En-tête : nom + badges */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '14px', color: '#fff' }}>{spec.name}</strong>
                        <code style={{ fontSize: '11px', color: '#888' }}>{spec.id}</code>
                        {spec.badge && (
                          <span style={{
                            fontSize: '11px', padding: '1px 6px', borderRadius: '4px',
                            background: spec.quality === 5 ? 'rgba(52,199,89,0.15)' : 'rgba(255,159,10,0.15)',
                            color: spec.quality === 5 ? '#34c759' : '#ff9f0a',
                          }}>{spec.badge}</span>
                        )}
                        {isInstalled && (
                          <span style={{
                            fontSize: '11px', padding: '1px 6px', borderRadius: '4px',
                            background: 'rgba(10,132,255,0.15)', color: '#0a84ff',
                          }}>✓ Installé</span>
                        )}
                      </div>

                      {/* Étoiles qualité */}
                      <div style={{ color: '#f5c518', fontSize: '13px', margin: '3px 0' }}>
                        {qualityStars(spec.quality)}
                        <span style={{ color: '#888', marginLeft: '8px', fontSize: '11px' }}>qualité rédaction française</span>
                      </div>

                      {/* Description */}
                      <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>{spec.note}</div>

                      {/* Infos techniques */}
                      <div style={{ fontSize: '11px', color: '#666', display: 'flex', gap: '12px' }}>
                        <span>💾 {spec.sizeLabel}</span>
                        <span>🎮 {spec.vramGb} GB VRAM</span>
                        <span>🖥️ {spec.ramGb} GB RAM CPU</span>
                      </div>

                      {/* Zone téléchargement */}
                      {!isInstalled && (
                        <div style={{ marginTop: '8px' }}>
                          {!isPulling ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); void pullModel(spec.id); }}
                              style={{
                                fontSize: '12px', padding: '4px 12px',
                                background: '#0a84ff', color: '#fff',
                                border: 'none', borderRadius: '6px', cursor: 'pointer',
                              }}
                            >
                              ⬇ Télécharger ({spec.sizeLabel})
                            </button>
                          ) : (
                            <div onClick={(e) => e.stopPropagation()}>
                              {/* Barre de progression */}
                              <div style={{
                                height: '6px', background: '#3a3a3c', borderRadius: '3px',
                                marginBottom: '4px', overflow: 'hidden',
                              }}>
                                <div style={{
                                  height: '100%', borderRadius: '3px',
                                  background: pullState.status.startsWith('❌') ? '#ff453a' : '#0a84ff',
                                  width: `${pullState.progress || (pullState.status.startsWith('✅') ? 100 : 5)}%`,
                                  transition: 'width 0.3s ease',
                                }} />
                              </div>
                              <div style={{ fontSize: '11px', color: '#aaa', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{pullState.status}</span>
                                {pullState.progress > 0 && (
                                  <span style={{ color: '#fff' }}>{pullState.progress}%</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              };

              return (
                <div>
                  {gpuModels.length > 0 && (
                    <>
                      <p style={{ fontSize: '12px', color: '#34c759', margin: '0 0 8px', fontWeight: 600 }}>
                        🚀 Compatible GPU — inférence rapide
                      </p>
                      {gpuModels.sort((a, b) => b.quality - a.quality).map(renderModel)}
                    </>
                  )}
                  {cpuModels.length > 0 && (
                    <>
                      <p style={{ fontSize: '12px', color: '#ff9f0a', margin: '12px 0 8px', fontWeight: 600 }}>
                        🐢 CPU uniquement — fonctionne mais plus lent
                      </p>
                      {cpuModels.sort((a, b) => b.quality - a.quality).map(renderModel)}
                    </>
                  )}
                </div>
              );
            })()}

            {/* Sélecteur manuel en fallback si pas encore analysé */}
            {!hardware && (
              <div style={{ marginTop: '4px' }}>
                {ollamaModels.length > 0
                  ? <select value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} style={{ minWidth: '200px' }}>
                      {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  : <input placeholder="llama3.2:3b" value={ollamaModel}
                      onChange={(e) => setOllamaModel(e.target.value)} style={{ width: '200px' }} />
                }
                <button onClick={fetchOllamaModels} disabled={loadingOllamaModels}
                  style={{ marginLeft: '8px', fontSize: '12px' }}>
                  {loadingOllamaModels ? 'Chargement…' : 'Lister les modèles'}
                </button>
              </div>
            )}

            {/* Modèle actuellement sélectionné */}
            {hardware && (
              <p style={{ fontSize: '12px', color: '#888', marginTop: '10px' }}>
                Modèle sélectionné : <strong style={{ color: '#fff' }}>{ollamaModel}</strong>
                {' '}(cliquer sur un modèle ci-dessus pour changer)
              </p>
            )}
          </>
        )}

        {/* Bouton Enregistrer (commun — change le provider actif) */}
        <div style={{ marginTop: '14px' }}>
          <button onClick={saveOllamaConfig} disabled={savingOllama}>
            {savingOllama ? 'Enregistrement…' : 'Enregistrer le moteur IA'}
          </button>
          {ollamaMessage && (
            <small style={{ marginLeft: '10px', color: ollamaMessage.includes('Erreur') || ollamaMessage.includes('Impossible') ? '#ff453a' : '#34c759' }}>
              {ollamaMessage}
            </small>
          )}
        </div>
        {status && (
          <small style={{ display: 'block', marginTop: '6px', color: '#888' }}>
            Actuel : {status.aiProvider === 'ollama'
              ? `Ollama — ${status.ollamaModel}`
              : status.aiProvider === 'anthropic'
                ? `Claude — ${status.aiModel}`
                : status.aiProvider === 'gemini'
                  ? `Gemini — ${status.aiModel}`
                  : status.aiProvider === 'groq'
                    ? `Groq — ${status.aiModel}`
                    : `OpenAI — ${status.aiModel}`}
          </small>
        )}
      </div>

      {/* Section Hunter.io retirée d'ici — la clé se configure directement dans
          la page Scraping (zone Recherche), au plus près de son usage. */}

      <div className="card" style={cardAccent('#378ADD')}>
        <h3 style={shStyle}><Send size={17} color="#378ADD" />SMTP — envoi des candidatures {status?.smtpConfigured
          ? '✓'
          : <span className="cfg-todo red">à configurer</span>}</h3>
        <p style={{ fontSize: '13px', color: '#555', marginBottom: '10px', lineHeight: 1.5 }}>
          Le <strong>SMTP</strong> est le service qui <strong>envoie</strong> tes emails de candidature
          depuis ta boîte mail. Sans ça, l'app ne peut pas envoyer.<br />
          <strong>Gmail :</strong> hôte <code>smtp.gmail.com</code>, port <code>587</code>, ton adresse Gmail
          comme utilisateur, et un <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: '#007aff' }}>mot de passe d'application</a> (pas ton mot de passe habituel).
        </p>
        {status?.smtpConfigured && (
          <div style={configuredBanner}>
            ✅ <strong>Déjà configuré et enregistré.</strong> Les champs ci-dessous sont vides
            <strong> par sécurité</strong> (ton mot de passe n'est jamais réaffiché). Tu n'as rien à refaire —
            laisse vide, ou re-saisis tout uniquement si tu veux changer de compte.
          </div>
        )}
        <label style={fieldLabel}>Serveur SMTP <span style={fieldHint}>(pour Gmail : smtp.gmail.com)</span></label>
        <input placeholder="smtp.gmail.com"
               value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />

        <label style={fieldLabel}>Port <span style={fieldHint}>(587 pour Gmail)</span></label>
        <input type="number" placeholder="587"
               value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} />

        <label style={checkboxRow}>
          <input type="checkbox" checked={smtp.secure} style={checkboxStyle}
                 onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} />
          <span>Connexion SSL/TLS directe <span style={fieldHint}>(à cocher seulement si tu utilises le port 465 ; laisse décoché pour le port 587)</span></span>
        </label>

        <label style={fieldLabel}>Ton adresse email <span style={fieldHint}>(celle qui envoie : ex. ton@gmail.com)</span></label>
        <input placeholder="ton.adresse@gmail.com"
               value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} />

        <label style={fieldLabel}>Mot de passe d'application <span style={fieldHint}>(PAS ton mot de passe Gmail habituel)</span></label>
        <input type="password" placeholder="xxxx xxxx xxxx xxxx"
               value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} />
        <div>
          <button onClick={testSmtp} disabled={!smtpReady || testingSmtp}>
            {testingSmtp ? 'Test…' : 'Tester'}
          </button>
          <button onClick={saveSmtp} disabled={!smtpReady || savingSmtp}>
            {savingSmtp ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
        {smtpTest && <p>{smtpTest}</p>}
        {/* ADM-S2 : dernier résultat du test SMTP. */}
        {status?.lastSmtpCheckAt && (
          <p style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
            Dernier test : {new Date(status.lastSmtpCheckAt).toLocaleString('fr-FR')}
            {' '}— {status.lastSmtpCheckOk ? '✓ OK' : '✗ Échec'}
          </p>
        )}
      </div>

      <div className="card" style={cardAccent('#1D9E75')}>
        <h3 style={shStyle}><Inbox size={17} color="#1D9E75" />IMAP — détection des réponses {status?.imapConfigured
          ? '✓'
          : <span className="cfg-todo amber">à configurer</span>}</h3>
        <p style={{ fontSize: '13px', color: '#555', marginBottom: '10px', lineHeight: 1.5 }}>
          L'<strong>IMAP</strong> sert à <strong>lire</strong> ta boîte mail pour détecter quand une
          entreprise t'a répondu (et le classer dans l'onglet Réponses). C'est l'inverse du SMTP :
          SMTP envoie, IMAP reçoit.<br />
          <strong>Gmail :</strong> hôte <code>imap.gmail.com</code>, port <code>993</code>, même adresse
          et même mot de passe d'application que pour le SMTP.
        </p>
        {status?.imapConfigured && (
          <div style={configuredBanner}>
            ✅ <strong>Déjà configuré et enregistré.</strong> Champs vides <strong>par sécurité</strong>.
            Laisse vide, ou re-saisis tout pour changer.
          </div>
        )}
        <label style={fieldLabel}>Serveur IMAP <span style={fieldHint}>(pour Gmail : imap.gmail.com)</span></label>
        <input placeholder="imap.gmail.com"
               value={imap.host} onChange={(e) => setImap({ ...imap, host: e.target.value })} />

        <label style={fieldLabel}>Port <span style={fieldHint}>(993 pour Gmail)</span></label>
        <input type="number" placeholder="993"
               value={imap.port} onChange={(e) => setImap({ ...imap, port: Number(e.target.value) })} />

        <label style={checkboxRow}>
          <input type="checkbox" checked={imap.secure} style={checkboxStyle}
                 onChange={(e) => setImap({ ...imap, secure: e.target.checked })} />
          <span>Connexion SSL/TLS directe <span style={fieldHint}>(recommandé, à laisser coché pour le port 993)</span></span>
        </label>

        <label style={fieldLabel}>Ton adresse email <span style={fieldHint}>(la même que pour le SMTP)</span></label>
        <input placeholder="ton.adresse@gmail.com"
               value={imap.user} onChange={(e) => setImap({ ...imap, user: e.target.value })} />

        <label style={fieldLabel}>Mot de passe d'application <span style={fieldHint}>(le même que pour le SMTP)</span></label>
        <input type="password" placeholder="xxxx xxxx xxxx xxxx"
               value={imap.pass} onChange={(e) => setImap({ ...imap, pass: e.target.value })} />
        <div>
          {/* UX-4 : bouton Tester IMAP. */}
          <button onClick={testImap} disabled={!imapReady || testingImap}>
            {testingImap ? 'Test…' : 'Tester'}
          </button>
          <button onClick={saveImap} disabled={!imapReady || savingImap}>
            {savingImap ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
        {imapTest && <p>{imapTest}</p>}
        {/* ADM-S2 : dernier résultat du test IMAP. */}
        {status?.lastImapCheckAt && (
          <p style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
            Dernier test : {new Date(status.lastImapCheckAt).toLocaleString('fr-FR')}
            {' '}— {status.lastImapCheckOk ? '✓ OK' : '✗ Échec'}
          </p>
        )}

        {/* UX-11 : intervalle de polling configurable. */}
        <h4 style={{ marginTop: '12px' }}>Intervalle de relevé automatique</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="number"
            min={1}
            max={1440}
            value={pollInterval}
            onChange={(e) => setPollInterval(Number(e.target.value))}
            style={{ width: '80px' }}
          />
          <span>minutes</span>
          <button onClick={savePollInterval} disabled={savingPollInterval}>
            {savingPollInterval ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* FM-02 + Strat #3 : limite quotidienne progressive cyclique. */}
      <div className="card" style={cardAccent('#BA7517')}>
        <h3 style={shStyle}><Gauge size={17} color="#BA7517" />Limite quotidienne d'envois — automatique</h3>
        <p style={{ fontSize: '13px', color: '#555', marginBottom: '10px', lineHeight: 1.5 }}>
          Gmail suspend les comptes qui envoient trop d'emails d'un coup. L'app gère
          ça <strong>automatiquement</strong> avec un volume qui varie chaque jour pour rester
          discret et sous le plafond de 50/jour.
          {status && (
            <strong style={{ color: status.dailySendCount >= status.dailySendLimit ? '#ff453a' : '#34c759', marginLeft: '6px' }}>
              {status.dailySendCount} / {status.dailySendLimit} envoyé(s) aujourd'hui
            </strong>
          )}
        </p>
        {/* Visualisation du cycle 10 → 20 → 30 → 40 → 49 → recommence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {[10, 20, 30, 40, 49].map((n, i) => (
            <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                fontSize: '12px', fontWeight: 600, padding: '3px 10px', borderRadius: '14px',
                background: status?.dailySendLimit === n ? '#007aff' : '#eef',
                color: status?.dailySendLimit === n ? '#fff' : '#556',
              }}>
                J{i + 1} : {n}
              </span>
              {i < 4 && <span style={{ color: '#bbb' }}>→</span>}
            </span>
          ))}
          <span style={{ color: '#bbb' }}>↻</span>
        </div>
        <small style={{ color: '#888', display: 'block' }}>
          Jour 1 : 10 emails · Jour 2 : 20 · … · Jour 5 : 49, puis le cycle redémarre à 10.
          Le pastille bleue indique le palier d'aujourd'hui. Aucun réglage nécessaire.
        </small>
      </div>

      {/* F9 + SEC-1 : sauvegarde et restauration. */}
      <div className="card" style={cardAccent('#0a84ff')}>
        <h3 style={shStyle}><Save size={17} color="#0a84ff" />Sauvegarde</h3>
        <p>Exporte la base de données locale (candidatures, campagnes) vers un fichier de votre choix.</p>
        <button onClick={backup} disabled={isBackingUp}>
          {isBackingUp ? 'Sauvegarde…' : 'Créer une sauvegarde (.db)'}
        </button>
        {backupStatus && <p>{backupStatus}</p>}

        {/* SEC-1 : restauration. */}
        <p style={{ marginTop: '12px' }}>Restaurer la base depuis un fichier de sauvegarde (.db).</p>
        <button onClick={restore} disabled={isRestoring}>
          {isRestoring ? 'Restauration…' : 'Restaurer une sauvegarde…'}
        </button>
        {restoreStatus && <p>{restoreStatus}</p>}

        {/* ADM-4v3 : export global de toutes les données en JSON. */}
        <p style={{ marginTop: '12px' }}>Exporter toutes les données (campagnes, entreprises, candidatures) en JSON.</p>
        <button onClick={exportAll} disabled={isExporting}>
          {isExporting ? 'Export…' : 'Exporter toutes les données (.json)'}
        </button>
        {exportStatus && <p>{exportStatus}</p>}

        {/* SEC : sauvegarde chiffrée par mot de passe (portable, hors de cette machine). */}
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #eee' }}>
          <h4 style={{ ...shStyle, fontSize: '14px', margin: '0 0 4px' }}>
            <Lock size={15} color="#0a84ff" />Sauvegarde chiffrée (portable)
          </h4>
          <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.5 }}>
            Protège la sauvegarde par un mot de passe (AES-256). Indispensable si vous la stockez
            sur un cloud ou une clé USB. <strong>Sans ce mot de passe, le fichier est irrécupérable</strong> —
            notez-le précieusement.
          </p>
          <input
            type="password"
            placeholder="Mot de passe (8 caractères min.)"
            value={encPass}
            onChange={(e) => setEncPass(e.target.value)}
            style={{ maxWidth: '280px' }}
          />
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
            <button onClick={backupEncrypted} disabled={isEncBacking || encPass.length < 8}>
              {isEncBacking ? 'Chiffrement…' : 'Sauvegarde chiffrée (.cjenc)'}
            </button>
            <button onClick={restoreEncrypted} disabled={isEncRestoring || !encPass} className="btn-secondary">
              {isEncRestoring ? 'Restauration…' : 'Restaurer une sauvegarde chiffrée…'}
            </button>
          </div>
          {encStatus && <p style={{ wordBreak: 'break-all' }}>{encStatus}</p>}
        </div>
      </div>

      {/* RGPD : liste « ne pas contacter » + droit à l'effacement. */}
      <OptOutManager />

      {/* AUTO-RELANCE : scheduler quotidien (node-cron). */}
      <div className="card" style={cardAccent('#BA7517')}>
        <h3 style={shStyle}><ListChecks size={17} color="#BA7517" />Relance automatique</h3>
        <label>
          <input type="checkbox"
                 checked={status?.autoFollowUpEnabled ?? false}
                 onChange={toggleAutoFollowUp}
                 disabled={togglingAutoFollowUp} />
          {' '}{togglingAutoFollowUp ? 'Mise à jour…' : 'Relancer automatiquement les candidatures sans réponse (> 7 jours)'}
        </label>
        <small style={{ display: 'block', marginTop: '8px', color: '#888', lineHeight: 1.5 }}>
          Chaque jour (et au démarrage), l'app envoie une relance aux candidatures éligibles,
          dans la <strong>limite de ton quota d'envoi du jour</strong> et avec les mêmes garde-fous que
          la relance manuelle (liste « ne pas contacter », anti-doublon). ⚠️ <strong>L'app doit rester
          ouverte</strong> pour que la planification se déclenche.
        </small>
      </div>

      <div className="card" style={cardAccent('#D85A30')}>
        <h3 style={shStyle}><Radar size={17} color="#D85A30" />Recherche automatique d'entreprises</h3>
        <label>
          <input type="checkbox"
                 checked={status?.scrapingEnabled ?? false}
                 onChange={toggleScraping}
                 disabled={togglingScrap} />
          {' '}{togglingScrap ? 'Mise à jour…' : 'Activer la planification mensuelle du scraping'}
        </label>
        <small style={{ display: 'block', marginTop: '8px', color: '#888', lineHeight: 1.5 }}>
          ⚠️ <strong>L'application doit rester ouverte</strong> pour que la recherche planifiée se
          déclenche : la planification tourne dans l'app, pas en arrière-plan système. Si tu fermes
          Carreer-ops, rien ne se lance. Pour scraper, le plus fiable reste de lancer manuellement
          depuis la page <strong>Scraping</strong>.
        </small>

      </div>

      {/* ADM-2 : visionneuse de logs. */}
      <div className="card" style={cardAccent('#8E8E93')}>
        <h3 style={shStyle}><ScrollText size={17} color="#8E8E93" />Journal (logs)</h3>
        <button onClick={showLogs} disabled={loadingLogs}>
          {loadingLogs ? 'Chargement…' : 'Afficher les logs'}
        </button>
        {logs !== null && (
          <pre style={{
            maxHeight: '300px', overflow: 'auto', fontSize: '11px',
            background: '#1e1e1e', color: '#d4d4d4', padding: '8px',
            borderRadius: '4px', marginTop: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {logs.length > 0 ? logs.join('\n') : '(aucun log disponible)'}
          </pre>
        )}
      </div>

      {/* SEC-M1 : verrouillage automatique. */}
      <div className="card" style={cardAccent('#5856d6')}>
        <h3 style={shStyle}><Lock size={17} color="#5856d6" />Verrouillage automatique {status?.lockEnabled && '✓'}</h3>
        <p style={{ fontSize: '13px', color: '#555' }}>
          Protégez l'accès à l'application avec un code PIN.
          {status?.lockEnabled ? ' Verrouillage actif.' : ' Verrouillage inactif.'}
        </p>
        <input
          type="password"
          placeholder="Nouveau PIN (4+ caractères)"
          value={lockPin}
          onChange={(e) => setLockPin(e.target.value)}
          style={{ width: '180px' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '13px' }}>
            Timeout :
            <input
              type="number"
              min={1}
              max={1440}
              value={lockTimeout}
              onChange={(e) => setLockTimeout(Number(e.target.value))}
              style={{ width: '60px', marginLeft: '6px' }}
            />
            {' '}minutes
          </label>
          <button onClick={saveLockPin} disabled={!lockPin || savingLock}>
            {savingLock ? 'Enregistrement…' : 'Activer le verrouillage'}
          </button>
          {status?.lockEnabled && (
            <button
              onClick={clearLock}
              disabled={savingLock}
              style={{ background: '#ff453a', color: '#fff' }}
            >
              Désactiver
            </button>
          )}
        </div>
        {lockMessage && <p style={{ fontSize: '13px', marginTop: '6px' }}>{lockMessage}</p>}
      </div>

      {/* ADM-S13 : maintenance des données. */}
      <div className="card" style={cardAccent('#1D9E75')}>
        <h3 style={shStyle}><Wrench size={17} color="#1D9E75" />Maintenance des données</h3>
        <button onClick={loadMaintenanceStats} disabled={loadingMaintenance}>
          {loadingMaintenance ? 'Chargement…' : 'Analyser les données'}
        </button>
        {maintenanceStats && (
          <div style={{ marginTop: '10px', fontSize: '13px' }}>
            <p>Entreprises sans email valide : <strong>{maintenanceStats.companiesWithoutEmail}</strong></p>
            <p>Candidatures en échec : <strong>{maintenanceStats.failedApplications}</strong></p>
            <p>Campagnes archivées &gt; 90 jours : <strong>{maintenanceStats.oldArchivedCampaigns}</strong></p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
              {maintenanceStats.failedApplications > 0 && (
                <button onClick={purgeFailed} style={{ background: '#ff9f0a', color: '#fff' }}>
                  Purger les candidatures FAILED ({maintenanceStats.failedApplications})
                </button>
              )}
              {maintenanceStats.oldArchivedCampaigns > 0 && (
                <button onClick={purgeOldArchived} style={{ background: '#ff453a', color: '#fff' }}>
                  Supprimer les vieilles archives ({maintenanceStats.oldArchivedCampaigns})
                </button>
              )}
            </div>
          </div>
        )}
        {maintenanceMessage && <p style={{ fontSize: '13px', marginTop: '6px' }}>{maintenanceMessage}</p>}
      </div>

      {/* MOD-05 : configuration DKIM — repliée car réservée aux utilisateurs avancés. */}
      <div className="card">
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '17px', fontWeight: 600 }}>
            DKIM — signature des emails {status?.dkimConfigured && '✓'}{' '}
            <span style={{ fontSize: '12px', fontWeight: 400, color: '#888' }}>(avancé — ignorer si tu utilises Gmail)</span>
          </summary>
          <div style={{ marginTop: '10px' }}>
        <div style={{
          fontSize: '13px', color: '#555', lineHeight: 1.5, marginBottom: '12px',
          background: '#f8f9fa', borderRadius: '8px', padding: '10px 12px',
        }}>
          <strong>C'est quoi ?</strong> Le DKIM est une signature qui prouve aux serveurs mail
          que tes emails viennent bien de toi → ils tombent moins en spam.<br />
          <strong>En ai-je besoin ?</strong> Non, si tu envoies depuis <strong>Gmail</strong> (ou Outlook,
          etc.) : ces fournisseurs signent déjà tes emails automatiquement. Laisse cette section vide.<br />
          <strong>Quand l'utiliser ?</strong> Uniquement si tu envoies depuis ton <strong>propre domaine</strong>
          {' '}(ex : <code>jordan@mon-site.fr</code> via un serveur perso). Il faut alors une clé privée RSA
          et un enregistrement DNS — opérations techniques côté hébergeur.
        </div>
        <input
          placeholder="Domaine (ex: example.com)"
          value={dkim.domainName}
          onChange={(e) => setDkim({ ...dkim, domainName: e.target.value })}
        />
        <input
          placeholder="Sélecteur (ex: mail)"
          value={dkim.keySelector}
          onChange={(e) => setDkim({ ...dkim, keySelector: e.target.value })}
          style={{ marginTop: '6px' }}
        />
        <textarea
          placeholder="Clé privée PEM (-----BEGIN RSA PRIVATE KEY-----...)"
          value={dkim.privateKey}
          onChange={(e) => setDkim({ ...dkim, privateKey: e.target.value })}
          rows={4}
          style={{ width: '100%', marginTop: '6px', fontFamily: 'monospace', fontSize: '11px', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={saveDkim}
            disabled={!dkim.domainName || !dkim.keySelector || !dkim.privateKey || savingDkim}
          >
            {savingDkim ? 'Enregistrement…' : 'Enregistrer DKIM'}
          </button>
          {status?.dkimConfigured && (
            <button
              onClick={clearDkim}
              disabled={savingDkim}
              style={{ background: '#ff453a', color: '#fff' }}
            >
              Supprimer DKIM
            </button>
          )}
        </div>
        {dkimMessage && <p style={{ fontSize: '13px', marginTop: '6px' }}>{dkimMessage}</p>}
          </div>
        </details>
      </div>

      {/* ADM-3 : zone de danger. */}
      <div className="card span-all" style={{ borderColor: '#ff453a', borderLeft: '4px solid #ff453a' }}>
        <h3 style={{ ...shStyle, color: '#ff453a' }}><AlertTriangle size={17} color="#ff453a" />Zone de danger</h3>
        <p>Cette action supprimera irrémédiablement toutes vos données (campagnes, entreprises, candidatures).</p>
        <button
          onClick={resetData}
          disabled={resetting}
          style={{ background: '#ff453a', color: '#fff' }}
        >
          {resetting ? 'Réinitialisation…' : 'Réinitialiser toutes les données'}
        </button>
      </div>
      </div>{/* fin .settings-grid */}
    </section>
  );
}
