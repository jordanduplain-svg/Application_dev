// Arbre technologique (GDD section 3) — MVP : 3 branches, paliers séquentiels.
// Pur TS. Le coût double du GDD (RP + points de branche) est réduit à des RP
// génériques pour le MVP ; les RP se gagnent en lançant (cf. launchPanel).

import type { RocketDesign } from './launch';

export type BranchId = 'propulsion' | 'structures' | 'avionique';

export interface TechTier {
  name: string;
  cost: number; // en Points de Recherche
}

export interface TechConfig {
  branches: Record<BranchId, { name: string; tiers: TechTier[] }>;
}

// GDD 3.1 : chaque palier réduit le risque des composants de sa branche
export const RISK_REDUCTION_PER_TIER = 0.85; // −15 % de probabilité de panne par palier

// RP gagnés par lancement — un échec enseigne aussi, mais moins
export const RP_GAIN = { succes: 25, 'echec-partiel': 10, 'echec-total': 5 } as const;

export class TechTree {
  rp = 0;
  onChange: () => void = () => {};
  private levels: Record<BranchId, number> = { propulsion: 0, structures: 0, avionique: 0 };

  readonly cfg: TechConfig;

  constructor(cfg: TechConfig) {
    this.cfg = cfg;
  }

  level(b: BranchId): number {
    return this.levels[b];
  }

  // GDD 3.2 : graduel — seul le palier suivant est recherchable
  nextTier(b: BranchId): TechTier | null {
    return this.cfg.branches[b].tiers[this.levels[b]] ?? null;
  }

  canResearch(b: BranchId): boolean {
    const t = this.nextTier(b);
    return t !== null && t.cost <= this.rp;
  }

  research(b: BranchId): boolean {
    if (!this.canResearch(b)) return false;
    this.rp -= this.nextTier(b)!.cost;
    this.levels[b]++;
    this.onChange();
    return true;
  }

  award(points: number): void {
    this.rp += points;
    this.onChange();
  }

  // Prérequis d'un design (ex. Albatros : propulsion 1 + structures 1)
  meets(requires: Partial<Record<BranchId, number>> | undefined): boolean {
    if (!requires) return true;
    return (Object.entries(requires) as [BranchId, number][]).every(([b, lvl]) => this.levels[b] >= lvl);
  }
}

// Applique les paliers recherchés : fiabilité' = 1 − (1 − fiabilité) × 0,85^palier
// pour les composants tagués d'une branche. Retourne un design équivalent, sans muter.
export function applyTech(design: RocketDesign, tree: TechTree): RocketDesign {
  return {
    ...design,
    stages: design.stages.map((stage) =>
      stage.map((c) =>
        c.branch
          ? { ...c, reliability: 1 - (1 - c.reliability) * RISK_REDUCTION_PER_TIER ** tree.level(c.branch) }
          : c,
      ),
    ),
  };
}
