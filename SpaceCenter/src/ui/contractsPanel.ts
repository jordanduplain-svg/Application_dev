import type { GameState } from '../state/game';
import type { SpaceProgram } from '../state/launch';
import type { ContractBoard } from '../state/contracts';
import type { TechTree } from '../state/tech';
import type { RocketDef } from './launchPanel';

// Tableau des contrats — DOM uniquement, consomme ContractBoard (state/contracts.ts).

const CSS = `
  #hud-contracts-toggle {
    position: fixed; top: 12px; right: 268px; padding: 8px 14px;
    background: rgba(20,22,26,.85); border: 1px solid #33373e; border-radius: 8px;
    color: #d8dde4; font-size: 14px; cursor: pointer;
  }
  #hud-contracts-toggle:hover { border-color: #4FD1C5; }
  #hud-contracts {
    position: fixed; top: 56px; right: 12px; width: 320px; padding: 12px;
    background: rgba(20,22,26,.92); border: 1px solid #33373e; border-radius: 10px;
    font-size: 13px; display: none; max-height: 70vh; overflow-y: auto;
  }
  #hud-contracts h3 { margin: 0 0 8px; font-size: 14px; color: #4FD1C5; }
  #hud-contracts .contract {
    border: 1px solid #33373e; border-radius: 8px; padding: 8px; margin: 6px 0;
  }
  #hud-contracts .contract.on { border-color: #4FD1C5; }
  #hud-contracts .title { color: #d8dde4; }
  #hud-contracts .client { color: #9aa1ab; font-size: 12px; }
  #hud-contracts .type { font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
  #hud-contracts .type.etatique { background: #2c3a52; color: #8ab4e8; }
  #hud-contracts .type.prive { background: #4a3a22; color: #F2A65A; }
  #hud-contracts .money { color: #F2A65A; margin: 4px 0; font-size: 12px; }
  #hud-contracts .reason { color: #e57373; font-size: 12px; }
  #hud-contracts button {
    padding: 5px 10px; background: #22252b; color: #d8dde4; border: 1px solid #3a3e46;
    border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 4px;
  }
  #hud-contracts button:hover { border-color: #4FD1C5; }
`;

export class ContractsPanel {
  private panel: HTMLElement;
  private body: HTMLElement;

  constructor(
    state: GameState,
    private program: SpaceProgram,
    private board: ContractBoard,
    private tree: TechTree,
    private designs: RocketDef[],
    parent: HTMLElement,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = 'hud-contracts-toggle';
    toggle.className = 'hud';
    toggle.textContent = '📋 Contrats';
    parent.appendChild(toggle);

    this.panel = document.createElement('div');
    this.panel.id = 'hud-contracts';
    this.panel.className = 'hud';
    parent.appendChild(this.panel);
    toggle.addEventListener('click', () => {
      for (const id of ['hud-launch', 'hud-research', 'hud-assembly'])
        if (this.panel.style.display !== 'block') document.getElementById(id)!.style.display = 'none';
      this.panel.style.display = this.panel.style.display === 'block' ? 'none' : 'block';
      this.refresh();
    });

    this.panel.innerHTML = '<h3>Contrats</h3>';
    this.body = document.createElement('div');
    this.panel.appendChild(this.body);

    const prevBoard = board.onChange;
    board.onChange = () => {
      prevBoard();
      this.refresh();
    };
    const prevTree = tree.onChange;
    tree.onChange = () => {
      prevTree();
      this.refresh();
    };
    state.on('budget', () => this.refresh());
    this.refresh();
  }

  // La plus grosse fusée débloquée détermine les contrats accessibles
  private maxStages(): number {
    return Math.max(0, ...this.designs.filter((d) => this.tree.meets(d.requires)).map((d) => d.stages.length));
  }

  private refresh(): void {
    const statuses = this.board.statuses(this.program.repCommercial, this.program.flightCount, this.maxStages());
    this.body.innerHTML = statuses
      .map(({ def, available, reason }) => {
        const money =
          `${def.reward} ◈ si succès · ${Math.round(def.reward / 2)} ◈ si partiel` +
          (def.penalty ? ` · pénalité ${def.penalty} ◈` : '');
        const action =
          reason === 'en cours'
            ? `<button data-abandon="1">Abandonner</button>`
            : available
              ? `<button data-accept="${def.id}">Accepter</button>`
              : `<div class="reason">${reason}</div>`;
        return `<div class="contract${reason === 'en cours' ? ' on' : ''}">
          <span class="title">${def.title}</span><span class="type ${def.type}">${def.type === 'etatique' ? 'étatique' : 'privé'}</span>
          <div class="client">${def.client}</div>
          <div class="money">${money}</div>
          ${action}
        </div>`;
      })
      .join('');
    this.body
      .querySelector('[data-abandon]')
      ?.addEventListener('click', () => this.board.abandon());
    this.body.querySelectorAll('[data-accept]').forEach((btn) =>
      btn.addEventListener('click', () =>
        this.board.accept(
          (btn as HTMLElement).dataset.accept!,
          this.program.repCommercial,
          this.program.flightCount,
          this.maxStages(),
        ),
      ),
    );
  }
}
