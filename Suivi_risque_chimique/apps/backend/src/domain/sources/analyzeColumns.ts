import { parseFlexibleDate } from "../mapping/parseFlexibleDate.js";
import type { SourceRow } from "../mapping/types.js";

/**
 * Profilage des colonnes d'une source — la « vue data analyst » de l'aperçu.
 *
 * Pour chaque colonne du fichier, on calcule de quoi décider d'un mapping :
 *  - le TYPE dominant (texte / nombre / date) inféré sur les cellules non
 *    vides : oriente le rapprochement avec les champs canoniques (un champ
 *    date attend une colonne majoritairement « date ») ;
 *  - le taux de REMPLISSAGE : une colonne presque vide mappée sur un champ
 *    obligatoire annonce un import en grande partie rejeté ;
 *  - le nombre de valeurs DISTINCTES : révèle une colonne « catégorielle »
 *    (degré, secteur) vs un identifiant ;
 *  - un ÉCHANTILLON de valeurs distinctes pour que l'humain reconnaisse la
 *    colonne d'un coup d'œil.
 *
 * Aucune donnée n'est jamais devinée ni corrigée ici : on DÉCRIT la source,
 * telle quelle, pour outiller la décision de mapping. Fonction pure.
 *
 * Confidentialité : ces profils peuvent contenir des valeurs de cellules
 * (donc potentiellement des noms). Ils sont calculés à la demande et renvoyés
 * à un utilisateur ADMIN/HSE habilité — ils ne sont JAMAIS journalisés ni
 * persistés (cf. règle « pas de PII dans les logs »).
 */

export type InferredType = "empty" | "date" | "number" | "text";

export interface ColumnProfile {
  /** Nom de colonne tel qu'il apparaît dans l'en-tête du fichier. */
  name: string;
  inferredType: InferredType;
  /** Nombre de cellules renseignées (non vides). */
  filledCount: number;
  /** Nombre total de lignes examinées. */
  totalCount: number;
  /** Nombre de valeurs distinctes (sur les cellules non vides). */
  distinctCount: number;
  /** Jusqu'à `sampleSize` valeurs distinctes, pour reconnaissance visuelle. */
  sampleValues: string[];
}

export interface ColumnAnalysis {
  rowCount: number;
  columns: ColumnProfile[];
}

const DEFAULT_SAMPLE_SIZE = 5;

function cellToText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Type d'une cellule non vide. On considère « date » via le même parseur que
 * l'import (cohérence) ; sinon « number » pour un numérique pur ; « text »
 * sinon. Une chaîne purement numérique courte (ex. « 12 ») reste un nombre,
 * pas une date — le parseur de dates ne l'accepte pas hors fenêtre série.
 */
function cellType(value: unknown): Exclude<InferredType, "empty"> {
  if (parseFlexibleDate(value).ok) return "date";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "string" && /^-?\d+(?:[.,]\d+)?$/.test(value.trim())) return "number";
  return "text";
}

/**
 * Agrège les types observés en un type DOMINANT. Une colonne est « date » ou
 * « number » seulement si TOUTES ses cellules remplies le sont (un seul
 * intrus → « text ») : c'est volontairement strict, car un champ canonique
 * date n'acceptera pas une colonne à moitié textuelle, autant le signaler.
 */
function dominantType(types: Set<Exclude<InferredType, "empty">>): InferredType {
  if (types.size === 0) return "empty";
  if (types.size === 1) return [...types][0]!;
  // Mélange date+number : des séries Excel coexistant avec des dates lisibles
  // restent « date » (le parseur les unifie). Tout autre mélange → text.
  if (types.size === 2 && types.has("date") && types.has("number")) return "date";
  return "text";
}

/**
 * Construit le profil de chaque colonne. Les colonnes examinées sont l'UNION
 * des clés de toutes les lignes : certains connecteurs omettent les cellules
 * vides, une colonne n'existe donc que si au moins une ligne la porte.
 */
export function analyzeColumns(
  rows: SourceRow[],
  sampleSize: number = DEFAULT_SAMPLE_SIZE,
): ColumnAnalysis {
  const columnNames: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.data)) {
      if (!seen.has(key)) {
        seen.add(key);
        columnNames.push(key);
      }
    }
  }

  const columns: ColumnProfile[] = columnNames.map((name) => {
    let filledCount = 0;
    const distinct = new Set<string>();
    const sample: string[] = [];
    const types = new Set<Exclude<InferredType, "empty">>();

    for (const row of rows) {
      const raw = row.data[name];
      const text = cellToText(raw);
      if (text === null) continue;
      filledCount += 1;
      types.add(cellType(raw));
      if (!distinct.has(text)) {
        distinct.add(text);
        if (sample.length < sampleSize) sample.push(text);
      }
    }

    return {
      name,
      inferredType: dominantType(types),
      filledCount,
      totalCount: rows.length,
      distinctCount: distinct.size,
      sampleValues: sample,
    };
  });

  return { rowCount: rows.length, columns };
}
