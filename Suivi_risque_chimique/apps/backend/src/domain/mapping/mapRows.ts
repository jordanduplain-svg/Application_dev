import { normalizeText } from "./normalizeText.js";
import { parseFlexibleDate } from "./parseFlexibleDate.js";
import type {
  CanonicalItem,
  DegreExpositionItem,
  MappingConfig,
  MappingResult,
  PersonnelItem,
  RawRow,
  SourceRow,
  RisqueChimiqueItem,
  RowAnomaly,
} from "./types.js";

/**
 * Mapper de colonnes : lignes brutes → items canoniques + anomalies.
 *
 * Règles :
 *  - Une ligne avec un champ OBLIGATOIRE manquant ou une date illisible est
 *    REJETÉE entière (anomalie remontée avec le numéro de ligne Excel). On
 *    n'importe jamais une ligne « à moitié vraie » — cf. types.ts.
 *  - Une colonne mappée mais absente du fichier produit UNE anomalie globale
 *    (rowNumber 1, la ligne d'en-têtes) et invalide tout l'import du champ :
 *    c'est presque toujours une erreur de config de mapping, l'utilisateur
 *    doit la corriger avant d'aller plus loin.
 *  - Les champs date OPTIONNELS vides → null (légitime : encore en poste,
 *    produit encore utilisé). Mais une VALEUR PRÉSENTE et illisible → rejet,
 *    car la traduire en null inverserait son sens métier.
 *  - Les textes sont trimés mais conservés tels quels (casse, accents) pour
 *    l'affichage ; la normalisation ne sert qu'aux clés naturelles.
 */

interface FieldReaders {
  /** Texte obligatoire — rejet de la ligne si vide. */
  reqText(field: string): string | undefined;
  /** Texte optionnel — null si vide. */
  optText(field: string): string | null;
  /** Date obligatoire — rejet si vide ou illisible. */
  reqDate(field: string): Date | undefined;
  /** Date optionnelle — null si vide, rejet si illisible. */
  optDate(field: string): Date | null | undefined;
  failed(): boolean;
}

function makeReaders(
  row: RawRow,
  rowNumber: number,
  config: MappingConfig,
  missingColumns: Set<string>,
  anomalies: RowAnomaly[],
): FieldReaders {
  let rejected = false;

  const raw = (field: string): unknown => {
    const column = config.columns[field];
    if (column === undefined || missingColumns.has(field)) return undefined;
    return row[column];
  };

  const text = (field: string): string | null => {
    const v = raw(field);
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };

  return {
    reqText(field) {
      const v = text(field);
      if (v === null) {
        rejected = true;
        anomalies.push({
          rowNumber,
          field,
          code: "missing_required_field",
          message: `Le champ obligatoire « ${field} » est vide.`,
        });
        return undefined;
      }
      return v;
    },
    optText(field) {
      return text(field);
    },
    reqDate(field) {
      const r = parseFlexibleDate(raw(field));
      if (!r.ok) {
        rejected = true;
        anomalies.push({
          rowNumber,
          field,
          code: r.reason === "empty" ? "missing_required_field" : "invalid_date",
          message:
            r.reason === "empty"
              ? `La date obligatoire « ${field} » est vide.`
              : `La date « ${field} » est illisible (valeur : ${JSON.stringify(raw(field))}).`,
        });
        return undefined;
      }
      return r.date;
    },
    optDate(field) {
      const v = raw(field);
      const r = parseFlexibleDate(v);
      if (r.ok) return r.date;
      if (r.reason === "empty") return null;
      rejected = true;
      anomalies.push({
        rowNumber,
        field,
        code: "invalid_date",
        message: `La date « ${field} » est illisible (valeur : ${JSON.stringify(v)}). Ligne rejetée : la traduire en « vide » changerait son sens.`,
      });
      return undefined;
    },
    failed() {
      return rejected;
    },
  };
}

/**
 * Détecte les colonnes mappées absentes du fichier et produit les anomalies
 * de config correspondantes. On regarde l'UNION des clés de toutes les
 * lignes : certains connecteurs omettent les cellules vides au lieu de les
 * renvoyer à null, une colonne n'est donc "absente" que si AUCUNE ligne ne
 * la porte.
 */
function detectMissingColumns(
  rows: SourceRow[],
  config: MappingConfig,
  anomalies: RowAnomaly[],
): Set<string> {
  const missing = new Set<string>();
  if (rows.length === 0) return missing;
  const available = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.data)) available.add(key);
  }
  for (const [field, column] of Object.entries(config.columns)) {
    if (column !== undefined && !available.has(column)) {
      missing.add(field);
      anomalies.push({
        rowNumber: 1,
        field,
        code: "mapped_column_absent",
        message: `La colonne « ${column} » (champ « ${field} ») est introuvable dans le fichier. Vérifiez la configuration de correspondance.`,
      });
    }
  }
  return missing;
}

