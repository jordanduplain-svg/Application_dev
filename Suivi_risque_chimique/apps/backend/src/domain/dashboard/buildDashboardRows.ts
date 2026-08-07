import { classifyCmr } from "../cmr/classifyCmr.js";
import { calculateExposureDuration } from "../exposure/calculateExposureDuration.js";
import { normalizeText } from "../mapping/normalizeText.js";
import type {
  DegreExpositionItem,
  PersonnelItem,
  RisqueChimiqueItem,
} from "../mapping/types.js";
import type { Clock } from "../../ports/Clock.js";
import type { DashboardData, DashboardRow, JoinAnomaly } from "./types.js";

/**
 * Jointure centrale du produit (brief §7) :
 *   PERSONNEL × RISQUES_CHIMIQUES sur code_secteur (normalisé)
 *   LEFT JOIN DEGRE_EXPOSITION sur (identité personne, secteur, produit normalisé)
 * puis calcul de la durée d'exposition par ligne (domain/exposure).
 *
 * POURQUOI une jointure applicative et non SQL (décision à tracer en ADR) :
 *  - le rapprochement passe par la normalisation (casse/accents/espaces) qui
 *    vit dans UN seul module (normalizeText). La dupliquer en SQL (unaccent,
 *    lower, regexp_replace) créerait deux implémentations qui divergent.
 *  - la détection d'ambiguïté homonymes (un degré sans matricule qui pourrait
 *    appartenir à deux personnes) est une règle métier impossible à exprimer
 *    proprement en SQL pur — et on REFUSE d'attribuer au hasard.
 *  - volumes cibles ETI : quelques milliers de personnes × dizaines de
 *    produits/secteur — négligeable en mémoire. Si un client dépasse cet
 *    ordre de grandeur, on poussera des colonnes normalisées en base et la
 *    jointure descendra en SQL, sans toucher les règles (elles sont ici).
 *
 * Règles d'attribution du degré (cadrage : match exact normalisé, jamais de
 * fuzzy, anomalie plutôt que faux match) :
 *  1. degré porteur d'un matricule → attribué à la personne de MÊME matricule
 *     dans le secteur ; introuvable → anomalie degree_orphan_person.
 *  2. degré sans matricule → attribué par nom+prénom normalisés ; si
 *     PLUSIEURS personnes du secteur partagent ce nom → anomalie
 *     ambiguous_person_match, degré NON attribué (données de santé : on
 *     n'attribue pas une exposition au hasard).
 *  3. degré dont le produit n'existe pas dans les risques du secteur →
 *     anomalie degree_orphan_product.
 */
