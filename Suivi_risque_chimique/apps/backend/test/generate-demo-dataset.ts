/**
 * Générateur de jeu de données SYNTHÉTIQUE réaliste (brief §16.1).
 *
 * Produit un fichier Excel à 3 feuilles (mêmes en-têtes que la fixture de
 * test) représentant une ETI industrielle : ~280 salariés répartis sur
 * plusieurs secteurs, un catalogue de substances CMR, et des degrés
 * d'exposition. Il passe par le VRAI pipeline d'import (connecteur Excel).
 *
 * Données 100 % factices :
 *  - les noms/prénoms sont tirés de pools et assemblés aléatoirement : aucune
 *    personne réelle n'est représentée ;
 *  - en revanche, les substances, n° CAS et classifications SGH sont des FAITS
 *    PUBLICS de référence chimique (pas des données personnelles) — les
 *    utiliser rend la démo crédible.
 *
 * Déterministe : un PRNG seedé donne le même jeu à chaque exécution (utile
 * pour des démos et captures reproductibles). Les dates sont dérivées d'une
 * date d'ancrage passée en constante, pas de l'horloge.
 *
 * Cas limites volontaires : départs de secteur, produits retirés, salariés
 * sans matricule, et un secteur « DIRECTION » à effectif 1 — pour démontrer
 * que le k-anonymat masque les petits effectifs tout en publiant les grands.
 *
 * Usage : pnpm --filter @cmr-tracker/backend exec tsx test/generate-demo-dataset.ts
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

const OUT = path.join(import.meta.dirname, "fixtures", "demo-large.xlsx");

// --- PRNG déterministe (mulberry32). ---
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260614);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;
const chance = (p: number): boolean => rng() < p;
const intBetween = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

// --- Date helpers (format FR, déterministe). ---
const ANCHOR_YEAR = 2026;
function frDate(year: number, month: number, day: number): string {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}
function randomDate(minYear: number, maxYear: number): string {
  return frDate(intBetween(minYear, maxYear), intBetween(1, 12), intBetween(1, 28));
}

// --- Pools de noms (assemblés aléatoirement → personnes factices). ---
const NOMS = [
  "Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand",
  "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David",
  "Bertrand", "Roux", "Vincent", "Fournier", "Morel", "Girard", "André", "Mercier",
  "Blanc", "Guerin", "Boyer", "Garnier", "Chevalier", "Francois", "Legrand", "Gauthier",
];
const PRENOMS = [
  "Marie", "Jean", "Pierre", "Sophie", "Luc", "Camille", "Nicolas", "Julie",
  "Thomas", "Emma", "Paul", "Léa", "Antoine", "Chloé", "Hugo", "Manon",
  "Louis", "Sarah", "Maxime", "Laura", "Alexandre", "Inès", "Romain", "Clara",
];
const FONCTIONS = [
  "Opérateur", "Opératrice", "Technicien", "Technicienne", "Chef d'équipe",
  "Régleur", "Agent de maintenance", "Magasinier", "Soudeur", "Peintre industriel",
];

// --- Catalogue de substances CMR (faits publics : CAS + classification CLP). ---
interface Substance {
  designation: string;
  cas: string;
  sgh: string;
  danger: string;
}
const SUBSTANCES: Record<string, Substance> = {
  toluene: { designation: "Toluène", cas: "108-88-3", sgh: "H225, H361d, H373", danger: "Susceptible de nuire au fœtus" },
  styrene: { designation: "Styrène", cas: "100-42-5", sgh: "H351, H361d, H372", danger: "Susceptible de provoquer le cancer" },
  formaldehyde: { designation: "Formaldéhyde", cas: "50-00-0", sgh: "H350, H341, H301", danger: "Peut provoquer le cancer" },
  benzene: { designation: "Benzène", cas: "71-43-2", sgh: "H350, H340, H225", danger: "Peut provoquer le cancer" },
  trichlo: { designation: "Trichloréthylène", cas: "79-01-6", sgh: "H350, H341", danger: "Peut provoquer le cancer" },
  dichloro: { designation: "Dichlorométhane", cas: "75-09-2", sgh: "H351, H336", danger: "Susceptible de provoquer le cancer" },
  plomb: { designation: "Plomb (poussières)", cas: "7439-92-1", sgh: "H360FD, H372", danger: "Nuit à la fertilité et au fœtus" },
  silice: { designation: "Silice cristalline", cas: "14808-60-7", sgh: "H350i, H372", danger: "Peut provoquer le cancer par inhalation" },
  chromates: { designation: "Chromates (Cr VI)", cas: "18540-29-9", sgh: "H350, H340, H317", danger: "Peut provoquer le cancer" },
  hexane: { designation: "N-Hexane", cas: "110-54-3", sgh: "H361f, H373, H225", danger: "Susceptible de nuire à la fertilité" },
  cadmium: { designation: "Cadmium", cas: "7440-43-9", sgh: "H350, H341, H361fd, H372", danger: "Peut provoquer le cancer" },
};

// --- Secteurs : produits présents + poids d'effectif. ---
interface SectorDef {
  code: string;
  products: (keyof typeof SUBSTANCES)[];
  headcount: number;
}
const SECTORS: SectorDef[] = [
  { code: "USINAGE", products: ["hexane", "trichlo", "dichloro"], headcount: 55 },
  { code: "PEINTURE", products: ["toluene", "styrene", "dichloro"], headcount: 48 },
  { code: "SOUDAGE", products: ["chromates", "plomb", "cadmium"], headcount: 42 },
  { code: "TRAITEMENT-SURFACE", products: ["chromates", "trichlo"], headcount: 30 },
  { code: "LABORATOIRE", products: ["formaldehyde", "benzene"], headcount: 22 },
  { code: "FONDERIE", products: ["silice", "plomb"], headcount: 50 },
  { code: "MAINTENANCE", products: ["hexane", "toluene"], headcount: 30 },
  // Effectif unique : doit être MASQUÉ dans l'export CSE (k-anonymat).
  { code: "DIRECTION", products: ["formaldehyde"], headcount: 1 },
];

const DEGRES = ["Faible", "Modéré", "Fort"] as const;

async function main(): Promise<void> {
  await mkdir(path.dirname(OUT), { recursive: true });
  const wb = new ExcelJS.Workbook();

  const personnel = wb.addWorksheet("Personnel");
  personnel.addRow(["Matricule", "Nom de famille", "Prénom", "Poste", "Code Atelier", "Entrée secteur", "Sortie secteur"]);

  const risques = wb.addWorksheet("Risques");
  risques.addRow(["Produit", "CAS", "SGH", "Pictos", "Voies", "Danger", "Prévention", "Niveau", "Évaluation", "Retrait", "Secteur"]);

  const degres = wb.addWorksheet("Degres");
  degres.addRow(["Matricule", "Nom", "Prénom", "Secteur", "Produit", "Degré"]);

  // --- Risques : une ligne par (produit, secteur). ~10 % retirés. ---
  for (const sector of SECTORS) {
    for (const key of sector.products) {
      const s = SUBSTANCES[key]!;
      risques.addRow([
        s.designation,
        s.cas,
        s.sgh,
        "GHS08",
        "Inhalation, cutanée",
        s.danger,
        "Captage à la source, EPI adaptés",
        chance(0.3) ? "Élevé" : "Modéré",
        randomDate(2021, 2024),
        chance(0.1) ? randomDate(2024, 2025) : "", // retrait occasionnel
        sector.code,
      ]);
    }
  }

  // --- Personnel + degrés. ---
  let matCounter = 1;
  for (const sector of SECTORS) {
    for (let i = 0; i < sector.headcount; i++) {
      const nom = pick(NOMS);
      const prenom = pick(PRENOMS);
      // ~5 % sans matricule (intérim/prestataire) → repli nom+prénom à la jointure.
      const hasMat = !(sector.code !== "DIRECTION" && chance(0.05));
      const matricule = hasMat ? `EMP-${String(matCounter).padStart(4, "0")}` : "";
      matCounter += 1;

      const entree = randomDate(2014, 2024);
      const sortie = chance(0.12) ? randomDate(2024, 2025) : ""; // ~12 % partis

      personnel.addRow([matricule, nom, prenom, pick(FONCTIONS), sector.code, entree, sortie]);

      // Degrés. Toute personne du secteur est potentiellement exposée à
      // chaque produit du secteur (jointure PERSONNEL × RISQUES, brief §7).
      // La liste DEGRE_EXPOSITION ne fait qu'AJOUTER un degré : on n'émet une
      // ligne QUE lorsqu'un degré est réellement renseigné. ~20 % des couples
      // n'ont pas de ligne → le tableau de bord affichera « — » (degré non
      // évalué, légitime : R. 4412-93-1 « lorsqu'elles sont connues »).
      for (const key of sector.products) {
        if (chance(0.2)) continue; // degré non renseigné → pas de ligne
        degres.addRow([
          matricule,
          nom,
          prenom,
          sector.code,
          SUBSTANCES[key]!.designation,
          pick(DEGRES),
        ]);
      }
    }
  }

  await wb.xlsx.writeFile(OUT);
  const total = SECTORS.reduce((n, s) => n + s.headcount, 0);
  // eslint-disable-next-line no-console
  console.log(
    `[generate] ${OUT}\n[generate] ${total} salariés, ${SECTORS.length} secteurs, ` +
      `${Object.keys(SUBSTANCES).length} substances CMR (ancrage ${ANCHOR_YEAR}).`,
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
