import type { DuelState, UICallbacks, RpsChoice } from './types';
import { addFreshTapListener } from './touchUtils';
import { escapeHtml } from './html';

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
  private pendingState: DuelState | null = null;
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private activeRound: number | null = null;
  private armed = false;
  private renderKey = '';

  public destroy() {
    if (this.revealTimer !== null) clearTimeout(this.revealTimer);
    if (this.armTimer !== null) clearTimeout(this.armTimer);
    this.revealTimer = this.armTimer = null;
    this.pendingState = null;
    this.activeRound = null;
    this.armed = false;
    this.renderKey = '';
    this.backdropEl.style.display = 'none';
  }

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
      this.destroy();
      this.currentChoice = null;
      return;
    }

    this.pendingState = state;
    if (this.activeRound !== state.round) {
      this.destroy();
      this.pendingState = state;
      this.activeRound = state.round;
      this.revealTimer = setTimeout(() => {
        this.revealTimer = null;
        if (this.pendingState) this.render(this.pendingState);
        this.armTimer = setTimeout(() => {
          this.armTimer = null;
          this.armed = true;
          if (this.pendingState) this.render(this.pendingState);
        }, 250);
      }, 750);
      return;
    }
    if (this.revealTimer !== null) return;
    this.render(state);
  }

  private render(state: DuelState) {
    const key = JSON.stringify([state, this.armed]);
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.backdropEl.style.display = 'flex';
    this.currentChoice = state.myChoice;
    const opponentNameHtml = escapeHtml(state.opponentName);
    const roundHtml = escapeHtml(state.round);

    this.dialogEl.innerHTML = `
      <div class="pk-duel-title">⚔️ DUEL ROUND ${roundHtml}</div>
      <div class="pk-duel-subtitle">
        ${state.canChoose ? 'Both remaining players choose simultaneously!' : 'Watching duel showdown...'}
      </div>
      <div class="pk-duel-versus-bar">
        <div class="pk-duel-fighter ${state.hasSubmitted ? 'is-ready' : 'is-waiting'}">
          <span class="pk-fighter-name">YOU</span>
          <span class="pk-fighter-badge">${state.hasSubmitted ? '🔒 LOCKED IN' : '⏳ CHOOSING...'}</span>
        </div>
        <div class="pk-duel-vs-divider">VS</div>
        <div class="pk-duel-fighter ${state.opponentSubmitted ? 'is-ready' : 'is-waiting'}">
          <span class="pk-fighter-name">${opponentNameHtml}</span>
          <span class="pk-fighter-badge">${state.opponentSubmitted ? '🔒 LOCKED IN' : '⏳ CHOOSING...'}</span>
        </div>
      </div>
      ${
        state.myChoice && state.opponentChoice
          ? `
          <div class="pk-duel-clash-box">
            <div class="pk-clash-card">
              <span class="pk-clash-icon">${RPS_CHOICES.find((c) => c.id === state.myChoice)?.emoji ?? '❓'}</span>
              <span class="pk-clash-label">YOU</span>
            </div>
            <div class="pk-clash-vs-text">VS</div>
            <div class="pk-clash-card">
              <span class="pk-clash-icon">${RPS_CHOICES.find((c) => c.id === state.opponentChoice)?.emoji ?? '❓'}</span>
              <span class="pk-clash-label">${opponentNameHtml}</span>
            </div>
          </div>
          `
          : ''
      }
      <div class="pk-rps-buttons-grid"></div>
      <div class="pk-duel-status-line"></div>
    `;

    const grid = this.dialogEl.querySelector('.pk-rps-buttons-grid')!;
    const statusLine = this.dialogEl.querySelector('.pk-duel-status-line')!;

    if (state.resultMessage) {
      statusLine.textContent = state.resultMessage;
    } else if (state.hasSubmitted && state.opponentSubmitted) {
      statusLine.textContent = 'Both choices locked! Revealing winner...';
    } else if (state.hasSubmitted) {
      statusLine.textContent = `Your choice is locked! Waiting for ${state.opponentName} to choose...`;
    } else if (!this.armed) {
      statusLine.textContent = 'Get ready…';
    } else if (state.canChoose) {
      statusLine.textContent = state.opponentSubmitted
        ? `${state.opponentName} is ready! Make your choice!`
        : 'Select Rock, Paper, or Scissors!';
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

      if (!this.armed || !state.canChoose || state.hasSubmitted) {
        btn.disabled = true;
        btn.style.opacity = this.currentChoice === choice.id ? '1' : '0.4';
      }

      btn.innerHTML = `
        <span class="pk-rps-emoji">${choice.emoji}</span>
        <span class="pk-rps-label">${choice.label}</span>
      `;

      if (this.armed && state.canChoose && !state.hasSubmitted) {
        addFreshTapListener(btn, () => {
          grid.querySelectorAll('button').forEach((button) => { button.disabled = true; });
          this.currentChoice = choice.id;
          this.callbacks.onSubmitDuelChoice(choice.id);
        });
      }

      grid.appendChild(btn);
    });
  }
}
