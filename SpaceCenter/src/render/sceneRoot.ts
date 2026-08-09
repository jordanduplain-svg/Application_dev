import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitCamera } from './orbitCamera';

// Dégradé vertical peint sur un canvas → texture de fond (ponytail: pas besoin
// d'une skybox complète pour un simple ciel).
function makeSkyGradient(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#0b1026'); // zénith
  g.addColorStop(0.6, '#1d1b3a');
  g.addColorStop(1, '#3a3352'); // horizon ambré-violet
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Couche rendu : renderer, scène, lumières, terrain, boucle.
// Ne connaît rien à la logique de jeu.
export class SceneRoot {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly orbit: OrbitCamera;
  private composer!: EffectComposer;

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // tone mapping filmique : sort la scène du rendu plat/terne (le vrai coupable
    // du look « brut »). Sans lui, les couleurs stylisées s'écrasent.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    parent.appendChild(this.renderer.domElement);

    this.orbit = new OrbitCamera(window.innerWidth / window.innerHeight, this.renderer.domElement);

    // ciel dégradé (indigo profond → horizon ambré) au lieu d'un fond plat
    this.scene.background = makeSkyGradient();
    this.scene.fog = new THREE.Fog(0x473f56, 260, 620);

    // environnement PBR : sans lui, les matériaux métalliques (glTF) rendent noir
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85; // les assets stylisés ressortent

    this.addLights();
    this.addTerrain();

    // bloom minimal (étape 6 du brief) : seuil haut, seuls les émissifs brillent
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.orbit.camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.4, 0.85),
    );
  }

  // Vérifié à chaque frame plutôt que sur l'événement resize : le conteneur
  // peut être dimensionné après le chargement sans émettre de resize.
  private fitViewport(): void {
    const { innerWidth: w, innerHeight: h } = window;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (w > 0 && h > 0 && (size.x !== w || size.y !== h)) {
      this.orbit.setAspect(w / h);
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
    }
  }

  private addLights(): void {
    // ciel bleu froid / sol chaud : donne du volume aux surfaces
    this.scene.add(new THREE.HemisphereLight(0x9db4e0, 0x3a2e28, 1.1));

    const sun = new THREE.DirectionalLight(0xffe6b8, 2.6); // soleil chaud, franc
    sun.position.set(80, 120, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    const s = 120;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    this.scene.add(sun);

    // contre-jour cyan pour détacher les silhouettes du fond
    const rim = new THREE.DirectionalLight(0x4fd1c5, 0.6);
    rim.position.set(-60, 40, -80);
    this.scene.add(rim);
  }

  private addTerrain(): void {
    // sol désertique chaud (sable-terre) qui accroche la lumière du soleil
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: 0x6a5648, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  start(onFrame?: () => void): void {
    this.renderer.setAnimationLoop(() => {
      this.fitViewport();
      this.orbit.update();
      onFrame?.();
      this.composer.render();
    });
  }
}
