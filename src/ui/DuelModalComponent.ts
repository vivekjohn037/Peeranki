import type { DuelState, UICallbacks, RpsChoice } from './types';

const RPS_CHOICES: { id: RpsChoice; label: string; emoji: string }[] = [
  { id: 'rock', label: 'Rock', emoji: '🪨' },
  { id: 'paper', label: 'Paper', emoji: '📄' },
  { id: 'scissors', label: 'Scissors', emoji: '✂️' },
];

export class DuelModalComponent {
  private backdropEl: HTMLElement;
  private dialogEl: HTMLElement;
  private callbacks: UICallbacks;
  private currentChoice: RpsChoice | null = null;

  constructor(callbacks: UICallbacks) {
    this.callbacks = callbacks;

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'pk-modal-backdrop';
    this.backdropEl.style.display = 'none';

    this.dialogEl = document.createElement('div');
    this.dialogEl.className = 'pk-duel-card-dialog';
    this.backdropEl.appendChild(this.dialogEl);
  }

  public getElement(): HTMLElement {
    return this.backdropEl;
  }

  public update(state: DuelState) {
    if (!state.active) {
      this.backdropEl.style.display = 'none';
      this.currentChoice = null;
      return;
    }

    this.backdropEl.style.display = 'flex';
    this.currentChoice = state.myChoice;

    this.dialogEl.innerHTML = `
      <div class="pk-duel-title">⚔️ DUEL ROUND ${state.round}</div>
      <div class="pk-duel-subtitle">
        ${state.canChoose ? 'Both remaining players choose at the same time!' : 'Watching duel showdown...'}
      </div>
      <div class="pk-rps-buttons-grid"></div>
      <div class="pk-duel-status-line"></div>
    `;

    const grid = this.dialogEl.querySelector('.pk-rps-buttons-grid')!;
    const statusLine = this.dialogEl.querySelector('.pk-duel-status-line')!;

    if (state.resultMessage) {
      statusLine.textContent = state.resultMessage;
    } else if (state.hasSubmitted) {
      statusLine.textContent = 'Choice locked! Waiting for the other player...';
    } else if (state.canChoose) {
      statusLine.textContent = 'Make your selection before time expires!';
    } else {
      statusLine.textContent = `Contestants are deciding...`;
    }

    RPS_CHOICES.forEach((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pk-rps-choice-btn';
      if (this.currentChoice === choice.id) {
        btn.classList.add('pk-selected');
      }

      if (!state.canChoose || state.hasSubmitted) {
        btn.disabled = true;
        btn.style.opacity = this.currentChoice === choice.id ? '1' : '0.4';
      }

      btn.innerHTML = `
        <span class="pk-rps-emoji">${choice.emoji}</span>
        <span class="pk-rps-label">${choice.label}</span>
      `;

      if (state.canChoose && !state.hasSubmitted) {
        btn.addEventListener('click', () => {
          this.currentChoice = choice.id;
          this.callbacks.onSubmitDuelChoice(choice.id);
        });
      }

      grid.appendChild(btn);
    });
  }
}
