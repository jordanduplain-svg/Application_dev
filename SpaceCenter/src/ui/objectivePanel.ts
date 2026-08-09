import type { GameState } from '../state/game';
import type { SpaceProgram } from '../state/launch';
import type { ContractBoard } from '../state/contracts';
import type { TechTree } from '../state/tech';
import type { RocketDef } from './launchPanel';

// Barre d'objectif — guide toujours vers la prochaine action, et débloque un
// filet de secours (avance d'État) quand le joueur n'a plus de quoi lancer.
// Résout l'opacité de la boucle éco et le risque de blocage par sur-dépense.

const GRANT_AMOUNT = 1200;
const GRANT_REP_COST = 5; // GDD 7 : le financement étatique a un prix politique
const GRANT_COOLDOWN = 4; // en vols, anti-farming

const CSS = `
  #hud-objective {
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px; max-width: 60vw;
    padding: 8px 16px; background: rgba(20,22,26,.9); border: 1px solid #F2A65A;
    border-radius: 10px; font-family: system-ui, sans-serif; font-size: 14px; color: #f0d9b8;
  }
  #hud-objective .step { color: #F2A65A; font-weight: 600; }
  #hud-objective button {
    padding: 6px 12px; background: #4a3420; color: #ffdca8; border: 1px solid #F2A65A;
    border-radius: 6px; cursor: pointer; font-size: 13px; white-space: nowrap;
  }
  #hud-objective button:hover { background: #5c4228; }
  #hud-objective .close {
    padding: 0 6px; background: transparent; border: none; color: #9aa1ab; font-size: 18px;
    line-height: 1; cursor: pointer;
  }
  #hud-objective .close:hover { color: #fff; background: transparent; }
  #hud-objective-show {
    position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
    padding: 5px 10px; background: rgba(20,22,26,.8); border: 1px solid #55493a;
    border-radius: 8px; color: #c9a15f; font-size: 12px; cursor: pointer; display: none;
    font-family: system-ui, sans-serif;
  }
`;

export class ObjectivePanel {
  private bar: HTMLElement;
  private text: HTMLElement;
  private grantBtn: HTMLButtonElement;
  private showChip: HTMLElement;
  private lastGrantFlight = -GRANT_COOLDOWN;
  private closed = false;
  private lastMsg = '';

  constructor(
    private state: GameState,
    private program: SpaceProgram,
    private board: ContractBoard,
    private tree: TechTree,
    private designs: RocketDef[],
    parent: HTMLElement,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.bar = document.createElement('div');
    this.bar.id = 'hud-objective';
    this.text = document.createElement('span');
    this.grantBtn = document.createElement('button');
    this.grantBtn.textContent = `Avance d’État (+${GRANT_AMOUNT} ◈, −${GRANT_REP_COST} rép.)`;
    this.grantBtn.style.display = 'none';
    this.grantBtn.addEventListener('click', () => this.claimGrant());
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '×';
    close.title = 'Masquer';
    close.addEventListener('click', () => this.setClosed(true));
    this.bar.append(this.text, this.grantBtn, close);
    parent.appendChild(this.bar);

    // pastille pour rouvrir la barre une fois masquée
    this.showChip = document.createElement('div');
    this.showChip.id = 'hud-objective-show';
    this.showChip.textContent = '🎯 Objectif';
    this.showChip.addEventListener('click', () => this.setClosed(false));
    parent.appendChild(this.showChip);

    state.on('budget', () => this.refresh());
    state.on('placed', () => this.refresh());
    const boardPrev = board.onChange;
    board.onChange = () => {
      boardPrev();
      this.refresh();
    };
    const treePrev = tree.onChange;
    tree.onChange = () => {
      treePrev();
      this.refresh();
    };
    this.refresh();
  }

  // Coût de la fusée débloquée la moins chère (essai possible le moins cher)
  private cheapestRocket(): number {
    const unlocked = this.designs.filter((d) => this.tree.meets(d.requires));
    return unlocked.length ? Math.min(...unlocked.map((d) => d.cost)) : Infinity;
  }

  refresh(): void {
    const hasPad = this.state.buildings.some((b) => b.def.id.startsWith('pad_'));
    const cheapest = this.cheapestRocket();
    const broke = this.state.budget < cheapest;
    const canGrant = broke && this.program.flightCount - this.lastGrantFlight >= GRANT_COOLDOWN;
    this.grantBtn.style.display = canGrant ? 'block' : 'none';

    let msg: string;
    if (!hasPad) {
      msg = '① Construis un <span class="step">Pas de tir</span> (menu du bas) pour pouvoir lancer.';
    } else if (broke) {
      msg = canGrant
        ? 'Fonds trop bas pour lancer. Demande une avance d’État pour repartir →'
        : 'Fonds trop bas. Termine un contrat en cours pour renflouer.';
    } else if (!this.board.active) {
      msg = '② Ouvre <span class="step">📋 Contrats</span> et accepte une mission — c’est elle qui te paiera.';
    } else {
      msg =
        '③ Ouvre <span class="step">🚀 Lancement</span>, garde la mission « Contrat », choisis une fusée et lance. Succès = paiement.';
    }
    this.text.innerHTML = msg;

    // une nouvelle étape (ou une avance dispo) rouvre la barre masquée
    if (this.closed && (msg !== this.lastMsg || canGrant)) this.setClosed(false);
    this.lastMsg = msg;
  }

  private setClosed(v: boolean): void {
    this.closed = v;
    this.bar.style.display = v ? 'none' : 'flex';
    this.showChip.style.display = v ? 'block' : 'none';
  }

  private claimGrant(): void {
    this.state.credit(GRANT_AMOUNT);
    this.program.adjust(-GRANT_REP_COST, 0);
    this.lastGrantFlight = this.program.flightCount;
    this.refresh();
  }
}
