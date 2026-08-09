// Auto-vérification du cœur systémique — node --experimental-strip-types, zéro framework.
import assert from 'node:assert/strict';
import { SpaceProgram, insurancePremium, insurancePayout, type RocketDesign } from './launch.ts';

const design: RocketDesign = {
  id: 'k1',
  name: 'Kestrel 1',
  stages: [
    [{ name: 'moteur', reliability: 0.95 }, { name: 'réservoir', reliability: 0.98 }],
    [{ name: 'avionique', reliability: 0.97 }],
  ],
};

// --- jauge décomposée (GDD 6.1) ---
{
  const p = new SpaceProgram();
  const b = p.reliability(design);
  assert.ok(Math.abs(b.components - 0.95 * 0.98 * 0.97) < 1e-9, 'produit des composants');
  assert.equal(b.interfaces, 0.97, '1 jonction pour 2 étages');
  assert.equal(b.maturity, 0.95, 'malus vol inaugural');
  assert.equal(b.margin, 1, 'marge standard neutre');
  assert.ok(Math.abs(b.total - b.components * b.interfaces * b.maturity * b.margin) < 1e-9);

  // presser < standard < roder
  assert.ok(p.reliability(design, 'presse').total < b.total, 'presser dégrade');
  assert.ok(p.reliability(design, 'rode').total > b.total, 'roder améliore');

  // mono-étage : aucune jonction
  const mono: RocketDesign = { id: 'm', name: 'Mono', stages: [design.stages[0]] };
  assert.equal(p.reliability(mono).interfaces, 1, 'pas de jonction en mono-étage');
}

// --- heritage design (GDD 6.1) ---
{
  const p = new SpaceProgram();
  for (let i = 0; i < 10; i++) p.launch(design, {}, () => 0); // roll 0 = succès garanti
  const b = p.reliability(design);
  assert.equal(b.maturity, 1 + 0.1, 'bonus heritage plafonné à +10 %');
  assert.ok(b.total <= 0.99, 'fiabilité plafonnée à 0,99');
}

// --- résolution de lancement et réputation (GDD 6.2/6.3) ---
{
  const p = new SpaceProgram();
  const ok = p.launch(design, {}, () => 0);
  assert.equal(ok.outcome, 'succes');
  assert.equal(p.repState, 51, 'succès public : +1 étatique');
  assert.equal(p.repCommercial, 52, 'succès public : +2 commercial');

  const justAbove = p.reliability(design).total + 0.01; // juste au-dessus du seuil → échec partiel
  const partial = p.launch(design, {}, () => justAbove);
  assert.equal(partial.outcome, 'echec-partiel');

  const total = p.launch(design, {}, () => 0.999);
  assert.equal(total.outcome, 'echec-total');

  // journal des échecs (GDD 6.3)
  assert.equal(p.failures.length, 2);
  assert.equal(p.failures[0].designName, 'Kestrel 1');
  assert.ok(p.failures[0].cause.length > 0, 'cause identifiée');
  assert.equal(p.failures[1].flightNumber, 3, 'numéro de vol global');
}

// --- publicité : un échec discret pèse peu (GDD 6.2) ---
{
  const pub = new SpaceProgram();
  const disc = new SpaceProgram();
  pub.launch(design, { publicity: 'public' }, () => 0.999);
  disc.launch(design, { publicity: 'discret' }, () => 0.999);
  assert.equal(pub.repCommercial, 35, 'échec total public : -15');
  assert.equal(disc.repCommercial, 46.25, 'échec total discret : -15 × 0,25');
}

// --- clamp réputation ---
{
  const p = new SpaceProgram();
  for (let i = 0; i < 20; i++) p.launch(design, {}, () => 0.999);
  assert.equal(p.repState, 0);
  assert.equal(p.repCommercial, 0);
}

// --- modificateur de fiabilité transitoire (événements GDD 5) ---
{
  const p = new SpaceProgram();
  const base = p.reliability(design).total;
  p.applyReliabilityMod(0.9, 2);
  assert.ok(Math.abs(p.reliability(design).total - base * 0.9) < 1e-9, '−10 % appliqué');
  assert.equal(p.reliabilityModifier, 0.9);
  // vols échoués (rng haut) : consomment le modificateur sans gagner d'heritage
  p.launch(design, {}, () => 0.999);
  p.launch(design, {}, () => 0.999);
  assert.equal(p.reliabilityModifier, 1, 'modificateur expiré après 2 vols');
  assert.ok(Math.abs(p.reliability(design).total - base) < 1e-9, 'fiabilité revenue à la normale');
}

// --- assurance (GDD 6.2) : prime croît quand la confiance baisse ---
{
  assert.equal(insurancePremium(1000, 100), 150, 'confiance max : 15 %');
  assert.equal(insurancePremium(1000, 0), 500, 'confiance nulle : 50 %');
  assert.ok(insurancePremium(1000, 50) > insurancePremium(1000, 80), 'prime décroissante');
  assert.equal(insurancePayout(1000, 'echec-total'), 1000, 'échec total remboursé plein');
  assert.equal(insurancePayout(1000, 'echec-partiel'), 500, 'partiel remboursé moitié');
  assert.equal(insurancePayout(1000, 'succes'), 0, 'succès : rien à rembourser');
}

console.log('OK — cœur systémique : tous les asserts passent');
