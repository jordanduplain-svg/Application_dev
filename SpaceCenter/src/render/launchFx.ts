import * as THREE from 'three';
import type { Outcome } from '../state/launch';

// Effet de lancement : une fusée procédurale décolle du pas de tir, réagit à
// l'issue du vol (montée propre, culbute, ou explosion). Relie physiquement la
// carte, les bâtiments et le lancement — le vol n'est plus un simple bouton.

interface Shot {
  group: THREE.Group;
  exhaust: THREE.Mesh;
  outcome: Outcome;
  t: number;
  vy: number;
  dead: boolean;
}

interface Blast {
  mesh: THREE.Mesh;
  t: number;
}

const IGNITION = 0.7; // s d'allumage avant décollage
const clampDt = (dt: number) => Math.min(dt, 0.05);

// Fusée en primitives : corps + coiffe + ailerons + tuyère émissive (captée par
// le bloom). Hauteur ~ nombre d'étages. Retourne le groupe et la tuyère animable.
function buildRocket(stages: number): { group: THREE.Group; exhaust: THREE.Mesh } {
  const g = new THREE.Group();
  const r = 1.1;
  const bodyH = 5 + stages * 2.6;
  const white = new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.4, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd94f3a, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, bodyH, 20), white);
  body.position.y = bodyH / 2;
  body.castShadow = true;
  g.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(r, r * 2.4, 20), accent);
  nose.position.y = bodyH + r * 1.2;
  g.add(nose);

  // anneaux de séparation entre étages (repères visuels)
  for (let i = 1; i < stages; i++) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.3, 20), accent);
    ring.position.y = (bodyH / stages) * i;
    g.add(ring);
  }

  // ailerons
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 1.4), accent);
    const a = (i / 3) * Math.PI * 2;
    fin.position.set(Math.cos(a) * r, 1, Math.sin(a) * r);
    fin.rotation.y = -a;
    g.add(fin);
  }

  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(r * 0.9, 3.5, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xffb347,
      emissive: 0xff7a1a,
      emissiveIntensity: 2.5,
      transparent: true,
      opacity: 0.9,
    }),
  );
  exhaust.rotation.x = Math.PI; // pointe vers le bas
  exhaust.position.y = -1.6;
  exhaust.scale.setScalar(0.01);
  g.add(exhaust);

  return { group: g, exhaust };
}

export class LaunchFx {
  private clock = new THREE.Clock();
  private shots: Shot[] = [];
  private blasts: Blast[] = [];

  constructor(private scene: THREE.Scene) {}

  play(pad: THREE.Vector3, outcome: Outcome, stages: number): void {
    const { group, exhaust } = buildRocket(stages);
    group.position.copy(pad);
    group.position.y += 0.4; // pose sur la plateforme
    this.scene.add(group);
    this.shots.push({ group, exhaust, outcome, t: 0, vy: 0, dead: false });
  }

  private explode(at: THREE.Vector3): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshStandardMaterial({
        color: 0xffd27a,
        emissive: 0xff5a1a,
        emissiveIntensity: 3,
        transparent: true,
        opacity: 1,
      }),
    );
    mesh.position.copy(at);
    this.scene.add(mesh);
    this.blasts.push({ mesh, t: 0 });
  }

  // appelée chaque frame par SceneRoot
  update(): void {
    const dt = clampDt(this.clock.getDelta());

    for (const s of this.shots) {
      s.t += dt;
      if (s.t < IGNITION) {
        // allumage : la tuyère grossit, léger tremblement
        const k = s.t / IGNITION;
        s.exhaust.scale.setScalar(0.01 + k);
        s.group.position.x += (Math.random() - 0.5) * 0.04;
        continue;
      }
      // décollage : accélération
      s.vy += 22 * dt;
      s.group.position.y += s.vy * dt;
      const flicker = 1 + Math.sin(s.t * 40) * 0.15;
      s.exhaust.scale.set(flicker, 1 + Math.min((s.t - IGNITION) * 0.5, 1.5), flicker);

      const climb = s.group.position.y;
      if (s.outcome === 'echec-total' && climb > 14) {
        this.explode(s.group.position.clone());
        s.dead = true;
      } else if (s.outcome === 'echec-partiel' && climb > 45) {
        // culbute et chute
        s.group.rotation.z += dt * 3;
        s.vy -= 40 * dt;
        if (climb < 5 || s.t > 6) s.dead = true;
      } else if (climb > 150 || s.t > 7) {
        s.dead = true; // succès : disparaît dans le ciel
      }
    }

    for (const s of this.shots) if (s.dead) this.scene.remove(s.group);
    this.shots = this.shots.filter((s) => !s.dead);

    for (const b of this.blasts) {
      b.t += dt;
      const k = b.t / 0.6;
      b.mesh.scale.setScalar(1 + k * 10);
      (b.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - k);
    }
    for (const b of this.blasts) if (b.t > 0.6) this.scene.remove(b.mesh);
    this.blasts = this.blasts.filter((b) => b.t <= 0.6);
  }
}
