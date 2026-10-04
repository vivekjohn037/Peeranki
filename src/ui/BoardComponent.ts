import type { UIPlayer, UICallbacks, OrientationMode } from './types';

const STAGE_NAMES = [
  'Big Tower',
  'Two Small Towers',
  'One Tower',
  'Eliminated',
];

const TOWER_IMAGES = [
  'assets/towers/tower_big.png',
  'assets/towers/tower_small.png',
  'assets/towers/tower_one.png',
  'assets/towers/tower_destroyed.png',
];

export class BoardComponent {
  private containerEl: HTMLElement;
  private gridEl: HTMLElement;
  private callbacks: UICallbacks;
  private previousStages = new Map<number, number>();

  constructor(callbacks: UICallbacks) {
    this.callbacks = callbacks;
    this.containerEl = document.createElement('main');
    this.containerEl.className = 'pk-board-scroll-area';

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'pk-board-grid';
    this.containerEl.appendChild(this.gridEl);
  }

  public getElement(): HTMLElement {
    return this.containerEl;
  }

  public update(
    players: UIPlayer[],
    currentShooterIndex: number,
    localPlayerId: number,
    isMyTurn: boolean,
    pendingDoubleTargetIndex: number,
    _orientation: OrientationMode,
  ) {
    this.gridEl.innerHTML = '';

    players.forEach((player, index) => {
      const isMe = player.id === localPlayerId;
      const isShooter = index === currentShooterIndex;
      const isEliminated = !player.alive || player.stage >= 3;
      const isTargetable = isMyTurn && !isMe && player.alive && player.connected;
      const isPendingDouble = index === pendingDoubleTargetIndex;

      const card = document.createElement('div');
      card.className = 'pk-player-card';

      if (isShooter && player.alive) card.classList.add('pk-is-shooter');
      if (isTargetable) card.classList.add('pk-is-targetable');
      if (isPendingDouble) card.classList.add('pk-pending-double');
      if (isEliminated) card.classList.add('pk-eliminated');
      if (!player.connected) card.classList.add('pk-disconnected');

      // Check if stage changed to trigger damage shake
      const prevStage = this.previousStages.get(player.id);
      const stageChanged = prevStage !== undefined && prevStage !== player.stage;
      this.previousStages.set(player.id, player.stage);

      // Card Header
      const header = document.createElement('div');
      header.className = 'pk-card-header';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'pk-card-name';
      nameSpan.textContent = player.connected ? player.name : `Slot ${player.id} (Empty)`;

      const roleSpan = document.createElement('span');
      roleSpan.className = 'pk-card-role-tag';
      if (isMe) {
        roleSpan.textContent = 'YOU';
      } else if (isShooter && player.alive) {
        roleSpan.className += ' shooter-badge';
        roleSpan.textContent = 'SHOOTER';
      } else if (!player.connected) {
        roleSpan.textContent = 'OFFLINE';
      }
      header.appendChild(nameSpan);
      header.appendChild(roleSpan);

      // Tower Visual
      const towerWrapper = document.createElement('div');
      towerWrapper.className = 'pk-tower-stage-wrapper';

      const towerImg = document.createElement('img');
      towerImg.className = 'pk-tower-img';
      const stageIdx = Math.max(0, Math.min(3, player.stage));
      towerImg.src = TOWER_IMAGES[stageIdx];
      towerImg.alt = STAGE_NAMES[stageIdx];

      if (stageChanged && player.alive) {
        towerImg.classList.add('pk-tower-shake');
      }

      towerWrapper.appendChild(towerImg);

      // Card Stage Name
      const stageName = document.createElement('div');
      stageName.className = 'pk-card-stage-name';
      stageName.textContent = player.connected ? STAGE_NAMES[stageIdx] : 'Available Slot';

      // Weapons inventory row
      const weaponsRow = document.createElement('div');
      weaponsRow.className = 'pk-card-weapons-row';
      if (player.connected && player.weapons?.length > 0) {
        player.weapons.forEach((weapon) => {
          const icon = document.createElement('img');
          icon.className = 'pk-card-weapon-icon';
          const fileName = weapon === 'doublePeeranki' ? 'double_peeranki' : weapon;
          icon.src = `assets/weapons/${fileName}.png`;
          icon.alt = weapon;
          icon.title = weapon;
          weaponsRow.appendChild(icon);
        });
      }

      // Elimination Points
      const points = document.createElement('div');
      points.className = 'pk-card-points';
      if (player.connected) {
        points.textContent = `⭐ ${player.eliminationPoints} pt${player.eliminationPoints === 1 ? '' : 's'}`;
      }

      // Append elements
      card.appendChild(header);
      card.appendChild(towerWrapper);
      card.appendChild(stageName);
      card.appendChild(weaponsRow);
      card.appendChild(points);

      // Target Hint Badge
      if (isPendingDouble) {
        const hint = document.createElement('div');
        hint.className = 'pk-target-hint';
        hint.style.background = '#f2cf66';
        hint.style.color = '#111';
        hint.textContent = '1ST TARGET';
        card.appendChild(hint);
      } else if (isTargetable) {
        const hint = document.createElement('div');
        hint.className = 'pk-target-hint';
        hint.textContent = 'TAP TO SHOOT';
        card.appendChild(hint);
      }

      // Tap / Click Interaction
      if (isTargetable) {
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `Shoot ${player.name}`);

        const handleSelect = (e: Event) => {
          e.preventDefault();
          this.callbacks.onShootPlayer(index);
        };

        card.addEventListener('click', handleSelect);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleSelect(e);
          }
        });
      }

      this.gridEl.appendChild(card);
    });
  }
}
