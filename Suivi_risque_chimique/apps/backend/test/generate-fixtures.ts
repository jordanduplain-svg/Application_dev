/**
 * Générateur de fixtures Excel SYNTHÉTIQUES pour les tests d'import.
 *
 * RÈGLE ABSOLUE (CONTRIBUTING / brief §17) : aucune donnée réelle. Tous les
 * noms sont des patronymes factices suffixés "-Test", les matricules sont
 * fictifs, les secteurs et produits sont génériques. Ce script est la SEULE
 * façon légitime de créer un fichier de données dans le dépôt.
 *
 * Le fichier généré couvre exprès des cas vicieux :
 *  - dates en 3 formats (ISO, FR, cellule typée date) ;
 *  - produit écrit avec casse/espaces différents entre les deux feuilles
 *    (rapprochement par normalisation) ;
 *  - une ligne sans matricule (repli nom+prénom) ;
 *  - une ligne avec champ obligatoire vide (anomalie attendue) ;
 *  - une date illisible (anomalie attendue) ;
 *  - une ligne vide au milieu (ignorée sans anomalie).
 *
 * Usage : pnpm --filter @cmr-tracker/backend exec tsx test/generate-fixtures.ts
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

async function main(): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });
  const workbook = new ExcelJS.Workbook();

  // --- Feuille PERSONNEL (colonnes nommées "à la cliente") ---
  const personnel = workbook.addWorksheet("Personnel");
  personnel.addRow([
    "Matricule",
    "Nom de famille",
    "Prénom",
    "Poste",
    "Code Atelier",
    "Entrée secteur",
    "Sortie secteur",
  ]);
  personnel.addRow(["EMP-001", "Durand-Test", "Alice", "Opératrice", "ATELIER-A", "15/01/2020", ""]);
  personnel.addRow(["EMP-002", "Moreau-Test", "Bruno", "Technicien", "ATELIER-A", "2018-06-01", "2023-03-31"]);
  // Cellule typée date (vraie Date Excel) :
  personnel.addRow(["EMP-003", "Petit-Test", "Chloé", "Chef d'équipe", "ATELIER-B", new Date(Date.UTC(2021, 8, 1)), ""]);
  // Sans matricule → repli nom+prénom :
  personnel.addRow(["", "Roux-Test", "David", "Opérateur", "ATELIER-B", "01/02/2022", ""]);
  // Ligne vide volontaire (doit être ignorée sans anomalie) :
  personnel.addRow(["", "", "", "", "", "", ""]);
  // Champ obligatoire vide (prenom) → anomalie attendue ligne 7 :
  personnel.addRow(["EMP-005", "Sans-Prenom-Test", "", "Opérateur", "ATELIER-A", "2020-01-01", ""]);
  // Date illisible → anomalie attendue ligne 8 :
  personnel.addRow(["EMP-006", "Date-Cassee-Test", "Erwan", "Opérateur", "ATELIER-A", "en poste depuis toujours", ""]);

  // --- Feuille RISQUES (produits par secteur) ---
  const risques = workbook.addWorksheet("Risques");
  risques.addRow([
    "Produit",
    "CAS",
    "SGH",
    "Pictos",
    "Voies",
    "Danger",
    "Prévention",
    "Niveau",
    "Évaluation",
    "Retrait",
    "Secteur",
  ]);
  risques.addRow([
    "Acétone Technique",
    "67-64-1",
    "H225, H319, H336",
    "GHS02, GHS07",
    "Inhalation, cutanée",
    "Liquide très inflammable",
    "Ventilation, gants nitrile",
    "Modéré",
    "2023-06-01",
    "",
    "ATELIER-A",
  ]);
  risques.addRow([
    "Toluène-Test",
    "108-88-3",
    "H225, H361d, H373",
    "GHS02, GHS08",
    "Inhalation",
    "Susceptible de nuire au fœtus",
    "Captage à la source",
    "Élevé",
    "15/03/2023",
    "31/12/2023", // produit retiré
    "ATELIER-A",
  ]);
  risques.addRow([
    "Dégraissant DX-Test",
    "",
    "H315",
    "GHS07",
    "Cutanée",
    "Irritation cutanée",
    "Gants",
    "Faible",
    "2024-01-10",
    "",
    "ATELIER-B",
  ]);

  // --- Feuille DEGRES (degré par personne × produit) ---
  const degres = workbook.addWorksheet("Degres");
  degres.addRow(["Matricule", "Nom", "Prénom", "Secteur", "Produit", "Degré"]);
  // Produit écrit différemment (casse/espaces) : la normalisation doit rapprocher.
  degres.addRow(["EMP-001", "Durand-Test", "Alice", "ATELIER-A", "  ACÉTONE   TECHNIQUE ", "Modéré"]);
  degres.addRow(["EMP-001", "Durand-Test", "Alice", "ATELIER-A", "Toluène-Test", "Fort"]);
  degres.addRow(["EMP-002", "Moreau-Test", "Bruno", "ATELIER-A", "Acétone Technique", "Faible"]);
  // Sans matricule (repli) + échelle numérique (degré polymorphe) :
  degres.addRow(["", "Roux-Test", "David", "ATELIER-B", "Dégraissant DX-Test", "2"]);

  const outPath = path.join(FIXTURES_DIR, "import-synthetique.xlsx");
  await workbook.xlsx.writeFile(outPath);
  // eslint-disable-next-line no-console
  console.log(`Fixture générée : ${outPath}`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
