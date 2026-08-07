/**
 * Seed de DÉMO pour le développement local : 6 comptes (un par rôle) et
 * import de la fixture synthétique dans le tenant `default`.
 *
 * STRICTEMENT réservé au dev : emails en @demo.local, mot de passe commun
 * affiché en sortie. Ne JAMAIS exécuter sur une base de production.
 *
 * Usage : pnpm --filter @cmr-tracker/backend run seed:demo
 */

import path from "node:path";

import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

import { ImportListUseCase } from "../src/application/import/ImportListUseCase.js";
import { normalizeText } from "../src/domain/mapping/normalizeText.js";
import type { MappingConfig } from "../src/domain/mapping/types.js";
import { ExcelDataSource } from "../src/infrastructure/connectors/excel/ExcelDataSource.js";
import { SystemClock } from "../src/infrastructure/clock/SystemClock.js";
import { PrismaImportJournal } from "../src/infrastructure/persistence/PrismaImportJournal.js";
import { PrismaListRepository } from "../src/infrastructure/persistence/PrismaListRepository.js";

process.env.DATABASE_URL ??=
  "postgresql://cmr:cmr_dev_password@localhost:5435/cmr_tracker?schema=public";

const DEMO_PASSWORD = "demo-cmr-2026!";
// Fixture paramétrable (1er argument CLI, portable Windows/Unix) : petit jeu
// par défaut, grand jeu réaliste via `tsx test/seed-demo.ts demo-large.xlsx`.
const FIXTURE_NAME = process.argv[2] ?? "import-synthetique.xlsx";
const FIXTURE = path.join(import.meta.dirname, "fixtures", FIXTURE_NAME);

