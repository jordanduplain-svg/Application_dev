import type { GameState } from '../state/game';
import type { Margin, RocketDesign, SpaceProgram } from '../state/launch';
import { insurancePayout, insurancePremium } from '../state/launch';
import type { ContractBoard } from '../state/contracts';
import { applyTech, RP_GAIN, type BranchId, type TechTree } from '../state/tech';
import { applyFacilities, facilities } from '../state/facilities';

// Panneau de lancement — DOM uniquement, consomme SpaceProgram, TechTree et
// ContractBoard. Débloqué dès qu'un pas de tir est construit. Un vol est soit
// un essai interne (discret, non payé), soit l'exécution du contrat accepté.

export type RocketDef = RocketDesign & {
  cost: number;
  requires?: Partial<Record<BranchId, number>>;
};

// Dilemme GDD 6.1 : presser = moins cher mais risqué, roder = plus cher mais fiable
const MARGIN_COST: Record<Margin, number> = { presse: -50, standard: 0, rode: 150 };
const MARGIN_LABEL: Record<Margin, string> = {
  presse: 'Presser (−50 ◈)',
  standard: 'Standard',
  rode: 'Roder (+150 ◈)',
};

const GAUGE_ROWS: [keyof ReturnType<SpaceProgram['reliability']>, string][] = [
  ['components', 'Composants'],
  ['interfaces', 'Jonctions'],
  ['maturity', 'Maturité'],
  ['margin', 'Marge'],
];

const CSS = `
  #hud-launch-toggle {
    position: fixed; top: 12px; right: 12px; padding: 8px 14px;
    background: rgba(20,22,26,.85); border: 1px solid #33373e; border-radius: 8px;
    color: #d8dde4; font-size: 14px; cursor: pointer;
  }
  #hud-launch-toggle:hover { border-color: #4FD1C5; }
  #hud-launch {
    position: fixed; top: 56px; right: 12px; width: 300px; padding: 12px;
    background: rgba(20,22,26,.92); border: 1px solid #33373e; border-radius: 10px;
    font-size: 13px; display: none;
  }
  #hud-launch h3 { margin: 0 0 8px; font-size: 14px; color: #4FD1C5; }
  #hud-launch select, #hud-launch button.go {
    width: 100%; margin: 4px 0; padding: 6px; background: #22252b; color: #d8dde4;
    border: 1px solid #3a3e46; border-radius: 6px; font-size: 13px;
  }
  #hud-launch button.go { cursor: pointer; margin-top: 8px; }
  #hud-launch button.go:hover:not(:disabled) { border-color: #4FD1C5; }
  #hud-launch button.go:disabled { opacity: .4; cursor: default; }
  #hud-launch .gauge-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
  #hud-launch .gauge-row span { width: 90px; color: #9aa1ab; }
  #hud-launch .gauge-row .bar { flex: 1; height: 8px; background: #22252b; border-radius: 4px; overflow: hidden; }
  #hud-launch .gauge-row .bar i { display: block; height: 100%; background: #4FD1C5; }
  #hud-launch .total { margin: 6px 0; font-size: 15px; color: #F2A65A; }
  #hud-launch .money { color: #9aa1ab; margin: 4px 0; }
  #hud-launch label.insurance { display: flex; align-items: center; gap: 6px; margin: 6px 0; color: #9aa1ab; cursor: pointer; }
  #hud-launch label.insurance input { cursor: pointer; }
  #hud-launch .result { margin: 8px 0 0; min-height: 18px; }
  #hud-launch .result.ok { color: #6fce8f; }
  #hud-launch .result.ko { color: #e57373; }
  #hud-launch .rep { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
  #hud-launch .rep span { width: 90px; color: #9aa1ab; }
  #hud-launch .rep .bar { flex: 1; height: 8px; background: #22252b; border-radius: 4px; overflow: hidden; }
  #hud-launch .rep .bar i { display: block; height: 100%; background: #F2A65A; }
  #hud-launch .failures { margin: 6px 0 0; padding: 0 0 0 16px; color: #9aa1ab; max-height: 90px; overflow-y: auto; }
  #hud-launch hr { border: none; border-top: 1px solid #33373e; margin: 10px 0; }
`;

