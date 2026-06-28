import { safeStorage } from 'electron';
import { readFileSync, existsSync, renameSync } from 'fs';
import { writeFile as writeFileAsync } from 'fs/promises';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { SmtpInput, ImapInput, DkimInput } from '@candio/shared';
import { getSecretsPath } from './paths';
import { logger } from './logger';

/**
 * Stockage sécurisé des secrets (clé OpenAI, identifiants SMTP/IMAP).
 *
 * Chaque secret est chiffré via safeStorage d'Electron (DPAPI sur Windows).
 * On stocke aussi les valeurs non sensibles dans le même fichier.
 */

interface SecretsFile {
  openaiKey?: string; // chiffré (base64)
  anthropicKey?: string; // chiffré (base64) — Claude via endpoint compatible OpenAI
  geminiKey?: string; // chiffré (base64) — Google Gemini via endpoint compatible OpenAI
  groqKey?: string; // chiffré (base64) — Groq via endpoint compatible OpenAI
  hunterKey?: string; // chiffré (base64)
  smtp?: string;      // SmtpInput sérialisé en JSON puis chiffré
  imap?: string;      // ImapInput sérialisé en JSON puis chiffré
  dkim?: string;      // MOD-05 : DkimInput sérialisé en JSON puis chiffré
  scrapingEnabled?: boolean;
  autoFollowUpEnabled?: boolean;   // relance automatique quotidienne (scheduler)
  lastImapPollAt?: string; // ISO
  // UX-11 : intervalle de polling IMAP en minutes (défaut 10).
  imapPollIntervalMinutes?: number;
  // INT-3 : modèle IA (défaut 'gpt-4o').
  aiModel?: string;
  // SEC-M1 : PIN de verrouillage (hashé SHA-256) et timeout.
  lockPin?: string;
  lockTimeoutMinutes?: number;
  // ADM-S2 : horodatages et résultats des derniers tests SMTP/IMAP.
  lastSmtpCheckAt?: string;
  lastSmtpCheckOk?: boolean;
  lastImapCheckAt?: string;
  lastImapCheckOk?: boolean;
  // FM-02 : limite quotidienne d'envois anti-suspension Gmail.
  dailySendLimit?: number;   // max emails par jour (défaut calculé par ramp-up)
  dailySendCount?: number;   // emails envoyés aujourd'hui
  dailySendDate?: string;    // YYYY-MM-DD — date du compteur courant
  // Strat #3 : ramp-up warm-up. Date du tout premier envoi enregistré.
  // Permet de calculer l'ancienneté du compte et d'ajuster la limite progressivement.
  firstSendDate?: string;    // YYYY-MM-DD — null = pas encore envoyé
  // OLLAMA-1 : provider IA ('openai' | 'ollama'). Défaut 'openai'.
  aiProvider?: string;
  // OLLAMA-1 : modèle Ollama sélectionné (ex: 'llama3.2:3b').
  ollamaModel?: string;
  // OLLAMA-1 : URL du serveur Ollama (défaut 'http://localhost:11434').
  ollamaHost?: string;
}

// M4 : cache en mémoire — évite de relire le fichier et d'appeler DPAPI à chaque get.
let cache: SecretsFile | null = null;

// H1 : flag levé si le fichier de secrets était corrompu au démarrage.
// Le process principal peut le lire après preloadSecrets() pour alerter l'utilisateur.
let _secretsWereCorrupted = false;

/** Retourne true si secrets.json était illisible au démarrage. */
export function secretsWereCorrupted(): boolean {
  return _secretsWereCorrupted;
}

/**
 * Force le chargement du cache au démarrage pour détecter la corruption tôt,
 * avant que l'utilisateur ne soit bloqué sur une fonctionnalité.
 */
export function preloadSecrets(): void {
  readFile();
}

