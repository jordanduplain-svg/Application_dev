import { SceneRoot } from './render/sceneRoot';
import { Decor } from './render/decor';
import { LaunchFx } from './render/launchFx';
import { GameState, type GameConfig } from './state/game';
import { SpaceProgram } from './state/launch';
import { TechTree, type TechConfig } from './state/tech';
import { ContractBoard, type ContractDef } from './state/contracts';
import { EventSystem, type EventChoice, type EventDef } from './state/events';
import type { ComponentDef } from './state/assembly';
import { SceneBridge } from './bridge/sceneBridge';
import { Hud } from './ui/hud';
import { LaunchPanel, type RocketDef } from './ui/launchPanel';
import { ResearchPanel } from './ui/researchPanel';
import { ContractsPanel } from './ui/contractsPanel';
import { EventModal } from './ui/eventModal';
import { AssemblyPanel } from './ui/assemblyPanel';
import { ObjectivePanel } from './ui/objectivePanel';
import config from './data/buildings.json';
import rockets from './data/rockets.json';
import techConfig from './data/tech.json';
import contractsConfig from './data/contracts.json';
import eventsConfig from './data/events.json';
import componentsConfig from './data/components.json';

const state = new GameState(config as unknown as GameConfig);
const program = new SpaceProgram();
const tree = new TechTree(techConfig as TechConfig);
const board = new ContractBoard(contractsConfig.contracts as ContractDef[]);
const events = new EventSystem(eventsConfig.events as EventDef[]);
const designs = rockets.designs as RocketDef[];
const root = new SceneRoot(document.body);
new Decor(root.scene);
const fx = new LaunchFx(root.scene);
const bridge = new SceneBridge(state, root.scene, root.orbit.camera, root.renderer.domElement);
const hud = new Hud(state, document.body);
const launchPanel = new LaunchPanel(state, program, tree, board, designs, document.body);
new ResearchPanel(tree, componentsConfig.components as ComponentDef[], document.body);
new ContractsPanel(state, program, board, tree, designs, document.body);
new AssemblyPanel(program, tree, componentsConfig.components as ComponentDef[], launchPanel, document.body);
new ObjectivePanel(state, program, board, tree, designs, document.body);
const eventModal = new EventModal(document.body);

// Applique un choix d'événement (GDD 5) — touche budget, réputation, tech.
function applyEventEffect(c: EventChoice): void {
  const e = c.effect;
  if (e.budgetFactor) state.credit(Math.round(state.budget * (e.budgetFactor - 1)));
  if (e.budget) state.credit(e.budget);
  if (e.rp) tree.award(e.rp);
  if (e.repState || e.repCommercial) program.adjust(e.repState ?? 0, e.repCommercial ?? 0);
  if (e.reliabilityMult && e.reliabilityLaunches)
    program.applyReliabilityMod(e.reliabilityMult, e.reliabilityLaunches);
  launchPanel.refreshPublic();
}

// Après chaque vol : fusée qui décolle du pas de tir, puis événement éventuel
launchPanel.onLaunch = (outcome, stages) => {
  const pad = bridge.padPosition();
  if (pad) fx.play(pad, outcome, stages);
  const ev = events.maybeTrigger({ recentFailure: outcome !== 'succes' });
  if (ev) eventModal.show(ev, applyEventEffect);
};

hud.onSelect = (typeId) => bridge.setPlacementType(typeId);
bridge.onParcelHover = (info) => hud.showParcelTooltip(info);

root.start(() => fx.update());

// @ts-expect-error — poignée de debug console
window.__root = root;
// @ts-expect-error — idem
window.__state = state;
// @ts-expect-error — idem
window.__fx = fx;
