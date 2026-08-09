// Auto-vérification des contrats — node --experimental-strip-types, zéro framework.
import assert from 'node:assert/strict';
import { ContractBoard, type ContractDef } from './contracts.ts';

const defs: ContractDef[] = [
  { id: 'demo', client: 'Agence', type: 'etatique', title: 'Démo', reward: 500, penalty: 0, minRep: 0, minStages: 2 },
  { id: 'tele', client: 'TeleStar', type: 'prive', title: 'Télécom', reward: 1000, penalty: 300, minRep: 45, minStages: 2 },
  { id: 'sonde', client: 'Institut', type: 'etatique', title: 'Sonde', reward: 1300, penalty: 0, minRep: 0, minStages: 3 },
];

// --- filtres de disponibilité (GDD 6.2 / 7) ---
{
  const b = new ContractBoard(defs);
  const st = b.statuses(50, 0, 2);
  assert.equal(st.find((s) => s.def.id === 'demo')!.available, true);
  assert.equal(st.find((s) => s.def.id === 'tele')!.available, true, 'rep 50 ≥ 45');
  assert.equal(st.find((s) => s.def.id === 'sonde')!.available, false, '3 étages requis');
  assert.match(st.find((s) => s.def.id === 'sonde')!.reason!, /3\+ étages/);

  assert.equal(b.statuses(40, 0, 2).find((s) => s.def.id === 'tele')!.available, false, 'rep insuffisante');
}

// --- accepter / résoudre : succès, partiel, total (GDD 6.3) ---
{
  const b = new ContractBoard(defs);
  assert.equal(b.accept('sonde', 50, 0, 2), false, 'indisponible → refus');
  assert.equal(b.accept('demo', 50, 0, 2), true);
  assert.equal(b.accept('tele', 50, 0, 2), false, 'un seul contrat actif');
  assert.equal(b.statuses(50, 0, 2).find((s) => s.def.id === 'demo')!.reason, 'en cours');

  const s = b.resolve('succes', 1);
  assert.equal(s.payout, 500);
  assert.equal(s.repState, 4, 'étatique : bonus domestique');
  assert.equal(b.active, null, 'contrat réglé');

  // client servi : indisponible 2 vols après un succès (anti-farming)
  assert.equal(b.accept('demo', 50, 1, 2), false, 'commande honorée → attente');
  assert.match(b.statuses(50, 1, 2).find((x) => x.def.id === 'demo')!.reason!, /honorée/);
  assert.equal(b.accept('demo', 50, 3, 2), true, 'redevient disponible');
  assert.equal(b.resolve('echec-partiel', 4).payout, 250, 'partiel = moitié');

  b.accept('tele', 50, 4, 2);
  const total = b.resolve('echec-total', 5);
  assert.equal(total.payout, -300, 'clause de pénalité privée');
}

// --- blacklist temporaire (GDD 6.3) ---
{
  const b = new ContractBoard(defs);
  b.accept('tele', 50, 0, 2);
  b.resolve('echec-total', 1);
  const st = b.statuses(50, 1, 2);
  assert.equal(st.find((s) => s.def.id === 'tele')!.available, false, 'client blacklisté');
  assert.match(st.find((s) => s.def.id === 'tele')!.reason!, /refroidi/);
  assert.equal(b.statuses(50, 4, 2).find((s) => s.def.id === 'tele')!.available, true, 'levée après 3 vols');
  assert.equal(b.statuses(50, 1, 2).find((s) => s.def.id === 'demo')!.available, true, 'autre client intact');
}

// --- abandon ---
{
  const b = new ContractBoard(defs);
  b.accept('demo', 50, 0, 2);
  b.abandon();
  assert.equal(b.active, null);
  assert.equal(b.resolve('succes', 1).payout, 0, 'rien à régler sans contrat');
}

console.log('OK — contrats : tous les asserts passent');
