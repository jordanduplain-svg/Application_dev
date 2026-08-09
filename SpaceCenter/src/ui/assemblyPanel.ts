import type { SpaceProgram } from '../state/launch';
import { applyTech, type TechTree } from '../state/tech';
import { available, buildDesign, type AssemblyPick, type ComponentDef, type Role } from '../state/assembly';
import type { LaunchPanel, RocketDef } from './launchPanel';

// Atelier d'assemblage — le joueur compose une fusée depuis les composants
// débloqués (state/assembly.ts) et l'envoie au panneau de lancement.

const MAX_STAGES = 3;

const CSS = `
  #hud-assembly-toggle {
    position: fixed; top: 12px; right: 396px; padding: 8px 14px;
    background: rgba(20,22,26,.85); border: 1px solid #33373e; border-radius: 8px;
    color: #d8dde4; font-size: 14px; cursor: pointer;
  }
  #hud-assembly-toggle:hover { border-color: #4FD1C5; }
  #hud-assembly {
    position: fixed; top: 56px; right: 12px; width: 320px; padding: 12px;
    background: rgba(20,22,26,.92); border: 1px solid #33373e; border-radius: 10px;
    font-size: 13px; display: none; max-height: 78vh; overflow-y: auto;
  }
  #hud-assembly h3 { margin: 0 0 8px; font-size: 14px; color: #4FD1C5; }
  #hud-assembly h4 { margin: 10px 0 2px; font-size: 12px; color: #9aa1ab; }
  #hud-assembly input[type=text], #hud-assembly select {
    width: 100%; margin: 3px 0; padding: 6px; background: #22252b; color: #d8dde4;
    border: 1px solid #3a3e46; border-radius: 6px; font-size: 13px;
  }
  #hud-assembly label { display: flex; align-items: center; gap: 6px; margin: 6px 0; color: #9aa1ab; }
  #hud-assembly .preview { margin: 10px 0; color: #F2A65A; }
  #hud-assembly .preview b { color: #4FD1C5; }
  #hud-assembly button.build {
    width: 100%; margin-top: 8px; padding: 8px; background: #24413d; color: #d8dde4;
    border: 1px solid #4FD1C5; border-radius: 6px; cursor: pointer; font-size: 14px;
  }
  #hud-assembly button.build:hover { background: #2c534d; }
`;

export class AssemblyPanel {
  private panel: HTMLElement;
  private form: HTMLElement;
  private preview: HTMLElement;
  private nameInput!: HTMLInputElement;
  private stageSel!: HTMLSelectElement;
  private fairingChk!: HTMLInputElement;

  constructor(
    private program: SpaceProgram,
    private tree: TechTree,
    private catalog: ComponentDef[],
    private launchPanel: LaunchPanel,
    parent: HTMLElement,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = 'hud-assembly-toggle';
    toggle.className = 'hud';
    toggle.textContent = '🛠️ Assemblage';
    parent.appendChild(toggle);

    this.panel = document.createElement('div');
    this.panel.id = 'hud-assembly';
    this.panel.className = 'hud';
    parent.appendChild(this.panel);
    toggle.addEventListener('click', () => {
      for (const id of ['hud-launch', 'hud-research', 'hud-contracts'])
        if (this.panel.style.display !== 'block') document.getElementById(id)!.style.display = 'none';
      this.panel.style.display = this.panel.style.display === 'block' ? 'none' : 'block';
      this.rebuild();
    });

    this.panel.innerHTML = '<h3>Atelier d’assemblage</h3>';
    this.form = document.createElement('div');
    this.panel.appendChild(this.form);
    this.preview = document.createElement('div');
    this.preview.className = 'preview';
    this.panel.appendChild(this.preview);
    const build = document.createElement('button');
    build.className = 'build';
    build.textContent = 'Assembler et charger';
    build.addEventListener('click', () => this.assemble());
    this.panel.appendChild(build);

    const prev = tree.onChange;
    tree.onChange = () => {
      prev();
      if (this.panel.style.display === 'block') this.rebuild();
    };
    this.rebuild();
  }

  private options(role: Role): [string, string][] {
    return available(this.catalog, this.tree)
      .filter((c) => c.role === role)
      .map((c) => [c.id, `${c.name} — ${(c.reliability * 100).toFixed(1)}% · ${c.cost} ◈`]);
  }

