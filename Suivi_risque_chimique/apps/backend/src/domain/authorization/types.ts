/**
 * Types du contrôle d'accès — matrice de l'ADR 0002 (validée 2026-06-11).
 *
 * Principe non négociable (brief §11, §18) : le filtrage par rôle s'applique
 * CÔTÉ SERVEUR, avant l'envoi. Le navigateur ne reçoit jamais une donnée
 * qu'une couche UI devrait masquer — une réponse réseau est inspectable.
 */

export type Role = "ADMIN" | "HSE" | "RH" | "MEDECINE" | "MANAGER" | "COLLABORATEUR";

/**
 * Utilisateur authentifié, tel que produit par l'AuthProvider (étape 6).
 * Les attributs de rattachement viennent de la base au moment de l'auth :
 *  - `matricule` : lie un COLLABORATEUR à sa fiche PERSONNEL (clé d'identité
 *    stable décidée au cadrage — jamais nom/prénom, jamais l'email).
 *  - `managedSectors` : codes secteur qu'un MANAGER supervise (table de
 *    rattachement explicite, pas d'auto-déduction — auditable).
 */
export interface AuthenticatedUser {
  id: string;
  role: Role;
  tenantId: string;
  matricule: string | null;
  managedSectors: string[];
}

/**
 * Portée LIGNES : quelles personnes/secteurs l'utilisateur peut voir.
 * Traduite en WHERE SQL par le repository — jamais en post-filtrage.
 */
export type RowScope =
  | { kind: "all" }
  | { kind: "sectors"; sectors: string[] }
  | { kind: "self"; matricule: string }
  /**
   * Aucun accès : un COLLABORATEUR sans matricule rattaché ne peut rien voir
   * (plutôt que « tout voir par accident »). Le guard HTTP transformera ça en
   * 403 explicite avec un message actionnable (contacter l'admin).
   */
  | { kind: "none"; reason: string };

/**
 * Politique COLONNES : quelle projection du tableau de bord le rôle reçoit.
 *  - "full"           : les 13 colonnes (HSE, Médecine, Admin, Manager sur
 *                       son périmètre, Collaborateur sur sa fiche).
 *  - "administrative" : identité et affectations SANS le bloc chimique
 *                       (produits, CAS, SGH, dangers, degrés, durées) — RH.
 */
export type ColumnPolicy = "full" | "administrative";

export interface AccessScope {
  rows: RowScope;
  columns: ColumnPolicy;
  /**
   * Les anomalies de jointure (degrés orphelins, homonymes…) sont un outil
   * de QUALITÉ DES DONNÉES : utiles à ceux qui peuvent corriger les fichiers
   * sources (HSE, Admin). Les diffuser aux autres rôles élargirait la
   * circulation d'informations sans bénéfice (minimisation, art. 5 RGPD).
   */
  seesJoinAnomalies: boolean;
}
