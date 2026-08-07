/**
 * PostgreSQL EMBARQUÉ, mode STANDALONE — remplace `docker compose up` pour le
 * développement (notamment avec `pnpm dev` en watch, qui redémarre souvent : on
 * garde alors la base dans un process séparé et stable).
 *
 * Usage (laisser tourner) :
 *   pnpm --filter @cmr-tracker/backend db:embedded
 * Puis, dans un autre terminal, le workflow habituel est INCHANGÉ
 * (prisma migrate deploy / seed:demo / dev).
 *
 * Pour le mode « tout-en-un » (l'app démarre elle-même sa base), voir
 * `src/main.ts` avec DB_EMBEDDED=true ou l'option `--embedded`.
 */
import { startEmbeddedPostgres } from "../src/infrastructure/db/embeddedPostgres.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === "") {
  throw new Error("DATABASE_URL manquante (lancer via le script pnpm db:embedded).");
}

async function main(): Promise<void> {
  const handle = await startEmbeddedPostgres(databaseUrl as string);
  const { host } = new URL(databaseUrl as string);
  // eslint-disable-next-line no-console
  console.log(`[embedded-pg] prêt sur ${host}. Laissez ce terminal ouvert (Ctrl+C pour arrêter).`);

  const stop = async (): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log("\n[embedded-pg] arrêt…");
    await handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  await new Promise<never>(() => {}); // garde PostgreSQL en vie
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[embedded-pg] échec :", err);
  process.exit(1);
});
