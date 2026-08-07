import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CsvDataSource } from "./CsvDataSource.js";

describe("CsvDataSource", () => {
  let dir = "";
  const file = (): string => path.join(dir, "t.csv");

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "csv-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("détecte le séparateur ; et garde les dates ISO en texte brut (pas de décalage TZ)", async () => {
    await writeFile(file(), "Nom;Entree\nMartin;2020-03-01\n", "utf8");
    const rows = await new CsvDataSource().fetchTable({ location: file() });
    expect(rows[0]!.data).toEqual({ Nom: "Martin", Entree: "2020-03-01" });
  });

  it("repli sur la virgule quand c'est le séparateur dominant", async () => {
    await writeFile(file(), "Nom,Entree\nDurand,15/01/2024\n", "utf8");
    const rows = await new CsvDataSource().fetchTable({ location: file() });
    expect(rows[0]!.data).toEqual({ Nom: "Durand", Entree: "15/01/2024" });
  });
});
