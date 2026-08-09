// Auto-vérification des effets de bâtiments — node --experimental-strip-types.
import assert from 'node:assert/strict';
import { facilities, applyFacilities } from './facilities.ts';
import type { RocketDesign } from './launch.ts';

// --- aucun bâtiment : tout neutre, aucun pas de tir ---
{
  const f = facilities([]);
  assert.equal(f.costFactor, 1);
  assert.equal(f.reliabilityMult, 1);
  assert.equal(f.padCapacity, 0, 'sans pad, rien ne peut voler');
  assert.equal(f.rpFactor, 1);
  assert.deepEqual(f.branchRisk, { propulsion: 1, structures: 1, avionique: 1 });
}

// --- entrepôts : coût décroissant, plancher ---
{
  assert.ok(Math.abs(facilities(['warehouse']).costFactor - 0.94) < 1e-9);
  assert.ok(Math.abs(facilities(['warehouse', 'warehouse']).costFactor - 0.94 ** 2) < 1e-9);
  const many = facilities(Array(20).fill('warehouse'));
  assert.equal(many.costFactor, 0.7, 'plancher de coût');
}

// --- pas de tir : capacité = le plus grand présent ---
{
  assert.equal(facilities(['pad_small']).padCapacity, 2);
  assert.equal(facilities(['pad_small', 'pad_medium']).padCapacity, 3);
  assert.equal(facilities(['pad_heavy', 'pad_small']).padCapacity, 5);
}

// --- usines : risque réduit sur la bonne branche uniquement ---
{
  const f = facilities(['factory_prop']);
  assert.ok(Math.abs(f.branchRisk.propulsion - 0.85) < 1e-9, 'propulsion −15 %');
  assert.equal(f.branchRisk.structures, 1, 'autres branches intactes');
  assert.ok(Math.abs(facilities(['factory_prop', 'factory_prop']).branchRisk.propulsion - 0.85 ** 2) < 1e-9);
}

// --- formation + contrôle : fiabilité globale, plafonnée ---
{
  assert.ok(Math.abs(facilities(['training']).reliabilityMult - 1.02) < 1e-9);
  assert.ok(Math.abs(facilities(['control']).reliabilityMult - 1.03) < 1e-9);
  assert.ok(Math.abs(facilities(['training', 'control']).reliabilityMult - 1.02 * 1.03) < 1e-9);
  assert.equal(facilities(Array(20).fill('control')).reliabilityMult, 1.12, 'plafond de fiabilité');
}

// --- labos : facteur PR ---
{
  assert.equal(facilities(['lab']).rpFactor, 1.5);
  assert.equal(facilities(['lab', 'lab']).rpFactor, 2);
}

// --- applyFacilities : réduit le risque des composants de la branche, sans muter ---
{
  const f = facilities(['factory_prop']);
  const design: RocketDesign = {
    id: 'x',
    name: 'X',
    stages: [[{ name: 'm', reliability: 0.9, branch: 'propulsion' }, { name: 't', reliability: 0.9, branch: 'structures' }]],
  };
  const tuned = applyFacilities(design, f);
  assert.ok(Math.abs(tuned.stages[0][0].reliability - (1 - 0.1 * 0.85)) < 1e-9, 'propulsion boostée');
  assert.equal(tuned.stages[0][1].reliability, 0.9, 'structures inchangées (pas d’usine)');
  assert.equal(design.stages[0][0].reliability, 0.9, 'design source non muté');
}

console.log('OK — effets de bâtiments : tous les asserts passent');
