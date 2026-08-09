import type { BranchId, TechTree } from '../state/tech';
import type { ComponentDef } from '../state/assembly';

// Panneau de recherche — DOM uniquement, consomme TechTree (state/tech.ts).
// Affiche pourquoi un palier est bloqué et ce qu'il débloque en assemblage.

const CSS = `
  #hud-research-toggle {
    position: fixed; top: 12px; right: 140px; padding: 8px 14px;
    background: rgba(20,22,26,.85); border: 1px solid #33373e; border-radius: 8px;
    color: #d8dde4; font-size: 14px; cursor: pointer;
  }
  #hud-research-toggle:hover { border-color: #4FD1C5; }
  #hud-research {
    position: fixed; top: 56px; right: 12px; width: 300px; padding: 12px;
    background: rgba(20,22,26,.92); border: 1px solid #33373e; border-radius: 10px;
    font-size: 13px; display: none;
  }
  #hud-research h3 { margin: 0 0 4px; font-size: 14px; color: #4FD1C5; }
  #hud-research .rp { color: #F2A65A; font-size: 15px; margin-bottom: 8px; }
  #hud-research .branch { margin: 8px 0 2px; color: #9aa1ab; }
  #hud-research .done { color: #6fce8f; margin: 2px 0; }
  #hud-research button {
    width: 100%; margin: 3px 0; padding: 6px; background: #22252b; color: #d8dde4;
    border: 1px solid #3a3e46; border-radius: 6px; font-size: 13px; cursor: pointer;
    text-align: left;
  }
  #hud-research button:hover:not(:disabled) { border-color: #4FD1C5; }
  #hud-research button:disabled { opacity: .5; cursor: default; }
  #hud-research .unlock { color: #7fb0d6; font-size: 11px; margin: 0 0 6px 4px; }
  #hud-research .need { color: #c9a15f; font-size: 11px; margin: 0 0 6px 4px; }
  #hud-research .fx { color: #9aa1ab; font-size: 12px; margin-top: 8px; }
`;

export class ResearchPanel {
  private panel: HTMLElement;
  private body: HTMLElement;

  constructor(
    private tree: TechTree,
    private catalog: ComponentDef[],
    parent: HTMLElement,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = 'hud-research-toggle';
    toggle.className = 'hud';
    toggle.textContent = '🔬 Recherche';
    parent.appendChild(toggle);

    this.panel = document.createElement('div');
    this.panel.id = 'hud-research';
    this.panel.className = 'hud';
    parent.appendChild(this.panel);
    toggle.addEventListener('click', () => {
      // un seul panneau à droite à la fois
      for (const id of ['hud-launch', 'hud-contracts', 'hud-assembly']) {
        const other = document.getElementById(id);
        if (other && this.panel.style.display !== 'block') other.style.display = 'none';
      }
      this.panel.style.display = this.panel.style.display === 'block' ? 'none' : 'block';
    });

    this.panel.innerHTML = '<h3>Recherche</h3>';
    this.body = document.createElement('div');
    this.panel.appendChild(this.body);

    const prev = tree.onChange;
    tree.onChange = () => {
      prev();
      this.refresh();
    };
    this.refresh();
  }

  // composants débloqués en atteignant un niveau de branche donné
  private unlockedAt(b: BranchId, level: number): string[] {
    return this.catalog.filter((c) => c.branch === b && c.tier === level).map((c) => c.name);
  }

  private refresh(): void {
    const t = this.tree;
    let html = `<div class="rp">${t.rp} PR disponibles</div>`;
    for (const b of Object.keys(t.cfg.branches) as BranchId[]) {
      const { name, tiers } = t.cfg.branches[b];
      html += `<div class="branch">${name} — palier ${t.level(b)}/${tiers.length}</div>`;
      html += tiers
        .slice(0, t.level(b))
        .map((tier) => `<div class="done">✔ ${tier.name}</div>`)
        .join('');
      const next = t.nextTier(b);
      if (next) {
        const affordable = t.canResearch(b);
        html += `<button data-branch="${b}" ${affordable ? '' : 'disabled'}>${next.name} — ${next.cost} PR</button>`;
        // pourquoi grisé : PR manquants
        if (!affordable) html += `<div class="need">🔒 Il te manque ${next.cost - t.rp} PR (gagnés en lançant).</div>`;
        // ce que ça débloque à l'atelier d'assemblage
        const unlocks = this.unlockedAt(b, t.level(b) + 1);
        if (unlocks.length) html += `<div class="unlock">Débloque : ${unlocks.join(', ')}</div>`;
      }
    }
    html += '<div class="fx">Chaque palier améliore la fiabilité (−15 % de risque) et débloque de meilleurs composants à l’assemblage. Les PR se gagnent en lançant (surtout avec un Labo R&D).</div>';
    this.body.innerHTML = html;
    this.body.querySelectorAll('button[data-branch]').forEach((btn) =>
      btn.addEventListener('click', () => this.tree.research((btn as HTMLElement).dataset.branch as BranchId)),
    );
  }
}
