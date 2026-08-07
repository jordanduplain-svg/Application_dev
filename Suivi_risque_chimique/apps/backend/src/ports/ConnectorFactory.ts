import type { DataSource } from "./DataSource.js";

/**
 * Port `ConnectorFactory` — fabrique un connecteur `DataSource` à partir de
 * son type, sans que les couches application connaissent les implémentations
 * concrètes (ExcelDataSource, etc.).
 *
 * Ajouter un connecteur = l'enregistrer dans la fabrique d'infrastructure ;
 * le moteur de flux n'a pas à changer.
 */
export interface ConnectorFactory {
  /** Crée le connecteur du type donné, ou lève si le type est inconnu. */
  create(connectorType: string): DataSource;
}
