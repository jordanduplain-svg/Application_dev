import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SourceRow } from "../../../domain/mapping/types.js";
import type { DataSource, TableConfig } from "../../../ports/DataSource.js";
import { CsvDataSource } from "../csv/CsvDataSource.js";
import { ExcelDataSource } from "../excel/ExcelDataSource.js";

/**
 * Connecteur SharePoint / OneDrive en LECTURE SEULE via Microsoft Graph
 * (authentification app-only / client credentials).
 *
 * Entrée : un LIEN DE PARTAGE SharePoint (bouton « Copier le lien »), reçu via
 * `config.secret` (rangé chiffré au coffre — pas un secret au sens strict, mais
 * on réutilise le même chemin que les connecteurs base de données). On le passe
 * à Graph `/shares/{u!base64url}/driveItem`, on télécharge le contenu, puis on
 * DÉLÈGUE le parsing au connecteur Excel/CSV existant (rien de réinventé).
 *
 * Les identifiants de l'app (tenant/client/secret) sont GLOBAUX (env), pas par
 * source : une seule app Entra lit tous les fichiers autorisés.
 */
export interface SharePointCreds {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export class SharePointDataSource implements DataSource {
  constructor(
    private readonly creds: SharePointCreds,
    private readonly tempDir: string,
  ) {}

  test(): Promise<boolean> {
    return Promise.resolve(true);
  }

  private async token(): Promise<string> {
    const res = await fetch(
      `https://login.microsoftonline.com/${this.creds.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }).toString(),
      },
    );
    if (!res.ok) throw new Error(`SharePoint : authentification échouée (${res.status}).`);
    return ((await res.json()) as { access_token: string }).access_token;
  }

  async fetchTable(config: TableConfig): Promise<SourceRow[]> {
    const shareUrl = config.secret ?? config.location;
    if (shareUrl === undefined || shareUrl === "") {
      throw new Error("SharePoint : lien de partage manquant.");
    }
    const token = await this.token();
    const headers = { Authorization: `Bearer ${token}` };
    // Encodage Graph des liens de partage : « u! » + base64url(url) sans padding.
    const shareId = `u!${Buffer.from(shareUrl).toString("base64url")}`;
    const base = `https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem`;

    const metaRes = await fetch(base, { headers });
    if (!metaRes.ok) throw new Error(`SharePoint : fichier introuvable (${metaRes.status}).`);
    const name = ((await metaRes.json()) as { name?: string }).name ?? "fichier";
    const ext = path.extname(name).toLowerCase();
    if (ext !== ".xlsx" && ext !== ".csv") {
      throw new Error(`SharePoint : format « ${ext || "?"} » non supporté (attendu .xlsx ou .csv).`);
    }

    const contentRes = await fetch(`${base}/content`, { headers });
    if (!contentRes.ok) throw new Error(`SharePoint : téléchargement échoué (${contentRes.status}).`);
    const bytes = Buffer.from(await contentRes.arrayBuffer());

    await mkdir(this.tempDir, { recursive: true });
    const tmp = path.join(this.tempDir, `sp-${randomUUID()}${ext}`);
    await writeFile(tmp, bytes);
    try {
      const parser: DataSource = ext === ".xlsx" ? new ExcelDataSource() : new CsvDataSource();
      return await parser.fetchTable({
        location: tmp,
        ...(config.table !== undefined ? { table: config.table } : {}),
      });
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }
}
