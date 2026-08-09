// Contrats (GDD section 7) — tableau de missions, pur TS.
// MVP : offres répétables depuis contracts.json, filtrées par confiance
// commerciale (GDD 6.2), taille de fusée et blacklist temporaire (GDD 6.3).
// Le financement étatique fixe et la concurrence IA attendent un système de temps.

import type { Outcome } from './launch';

export type ContractType = 'etatique' | 'prive';

export interface ContractDef {
  id: string;
  client: string;
  type: ContractType;
  title: string;
  reward: number;
  penalty: number; // clause privée : due en cas d'échec total (GDD 7)
  minRep: number; // confiance commerciale minimale (GDD 6.2 : contrats premium)
  minStages: number; // taille de fusée requise
  repeatable?: boolean; // GDD 6.2 : mission de démonstration, toujours proposée (sauf blacklist)
}

export interface ContractStatus {
  def: ContractDef;
  available: boolean;
  reason: string | null; // pourquoi indisponible ('' si disponible)
}

// GDD 6.3 : blacklist temporaire après échec total, en nombre de vols
const BLACKLIST_FLIGHTS = 3;
// ponytail: anti-farming — un client servi ne recommande pas immédiatement ;
// approxime le flux de commandes du GDD 7 sans système de temps
const SATISFIED_FLIGHTS = 2;
// GDD 7 : les missions étatiques rapportent surtout de la réputation domestique
const REP_BONUS: Record<ContractType, { state: number; commercial: number }> = {
  etatique: { state: 4, commercial: 0 },
  prive: { state: 0, commercial: 2 },
};

export interface Settlement {
  payout: number; // net (pénalité déduite, peut être négatif)
  repState: number; // bonus de réputation si succès
  repCommercial: number;
}

export class ContractBoard {
  active: ContractDef | null = null;
  onChange: () => void = () => {};
  private defs: ContractDef[];
  // client → indisponible jusqu'au vol n° (blacklist après échec, ou commande honorée)
  private cooldown = new Map<string, { until: number; why: string }>();

  constructor(defs: ContractDef[]) {
    this.defs = defs;
  }

  statuses(repCommercial: number, currentFlight: number, stages: number): ContractStatus[] {
    return this.defs.map((def) => {
      const cd = this.cooldown.get(def.client);
      // un répétable ignore la satisfaction client, mais pas la blacklist
      const blocked = cd && currentFlight < cd.until && (!def.repeatable || cd.why === 'client refroidi');
      const reason =
        this.active?.id === def.id
          ? 'en cours'
          : blocked
            ? `${cd.why} (encore ${cd.until - currentFlight} vol${cd.until - currentFlight > 1 ? 's' : ''})`
            : repCommercial < def.minRep
              ? `confiance ${def.minRep} requise`
              : stages < def.minStages
                ? `fusée ${def.minStages}+ étages requise`
                : null;
      return { def, available: reason === null, reason };
    });
  }

  accept(id: string, repCommercial: number, currentFlight: number, stages: number): boolean {
    const s = this.statuses(repCommercial, currentFlight, stages).find((x) => x.def.id === id);
    if (!s?.available || this.active) return false;
    this.active = s.def;
    this.onChange();
    return true;
  }

  abandon(): void {
    this.active = null;
    this.onChange();
  }

  // Règle le contrat actif après un vol (GDD 6.3 : succès plein, partiel = moitié,
  // total = pénalité + blacklist du client).
  resolve(outcome: Outcome, flightNumber: number): Settlement {
    const c = this.active;
    if (!c) return { payout: 0, repState: 0, repCommercial: 0 };
    this.active = null;
    this.onChange();
    if (outcome === 'succes') {
      if (!c.repeatable)
        this.cooldown.set(c.client, { until: flightNumber + SATISFIED_FLIGHTS, why: 'commande honorée' });
      return { payout: c.reward, repState: REP_BONUS[c.type].state, repCommercial: REP_BONUS[c.type].commercial };
    }
    if (outcome === 'echec-partiel')
      return { payout: Math.round(c.reward / 2), repState: 0, repCommercial: 0 };
    this.cooldown.set(c.client, { until: flightNumber + BLACKLIST_FLIGHTS, why: 'client refroidi' });
    return { payout: -c.penalty, repState: 0, repCommercial: 0 };
  }
}
