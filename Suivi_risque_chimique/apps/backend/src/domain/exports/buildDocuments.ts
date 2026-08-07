import type { AnonymizedView } from "../anonymization/types.js";
import type { DashboardRow } from "../dashboard/types.js";
import { formatDateFr, formatDureeAnnees, orDash } from "./format.js";
import type { ExportDocument, ExportSection } from "./types.js";

/**
 * Constructeurs de documents d'export — fonctions PURES.
 *
 * Chaque constructeur reçoit les données (déjà filtrées par le RBAC en amont)
 * et `generatedAt` (l'instant d'horloge, injecté pour le déterminisme). Il
 * produit un `ExportDocument` neutre, rendu ensuite en PDF ou Excel.
 *
 * Les références d'articles figurent en méta de chaque document : un export
 * réglementaire doit porter sa base légale.
 */

const DISCLAIMER =
  "Document contenant des données de santé à caractère personnel. " +
  "Diffusion restreinte aux personnes habilitées. Outil fourni sans garantie, " +
  "conformité à faire valider (préventeur / juriste).";

/** Tri nominatif stable : nom, prénom, secteur, produit. */
function sortRows(rows: DashboardRow[]): DashboardRow[] {
  return [...rows].sort(
    (a, b) =>
      a.nom.localeCompare(b.nom, "fr") ||
      a.prenom.localeCompare(b.prenom, "fr") ||
      a.codeSecteur.localeCompare(b.codeSecteur, "fr") ||
      a.designation.localeCompare(b.designation, "fr"),
  );
}

/** Cellule « durée » : signale l'anomalie de dates plutôt qu'un faux chiffre. */
function dureeCell(row: DashboardRow): string {
  return row.exposureAnomalies.length > 0
    ? "Dates incohérentes — durée non calculée"
    : formatDureeAnnees(row.dureeExpositionAnnees);
}

// ---------------------------------------------------------------------
// 1. Export INDIVIDUEL — pour le salarié (R. 4412-93-2)
// ---------------------------------------------------------------------