/** Partie « identité personne » d'une clé naturelle : matricule prioritaire. */
function personIdentityKey(matricule: string | null, nom: string, prenom: string): string {
  // Le matricule RH est stable (le nom peut changer : mariage, état civil).
  // Le repli nom+prénom n'est utilisé que si la source ne fournit pas de
  // matricule — la détection d'homonymes ambigus se fait à la jointure.
  return matricule !== null
    ? `m:${normalizeText(matricule)}`
    : `np:${normalizeText(nom)}|${normalizeText(prenom)}`;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

export function mapPersonnelRows(
  rows: SourceRow[],
  config: MappingConfig,
): MappingResult<PersonnelItem> {
  const anomalies: RowAnomaly[] = [];
  const missing = detectMissingColumns(rows, config, anomalies);
  const items: PersonnelItem[] = [];

  for (const { rowNumber, data } of rows) {
    const r = makeReaders(data, rowNumber, config, missing, anomalies);

    const nom = r.reqText("nom");
    const prenom = r.reqText("prenom");
    const codeSecteur = r.reqText("code_secteur");
    const dateDebutSecteur = r.reqDate("date_debut_secteur");
    const matricule = r.optText("matricule");
    const fonction = r.optText("fonction");
    const dateFinSecteur = r.optDate("date_fin_secteur");
    const entrepriseTravailTemporaire = r.optText("entreprise_tt");

    if (r.failed()) continue;
    // Les non-null sont garantis par failed() — assertions sûres.
    const item: PersonnelItem = {
      matricule,
      nom: nom as string,
      prenom: prenom as string,
      fonction,
      codeSecteur: codeSecteur as string,
      dateDebutSecteur: dateDebutSecteur as Date,
      dateFinSecteur: dateFinSecteur as Date | null,
      entrepriseTravailTemporaire,
      naturalKey: [
        personIdentityKey(matricule, nom as string, prenom as string),
        normalizeText(codeSecteur as string),
        isoDay(dateDebutSecteur as Date),
      ].join("|"),
    };
    items.push(item);
  }

  return { items, anomalies };
}

export function mapRisqueChimiqueRows(
  rows: SourceRow[],
  config: MappingConfig,
): MappingResult<RisqueChimiqueItem> {
  const anomalies: RowAnomaly[] = [];
  const missing = detectMissingColumns(rows, config, anomalies);
  const items: RisqueChimiqueItem[] = [];

  for (const { rowNumber, data } of rows) {
    const r = makeReaders(data, rowNumber, config, missing, anomalies);

    const designation = r.reqText("designation");
    const codeSecteur = r.reqText("code_secteur");
    const nCas = r.optText("n_cas");
    const classifSgh = r.optText("classif_sgh");
    const pictogrammes = r.optText("pictogrammes");
    const voiesExposition = r.optText("voies_exposition");
    const mentionDanger = r.optText("mention_danger");
    const mesuresPrevention = r.optText("mesures_prevention");
    const niveauRisque = r.optText("niveau_risque");
    const dateEvaluation = r.optDate("date_evaluation");
    const dateRetrait = r.optDate("date_retrait");

    if (r.failed()) continue;
    items.push({
      designation: designation as string,
      nCas,
      classifSgh,
      pictogrammes,
      voiesExposition,
      mentionDanger,
      mesuresPrevention,
      niveauRisque,
      dateEvaluation: dateEvaluation as Date | null,
      dateRetrait: dateRetrait as Date | null,
      codeSecteur: codeSecteur as string,
      naturalKey: [
        normalizeText(designation as string),
        normalizeText(codeSecteur as string),
      ].join("|"),
    });
  }

  return { items, anomalies };
}

/**
 * Dispatcher : applique le bon mapper selon le type de liste. Évite de
 * dupliquer le `switch` chez chaque appelant (import réel, dry-run d'aperçu).
 * Le type de retour est volontairement le supertype `CanonicalItem` — les
 * appelants qui n'ont besoin que des compteurs et des anomalies (dry-run) s'en
 * contentent ; l'import réel garde les fonctions typées par liste.
 */
export function mapByListType(
  rows: SourceRow[],
  config: MappingConfig,
): MappingResult<CanonicalItem> {
  switch (config.listType) {
    case "PERSONNEL":
      return mapPersonnelRows(rows, config);
    case "RISQUES_CHIMIQUES":
      return mapRisqueChimiqueRows(rows, config);
    case "DEGRE_EXPOSITION":
      return mapDegreExpositionRows(rows, config);
  }
}

export function mapDegreExpositionRows(
  rows: SourceRow[],
  config: MappingConfig,
): MappingResult<DegreExpositionItem> {
  const anomalies: RowAnomaly[] = [];
  const missing = detectMissingColumns(rows, config, anomalies);
  const items: DegreExpositionItem[] = [];

  for (const { rowNumber, data } of rows) {
    const r = makeReaders(data, rowNumber, config, missing, anomalies);

    const nom = r.reqText("nom");
    const prenom = r.reqText("prenom");
    const codeSecteur = r.reqText("code_secteur");
    const nomProduit = r.reqText("nom_produit");
    const degreExposition = r.reqText("degre_exposition");
    const matricule = r.optText("matricule");

    if (r.failed()) continue;
    items.push({
      matricule,
      nom: nom as string,
      prenom: prenom as string,
      codeSecteur: codeSecteur as string,
      nomProduit: nomProduit as string,
      // Texte brut conservé tel quel : le degré est polymorphe selon le
      // client (échelle, score, libellé) — cf. schema.prisma.
      degreExposition: degreExposition as string,
      naturalKey: [
        personIdentityKey(matricule, nom as string, prenom as string),
        normalizeText(codeSecteur as string),
        normalizeText(nomProduit as string),
      ].join("|"),
    });
  }

  return { items, anomalies };
}
