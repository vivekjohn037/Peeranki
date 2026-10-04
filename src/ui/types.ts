export type WeaponType = 'gun' | 'peeranki' | 'shield' | 'hook' | 'doublePeeranki';
export type RpsChoice = 'rock' | 'paper' | 'scissors';

export interface UIPlayer {
  id: number;
  name: string;
  avatar?: string;
  stage: number; // 0 = Big Tower, 1 = Two Small Towers, 2 = One Tower, 3 = Destroyed
  alive: boolean;
  connected: boolean;
  weapons: WeaponType[];
  hasCollectedAllWeapons: boolean;
  eliminationPoints: number;
  shieldDisabledRound: number;
  duelChoice?: RpsChoice | null;
}

export interface HUDState {
  matchDurationMinutes: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  matchRound: number;
  gameStatus: string;
  roundPhase: 'counting' | 'shooting' | 'duel' | 'waiting' | 'finished';
  currentShooterIndex: number;
  isMyTurn: boolean;
  countNumber: number;
  statusMessage: string;
  announcementMessage: string;
  previousRoundMessage: string;
  selectedWeapon: WeaponType;
  availableWeapons: WeaponType[];
  pendingDoubleTargetIndex: number;
  isOffline: boolean;
  isHost: boolean;
  isMuted: boolean;
}

export interface DuelState {
  active: boolean;
  round: number;
  contestantIds: number[];
  canChoose: boolean;
  hasSubmitted: boolean;
  myChoice: RpsChoice | null;
  opponentName: string;
  opponentSubmitted: boolean;
  opponentChoice?: RpsChoice | null;
  resultMessage?: string;
}

export interface GameOverState {
  active: boolean;
  winners: UIPlayer[];
  allPlayers: UIPlayer[];
  matchDurationMinutes: number;
}

export interface UICallbacks {
  onShootPlayer: (targetIndex: number) => void;
  onSelectWeapon: (weapon: WeaponType) => void;
  onCycleWeapon: (direction: number) => void;
  onSubmitDuelChoice: (choice: RpsChoice) => void;
  onLeaveGame: () => void;
  onPlayAgain: () => void;
  onToggleAudio: () => boolean;
}

export type OrientationMode = 'portrait' | 'landscape';
