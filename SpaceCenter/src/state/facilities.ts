// Effets des bâtiments (GDD 8) — chaque type a un rôle mécanique concret.
// Pur TS : prend la liste des ids de bâtiments posés, produit des modificateurs
// consommés au lancement (coût, fiabilité, taille de fusée, recherche).

import type { BranchId } from './tech';
import type { RocketDesign } from './launch';

export interface Facilities {
  costFactor: number; // multiplie le coût des fusées (entrepôts → moins cher)
  branchRisk: Record<BranchId, number>; // multiplie le risque des composants d'une branche (usines)
  reliabilityMult: number; // fiabilité globale (formation + contrôle)
  padCapacity: number; // nombre d'étages max lançable (meilleur pas de tir), 0 = aucun
  rpFactor: number; // multiplie les Points de Recherche gagnés (labos)
}

// Réglages (à équilibrer) — voir scripts/balance-sim.ts
const WAREHOUSE_STEP = 0.94; // −6 % de coût par entrepôt
const COST_FLOOR = 0.7;
const TRAINING_STEP = 1.02; // +2 % fiabilité par centre de formation
const CONTROL_STEP = 1.03; // +3 % fiabilité par centre de contrôle
const RELIABILITY_CAP = 1.12;
const FACTORY_RISK_STEP = 0.85; // −15 % de risque sur la branche par usine
const FACTORY_RISK_FLOOR = 0.55;
const LAB_STEP = 0.5; // +50 % de PR par labo

const PAD_STAGES: Record<string, number> = {
  pad_small: 2,
  pad_medium: 3,
  pad_heavy: 5,
};
const FACTORY_BRANCH: Record<string, BranchId> = {
  factory_prop: 'propulsion',
  factory_struct: 'structures',
  factory_avionics: 'avionique',
};

export function facilities(buildingIds: string[]): Facilities {
  const count = (id: string) => buildingIds.filter((b) => b === id).length;

  const branchRisk: Record<BranchId, number> = { propulsion: 1, structures: 1, avionique: 1 };
  for (const [id, branch] of Object.entries(FACTORY_BRANCH))
    branchRisk[branch] = Math.max(FACTORY_RISK_FLOOR, FACTORY_RISK_STEP ** count(id));

  const reliabilityMult = Math.min(
    RELIABILITY_CAP,
    TRAINING_STEP ** count('training') * CONTROL_STEP ** count('control'),
  );

  const padCapacity = Math.max(
    0,
    ...buildingIds.filter((id) => id in PAD_STAGES).map((id) => PAD_STAGES[id]),
  );

  return {
    costFactor: Math.max(COST_FLOOR, WAREHOUSE_STEP ** count('warehouse')),
    branchRisk,
    reliabilityMult,
    padCapacity,
    rpFactor: 1 + LAB_STEP * count('lab'),
  };
}

// Applique la qualité de production des usines : réduit le risque des composants
// de la branche concernée (comme applyTech, sans muter le design source).
export function applyFacilities(design: RocketDesign, fac: Facilities): RocketDesign {
  return {
    ...design,
    stages: design.stages.map((stage) =>
      stage.map((c) =>
        c.branch ? { ...c, reliability: 1 - (1 - c.reliability) * fac.branchRisk[c.branch] } : c,
      ),
    ),
  };
}
