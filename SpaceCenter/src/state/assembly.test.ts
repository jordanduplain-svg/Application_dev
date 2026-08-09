// Auto-vérification de l'assemblage — node --experimental-strip-types, zéro framework.
import assert from 'node:assert/strict';
import { available, buildDesign, type AssemblyPick, type ComponentDef } from './assembly.ts';
import { TechTree, type TechConfig } from './tech.ts';

const catalog: ComponentDef[] = [
  { id: 'eng0', name: 'E0', role: 'engine', branch: 'propulsion', tier: 0, reliability: 0.95, cost: 120 },
  { id: 'eng1', name: 'E1', role: 'engine', branch: 'propulsion', tier: 1, reliability: 0.97, cost: 190 },
  { id: 'tank0', name: 'T0', role: 'tank', branch: 'structures', tier: 0, reliability: 0.98, cost: 80 },
  { id: 'avi0', name: 'A0', role: 'avionics', branch: 'avionique', tier: 0, reliability: 0.96, cost: 90 },
  { id: 'fair_std', name: 'F', role: 'fairing', branch: 'structures', tier: 0, reliability: 0.98, cost: 70 },
];

const cfg: TechConfig = {
  branches: {
    propulsion: { name: 'P', tiers: [{ name: 'T1', cost: 100 }] },
    structures: { name: 'S', tiers: [{ name: 'T1', cost: 100 }] },
    avionique: { name: 'A', tiers: [{ name: 'T1', cost: 100 }] },
  },
};

// --- disponibilité gated par le palier de branche ---
{
  const tree = new TechTree(cfg);
  const av0 = available(catalog, tree);
  assert.ok(!av0.some((c) => c.id === 'eng1'), 'eng1 (tier 1) verrouillé au départ');
  assert.ok(av0.some((c) => c.id === 'eng0'), 'eng0 (tier 0) disponible');
  tree.award(100);
  tree.research('propulsion');
  assert.ok(available(catalog, tree).some((c) => c.id === 'eng1'), 'eng1 débloqué après recherche');
}

// --- coût et structure d'un design 2 étages avec coiffe ---
{
  const pick: AssemblyPick = {
    name: 'Faucon',
    stages: [
      { engineId: 'eng0', tankId: 'tank0' },
      { engineId: 'eng0', tankId: 'tank0' },
    ],
    avionicsId: 'avi0',
    fairingId: 'fair_std',
  };
  const d = buildDesign(pick, catalog);
  // 2×(120+80) + 60×2 étages + 90 avionique + 70 coiffe = 400 + 120 + 160 = 680
  assert.equal(d.cost, 680, 'coût = composants + frais d’intégration');
  assert.equal(d.stages.length, 2);
  assert.equal(d.stages[0].length, 2, 'étage bas : moteur + réservoir');
  assert.equal(d.stages[1].length, 4, 'étage haut : moteur + réservoir + avionique + coiffe');
  assert.equal(d.name, 'Faucon');
  // composants tagués par branche pour applyTech
  assert.equal(d.stages[0][0].branch, 'propulsion');
}

// --- id déterministe (heritage partagé) ---
{
  const pick: AssemblyPick = { name: 'A', stages: [{ engineId: 'eng0', tankId: 'tank0' }], avionicsId: 'avi0', fairingId: null };
  const pick2: AssemblyPick = { name: 'Autre nom', stages: [{ engineId: 'eng0', tankId: 'tank0' }], avionicsId: 'avi0', fairingId: null };
  assert.equal(buildDesign(pick, catalog).id, buildDesign(pick2, catalog).id, 'même composition → même id');
  const diff: AssemblyPick = { ...pick, fairingId: 'fair_std' };
  assert.notEqual(buildDesign(pick, catalog).id, buildDesign(diff, catalog).id, 'coiffe change l’id');
}

// --- composant inconnu → erreur ---
{
  const bad: AssemblyPick = { name: 'X', stages: [{ engineId: 'nope', tankId: 'tank0' }], avionicsId: 'avi0', fairingId: null };
  assert.throws(() => buildDesign(bad, catalog), /inconnu/);
}

console.log('OK — assemblage : tous les asserts passent');
