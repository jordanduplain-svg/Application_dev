// Cœur systémique (GDD section 6) : fiabilité, réputation, échecs.
// Pur TS — aucune dépendance à Three.js ni au DOM. RNG injectable pour les tests.
// Tous les coefficients sont inventés (le GDD n'en donne pas) : à équilibrer.

export interface ComponentSpec {
  name: string;
  reliability: number; // 0..1, fiabilité de base
  branch?: 'propulsion' | 'structures' | 'avionique'; // branche tech qui l'améliore (cf. state/tech.ts)
}

export interface RocketDesign {
  id: string;
  name: string;
  stages: ComponentSpec[][]; // un tableau de composants par étage
}

// GDD 6.1 : dilemme temps/argent/risque à l'assemblage
export type Margin = 'presse' | 'standard' | 'rode';
const MARGIN_FACTOR: Record<Margin, number> = { presse: 0.93, standard: 1, rode: 1.04 };

// GDD 6.1 : jauge décomposée — chaque contribution est visible séparément
export interface ReliabilityBreakdown {
  components: number; // produit des fiabilités de base
  interfaces: number; // risque par jonction inter-étages
  maturity: number; // malus vol inaugural → bonus heritage cumulatif
  margin: number;
  total: number; // produit des quatre, plafonné à 0.99
}

export type Outcome = 'succes' | 'echec-partiel' | 'echec-total';

// GDD 6.2 : un échec discret pèse peu, un échec médiatisé fait mal
export type Publicity = 'discret' | 'public';
const PUBLICITY_WEIGHT: Record<Publicity, number> = { discret: 0.25, public: 1 };

export interface LaunchResult {
  outcome: Outcome;
  reliability: ReliabilityBreakdown;
  flightNumber: number; // n° de vol global du programme
}

// GDD 6.3 : l'échec est journalisé et reste consultable
export interface FailureRecord {
  flightNumber: number;
  designName: string;
  outcome: Outcome;
  cause: string; // sous-système le plus faible de la jauge
}

const INTERFACE_RISK = 0.97; // par jonction inter-étages
const MAIDEN_MALUS = 0.95;
const HERITAGE_PER_SUCCESS = 0.015; // +1,5 % par succès du design, plafonné
const HERITAGE_CAP = 0.1;
const RELIABILITY_CAP = 0.99; // le risque zéro n'existe pas
const PARTIAL_SHARE = 0.55; // part des échecs qui restent partiels

// GDD 6.2 : gains lents, pertes rapides — la récupération est volontaire
const REP_DELTA: Record<Outcome, { state: number; commercial: number }> = {
  succes: { state: 1, commercial: 2 },
  'echec-partiel': { state: -4, commercial: -6 },
  'echec-total': { state: -10, commercial: -15 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// GDD 6.2 : assurance de lancement. La prime grimpe quand la confiance baisse —
// chère précisément quand on en a le plus besoin. En cas d'échec, remboursement
// du véhicule (plein si total, moitié si partiel).
const INSURANCE_MIN = 0.15; // % du coût à confiance 100
const INSURANCE_MAX = 0.5; // % du coût à confiance 0
export function insurancePremium(cost: number, repCommercial: number): number {
  const rate = INSURANCE_MIN + (INSURANCE_MAX - INSURANCE_MIN) * (1 - clamp(repCommercial, 0, 100) / 100);
  return Math.round(cost * rate);
}
export function insurancePayout(cost: number, outcome: Outcome): number {
  return outcome === 'echec-total' ? cost : outcome === 'echec-partiel' ? Math.round(cost / 2) : 0;
}

export class SpaceProgram {
  repState = 50; // réputation étatique, 0..100
  repCommercial = 50; // confiance internationale/commerciale, 0..100
  readonly failures: FailureRecord[] = [];
  private flights = 0;
  private successesByDesign = new Map<string, number>();
  // modificateur transitoire de fiabilité (événements GDD 5), sur N vols
  private relMod = 1;
  private relModRemaining = 0;

  get flightCount(): number {
    return this.flights;
  }

  get reliabilityModifier(): number {
    return this.relModRemaining > 0 ? this.relMod : 1;
  }

  // Bonus/malus de réputation externes (ex. contrats), bornés 0..100
  adjust(state: number, commercial: number): void {
    this.repState = clamp(this.repState + state, 0, 100);
    this.repCommercial = clamp(this.repCommercial + commercial, 0, 100);
  }

  // Événement affectant la fiabilité des N prochains vols (grève, percée, etc.)
  applyReliabilityMod(mult: number, launches: number): void {
    this.relMod = mult;
    this.relModRemaining = launches;
  }

  // facilityMult : bonus de fiabilité des installations (formation/contrôle, GDD 8)
  reliability(design: RocketDesign, margin: Margin = 'standard', facilityMult = 1): ReliabilityBreakdown {
    const components = design.stages.flat().reduce((p, c) => p * c.reliability, 1);
    const interfaces = INTERFACE_RISK ** Math.max(0, design.stages.length - 1);
    const successes = this.successesByDesign.get(design.id) ?? 0;
    const maturity =
      successes === 0 ? MAIDEN_MALUS : 1 + Math.min(successes * HERITAGE_PER_SUCCESS, HERITAGE_CAP);
    const m = MARGIN_FACTOR[margin];
    return {
      components,
      interfaces,
      maturity,
      margin: m,
      total: Math.min(
        components * interfaces * maturity * m * this.reliabilityModifier * facilityMult,
        RELIABILITY_CAP,
      ),
    };
  }

  launch(
    design: RocketDesign,
    opts: { margin?: Margin; publicity?: Publicity } = {},
    rng: () => number = Math.random,
    facilityMult = 1,
  ): LaunchResult {
    const breakdown = this.reliability(design, opts.margin ?? 'standard', facilityMult);
    this.flights++;
    const roll = rng();
    let outcome: Outcome;
    if (roll < breakdown.total) outcome = 'succes';
    else if (roll < breakdown.total + (1 - breakdown.total) * PARTIAL_SHARE) outcome = 'echec-partiel';
    else outcome = 'echec-total';

    if (outcome === 'succes') {
      this.successesByDesign.set(design.id, (this.successesByDesign.get(design.id) ?? 0) + 1);
    } else {
      this.failures.push({
        flightNumber: this.flights,
        designName: design.name,
        outcome,
        cause: this.weakestFactor(breakdown),
      });
    }

    const w = PUBLICITY_WEIGHT[opts.publicity ?? 'public'];
    this.repState = clamp(this.repState + REP_DELTA[outcome].state * w, 0, 100);
    this.repCommercial = clamp(this.repCommercial + REP_DELTA[outcome].commercial * w, 0, 100);

    if (this.relModRemaining > 0) this.relModRemaining--;
    return { outcome, reliability: breakdown, flightNumber: this.flights };
  }

  // Cause de l'échec = la contribution la plus pénalisante de la jauge
  private weakestFactor(b: ReliabilityBreakdown): string {
    const factors: [string, number][] = [
      ['défaillance composant', b.components],
      ['séparation inter-étages', b.interfaces],
      ['design non éprouvé', b.maturity],
      ['tests insuffisants', b.margin],
    ];
    factors.sort((a, z) => a[1] - z[1]);
    return factors[0][0];
  }
}

// ponytail: blacklist par client (GDD 6.3) absente — il n'existe encore ni clients ni contrats ; à brancher avec le système de contrats (GDD 7).
