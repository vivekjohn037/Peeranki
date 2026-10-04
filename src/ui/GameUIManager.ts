import type {
  UIPlayer,
  HUDState,
  DuelState,
  GameOverState,
  UICallbacks,
  OrientationMode,
} from './types';
import { HUDComponent } from './HUDComponent';
import { BoardComponent } from './BoardComponent';
import { DuelModalComponent } from './DuelModalComponent';
import { GameOverModalComponent } from './GameOverModalComponent';
import './styles.css';

export class GameUIManager {
  private rootEl: HTMLElement | null = null;
  private containerEl: HTMLElement | null = null;
  private hud: HUDComponent | null = null;
  private board: BoardComponent | null = null;
  private duelModal: DuelModalComponent | null = null;
  private gameOverModal: GameOverModalComponent | null = null;

  private currentOrientation: OrientationMode = 'landscape';
  private resizeObserver: ResizeObserver | null = null;
  private boundResizeHandler: (() => void) | null = null;

  // requestAnimationFrame batching for smooth rendering and latency mitigation
  private rafId: number | null = null;
  private pendingHUDState: HUDState | null = null;
  private pendingBoardArgs: {
    players: UIPlayer[];
    currentShooterIndex: number;
    localPlayerId: number;
    isMyTurn: boolean;
    pendingDoubleTargetIndex: number;
  } | null = null;
  private pendingDuelState: DuelState | null = null;
  private pendingGameOverState: GameOverState | null = null;

  public mount(parentSelector = '#game', callbacks: UICallbacks): boolean {
    this.unmount();

    const parent = document.querySelector(parentSelector);
    if (!parent) {
      console.warn(`[GameUIManager] Target container "${parentSelector}" not found.`);
      return false;
    }

    // Root UI container
    this.rootEl = document.createElement('div');
    this.rootEl.id = 'game-ui-root';

    this.containerEl = document.createElement('div');
    this.containerEl.className = 'pk-layout-container';
    this.rootEl.appendChild(this.containerEl);

    // Initialize Subcomponents
    this.hud = new HUDComponent(callbacks);
    this.board = new BoardComponent(callbacks);
    this.duelModal = new DuelModalComponent(callbacks);
    this.gameOverModal = new GameOverModalComponent(callbacks);

    // Assemble Hierarchy
    this.containerEl.appendChild(this.hud.getTopBar());
    this.containerEl.appendChild(this.hud.getAnnouncer());
    this.containerEl.appendChild(this.board.getElement());
    this.containerEl.appendChild(this.hud.getBottomBar());
    this.rootEl.appendChild(this.hud.getCountdown());
    this.rootEl.appendChild(this.duelModal.getElement());
    this.rootEl.appendChild(this.gameOverModal.getElement());

    parent.appendChild(this.rootEl);

    // Set up responsive orientation detection
    this.setupOrientationHandling(parent as HTMLElement);

    return true;
  }

  private setupOrientationHandling(parent: HTMLElement) {
    const updateOrientation = () => {
      const width = parent.clientWidth || window.innerWidth;
      const height = parent.clientHeight || window.innerHeight;
      const isPortrait = height > width;
      const newOrientation: OrientationMode = isPortrait ? 'portrait' : 'landscape';

      this.currentOrientation = newOrientation;

      if (this.rootEl) {
        this.rootEl.classList.remove('pk-orientation-portrait', 'pk-orientation-landscape');
        this.rootEl.classList.add(`pk-orientation-${newOrientation}`);
      }
    };

    updateOrientation();

    this.boundResizeHandler = () => updateOrientation();
    window.addEventListener('resize', this.boundResizeHandler, { passive: true });
    window.addEventListener('orientationchange', this.boundResizeHandler, { passive: true });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => updateOrientation());
      this.resizeObserver.observe(parent);
    }
  }

  private scheduleRender() {
    if (this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => this.flushRender());
  }

  public flushRender() {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.pendingHUDState && this.hud) {
      this.hud.update(this.pendingHUDState);
      this.pendingHUDState = null;
    }

    if (this.pendingBoardArgs && this.board) {
      const args = this.pendingBoardArgs;
      this.pendingBoardArgs = null;
      this.board.update(
        args.players,
        args.currentShooterIndex,
        args.localPlayerId,
        args.isMyTurn,
        args.pendingDoubleTargetIndex,
        this.currentOrientation,
      );
    }

    if (this.pendingDuelState && this.duelModal) {
      this.duelModal.update(this.pendingDuelState);
      this.pendingDuelState = null;
    }

    if (this.pendingGameOverState && this.gameOverModal) {
      this.gameOverModal.update(this.pendingGameOverState);
      this.pendingGameOverState = null;
    }
  }

  public updateHUD(state: HUDState, immediate = false) {
    this.pendingHUDState = state;
    if (immediate) {
      this.flushRender();
    } else {
      this.scheduleRender();
    }
  }

  public updateBoard(
    players: UIPlayer[],
    currentShooterIndex: number,
    localPlayerId: number,
    isMyTurn: boolean,
    pendingDoubleTargetIndex: number,
    immediate = false,
  ) {
    this.pendingBoardArgs = {
      players,
      currentShooterIndex,
      localPlayerId,
      isMyTurn,
      pendingDoubleTargetIndex,
    };
    if (immediate) {
      this.flushRender();
    } else {
      this.scheduleRender();
    }
  }

  public updateDuel(state: DuelState, immediate = false) {
    this.pendingDuelState = state;
    if (immediate) {
      this.flushRender();
    } else {
      this.scheduleRender();
    }
  }

  public updateGameOver(state: GameOverState, immediate = false) {
    this.pendingGameOverState = state;
    if (immediate) {
      this.flushRender();
    } else {
      this.scheduleRender();
    }
  }

  public unmount() {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingHUDState = null;
    this.pendingBoardArgs = null;
    this.pendingDuelState = null;
    this.pendingGameOverState = null;

    if (this.boundResizeHandler) {
      window.removeEventListener('resize', this.boundResizeHandler);
      window.removeEventListener('orientationchange', this.boundResizeHandler);
      this.boundResizeHandler = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.rootEl && this.rootEl.parentElement) {
      this.rootEl.parentElement.removeChild(this.rootEl);
    }

    this.rootEl = null;
    this.containerEl = null;
    this.hud = null;
    this.board = null;
    this.duelModal = null;
    this.gameOverModal = null;
  }
}
