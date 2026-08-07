import { describe, expect, it } from "vitest";

import { quoteQualifiedName } from "./PostgresDataSource.js";

describe("quoteQualifiedName", () => {
  it("cite une table simple", () => {
    expect(quoteQualifiedName("personnel")).toBe('"personnel"');
  });

  it("cite schema.table", () => {
    expect(quoteQualifiedName("public.personnel_history")).toBe('"public"."personnel_history"');
  });

  it("rejette les tentatives d'injection / identifiants invalides", () => {
    for (const bad of [
      "personnel; DROP TABLE users",
      "a.b.c",
      "table-1",
      "1table",
      "",
      "users WHERE 1=1",
    ]) {
      expect(() => quoteQualifiedName(bad)).toThrow();
    }
  });
});
