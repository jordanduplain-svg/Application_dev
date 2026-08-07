import { describe, expect, it } from "vitest";

import { versionWhere } from "./PrismaListRepository.js";

describe("versionWhere", () => {
  it("sans asOf : version active hors soft-delete", () => {
    expect(versionWhere()).toEqual({ validTo: null, operation: { not: "DELETE" } });
  });

  it("avec asOf : intervalle [validFrom, validTo[ contenant la date", () => {
    const at = new Date("2022-06-01T00:00:00Z");
    expect(versionWhere(at)).toEqual({
      operation: { not: "DELETE" },
      validFrom: { lte: at },
      OR: [{ validTo: null }, { validTo: { gt: at } }],
    });
  });
});
