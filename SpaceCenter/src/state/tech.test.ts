// Auto-vérification de l'arbre tech — node --experimental-strip-types, zéro framework.
import assert from 'node:assert/strict';
import { TechTree, applyTech, type TechConfig } from './tech.ts';
import type { RocketDesign } from './launch.ts';

const cfg: TechConfig = {
  branches: {
    propulsion: { name: 'Propulsion', tiers: [{ name: 'T1', cost: 100 }, { name: 'T2', cost: 250 }] },
    structures: { name: 'Structures', tiers: [{ name: 'T1', cost: 100 }] },
    avionique: { name: 'Avionique', tiers: [{ name: 'T1', cost: 100 }] },
  },
};

// --- recherche séquentielle et dépense de PR (GDD 3.2) ---
{
  const t = new TechTree(cfg);
  assert.equal(t.canResearch('propulsion'), false, 'pas de PR au départ');
  assert.equal(t.research('propulsion'), false);

  t.award(120);
  assert.equal(t.research('propulsion'), true);
  assert.equal(t.level('propulsion'), 1);
  assert.equal(t.rp, 20, 'PR débités');
  assert.equal(t.canResearch('propulsion'), false, 'palier 2 trop cher');
  assert.equal(t.nextTier('propulsion')!.name, 'T2', 'seul le palier suivant est proposé');

  t.award(250);
  t.research('propulsion');
  assert.equal(t.nextTier('propulsion'), null, 'branche épuisée');
  assert.equal(t.research('propulsion'), false);
}

// --- prérequis de design ---
{
  const t = new TechTree(cfg);
  assert.equal(t.meets(undefined), true, 'aucun prérequis');
  assert.equal(t.meets({ propulsion: 1, structures: 1 }), false);
  t.award(200);
  t.research('propulsion');
  t.research('structures');
  assert.equal(t.meets({ propulsion: 1, structures: 1 }), true);
}

// --- applyTech : −15 % de risque par palier, sans mutation ---
{
  const t = new TechTree(cfg);
  t.award(100);
  t.research('propulsion');
  const design: RocketDesign = {
    id: 'x',
    name: 'X',
    stages: [[{ name: 'moteur', reliability: 0.9, branch: 'propulsion' }, { name: 'autre', reliability: 0.9 }]],
  };
  const boosted = applyTech(design, t);
  assert.ok(Math.abs(boosted.stages[0][0].reliability - (1 - 0.1 * 0.85)) < 1e-9, 'risque ×0,85');
  assert.equal(boosted.stages[0][1].reliability, 0.9, 'composant sans branche inchangé');
  assert.equal(design.stages[0][0].reliability, 0.9, 'design source non muté');
  assert.equal(boosted.id, 'x', 'id conservé (maturité par design)');
}

// --- onChange notifie ---
{
  const t = new TechTree(cfg);
  let calls = 0;
  t.onChange = () => calls++;
  t.award(100);
  t.research('avionique');
  assert.equal(calls, 2, 'award + research notifient');
}

console.log('OK — arbre tech : tous les asserts passent');