export class LaunchPanel {
  // notifié après chaque vol résolu (main.ts : événements GDD 5 + effet visuel)
  onLaunch: (outcome: import('../state/launch').Outcome, stages: number) => void = () => {};

  private panel: HTMLElement;
  private designSel: HTMLSelectElement;
  private marginSel: HTMLSelectElement;
  private pubSel: HTMLSelectElement;
  private gaugeEl: HTMLElement;
  private moneyEl: HTMLElement;
  private goBtn: HTMLButtonElement;
  private resultEl: HTMLElement;
  private repEl: HTMLElement;
  private failuresEl: HTMLElement;
  private insChk!: HTMLInputElement;
  private insText = document.createElement('span');
  private resultTimer = 0;

  constructor(
    private state: GameState,
    private program: SpaceProgram,
    private tree: TechTree,
    private board: ContractBoard,
    private designs: RocketDef[],
    parent: HTMLElement,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = 'hud-launch-toggle';
    toggle.className = 'hud';
    toggle.textContent = '🚀 Lancement';
    parent.appendChild(toggle);

    this.panel = document.createElement('div');
    this.panel.id = 'hud-launch';
    this.panel.className = 'hud';
    parent.appendChild(this.panel);
    toggle.addEventListener('click', () => {
      // un seul panneau à droite à la fois
      for (const id of ['hud-research', 'hud-contracts', 'hud-assembly']) {
        const other = document.getElementById(id);
        if (other && this.panel.style.display !== 'block') other.style.display = 'none';
      }
      this.panel.style.display = this.panel.style.display === 'block' ? 'none' : 'block';
      this.refresh();
    });

    this.panel.innerHTML = '<h3>Préparation du lancement</h3>';
    this.designSel = this.select(designs.map((d) => [d.id, `${d.name} — ${d.stages.length} étages`]));
    this.marginSel = this.select(
      (Object.keys(MARGIN_LABEL) as Margin[]).map((m) => [m, MARGIN_LABEL[m]]),
      'standard',
    );
    this.pubSel = this.select([['interne', 'Essai interne (discret, non payé)']]);

    const insLabel = document.createElement('label');
    insLabel.className = 'insurance';
    this.insChk = document.createElement('input');
    this.insChk.type = 'checkbox';
    insLabel.append(this.insChk, this.insText);
    this.panel.appendChild(insLabel);
    this.insChk.addEventListener('change', () => this.refresh());

    this.gaugeEl = this.div();
    this.moneyEl = this.div('money');
    this.goBtn = document.createElement('button');
    this.goBtn.className = 'go';
    this.goBtn.addEventListener('click', () => this.launch());
    this.panel.appendChild(this.goBtn);
    this.resultEl = this.div('result');
    this.panel.appendChild(document.createElement('hr'));
    this.repEl = this.div();
    this.failuresEl = document.createElement('ol');
    this.failuresEl.className = 'failures';
    this.panel.appendChild(this.failuresEl);

    for (const sel of [this.designSel, this.marginSel, this.pubSel])
      sel.addEventListener('change', () => this.refresh());
    state.on('budget', () => this.refresh());
    state.on('placed', () => this.refresh());
    const prev = tree.onChange;
    tree.onChange = () => {
      prev();
      this.refresh();
    };
    const prevBoard = board.onChange;
    board.onChange = () => {
      prevBoard();
      this.refresh();
    };
    this.refresh();
  }

