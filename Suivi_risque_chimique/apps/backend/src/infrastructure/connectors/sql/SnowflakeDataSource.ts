import snowflake from "snowflake-sdk";

import type { SourceRow } from "../../../domain/mapping/types.js";
import type { DataSource, TableConfig } from "../../../ports/DataSource.js";
import { quoteQualifiedName } from "./PostgresDataSource.js";

/**
 * Connecteur Snowflake en LECTURE SEULE : lit toute une table ou vue, sur le
 * même socle que le connecteur PostgreSQL (identifiants via `config.secret`,
 * injectés au moment de la lecture depuis le coffre à secrets — jamais
 * persistés en clair).
 *
 * `config.secret` : chaîne « clé=valeur » séparée par des points-virgules
 * (même convention que les chaînes de connexion ODBC/JDBC Snowflake), ex. :
 *   account=xy12345.eu-west-1;user=svc_cmr;password=***;warehouse=COMPUTE_WH;database=CMR;schema=PUBLIC
 * Clés reconnues : account, user, password, warehouse, database, schema, role
 * (role optionnel). Pas de connexion persistante entre deux lectures — une
 * connexion est ouverte, utilisée, fermée à chaque `fetchTable`.
 */
const REQUIRED_KEYS = ["account", "user", "password"] as const;

interface SnowflakeCreds {
  account: string;
  user: string;
  password: string;
  warehouse?: string;
  database?: string;
  schema?: string;
  role?: string;
}

function parseCreds(secret: string): SnowflakeCreds {
  const fields = Object.fromEntries(
    secret
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => {
        const idx = part.indexOf("=");
        return [part.slice(0, idx).trim().toLowerCase(), part.slice(idx + 1).trim()];
      }),
  );
  const missing = REQUIRED_KEYS.filter((k) => !fields[k]);
  if (missing.length > 0) {
    throw new Error(
      `Connecteur Snowflake : identifiants incomplets (manque : ${missing.join(", ")}). ` +
        `Format attendu : account=...;user=...;password=...;warehouse=...;database=...;schema=...`,
    );
  }
  return {
    account: fields.account!,
    user: fields.user!,
    password: fields.password!,
    ...(fields.warehouse !== undefined ? { warehouse: fields.warehouse } : {}),
    ...(fields.database !== undefined ? { database: fields.database } : {}),
    ...(fields.schema !== undefined ? { schema: fields.schema } : {}),
    ...(fields.role !== undefined ? { role: fields.role } : {}),
  };
}

function connect(creds: SnowflakeCreds): Promise<snowflake.Connection> {
  const conn = snowflake.createConnection(creds);
  return new Promise((resolve, reject) => {
    conn.connect((err, c) => (err ? reject(err) : resolve(c)));
  });
}

function destroy(conn: snowflake.Connection): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.destroy((err) => (err ? reject(err) : resolve()));
  });
}

function execute(conn: snowflake.Connection, sqlText: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows ?? [])),
    });
  });
}

export class SnowflakeDataSource implements DataSource {
  async test(): Promise<boolean> {
    // La vraie vérification se fait à fetchTable (il faut les identifiants,
    // fournis par appel) ; pas d'état ici — même principe que PostgresDataSource.
    return true;
  }

  async fetchTable(config: TableConfig): Promise<SourceRow[]> {
    if (config.secret === undefined || config.secret === "") {
      throw new Error("Connecteur Snowflake : identifiants manquants (coffre à secrets).");
    }
    const creds = parseCreds(config.secret);
    const ident = quoteQualifiedName(config.table ?? config.location);

    const conn = await connect(creds);
    try {
      const rows = await execute(conn, `SELECT * FROM ${ident}`);
      return rows.map((row, i) => ({ rowNumber: i + 1, data: row }));
    } finally {
      await destroy(conn);
    }
  }
}
