import * as THREE from 'three';

// Caméra orbitale custom : clic gauche = rotation, clic droit = pan, molette = zoom.
// Amortissement léger pour la sensation ; les valeurs cibles sont modifiées par
// les événements, update() interpole vers elles à chaque frame.
const MIN_PHI = 0.15; // évite le zénith exact
const MAX_PHI = 1.45; // évite de passer sous le sol
const MIN_DIST = 12;
const MAX_DIST = 220;
const ROTATE_SPEED = 0.005;
const ZOOM_FACTOR = 1.1;
const DAMPING = 0.15; // ponytail: lerp fixe par frame, suffisant à 60fps ; passer en dt-based si framerate variable

export class OrbitCamera {
  readonly camera: THREE.PerspectiveCamera;

  private target = new THREE.Vector3(0, 0, 0);
  private theta = Math.PI / 4;
  private phi = 1.0;
  private distance = 90;

  // valeurs affichées (amorties)
  private curTheta = this.theta;
  private curPhi = this.phi;
  private curDistance = this.distance;
  private curTarget = this.target.clone();

  private dragButton: number | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor(aspect: number, dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0 || e.button === 2) {
        this.dragButton = e.button;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener('pointerup', () => (this.dragButton = null));
    dom.addEventListener('pointermove', (e) => {
      if (this.dragButton === null) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.dragButton === 0) this.rotate(dx, dy);
      else this.pan(dx, dy);
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const f = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        this.distance = THREE.MathUtils.clamp(this.distance * f, MIN_DIST, MAX_DIST);
      },
      { passive: false },
    );
  }

  private rotate(dx: number, dy: number): void {
    this.theta -= dx * ROTATE_SPEED;
    this.phi = THREE.MathUtils.clamp(this.phi - dy * ROTATE_SPEED, MIN_PHI, MAX_PHI);
  }

  private pan(dx: number, dy: number): void {
    // déplacement dans le plan du sol, relatif à l'orientation caméra
    const scale = this.distance * 0.0016;
    const forward = new THREE.Vector3(-Math.sin(this.theta), 0, -Math.cos(this.theta));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    this.target.addScaledVector(right, -dx * scale);
    this.target.addScaledVector(forward, dy * scale);
  }

  update(): void {
    this.curTheta += (this.theta - this.curTheta) * DAMPING;
    this.curPhi += (this.phi - this.curPhi) * DAMPING;
    this.curDistance += (this.distance - this.curDistance) * DAMPING;
    this.curTarget.lerp(this.target, DAMPING);

    const sinPhi = Math.sin(this.curPhi);
    this.camera.position.set(
      this.curTarget.x + this.curDistance * sinPhi * Math.sin(this.curTheta),
      this.curTarget.y + this.curDistance * Math.cos(this.curPhi),
      this.curTarget.z + this.curDistance * sinPhi * Math.cos(this.curTheta),
    );
    this.camera.lookAt(this.curTarget);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
