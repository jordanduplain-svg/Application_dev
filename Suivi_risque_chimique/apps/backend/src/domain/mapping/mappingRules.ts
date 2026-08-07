import type { RawRow, SourceRow } from "./types.js";

/**
 * Règles de transformation simples appliquées aux lignes brutes AVANT le
 * mapping vers les champs canoniques.
 *
 * Principe directeur (décision de cadrage) : ENSEMBLE FERMÉ de règles
 * déclaratives. Pas de formules ni d'expressions libres — cela ouvrirait une
 * surface d'injection et ferait dériver l'outil vers un ETL généraliste, hors
 * du périmètre CMR. Chaque règle est un petit verbe prévisible, que l'on peut
 * présenter dans l'UI sous forme de menu et stocker tel quel en base (JSON
 * validé Zod).
 *
 * Les règles travaillent sur les COLONNES SOURCES (ce que l'analyste voit dans
 * l'aperçu), pas sur les champs canoniques : c'est son modèle mental. Le
 * mapping colonne → champ vient APRÈS, une fois la donnée nettoyée.
 *
 * Ordre d'application = ordre du tableau. Une règle `concat` peut ainsi créer
 * une colonne qu'une règle suivante nettoie, ou qu'on mappe à une clé naturelle
 * (ex. reconstituer un identifiant nom+prénom).
 */

export type MappingRule =
  | { kind: "trim"; column: string }
  | { kind: "uppercase"; column: string }
  | { kind: "lowercase"; column: string }
  /** Valeur de repli quand la cellule est vide (null / chaîne blanche). */
  | { kind: "defaultValue"; column: string; value: string }
  /**
   * Retire la ligne entière quand la colonne vaut exactement `equals`
   * (comparaison insensible à la casse et aux espaces de bord). Sert à écarter
   * des lignes parasites du fichier source (totaux, statuts « ARCHIVE »…).
   */
  | { kind: "filterRowWhen"; column: string; equals: string }
  /**
   * Crée (ou écrase) une colonne en concaténant d'autres colonnes avec un
   * séparateur. Les valeurs vides sont ignorées dans la jointure pour ne pas
   * produire de séparateurs orphelins.
   */
  | { kind: "concat"; targetColumn: string; columns: string[]; separator: string }
  /** Renomme une colonne (déplace la valeur de `column` vers `to`). */
  | { kind: "rename"; column: string; to: string }
  /**
   * Scinde une colonne sur la PREMIÈRE occurrence du séparateur : la partie
   * gauche va dans `left`, la droite dans `right` (l'un des deux peut être vide
   * pour ne garder qu'une moitié).
   */
  | { kind: "splitColumn"; column: string; separator: string; left: string; right: string }
  /** Remplace toutes les occurrences LITTÉRALES de `search` (pas de regex). */
  | { kind: "replace"; column: string; search: string; replaceWith: string }
  /** Supprime une colonne. */
  | { kind: "removeColumn"; column: string }
  /** Recopie vers le bas la dernière valeur non vide d'une colonne (fill down). */
  | { kind: "fillDown"; column: string }
  /** Supprime les lignes entièrement vides. */
  | { kind: "dropEmptyRows" };

/** Liste exhaustive des verbes acceptés — pour validation et UI. */
export const MAPPING_RULE_KINDS = [
  "trim",
  "uppercase",
  "lowercase",
  "defaultValue",
  "filterRowWhen",
  "concat",
  "rename",
  "splitColumn",
  "replace",
  "removeColumn",
  "fillDown",
  "dropEmptyRows",
] as const;

export type MappingRuleKind = (typeof MAPPING_RULE_KINDS)[number];

/** Représentation texte d'une valeur de cellule, ou null si vide. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** Une cellule est « vide » si elle n'a pas de contenu signifiant. */
function isEmpty(value: unknown): boolean {
  return asText(value) === null;
}

/**
 * Applique une règle à une ligne brute. Renvoie la ligne transformée et un
 * drapeau `dropped` (true → la ligne doit disparaître du lot).
 *
 * Fonction PURE : ne mute jamais la ligne d'entrée (copie défensive), pour que
 * l'aperçu et l'import partagent exactement le même comportement sans effet de
 * bord surprise.
 */