  // reconstruit le formulaire selon le nombre d'étages courant et les composants débloqués
  private rebuild(): void {
    const prevName = this.nameInput?.value;
    const prevStages = this.stageSel?.value;
    const prevFairing = this.fairingChk?.checked;
    this.form.innerHTML = '';

    this.nameInput = this.field('text', 'Nom de la fusée') as HTMLInputElement;
    this.nameInput.value = prevName || '';
    this.nameInput.placeholder = 'ex. Faucon 1';

    this.stageSel = this.selectEl(
      Array.from({ length: MAX_STAGES }, (_, i) => [`${i + 1}`, `${i + 1} étage${i ? 's' : ''}`]),
      prevStages || '2',
    );

    const stages = Number(this.stageSel.value);
    for (let i = 0; i < stages; i++) {
      this.heading(`Étage ${i + 1}`);
      this.selectEl(this.options('engine'), undefined, `eng${i}`);
      this.selectEl(this.options('tank'), undefined, `tank${i}`);
    }
    this.heading('Étage supérieur');
    this.selectEl(this.options('avionics'), undefined, 'avi');

    const fairLabel = document.createElement('label');
    this.fairingChk = document.createElement('input');
    this.fairingChk.type = 'checkbox';
    this.fairingChk.checked = prevFairing ?? false;
    fairLabel.append(this.fairingChk, document.createTextNode('Ajouter une coiffe (protège le payload)'));
    this.form.appendChild(fairLabel);

    for (const el of this.form.querySelectorAll('select, input'))
      el.addEventListener('change', () => this.updatePreview());
    this.stageSel.addEventListener('change', () => this.rebuild());
    this.updatePreview();
  }

  private field(type: string, label: string): HTMLElement {
    this.heading(label);
    const input = document.createElement('input');
    input.type = type;
    this.form.appendChild(input);
    return input;
  }

  private selectEl(options: [string, string][], value?: string, tag?: string): HTMLSelectElement {
    const sel = document.createElement('select');
    if (tag) sel.dataset.tag = tag;
    for (const [v, label] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      sel.appendChild(o);
    }
    if (value) sel.value = value;
    this.form.appendChild(sel);
    return sel;
  }

  private heading(text: string): void {
    const h = document.createElement('h4');
    h.textContent = text;
    this.form.appendChild(h);
  }

  private currentPick(): AssemblyPick | null {
    const stages = Number(this.stageSel.value);
    const pick: AssemblyPick = { name: this.nameInput.value, stages: [], avionicsId: '', fairingId: null };
    for (let i = 0; i < stages; i++) {
      const eng = this.form.querySelector<HTMLSelectElement>(`select[data-tag="eng${i}"]`)?.value;
      const tank = this.form.querySelector<HTMLSelectElement>(`select[data-tag="tank${i}"]`)?.value;
      if (!eng || !tank) return null;
      pick.stages.push({ engineId: eng, tankId: tank });
    }
    const avi = this.form.querySelector<HTMLSelectElement>('select[data-tag="avi"]')?.value;
    if (!avi) return null;
    pick.avionicsId = avi;
    if (this.fairingChk.checked) pick.fairingId = 'fair_std';
    return pick;
  }

  private build(): RocketDef | null {
    const pick = this.currentPick();
    if (!pick) return null;
    try {
      return buildDesign(pick, this.catalog);
    } catch {
      return null;
    }
  }

  private updatePreview(): void {
    const def = this.build();
    if (!def) {
      this.preview.textContent = '';
      return;
    }
    // estimation incluant la tech (hors bonus des installations, ajoutés au lancement)
    const rel = this.program.reliability(applyTech(def, this.tree));
    this.preview.innerHTML = `Fiabilité estimée : <b>${(rel.total * 100).toFixed(1)} %</b> · Coût ${def.cost} ◈ · ${def.stages.length} étage${def.stages.length > 1 ? 's' : ''} <small style="color:#9aa1ab">(hors bonus bâtiments)</small>`;
  }

  private assemble(): void {
    const def = this.build();
    if (def) this.launchPanel.addDesign(def);
  }
}
