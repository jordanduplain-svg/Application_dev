// Assemblage de fusées (GDD 2/3) — le joueur compose un design à partir de
// composants débloqués par l'arbre tech. État pur. Le design produit alimente
// le panneau de lancement comme les presets de rockets.json.

import type { ComponentSpec } from './launch';
import type { BranchId, TechTree } from './tech';
import type { RocketDef } from '../ui/launchPanel';

export type Role = 'engine' | 'tank' | 'avionics' | 'fairing';

export interface ComponentDef {
  id: string;
  name: string;
  role: Role;
  branch: BranchId;
  tier: number; // palier de branche requis (0 = dès le départ)
  reliability: number;
  cost: number;
}

const STAGE_FEE = 60; // main d'œuvre d'intégration par étage

// Composants débloqués : le palier de la branche doit atteindre leur tier
export function available(catalog: ComponentDef[], tree: TechTree): ComponentDef[] {
  return catalog.filter((c) => tree.level(c.branch) >= c.tier);
}

export interface StagePick {
  engineId: string;
  tankId: string;
}

export interface AssemblyPick {
  name: string;
  stages: StagePick[]; // 1..3
  avionicsId: string; // sur l'étage supérieur
  fairingId: string | null; // optionnel
}

// Construit un RocketDef à partir des choix. Lance si un composant est inconnu.
// L'avionique et la coiffe sont intégrées à l'étage supérieur (pas d'étage
// dédié → moins de jonctions, cohérent physiquement).
export function buildDesign(pick: AssemblyPick, catalog: ComponentDef[]): RocketDef {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const get = (id: string): ComponentDef => {
    const c = byId.get(id);
    if (!c) throw new Error(`Composant inconnu : ${id}`);
    return c;
  };
  const spec = (c: ComponentDef): ComponentSpec => ({ name: c.name, reliability: c.reliability, branch: c.branch });

  let cost = STAGE_FEE * pick.stages.length;
  const stages: ComponentSpec[][] = pick.stages.map(({ engineId, tankId }) => {
    const engine = get(engineId);
    const tank = get(tankId);
    cost += engine.cost + tank.cost;
    return [spec(engine), spec(tank)];
  });

  const top = stages[stages.length - 1];
  const avi = get(pick.avionicsId);
  cost += avi.cost;
  top.push(spec(avi));
  if (pick.fairingId) {
    const fair = get(pick.fairingId);
    cost += fair.cost;
    top.push(spec(fair));
  }

  // id déterministe : deux fusées identiques partagent l'heritage (GDD 6.1)
  const id =
    'custom:' +
    pick.stages.map((s) => `${s.engineId}+${s.tankId}`).join('|') +
    `/${pick.avionicsId}${pick.fairingId ? '+' + pick.fairingId : ''}`;

  return { id, name: pick.name || 'Fusée sans nom', cost, stages };
}
