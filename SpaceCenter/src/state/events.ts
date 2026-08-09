// Événements politiques/scientifiques (GDD section 5) — état pur, RNG injectable.
// Déclenchement aléatoire pondéré par le contexte ; effets à double tranchant.
// La sélection est ici ; l'APPLICATION des effets touche budget/rép/tech et vit
// dans main.ts (applyEventEffect) — trop de dépendances pour rester pur.

export type EventCategory = 'politique' | 'scientifique' | 'economique' | 'interne';

export interface EventEffect {
  budget?: number; // ◈ ferme (peut être négatif)
  budgetFactor?: number; // multiplie le budget courant (0.85 = −15 %)
  repState?: number;
  repCommercial?: number;
  rp?: number;
  reliabilityMult?: number; // modificateur transitoire de fiabilité
  reliabilityLaunches?: number; // sur N vols
}

export interface EventChoice {
  label: string;
  effect: EventEffect;
  note?: string;
}

export interface EventDef {
  id: string;
  category: EventCategory;
  title: string;
  description: string;
  weight: number; // poids de base ; 0 = ne sort jamais sans contexte
  onlyAfterFailure?: boolean; // ex. commission d'enquête
  failureBoost?: number; // multiplicateur de poids si échec récent
  choices: EventChoice[];
}

export interface EventContext {
  recentFailure: boolean;
}

// Ponytail: cadence simple — la probabilité grimpe avec les vols sans événement,
// évitant à la fois le spam et les longues plages vides. Plafond à 60 %.
const CHANCE_PER_QUIET_LAUNCH = 0.12;
const CHANCE_CAP = 0.6;

export class EventSystem {
  private defs: EventDef[];
  private quietLaunches = 0;

  constructor(defs: EventDef[]) {
    this.defs = defs;
  }

  // Poids effectif d'un événement dans le contexte courant (0 = exclu)
  private weightOf(def: EventDef, ctx: EventContext): number {
    if (def.onlyAfterFailure && !ctx.recentFailure) return 0;
    return def.weight * (ctx.recentFailure ? (def.failureBoost ?? 1) : 1);
  }

  // À appeler après chaque vol. Retourne un événement ou null.
  maybeTrigger(ctx: EventContext, rng: () => number = Math.random): EventDef | null {
    this.quietLaunches++;
    const chance = Math.min(CHANCE_CAP, CHANCE_PER_QUIET_LAUNCH * this.quietLaunches);
    if (rng() >= chance) return null;

    const pool = this.defs.map((d) => [d, this.weightOf(d, ctx)] as const).filter(([, w]) => w > 0);
    const total = pool.reduce((s, [, w]) => s + w, 0);
    if (total === 0) return null;

    let r = rng() * total;
    for (const [def, w] of pool) {
      r -= w;
      if (r < 0) {
        this.quietLaunches = 0;
        return def;
      }
    }
    this.quietLaunches = 0;
    return pool[pool.length - 1][0]; // filet anti-arrondi
  }
}
