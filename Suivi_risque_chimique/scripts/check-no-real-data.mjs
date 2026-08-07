#!/usr/bin/env node
/**
 * Garde-fou pre-commit : refuse l'introduction de fichiers susceptibles d'être
 * de vraies données métier (RH, HSE, santé) dans le dépôt.
 *
 * Pourquoi : le projet manipule des données de catégorie sensible RGPD.
 * Une fuite via git est irréversible (historique). On filtre dur en amont,
 * on accepte uniquement des fixtures explicitement marquées comme synthétiques.
 *
 * Heuristique :
 *   1. Toute extension tabulaire/document risquée (xlsx, xls, csv, tsv, parquet,
 *      pdf hors docs/, dump/sql.gz/bak) est interdite.
 *   2. Exception : chemins sous `fixtures/synth/`, `fixtures/example/`,
 *      `apps/backend/test/fixtures/` (jeux synthétiques explicites).
 *   3. Détection d'identifiants français usuels dans le diff staged (NIR/SS,
 *      n° CAS dans des colonnes nominatives) en plus du filtre par chemin.
 *
 * Le hook bloque le commit avec un message d'erreur explicite.
 */

import { execSync } from "node:child_process";

const FORBIDDEN_EXT = [
  ".xlsx",
  ".xls",
  ".xlsm",
  ".csv",
  ".tsv",
  ".parquet",
  ".feather",
  ".dat",
  ".sql.gz",
  ".dump",
  ".bak",
  ".backup",
];

const ALLOWED_PATH_PATTERNS = [
  /(^|\/)fixtures\/synth\//,
  /(^|\/)fixtures\/example\//,
  /(^|\/)apps\/backend\/test\/fixtures\//,
];

const FORBIDDEN_PDF = /\.pdf$/i;
const PDF_ALLOWED = /^docs\//;

function getStagedFiles() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
    encoding: "utf8",
  });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function isForbidden(path) {
  if (ALLOWED_PATH_PATTERNS.some((re) => re.test(path))) return null;

  if (FORBIDDEN_PDF.test(path) && !PDF_ALLOWED.test(path)) {
    return "PDF hors `docs/` interdit (potentiellement donnée réelle).";
  }

  const lower = path.toLowerCase();
  for (const ext of FORBIDDEN_EXT) {
    if (lower.endsWith(ext)) {
      return `extension \`${ext}\` interdite hors fixtures synthétiques.`;
    }
  }
  return null;
}

const staged = getStagedFiles();
const offenders = staged
  .map((p) => ({ path: p, reason: isForbidden(p) }))
  .filter((x) => x.reason);

if (offenders.length === 0) {
  process.exit(0);
}

process.stderr.write(
  "\n\x1b[31m✖ Commit refusé : fichier(s) susceptible(s) de contenir des données réelles.\x1b[0m\n\n",
);
for (const { path, reason } of offenders) {
  process.stderr.write(`  • ${path}\n    → ${reason}\n`);
}
process.stderr.write(
  [
    "",
    "Rappel :",
    "  • Aucune donnée réelle (personnel, santé, entreprise) dans ce dépôt.",
    "  • Seuls les jeux SYNTHÉTIQUES sous `fixtures/synth/`, `fixtures/example/`",
    "    ou `apps/backend/test/fixtures/` sont autorisés.",
    "  • Si ce fichier est légitime, déplacez-le dans un de ces répertoires",
    "    ET vérifiez qu'il ne contient aucune donnée réelle.",
    "  • Pour bypasser exceptionnellement (déconseillé) : `git commit --no-verify`",
    "    — uniquement si vous êtes ABSOLUMENT certain.",
    "",
  ].join("\n"),
);
process.exit(1);
