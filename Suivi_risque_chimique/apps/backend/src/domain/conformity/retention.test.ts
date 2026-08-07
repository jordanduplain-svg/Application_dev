import { describe, expect, it } from "vitest";

import { retentionCutoff } from "./retention.js";

describe("retentionCutoff", () => {
  it("retranche les années (40 ans par défaut)", () => {
    expect(retentionCutoff(new Date("2026-06-25T00:00:00Z"), 40)).toEqual(
      new Date("1986-06-25T00:00:00Z"),
    );
  });

  it("0 an = aucune marge (cutoff = maintenant)", () => {
    const now = new Date("2026-06-25T10:00:00Z");
    expect(retentionCutoff(now, 0)).toEqual(now);
  });
});
