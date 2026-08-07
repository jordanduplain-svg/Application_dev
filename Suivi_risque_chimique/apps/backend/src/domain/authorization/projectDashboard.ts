import type { DashboardRow, JoinAnomaly } from "../dashboard/types.js";
import type { PersonnelItem } from "../mapping/types.js";

/**
 * Projections du tableau de bord selon la politique colonnes (ADR 0002).
 *
 * La projection se fait CÔTÉ SERVEUR : le frontend reçoit déjà la bonne
 * forme. Il n'existe aucun moyen, depuis le navigateur d'un RH, d'obtenir un
 * champ chimique — il n'est jamais sérialisé dans la réponse.
 */

/** Vue ADMINISTRATIVE (RH) : identité et affectations, AUCUN champ chimique. */
export interface AdministrativeRow {
  matricule: string | null;
  nom: string;
  prenom: string;
  fonction: string | null;
  codeSecteur: string;
  dateDebutSecteur: Date;
  dateFinSecteur: Date | null;
  /** ETT de l'intérimaire, ou null. Donnée administrative → visible par RH. */
  entrepriseTravailTemporaire: string | null;
}

export type DashboardView =
  | { columns: "full"; rows: DashboardRow[]; joinAnomalies: JoinAnomaly[] }
  | { columns: "administrative"; rows: AdministrativeRow[] };

/**
 * Vue RH construite directement depuis le PERSONNEL — pas depuis les lignes
 * jointes. Deux raisons :
 *  1. une personne d'un secteur SANS produit évalué doit apparaître pour RH
 *     (le produit cartésien personne × produit l'omettrait) ;
 *  2. partir des lignes jointes obligerait à dédupliquer et trimballerait
 *     des données chimiques dont RH n'a pas besoin (minimisation : elles ne
 *     sont même pas chargées par le cas d'usage).
 */
export function toAdministrativeRows(personnel: PersonnelItem[]): AdministrativeRow[] {
  return personnel.map((p) => ({
    matricule: p.matricule,
    nom: p.nom,
    prenom: p.prenom,
    fonction: p.fonction,
    codeSecteur: p.codeSecteur,
    dateDebutSecteur: p.dateDebutSecteur,
    dateFinSecteur: p.dateFinSecteur,
    entrepriseTravailTemporaire: p.entrepriseTravailTemporaire,
  }));
}
