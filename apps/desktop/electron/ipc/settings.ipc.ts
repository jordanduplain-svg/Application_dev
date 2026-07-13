import { app } from 'electron';
import { handle } from './registry';
import { execSync } from 'child_process';
import * as os from 'os';
// FM2 : validation Zod des payloads IPC.
import { validate, SmtpSchema, PollIntervalSchema, ImapSchema, AiModelSchema, DkimConfigSchema } from './validation';
import {
  getOpenaiKey,
  setOpenaiKey,
  clearOpenaiKey,
  getAnthropicKey,
  setAnthropicKey,
  clearAnthropicKey,
  getGeminiKey,
  setGeminiKey,
  clearGeminiKey,
  getGroqKey,
  setGroqKey,
  clearGroqKey,
  getHunterKey,
  getSmtp,
  setSmtp,
  getImap,
  setImap,
  getDkim,
  setDkim,
  clearDkim,
  getScrapingEnabled,
  setScrapingEnabled,
  getAutoFollowUpEnabled,
  setAutoFollowUpEnabled,
  getImapPollInterval,
  setImapPollInterval,
  getAiModel,
  setAiModel,
  getLockPin,
  setLockPin,
  clearLockPin,
  getLockTimeout,
  setLockTimeout,
  verifyLockPin,
  getLastSmtpCheck,
  getLastImapCheck,
  setLastSmtpCheck,
  setLastImapCheck,
  getDailySendLimit,
  setDailySendLimit,
  getDailySendCount,
  getAiProvider,
  setAiProvider,
  getOllamaModel,
  setOllamaModel,
  getOllamaHost,
  setOllamaHost,
} from '../../src/lib/secrets';
import { verifySmtp } from '../../src/lib/mailer';
import { verifyImap } from '../../src/lib/imap';
import { enqueuePollReplies } from '../../src/tasks/poll-replies.task';
// UX-2v2 : hot-reload de l'intervalle IMAP.
import { restartReplyPolling } from '../../src/tasks';