export function buildDashboardRows(
  personnel: PersonnelItem[],
  risques: RisqueChimiqueItem[],
  degres: DegreExpositionItem[],
  clock: Clock,
): DashboardData {
  const joinAnomalies: JoinAnomaly[] = [];

  // --- Index des produits par secteur normalisé.
  const risquesBySecteur = new Map<string, RisqueChimiqueItem[]>();
  const produitsConnus = new Set<string>(); // "secteur|produit" pour le contrôle d'orphelins
  for (const r of risques) {
    const secteur = normalizeText(r.codeSecteur);
    const list = risquesBySecteur.get(secteur) ?? [];
    list.push(r);
    risquesBySecteur.set(secteur, list);
    produitsConnus.add(`${secteur}|${normalizeText(r.designation)}`);
  }

  // --- Index des personnes par nom normalisé (secteur|np:nom|prenom) → LISTE.
  // Sert à l'attribution des degrés SANS matricule et à la détection
  // d'homonymes. L'attribution PAR matricule se fait par filtrage direct de
  // `personnel` (toutes les affectations), pas via cet index.
  const personnesParNom = new Map<string, PersonnelItem[]>();
  for (const p of personnel) {
    const secteur = normalizeText(p.codeSecteur);
    const nomKey = `${secteur}|np:${normalizeText(p.nom)}|${normalizeText(p.prenom)}`;
    const list = personnesParNom.get(nomKey) ?? [];
    list.push(p);
    personnesParNom.set(nomKey, list);
  }

  // --- Attribution des degrés : index "personne résolue|secteur|produit" → degré.
  // Une personne est représentée par sa naturalKey (unique par affectation).
  const degreParCible = new Map<string, DegreExpositionItem>();
  for (const d of degres) {
    const secteur = normalizeText(d.codeSecteur);
    const produit = normalizeText(d.nomProduit);

    // Contrôle produit : un degré sur un produit absent des risques du
    // secteur signale un écart entre fichiers HSE (faute de frappe non
    // couverte par la normalisation, produit retiré de l'évaluation…).
    if (!produitsConnus.has(`${secteur}|${produit}`)) {
      joinAnomalies.push({
        code: "degree_orphan_product",
        codeSecteur: d.codeSecteur,
        degreNaturalKey: d.naturalKey,
        message: `Un degré d'exposition référence un produit absent de l'évaluation des risques du secteur (clé : ${d.naturalKey}).`,
      });
      continue;
    }

    // Résolution de la/les personne(s) cible(s). Le degré vaut pour TOUTES les
    // affectations de la personne au secteur (le fichier degrés n'a pas de
    // dimension temporelle) : une personne partie puis revenue est UNE
    // personne, jamais une ambiguïté — y compris sans matricule.
    let targets: PersonnelItem[];
    if (d.matricule !== null) {
      const m = normalizeText(d.matricule);
      targets = personnel.filter(
        (p) =>
          normalizeText(p.codeSecteur) === secteur &&
          p.matricule !== null &&
          normalizeText(p.matricule) === m,
      );
    } else {
      const candidates =
        personnesParNom.get(`${secteur}|np:${normalizeText(d.nom)}|${normalizeText(d.prenom)}`) ??
        [];
      // Ambiguïté = plusieurs IDENTITÉS distinctes au même nom — et NON plusieurs
      // affectations d'une même personne. On compare donc sur l'identité
      // (matricule, ou nom+prénom normalisés), pas sur la naturalKey : celle-ci
      // porte la date de début et ferait passer deux affectations d'une même
      // personne sans matricule pour deux personnes distinctes (faux positif).
      const distinctIdentities = new Set(
        candidates.map((c) =>
          c.matricule !== null
            ? `m:${normalizeText(c.matricule)}`
            : `np:${normalizeText(c.nom)}|${normalizeText(c.prenom)}`,
        ),
      );
      if (distinctIdentities.size > 1) {
        joinAnomalies.push({
          code: "ambiguous_person_match",
          codeSecteur: d.codeSecteur,
          degreNaturalKey: d.naturalKey,
          message:
            `Un degré d'exposition sans matricule correspond à plusieurs personnes du secteur ` +
            `(clé : ${d.naturalKey}). Ajoutez le matricule dans le fichier des degrés — ` +
            `l'attribution au hasard est exclue.`,
        });
        continue;
      }
      targets = candidates;
    }

    if (targets.length === 0) {
      joinAnomalies.push({
        code: "degree_orphan_person",
        codeSecteur: d.codeSecteur,
        degreNaturalKey: d.naturalKey,
        message: `Un degré d'exposition référence une personne introuvable dans le secteur (clé : ${d.naturalKey}).`,
      });
      continue;
    }

    for (const c of targets) {
      degreParCible.set(`${c.naturalKey}|${produit}`, d);
    }
  }

  // --- Produit cartésien personne × produits de son secteur.
  const rows: DashboardRow[] = [];
  for (const p of personnel) {
    const secteur = normalizeText(p.codeSecteur);
    const produits = risquesBySecteur.get(secteur) ?? [];
    for (const r of produits) {
      const degre = degreParCible.get(`${p.naturalKey}|${normalizeText(r.designation)}`);

      const exposure = calculateExposureDuration(
        {
          sectorStartDate: p.dateDebutSecteur,
          sectorEndDate: p.dateFinSecteur,
          productWithdrawalDate: r.dateRetrait,
        },
        clock,
      );

      const cmr = classifyCmr(r.classifSgh, r.mentionDanger);

      rows.push({
        matricule: p.matricule,
        nom: p.nom,
        prenom: p.prenom,
        fonction: p.fonction,
        codeSecteur: p.codeSecteur,
        dateDebutSecteur: p.dateDebutSecteur,
        dateFinSecteur: p.dateFinSecteur,
        entrepriseTravailTemporaire: p.entrepriseTravailTemporaire,
        designation: r.designation,
        nCas: r.nCas,
        classifSgh: r.classifSgh,
        mentionDanger: r.mentionDanger,
        isCmr: cmr.isCmr,
        cmrCategories: cmr.categories,
        dateEvaluation: r.dateEvaluation,
        dateRetrait: r.dateRetrait,
        degreExposition: degre?.degreExposition ?? null,
        dureeExpositionAnnees: exposure.years,
        exposureAnomalies: exposure.anomalies,
      });
    }
  }

  return { rows, joinAnomalies };
}