  // Ajoute un design assemblé (assemblyPanel) et le sélectionne
  addDesign(def: RocketDef): void {
    const existing = this.designs.findIndex((d) => d.id === def.id);
    if (existing >= 0) this.designs[existing] = def;
    else this.designs.push(def);
    const o = Array.from(this.designSel.options).find((x) => x.value === def.id) ?? this.designSel.appendChild(document.createElement('option'));
    o.value = def.id;
    this.designSel.value = def.id;
    if (this.panel.style.display !== 'block') document.getElementById('hud-launch-toggle')!.click();
    this.refresh();
  }

  private select(options: [string, string][], value?: string): HTMLSelectElement {
    const sel = document.createElement('select');
    for (const [v, label] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      sel.appendChild(o);
    }
    if (value) sel.value = value;
    this.panel.appendChild(sel);
    return sel;
  }

  private div(cls = ''): HTMLElement {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    this.panel.appendChild(d);
    return d;
  }

  private current(): { design: RocketDef; margin: Margin; onContract: boolean; cost: number } {
    const design = this.designs.find((d) => d.id === this.designSel.value)!;
    const margin = this.marginSel.value as Margin;
    const fac = facilities(this.state.buildings.map((b) => b.def.id));
    return {
      design,
      margin,
      onContract: this.pubSel.value === 'contrat' && this.board.active !== null,
      cost: Math.round(design.cost * fac.costFactor) + MARGIN_COST[margin], // entrepôts réduisent
    };
  }

  private refresh(): void {
    // verrous tech sur les designs (GDD 3.2)
    for (const opt of Array.from(this.designSel.options)) {
      const d = this.designs.find((x) => x.id === opt.value)!;
      const locked = !this.tree.meets(d.requires);
      opt.disabled = locked;
      opt.textContent = `${d.name} — ${d.stages.length} étages${locked ? ' 🔒' : ''}`;
    }
    if (this.designSel.selectedOptions[0]?.disabled) {
      const firstOpen = Array.from(this.designSel.options).find((o) => !o.disabled);
      if (firstOpen) this.designSel.value = firstOpen.value;
    }

    // mission : essai interne, ou le contrat accepté (📋 Contrats)
    const wasContract = this.pubSel.value === 'contrat';
    const hadContractOption = Array.from(this.pubSel.options).some((o) => o.value === 'contrat');
    const active = this.board.active;
    this.pubSel.innerHTML = '';
    if (active) {
      const o = document.createElement('option');
      o.value = 'contrat';
      o.textContent = `Contrat : ${active.title} (${active.client})`;
      this.pubSel.appendChild(o);
    }
    const oi = document.createElement('option');
    oi.value = 'interne';
    oi.textContent = 'Essai interne (discret, non payé)';
    this.pubSel.appendChild(oi);
    // un contrat fraîchement accepté devient la mission par défaut ; le choix
    // manuel "interne" pendant qu'un contrat est actif est conservé
    this.pubSel.value = active ? (hadContractOption && !wasContract ? 'interne' : 'contrat') : 'interne';

    const { design, margin, onContract, cost } = this.current();
    const fac = facilities(this.state.buildings.map((pb) => pb.def.id));
    const premium = this.insChk.checked ? insurancePremium(cost, this.program.repCommercial) : 0;
    const total = cost + premium;
    this.insText.textContent = `Assurer le vol — prime ${insurancePremium(cost, this.program.repCommercial)} ◈ (rembourse le véhicule si échec)`;
    // fiabilité = tech + qualité des usines (par branche) + bonus global installations
    const tuned = applyFacilities(applyTech(design, this.tree), fac);
    const b = this.program.reliability(tuned, margin, fac.reliabilityMult);

    this.gaugeEl.innerHTML = GAUGE_ROWS.map(
      ([key, label]) =>
        `<div class="gauge-row"><span>${label}</span><div class="bar"><i style="width:${Math.min(100, b[key] * 100)}%"></i></div>${(b[key] * 100).toFixed(0)}%</div>`,
    ).join('');
    const mod = this.program.reliabilityModifier;
    const modNote = mod !== 1 ? ` <small style="color:#e57373">(événement ×${mod.toFixed(2)})</small>` : '';
    this.gaugeEl.innerHTML += `<div class="total">Fiabilité : ${(b.total * 100).toFixed(1)} %${modNote}</div>`;

    const paidCost = premium ? `${cost} + ${premium} ◈ (assurance)` : `${cost} ◈`;
    this.moneyEl.textContent = onContract
      ? `Coût ${paidCost} — ${active!.reward} ◈ si succès, ${Math.round(active!.reward / 2)} ◈ si partiel` +
        (active!.penalty ? `, pénalité ${active!.penalty} ◈ si échec total` : '')
      : `Coût ${paidCost} — essai interne, aucun paiement`;

    const padFits = design.stages.length <= fac.padCapacity; // GDD 8 : pads par taille
    const affordable = total <= this.state.budget;
    const bigEnough = !onContract || design.stages.length >= active!.minStages;
    this.goBtn.disabled = fac.padCapacity === 0 || !padFits || !affordable || !bigEnough;
    this.goBtn.textContent =
      fac.padCapacity === 0
        ? 'Construire un pas de tir d’abord'
        : !padFits
          ? `Pas de tir trop petit (max ${fac.padCapacity} étages)`
          : !bigEnough
            ? `Contrat : fusée ${active!.minStages}+ étages requise`
            : !affordable
              ? 'Fonds insuffisants'
              : `Lancer — ${total} ◈`;

    this.repEl.innerHTML =
      `<div class="rep"><span>Rép. étatique</span><div class="bar"><i style="width:${this.program.repState}%"></i></div>${Math.round(this.program.repState)}</div>` +
      `<div class="rep"><span>Confiance com.</span><div class="bar"><i style="width:${this.program.repCommercial}%"></i></div>${Math.round(this.program.repCommercial)}</div>`;

    this.failuresEl.innerHTML = this.program.failures
      .slice(-5)
      .reverse()
      .map((f) => `<li>Vol ${f.flightNumber} · ${f.designName} — ${f.cause}</li>`)
      .join('');
  }

