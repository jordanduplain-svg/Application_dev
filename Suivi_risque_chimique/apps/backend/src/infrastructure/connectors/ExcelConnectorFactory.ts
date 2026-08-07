import type { ConnectorFactory } from "../../ports/ConnectorFactory.js";
import type { DataSource } from "../../ports/DataSource.js";
import { CsvDataSource } from "./csv/CsvDataSource.js";
import { ExcelDataSource } from "./excel/ExcelDataSource.js";
import { SharePointDataSource, type SharePointCreds } from "./sharepoint/SharePointDataSource.js";
import { PostgresDataSource } from "./sql/PostgresDataSource.js";
import { SnowflakeDataSource } from "./sql/SnowflakeDataSource.js";

/** Configuration optionnelle des connecteurs nécessitant des identifiants globaux. */
export interface ConnectorFactoryOptions {
  sharepoint?: { creds: SharePointCreds; tempDir: string };
}

/**
 * Fabrique de connecteurs.
 *
 * Disponibles : « excel », « csv » (fichiers locaux), « postgres » et
 * « snowflake » (identifiants via le coffre à secrets), « sharepoint » (si
 * les variables SHAREPOINT_* sont configurées). Le catalogue exposé au
 * frontend (cf. domain/sources/connectorCatalog.ts) doit rester cohérent
 * avec ce switch — un type marqué « available » là-bas doit être géré ici.
 *
 * Le nom de la classe (hérité du MVP « excel seul ») est conservé pour ne pas
 * casser le câblage ; elle gère désormais plusieurs types derrière le même
 * port `ConnectorFactory`.
 */
export class ExcelConnectorFactory implements ConnectorFactory {
  constructor(private readonly options: ConnectorFactoryOptions = {}) {}

  create(connectorType: string): DataSource {
    switch (connectorType) {
      case "excel":
        return new ExcelDataSource();
      case "csv":
        return new CsvDataSource();
      case "postgres":
        return new PostgresDataSource();
      case "sharepoint": {
        const sp = this.options.sharepoint;
        if (sp === undefined) {
          throw new Error(
            "Connecteur SharePoint non configuré (variables SHAREPOINT_* manquantes).",
          );
        }
        return new SharePointDataSource(sp.creds, sp.tempDir);
      }
      case "snowflake":
        return new SnowflakeDataSource();
      default:
        throw new Error(
          `Connecteur « ${connectorType} » inconnu. Disponibles : excel, csv, postgres, sharepoint, snowflake.`,
        );
    }
  }
}