const SHEETS: { sheet: string; mapping: MappingConfig }[] = [
  {
    sheet: "Personnel",
    mapping: {
      listType: "PERSONNEL",
      columns: {
        matricule: "Matricule",
        nom: "Nom de famille",
        prenom: "Prénom",
        fonction: "Poste",
        code_secteur: "Code Atelier",
        date_debut_secteur: "Entrée secteur",
        date_fin_secteur: "Sortie secteur",
      },
    },
  },
  {
    sheet: "Risques",
    mapping: {
      listType: "RISQUES_CHIMIQUES",
      columns: {
        designation: "Produit",
        n_cas: "CAS",
        classif_sgh: "SGH",
        pictogrammes: "Pictos",
        voies_exposition: "Voies",
        mention_danger: "Danger",
        mesures_prevention: "Prévention",
        niveau_risque: "Niveau",
        date_evaluation: "Évaluation",
        date_retrait: "Retrait",
        code_secteur: "Secteur",
      },
    },
  },
  {
    sheet: "Degres",
    mapping: {
      listType: "DEGRE_EXPOSITION",
      columns: {
        matricule: "Matricule",
        nom: "Nom",
        prenom: "Prénom",
        code_secteur: "Secteur",
        nom_produit: "Produit",
        degre_exposition: "Degré",
      },
    },
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const clock = new SystemClock();
  const repository = new PrismaListRepository(prisma, clock);
  const importer = new ImportListUseCase(repository, new PrismaImportJournal(prisma), clock);

  // --- Comptes démo (idempotent : upsert par email). ---
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const accounts = [
    { email: "admin@demo.local", displayName: "Admin Démo", role: "ADMIN" as const },
    { email: "hse@demo.local", displayName: "HSE Démo", role: "HSE" as const },
    { email: "rh@demo.local", displayName: "RH Démo", role: "RH" as const },
    { email: "medecine@demo.local", displayName: "Médecine Démo", role: "MEDECINE" as const },
    { email: "manager@demo.local", displayName: "Manager Atelier B", role: "MANAGER" as const },
    {
      email: "alice@demo.local",
      displayName: "Alice Durand-Test",
      role: "COLLABORATEUR" as const,
      matricule: "EMP-001",
    },
  ];

  for (const account of accounts) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: "default", email: account.email } },
      create: {
        tenantId: "default",
        email: account.email,
        displayName: account.displayName,
        role: account.role,
        matricule: "matricule" in account ? account.matricule : null,
        passwordHash,
      },
      update: { passwordHash, isActive: true },
    });
    if (account.role === "MANAGER") {
      await prisma.managerSector.upsert({
        where: { userId_codeSecteur: { userId: user.id, codeSecteur: "ATELIER-B" } },
        create: { userId: user.id, codeSecteur: "ATELIER-B" },
        update: {},
      });
    }
  }

  // --- Données métier : fixture synthétique dans le tenant default. ---
  for (const { sheet, mapping } of SHEETS) {
    const result = await importer.execute(new ExcelDataSource(), {
      mapping,
      table: { location: FIXTURE, table: sheet },
      sourceLabel: `seed-demo#${sheet}`,
      write: { tenantId: "default", recordedBy: "seed-demo" },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[seed] ${sheet}: ${result.status} (créés=${result.report.created}, màj=${result.report.updated}, inchangés=${result.report.unchanged}, anomalies=${result.anomalies.length})`,
    );
  }

  // --- Produit CMR de démo (H350/H340) dans ATELIER-A, pour que le badge CMR,
  // le filtre « CMR uniquement » et les compteurs de conformité/analytique
  // soient visibles (le jeu importé n'a aucun CMR 1A/1B). Idempotent.
  const ctx = { tenantId: "default", recordedBy: "seed-demo" };
  const cmrSecteur = "ATELIER-A";
  await repository.upsertRisquesChimiques(
    [
      {
        naturalKey: `${normalizeText("Benzène (démo)")}|${normalizeText(cmrSecteur)}`,
        designation: "Benzène (démo)",
        nCas: "71-43-2",
        classifSgh: "H350, H340",
        pictogrammes: null,
        voiesExposition: null,
        mentionDanger: "Peut provoquer le cancer ; peut induire des anomalies génétiques",
        mesuresPrevention: null,
        niveauRisque: null,
        dateEvaluation: new Date("2024-01-15"),
        dateRetrait: null,
        codeSecteur: cmrSecteur,
      },
    ],
    ctx,
  );
  await repository.upsertDegresExposition(
    [
      {
        naturalKey: `m:${normalizeText("EMP-001")}|${normalizeText(cmrSecteur)}|${normalizeText("Benzène (démo)")}`,
        matricule: "EMP-001",
        nom: "Durand-Test",
        prenom: "Alice",
        codeSecteur: cmrSecteur,
        nomProduit: "Benzène (démo)",
        degreExposition: "Fort",
      },
    ],
    ctx,
  );

  // --- Moteur de flux : sources d'import + un flow nocturne par défaut. ---
  // Idempotent : on repart de zéro pour ce tenant de démo.
  await prisma.flow.deleteMany({ where: { tenantId: "default" } });
  await prisma.importSource.deleteMany({ where: { tenantId: "default" } });

  for (const { sheet, mapping } of SHEETS) {
    await prisma.importSource.create({
      data: {
        tenantId: "default",
        name: `Fichier ${sheet}`,
        listType: mapping.listType,
        connectorType: "excel",
        // Chemin ABSOLU de la fixture : le scheduler s'exécute sans cwd garanti.
        config: { location: FIXTURE, sheet },
        mapping: { columns: mapping.columns },
        enabled: true,
      },
    });
  }

  await prisma.flow.create({
    data: {
      tenantId: "default",
      name: "Réimport nocturne",
      // Chaque nuit à 2 h. Déclenchable aussi à la main (bouton Admin/HSE).
      cronExpression: "0 2 * * *",
      enabled: true,
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    `\n[seed] Comptes démo prêts (mot de passe commun : ${DEMO_PASSWORD})\n` +
      accounts.map((a) => `  - ${a.email} (${a.role})`).join("\n") +
      `\n[seed] Flow « Réimport nocturne » (0 2 * * *) + 3 sources Excel créés.`,
  );

  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
