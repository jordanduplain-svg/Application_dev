import pg from "pg";

import type { SourceRow } from "../../../domain/mapping/types.js";
import type { DataSource, TableConfig } from "../../../ports/DataSource.js";

/**
 * Connecteur PostgreSQL en LECTURE SEULE : lit toute une table ou vue.
 *
 * La chaîne de connexion (avec identifiants) arrive via `config.secret`, injecté
 * au moment de la lecture depuis le coffre à secrets — jamais persistée en
 * clair. Le nom de table (`config.table`, à défaut `config.location`) est validé
 * comme identifiant SQL simple puis cité : pas de concaténation libre, pas
 * d'injection.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** Valide « table » ou « schema.table » et renvoie la forme citée et sûre. */
export function quoteQualifiedName(name: string): string {
  const parts = name.trim().split(".");
  if (parts.length === 0 || parts.length > 2 || parts.some((p) => !IDENTIFIER.test(p))) {
    throw new Error(
      `Nom de table invalide : « ${name} ». Attendu : « table » ou « schema.table » ` +
        `(lettres, chiffres, _ ; commençant par une lettre).`,
    );
  }
  return parts.map((p) => `"${p}"`).join(".");
}

export class PostgresDataSource implements DataSource {
  test(): Promise<boolean> {
    // La vraie vérification de connexion se fait à fetchTable (il faut la
    // chaîne de connexion, fournie par appel) ; pas d'état ici.
    return Promise.resolve(true);
  }

  async fetchTable(config: TableConfig): Promise<SourceRow[]> {
    const connectionString = config.secret;
    if (connectionString === undefined || connectionString === "") {
      throw new Error("Connecteur SQL : chaîne de connexion manquante (coffre à secrets).");
    }
    const ident = quoteQualifiedName(config.table ?? config.location);

    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const result = await client.query(`SELECT * FROM ${ident}`);
      return result.rows.map((row: Record<string, unknown>, i) => ({
        rowNumber: i + 1,
        data: row,
      }));
    } finally {
      await client.end();
    }
  }
}
