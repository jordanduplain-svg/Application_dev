import type { GameState } from '../state/game';

// UI — DOM uniquement. Consomme l'état via ses événements, ne touche jamais
// la scène Three.js. La sélection de bâtiment remonte via onSelect (câblé
// dans main vers le pont).

const CSS = `
  .hud { font-family: system-ui, sans-serif; color: #d8dde4; user-select: none; }
  #hud-budget {
    position: fixed; top: 12px; left: 12px; padding: 8px 14px;
    background: rgba(20, 22, 26, .85); border: 1px solid #33373e; border-radius: 8px;
    font-size: 18px; color: #F2A65A; font-variant-numeric: tabular-nums;
  }
  #hud-hint { position: fixed; top: 58px; left: 50%; transform: translateX(-50%);
    padding: 6px 12px; background: rgba(20,22,26,.85); border-radius: 8px;
    font-size: 13px; color: #4FD1C5; display: none; }
  #hud-menu {
    position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 8px; padding: 8px; background: rgba(20, 22, 26, .85);
    border: 1px solid #33373e; border-radius: 10px;
  }
  #hud-menu button {
    padding: 8px 12px; background: #22252b; color: #d8dde4; border: 1px solid #3a3e46;
    border-radius: 6px; cursor: pointer; font-size: 13px; text-align: center;
  }
  #hud-menu button:hover { border-color: #4FD1C5; }
  #hud-menu button.active { background: #24413d; border-color: #4FD1C5; }
  #hud-menu button:disabled { opacity: .4; cursor: default; }
  #hud-menu .effect { display: block; color: #7fb0d6; font-size: 11px; margin-top: 3px; max-width: 96px; }
  #hud-menu .cost { display: block; color: #F2A65A; font-size: 12px; margin-top: 2px; }
  #hud-tip {
    position: fixed; display: none; pointer-events: none; z-index: 10;
    padding: 6px 10px; background: rgba(20, 22, 26, .92); border: 1px solid #4FD1C5;
    border-radius: 6px; font-size: 13px; white-space: nowrap;
  }
  #hud-tip.broke { border-color: #e53935; color: #e57373; }
`;

export class Hud {
  onSelect: (typeId: string | null) => void = () => {};

  private budgetEl: HTMLElement;
  private hintEl: HTMLElement;
  private tipEl: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private selected: string | null = null;

  constructor(
    private state: GameState,
    parent: HTMLElement,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.budgetEl = this.el(parent, 'div', 'hud-budget');
    this.hintEl = this.el(parent, 'div', 'hud-hint');
    this.hintEl.textContent = 'Clic gauche : placer — R : pivoter — Échap : annuler';
    this.tipEl = this.el(parent, 'div', 'hud-tip');

    const menu = this.el(parent, 'div', 'hud-menu');
    for (const def of state.cfg.buildings) {
      const btn = document.createElement('button');
      btn.innerHTML =
        `${def.name} <small>${def.footprint[0]}×${def.footprint[1]}</small>` +
        (def.effect ? `<span class="effect">${def.effect}</span>` : '') +
        `<span class="cost">${def.cost} ◈</span>`;
      btn.addEventListener('click', () => this.select(this.selected === def.id ? null : def.id));
      this.buttons.set(def.id, btn);
      menu.appendChild(btn);
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.select(null);
    });

    state.on('budget', () => this.refresh());
    this.refresh();
  }

  private el(parent: HTMLElement, tag: string, id: string): HTMLElement {
    const node = document.createElement(tag);
    node.id = id;
    node.className = 'hud';
    parent.appendChild(node);
    return node;
  }

  private select(typeId: string | null): void {
    this.selected = typeId;
    this.buttons.forEach((btn, id) => btn.classList.toggle('active', id === typeId));
    this.hintEl.style.display = typeId ? 'block' : 'none';
    this.onSelect(typeId);
  }

  private refresh(): void {
    this.budgetEl.textContent = `${this.state.budget} ◈`;
    this.buttons.forEach((btn, id) => {
      btn.disabled = this.state.buildingDef(id).cost > this.state.budget;
    });
    if (this.selected && this.buttons.get(this.selected)?.disabled) this.select(null);
  }

  showParcelTooltip(
    info: {
      price: number;
      affordable: boolean;
      adjacent: boolean;
      clientX: number;
      clientY: number;
    } | null,
  ): void {
    if (!info) {
      this.tipEl.style.display = 'none';
      return;
    }
    this.tipEl.textContent = !info.adjacent
      ? `Parcelle — ${info.price} ◈ (non adjacente à votre zone)`
      : info.affordable
        ? `Acheter cette parcelle — ${info.price} ◈`
        : `Parcelle — ${info.price} ◈ (fonds insuffisants)`;
    this.tipEl.classList.toggle('broke', !info.affordable || !info.adjacent);
    this.tipEl.style.display = 'block';
    this.tipEl.style.left = `${info.clientX + 14}px`;
    this.tipEl.style.top = `${info.clientY + 14}px`;
  }
}
