import { normalizeText } from "../mapping/normalizeText.js";
import type {
  AnonymizationOptions,
  AnonymizedGroup,
  AnonymizedView,
  ExposureRecord,
} from "./types.js";

/**
 * Produit la vue anonymisée d'un ensemble d'expositions (brief §9 ; CSE et
 * autres travailleurs, art. R. 4412-93-2).
 *
 * Modèle de k-anonymat retenu (détaillé dans docs/adr/0005-k-anonymat.md) :
 *  - l'unité d'agrégation est le couple (secteur, produit) ;
 *  - on compte les personnes DISTINCTES de chaque couple ;
 *  - un couple dont l'effectif est < k est MASQUÉ (ni produit, ni degré, ni
 *    secteur ne sont publiés pour lui).
 *
 * Pourquoi le seuil au niveau (secteur, produit) couvre le cas « secteur à
 * effectif unique » du brief : un secteur d'une seule personne a, pour chacun
 * de ses produits, un effectif de 1 — donc < k — donc tous ses couples sont
 * masqués. Aucune ligne ne le trahit. Le seuil au niveau du couple est le
 * plus protecteur : il neutralise aussi le cas « un seul exposé à tel produit
 * dans un grand secteur ».
 *
 * Le décompte des masqués est remonté de façon AGRÉGÉE et GLOBALE (sans nom de
 * secteur ni de produit) : dire « le secteur X a été masqué » révélerait que X
 * a un effectif réduit — exactement ce qu'on protège.
 *
 * Anti-fuite d'attribut : même dans un couple publié (effectif ≥ k), la
 * répartition des degrés n'expose une modalité que si SON effectif atteint k.
 * Sinon publier « Fort : 1 » dans un groupe de 6 désignerait une personne. Les
 * modalités fines sont repliées dans `effectifDegreMasque` (combien, jamais
 * laquelle).
 *
 * Fonction PURE : pas d'horloge, pas d'I/O. Le `k` est injecté (config).
 */
export function anonymizeExposures(
  records: ExposureRecord[],
  options: AnonymizationOptions,
): AnonymizedView {
  const k = Math.max(1, Math.floor(options.k));

  // Clé de personne pour le décompte de distincts : matricule prioritaire
  // (stable), repli nom+prénom normalisés — même logique que la jointure.
  const personKey = (r: ExposureRecord): string =>
    r.matricule !== null && r.matricule.trim() !== ""
      ? `m:${normalizeText(r.matricule)}`
      : `np:${normalizeText(r.nom)}|${normalizeText(r.prenom)}`;

  // Regroupement par (secteur, produit) normalisés.
  interface Bucket {
    codeSecteur: string; // casse d'affichage (première vue)
    designation: string;
    nCas: string | null;
    classifSgh: string | null;
    mentionDanger: string | null;
    persons: Set<string>;
    /** degré normalisé -> { valeur d'affichage, personnes distinctes } */
    degrees: Map<string, { valeur: string; persons: Set<string> }>;
    personsSansDegre: Set<string>;
  }

  const buckets = new Map<string, Bucket>();

  for (const r of records) {
    const groupKey = `${normalizeText(r.codeSecteur)}|${normalizeText(r.designation)}`;
    let bucket = buckets.get(groupKey);
    if (bucket === undefined) {
      bucket = {
        codeSecteur: r.codeSecteur,
        designation: r.designation,
        nCas: r.nCas,
        classifSgh: r.classifSgh,
        mentionDanger: r.mentionDanger,
        persons: new Set(),
        degrees: new Map(),
        personsSansDegre: new Set(),
      };
      buckets.set(groupKey, bucket);
    }

    const pk = personKey(r);
    bucket.persons.add(pk);

    if (r.degreExposition === null || r.degreExposition.trim() === "") {
      bucket.personsSansDegre.add(pk);
    } else {
      const dKey = normalizeText(r.degreExposition);
      let d = bucket.degrees.get(dKey);
      if (d === undefined) {
        d = { valeur: r.degreExposition.trim(), persons: new Set() };
        bucket.degrees.set(dKey, d);
      }
      d.persons.add(pk);
    }
  }

  // Partition selon le seuil k.
  const groups: AnonymizedGroup[] = [];
  let masqueGroupes = 0;
  let masqueExpositions = 0;

  for (const bucket of buckets.values()) {
    const effectif = bucket.persons.size;
    if (effectif < k) {
      masqueGroupes += 1;
      masqueExpositions += effectif;
      continue;
    }

    // Sous-groupes de degré : une modalité n'est détaillée que si son effectif
    // atteint lui aussi k. Les modalités trop fines (et le sans-degré sous le
    // seuil) sont repliées dans `effectifDegreMasque` — on dit COMBIEN, jamais
    // LAQUELLE — pour ne pas ré-identifier par l'attribut de santé.
    const degres: { valeur: string; effectif: number }[] = [];
    let effectifDegreMasque = 0;
    for (const d of bucket.degrees.values()) {
      if (d.persons.size >= k) degres.push({ valeur: d.valeur, effectif: d.persons.size });
      else effectifDegreMasque += d.persons.size;
    }
    // tri stable : effectif décroissant, puis libellé pour le déterminisme.
    degres.sort((a, b) => b.effectif - a.effectif || a.valeur.localeCompare(b.valeur, "fr"));

    const sansDegre = bucket.personsSansDegre.size;
    const effectifSansDegre = sansDegre >= k ? sansDegre : 0;
    if (sansDegre > 0 && sansDegre < k) effectifDegreMasque += sansDegre;

    groups.push({
      codeSecteur: bucket.codeSecteur,
      designation: bucket.designation,
      nCas: bucket.nCas,
      classifSgh: bucket.classifSgh,
      mentionDanger: bucket.mentionDanger,
      effectifExpose: effectif,
      degres,
      effectifSansDegre,
      effectifDegreMasque,
    });
  }

  // Tri déterministe des groupes publiés (secteur puis produit).
  groups.sort(
    (a, b) =>
      a.codeSecteur.localeCompare(b.codeSecteur, "fr") ||
      a.designation.localeCompare(b.designation, "fr"),
  );

  return {
    k,
    groups,
    masque: { groupes: masqueGroupes, expositions: masqueExpositions },
  };
}
