import { describe, expect, it } from "vitest";

import { normalizeText } from "./normalizeText.js";
import { parseFlexibleDate } from "./parseFlexibleDate.js";

describe("normalizeText", () => {
  it("trim + casse + accents + espaces multiples", () => {
    expect(normalizeText("  Acétone   Technique ")).toBe("acetone technique");
    expect(normalizeText("TOLUÈNE")).toBe("toluene");
    expect(normalizeText("éthanol\t96%")).toBe("ethanol 96%");
  });

  it("deux écritures différentes du même produit convergent", () => {
    expect(normalizeText("Acide Sulfurique")).toBe(normalizeText("  ACIDE  SULFURIQUE "));
  });

  it("mais deux produits distincts ne convergent PAS (pas de fuzzy)", () => {
    expect(normalizeText("Acétone")).not.toBe(normalizeText("Acétone Technique"));
  });
});

describe("parseFlexibleDate", () => {
  const expectDate = (value: unknown, iso: string): void => {
    const r = parseFlexibleDate(value);
    expect(r.ok, `parse de ${JSON.stringify(value)}`).toBe(true);
    if (r.ok) expect(r.date.toISOString()).toBe(`${iso}T00:00:00.000Z`);
  };

  describe("format ISO", () => {
    it("date simple", () => expectDate("2024-01-15", "2024-01-15"));
    it("avec heure (tronquée au jour)", () => expectDate("2024-01-15T14:30:00", "2024-01-15"));
    it("date invalide recalée par JS → refusée (31 février)", () => {
      expect(parseFlexibleDate("2024-02-31")).toEqual({ ok: false, reason: "unparseable" });
    });
  });

  describe("format français JJ/MM/AAAA", () => {
    it("date simple", () => expectDate("15/01/2024", "2024-01-15"));
    it("jour et mois à un chiffre", () => expectDate("5/3/2021", "2021-03-05"));
    it("13/05 n'est PAS interprété en US (13 = jour)", () => expectDate("13/05/2022", "2022-05-13"));
    it("mois impossible → refusé (pas de bascule US silencieuse)", () => {
      // 05/13/2022 serait valide en US. On refuse : format FR strict.
      expect(parseFlexibleDate("05/13/2022")).toEqual({ ok: false, reason: "unparseable" });
    });
  });

  describe("série Excel", () => {
    // 45292 = 2024-01-01 dans la convention 1900 d'Excel.
    it("nombre dans la fenêtre", () => expectDate(45292, "2024-01-01"));
    it("chaîne numérique (export texte)", () => expectDate("45292", "2024-01-01"));
    it("année nue 2024 → anomalie, PAS le 16/07/1905", () => {
      expect(parseFlexibleDate(2024)).toEqual({ ok: false, reason: "out_of_range" });
      expect(parseFlexibleDate("2024")).toEqual({ ok: false, reason: "out_of_range" });
    });
    it("série hors fenêtre haute → anomalie", () => {
      expect(parseFlexibleDate(99999)).toEqual({ ok: false, reason: "out_of_range" });
    });
  });

  describe("objets Date (cellules typées)", () => {
    it("Date valide projetée à minuit UTC", () => {
      expectDate(new Date(Date.UTC(2023, 5, 15, 9, 30)), "2023-06-15");
    });
    it("Date invalide → refusée", () => {
      expect(parseFlexibleDate(new Date("n'importe quoi"))).toEqual({
        ok: false,
        reason: "unparseable",
      });
    });
  });

  describe("vides et déchets", () => {
    it("null / undefined / chaîne vide → empty (géré par le mapper)", () => {
      expect(parseFlexibleDate(null)).toEqual({ ok: false, reason: "empty" });
      expect(parseFlexibleDate(undefined)).toEqual({ ok: false, reason: "empty" });
      expect(parseFlexibleDate("   ")).toEqual({ ok: false, reason: "empty" });
    });
    it("texte libre → unparseable", () => {
      expect(parseFlexibleDate("en poste")).toEqual({ ok: false, reason: "unparseable" });
    });
    it("booléen → unparseable", () => {
      expect(parseFlexibleDate(true)).toEqual({ ok: false, reason: "unparseable" });
    });
  });
});
