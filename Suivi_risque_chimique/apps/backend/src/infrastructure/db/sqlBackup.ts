import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { Client } from "pg";

/**
 * Sauvegarde SQL portable (schéma + données), SANS dépendre du binaire
 * `pg_dump` — celui-ci est absent du paquet Windows d'`embedded-postgres`
 * (`@embedded-postgres/windows-x64` ne fournit que initdb/pg_ctl/postgres,
 * pas les outils client). Fonctionne identiquement sur toutes les
 * plateformes puisqu'elle ne s'appuie que sur `pg` (déjà une dépendance) et
 * le système de fichiers.
 *
 * Schéma : concaténation des migrations Prisma déjà appliquées — c'est la
 * même source de vérité que celle utilisée pour créer la base, donc fidèle
 * par construction (aucune réimplémentation d'introspection de schéma).
 * Données : un INSERT par table, dans un ordre qui respecte les clés
 * étrangères (tri topologique déduit de `information_schema`).
 */
export async function generateSqlBackup(
  databaseUrl: string,
  migrationsDir: string,
): Promise<string> {
  const schemaSql = readMigrationsSql(migrationsDir);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tables = await orderedTables(client);
    const dataSql = await Promise.all(tables.map((table) => dumpTable(client, table)));
    return [
      "-- Sauvegarde CMR Tracker (schéma + données). Restauration : psql < fichier.sql",
      "BEGIN;",
      schemaSql,
      dataSql.join("\n\n"),
      "COMMIT;",
      "",
    ].join("\n\n");
  } finally {
    await client.end();
  }
}

function readMigrationsSql(migrationsDir: string): string {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(); // dossiers préfixés par un horodatage → ordre chronologique
  return dirs
    .map((dir) => readFileSync(path.join(migrationsDir, dir, "migration.sql"), "utf-8"))
    .join("\n\n");
}

/** Tables de base (hors vues), triées pour que chaque table précède celles qui la référencent. */
async function orderedTables(client: Client): Promise<string[]> {
  const { rows: allTables } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name <> '_prisma_migrations'`, // bookkeeping Prisma, absent du DDL des migrations elles-mêmes
  );
  const { rows: deps } = await client.query<{ child: string; parent: string }>(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
       AND tc.table_name <> ccu.table_name`,
  );

  const remaining = new Set(allTables.map((t) => t.table_name));
  const placed = new Set<string>();
  const ordered: string[] = [];
  // Tri topologique (Kahn) : place les tables dont tous les parents FK sont déjà placés.
  while (remaining.size > 0) {
    const ready = [...remaining].filter((t) =>
      deps.every((d) => d.child !== t || placed.has(d.parent) || !remaining.has(d.parent)),
    );
    // Sécurité anti-cycle (ne devrait pas arriver en pratique) : on débloque en plaçant le reste.
    const batch = ready.length > 0 ? ready : [...remaining];
    for (const t of batch) {
      ordered.push(t);
      placed.add(t);
      remaining.delete(t);
    }
  }
  return ordered;
}

async function dumpTable(client: Client, table: string): Promise<string> {
  const { rows, fields } = await client.query(`SELECT * FROM "${table}"`);
  if (rows.length === 0) return `-- ${table} : aucune ligne`;
  const columns = fields.map((f) => f.name);
  const columnList = columns.map((c) => `"${c}"`).join(", ");
  const values = rows
    .map((row: Record<string, unknown>) => `(${columns.map((c) => sqlLiteral(row[c])).join(", ")})`)
    .join(",\n  ");
  return `INSERT INTO "${table}" (${columnList}) VALUES\n  ${values};`;
}

/** Littéral SQL sûr. Les types cibles (bigint, uuid, enum, jsonb…) sont castés
 *  implicitement par Postgres depuis un littéral texte, donc tout ce qui n'est
 *  pas un nombre/booléen/date est simplement une chaîne entre quotes échappés. */
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === "object") return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
