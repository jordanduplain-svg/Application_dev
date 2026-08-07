import type { DashboardRow } from "../dashboard/types.js";
import { normalizeText } from "../mapping/normalizeText.js";

/**
 * Agrégations analytiques (lecture seule) à partir des lignes du tableau de
 * bord — la « vue data analyst ». Tout est NON nominatif : on ne renvoie que
 * des comptes. Les classements sont bornés (top N) avec un drapeau de
 * troncature explicite (pas de masquage silencieux).
 *
 * Fonction PURE.
 */
export interface NamedCount {
  name: string;
  count: number;
}

export interface Analytics {
  totals: { workers: number; products: number; exposures: number };
  cmr: { products: number; workers: number };
  bySector: NamedCount[];
  byProduct: NamedCount[];
  byDegree: NamedCount[];
  truncated: { bySector: boolean; byProduct: boolean };
}

const TOP = 10;

const personKey = (r: DashboardRow): string =>
  r.matricule !== null && r.matricule.trim() !== ""
    ? `m:${normalizeText(r.matricule)}`
    : `np:${normalizeText(r.nom)}|${normalizeText(r.prenom)}`;

/** Ajoute une personne distincte à un seau nommé (clé d'affichage conservée). */
function addDistinct(map: Map<string, { name: string; persons: Set<string> }>, key: string, name: string, person: string): void {
  let bucket = map.get(key);
  if (bucket === undefined) {
    bucket = { name, persons: new Set() };
    map.set(key, bucket);
  }
  bucket.persons.add(person);
}

function topCounts(
  map: Map<string, { name: string; persons: Set<string> }>,
): { items: NamedCount[]; truncated: boolean } {
  const all = [...map.values()]
    .map((b) => ({ name: b.name, count: b.persons.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"));
  return { items: all.slice(0, TOP), truncated: all.length > TOP };
}

export function buildAnalytics(rows: DashboardRow[]): Analytics {
  const workers = new Set<string>();
  const products = new Set<string>();
  const cmrProducts = new Set<string>();
  const cmrWorkers = new Set<string>();
  const bySector = new Map<string, { name: string; persons: Set<string> }>();
  const byProduct = new Map<string, { name: string; persons: Set<string> }>();
  const byDegree = new Map<string, number>();

  for (const r of rows) {
    const pk = personKey(r);
    workers.add(pk);
    products.add(normalizeText(r.designation));

    addDistinct(bySector, normalizeText(r.codeSecteur), r.codeSecteur, pk);
    addDistinct(byProduct, normalizeText(r.designation), r.designation, pk);

    const degree = r.degreExposition === null || r.degreExposition.trim() === "" ? "Non renseigné" : r.degreExposition.trim();
    byDegree.set(degree, (byDegree.get(degree) ?? 0) + 1);

    if (r.isCmr) {
      cmrProducts.add(normalizeText(r.designation));
      cmrWorkers.add(pk);
    }
  }

  const sector = topCounts(bySector);
  const product = topCounts(byProduct);

  return {
    totals: { workers: workers.size, products: products.size, exposures: rows.length },
    cmr: { products: cmrProducts.size, workers: cmrWorkers.size },
    bySector: sector.items,
    byProduct: product.items,
    byDegree: [...byDegree.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr")),
    truncated: { bySector: sector.truncated, byProduct: product.truncated },
  };
}