  // redessine après un effet externe (événement appliqué depuis main)
  refreshPublic(): void {
    this.refresh();
  }

  private launch(): void {
    const { design, margin, onContract, cost } = this.current();
    const fac = facilities(this.state.buildings.map((pb) => pb.def.id));
    const insured = this.insChk.checked;
    const premium = insured ? insurancePremium(cost, this.program.repCommercial) : 0;
    if (!this.state.spend(cost + premium)) return;
    const res = this.program.launch(
      applyFacilities(applyTech(design, this.tree), fac),
      { margin, publicity: onContract ? 'public' : 'discret' },
      undefined,
      fac.reliabilityMult,
    );

    // les labos accélèrent la recherche (rpFactor)
    const rpGain = Math.round(RP_GAIN[res.outcome] * fac.rpFactor);
    this.tree.award(rpGain);

    if (insured) {
      const refund = insurancePayout(cost, res.outcome);
      if (refund) this.state.credit(refund);
    }

    if (onContract) {
      const s = this.board.resolve(res.outcome, res.flightNumber);
      if (s.payout) this.state.credit(s.payout); // négatif = clause de pénalité
      this.program.adjust(s.repState, s.repCommercial);
    }

    this.resultEl.className =
      res.outcome === 'succes' ? 'result ok' : 'result ko';
    this.resultEl.textContent =
      (res.outcome === 'succes'
        ? `✔ Vol ${res.flightNumber} : succès !`
        : res.outcome === 'echec-partiel'
          ? `✘ Vol ${res.flightNumber} : échec partiel — orbite ratée`
          : `✘ Vol ${res.flightNumber} : échec total — véhicule perdu`) + ` · +${rpGain} PR`;
    // le résultat s'efface seul (ne colle plus en permanence)
    clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => {
      this.resultEl.textContent = '';
      this.resultEl.className = 'result';
    }, 7000);
    this.refresh();
    this.onLaunch(res.outcome, design.stages.length); // main : événements + effet visuel
  }
}