/** Handlers IPC des Réglages (secrets, options, relevé manuel). */
export function registerSettingsHandlers(): void {
  // État résumé pour l'UI — JAMAIS les secrets eux-mêmes, seulement leur présence.
  handle('settings:getStatus', () => {
    const smtpCheck = getLastSmtpCheck();
    const imapCheck = getLastImapCheck();
    return {
      openaiKeySet: getOpenaiKey() !== null,
      anthropicKeySet: getAnthropicKey() !== null,
      geminiKeySet: getGeminiKey() !== null,
      groqKeySet: getGroqKey() !== null,
      hunterKeySet: getHunterKey() !== null,
      smtpConfigured: getSmtp() !== null,
      imapConfigured: getImap() !== null,
      // MOD-05 : DKIM configuré.
      dkimConfigured: getDkim() !== null,
      // FM-02 : limite quotidienne d'envois.
      dailySendLimit: getDailySendLimit(),
      dailySendCount: getDailySendCount().count,
      scrapingEnabled: getScrapingEnabled(),
      autoFollowUpEnabled: getAutoFollowUpEnabled(),
      // UX-11 : intervalle de polling IMAP.
      imapPollIntervalMinutes: getImapPollInterval(),
      // INT-3 : modèle IA configuré.
      aiModel: getAiModel(),
      // OLLAMA-1 : provider IA et config Ollama.
      aiProvider: getAiProvider(),
      ollamaModel: getOllamaModel(),
      ollamaHost: getOllamaHost(),
      // SEC-M1 : verrouillage automatique.
      lockEnabled: getLockPin() !== null,
      lockTimeoutMinutes: getLockTimeout(),
      // ADM-S2 : indicateurs de santé.
      lastSmtpCheckAt: smtpCheck.at,
      lastSmtpCheckOk: smtpCheck.ok,
      lastImapCheckAt: imapCheck.at,
      lastImapCheckOk: imapCheck.ok,
    };
  });

  // C1 : les setters retournent désormais Promise<void> — on les await pour que
  // les erreurs (DPAPI indisponible, disque plein) remontent à l'UI via IPC.
  handle('settings:setOpenaiKey', async ({ key }) => {
    // SEC2 : valider le format de la clé OpenAI avant de la stocker.
    // Accepte sk-... et sk-proj-... (format projet OpenAI), longueur minimale 20 chars.
    const trimmed = key.trim();
    if (!trimmed.startsWith('sk-') || trimmed.length < 20) {
      throw new Error(
        'Clé OpenAI invalide — elle doit commencer par "sk-" (vérifiez votre copie depuis platform.openai.com)'
      );
    }
    await setOpenaiKey(trimmed);
  });

  // FM2 : valider la configuration SMTP avant de la stocker.
  handle('settings:setSmtp', async (input) => {
    validate(SmtpSchema, input);
    await setSmtp(input);
  });

  // Test SMTP : on essaie de se connecter sans envoyer d'email.
  handle('settings:testSmtp', async (input) => {
    let ok = false;
    let error: string | undefined;
    try {
      await verifySmtp(input);
      ok = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Erreur inconnue';
    }
    // ADM-S2 : persister le résultat du test.
    await setLastSmtpCheck(ok);
    return { ok, error };
  });

  handle('settings:setImap', async (input) => {
    validate(ImapSchema, input);
    await setImap(input);
  });

  // UX-4 : test de connexion IMAP sans enregistrer la config.
  handle('settings:testImap', async (input) => {
    let ok = false;
    let error: string | undefined;
    try {
      await verifyImap(input);
      ok = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Erreur inconnue';
    }
    // ADM-S2 : persister le résultat du test.
    await setLastImapCheck(ok);
    return { ok, error };
  });

  handle('settings:setScrapingEnabled', async ({ enabled }) => {
    await setScrapingEnabled(enabled);
  });

  // AUTO-RELANCE : active/désactive la relance automatique quotidienne.
  handle('settings:setAutoFollowUp', async ({ enabled }) => {
    await setAutoFollowUpEnabled(enabled);
  });

  // Lancement au démarrage de session (natif Electron). Permet aux relances « de
  // fond » de tourner : l'app s'ouvre au login → la passe de rattrapage du scheduler
  // s'exécute. Pas de service système à maintenir.
  handle('settings:getLaunchAtLogon', () => ({
    enabled: app.getLoginItemSettings().openAtLogin,
  }));
  handle('settings:setLaunchAtLogon', ({ enabled }) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });

  // UX-11 : intervalle de polling IMAP configurable.
  // UX-2v2 : hot-reload — redémarre le timer avec le nouvel intervalle.
  // FM2 : valider l'intervalle avant de le stocker.
  handle('settings:setImapPollInterval', async (payload) => {
    validate(PollIntervalSchema, payload);
    await setImapPollInterval(payload.minutes);
    restartReplyPolling();
  });

  // FM-02 : plafond manuel d'envois/jour (redescendre après des bounces, par exemple).
  // limit=null retire l'override et revient au ramp-up automatique.
  handle('settings:setDailySendLimit', async (payload: { limit: number | null }) => {
    const limit = payload.limit;
    if (limit !== null && (!Number.isFinite(limit) || limit < 1 || limit > 500)) {
      throw new Error('Plafond invalide (1 à 500).');
    }
    await setDailySendLimit(limit === null ? undefined : Math.floor(limit));
  });

  // INT-3 : modèle IA configurable.
  handle('settings:setAiModel', async (payload) => {
    const data = validate(AiModelSchema, payload);
    await setAiModel(data.model);
  });

  // SEC-N1 : effacer la clé OpenAI.
  handle('settings:clearOpenaiKey', async () => {
    await clearOpenaiKey();
  });

  // Claude : enregistrer la clé Anthropic (format sk-ant-...).
  handle('settings:setAnthropicKey', async ({ key }) => {
    const trimmed = key.trim();
    if (!trimmed.startsWith('sk-ant-') || trimmed.length < 20) {
      throw new Error(
        'Clé Anthropic invalide — elle doit commencer par "sk-ant-" (depuis console.anthropic.com)'
      );
    }
    await setAnthropicKey(trimmed);
  });

  handle('settings:clearAnthropicKey', async () => {
    await clearAnthropicKey();
  });

  // Gemini : enregistrer la clé Google (format AIza...).
  handle('settings:setGeminiKey', async ({ key }) => {
    const trimmed = key.trim();
    if (trimmed.length < 20) {
      throw new Error('Clé Gemini invalide — récupérez-la sur aistudio.google.com (Get API key).');
    }
    await setGeminiKey(trimmed);
  });

  handle('settings:clearGeminiKey', async () => {
    await clearGeminiKey();
  });

  // Groq : enregistrer la clé (format gsk_...).
  handle('settings:setGroqKey', async ({ key }) => {
    const trimmed = key.trim();
    if (!trimmed.startsWith('gsk_') || trimmed.length < 20) {
      throw new Error('Clé Groq invalide — elle doit commencer par "gsk_" (depuis console.groq.com).');
    }
    await setGroqKey(trimmed);
  });

  handle('settings:clearGroqKey', async () => {
    await clearGroqKey();
  });

  // MOD-05 : configuration DKIM.
  handle('settings:setDkim', async (input) => {
    const data = validate(DkimConfigSchema, input);
    await setDkim(data);
  });

  handle('settings:clearDkim', async () => {
    await clearDkim();
  });

  // SEC-M1 : gestion du PIN de verrouillage.
  // SEC-01 fix : valider le format avant de stocker (4-8 chiffres obligatoires).
  handle('settings:setLockPin', async ({ pin }) => {
    if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
      throw new Error('Le PIN doit contenir entre 4 et 8 chiffres.');
    }
    await setLockPin(pin);
  });

  handle('settings:clearLockPin', async () => {
    await clearLockPin();
  });

  // AUDIT-H5 fix : valider la plage avant stockage.
  // minutes=0 → verrouillage toutes les 30s (app inutilisable).
  // minutes<0 → timeout négatif (jamais de verrouillage même si lockEnabled=true).
  handle('settings:setLockTimeout', async ({ minutes }) => {
    const m = Number(minutes);
    if (!Number.isInteger(m) || m < 1 || m > 1440) {
      throw new Error('Timeout invalide — doit être un entier entre 1 et 1440 minutes.');
    }
    await setLockTimeout(m);
  });

  handle('settings:verifyLockPin', ({ pin }) => {
    return { ok: verifyLockPin(pin) };
  });

  // Relève IMAP immédiate (en plus du polling automatique).
  handle('replies:pollNow', () => {
    enqueuePollReplies();
  });

  // OLLAMA-2 : détection hardware (RAM + GPU) pour les recommandations de modèles.
  handle('settings:getHardwareInfo', async () => {
    const totalRamGb = Math.round(os.totalmem() / (1024 ** 3) * 10) / 10;
    let gpuName: string | null = null;
    let gpuVramGb: number | null = null;
    let gpuVendor: string | null = null;

    // ── 1. nvidia-smi : le plus précis pour les GPU NVIDIA ──────────────────
    try {
      const out = execSync(
        'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      ).trim();
      const [name, vramMib] = out.split(',').map((s) => s.trim());
      if (name && vramMib && !isNaN(Number(vramMib))) {
        gpuName   = name;
        gpuVramGb = Math.round(Number(vramMib) / 1024 * 10) / 10;
        gpuVendor = 'nvidia';
      }
    } catch { /* nvidia-smi absent */ }

    // ── 2. WMI : Intel, AMD, NVIDIA sans nvidia-smi ─────────────────────────
    if (!gpuName) {
      try {
        const out = execSync(
          'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json -Compress"',
          { encoding: 'utf8', timeout: 8000, windowsHide: true }
        ).trim();

        // ConvertTo-Json retourne un tableau si plusieurs cartes, objet sinon.
        const raw = JSON.parse(out);
        const entries: { Name?: string; AdapterRAM?: number }[] = Array.isArray(raw) ? raw : [raw];

        // Choisir la carte avec le plus de VRAM reporté (première si égal).
        const best = entries.reduce<{ Name?: string; AdapterRAM?: number } | null>((acc, cur) => {
          if (!acc) return cur;
          return (cur.AdapterRAM ?? 0) > (acc.AdapterRAM ?? 0) ? cur : acc;
        }, null);

        if (best?.Name) {
          gpuName = best.Name;

          // Priorité 1 : extraire la taille depuis le nom du GPU.
          // Couvre "(16GB)", "(12 GB)", "16GB", etc.  (WMI overflow 32-bit = 2147479552 ≈ 2 GB)
          const nameVram = gpuName.match(/[\((](\d+(?:\.\d+)?)\s*GB[\))]?/i)
            ?? gpuName.match(/(\d+(?:\.\d+)?)\s*GB/i);
          if (nameVram) {
            gpuVramGb = Number(nameVram[1]);
          } else if (best.AdapterRAM && best.AdapterRAM > 0 && best.AdapterRAM < 2_100_000_000) {
            // Valeurs < ~2 GB = fiables (pas d'overflow)
            gpuVramGb = Math.round(best.AdapterRAM / (1024 ** 3) * 10) / 10;
          }

          const lower = gpuName.toLowerCase();
          if (lower.includes('nvidia') || lower.includes('geforce') || lower.includes('quadro') || lower.includes('rtx') || lower.includes('gtx')) {
            gpuVendor = 'nvidia';
          } else if (lower.includes('intel') || lower.includes('arc') || lower.includes('iris') || lower.includes('uhd')) {
            gpuVendor = 'intel';
          } else if (lower.includes('amd') || lower.includes('radeon') || lower.includes('rx ')) {
            gpuVendor = 'amd';
          } else {
            gpuVendor = 'other';
          }
        }
      } catch { /* pas d'info GPU */ }
    }

    return { totalRamGb, gpuName, gpuVramGb, gpuVendor };
  });

  // OLLAMA-1 : configuration du provider IA local.
  handle('settings:setAiProvider', async ({ provider }) => {
    const allowed = ['openai', 'ollama', 'anthropic', 'gemini', 'groq'];
    if (!allowed.includes(provider)) {
      throw new Error('Provider invalide — doit être "openai", "anthropic", "gemini", "groq" ou "ollama".');
    }
    await setAiProvider(provider);
  });

  handle('settings:setOllamaModel', async ({ model }) => {
    const m = (model as string).trim();
    if (!m) throw new Error('Modèle Ollama vide.');
    await setOllamaModel(m);
  });

  handle('settings:setOllamaHost', async ({ host }) => {
    const h = (host as string).trim().replace(/\/$/, '');
    if (!h.startsWith('http')) throw new Error('L\'hôte doit commencer par http:// ou https://');
    await setOllamaHost(h);
  });

  // Liste les modèles Ollama disponibles en interrogeant l'API locale.
  handle('settings:getOllamaModels', async () => {
    const host = getOllamaHost().replace(/\/$/, '');
    try {
      const res = await fetch(`${host}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { models?: { name: string }[] };
      const models = (data.models ?? []).map((m) => m.name);
      return { models };
    } catch (err) {
      throw new Error(
        `Impossible de contacter Ollama sur ${host} — ` +
        `vérifiez qu'il est démarré (ollama serve). ${err instanceof Error ? err.message : ''}`
      );
    }
  });
}
