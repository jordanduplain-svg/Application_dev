/**
 * Suggestion automatique de correspondance « colonne du fichier → champ
 * canonique », par rapprochement des libellés (insensible casse/accents/espaces).
 *
 * Pur confort de saisie : le serveur revalide toujours le mapping réel. On ne
 * propose qu'une correspondance par colonne (pas de réutilisation), et seulement
 * au-dessus d'un seuil de confiance — mieux vaut ne rien suggérer qu'imposer un
 * faux rapprochement sur des données de santé.
 */
export interface FieldDef {
  field: string;
  label: string;
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function suggestMapping(columns: string[], fields: FieldDef[]): Record<string, string> {
  const normCols = columns.map((c) => ({ raw: c, n: norm(c) }));
  const used = new Set<string>();
  const result: Record<string, string> = {};

  for (const f of fields) {
    const targets = [norm(f.label), norm(f.field.replace(/_/g, " "))].filter((s) => s !== "");
    let best: { raw: string; score: number } | null = null;

    for (const col of normCols) {
      if (used.has(col.raw)) continue;
      let score = 0;
      for (const tgt of targets) {
        if (col.n === tgt) score = Math.max(score, 100);
        else if (col.n.includes(tgt) || tgt.includes(col.n)) score = Math.max(score, 60);
        else {
          const ct = new Set(col.n.split(" "));
          const overlap = tgt.split(" ").filter((tok) => tok !== "" && ct.has(tok)).length;
          if (overlap > 0) score = Math.max(score, 30 + overlap);
        }
      }
      if (best === null || score > best.score) best = { raw: col.raw, score };
    }

    if (best !== null && best.score >= 30) {
      result[f.field] = best.raw;
      used.add(best.raw);
    }
  }
  return result;
}