function applyRule(row: RawRow, rule: MappingRule): { row: RawRow; dropped: boolean } {
  const next: RawRow = { ...row };

  switch (rule.kind) {
    case "trim": {
      const v = next[rule.column];
      if (typeof v === "string") next[rule.column] = v.trim();
      return { row: next, dropped: false };
    }
    case "uppercase": {
      const v = next[rule.column];
      if (typeof v === "string") next[rule.column] = v.toUpperCase();
      return { row: next, dropped: false };
    }
    case "lowercase": {
      const v = next[rule.column];
      if (typeof v === "string") next[rule.column] = v.toLowerCase();
      return { row: next, dropped: false };
    }
    case "defaultValue": {
      if (isEmpty(next[rule.column])) next[rule.column] = rule.value;
      return { row: next, dropped: false };
    }
    case "filterRowWhen": {
      const current = asText(next[rule.column]);
      const target = rule.equals.trim();
      const dropped =
        current !== null && current.toLowerCase() === target.toLowerCase();
      return { row: next, dropped };
    }
    case "concat": {
      const joined = rule.columns
        .map((c) => asText(next[c]))
        .filter((v): v is string => v !== null)
        .join(rule.separator);
      // Une concaténation entièrement vide donne null (cellule absente), pas une
      // chaîne vide : le mapper distingue les deux.
      next[rule.targetColumn] = joined === "" ? null : joined;
      return { row: next, dropped: false };
    }
    case "rename": {
      if (rule.to.trim() !== "" && rule.to !== rule.column) {
        next[rule.to] = next[rule.column];
        delete next[rule.column];
      }
      return { row: next, dropped: false };
    }
    case "splitColumn": {
      const v = asText(next[rule.column]);
      if (v !== null && rule.separator !== "") {
        const idx = v.indexOf(rule.separator);
        const left = idx >= 0 ? v.slice(0, idx).trim() : v;
        const right = idx >= 0 ? v.slice(idx + rule.separator.length).trim() : "";
        if (rule.left !== "") next[rule.left] = left;
        if (rule.right !== "") next[rule.right] = right === "" ? null : right;
      }
      return { row: next, dropped: false };
    }
    case "replace": {
      const v = next[rule.column];
      if (typeof v === "string" && rule.search !== "") {
        next[rule.column] = v.split(rule.search).join(rule.replaceWith);
      }
      return { row: next, dropped: false };
    }
    case "removeColumn": {
      delete next[rule.column];
      return { row: next, dropped: false };
    }
    case "dropEmptyRows": {
      const allEmpty = Object.values(next).every((cell) => isEmpty(cell));
      return { row: next, dropped: allEmpty };
    }
    case "fillDown": {
      // Stateful (dépend de la ligne précédente) : traité au niveau du lot,
      // jamais ligne par ligne. Ne devrait pas arriver ici.
      return { row: next, dropped: false };
    }
  }
}

/**
 * Applique la séquence de règles à un lot de lignes. Les lignes filtrées sont
 * retirées du résultat ; les numéros de ligne SOURCE sont préservés (on ne
 * renumérote pas), pour que les anomalies pointent toujours la bonne ligne du
 * fichier de l'utilisateur.
 */
export function applyMappingRules(rows: SourceRow[], rules: MappingRule[]): SourceRow[] {
  if (rules.length === 0) return rows;
  // Application RÈGLE PAR RÈGLE sur tout le lot (modèle « étapes » type
  // PowerQuery) : pour les règles par-ligne le résultat est identique à une
  // application ligne par ligne, et les règles à ÉTAT (fillDown) deviennent
  // exprimables — elles ont besoin de la ligne précédente.
  let current = rows;
  for (const rule of rules) current = applyRuleToBatch(current, rule);
  return current;
}

function applyRuleToBatch(rows: SourceRow[], rule: MappingRule): SourceRow[] {
  if (rule.kind === "fillDown") {
    let last: unknown = null;
    return rows.map((source) => {
      const data: RawRow = { ...source.data };
      if (isEmpty(data[rule.column])) {
        if (last !== null) data[rule.column] = last;
      } else {
        last = data[rule.column];
      }
      return { rowNumber: source.rowNumber, data };
    });
  }

  const out: SourceRow[] = [];
  for (const source of rows) {
    const { row, dropped } = applyRule(source.data, rule);
    if (!dropped) out.push({ rowNumber: source.rowNumber, data: row });
  }
  return out;
}
