import type { SourceRow } from "../domain/mapping/types.js";

/**
 * Port `DataSource` — connecteur d'import en LECTURE SEULE.
 *
 * Principe (brief §5) : l'application n'a JAMAIS de connexion live à une
 * source externe. Un connecteur sait seulement :
 *   1. tester qu'il peut se connecter,
 *   2. ramener le contenu d'une « table » (feuille Excel, liste SharePoint,
 *      table Snowflake…) sous forme de lignes brutes,
 *   3. optionnellement, dire si quelque chose a changé depuis un jeton de
 *      synchronisation (delta queries SharePoint, modified_at Snowflake…)
 *      pour le déclencheur événementiel du moteur de flux.
 *
 * Ajouter une source = écrire une classe qui implémente cette interface.
 * Rien d'autre ne bouge.
 */

/** Désignation de la « table » à lire, propre à chaque connecteur. */
export interface TableConfig {
  /**
   * Localisation de la donnée. Sémantique par connecteur :
   *  - Excel : chemin du fichier (`location`) + nom de feuille (`table`,
   *    défaut : première feuille)
   *  - SharePoint : URL du site + nom de liste
   *  - Snowflake : database.schema + nom de table
   */
  location: string;
  table?: string;
  /**
   * Identifiant de connexion TRANSITOIRE (chaîne de connexion SQL…), injecté au
   * moment de la lecture depuis le coffre à secrets. JAMAIS persisté ici, jamais
   * renvoyé au client. Absent pour les connecteurs fichier.
   */
  secret?: string;
}

export interface DataSource {
  /** Vérifie que la source est joignable (fichier lisible, API up, etc.). */
  test(): Promise<boolean>;

  /**
   * Lit l'intégralité de la table et la renvoie en lignes brutes
   * (clé = nom de colonne côté client, valeur = contenu de cellule), chacune
   * accompagnée de son numéro de ligne DANS LA SOURCE — c'est ce numéro que
   * les anomalies montrent à l'utilisateur pour qu'il corrige son fichier.
   * Le mapping vers les champs canoniques est fait PLUS TARD, par le domaine —
   * un connecteur ne connaît pas le métier.
   */
  fetchTable(config: TableConfig): Promise<SourceRow[]>;

  /**
   * Détection de changement pour le ChangeTrigger du moteur de flux.
   * `token` est opaque (curseur delta, timestamp…) : le moteur le stocke et
   * le repasse tel quel. Absent si la source ne sait pas détecter.
   */
  hasChangesSince?(token: string | null): Promise<{ changed: boolean; nextToken: string }>;
}
