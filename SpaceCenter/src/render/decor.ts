import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Décor de scène (kit Environment Quaternius) : encercle le monde jouable d'un
// paysage et pose des planètes dans le ciel. Purement visuel, hors grille — le
// raycaster du pont ne touche que le plan mathématique, jamais ces objets.
// Dispersion déterministe (graine fixe) pour un rendu stable entre sessions.

const BASE = '/models/env/';

// nom → [taille cible min, max] en unités monde (normalisée sur la boîte englobante)
const SMALL: Record<string, [number, number]> = {
  Grass_1: [3, 5], Grass_2: [3, 5], Grass_3: [3, 5],
  Bush_1: [3, 6], Bush_2: [3, 6], Bush_3: [3, 6],
  Plant_1: [4, 7], Plant_2: [4, 7], Plant_3: [4, 7],
  Rock_1: [4, 8], Rock_2: [4, 8], Rock_3: [4, 8], Rock_4: [4, 8],
  Tree_Spikes_1: [9, 15], Tree_Spikes_2: [9, 15],
  Tree_Blob_1: [8, 14], Tree_Blob_2: [8, 14], Tree_Blob_3: [8, 14],
};
const BIG: Record<string, [number, number]> = {
  Rock_Large_1: [16, 28], Rock_Large_2: [16, 28], Rock_Large_3: [16, 28],
};
const PLANETS = ['Planet_3', 'Planet_6', 'Planet_2', 'Planet_9'];

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

export class Decor {
  private loader = new GLTFLoader();
  private cache = new Map<string, Promise<THREE.Group>>();
  private rng = mulberry32(20260711);

  constructor(private scene: THREE.Scene) {
    this.scatterGround();
    this.addPlanets();
  }

  private load(name: string): Promise<THREE.Group> {
    let p = this.cache.get(name);
    if (!p) {
      p = this.loader.loadAsync(`${BASE}${name}.gltf`).then((g) => g.scene);
      this.cache.set(name, p);
    }
    return p;
  }

  // pose une instance normalisée à une taille cible, au sol (ombre portée)
  private place(name: string, x: number, z: number, target: number, castShadow: boolean, y = 0): void {
    void this.load(name).then((src) => {
      const model = src.clone(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const s = target / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(s);
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(x - center.x * s, y - box.min.y * s, z - center.z * s);
      model.rotation.y = this.rng() * Math.PI * 2;
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = castShadow;
          o.receiveShadow = true;
        }
      });
      this.scene.add(model);
    });
  }

  // anneau de paysage dense hors du monde 36×36 (demi-étendue 72 u) : hugge le
  // bord de la zone constructible puis s'estompe au loin
  private scatterGround(): void {
    const smallNames = Object.keys(SMALL);
    for (let i = 0; i < 220; i++) {
      const ang = this.rng() * Math.PI * 2;
      // densité décroissante avec la distance (√ pousse vers l'intérieur)
      const r = 76 + Math.sqrt(this.rng()) * 150; // 76..226, dense près du bord
      const name = pick(smallNames, this.rng);
      const [lo, hi] = SMALL[name];
      this.place(name, Math.cos(ang) * r, Math.sin(ang) * r, lo + this.rng() * (hi - lo), true);
    }
    const bigNames = Object.keys(BIG);
    for (let i = 0; i < 24; i++) {
      const ang = this.rng() * Math.PI * 2;
      const r = 95 + this.rng() * 120;
      const name = pick(bigNames, this.rng);
      const [lo, hi] = BIG[name];
      this.place(name, Math.cos(ang) * r, Math.sin(ang) * r, lo + this.rng() * (hi - lo), true);
    }
  }

  // planètes lointaines dans le ciel — décor spatial, pas d'ombre
  private addPlanets(): void {
    // réparties autour de la scène pour rester visibles sous tout angle de caméra
    const spots: [number, number, number, number][] = [
      // [x, y, z, diamètre]
      [-300, 130, -340, 100], // NO
      [340, 100, -260, 55], // NE
      [280, 150, 320, 120], // SE
      [-360, 110, 300, 70], // SO
    ];
    spots.forEach(([x, y, z, d], i) => this.place(PLANETS[i % PLANETS.length], x, z, d, false, y));
  }
}
