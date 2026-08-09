import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rotatedFootprint, type BuildingDef, type GameState, type PlacedBuilding } from '../state/game';

// Pont état → scène, sens unique : écoute les événements de l'état et
// reflète dans Three.js. Gère aussi le picking souris (fantôme, achat de
// parcelle) en émettant des COMMANDES vers l'état, jamais l'inverse.

export interface ParcelHoverInfo {
  px: number;
  py: number;
  price: number;
  affordable: boolean;
  adjacent: boolean; // GDD 12.1 : achat possible uniquement en zone adjacente
  clientX: number;
  clientY: number;
}

const OWNED_COLOR = 0x8a7c6e; // dalle béton claire : terrain viabilisé
const UNOWNED_COLOR = 0x5c4c40; // terre nue, accordée au sol
const HOVER_COLOR = 0x3f6f66; // surbrillance teal à l'achat
const OK_COLOR = 0x4caf50;
const BAD_COLOR = 0xe53935;
const CLICK_TOLERANCE_PX = 5; // en dessous : clic ; au-dessus : drag caméra
const BASE_HEIGHT = 0.41; // hauteur plateforme + liseré, le bâtiment se pose dessus

export class SceneBridge {
  onParcelHover: (info: ParcelHoverInfo | null) => void = () => {};

  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tiles = new Map<string, THREE.Mesh>();
  private hoveredParcel: { px: number; py: number } | null = null;

  private placingType: string | null = null;
  private placingRot = 0;
  private ghost = new THREE.Group();
  private ghostCells: THREE.Mesh[] = [];
  private ghostVolume: THREE.Mesh | null = null;
  private ghostOrigin: { x: number; y: number } | null = null;
  private lastHoverCell: { x: number; y: number } | null = null;

  private downPos: { x: number; y: number } | null = null;
  private cell: number;
  private worldCells: number;

  private gltfLoader = new GLTFLoader();
  private modelCache = new Map<string, Promise<THREE.Group>>();

