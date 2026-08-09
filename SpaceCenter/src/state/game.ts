// État du jeu — pur TS, aucune dépendance à Three.js ni au DOM.
// La config vient de buildings.json, passée au constructeur.

export interface GridConfig {
  cellSize: number;
  worldParcels: number; // monde carré, en parcelles
  parcelCells: number; // parcelle carrée, en cases
  startParcels: [number, number][];
  parcelBasePrice: number;
  parcelPriceMultiplier: number; // GDD 12.1 : prix ×~1,4 à chaque achat
}

export interface BuildingDef {
  id: string;
  name: string;
  footprint: [number, number]; // ponytail: empreintes provisoires — remplacer par GDD section 12.2 quand disponible
  cost: number;
  model: string | null; // chemin .glb, null = primitive de substitution
  tint?: boolean; // applique `color` aux matériaux du modèle importé
  color: string;
  height: number; // hauteur de la primitive de substitution
  effect?: string; // libellé de l'effet mécanique (GDD 8), affiché au menu
}

// rotation en quarts de tour (0-3) ; impair = empreinte pivotée
export function rotatedFootprint(def: BuildingDef, rot: number): [number, number] {
  return rot % 2 === 1 ? [def.footprint[1], def.footprint[0]] : def.footprint;
}

export interface GameConfig {
  grid: GridConfig;
  startBudget: number;
  buildings: BuildingDef[];
}

export interface PlacedBuilding {
  def: BuildingDef;
  x: number; // case d'origine (coin min)
  y: number;
  rot: number; // quarts de tour (0-3)
}

export interface CellCheck {
  x: number;
  y: number;
  ok: boolean;
}

export interface PlacementCheck {
  ok: boolean; // toutes les cases libres, possédées et dans le monde
  affordable: boolean;
  cells: CellCheck[];
}

interface Events {
  placed: PlacedBuilding;
  parcelBought: { px: number; py: number };
  budget: number;
}

export class GameState {
  readonly cfg: GameConfig;
  readonly worldCells: number;
  budget: number;
  readonly buildings: PlacedBuilding[] = [];
  private ownedParcels = new Set<string>();
  private occupied = new Set<string>();
  private parcelsBought = 0;
  private listeners: { [K in keyof Events]?: ((e: Events[K]) => void)[] } = {};

  constructor(cfg: GameConfig) {
    this.cfg = cfg;
    this.worldCells = cfg.grid.worldParcels * cfg.grid.parcelCells;
    this.budget = cfg.startBudget;
    for (const [px, py] of cfg.grid.startParcels) this.ownedParcels.add(`${px},${py}`);
  }

  on<K extends keyof Events>(ev: K, fn: (e: Events[K]) => void): void {
    ((this.listeners[ev] ??= []) as ((e: Events[K]) => void)[]).push(fn);
  }

  private emit<K extends keyof Events>(ev: K, e: Events[K]): void {
    this.listeners[ev]?.forEach((f) => f(e));
  }

  // --- trésorerie ---

  spend(amount: number): boolean {
    if (amount > this.budget) return false;
    this.budget -= amount;
    this.emit('budget', this.budget);
    return true;
  }

  credit(amount: number): void {
    this.budget += amount;
    this.emit('budget', this.budget);
  }

  buildingDef(id: string): BuildingDef {
    const def = this.cfg.buildings.find((b) => b.id === id);
    if (!def) throw new Error(`Type de bâtiment inconnu : ${id}`);
    return def;
  }

  // --- parcelles ---

  parcelOf(cellX: number, cellY: number): { px: number; py: number } {
    const n = this.cfg.grid.parcelCells;
    return { px: Math.floor(cellX / n), py: Math.floor(cellY / n) };
  }

  isParcelOwned(px: number, py: number): boolean {
    return this.ownedParcels.has(`${px},${py}`);
  }

  // GDD 12.1 : prix croissant à chaque achat, quelle que soit la parcelle
  parcelPrice(): number {
    const g = this.cfg.grid;
    return Math.round(g.parcelBasePrice * g.parcelPriceMultiplier ** this.parcelsBought);
  }

  // GDD 12.1 : extension uniquement par bloc adjacent à une zone possédée
  isParcelAdjacent(px: number, py: number): boolean {
    return (
      this.isParcelOwned(px - 1, py) ||
      this.isParcelOwned(px + 1, py) ||
      this.isParcelOwned(px, py - 1) ||
      this.isParcelOwned(px, py + 1)
    );
  }

  buyParcel(px: number, py: number): boolean {
    const inWorld = px >= 0 && py >= 0 && px < this.cfg.grid.worldParcels && py < this.cfg.grid.worldParcels;
    if (!inWorld || this.isParcelOwned(px, py) || !this.isParcelAdjacent(px, py)) return false;
    const price = this.parcelPrice();
    if (price > this.budget) return false;
    this.budget -= price;
    this.parcelsBought++;
    this.ownedParcels.add(`${px},${py}`);
    this.emit('parcelBought', { px, py });
    this.emit('budget', this.budget);
    return true;
  }

  // --- placement ---

  private cellOk(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.worldCells || y >= this.worldCells) return false;
    const { px, py } = this.parcelOf(x, y);
    return this.isParcelOwned(px, py) && !this.occupied.has(`${x},${y}`);
  }

  placementCheck(typeId: string, ox: number, oy: number, rot = 0): PlacementCheck {
    const def = this.buildingDef(typeId);
    const [w, h] = rotatedFootprint(def, rot);
    const cells: CellCheck[] = [];
    let ok = true;
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const c = { x: ox + dx, y: oy + dy, ok: this.cellOk(ox + dx, oy + dy) };
        ok &&= c.ok;
        cells.push(c);
      }
    }
    return { ok, affordable: def.cost <= this.budget, cells };
  }

  place(typeId: string, ox: number, oy: number, rot = 0): boolean {
    const check = this.placementCheck(typeId, ox, oy, rot);
    if (!check.ok || !check.affordable) return false;
    const def = this.buildingDef(typeId);
    for (const c of check.cells) this.occupied.add(`${c.x},${c.y}`);
    const placed: PlacedBuilding = { def, x: ox, y: oy, rot };
    this.buildings.push(placed);
    this.budget -= def.cost;
    this.emit('placed', placed);
    this.emit('budget', this.budget);
    return true;
  }
}
