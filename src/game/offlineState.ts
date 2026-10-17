import type { AnimalAvatarId } from './avatars.ts';
import { getBotAvatarId, getSelectedAvatarId } from './avatars.ts';
import type { RpsChoice, WeaponType } from './rules.ts';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const DEFAULT_OFFLINE_PLAYERS = 3;

export interface MatchPlayer {
  id: number;
  name: string;
  avatar: AnimalAvatarId;
  stage: number;
  alive: boolean;
  sessionId: string;
  connected: boolean;
  lastSeen: string;
  weapons: WeaponType[];
  hasCollectedAllWeapons: boolean;
  eliminationPoints: number;
  shieldDisabledRound: number;
  matchStartedAt: string;
  matchRound: number;
  countingStartIndex: number;
  roundWinnerId: number;
  matchOver: boolean;
  actionRequest: unknown;
  duelChoice: RpsChoice | null;
  duelChoiceRequest: unknown;
}

export interface OfflineMatchInitOptions {
  playerName: string;
  totalPlayers: number;
  selectedAvatar?: AnimalAvatarId;
}

export interface OfflineMatchState {
  offlineMode: boolean;
  offlineMaxPlayers: number;
  maxPlayers: number;
  players: MatchPlayer[];
  offlinePlayers: MatchPlayer[];
  myPlayerId: number;
  roomCode: string;
  hostSessionId: string;
  isPublicRoom: boolean;
  matchRound: number;
  duelRound: number;
  lastRoundMessage: string;
  roundWinnerId: number;
  matchOver: boolean;
  countingStartIndex: number;
  countingStartedAt: string;
  shootingDeadlineAt: string;
  matchStartedAt: string;
}

/**
 * Validates and clamps total player count for offline bot games (2 to 10).
 */
export function validateOfflinePlayerCount(count: number): number {
  if (!Number.isInteger(count) || count < MIN_PLAYERS) {
    return DEFAULT_OFFLINE_PLAYERS;
  }
  return Math.min(count, MAX_PLAYERS);
}

/**
 * Creates a brand new array of players for offline bot matches.
 * Player 1 is always the human player.
 * Players 2..totalPlayers are fresh bots with distinct bot names and avatars.
 */
export function createOfflinePlayers(
  playerName: string,
  totalPlayers: number,
  selectedAvatar: AnimalAvatarId = getSelectedAvatarId(),
): MatchPlayer[] {
  const validCount = validateOfflinePlayerCount(totalPlayers);
  const now = new Date().toISOString();
  const humanName = (playerName && playerName.trim()) ? playerName.trim() : 'Player';

  const freshPlayers: MatchPlayer[] = [
    {
      id: 1,
      name: humanName,
      avatar: selectedAvatar,
      stage: 0,
      alive: true,
      sessionId: 'offline-human',
      connected: true,
      lastSeen: now,
      weapons: ['gun'],
      hasCollectedAllWeapons: false,
      eliminationPoints: 0,
      shieldDisabledRound: -1,
      matchStartedAt: now,
      matchRound: 1,
      countingStartIndex: -1,
      roundWinnerId: 0,
      matchOver: false,
      actionRequest: null,
      duelChoice: null,
      duelChoiceRequest: null,
    },
  ];

  for (let i = 2; i <= validCount; i++) {
    freshPlayers.push({
      id: i,
      name: `Bot ${i - 1}`,
      avatar: getBotAvatarId(i - 1),
      stage: 0,
      alive: true,
      sessionId: `offline-bot-${i}`,
      connected: true,
      lastSeen: now,
      weapons: ['gun'],
      hasCollectedAllWeapons: false,
      eliminationPoints: 0,
      shieldDisabledRound: -1,
      matchStartedAt: now,
      matchRound: 1,
      countingStartIndex: -1,
      roundWinnerId: 0,
      matchOver: false,
      actionRequest: null,
      duelChoice: null,
      duelChoiceRequest: null,
    });
  }

  return freshPlayers;
}

/**
 * Clears stale multiplayer room tokens from session storage without touching
 * unrelated user settings (player name, audio preferences, avatar choice, etc.).
 */
export function clearSessionRoomData(storage?: Storage): void {
  const targetStorage = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);
  if (!targetStorage) {
    return;
  }
  try {
    targetStorage.removeItem('peeranki-room-code');
    targetStorage.removeItem('peeranki-room-public');
  } catch {
    // Ignore storage access errors in restricted sandbox contexts
  }
}

/**
 * Initializes a complete, isolated offline bot match state.
 * Resets all match-specific state, weapons, elimination scores, round counters,
 * duel variables, and ensures NO online room metadata remains.
 */
export function initializeOfflineMatchState(options: OfflineMatchInitOptions): OfflineMatchState {
  const validCount = validateOfflinePlayerCount(options.totalPlayers);
  const humanAvatar = options.selectedAvatar || getSelectedAvatarId();
  const freshPlayers = createOfflinePlayers(options.playerName, validCount, humanAvatar);
  const now = new Date().toISOString();

  // Clear any existing online room traces from session storage
  clearSessionRoomData();

  return {
    offlineMode: true,
    offlineMaxPlayers: validCount,
    maxPlayers: validCount,
    players: freshPlayers,
    offlinePlayers: freshPlayers,
    myPlayerId: 1,
    roomCode: '',
    hostSessionId: 'offline-human',
    isPublicRoom: false,
    matchRound: 1,
    duelRound: 1,
    lastRoundMessage: '',
    roundWinnerId: 0,
    matchOver: false,
    countingStartIndex: -1,
    countingStartedAt: '',
    shootingDeadlineAt: '',
    matchStartedAt: now,
  };
}