  constructor(
    private state: GameState,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private dom: HTMLElement,
  ) {
    this.cell = state.cfg.grid.cellSize;
    this.worldCells = state.worldCells;

    this.buildParcelTiles();
    this.addGridLines();
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    state.on('placed', (b) => this.addBuildingMesh(b));
    state.on('parcelBought', ({ px, py }) => this.paintTile(px, py));

    dom.addEventListener('pointermove', (e) => this.onPointerMove(e));
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.downPos = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', (e) => this.onPointerUp(e));
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'r' || e.key === 'R') && this.placingType) {
        this.placingRot = (this.placingRot + 1) % 4;
        if (this.lastHoverCell) this.updateGhost(this.lastHoverCell.x, this.lastHoverCell.y);
      }
    });

    // préchauffe le cache des modèles
    for (const def of state.cfg.buildings) if (def.model) void this.loadModel(def.model);
  }

  // --- API (appelée par main sur commande de l'UI) ---

  setPlacementType(typeId: string | null): void {
    this.placingType = typeId;
    this.placingRot = 0;
    this.ghost.visible = false;
    this.ghostOrigin = null;
    this.setHoveredParcel(null, null);
    this.ghost.clear();
    this.ghostCells = [];
    this.ghostVolume = null;
    if (!typeId) return;

    const def = this.state.buildingDef(typeId);
    const [w, h] = def.footprint;
    for (let i = 0; i < w * h; i++) {
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(this.cell - 0.3, this.cell - 0.3),
        new THREE.MeshBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.45 }),
      );
      quad.rotation.x = -Math.PI / 2;
      quad.position.y = 0.05;
      this.ghostCells.push(quad);
      this.ghost.add(quad);
    }
    this.ghostVolume = new THREE.Mesh(
      new THREE.BoxGeometry(w * this.cell - 0.8, def.height, h * this.cell - 0.8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color), transparent: true, opacity: 0.3 }),
    );
    this.ghost.add(this.ghostVolume);
  }

  // --- conversions grille ---

  private cellCorner(c: number): number {
    return (c - this.worldCells / 2) * this.cell;
  }

  private cellFromEvent(e: PointerEvent): { x: number; y: number } | null {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return {
      x: Math.floor(hit.x / this.cell + this.worldCells / 2),
      y: Math.floor(hit.z / this.cell + this.worldCells / 2),
    };
  }

  // --- interactions ---

  private onPointerMove(e: PointerEvent): void {
    const cell = this.cellFromEvent(e);
    if (!cell) return;
    this.lastHoverCell = cell;
    if (this.placingType) this.updateGhost(cell.x, cell.y);
    else this.updateParcelHover(cell.x, cell.y, e);
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || !this.downPos) return;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    this.downPos = null;
    if (moved > CLICK_TOLERANCE_PX) return; // c'était une rotation caméra

    if (this.placingType && this.ghostOrigin) {
      this.state.place(this.placingType, this.ghostOrigin.x, this.ghostOrigin.y, this.placingRot);
      const cell = this.cellFromEvent(e);
      if (cell) this.updateGhost(cell.x, cell.y); // re-colore après occupation
    } else if (this.hoveredParcel) {
      const { px, py } = this.hoveredParcel;
      if (this.state.buyParcel(px, py)) this.setHoveredParcel(null, null);
    }
  }

  private updateGhost(hoverX: number, hoverY: number): void {
    const def = this.state.buildingDef(this.placingType!);
    const [w, h] = rotatedFootprint(def, this.placingRot);
    const ox = hoverX - Math.floor((w - 1) / 2);
    const oy = hoverY - Math.floor((h - 1) / 2);
    this.ghostOrigin = { x: ox, y: oy };
    this.ghost.position.set(this.cellCorner(ox), 0, this.cellCorner(oy));
    this.ghost.visible = true;
    if (this.ghostVolume) {
      this.ghostVolume.rotation.y = (this.placingRot * Math.PI) / 2;
      this.ghostVolume.position.set((w * this.cell) / 2, def.height / 2 + 0.05, (h * this.cell) / 2);
    }

    const check = this.state.placementCheck(this.placingType!, ox, oy, this.placingRot);
    check.cells.forEach((c, i) => {
      const quad = this.ghostCells[i];
      quad.position.x = (c.x - ox) * this.cell + this.cell / 2;
      quad.position.z = (c.y - oy) * this.cell + this.cell / 2;
      (quad.material as THREE.MeshBasicMaterial).color.setHex(
        c.ok && check.affordable ? OK_COLOR : BAD_COLOR,
      );
    });
  }

  private updateParcelHover(cellX: number, cellY: number, e: PointerEvent): void {
    const inWorld = cellX >= 0 && cellY >= 0 && cellX < this.worldCells && cellY < this.worldCells;
    if (!inWorld) return this.setHoveredParcel(null, null);
    const { px, py } = this.state.parcelOf(cellX, cellY);
    if (this.state.isParcelOwned(px, py)) return this.setHoveredParcel(null, null);
    this.setHoveredParcel({ px, py }, e);
  }

  private setHoveredParcel(p: { px: number; py: number } | null, e: PointerEvent | null): void {
    if (this.hoveredParcel) {
      const prev = this.tiles.get(`${this.hoveredParcel.px},${this.hoveredParcel.py}`);
      (prev?.material as THREE.MeshStandardMaterial)?.color.setHex(UNOWNED_COLOR);
    }
    this.hoveredParcel = p;
    if (!p || !e) return this.onParcelHover(null);

    const tile = this.tiles.get(`${p.px},${p.py}`);
    (tile?.material as THREE.MeshStandardMaterial)?.color.setHex(HOVER_COLOR);
    const price = this.state.parcelPrice();
    this.onParcelHover({
      px: p.px,
      py: p.py,
      price,
      affordable: price <= this.state.budget,
      adjacent: this.state.isParcelAdjacent(p.px, p.py),
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }

  // --- reflets de l'état ---

  private buildParcelTiles(): void {
    const g = this.state.cfg.grid;
    const size = g.parcelCells * this.cell;
    for (let px = 0; px < g.worldParcels; px++) {
      for (let py = 0; py < g.worldParcels; py++) {
        const tile = new THREE.Mesh(
          new THREE.PlaneGeometry(size - 0.3, size - 0.3),
          new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
        );
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(
          this.cellCorner(px * g.parcelCells) + size / 2,
          0.005,
          this.cellCorner(py * g.parcelCells) + size / 2,
        );
        tile.receiveShadow = true;
        this.tiles.set(`${px},${py}`, tile);
        this.scene.add(tile);
        this.paintTile(px, py);
      }
    }
  }

  private paintTile(px: number, py: number): void {
    const tile = this.tiles.get(`${px},${py}`)!;
    (tile.material as THREE.MeshStandardMaterial).color.setHex(
      this.state.isParcelOwned(px, py) ? OWNED_COLOR : UNOWNED_COLOR,
    );
  }

  private addGridLines(): void {
    const grid = new THREE.GridHelper(
      this.worldCells * this.cell,
      this.worldCells,
      0x5a6470,
      0x4a4038,
    );
    grid.position.y = 0.02;
    const mat = grid.material as THREE.LineBasicMaterial;
    mat.transparent = true;
    mat.opacity = 0.15; // guide discret, plus le quadrillage « éditeur » dominant
    this.scene.add(grid);
  }

  // centre monde du premier pas de tir construit (pour l'effet de lancement)
  padPosition(): THREE.Vector3 | null {
    const pad = this.state.buildings.find((b) => b.def.id.startsWith('pad_'));
    if (!pad) return null;
    const [w, h] = rotatedFootprint(pad.def, pad.rot);
    return new THREE.Vector3(
      this.cellCorner(pad.x) + (w * this.cell) / 2,
      0,
      this.cellCorner(pad.y) + (h * this.cell) / 2,
    );
  }

  private loadModel(path: string): Promise<THREE.Group> {
    let p = this.modelCache.get(path);
    if (!p) {
      p = this.gltfLoader.loadAsync(path).then((gltf) => gltf.scene);
      this.modelCache.set(path, p);
    }
    return p;
  }

  // clone du modèle, mis à l'échelle uniforme pour tenir dans l'empreinte
  // (avant rotation), posé au sol et centré
  private fitModel(source: THREE.Group, def: BuildingDef): THREE.Group {
    const model = source.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const [w, h] = def.footprint;
    // tient dans l'empreinte au sol, plafonné en hauteur (2× la hauteur
    // nominale) pour que les modèles fins ne deviennent pas des tours
    const s = Math.min(
      (w * this.cell - 0.8) / size.x,
      (h * this.cell - 0.8) / size.z,
      (def.height * 2) / size.y,
    );
    model.scale.setScalar(s);
    model.position.set(-center.x * s, -box.min.y * s, -center.z * s);
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (def.tint) {
          const mat = (o.material as THREE.MeshStandardMaterial).clone();
          mat.color.set(def.color);
          o.material = mat;
        }
      }
    });
    return model;
  }

  private substitutePrimitive(def: BuildingDef): THREE.Mesh {
    const [w, h] = def.footprint;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w * this.cell - 0.8, def.height, h * this.cell - 0.8),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(def.color),
        roughness: 0.6,
        metalness: 0.2,
      }),
    );
    mesh.position.y = def.height / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // socle sous chaque bâtiment : plateforme métallique sombre + liseré coloré
  // émissif (code couleur par type, capté par le bloom). Ancre le modèle sur la
  // grille sans la dalle colorée criarde d'avant.
  private buildingBase(def: BuildingDef): THREE.Group {
    const [w, h] = def.footprint;
    const color = new THREE.Color(def.color);
    const g = new THREE.Group();

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(w * this.cell - 0.3, 0.35, h * this.cell - 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.45, metalness: 0.55 }),
    );
    platform.position.y = 0.175;
    platform.receiveShadow = true;
    platform.castShadow = true;
    g.add(platform);

    // fin liseré lumineux posé sur la plateforme
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(w * this.cell - 0.1, 0.08, h * this.cell - 0.1),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.4 }),
    );
    trim.position.y = 0.37;
    g.add(trim);
    return g;
  }

  private addBuildingMesh(b: PlacedBuilding): void {
    const [w, h] = rotatedFootprint(b.def, b.rot);
    const group = new THREE.Group();
    group.position.set(
      this.cellCorner(b.x) + (w * this.cell) / 2,
      0,
      this.cellCorner(b.y) + (h * this.cell) / 2,
    );
    group.rotation.y = (b.rot * Math.PI) / 2;
    this.scene.add(group);
    group.add(this.buildingBase(b.def));

    // le bâtiment repose sur la plateforme (hauteur du socle)
    const mount = new THREE.Group();
    mount.position.y = BASE_HEIGHT;
    group.add(mount);

    if (b.def.model) {
      this.loadModel(b.def.model)
        .then((source) => mount.add(this.fitModel(source, b.def)))
        .catch(() => mount.add(this.substitutePrimitive(b.def)));
    } else {
      mount.add(this.substitutePrimitive(b.def));
    }
  }
}
