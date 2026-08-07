import { describe, expect, it } from "vitest";

import type { Clock } from "../../ports/Clock.js";
import { calculateExposureDuration } from "./calculateExposureDuration.js";

/**
 * Tests du calcul de durée d'exposition.
 *
 * Cette suite sert de SPÉCIFICATION EXÉCUTABLE de la règle métier. Si la
 * réglementation ou la pratique change, on commence par modifier les tests
 * (la spec) avant le code — la suite doit rester en cohérence avec ce que la
 * loi et le brief décrivent.
 *
 * Stratégie :
 *  - Clock figé via FakeClock pour rendre les calculs déterministes.
 *  - Vérifications à la milliseconde sur les durées, pour catcher les
 *    arrondis silencieux.
 *  - Cas limites explicites (incohérences, dates égales, année bissextile).
 */

class FakeClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return this.fixed;
  }
}

const utc = (iso: string): Date => new Date(iso);

/** Tolérance d'arrondi : 1 milliseconde sur des durées en années. */
const YEAR_EPSILON = 1 / (365.25 * 24 * 60 * 60 * 1000);

describe("calculateExposureDuration", () => {
  describe("cas standards (sans anomalie)", () => {
    it("personne en poste, produit utilisé : durée = aujourd'hui - début", () => {
      const clock = new FakeClock(utc("2026-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2021-01-01T00:00:00Z"),
          sectorEndDate: null,
          productWithdrawalDate: null,
        },
        clock,
      );
      // 5 années calendaires exactes 2021-01-01 → 2026-01-01 = 1826 jours
      // (1×365 + 1×365 + 1×365 + 1×366 + 1×365), divisé par 365.25 ≈ 4.99932...
      // On vérifie un encadrement plutôt qu'une valeur exacte au pixel.
      expect(result.years).toBeGreaterThan(4.99);
      expect(result.years).toBeLessThan(5.01);
      expect(result.anomalies).toEqual([]);
    });

    it("date_fin_secteur seule fournie : on utilise cette date", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: utc("2023-01-01T00:00:00Z"),
          productWithdrawalDate: null,
        },
        clock,
      );
      // 3 années (1×366 + 2×365) / 365.25 ≈ 2.99932
      expect(result.years).toBeCloseTo(1096 / 365.25, 6);
      expect(result.anomalies).toEqual([]);
    });

    it("date_retrait seule fournie : on utilise cette date", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: null,
          productWithdrawalDate: utc("2022-01-01T00:00:00Z"),
        },
        clock,
      );
      // 2 années 2020→2022, dont 2020 bissextile : 366 + 365 = 731 j
      expect(result.years).toBeCloseTo(731 / 365.25, 6);
      expect(result.anomalies).toEqual([]);
    });

    it("les deux dates de fin fournies : on retient la PREMIÈRE (départ secteur plus tôt)", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: utc("2022-06-01T00:00:00Z"), // plus tôt
          productWithdrawalDate: utc("2024-01-01T00:00:00Z"),
        },
        clock,
      );
      // L'exposition cesse au départ du secteur, pas au retrait.
      // 2020-01-01 → 2022-06-01 = 366 + 365 + 151 = 882 jours
      expect(result.years).toBeCloseTo(882 / 365.25, 6);
      expect(result.anomalies).toEqual([]);
    });

    it("les deux dates de fin fournies : on retient la PREMIÈRE (retrait plus tôt)", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: utc("2025-01-01T00:00:00Z"),
          productWithdrawalDate: utc("2021-07-01T00:00:00Z"), // plus tôt
        },
        clock,
      );
      // L'exposition à CE produit cesse au retrait, même si la personne reste.
      // 2020-01-01 → 2021-07-01 = 366 + 181 = 547 jours
      expect(result.years).toBeCloseTo(547 / 365.25, 6);
      expect(result.anomalies).toEqual([]);
    });

    it("dates de fin et de retrait identiques : durée bien calculée à partir de ce point", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const sameEnd = utc("2024-06-15T00:00:00Z");
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: sameEnd,
          productWithdrawalDate: sameEnd,
        },
        clock,
      );
      const expectedDays =
        (sameEnd.getTime() - utc("2020-01-01T00:00:00Z").getTime()) /
        (24 * 60 * 60 * 1000);
      expect(result.years).toBeCloseTo(expectedDays / 365.25, 6);
      expect(result.anomalies).toEqual([]);
    });
  });

  describe("précision numérique", () => {
    it("une année NON bissextile exacte = 365/365.25 ≈ 0.99931...", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2021-01-01T00:00:00Z"),
          sectorEndDate: utc("2022-01-01T00:00:00Z"),
          productWithdrawalDate: null,
        },
        clock,
      );
      expect(result.years).toBeCloseTo(365 / 365.25, 8);
    });

    it("une année bissextile exacte = 366/365.25 ≈ 1.00205...", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: utc("2021-01-01T00:00:00Z"),
          productWithdrawalDate: null,
        },
        clock,
      );
      expect(result.years).toBeCloseTo(366 / 365.25, 8);
    });

    it("durée nulle (date de fin égale à date de début)", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const sameDay = utc("2024-03-15T08:30:00Z");
      const result = calculateExposureDuration(
        {
          sectorStartDate: sameDay,
          sectorEndDate: sameDay,
          productWithdrawalDate: null,
        },
        clock,
      );
      expect(result.years).toBeLessThan(YEAR_EPSILON);
      expect(result.anomalies).toEqual([]);
    });
  });

  describe("anomalies (données incohérentes)", () => {
    it("date_fin_secteur < date_debut_secteur → durée 0 + anomalie 'sector_end_before_start'", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: utc("2019-06-01T00:00:00Z"),
          productWithdrawalDate: null,
        },
        clock,
      );
      expect(result.years).toBe(0);
      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0]?.code).toBe("sector_end_before_start");
    });

    it("date_retrait < date_debut_secteur → durée 0 + anomalie 'product_withdrawal_before_sector_start'", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: null,
          productWithdrawalDate: utc("2019-12-31T23:59:59Z"),
        },
        clock,
      );
      expect(result.years).toBe(0);
      expect(result.anomalies).toHaveLength(1);
      expect(result.anomalies[0]?.code).toBe("product_withdrawal_before_sector_start");
    });

    it("les DEUX anomalies à la fois → durée 0 + deux codes distincts", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: utc("2018-01-01T00:00:00Z"),
          productWithdrawalDate: utc("2019-01-01T00:00:00Z"),
        },
        clock,
      );
      expect(result.years).toBe(0);
      const codes = result.anomalies.map((a) => a.code).sort();
      expect(codes).toEqual([
        "product_withdrawal_before_sector_start",
        "sector_end_before_start",
      ]);
    });

    it("anomalie présente → durée FORCÉE à 0 même si l'autre date de fin serait valide", () => {
      // Garantie de non-masquage : si UNE incohérence est présente, on bloque
      // tout calcul, on ne se rabat pas sur l'autre date.
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const result = calculateExposureDuration(
        {
          sectorStartDate: utc("2020-01-01T00:00:00Z"),
          sectorEndDate: utc("2025-01-01T00:00:00Z"), // valide
          productWithdrawalDate: utc("2018-01-01T00:00:00Z"), // incohérent
        },
        clock,
      );
      expect(result.years).toBe(0);
      expect(result.anomalies.map((a) => a.code)).toContain(
        "product_withdrawal_before_sector_start",
      );
    });
  });

  describe("injection du Clock (pureté & déterminisme)", () => {
    it("utilise EXCLUSIVEMENT le Clock injecté pour 'aujourd'hui'", () => {
      // FakeClock figé dans le passé : le résultat doit refléter ce passé,
      // pas l'horloge système. C'est la garantie que le code n'appelle pas
      // `new Date()` direct quelque part.
      const fixedNow = utc("2022-06-15T12:00:00Z");
      const clock = new FakeClock(fixedNow);
      const start = utc("2020-06-15T12:00:00Z");
      const result = calculateExposureDuration(
        {
          sectorStartDate: start,
          sectorEndDate: null,
          productWithdrawalDate: null,
        },
        clock,
      );
      const expectedDays =
        (fixedNow.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
      expect(result.years).toBeCloseTo(expectedDays / 365.25, 6);
    });

    it("deux appels avec le même Clock figé donnent strictement le même résultat", () => {
      const clock = new FakeClock(utc("2026-01-01T00:00:00Z"));
      const ctx = {
        sectorStartDate: utc("2020-01-01T00:00:00Z"),
        sectorEndDate: null,
        productWithdrawalDate: null,
      } as const;
      const a = calculateExposureDuration(ctx, clock);
      const b = calculateExposureDuration(ctx, clock);
      expect(a.years).toBe(b.years);
      expect(a.anomalies).toEqual(b.anomalies);
    });
  });

  describe("immutabilité (pas d'effet de bord sur l'entrée)", () => {
    it("ne modifie pas les Date passées en entrée", () => {
      const clock = new FakeClock(utc("2030-01-01T00:00:00Z"));
      const start = utc("2020-01-01T00:00:00Z");
      const end = utc("2023-01-01T00:00:00Z");
      const startBefore = start.getTime();
      const endBefore = end.getTime();
      calculateExposureDuration(
        {
          sectorStartDate: start,
          sectorEndDate: end,
          productWithdrawalDate: null,
        },
        clock,
      );
      expect(start.getTime()).toBe(startBefore);
      expect(end.getTime()).toBe(endBefore);
    });
  });
});
