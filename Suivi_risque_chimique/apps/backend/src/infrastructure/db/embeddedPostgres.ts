import { existsSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import EmbeddedPostgres from "embedded-postgres";

/**
 * Un serveur écoute-t-il déjà sur ce port ? Signal FIABLE de « un Postgres
 * tourne » — contrairement au PID du postmaster.pid, qui peut être réutilisé
 * par un autre process après un arrêt brutal et fausser la détection.
 */
function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (v: boolean): void => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(700);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

/**
 * PostgreSQL EMBARQUÉ — un vrai serveur Postgres natif lancé par l'application
 * elle-même (binaire fourni par `embedded-postgres`, sans installation système
 * ni Docker). Permet le « logiciel qu'on lance d'une seule commande » : l'app
 * démarre sa propre base, applique les migrations, puis sert.
 *
 * Base LOCALE uniquement (un serveur distant ne s'« embarque » pas). Le cluster
 * est persistant (dossier gitignoré) : les données survivent aux redémarrages.
 */
export interface EmbeddedPostgresHandle {
  stop(): Promise<void>;
}

export async function startEmbeddedPostgres(
  databaseUrl: string,
  dataDir = path.resolve(process.cwd(), "var", "pgdata"),
): Promise<EmbeddedPostgresHandle> {
  const url = new URL(databaseUrl);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(
      `PostgreSQL embarqué = base LOCALE uniquement. Hôte « ${url.hostname} » refusé. ` +
        `Pour une base distante, lancez sans le mode embarqué.`,
    );
  }

  const dbName = url.pathname.replace(/^\//, "") || "postgres";
  const port = Number(url.port) || 5432;
  const isFresh = !existsSync(dataDir);
  const portBusy = await isPortInUse(port);

  // Un serveur écoute déjà sur le port → on ne démarre pas un second postmaster
  // (corruption possible). Message ACTIONNABLE plutôt que le cryptique
  // « lock file already exists ».
  if (portBusy) {
    throw new Error(
      `Le port ${port} est déjà utilisé : un PostgreSQL (ou un process résiduel) ` +
        `tourne déjà sur ce dossier. Arrêtez-le avant de relancer en mode embarqué ` +
        `— Ctrl+C dans son terminal, ou (Windows, en administrateur) ` +
        `« taskkill /F /IM postgres.exe », puis réessayez.`,
    );
  }

  // Verrou périmé : un postmaster.pid subsiste alors qu'AUCUN serveur n'écoute
  // (arrêt brutal, PID réutilisé…). On le retire pour ne pas bloquer le
  // démarrage. Sûr : on a vérifié juste avant que le port est libre.
  const pidFile = path.join(dataDir, "postmaster.pid");
  if (!isFresh && existsSync(pidFile)) {
    rmSync(pidFile, { force: true });
  }

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: decodeURIComponent(url.username) || "postgres",
    password: decodeURIComponent(url.password) || "postgres",
    port,
    persistent: true,
    // Encodage/tri déterministes, cohérents avec l'ancien conteneur Docker.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  if (isFresh) await pg.initialise();
  await pg.start();
  if (isFresh) await pg.createDatabase(dbName).catch(() => undefined); // ignore « existe déjà »

  return { stop: () => pg.stop() };
}
