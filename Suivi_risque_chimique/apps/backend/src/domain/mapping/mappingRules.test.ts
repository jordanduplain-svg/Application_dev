import { describe, expect, it } from "vitest";

import { applyMappingRules, type MappingRule } from "./mappingRules.js";
import type { SourceRow } from "./types.js";

const rows = (...data: Record<string, unknown>[]): SourceRow[] =>
  data.map((d, i) => ({ rowNumber: i + 2, data: d }));

describe("applyMappingRules", () => {
  it("renvoie les lignes inchangées quand il n'y a aucune règle", () => {
    const input = rows({ Nom: " Martin " });
    expect(applyMappingRules(input, [])).toBe(input); // même référence : pas de copie inutile
  });

  it("trim nettoie les espaces de bord sans toucher aux autres colonnes", () => {
    const out = applyMappingRules(rows({ Nom: "  Martin  ", Code: "  A1 " }), [
      { kind: "trim", column: "Nom" },
    ]);
    expect(out[0]!.data).toEqual({ Nom: "Martin", Code: "  A1 " });
  });

  it("uppercase / lowercase normalisent la casse", () => {
    const out = applyMappingRules(rows({ Secteur: "Atelier-b" }), [
      { kind: "uppercase", column: "Secteur" },
    ]);
    expect(out[0]!.data.Secteur).toBe("ATELIER-B");

    const out2 = applyMappingRules(rows({ Secteur: "ATELIER-B" }), [
      { kind: "lowercase", column: "Secteur" },
    ]);
    expect(out2[0]!.data.Secteur).toBe("atelier-b");
  });

  it("defaultValue ne remplit QUE les cellules vides", () => {
    const out = applyMappingRules(
      rows({ Degre: "Fort" }, { Degre: "" }, { Degre: null }, { Degre: "   " }),
      [{ kind: "defaultValue", column: "Degre", value: "Non évalué" }],
    );
    expect(out.map((r) => r.data.Degre)).toEqual([
      "Fort",
      "Non évalué",
      "Non évalué",
      "Non évalué",
    ]);
  });

  it("filterRowWhen retire les lignes correspondantes (insensible à la casse)", () => {
    const out = applyMappingRules(
      rows(
        { Nom: "Martin", Statut: "ACTIF" },
        { Nom: "Durand", Statut: "Archive" },
        { Nom: "Petit", Statut: "archive" },
      ),
      [{ kind: "filterRowWhen", column: "Statut", equals: "ARCHIVE" }],
    );
    expect(out.map((r) => r.data.Nom)).toEqual(["Martin"]);
  });

  it("filterRowWhen préserve les numéros de ligne source des lignes conservées", () => {
    const out = applyMappingRules(
      rows(
        { Nom: "Martin", Statut: "ACTIF" }, // ligne 2
        { Nom: "Durand", Statut: "ARCHIVE" }, // ligne 3 (filtrée)
        { Nom: "Petit", Statut: "ACTIF" }, // ligne 4
      ),
      [{ kind: "filterRowWhen", column: "Statut", equals: "ARCHIVE" }],
    );
    expect(out.map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it("concat assemble plusieurs colonnes et ignore les valeurs vides", () => {
    const out = applyMappingRules(
      rows(
        { Nom: "Martin", Prenom: "Marie" },
        { Nom: "Durand", Prenom: "" },
      ),
      [{ kind: "concat", targetColumn: "Identite", columns: ["Nom", "Prenom"], separator: " " }],
    );
    expect(out[0]!.data.Identite).toBe("Martin Marie");
    expect(out[1]!.data.Identite).toBe("Durand"); // pas de séparateur orphelin
  });

  it("concat entièrement vide produit null, pas une chaîne vide", () => {
    const out = applyMappingRules(rows({ Nom: "", Prenom: null }), [
      { kind: "concat", targetColumn: "Identite", columns: ["Nom", "Prenom"], separator: " " },
    ]);
    expect(out[0]!.data.Identite).toBeNull();
  });

  it("applique les règles dans l'ordre (concat puis uppercase sur la colonne créée)", () => {
    const pipeline: MappingRule[] = [
      { kind: "concat", targetColumn: "Cle", columns: ["A", "B"], separator: "-" },
      { kind: "uppercase", column: "Cle" },
    ];
    const out = applyMappingRules(rows({ A: "ate", B: "b" }), pipeline);
    expect(out[0]!.data.Cle).toBe("ATE-B");
  });

  it("rename déplace la valeur vers la nouvelle colonne", () => {
    const out = applyMappingRules(rows({ "Nom de famille": "Martin" }), [
      { kind: "rename", column: "Nom de famille", to: "nom" },
    ]);
    expect(out[0]!.data).toEqual({ nom: "Martin" });
  });

  it("splitColumn scinde sur la première occurrence", () => {
    const out = applyMappingRules(rows({ Nom: "Martin, Marie" }), [
      { kind: "splitColumn", column: "Nom", separator: ", ", left: "nom", right: "prenom" },
    ]);
    expect(out[0]!.data.nom).toBe("Martin");
    expect(out[0]!.data.prenom).toBe("Marie");
  });

  it("replace remplace toutes les occurrences littérales", () => {
    const out = applyMappingRules(rows({ Code: "A.1.2" }), [
      { kind: "replace", column: "Code", search: ".", replaceWith: "-" },
    ]);
    expect(out[0]!.data.Code).toBe("A-1-2");
  });

  it("removeColumn supprime la colonne", () => {
    const out = applyMappingRules(rows({ Nom: "Martin", Interne: "x" }), [
      { kind: "removeColumn", column: "Interne" },
    ]);
    expect(out[0]!.data).toEqual({ Nom: "Martin" });
  });

  it("fillDown recopie la dernière valeur non vide vers le bas", () => {
    const out = applyMappingRules(
      rows({ Secteur: "ATELIER-A" }, { Secteur: "" }, { Secteur: null }, { Secteur: "ATELIER-B" }),
      [{ kind: "fillDown", column: "Secteur" }],
    );
    expect(out.map((r) => r.data.Secteur)).toEqual([
      "ATELIER-A",
      "ATELIER-A",
      "ATELIER-A",
      "ATELIER-B",
    ]);
  });

  it("dropEmptyRows retire les lignes entièrement vides", () => {
    const out = applyMappingRules(
      rows({ Nom: "Martin" }, { Nom: "", Prenom: "  " }, { Nom: "Durand" }),
      [{ kind: "dropEmptyRows" }],
    );
    expect(out.map((r) => r.data.Nom)).toEqual(["Martin", "Durand"]);
  });

  it("ne mute jamais la ligne d'entrée (pureté)", () => {
    const input = rows({ Nom: "  Martin  " });
    const snapshot = input[0]!.data.Nom;
    applyMappingRules(input, [{ kind: "trim", column: "Nom" }]);
    expect(input[0]!.data.Nom).toBe(snapshot); // l'original reste intact
  });
});
