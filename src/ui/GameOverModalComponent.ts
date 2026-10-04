import type { GameOverState, UICallbacks } from './types';

export class GameOverModalComponent {
  private backdropEl: HTMLElement;
  private dialogEl: HTMLElement;
  private callbacks: UICallbacks;

  constructor(callbacks: UICallbacks) {
    this.callbacks = callbacks;

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'pk-modal-backdrop';
    this.backdropEl.style.display = 'none';

    this.dialogEl = document.createElement('div');
    this.dialogEl.className = 'pk-gameover-dialog';
    this.backdropEl.appendChild(this.dialogEl);
  }

  public getElement(): HTMLElement {
    return this.backdropEl;
  }

  public update(state: GameOverState) {
    if (!state.active) {
      this.backdropEl.style.display = 'none';
      return;
    }

    this.backdropEl.style.display = 'flex';

    const winnerNames = state.winners.map((w) => w.name).join(' & ') || 'Match Finished';

    // Sort players by elimination points descending, then weapons length
    const sorted = [...state.allPlayers].sort((a, b) => {
      if (b.eliminationPoints !== a.eliminationPoints) {
        return b.eliminationPoints - a.eliminationPoints;
      }
      return b.weapons.length - a.weapons.length;
    });

    let statsRowsHtml = '';
    sorted.forEach((player, rank) => {
      const isWinner = state.winners.some((w) => w.id === player.id);
      statsRowsHtml += `
        <div class="pk-gameover-stat-row">
          <span>${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank + 1}.`} ${player.name}${isWinner ? ' (Winner)' : ''}</span>
          <span style="font-weight: 700; color: #f2cf66;">⭐ ${player.eliminationPoints} pts · ${player.weapons.length} weapons</span>
        </div>
      `;
    });

    this.dialogEl.innerHTML = `
      <div class="pk-gameover-trophy">🏆</div>
      <div class="pk-gameover-title">MATCH COMPLETED</div>
      <div class="pk-gameover-winner-name">${winnerNames}</div>
      <div class="pk-gameover-stats-list">
        ${statsRowsHtml}
      </div>
      <div class="pk-gameover-actions-row">
        <button type="button" class="pk-btn-primary pk-btn-play-again">PLAY AGAIN</button>
        <button type="button" class="pk-btn-secondary pk-btn-main-menu">LEAVE</button>
      </div>
    `;

    const playAgainBtn = this.dialogEl.querySelector('.pk-btn-play-again')!;
    const mainMenuBtn = this.dialogEl.querySelector('.pk-btn-main-menu')!;

    playAgainBtn.addEventListener('click', () => {
      this.callbacks.onPlayAgain();
    });

    mainMenuBtn.addEventListener('click', () => {
      this.callbacks.onLeaveGame();
    });
  }
}
