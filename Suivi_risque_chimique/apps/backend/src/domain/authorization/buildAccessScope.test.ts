import { describe, expect, it } from "vitest";

import { buildAccessScope } from "./buildAccessScope.js";
import type { AuthenticatedUser, Role } from "./types.js";

/**
 * Spécification exécutable de la matrice ADR 0002. Si la matrice change, ces
 * tests changent EN PREMIER — ils sont le contrat de qui voit quoi.
 */

const user = (role: Role, over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: "u-test",
  role,
  tenantId: "default",
  matricule: null,
  managedSectors: [],
  ...over,
});

describe("buildAccessScope — matrice ADR 0002", () => {
  it("ADMIN : tout voir, colonnes complètes, anomalies visibles", () => {
    expect(buildAccessScope(user("ADMIN"))).toEqual({
      rows: { kind: "all" },
      columns: "full",
      seesJoinAnomalies: true,
    });
  });

  it("HSE : tout voir, colonnes complètes, anomalies visibles", () => {
    expect(buildAccessScope(user("HSE"))).toEqual({
      rows: { kind: "all" },
      columns: "full",
      seesJoinAnomalies: true,
    });
  });

  it("MEDECINE : nominatif complet (jamais anonymisé), sans anomalies de jointure", () => {
    expect(buildAccessScope(user("MEDECINE"))).toEqual({
      rows: { kind: "all" },
      columns: "full",
      seesJoinAnomalies: false,
    });
  });

  it("RH : toutes les lignes mais colonnes ADMINISTRATIVES (pas de chimie)", () => {
    expect(buildAccessScope(user("RH"))).toEqual({
      rows: { kind: "all" },
      columns: "administrative",
      seesJoinAnomalies: false,
    });
  });

  it("MANAGER : restreint à SES secteurs", () => {
    const scope = buildAccessScope(user("MANAGER", { managedSectors: ["ATELIER-A", "ATELIER-B"] }));
    expect(scope.rows).toEqual({ kind: "sectors", sectors: ["ATELIER-A", "ATELIER-B"] });
    expect(scope.columns).toBe("full");
  });

  it("MANAGER sans secteur rattaché : AUCUN accès (sécurité par défaut)", () => {
    const scope = buildAccessScope(user("MANAGER"));
    expect(scope.rows).toEqual({ kind: "none", reason: "manager_sans_secteur" });
  });

  it("COLLABORATEUR : restreint à SA fiche par matricule", () => {
    const scope = buildAccessScope(user("COLLABORATEUR", { matricule: "EMP-001" }));
    expect(scope.rows).toEqual({ kind: "self", matricule: "EMP-001" });
    expect(scope.columns).toBe("full"); // il voit le détail de SES expositions (R. 4412-93-2)
  });

  it("COLLABORATEUR sans matricule : AUCUN accès (jamais « tout par accident »)", () => {
    expect(buildAccessScope(user("COLLABORATEUR")).rows).toEqual({
      kind: "none",
      reason: "collaborateur_sans_matricule",
    });
    expect(buildAccessScope(user("COLLABORATEUR", { matricule: "  " })).rows.kind).toBe("none");
  });
});
