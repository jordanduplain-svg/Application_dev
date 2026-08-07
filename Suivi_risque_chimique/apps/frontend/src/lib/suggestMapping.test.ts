import { describe, expect, it } from "vitest";

import { suggestMapping } from "./suggestMapping";

const fields = [
  { field: "matricule", label: "Matricule" },
  { field: "nom", label: "Nom de famille" },
  { field: "prenom", label: "Prénom" },
  { field: "code_secteur", label: "Code secteur" },
  { field: "date_debut_secteur", label: "Entrée dans le secteur" },
];

describe("suggestMapping", () => {
  it("rapproche par libellé, insensible casse/accents", () => {
    const cols = ["MATRICULE", "Nom de famille", "PRENOM", "Code Atelier", "Entrée secteur"];
    const r = suggestMapping(cols, fields);
    expect(r.matricule).toBe("MATRICULE");
    expect(r.nom).toBe("Nom de famille");
    expect(r.prenom).toBe("PRENOM"); // « prenom » ~ « prénom »
    expect(r.code_secteur).toBe("Code Atelier"); // chevauchement « code »
    expect(r.date_debut_secteur).toBe("Entrée secteur");
  });

  it("n'assigne jamais deux fois la même colonne", () => {
    const r = suggestMapping(["Nom", "Nom complet"], fields);
    const used = Object.values(r);
    expect(new Set(used).size).toBe(used.length);
  });

  it("ne suggère rien sous le seuil de confiance", () => {
    const r = suggestMapping(["ColonneA", "Truc", "Zzz"], [{ field: "matricule", label: "Matricule" }]);
    expect(r.matricule).toBeUndefined();
  });
});
