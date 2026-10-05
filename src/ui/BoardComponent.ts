import type { UIPlayer, UICallbacks, OrientationMode } from './types';
import { getAvatarDef } from '../game/avatars';

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

interface PlayerCardView {
  card: HTMLDivElement;
  avatarImg: HTMLImageElement;
  nameSpan: HTMLSpanElement;
  roleSpan: HTMLSpanElement;
  towerImg: HTMLImageElement;
  stageName: HTMLDivElement;
  weaponsRow: HTMLDivElement;
  points: HTMLDivElement;
  hint: HTMLDivElement;
  targetIndex: number;
  isTargetable: boolean;
  weaponsKey: string;
  stageIdx: number;
  avatarId: string;
}

export class BoardComponent {
  private containerEl: HTMLElement;
  private gridEl: HTMLElement;
  private callbacks: UICallbacks;
  private previousStages = new Map<number, number>();
  private cards = new Map<number, PlayerCardView>();
  private lastShootTimestamp = 0;

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
    // Retain and update cards in-place to prevent DOM thrashing, cursor jitter, and lost clicks
    players.forEach((player, index) => {
      const isMe = player.id === localPlayerId;
      const isShooter = index === currentShooterIndex;
      const isEliminated = !player.alive || player.stage >= 3;
      const isTargetable = isMyTurn && !isMe && player.alive && player.connected;
      const isPendingDouble = index === pendingDoubleTargetIndex;
      const stageIdx = Math.max(0, Math.min(3, player.stage));

      let view = this.cards.get(player.id);
      if (!view) {
        const card = document.createElement('div');
        card.className = 'pk-player-card';

        const header = document.createElement('div');
        header.className = 'pk-card-header';

        const avatarImg = document.createElement('img');
        avatarImg.className = 'pk-card-avatar-img';
        avatarImg.style.width = '22px';
        avatarImg.style.height = '22px';
        avatarImg.style.flexShrink = '0';
        avatarImg.style.borderRadius = '50%';
        avatarImg.style.marginRight = '5px';
        avatarImg.style.verticalAlign = 'middle';
        avatarImg.style.display = 'inline-block';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'pk-card-name';

        const roleSpan = document.createElement('span');
        roleSpan.className = 'pk-card-role-tag';

        header.appendChild(avatarImg);
        header.appendChild(nameSpan);
        header.appendChild(roleSpan);

        const towerWrapper = document.createElement('div');
        towerWrapper.className = 'pk-tower-stage-wrapper';

        const towerImg = document.createElement('img');
        towerImg.className = 'pk-tower-img';
        towerImg.src = TOWER_IMAGES[stageIdx];
        towerImg.alt = STAGE_NAMES[stageIdx];
        towerWrapper.appendChild(towerImg);

        const stageName = document.createElement('div');
        stageName.className = 'pk-card-stage-name';

        const weaponsRow = document.createElement('div');
        weaponsRow.className = 'pk-card-weapons-row';

        const points = document.createElement('div');
        points.className = 'pk-card-points';

        const hint = document.createElement('div');
        hint.className = 'pk-target-hint';
        hint.style.display = 'none';

        card.appendChild(header);
        card.appendChild(towerWrapper);
        card.appendChild(stageName);
        card.appendChild(weaponsRow);
        card.appendChild(points);
        card.appendChild(hint);

        // Immediate responsive shooting for mouse click, touch tap, and keyboard
        const handleShoot = (e: Event) => {
          const currentView = this.cards.get(player.id);
          if (!currentView || !currentView.isTargetable) return;
          if ('button' in e && (e as MouseEvent).button !== 0) return;

          const now = Date.now();
          if (now - this.lastShootTimestamp < 250) return;
          this.lastShootTimestamp = now;

          e.preventDefault();
          e.stopPropagation();

          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try {
              navigator.vibrate(25);
            } catch {
              // ignore
            }
          }

          this.callbacks.onShootPlayer(currentView.targetIndex);
        };

        card.addEventListener('pointerdown', handleShoot);
        card.addEventListener('click', handleShoot);
        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleShoot(e);
          }
        });

        view = {
          card,
          avatarImg,
          nameSpan,
          roleSpan,
          towerImg,
          stageName,
          weaponsRow,
          points,
          hint,
          targetIndex: index,
          isTargetable: false,
          weaponsKey: '',
          stageIdx,
          avatarId: '',
        };

        this.cards.set(player.id, view);
        this.gridEl.appendChild(card);
      }

      // Update dynamic target and state references
      view.targetIndex = index;
      view.isTargetable = isTargetable;

      // Ensure stable DOM order
      if (this.gridEl.children[index] !== view.card) {
        this.gridEl.appendChild(view.card);
      }

      // State CSS classes
      view.card.classList.toggle('pk-is-shooter', isShooter && player.alive);
      view.card.classList.toggle('pk-is-targetable', isTargetable);
      view.card.classList.toggle('pk-pending-double', isPendingDouble);
      view.card.classList.toggle('pk-eliminated', isEliminated);
      view.card.classList.toggle('pk-disconnected', !player.connected);

      // Avatar & Name tags
      const avatarDef = getAvatarDef(player.avatar);
      if (view.avatarId !== avatarDef.id) {
        view.avatarId = avatarDef.id;
        view.avatarImg.src = avatarDef.svgPath;
        view.avatarImg.alt = avatarDef.name;
        view.avatarImg.title = `${avatarDef.name} (${avatarDef.title})`;
        view.avatarImg.style.border = `2px solid ${avatarDef.color}`;
      }
      view.avatarImg.style.display = player.connected ? 'inline-block' : 'none';

      const nameText = player.connected ? `${avatarDef.emoji} ${player.name}` : `Slot ${player.id} (Empty)`;
      if (view.nameSpan.textContent !== nameText) {
        view.nameSpan.textContent = nameText;
      }

      let roleText = '';
      let isShooterBadge = false;
      if (isMe) {
        roleText = 'YOU';
      } else if (isShooter && player.alive) {
        roleText = 'SHOOTER';
        isShooterBadge = true;
      } else if (!player.connected) {
        roleText = 'OFFLINE';
      }

      if (view.roleSpan.textContent !== roleText) {
        view.roleSpan.textContent = roleText;
      }
      view.roleSpan.classList.toggle('shooter-badge', isShooterBadge);

      // Tower visual & stage name
      if (view.stageIdx !== stageIdx) {
        view.stageIdx = stageIdx;
        view.towerImg.src = TOWER_IMAGES[stageIdx];
        view.towerImg.alt = STAGE_NAMES[stageIdx];
        const stageLabel = player.connected ? STAGE_NAMES[stageIdx] : 'Available Slot';
        if (view.stageName.textContent !== stageLabel) {
          view.stageName.textContent = stageLabel;
        }

        const prevStage = this.previousStages.get(player.id);
        if (prevStage !== undefined && player.stage > prevStage && player.alive) {
          view.towerImg.classList.remove('pk-tower-shake');
          void view.towerImg.offsetWidth; // Trigger reflow for clean re-shake
          view.towerImg.classList.add('pk-tower-shake');
        }
      } else {
        const stageLabel = player.connected ? STAGE_NAMES[stageIdx] : 'Available Slot';
        if (view.stageName.textContent !== stageLabel) {
          view.stageName.textContent = stageLabel;
        }
      }
      this.previousStages.set(player.id, player.stage);

      // Weapons inventory row
      const weaponsKey = player.connected && player.weapons ? player.weapons.join(',') : '';
      if (view.weaponsKey !== weaponsKey) {
        view.weaponsKey = weaponsKey;
        view.weaponsRow.innerHTML = '';
        if (player.connected && player.weapons?.length > 0) {
          player.weapons.forEach((weapon) => {
            const icon = document.createElement('img');
            icon.className = 'pk-card-weapon-icon';
            const fileName = weapon === 'doublePeeranki' ? 'double_peeranki' : weapon;
            icon.src = `assets/weapons/${fileName}.png`;
            icon.alt = weapon;
            icon.title = weapon;
            view.weaponsRow.appendChild(icon);
          });
        }
      }

      // Elimination points
      const pointsText = player.connected
        ? `⭐ ${player.eliminationPoints} pt${player.eliminationPoints === 1 ? '' : 's'}`
        : '';
      if (view.points.textContent !== pointsText) {
        view.points.textContent = pointsText;
      }

      // Target Hint Badge
      if (isPendingDouble) {
        view.hint.style.display = 'block';
        view.hint.style.background = '#f2cf66';
        view.hint.style.color = '#111';
        view.hint.textContent = '1ST TARGET';
      } else if (isTargetable) {
        view.hint.style.display = 'block';
        view.hint.style.background = '';
        view.hint.style.color = '';
        view.hint.textContent = 'CLICK TO SHOOT';
      } else {
        view.hint.style.display = 'none';
      }

      // Accessibility
      if (isTargetable) {
        view.card.setAttribute('role', 'button');
        view.card.setAttribute('tabindex', '0');
        view.card.setAttribute('aria-label', `Shoot ${player.name}`);
      } else {
        view.card.removeAttribute('role');
        view.card.removeAttribute('tabindex');
        view.card.removeAttribute('aria-label');
      }
    });

    // Remove any stale player cards
    for (const [id, view] of this.cards.entries()) {
      if (!players.some((p) => p.id === id)) {
        view.card.remove();
        this.cards.delete(id);
      }
    }
  }

  public triggerDamageFlash(targetIndex: number) {
    for (const view of this.cards.values()) {
      if (view.targetIndex === targetIndex) {
        view.card.classList.remove('pk-card-damage-flash');
        void view.card.offsetWidth;
        view.card.classList.add('pk-card-damage-flash');
        view.towerImg.classList.remove('pk-tower-shake');
        void view.towerImg.offsetWidth;
        view.towerImg.classList.add('pk-tower-shake');
        break;
      }
    }
  }
}

