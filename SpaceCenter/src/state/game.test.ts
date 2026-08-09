// Auto-vérification de l'état — `npm test` (node --experimental-strip-types).
import assert from 'node:assert/strict';
import { GameState, type GameConfig } from './game.ts';

const cfg: GameConfig = {
  grid: {
    cellSize: 4,
    worldParcels: 4,
    parcelCells: 2,
    startParcels: [[1, 1]],
    parcelBasePrice: 100,
    parcelPriceMultiplier: 1.4,
  },
  startBudget: 500,
  buildings: [
    { id: 'hut', name: 'Hut', footprint: [2, 1], cost: 150, model: null, color: '#fff', height: 1 },
  ],
};

// monde 8×8 cases ; parcelle possédée (1,1) = cases x∈[2,3], y∈[2,3]
const g = new GameState(cfg);
const budgets: number[] = [];
g.on('budget', (b) => budgets.push(b));

assert.equal(g.place('hut', 2, 2), true, 'placement sur cases possédées et libres');
assert.equal(g.budget, 350, 'coût déduit');
assert.equal(g.place('hut', 3, 2), false, 'refus : chevauchement + case hors parcelle');
assert.equal(g.place('hut', 2, 3), true, 'seconde rangée libre');
assert.equal(g.place('hut', 0, 0), false, 'refus : parcelle non possédée');
assert.equal(g.buildings.length, 2);

// prix des parcelles : ×1,4 à chaque achat (GDD 12.1)
assert.equal(g.parcelPrice(), 100, 'premier achat = prix de base');
assert.equal(g.buyParcel(3, 3), false, 'refus : non adjacente à la zone possédée');
assert.equal(g.buyParcel(-1, 0), false, 'refus : hors monde');
assert.equal(g.buyParcel(2, 1), true, 'achat parcelle adjacente');
assert.equal(g.budget, 100);
assert.equal(g.parcelPrice(), 140, 'second achat = ×1,4');
assert.equal(g.buyParcel(3, 1), false, 'refus : 140 > budget 100');
assert.equal(g.buyParcel(1, 1), false, 'refus : déjà possédée');
assert.equal(g.buyParcel(0, 1), false, 'refus : adjacente mais 140 > budget 100');
assert.equal(g.budget, 100, 'budget intact après tentative trop chère');

// statut par case du fantôme : (3,3) occupée → rouge, (4,3) sur la parcelle achetée → vert
const check = g.placementCheck('hut', 3, 3);
assert.equal(check.ok, false);
assert.deepEqual(check.cells.map((c) => c.ok), [false, true]);

// rotation : hut 2×1 pivoté (rot=1) occupe 1×2
const rotated = g.placementCheck('hut', 4, 2, 1);
assert.deepEqual(rotated.cells.map((c) => [c.x, c.y]), [[4, 2], [4, 3]], 'empreinte pivotée verticale');
assert.equal(rotated.ok, true, 'placement pivoté valide sur la parcelle achetée');
assert.equal(rotated.affordable, false, 'coût 150 > budget 100');

assert.equal(g.place('hut', 4, 2), false, 'refus : coût 150 > budget 100');
assert.deepEqual(budgets, [350, 200, 100], 'événements budget émis');

console.log('OK — état du jeu : tous les asserts passent');
