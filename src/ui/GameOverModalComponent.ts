import type { GameOverState, UICallbacks } from './types';

const CONFETTI_COUNT = 44;
const CONFETTI_COLORS = [
  '#f2cf66', // Gold
  '#38e08d', // Emerald
  '#3b82f6', // Sapphire
  '#ef4444', // Ruby
  '#a855f7', // Amethyst
  '#f97316', // Orange
  '#06b6d4', // Cyan
  '#ec4899', // Pink
  '#facc15', // Bright yellow
  '#10b981', // Mint
];

export class GameOverModalComponent {
  private backdropEl: HTMLElement;
  private dialogEl: HTMLElement;
  private callbacks: UICallbacks;
  private isShowing = false;
  private currentWinnerKey = '';

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

  private generateConfettiHtml(): string {
    let html = '<div class="pk-confetti-container" aria-hidden="true">';
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      // Radial burst outwards biased upwards from the trophy
      const angle = (i / CONFETTI_COUNT) * 2 * Math.PI + (Math.random() - 0.5) * 0.45;
      const speed = 75 + Math.random() * 145;
      const burstX = Math.round(Math.cos(angle) * speed);
      const burstY = Math.round(Math.sin(angle) * speed - 35);
      const fallX = burstX + Math.round((Math.random() - 0.5) * 70);
      const fallY = Math.round(200 + Math.random() * 180);
      const rot = Math.round((Math.random() - 0.5) * 800);
      const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      const delay = (Math.random() * 0.45).toFixed(2);
      const duration = (2.2 + Math.random() * 1.1).toFixed(2);
      const shapeType = i % 4 === 0 ? 'star' : i % 4 === 1 ? 'circle' : i % 4 === 2 ? 'streamer' : 'rect';

      html += `<span class="pk-confetti-piece pk-confetti-${shapeType}" style="--burst-x:${burstX}px; --burst-y:${burstY}px; --fall-x:${fallX}px; --fall-y:${fallY}px; --rot:${rot}deg; --confetti-color:${color}; --delay:${delay}s; --duration:${duration}s;"></span>`;
    }
    html += '</div>';
    return html;
  }

  public update(state: GameOverState) {
    if (!state.active) {
      this.backdropEl.style.display = 'none';
      this.isShowing = false;
      this.currentWinnerKey = '';
      return;
    }

    this.backdropEl.style.display = 'flex';

    const winnerNames = state.winners.map((w) => w.name).join(' & ') || 'Match Finished';
    const winnerKey = `${state.winners.map((w) => `${w.id}-${w.eliminationPoints}`).join(',')}:${state.allPlayers.length}`;

    if (this.isShowing && this.currentWinnerKey === winnerKey) {
      return;
    }

    this.isShowing = true;
    this.currentWinnerKey = winnerKey;

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

    const confettiHtml = this.generateConfettiHtml();

    this.dialogEl.innerHTML = `
      ${confettiHtml}
      <div class="pk-gameover-content">
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