function readFile(): SecretsFile {
  if (cache) return cache;
  const path = getSecretsPath();
  // L1 : mettre à jour le cache même quand le fichier n'existe pas encore, pour
  // éviter de rappeler existsSync() + getSecretsPath() à chaque lecture suivante.
  if (!existsSync(path)) { cache = {}; return cache; }
  try {
    cache = JSON.parse(readFileSync(path, 'utf8')) as SecretsFile;
    return cache;
  } catch (err) {
    // H1 : log + rename + flag — ne pas perdre silencieusement la config.
    logger.error('[secrets] Fichier secrets.json illisible — réinitialisation', err);
    _secretsWereCorrupted = true;
    try {
      // Renommer le fichier corrompu pour permettre l'investigation ultérieure.
      const bak = `${path}.corrupted`;
      renameSync(path, bak);
      logger.warn(`[secrets] Ancienne config sauvegardée sous ${bak}`);
    } catch { /* best-effort — peut échouer si permissions insuffisantes */ }
    cache = {};
    return cache;
  }
}

/**
 * F3 : écriture asynchrone — ne bloque plus l'event loop du process principal.
 * L'ancienne writeFileSync pouvait geler l'UI ~2 ms à chaque sauvegarde de réglage.
 */
async function writeFile(data: SecretsFile): Promise<void> {
  try {
    await writeFileAsync(getSecretsPath(), JSON.stringify(data, null, 2), 'utf8');
    // M4 : met à jour le cache après chaque écriture réussie.
    cache = data;
  } catch (err) {
    throw new Error(
      `Impossible d'écrire les secrets (disque plein ?) : ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * C1 : file d'écriture sérialisée pour éviter la race condition read-modify-write.
 *
 * `fn` peut retourner une Promise (writeFile est async) — Promise.then() la chaîne
 * automatiquement, garantissant que les écritures se succèdent sans chevauchement.
 * La file continue de fonctionner même si une écriture échoue.
 */
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(fn: () => Promise<void>): Promise<void> {
  const task = writeQueue.then(fn);
  // La file absorbe l'erreur pour ne pas "poisonner" les écritures suivantes.
  writeQueue = task.catch(() => {});
  return task; // L'appelant peut await pour récupérer les erreurs (DPAPI, disque plein…)
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Trousseau Windows indisponible — impossible de chiffrer les secrets.');
  }
  return safeStorage.encryptString(value).toString('base64');
}

// C2 : safeDecrypt retourne null si DPAPI échoue (ex: OS réinstallé).
function safeDecrypt(b64: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

// --- Clé OpenAI -------------------------------------------------------------

export function getOpenaiKey(): string | null {
  const enc = readFile().openaiKey;
  return enc ? safeDecrypt(enc) : null;
}

/** Retourne une Promise — à await dans les handlers IPC pour propager les erreurs. */
export function setOpenaiKey(key: string): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), openaiKey: encrypt(key) }));
}

/** SEC-N1 : efface la clé OpenAI. */
export function clearOpenaiKey(): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), openaiKey: undefined }));
}

// --- Clé Anthropic (Claude) -------------------------------------------------

export function getAnthropicKey(): string | null {
  const enc = readFile().anthropicKey;
  return enc ? safeDecrypt(enc) : null;
}

export function setAnthropicKey(key: string): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), anthropicKey: encrypt(key) }));
}

export function clearAnthropicKey(): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), anthropicKey: undefined }));
}

// --- Clé Google Gemini ------------------------------------------------------

export function getGeminiKey(): string | null {
  const enc = readFile().geminiKey;
  return enc ? safeDecrypt(enc) : null;
}

export function setGeminiKey(key: string): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), geminiKey: encrypt(key) }));
}

export function clearGeminiKey(): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), geminiKey: undefined }));
}

// --- Clé Groq ---------------------------------------------------------------

export function getGroqKey(): string | null {
  const enc = readFile().groqKey;
  return enc ? safeDecrypt(enc) : null;
}

export function setGroqKey(key: string): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), groqKey: encrypt(key) }));
}

export function clearGroqKey(): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), groqKey: undefined }));
}

// --- Clé Hunter.io ----------------------------------------------------------

export function getHunterKey(): string | null {
  const enc = readFile().hunterKey;
  return enc ? safeDecrypt(enc) : null;
}

// --- Config SMTP (envoi des candidatures) -----------------------------------

export function getSmtp(): SmtpInput | null {
  const enc = readFile().smtp;
  if (!enc) return null;
  const json = safeDecrypt(enc);
  return json ? (JSON.parse(json) as SmtpInput) : null;
}

export function setSmtp(config: SmtpInput): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), smtp: encrypt(JSON.stringify(config)) }));
}

// --- Config IMAP (détection des réponses) -----------------------------------

export function getImap(): ImapInput | null {
  const enc = readFile().imap;
  if (!enc) return null;
  const json = safeDecrypt(enc);
  return json ? (JSON.parse(json) as ImapInput) : null;
}

export function setImap(config: ImapInput): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), imap: encrypt(JSON.stringify(config)) }));
}

// --- Config DKIM (MOD-05) ---------------------------------------------------

export function getDkim(): DkimInput | null {
  const enc = readFile().dkim;
  if (!enc) return null;
  const json = safeDecrypt(enc);
  return json ? (JSON.parse(json) as DkimInput) : null;
}

export function setDkim(config: DkimInput): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), dkim: encrypt(JSON.stringify(config)) }));
}

export function clearDkim(): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), dkim: undefined }));
}

// --- Option scraping (non sensible) -----------------------------------------

export function getScrapingEnabled(): boolean {
  return readFile().scrapingEnabled ?? false;
}

export function setScrapingEnabled(enabled: boolean): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), scrapingEnabled: enabled }));
}

// --- Relance automatique quotidienne (scheduler node-cron) ------------------

export function getAutoFollowUpEnabled(): boolean {
  return readFile().autoFollowUpEnabled ?? false;
}

export function setAutoFollowUpEnabled(enabled: boolean): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), autoFollowUpEnabled: enabled }));
}

// --- Horodatage du dernier relevé IMAP --------------------------------------

export function getLastImapPollAt(): Date | null {
  const s = readFile().lastImapPollAt;
  return s ? new Date(s) : null;
}

export function setLastImapPollAt(date: Date): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), lastImapPollAt: date.toISOString() }));
}

// --- Intervalle de polling IMAP (UX-11) -------------------------------------

/** Retourne l'intervalle de polling IMAP en minutes (défaut 10). */
export function getImapPollInterval(): number {
  return readFile().imapPollIntervalMinutes ?? 10;
}

export function setImapPollInterval(minutes: number): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), imapPollIntervalMinutes: minutes }));
}

// --- Modèle IA (INT-3) -------------------------------------------------------

/** Retourne le modèle IA configuré (défaut 'gpt-4o'). */
export function getAiModel(): string {
  return readFile().aiModel ?? 'gpt-4o';
}

export function setAiModel(model: string): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), aiModel: model }));
}

// --- Provider IA (OLLAMA-1) --------------------------------------------------

/** Retourne le provider IA : 'openai' ou 'ollama' (défaut 'openai'). */
export function getAiProvider(): string {
  return readFile().aiProvider ?? 'openai';
}

export function setAiProvider(provider: string): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), aiProvider: provider }));
}

/** Retourne le modèle Ollama configuré (défaut 'llama3.2:3b'). */
export function getOllamaModel(): string {
  return readFile().ollamaModel ?? 'llama3.2:3b';
}

export function setOllamaModel(model: string): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), ollamaModel: model }));
}

/**
 * Retourne l'URL du serveur Ollama (défaut 'http://127.0.0.1:11434').
 * 127.0.0.1 et non 'localhost' : sous Windows, 'localhost' résout d'abord en
 * IPv6 (::1) alors qu'Ollama n'écoute souvent que sur IPv4 → /api/tags renvoie
 * une liste vide et tous les modèles s'affichent « non installé ».
 */
export function getOllamaHost(): string {
  return readFile().ollamaHost ?? 'http://127.0.0.1:11434';
}

export function setOllamaHost(host: string): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), ollamaHost: host }));
}

// --- PIN de verrouillage (SEC-M1) -------------------------------------------

// SECU-3 : PIN haché avec SEL + scrypt (KDF lent), format « scrypt$<selHex>$<hashHex> ».
// Le SHA-256 non salé précédent rendait le brute-force d'un PIN à 4 chiffres trivial si
// secrets.json fuyait. Comparaison en temps constant (timingSafeEqual). Compat ascendante :
// un ancien hash SHA-256 (64 hex) reste vérifiable, et sera ré-haché au sel au prochain set.
const SCRYPT_KEYLEN = 32;

function hashPinSalted(pin: string, salt: Buffer): string {
  return `scrypt$${salt.toString('hex')}$${scryptSync(pin, salt, SCRYPT_KEYLEN).toString('hex')}`;
}

/** Retourne le hash du PIN stocké, ou null si non configuré. */
export function getLockPin(): string | null {
  return readFile().lockPin ?? null;
}

/** Enregistre le PIN haché avec sel (scrypt). */
export function setLockPin(pin: string): Promise<void> {
  const stored = hashPinSalted(pin, randomBytes(16));
  return enqueueWrite(() => writeFile({ ...readFile(), lockPin: stored }));
}

/** Efface le PIN de verrouillage. */
export function clearLockPin(): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), lockPin: undefined }));
}

/** Vérifie un PIN. Supporte le nouveau format salé ET l'ancien SHA-256 (legacy). */
export function verifyLockPin(pin: string): boolean {
  const stored = readFile().lockPin;
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, saltHex, hashHex] = stored.split('$');
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  // Legacy : ancien hash SHA-256 non salé (comparaison en temps constant malgré tout).
  const legacy = Buffer.from(createHash('sha256').update(pin).digest('hex'));
  const storedBuf = Buffer.from(stored);
  return legacy.length === storedBuf.length && timingSafeEqual(legacy, storedBuf);
}

/** Retourne le timeout de verrouillage en minutes (défaut 15). */
export function getLockTimeout(): number {
  return readFile().lockTimeoutMinutes ?? 15;
}

/** Enregistre le timeout de verrouillage en minutes. */
export function setLockTimeout(minutes: number): Promise<void> {
  return enqueueWrite(() => writeFile({ ...readFile(), lockTimeoutMinutes: minutes }));
}

// --- Indicateurs de santé SMTP/IMAP (ADM-S2) --------------------------------

/** Persiste le résultat du dernier test SMTP. */
export function setLastSmtpCheck(ok: boolean): Promise<void> {
  return enqueueWrite(() => writeFile({
    ...readFile(),
    lastSmtpCheckAt: new Date().toISOString(),
    lastSmtpCheckOk: ok,
  }));
}

/** Retourne le résultat et l'horodatage du dernier test SMTP. */
export function getLastSmtpCheck(): { at: string | null; ok: boolean | null } {
  const f = readFile();
  return { at: f.lastSmtpCheckAt ?? null, ok: f.lastSmtpCheckOk ?? null };
}

/** Persiste le résultat du dernier test IMAP. */
export function setLastImapCheck(ok: boolean): Promise<void> {
  return enqueueWrite(() => writeFile({
    ...readFile(),
    lastImapCheckAt: new Date().toISOString(),
    lastImapCheckOk: ok,
  }));
}

/** Retourne le résultat et l'horodatage du dernier test IMAP. */
export function getLastImapCheck(): { at: string | null; ok: boolean | null } {
  const f = readFile();
  return { at: f.lastImapCheckAt ?? null, ok: f.lastImapCheckOk ?? null };
}

// --- Limite quotidienne d'envois (FM-02 + Strat #3 warm-up) -----------------

/**
 * Strat #3 — Ramp-up progressif CYCLIQUE (warm-up anti-suspension Gmail).
 *
 * La limite monte chaque jour : 10 → 20 → 30 → 40 → 49, puis redescend à 10 et
 * recommence le cycle (période 5 jours). L'idée : ne jamais envoyer un volume
 * constant ni un pic brutal qui déclenche les radars anti-spam de Gmail, tout en
 * restant sous le plafond de 50/jour. Le cycle se répète indéfiniment.
 *
 * Jour 0→10, 1→20, 2→30, 3→40, 4→49, 5→10, 6→20, … (dayAge % 5).
 */
const RAMP_CYCLE = [10, 20, 30, 40, 49];

function _rampLimit(firstSendDate: string | undefined): number {
  if (!firstSendDate) return RAMP_CYCLE[0]; // 1er envoi → bas du cycle
  const start = Date.parse(firstSendDate);
  const today = Date.parse(todayString());
  const dayAge = Math.max(0, Math.floor((today - start) / 86_400_000));
  return RAMP_CYCLE[dayAge % RAMP_CYCLE.length];
}

/** Retourne la limite d'envois quotidiens effective (ramp-up OU valeur manuelle si > palier). */
export function getDailySendLimit(): number {
  const f = readFile();
  const ramp = _rampLimit(f.firstSendDate);
  // Si l'utilisateur a configuré une limite manuellement ET qu'elle est inférieure
  // au palier ramp-up actuel, on respecte son choix (il veut aller plus doucement).
  if (f.dailySendLimit !== undefined) return Math.min(f.dailySendLimit, ramp);
  return ramp;
}

/**
 * Retourne { count, date } du compteur journalier.
 * Si la date stockée n'est pas aujourd'hui, le compteur est considéré à 0.
 */
function todayString(): string {
  // Date LOCALE (et non UTC) : le compteur quotidien doit se réinitialiser à
  // minuit heure de l'utilisateur, pas à 01h-02h (décalage UTC). 'sv-SE' rend
  // un format ISO « YYYY-MM-DD ».
  return new Date().toLocaleDateString('sv-SE');
}

export function getDailySendCount(): { count: number; date: string } {
  const f = readFile();
  const today = todayString();
  if (f.dailySendDate !== today) return { count: 0, date: today };
  return { count: f.dailySendCount ?? 0, date: today };
}

/**
 * tryIncrementDailySend — ROUAGE du plafond anti-suspension Gmail. « test-and-increment »
 * atomique : vérifie le quota du jour et, si OK, le consomme — en UN seul geste.
 *
 * Le rouage de l'atomicité est `enqueueWrite()` : il sérialise TOUTES les écritures de
 * secrets.json dans une chaîne de promesses, donc deux envois simultanés ne peuvent pas
 * lire `count` puis écrire `count+1` en se chevauchant (lost-update). Sans cette file, le
 * compteur partirait à la dérive et on dépasserait le plafond (= radar anti-spam Gmail).
 * Limite borné par le ramp-up cyclique (_rampLimit : 10→20→30→40→49→…). Le verrou est
 * INTRA-process : c'est pourquoi l'app interdit une seconde instance (cf. main.ts).
 */
export async function tryIncrementDailySend(): Promise<boolean> {
  let allowed = false;
  await enqueueWrite(async () => {
    const f = readFile();
    const today = todayString();
    // Respecte le cycle de ramp-up (et l'override manuel s'il est plus bas).
    const ramp = _rampLimit(f.firstSendDate);
    const limit = f.dailySendLimit !== undefined ? Math.min(f.dailySendLimit, ramp) : ramp;
    // Réinitialiser si le jour a changé.
    const count = f.dailySendDate === today ? (f.dailySendCount ?? 0) : 0;
    if (count >= limit) {
      allowed = false;
      return; // N'écrit rien — ne pas bloquer la file inutilement.
    }
    allowed = true;
    // Strat #3 : mémoriser la date du tout premier envoi pour le ramp-up.
    const firstSendDate = f.firstSendDate ?? today;
    await writeFile({ ...f, dailySendCount: count + 1, dailySendDate: today, firstSendDate });
  });
  return allowed;
}

/**
 * Rembourse un crédit consommé par tryIncrementDailySend quand l'envoi SMTP a
 * finalement échoué (l'email n'est jamais parti). Évite de sur-compter le quota
 * et donc d'envoyer moins que le plafond réel. Borné à 0 et au jour courant.
 */
export async function refundDailySend(): Promise<void> {
  await enqueueWrite(async () => {
    const f = readFile();
    const today = todayString();
    if (f.dailySendDate !== today) return; // jour différent → rien à rembourser
    const count = f.dailySendCount ?? 0;
    if (count <= 0) return;
    await writeFile({ ...f, dailySendCount: count - 1 });
  });
}
