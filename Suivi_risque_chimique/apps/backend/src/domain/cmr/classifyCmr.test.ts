import { describe, expect, it } from "vitest";

import { classifyCmr } from "./classifyCmr.js";

describe("classifyCmr", () => {
  it("détecte cancérogène (H350 / H350i)", () => {
    expect(classifyCmr("H225, H350").categories).toEqual(["cancérogène"]);
    expect(classifyCmr("H350i").isCmr).toBe(true);
  });

  it("détecte mutagène (H340) et reprotoxique (H360 et variantes)", () => {
    expect(classifyCmr("H340").categories).toEqual(["mutagène"]);
    expect(classifyCmr("H360FD").categories).toEqual(["reprotoxique"]);
    expect(classifyCmr("H360Df").isCmr).toBe(true);
  });

  it("combine les catégories en ordre C-M-R", () => {
    expect(classifyCmr("H360, H340, H350").categories).toEqual([
      "cancérogène",
      "mutagène",
      "reprotoxique",
    ]);
  });

  it("EXCLUT les catégories 2 (suspecté) : H351 / H341 / H361", () => {
    expect(classifyCmr("H351").isCmr).toBe(false);
    expect(classifyCmr("H341").isCmr).toBe(false);
    expect(classifyCmr("H361d").isCmr).toBe(false);
  });

  it("non-CMR et valeurs vides", () => {
    expect(classifyCmr("H225, H319, H336").isCmr).toBe(false);
    expect(classifyCmr(null, undefined, "").isCmr).toBe(false);
  });

  it("scanne plusieurs champs (classif + mention de danger)", () => {
    expect(classifyCmr("H225", "Peut provoquer le cancer H350").categories).toEqual([
      "cancérogène",
    ]);
  });

  it("ne se laisse pas piéger par des codes proches (H3501, H3600)", () => {
    expect(classifyCmr("H3501").isCmr).toBe(false);
    expect(classifyCmr("H3600").isCmr).toBe(false);
  });
});
