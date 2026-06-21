import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

/**
 * Dictionnaire d'exclusion du scraping : domaines à NE JAMAIS re-scraper
 * (leads jugés non pertinents). Persistant entre sessions. Uni à la liste des
 * domaines déjà en base au lancement → passé en `--exclude-file` au scraper Python.
 */
const FILE = 'scrape-exclude.json';
const filePath = (): string => join(app.getPath('userData'), FILE);

export function getExcludedDomains(): string[] {
  try {
    const p = filePath();
    if (existsSync(p)) {
      const arr = JSON.parse(readFileSync(p, 'utf8'));
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
    }
  } catch { /* non bloquant */ }
  return [];
}

/** Ajoute des domaines (normalisés, dédupliqués) et renvoie la liste complète. */
export function addExcludedDomains(domains: string[]): string[] {
  const set = new Set(getExcludedDomains());
  for (const d of domains) {
    const n = d.trim().toLowerCase().replace(/^www\./, '');
    if (n) set.add(n);
  }
  const out = [...set];
  try { writeFileSync(filePath(), JSON.stringify(out), 'utf8'); } catch { /* non bloquant */ }
  return out;
}
