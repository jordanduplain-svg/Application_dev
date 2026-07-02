import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { isScraperRunning } from './scraperState';

/**
 * BOUNCE-CSV — pont entre le SUIVI des candidatures (SQLite, propre à Carreer-ops) et
 * le MASTER de leads scrapés (CSV, propre au scraper Python). Sans ce pont, un email
 * qui rebondit reste « valide » aux yeux d'une future campagne : rien ne dit sur la
 * page Leads qu'il a déjà été essayé et a échoué.
 *
 * Résolution de chemin dupliquée (volontairement minimale) depuis scraping.ipc.ts :
 * ce module vit dans src/lib (couche métier) pour être appelable depuis src/tasks
 * (poll-replies) sans dépendance electron/ipc → src/, qui serait le mauvais sens
 * de la couche. Le scraper Python round-trip la colonne `bounced` sans jamais la
 * recalculer (cf. models.py / io_csv.py / pipeline.py — champ BOUNCE-CSV).
 */

interface MinimalScrapingConfig {
  scriptPath?: string;
}

function masterCsvPath(): string | null {
  try {
    const configFile = join(app.getPath('userData'), 'scraping-config.json');
    if (!existsSync(configFile)) return null;
    const cfg = JSON.parse(readFileSync(configFile, 'utf8')) as MinimalScrapingConfig;
    if (!cfg.scriptPath) return null;
    const scriptDir = join(cfg.scriptPath, '..');
    const inData = join(scriptDir, 'data', 'candio_leads.csv');
    if (existsSync(inData)) return inData;
    const legacy = join(scriptDir, 'candio_leads.csv');
    return existsSync(legacy) ? legacy : null;
  } catch {
    return null;
  }
}

/** Parseur CSV minimal (guillemets, virgules, sauts de ligne échappés) — cf. scraping.ipc.ts. */
function parseCsvFile(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

function toCsvLine(fields: string[]): string {
  return fields.map((f) => {
    const v = f ?? '';
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');
}

/**
 * Marque TOUS les leads du master dont le contactEmail correspond (insensible à la
 * casse) comme « bounced » ("1"). Ajoute la colonne au header si absente (CSV d'un
 * scraper plus ancien). Best-effort : ne throw jamais — un échec n'est pas censé
 * bloquer le traitement d'une réponse/bounce IMAP, juste un affichage manqué.
 *
 * HARDENING (anti-perte de données, ce writer tournant en TÂCHE DE FOND) :
 *  1. SKIP si un scraper Python tourne → jamais d'écriture concurrente du master.
 *  2. IDEMPOTENT : n'écrit QUE si une valeur change réellement (pas de réécriture inutile
 *     à chaque relevé IMAP, donc surface d'exposition minimale).
 *  3. GARDE anti-troncature : refuse d'écrire un résultat manifestement vidé/illisible.
 *  4. Écriture ATOMIQUE (temp + rename) : un crash en cours d'écriture ne peut pas
 *     tronquer/corrompre le master — soit l'ancien fichier intact, soit le nouveau complet.
 */
export function markLeadBounced(contactEmail: string): boolean {
  try {
    // 1. Ne jamais écrire pendant qu'un scraper réécrit le même fichier.
    if (isScraperRunning()) return false;

    const path = masterCsvPath();
    if (!path) return false;
    const rows = parseCsvFile(readFileSync(path, 'utf8'));
    if (rows.length < 2) return false;

    const header = rows[0];
    const iEmail = header.indexOf('contactEmail');
    if (iEmail < 0) return false;

    let iBounced = header.indexOf('bounced');
    if (iBounced < 0) { header.push('bounced'); iBounced = header.length - 1; }

    const target = contactEmail.trim().toLowerCase();
    let changed = false;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if ((row[iEmail] ?? '').trim().toLowerCase() === target) {
        while (row.length <= iBounced) row.push('');
        // 2. Idempotent : on ne « change » que si ce n'était pas déjà marqué.
        if (row[iBounced] !== '1') { row[iBounced] = '1'; changed = true; }
      }
    }
    if (!changed) return false; // rien à écrire (email absent OU déjà marqué)

    // 3. Garde anti-troncature : on écrit exactement ce qu'on a lu + 1 colonne ;
    //    si le nombre de lignes a fondu, c'est une lecture ratée → on n'écrase pas.
    const out = rows.map(toCsvLine).join('\n');
    if (rows.length < 2 || out.length < 20) return false;

    // 4. Écriture atomique : temp sur le MÊME dossier (donc même volume → rename atomique).
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, out, 'utf8');
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}
