/**
 * Catalogue des types de connecteurs — SOURCE DE VÉRITÉ pour le sélecteur de
 * source du wizard. Décrit ce qui est réellement disponible AUJOURD'HUI et ce
 * qui est prévu mais pas encore branché.
 *
 * Les connecteurs base de données/cloud (postgres, snowflake, sharepoint)
 * stockent leurs identifiants via le coffre à secrets chiffré — jamais en
 * clair sur une appli de données de santé. Un connecteur listé ici en
 * « coming_soon » n'a PAS d'implémentation câblée : le backend REFUSE de
 * créer une source d'un type non disponible (garde-fou, pas seulement
 * grisage d'UI) — cf. ExcelConnectorFactory, qui doit rester cohérent avec
 * ce catalogue.
 */

export type ConnectorStatus = "available" | "coming_soon";

export interface ConnectorDescriptor {
  type: string;
  label: string;
  /** Familles d'usage, pour regrouper dans l'UI. */
  category: "file" | "cloud" | "database";
  status: ConnectorStatus;
  /** Extensions acceptées à l'upload (connecteurs « file » uniquement). */
  fileExtensions?: string[];
  description: string;
}

export const CONNECTOR_CATALOG: ConnectorDescriptor[] = [
  {
    type: "excel",
    label: "Fichier Excel (.xlsx)",
    category: "file",
    status: "available",
    fileExtensions: [".xlsx"],
    description: "Import d'un classeur Excel. Première ligne = en-têtes de colonnes.",
  },
  {
    type: "csv",
    label: "Fichier CSV (.csv)",
    category: "file",
    status: "available",
    fileExtensions: [".csv"],
    description: "Export tabulaire. Séparateur point-virgule ou virgule détecté automatiquement.",
  },
  {
    type: "sharepoint",
    label: "SharePoint / OneDrive",
    category: "cloud",
    status: "available",
    description:
      "Fichier Excel/CSV hébergé. Collez son lien de partage SharePoint ; lecture via Microsoft Graph.",
  },
  {
    type: "postgres",
    label: "Base PostgreSQL",
    category: "database",
    status: "available",
    description:
      "Lecture d'une table ou vue. Les identifiants de connexion sont stockés chiffrés (coffre à secrets).",
  },
  {
    type: "snowflake",
    label: "Snowflake",
    category: "database",
    status: "available",
    description:
      "Lecture d'une table existante. Identifiants stockés chiffrés (coffre à secrets), même socle que PostgreSQL.",
  },
];

/** Un type de connecteur est-il réellement utilisable aujourd'hui ? */
export function isConnectorAvailable(type: string): boolean {
  return CONNECTOR_CATALOG.some((c) => c.type === type && c.status === "available");
}
