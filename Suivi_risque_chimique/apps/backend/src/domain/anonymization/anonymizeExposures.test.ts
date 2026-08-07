import { describe, expect, it } from "vitest";

import { anonymizeExposures } from "./anonymizeExposures.js";
import type { ExposureRecord } from "./types.js";

/** Données 100 % synthétiques. */

const rec = (over: Partial<ExposureRecord>): ExposureRecord => ({
  matricule: null,
  nom: "X",
  prenom: "Y",
  codeSecteur: "SECTEUR-A",
  designation: "Produit X",
  nCas: "00-00-0",
  classifSgh: "H300",
  mentionDanger: "Danger",
  degreExposition: "Modéré",
  ...over,
});

/** Génère n personnes distinctes exposées à un même produit/secteur. */
const cohort = (
  n: number,
  over: Partial<ExposureRecord> = {},
  degre: string | null = "Modéré",
): ExposureRecord[] =>
  Array.from({ length: n }, (_, i) =>
    rec({ matricule: `EMP-${i}`, degreExposition: degre, ...over }),
  );

describe("anonymizeExposures", () => {
  it("publie un groupe dont l'effectif atteint le seuil k", () => {
    const view = anonymizeExposures(cohort(5), { k: 5 });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.effectifExpose).toBe(5);
    expect(view.masque).toEqual({ groupes: 0, expositions: 0 });
  });

  it("masque un groupe sous le seuil — aucune ligne publiée", () => {
    const view = anonymizeExposures(cohort(4), { k: 5 });
    expect(view.groups).toHaveLength(0);
    expect(view.masque).toEqual({ groupes: 1, expositions: 4 });
  });

  it("SECTEUR À EFFECTIF UNIQUE : entièrement masqué (cas explicite du brief)", () => {
    // Un seul salarié, exposé à 2 produits → 2 couples, chacun effectif 1.
    const solo = [
      rec({ matricule: "EMP-SOLO", codeSecteur: "ATELIER-SOLO", designation: "Acétone" }),
      rec({ matricule: "EMP-SOLO", codeSecteur: "ATELIER-SOLO", designation: "Toluène" }),
    ];
    const view = anonymizeExposures(solo, { k: 5 });
    expect(view.groups).toHaveLength(0);
    expect(view.masque.groupes).toBe(2);
    // Aucune chaîne ne doit contenir le secteur ou le matricule.
    const dump = JSON.stringify(view);
    expect(dump).not.toContain("ATELIER-SOLO");
    expect(dump).not.toContain("EMP-SOLO");
  });

  it("un seul exposé à un produit dans un GRAND secteur → ce couple est masqué", () => {
    // 10 personnes sur Produit A (publié), 1 seule sur Produit B (masquée).
    const records = [
      ...cohort(10, { designation: "Produit A" }),
      rec({ matricule: "EMP-RARE", designation: "Produit B" }),
    ];
    const view = anonymizeExposures(records, { k: 5 });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.designation).toBe("Produit A");
    expect(view.masque).toEqual({ groupes: 1, expositions: 1 });
    expect(JSON.stringify(view)).not.toContain("Produit B");
  });

  it("k configurable : le même jeu publie ou masque selon k", () => {
    const records = cohort(4);
    expect(anonymizeExposures(records, { k: 3 }).groups).toHaveLength(1);
    expect(anonymizeExposures(records, { k: 5 }).groups).toHaveLength(0);
  });

  it("compte les personnes DISTINCTES, pas les lignes (multi-affectation)", () => {
    // 5 personnes, mais l'une apparaît deux fois (deux affectations au secteur).
    const records = [
      ...cohort(5),
      rec({ matricule: "EMP-0" }), // doublon de la première personne
    ];
    const view = anonymizeExposures(records, { k: 5 });
    expect(view.groups[0]!.effectifExpose).toBe(5); // pas 6
  });

  it("agrège la répartition des degrés, triée par effectif décroissant", () => {
    const records = [
      ...cohort(3, {}, "Faible"),
      ...cohort(5, {}, "Fort").map((r, i) => ({ ...r, matricule: `FORT-${i}` })),
      ...cohort(1, {}, "Modéré").map((r) => ({ ...r, matricule: "MOD-0" })),
    ];
    const view = anonymizeExposures(records, { k: 1 });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.degres).toEqual([
      { valeur: "Fort", effectif: 5 },
      { valeur: "Faible", effectif: 3 },
      { valeur: "Modéré", effectif: 1 },
    ]);
  });

  it("masque les sous-groupes de degré sous le seuil k (anti-fuite d'attribut)", () => {
    // Groupe de 6 (publié à k=5) : 4 « Modéré » + 2 sans degré → AUCUN
    // sous-groupe n'atteint 5, donc tout est replié dans effectifDegreMasque.
    const records = [
      ...cohort(4, {}, "Modéré").map((r, i) => ({ ...r, matricule: `D-${i}` })),
      ...cohort(2, {}, null).map((r, i) => ({ ...r, matricule: `N-${i}` })),
    ];
    const view = anonymizeExposures(records, { k: 5 });
    expect(view.groups[0]!.effectifExpose).toBe(6);
    expect(view.groups[0]!.degres).toEqual([]);
    expect(view.groups[0]!.effectifSansDegre).toBe(0);
    expect(view.groups[0]!.effectifDegreMasque).toBe(6);
  });

  it("dans un groupe publié, une modalité rare est masquée mais la majoritaire reste", () => {
    // 5 « Faible » (publiable) + 1 « Fort » (singleton → masqué).
    const records = [
      ...cohort(5, {}, "Faible").map((r, i) => ({ ...r, matricule: `F-${i}` })),
      rec({ matricule: "RARE-0", degreExposition: "Fort" }),
    ];
    const view = anonymizeExposures(records, { k: 5 });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.effectifExpose).toBe(6);
    expect(view.groups[0]!.degres).toEqual([{ valeur: "Faible", effectif: 5 }]);
    expect(view.groups[0]!.effectifDegreMasque).toBe(1);
    // La modalité rare n'apparaît nulle part dans la sortie.
    expect(JSON.stringify(view)).not.toContain("Fort");
  });

  it("JAMAIS de donnée nominative dans la sortie (nom, prénom, matricule)", () => {
    const records = cohort(8).map((r, i) => ({
      ...r,
      nom: `Secret${i}`,
      prenom: `Prive${i}`,
      matricule: `CONFIDENTIEL-${i}`,
    }));
    const dump = JSON.stringify(anonymizeExposures(records, { k: 5 }));
    expect(dump).not.toMatch(/Secret|Prive|CONFIDENTIEL/);
  });

  it("sortie déterministe : groupes triés par secteur puis produit", () => {
    const records = [
      ...cohort(5, { codeSecteur: "ZONE-Z", designation: "Bêta" }).map((r, i) => ({ ...r, matricule: `Z-${i}` })),
      ...cohort(5, { codeSecteur: "ZONE-A", designation: "Alpha" }).map((r, i) => ({ ...r, matricule: `A-${i}` })),
      ...cohort(5, { codeSecteur: "ZONE-A", designation: "Bêta" }).map((r, i) => ({ ...r, matricule: `AB-${i}` })),
    ];
    const view = anonymizeExposures(records, { k: 5 });
    expect(view.groups.map((g) => `${g.codeSecteur}/${g.designation}`)).toEqual([
      "ZONE-A/Alpha",
      "ZONE-A/Bêta",
      "ZONE-Z/Bêta",
    ]);
  });

  it("regroupe les variantes d'écriture du même secteur/produit (normalisation)", () => {
    const records = [
      ...cohort(3, { codeSecteur: "Atelier-A", designation: "Acétone Technique" }).map((r, i) => ({ ...r, matricule: `A-${i}` })),
      ...cohort(2, { codeSecteur: "ATELIER-A", designation: "  acétone   technique " }).map((r, i) => ({ ...r, matricule: `B-${i}` })),
    ];
    // 5 personnes au total sur le même couple après normalisation → publié.
    const view = anonymizeExposures(records, { k: 5 });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.effectifExpose).toBe(5);
  });
});
