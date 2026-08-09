import type { EventChoice, EventDef } from '../state/events';

// Modal d'événement — bloque l'écran jusqu'au choix du joueur (GDD 5 : réponses
// à double tranchant). DOM uniquement ; l'application des effets est déléguée.

const CATEGORY_LABEL: Record<string, string> = {
  politique: 'Politique',
  scientifique: 'Scientifique',
  economique: 'Économique',
  interne: 'Interne',
};

const CSS = `
  #hud-event-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 100;
    display: none; align-items: center; justify-content: center;
  }
  #hud-event {
    width: 420px; max-width: 90vw; padding: 20px; font-family: system-ui, sans-serif;
    background: #191c21; border: 1px solid #4FD1C5; border-radius: 12px; color: #d8dde4;
  }
  #hud-event .cat { font-size: 12px; color: #4FD1C5; text-transform: uppercase; letter-spacing: .05em; }
  #hud-event h2 { margin: 4px 0 10px; font-size: 20px; }
  #hud-event p { margin: 0 0 16px; line-height: 1.5; color: #b8bec6; }
  #hud-event button {
    display: block; width: 100%; margin: 8px 0; padding: 10px 12px; text-align: left;
    background: #22252b; color: #d8dde4; border: 1px solid #3a3e46; border-radius: 8px;
    cursor: pointer; font-size: 14px;
  }
  #hud-event button:hover { border-color: #4FD1C5; background: #24413d; }
  #hud-event button .note { display: block; margin-top: 4px; font-size: 12px; color: #9aa1ab; }
`;

export class EventModal {
  private backdrop: HTMLElement;
  private box: HTMLElement;
  private onChoose: (c: EventChoice) => void = () => {};

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.backdrop = document.createElement('div');
    this.backdrop.id = 'hud-event-backdrop';
    this.box = document.createElement('div');
    this.box.id = 'hud-event';
    this.backdrop.appendChild(this.box);
    parent.appendChild(this.backdrop);
  }

  show(def: EventDef, onChoose: (c: EventChoice) => void): void {
    this.onChoose = onChoose;
    this.box.innerHTML =
      `<div class="cat">${CATEGORY_LABEL[def.category] ?? def.category}</div>` +
      `<h2>${def.title}</h2><p>${def.description}</p>`;
    for (const choice of def.choices) {
      const btn = document.createElement('button');
      btn.innerHTML = `${choice.label}${choice.note ? `<span class="note">${choice.note}</span>` : ''}`;
      btn.addEventListener('click', () => {
        this.backdrop.style.display = 'none';
        this.onChoose(choice);
      });
      this.box.appendChild(btn);
    }
    this.backdrop.style.display = 'flex';
  }
}
