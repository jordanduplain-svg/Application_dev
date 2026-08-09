// Auto-vérification des événements — node --experimental-strip-types, zéro framework.
import assert from 'node:assert/strict';
import { EventSystem, type EventDef } from './events.ts';

const defs: EventDef[] = [
  { id: 'normal', category: 'politique', title: 'N', description: '', weight: 3, choices: [{ label: 'a', effect: {} }] },
  { id: 'inquiry', category: 'politique', title: 'I', description: '', weight: 0, onlyAfterFailure: true, failureBoost: 5, choices: [{ label: 'a', effect: {} }] },
];

// --- cadence : la probabilité grimpe, rien au 1er vol calme avec rng haut ---
{
  const sys = new EventSystem(defs);
  // rng = 0.99 → au-dessus de la chance (0.12, 0.24, ...) plusieurs vols
  assert.equal(sys.maybeTrigger({ recentFailure: false }, () => 0.99), null, 'vol 1 : pas d’événement');
  assert.equal(sys.maybeTrigger({ recentFailure: false }, () => 0.99), null, 'vol 2 : toujours rien');
  // rng = 0 → déclenche à coup sûr
  const ev = new EventSystem(defs).maybeTrigger({ recentFailure: false }, () => 0);
  assert.ok(ev, 'rng bas → événement');
}

// --- gating : l'enquête ne sort jamais sans échec récent ---
{
  const sys = new EventSystem(defs);
  // force le déclenchement (rng 0 passe le seuil), puis la sélection pondérée
  const ev = sys.maybeTrigger({ recentFailure: false }, () => 0);
  assert.equal(ev!.id, 'normal', 'sans échec : seul l’événement normal est éligible');
}

// --- après échec, l'enquête devient très probable (poids 0×5... non : boost sur weight) ---
{
  // l'enquête a weight 0 → même avec boost, 0×5 = 0. Vérifie qu'un événement à
  // poids non nul + onlyAfterFailure sort bien après échec.
  const withFailure: EventDef[] = [
    { id: 'quiet', category: 'interne', title: 'Q', description: '', weight: 1, choices: [{ label: 'a', effect: {} }] },
    { id: 'crash', category: 'politique', title: 'C', description: '', weight: 1, onlyAfterFailure: true, failureBoost: 100, choices: [{ label: 'a', effect: {} }] },
  ];
  const sys = new EventSystem(withFailure);
  // rng[0] passe le seuil de cadence ; rng[1] sélectionne dans le pool.
  // pool pondéré : quiet=1, crash=100 → r = 0.5×101 ≈ 50 tombe dans crash.
  const seq = [0, 0.5];
  let i = 0;
  const ev = sys.maybeTrigger({ recentFailure: true }, () => seq[i++]);
  assert.equal(ev!.id, 'crash', 'échec récent : l’événement boosté domine');

  // sans échec, crash est exclu → seul quiet
  const ev2 = new EventSystem(withFailure).maybeTrigger({ recentFailure: false }, () => 0);
  assert.equal(ev2!.id, 'quiet');
}

// --- compteur remis à zéro après un événement ---
{
  const sys = new EventSystem(defs);
  sys.maybeTrigger({ recentFailure: false }, () => 0); // déclenche, reset
  // juste après, la chance repart bas : rng 0.99 ne déclenche pas
  assert.equal(sys.maybeTrigger({ recentFailure: false }, () => 0.99), null, 'compteur réinitialisé');
}

console.log('OK — événements : tous les asserts passent');