export function buildIndividualDocument(
  rows: DashboardRow[],
  generatedAt: Date,
): ExportDocument {
  const first = rows[0];
  const fullName = first !== undefined ? `${first.prenom} ${first.nom}` : "—";

  const sections: ExportSection[] = [];

  if (first !== undefined) {
    sections.push({
      heading: "Identité",
      fields: [
        { label: "Nom", value: first.nom },
        { label: "Prénom", value: first.prenom },
        { label: "Matricule", value: orDash(first.matricule) },
        { label: "Fonction", value: orDash(first.fonction) },
      ],
    });
  }

  sections.push({
    heading: "Expositions",
    table: {
      columns: [
        "Secteur",
        "Entrée",
        "Sortie",
        "Produit",
        "N° CAS",
        "Classification SGH",
        "Mention de danger",
        "Degré",
        "Durée d'exposition",
      ],
      rows: sortRows(rows).map((r) => [
        r.codeSecteur,
        formatDateFr(r.dateDebutSecteur),
        formatDateFr(r.dateFinSecteur),
        r.designation,
        orDash(r.nCas),
        orDash(r.classifSgh),
        orDash(r.mentionDanger),
        orDash(r.degreExposition),
        dureeCell(r),
      ]),
    },
    ...(rows.length === 0 ? { notes: ["Aucune exposition enregistrée à ce jour."] } : {}),
  });

  return {
    type: "individual",
    title: "Attestation d'exposition aux agents chimiques CMR",
    subtitle: fullName,
    meta: [
      { label: "Date d'édition", value: formatDateFr(generatedAt) },
      { label: "Base légale", value: "Art. R. 4412-93-1 et R. 4412-93-2 du Code du travail" },
      { label: "Destinataire", value: "Le travailleur concerné" },
    ],
    sections,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------
// 2. Export NOMINATIF complet — pour le SPST (R. 4412-93-3)
// ---------------------------------------------------------------------

export function buildNominativeDocument(
  rows: DashboardRow[],
  generatedAt: Date,
): ExportDocument {
  return {
    type: "spst_nominative",
    title: "Liste nominative des travailleurs exposés aux agents chimiques CMR",
    subtitle: `${new Set(rows.map((r) => `${r.nom}|${r.prenom}|${r.matricule ?? ""}`)).size} travailleur(s) — ${rows.length} exposition(s)`,
    meta: [
      { label: "Date d'édition", value: formatDateFr(generatedAt) },
      { label: "Base légale", value: "Art. R. 4412-93-1 et R. 4412-93-3 du Code du travail" },
      { label: "Destinataire", value: "Service de prévention et de santé au travail (SPST)" },
      { label: "Conservation", value: "Au moins 40 ans (DMST)" },
    ],
    sections: [
      {
        table: {
          columns: [
            "Nom",
            "Prénom",
            "Matricule",
            "Fonction",
            "ETT (intérim)",
            "Secteur",
            "Entrée",
            "Sortie",
            "Produit",
            "N° CAS",
            "Classification SGH",
            "Mention de danger",
            "Évaluation",
            "Retrait",
            "Degré",
            "Durée d'exposition",
          ],
          rows: sortRows(rows).map((r) => [
            r.nom,
            r.prenom,
            orDash(r.matricule),
            orDash(r.fonction),
            orDash(r.entrepriseTravailTemporaire),
            r.codeSecteur,
            formatDateFr(r.dateDebutSecteur),
            formatDateFr(r.dateFinSecteur),
            r.designation,
            orDash(r.nCas),
            orDash(r.classifSgh),
            orDash(r.mentionDanger),
            formatDateFr(r.dateEvaluation),
            formatDateFr(r.dateRetrait),
            orDash(r.degreExposition),
            dureeCell(r),
          ]),
        },
        ...(rows.length === 0 ? { notes: ["Aucun travailleur exposé enregistré."] } : {}),
      },
    ],
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------
// 3. Export ANONYMISÉ — pour le CSE et les autres travailleurs (R. 4412-93-2)
// ---------------------------------------------------------------------

export function buildAnonymizedDocument(
  view: AnonymizedView,
  generatedAt: Date,
): ExportDocument {
  const notes: string[] = [];
  if (view.masque.groupes > 0) {
    // Transparence sans fuite (ADR 0005) : on dit combien, jamais lesquels.
    notes.push(
      `${view.masque.groupes} regroupement(s) (secteur × produit) ` +
        `concernant ${view.masque.expositions} exposition(s) n'ont pas été détaillés : ` +
        `leur effectif est inférieur au seuil d'anonymat (k = ${view.k}), ` +
        `afin d'éviter toute ré-identification.`,
    );
  }

  return {
    type: "cse_anonymized",
    title: "Liste anonymisée des expositions aux agents chimiques CMR",
    subtitle: "Version destinée au CSE et aux travailleurs",
    meta: [
      { label: "Date d'édition", value: formatDateFr(generatedAt) },
      { label: "Base légale", value: "Art. R. 4412-93-2 du Code du travail" },
      { label: "Destinataire", value: "Membres du CSE et autres travailleurs" },
      { label: "Seuil d'anonymat", value: `k = ${view.k}` },
    ],
    sections: [
      {
        table: {
          columns: [
            "Secteur",
            "Produit",
            "N° CAS",
            "Classification SGH",
            "Mention de danger",
            "Effectif exposé",
            "Répartition des degrés",
          ],
          rows: view.groups.map((g) => [
            g.codeSecteur,
            g.designation,
            orDash(g.nCas),
            orDash(g.classifSgh),
            orDash(g.mentionDanger),
            String(g.effectifExpose),
            formatDegres(g.degres, g.effectifSansDegre, g.effectifDegreMasque),
          ]),
        },
        notes: [
          ...(view.groups.length === 0
            ? ["Aucune donnée publiable au seuil d'anonymat retenu."]
            : []),
          ...notes,
        ],
      },
    ],
    disclaimer:
      "Version anonymisée — ne contient aucune donnée nominative. " +
      "Les effectifs inférieurs au seuil d'anonymat sont masqués.",
  };
}

function formatDegres(
  degres: { valeur: string; effectif: number }[],
  sansDegre: number,
  masque: number,
): string {
  const parts = degres.map((d) => `${d.valeur} : ${d.effectif}`);
  if (sansDegre > 0) parts.push(`Non renseigné : ${sansDegre}`);
  // Agrégat des modalités masquées (sous le seuil k) : on dit combien, pas lesquelles.
  if (masque > 0) parts.push(`Autres (masqués) : ${masque}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}
