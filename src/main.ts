import Phaser from 'phaser';
import './style.css';
import { GameUIManager } from './ui/GameUIManager';
import type { HUDState, UIPlayer, DuelState, GameOverState } from './ui/types';
import { PeerankiAudio } from './audio/PeerankiAudio';
import { showHowToPlayModal } from './ui/HowToPlayModalComponent';
import { showExitGameModal } from './ui/ExitGameModalComponent';
import {
  type AnimalAvatarId,
  AVATAR_IDS,
  getSelectedAvatarId,
  getAvatarDef,
  getBotAvatarId,
} from './game/avatars';
import { chooseBotAction, resolvePlayerAction } from './game/engine';
import type { ActionResolution, PlayerAction } from './game/engine';
import {
  ACTIVE_WEAPONS,
  findMatchWinners,
  getCountedPlayerIndex,
  getNextCountingStartIndex,
  hasAllWeapons,
  MATCH_DURATIONS,
  nextWeaponUpgrade,
  normalizeRpsChoice,
  normalizeWeapons,
  resolveRpsWinner,
  RPS_CHOICES,
  RPS_LABELS,
  WEAPON_LABELS,
  WEAPON_NAMES,
  WEAPON_ORDER,
} from './game/rules';
import type { RpsChoice, WeaponType } from './game/rules';

import {
  broadcastRoomStateDelta,
  saveGameState,
  subscribeToGameState,
  createPrivateRoom,
  joinRoom,
  findOrCreateRandomRoom,
  fetchGameRoom,
  leaveRoom,
  leaveRoomBestEffort,
  touchPlayer,
  cleanupStalePlayers,
  getStoredServerRegion,
  setStoredServerRegion,
  supabase,
} from './supabase';

interface Player {
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
  actionRequest: OnlineAction | null;
  duelChoice: RpsChoice | null;
  duelChoiceRequest: OnlineDuelChoiceRequest | null;
}

type OnlineAction = PlayerAction & { nonce: string };
type OnlineDuelChoiceRequest = { nonce: string; playerId: number; round: number; choice: RpsChoice };

function normalizeOnlineAction(value: unknown): OnlineAction | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.nonce !== 'string' || !raw.nonce || !Number.isInteger(raw.shooterId) ||
      typeof raw.weapon !== 'string' || !ACTIVE_WEAPONS.includes(raw.weapon as WeaponType) ||
      !Array.isArray(raw.targetIds) || raw.targetIds.length < 1 || raw.targetIds.length > 2 ||
      !raw.targetIds.every((id) => Number.isInteger(id))) return null;
  return { nonce: raw.nonce, shooterId: raw.shooterId as number, weapon: raw.weapon as WeaponType, targetIds: raw.targetIds as number[] };
}

let matchDurationMinutes: (typeof MATCH_DURATIONS)[number] = 5;
const matchDurationMs = () => matchDurationMinutes * 60 * 1000;

function normalizeDuelChoiceRequest(value: unknown): OnlineDuelChoiceRequest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const choice = normalizeRpsChoice(raw.choice);
  if (typeof raw.nonce !== 'string' || !raw.nonce ||
      !Number.isInteger(raw.playerId) || !Number.isInteger(raw.round) || !choice) return null;
  return { nonce: raw.nonce, playerId: raw.playerId as number, round: raw.round as number, choice };
}

type PeerankiSettings = {
  musicVolume: number;
  soundEffectsVolume: number;
  fullscreen: boolean;
  keyboardControls: boolean;
  playerName?: string;
  muted?: boolean;
};

const SETTINGS_KEY = 'peeranki-settings';
export const PLAYER_NAME_KEY = 'peeranki-player-name';

const DEFAULT_SETTINGS: PeerankiSettings = {
  musicVolume: 70,
  soundEffectsVolume: 80,
  fullscreen: false,
  keyboardControls: true,
  playerName: 'Player',
  muted: false,
};

export function getStoredPlayerName(): string {
  try {
    const raw = localStorage.getItem(PLAYER_NAME_KEY)?.trim();
    if (raw && raw.length > 0) {
      return raw.slice(0, 16);
    }
    const settings = loadSettings();
    if (settings.playerName?.trim()) {
      return settings.playerName.trim().slice(0, 16);
    }
  } catch {
    // fallback
  }
  return 'Player';
}

export function setStoredPlayerName(name: string): string {
  const clean = name.trim().slice(0, 16) || 'Player';
  try {
    localStorage.setItem(PLAYER_NAME_KEY, clean);
    const settings = loadSettings();
    settings.playerName = clean;
    saveSettings(settings);
  } catch {
    // ignore
  }
  return clean;
}

function loadSettings(): PeerankiSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const storedName = localStorage.getItem(PLAYER_NAME_KEY)?.trim() || stored.playerName;
    return {
      musicVolume: clampSetting(stored.musicVolume, DEFAULT_SETTINGS.musicVolume),
      soundEffectsVolume: clampSetting(stored.soundEffectsVolume, DEFAULT_SETTINGS.soundEffectsVolume),
      fullscreen: typeof stored.fullscreen === 'boolean' ? stored.fullscreen : DEFAULT_SETTINGS.fullscreen,
      keyboardControls: typeof stored.keyboardControls === 'boolean' ? stored.keyboardControls : DEFAULT_SETTINGS.keyboardControls,
      playerName: typeof storedName === 'string' && storedName.trim() ? storedName.trim().slice(0, 16) : 'Player',
      muted: typeof stored.muted === 'boolean' ? stored.muted : localStorage.getItem('peeranki_music_muted') === 'true',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function clampSetting(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

function saveSettings(settings: PeerankiSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  PeerankiAudio.applySettings();
}

declare global {
  interface Window {
    peerankiDesktop?: {
      setFullscreen: (fullscreen: boolean) => Promise<boolean>;
      onFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
      quit: () => void;
    };
  }
}

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
const PLAYER_COUNTS = Array.from(
  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, index) => MIN_PLAYERS + index,
);

// Offline game state
let offlineMode = false;
let offlinePlayers: Player[] = [];
let offlineMaxPlayers = MIN_PLAYERS;
let shootingDeadlineAt = '';
let matchStartedAt = '';
let matchRound = 1;
let lastRoundMessage = '';
let countingStartIndex = -1;
let roundWinnerId = 0;
let matchOver = false;
let duelRound = 1;
const processedOnlineActionNonces = new Set<string>();

function createOfflinePlayers(
  playerName: string,
  totalPlayers: number,
  selectedAvatar: AnimalAvatarId = getSelectedAvatarId(),
): Player[] {
  const offlinePlayers: Player[] = [];

  offlinePlayers.push({
    id: 1,
    name: playerName || 'Player',
    avatar: selectedAvatar,
    stage: 0,
    alive: true,
    sessionId: 'offline-human',
    connected: true,
    lastSeen: new Date().toISOString(),
    weapons: ['gun'],
    hasCollectedAllWeapons: false,
    eliminationPoints: 0,
    shieldDisabledRound: -1,
    matchStartedAt: '',
    matchRound: 1,
    countingStartIndex: -1,
    roundWinnerId: 0,
    matchOver: false,
    actionRequest: null,
    duelChoice: null,
    duelChoiceRequest: null,
  });

  for (let i = 2; i <= totalPlayers; i++) {
    offlinePlayers.push({
      id: i,
      name: `Bot ${i - 1}`,
      avatar: getBotAvatarId(i - 1),
      stage: 0,
      alive: true,
      sessionId: `offline-bot-${i}`,
      connected: true,
      lastSeen: new Date().toISOString(),
      weapons: ['gun'],
      hasCollectedAllWeapons: false,
      eliminationPoints: 0,
      shieldDisabledRound: -1,
      matchStartedAt: '',
      matchRound: 1,
      countingStartIndex: -1,
      roundWinnerId: 0,
      matchOver: false,
      actionRequest: null,
      duelChoice: null,
      duelChoiceRequest: null,
    });
  }

  return offlinePlayers;
}

const COUNT_TO = 10;
const ACTION_LIMIT_MS = 10_000;
const COUNTING_SPEED = 200;
const NEXT_ROUND_DELAY = 900;
const HEARTBEAT_INTERVAL = 5000;
const STALE_PLAYER_SECONDS = 30;

let roomCode = '';
let myPlayerId = 0;
let maxPlayers = MIN_PLAYERS;
let isPublicRoom = false;
let hostSessionId = '';
let players: Player[] = [];

const sessionId = getOrCreateSessionId();
const previousRoomCleanup = cleanupPreviousSession();
let heartbeatTimer: number | undefined;
let cleanupTimer: number | undefined;

const stageNames = [
  'Big Tower',
  'Two Small Towers',
  'One Tower',
  'Eliminated',
];

function getOrCreateSessionId() {
  const key = 'peeranki-session-id';
  let id = sessionStorage.getItem(key);

  if (!id) {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      id = crypto.randomUUID();
    } else {
      id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    sessionStorage.setItem(key, id);
  }

  return id;
}

async function cleanupPreviousSession() {
  const oldRoomCode = sessionStorage.getItem(
    'peeranki-room-code',
  );

  if (!oldRoomCode) {
    return;
  }

  try {
    await leaveRoom(oldRoomCode, sessionId);
  } catch (error) {
    console.error(
      'Previous session cleanup failed:',
      error,
    );
  }

  sessionStorage.removeItem('peeranki-room-code');
  sessionStorage.removeItem('peeranki-room-public');
}

function rememberRoom(code: string, publicRoom: boolean) {
  sessionStorage.setItem('peeranki-room-code', code);
  sessionStorage.setItem(
    'peeranki-room-public',
    publicRoom ? 'true' : 'false',
  );
}

function forgetRoom() {
  sessionStorage.removeItem('peeranki-room-code');
  sessionStorage.removeItem('peeranki-room-public');
  stopRoomHeartbeat();
}

function amHost() {
  return hostSessionId === sessionId;
}

function findMyPlayerId() {
  const me = players.find(
    (player) =>
      player.connected &&
      player.sessionId === sessionId,
  );

  myPlayerId = me?.id ?? 0;
}

function createEmptyPlayer(id: number): Player {
  return {
    id,
    name: `Player ${id}`,
    avatar: getBotAvatarId(id - 1),
    stage: 0,
    alive: false,
    sessionId: '',
    connected: false,
    lastSeen: '',
    weapons: ['gun'],
    hasCollectedAllWeapons: false,
    eliminationPoints: 0,
    shieldDisabledRound: -1,
    matchStartedAt,
    matchRound,
    countingStartIndex: -1,
    roundWinnerId: 0,
    matchOver: false,
    actionRequest: null,
    duelChoice: null,
    duelChoiceRequest: null,
  };
}


function loadPlayersFromRoom(roomPlayers: unknown[]) {
  const byId = new Map<number, Player>();
  const sharedDeadline = roomPlayers.find((player: any) =>
    typeof player?.shooting_deadline_at === 'string' && player.shooting_deadline_at,
  ) as Record<string, unknown> | undefined;
  shootingDeadlineAt = typeof sharedDeadline?.shooting_deadline_at === 'string'
    ? sharedDeadline.shooting_deadline_at
    : '';
  const sharedDuelRound = roomPlayers.find((player: any) =>
    Number.isInteger(player?.duel_round) && player.duel_round > 0,
  ) as Record<string, unknown> | undefined;
  duelRound = typeof sharedDuelRound?.duel_round === 'number' ? sharedDuelRound.duel_round : 1;

  roomPlayers.forEach((rawPlayer: any) => {
    const id = Number(rawPlayer?.id);

    if (!Number.isInteger(id) || id < 1 || id > maxPlayers) {
      return;
    }

    if (typeof rawPlayer?.round_message === 'string' && rawPlayer.round_message) {
      lastRoundMessage = rawPlayer.round_message;
    }
    if (MATCH_DURATIONS.includes(Number(rawPlayer?.match_duration_minutes) as (typeof MATCH_DURATIONS)[number])) {
      matchDurationMinutes = Number(rawPlayer.match_duration_minutes) as (typeof MATCH_DURATIONS)[number];
    }

    byId.set(id, {
      id,
      name:
        typeof rawPlayer?.name === 'string' &&
        rawPlayer.name.trim()
          ? rawPlayer.name
          : `Player ${id}`,
      avatar:
        typeof rawPlayer?.avatar === 'string' && (AVATAR_IDS as string[]).includes(rawPlayer.avatar)
          ? (rawPlayer.avatar as AnimalAvatarId)
          : getBotAvatarId(id - 1),
      stage:
        Number.isInteger(rawPlayer?.stage) &&
        rawPlayer.stage >= 0 &&
        rawPlayer.stage <= 3
          ? rawPlayer.stage
          : 0,
      alive:
        typeof rawPlayer?.alive === 'boolean'
          ? rawPlayer.alive
          : true,
      sessionId:
        typeof rawPlayer?.session_id === 'string'
          ? rawPlayer.session_id
          : typeof rawPlayer?.sessionId === 'string'
            ? rawPlayer.sessionId
            : '',
      connected:
        typeof rawPlayer?.connected === 'boolean'
          ? rawPlayer.connected
          : true,
      lastSeen:
        typeof rawPlayer?.last_seen === 'string'
          ? rawPlayer.last_seen
          : '',
      weapons: normalizeWeapons(rawPlayer?.weapons),
      hasCollectedAllWeapons: rawPlayer?.all_weapons_collected === true ||
        hasAllWeapons(normalizeWeapons(rawPlayer?.weapons)),
      eliminationPoints: Number.isInteger(rawPlayer?.elimination_points) && Number(rawPlayer.elimination_points) >= 0
        ? Number(rawPlayer.elimination_points) : 0,
      shieldDisabledRound: Number.isInteger(rawPlayer?.shield_disabled_round)
        ? rawPlayer.shield_disabled_round : -1,
      matchStartedAt: typeof rawPlayer?.match_started_at === 'string'
        ? rawPlayer.match_started_at : '',
      matchRound: Number.isInteger(rawPlayer?.match_round) && rawPlayer.match_round > 0
        ? rawPlayer.match_round : 1,
      countingStartIndex: Number.isInteger(rawPlayer?.counting_start_index) ? rawPlayer.counting_start_index : -1,
      roundWinnerId: Number.isInteger(rawPlayer?.round_winner_id) ? rawPlayer.round_winner_id : 0,
      matchOver: rawPlayer?.match_over === true,
      actionRequest: normalizeOnlineAction(rawPlayer?.action_request),
      duelChoice: normalizeRpsChoice(rawPlayer?.duel_choice),
      duelChoiceRequest: normalizeDuelChoiceRequest(rawPlayer?.duel_choice_request),
    });
  });

  const fixedPlayers: Player[] = [];

  for (let index = 0; index < maxPlayers; index += 1) {
    fixedPlayers.push(
      byId.get(index + 1) ??
        createEmptyPlayer(index + 1),
    );
  }

  players = fixedPlayers;
  const matchData = players.find((player) => player.matchStartedAt);
  if (matchData) {
    matchStartedAt = matchData.matchStartedAt;
    matchRound = matchData.matchRound;
  }
  const sharedMatchData = players.find((player) => player.matchStartedAt);
  if (sharedMatchData) {
    countingStartIndex = sharedMatchData.countingStartIndex;
    roundWinnerId = sharedMatchData.roundWinnerId;
    matchOver = sharedMatchData.matchOver;
  }
  findMyPlayerId();
}

function activePlayers() {
  return players.filter(
    (player) => player.connected && player.alive,
  );
}

function connectedPlayers() {
  return players.filter(
    (player) => player.connected,
  );
}

async function syncGameState(
  currentShooter: number | null,
  countNumber: number,
  gameStatus: string,
) {
  if (!roomCode || players.length === 0) {
    return;
  }

  const connected = players
    .filter((player) => player.connected)
    .map((player) => ({
      id: player.id,
      name: player.name,
      stage: player.stage,
      alive: player.alive,
      session_id: player.sessionId,
      connected: true,
      last_seen: player.lastSeen,
      weapons: player.weapons,
      all_weapons_collected: player.hasCollectedAllWeapons,
      elimination_points: player.eliminationPoints,
      shield_disabled_round: player.shieldDisabledRound,
      match_started_at: matchStartedAt,
      match_round: matchRound,
      counting_start_index: countingStartIndex,
      round_winner_id: roundWinnerId,
      match_over: matchOver,
      action_request: player.actionRequest,
      duel_choice: player.duelChoice,
      duel_choice_request: player.duelChoiceRequest,
      duel_round: duelRound,
      round_message: lastRoundMessage,
      match_duration_minutes: matchDurationMinutes,
      shooting_deadline_at: shootingDeadlineAt,
    }));

  await saveGameState(
    roomCode,
    connected,
    maxPlayers,
    currentShooter,
    countNumber,
    gameStatus,
  );
}

function startRoomHeartbeat() {
  stopRoomHeartbeat();

  heartbeatTimer = window.setInterval(() => {
    if (!roomCode) {
      return;
    }

    void touchPlayer(
      roomCode,
      sessionId,
    );

    if (amHost()) {
      void cleanupStalePlayers(
        roomCode,
        STALE_PLAYER_SECONDS,
      );
    }
  }, HEARTBEAT_INTERVAL);

  document.addEventListener(
    'visibilitychange',
    handleVisibilityChange,
  );
}

function stopRoomHeartbeat() {
  if (heartbeatTimer !== undefined) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }

  if (cleanupTimer !== undefined) {
    window.clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }

  document.removeEventListener(
    'visibilitychange',
    handleVisibilityChange,
  );
}

function handleVisibilityChange() {
  if (
    document.visibilityState === 'visible' &&
    roomCode
  ) {
    void touchPlayer(
      roomCode,
      sessionId,
    );
  }
}

async function leaveCurrentRoom() {
  const code = roomCode;

  if (!code) {
    return;
  }

  try {
    await leaveRoom(code, sessionId);
  } catch (error) {
    console.error('Leave room failed:', error);
  }

  roomCode = '';
  myPlayerId = 0;
  hostSessionId = '';
  forgetRoom();
}

window.addEventListener('pagehide', () => {
  const code = sessionStorage.getItem(
    'peeranki-room-code',
  );

  if (code) {
    leaveRoomBestEffort(code, sessionId);
  }
});

function removePeerankiInputs() {
  document
    .querySelectorAll('input[id^="peeranki-"]')
    .forEach((element) => element.remove());
}

function positionHtmlInput(
  scene: Phaser.Scene,
  input: HTMLInputElement,
  gameX: number,
  gameY: number,
  width = 300,
) {
  const canvas = scene.game.canvas;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / scene.scale.width;
  const scaleY = rect.height / scene.scale.height;
  const cssWidth = Math.min(
    width * scaleX,
    rect.width * 0.88,
  );

  input.style.position = 'fixed';
  input.style.left = `${rect.left + gameX * scaleX}px`;
  input.style.top = `${rect.top + gameY * scaleY}px`;
  input.style.transform = 'translate(-50%, -50%)';
  input.style.width = `${Math.round(cssWidth)}px`;
  input.style.height = `${Math.max(44, Math.round(50 * scaleY))}px`;
  input.style.padding = '0 16px';
  // Enforce >= 16px font size on mobile web to prevent iOS Safari auto-zoom
  input.style.fontSize = `${Math.max(16, Math.round(16 * scaleX))}px`;
  input.style.textAlign = 'center';
  input.style.boxSizing = 'border-box';
  input.style.border = '2px solid #455569';
  input.style.borderRadius = '8px';
  input.style.backgroundColor = '#182029';
  input.style.color = '#ffffff';
  input.style.outline = 'none';
  input.style.zIndex = '10000';
  input.style.fontFamily = 'Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  input.style.fontWeight = '700';
  input.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.5)';
  input.setAttribute('enterkeyhint', 'done');
  input.onfocus = () => {
    input.style.borderColor = '#2878ff';
    input.style.boxShadow = '0 0 14px rgba(40, 120, 255, 0.5)';
  };
  input.onblur = () => {
    input.style.borderColor = '#455569';
    input.style.boxShadow = '0 4px 14px rgba(0, 0, 0, 0.5)';
    // Reset window scroll on mobile browsers after keyboard closes
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  };
}

function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  backgroundColor = '#2878ff',
  fontSize = 17,
  btnWidth = 300,
  btnHeight = 50,
): Phaser.GameObjects.Text {
  const lineCount = label.split('\n').length;
  const lineSpacing = lineCount > 1 ? 5 : 0;
  // Account for Android system fonts (Roboto) which have a taller line height than Arial
  const estimatedLineHeight = Math.ceil(fontSize * 1.35);
  const totalTextHeight = lineCount * estimatedLineHeight + (lineCount - 1) * lineSpacing;
  const actualHeight = Math.max(btnHeight, totalTextHeight + 14);
  const padY = Math.max(2, Math.floor((actualHeight - totalTextHeight) / 2));

  const button = scene.add
    .text(x, y, label, {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
      fontSize: `${fontSize}px`,
      fontStyle: 'bold',
      color: '#ffffff',
      backgroundColor,
      align: 'center',
      lineSpacing,
      fixedWidth: btnWidth,
      fixedHeight: actualHeight,
      wordWrap: {
        width: Math.max(100, btnWidth - 16),
        useAdvancedWrap: true,
      },
      padding: {
        x: 8,
        y: padY,
      },
    })
    .setOrigin(0.5, 0.5);

  // Exact interactive hit area matching the button bounds (avoids offset dead zones and overlaps)
  button.setInteractive({ useHandCursor: true });
  if (button.input) {
    button.input.cursor = 'pointer';
  }

  button.on('pointerdown', () => PeerankiAudio.effect('click'));
  button.on('pointerover', () => scene.tweens.add({ targets: button, scale: 1.025, duration: 80, ease: 'Quad.Out' }));
  button.on('pointerout', () => scene.tweens.add({ targets: button, scale: 1, duration: 80, ease: 'Quad.Out' }));
  button.on('pointerdown', () => scene.tweens.add({ targets: button, scale: 0.96, duration: 60, yoyo: true }));
  return button;
}

function addMatchDurationPicker(scene: Phaser.Scene, x: number, y: number) {
  scene.add.text(x, y - 24, 'MATCH TIME', {
    fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
    fontSize: '13px',
    color: '#f2cf66',
    fontStyle: 'bold',
  }).setOrigin(0.5);

  const btnWidth = 70;
  const btnHeight = 38;
  const gap = 10;
  const totalW = MATCH_DURATIONS.length * btnWidth + (MATCH_DURATIONS.length - 1) * gap;
  const startX = x - totalW / 2 + btnWidth / 2;

  MATCH_DURATIONS.forEach((minutes, index) => {
    const btnX = startX + index * (btnWidth + gap);
    const button = makeButton(
      scene,
      btnX,
      y + 14,
      `${minutes} MIN`,
      minutes === matchDurationMinutes ? '#20a060' : '#374151',
      13,
      btnWidth,
      btnHeight,
    );
    button.on('pointerdown', () => {
      matchDurationMinutes = minutes;
      scene.children.list.forEach((child) => {
        if (child instanceof Phaser.GameObjects.Text && child.getData('matchDuration') !== undefined) {
          child.setStyle({
            backgroundColor: Number(child.getData('matchDuration')) === minutes ? '#20a060' : '#374151',
          });
        }
      });
    });
    button.setData('matchDuration', minutes);
  });
}

class MenuScene extends Phaser.Scene {
  private nameInput?: HTMLInputElement;
  private nameInputX = 0;
  private nameInputY = 0;
  private nameInputW = 300;
  private resizeHandler = () => {
    if (this.nameInput) {
      positionHtmlInput(this, this.nameInput, this.nameInputX, this.nameInputY, this.nameInputW);
    }
  };

  constructor() {
    super('MenuScene');
  }

  preload() {
    this.load.image('peeranki-logo', 'assets/peeranki-logo.webp');
    this.load.image('menu-background', 'assets/background/menu_background.webp');
    AVATAR_IDS.forEach((id) => {
      this.load.svg(`avatar_${id}`, `assets/players/avatar_${id}.svg`, { width: 96, height: 96 });
    });
  }

  create() {
    removePeerankiInputs();
    PeerankiAudio.startMusic();

    const { width, height } = this.scale;

    // Tropical village menu background
    if (this.textures.exists('menu-background')) {
      const bg = this.add.image(width / 2, height / 2, 'menu-background').setOrigin(0.5).setDepth(-10);
      const scaleX = width / bg.width;
      const scaleY = height / bg.height;
      const bgScale = Math.max(scaleX, scaleY);
      bg.setScale(bgScale);

      // Translucent atmospheric scrim ensuring crisp readability of titles and menu buttons
      const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x070c14, 0.45)
        .setOrigin(0.5)
        .setDepth(-5);

      this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
        bg.setPosition(gameSize.width / 2, gameSize.height / 2);
        bg.setScale(Math.max(gameSize.width / bg.width, gameSize.height / bg.height));
        overlay.setPosition(gameSize.width / 2, gameSize.height / 2);
        overlay.setSize(gameSize.width, gameSize.height);
      });
    }

    const isLandscape = width >= 640 && width > height * 1.12;

    if (isLandscape) {
      // WIDE / LANDSCAPE DASHBOARD: Uses every space of the screen!
      const leftColX = width * 0.28;
      const rightColX = width * 0.72;
      const colWidth = Math.min(460, width * 0.42);

      const glow = this.add.circle(leftColX, height * 0.16, 56, 0x2878ff, 0.15);
      this.tweens.add({ targets: glow, alpha: 0.28, scale: 1.15, duration: 1500, yoyo: true, repeat: -1 });
      this.add.image(leftColX, height * 0.16, 'peeranki-logo').setDisplaySize(92, 92);

      this.add.text(leftColX, height * 0.27, 'PEERANKI', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '24px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(leftColX, height * 0.33, 'Traditional Kerala Strategy Game', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#8a99a8',
      }).setOrigin(0.5);

      this.add.text(leftColX, height * 0.43, 'YOUR NAME', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '12px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.nameInput = document.createElement('input');
      this.nameInput.id = 'peeranki-menu-name';
      this.nameInput.type = 'text';
      this.nameInput.placeholder = 'Enter your name';
      this.nameInput.maxLength = 16;
      this.nameInput.value = getStoredPlayerName();
      this.nameInput.autocomplete = 'name';
      document.body.appendChild(this.nameInput);

      this.nameInputX = leftColX;
      this.nameInputY = height * 0.51;
      this.nameInputW = colWidth * 0.86;
      positionHtmlInput(this, this.nameInput, this.nameInputX, this.nameInputY, this.nameInputW);

      this.nameInput.addEventListener('input', () => {
        setStoredPlayerName(this.nameInput?.value ?? '');
      });

      this.add.text(leftColX, height * 0.59, 'Saved for all games', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '11px',
        color: '#718096',
      }).setOrigin(0.5);

      const utilBtnW = Math.floor((colWidth * 0.86 - 12) / 2);
      const settingsButton = makeButton(
        this,
        leftColX - utilBtnW / 2 - 6,
        height * 0.73,
        '⚙️ SETTINGS',
        '#374151',
        14,
        utilBtnW,
        44,
      );

      const howToPlayMenuBtn = makeButton(
        this,
        leftColX + utilBtnW / 2 + 6,
        height * 0.73,
        '📖 GUIDE',
        '#1f2937',
        14,
        utilBtnW,
        44,
      );

      const exitMenuBtnLandscape = makeButton(
        this,
        leftColX,
        height * 0.86,
        '🚪 EXIT GAME',
        '#9b3030',
        14,
        colWidth * 0.86,
        42,
      );

      exitMenuBtnLandscape.on('pointerdown', () => {
        PeerankiAudio.effect('select');
        showExitGameModal();
      });

      this.add.text(rightColX, height * 0.16, 'CHOOSE GAME MODE', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '18px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const cardWidth = Math.min(460, colWidth * 0.94);
      const cardHeight = Math.max(68, Math.min(84, Math.floor(height * 0.22)));

      const offlineButton = makeButton(
        this,
        rightColX,
        height * 0.38,
        '🤖 OFFLINE BATTLE\nPlay vs Bots · 2–10 Players',
        '#20a060',
        17,
        cardWidth,
        cardHeight,
      );

      const onlineButton = makeButton(
        this,
        rightColX,
        height * 0.64,
        '🌐 ONLINE MULTIPLAYER\nFriends & Worldwide · Duels',
        '#2878ff',
        17,
        cardWidth,
        cardHeight,
      );

      offlineButton.on('pointerdown', () => {
        this.cleanup();
        this.scene.start('OfflineSetupScene');
      });

      onlineButton.on('pointerdown', () => {
        this.cleanup();
        this.scene.start('OnlineModeScene');
      });

      settingsButton.on('pointerdown', () => {
        this.cleanup();
        this.scene.start('SettingsScene');
      });

      howToPlayMenuBtn.on('pointerdown', () => {
        PeerankiAudio.effect('select');
        showHowToPlayModal();
      });

    } else {
      // PORTRAIT / MOBILE COMPACT: Safe vertical flow ensuring zero overlap with top buttons & logo
      const contentWidth = Math.min(460, width - 36);

      // Logo placed safely below top header bar (top buttons finish by y ~39)
      const logoY = Math.max(118, Math.min(142, Math.floor(height * 0.16)));
      const glow = this.add.circle(width / 2, logoY, 38, 0x2878ff, 0.14);
      this.tweens.add({ targets: glow, alpha: 0.28, scale: 1.15, duration: 1500, yoyo: true, repeat: -1 });
      this.add.image(width / 2, logoY, 'peeranki-logo').setDisplaySize(64, 64);

      const titleY = logoY + 48;
      this.add.text(width / 2, titleY, 'PEERANKI', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '22px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const subTitleY = titleY + 22;
      this.add.text(width / 2, subTitleY, 'Traditional Kerala Strategy Game', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '12px',
        color: '#8a99a8',
      }).setOrigin(0.5);

      const nameLabelY = subTitleY + 28;
      this.add.text(width / 2, nameLabelY, 'YOUR NAME', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '12px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.nameInput = document.createElement('input');
      this.nameInput.id = 'peeranki-menu-name';
      this.nameInput.type = 'text';
      this.nameInput.placeholder = 'Enter your name';
      this.nameInput.maxLength = 16;
      this.nameInput.value = getStoredPlayerName();
      this.nameInput.autocomplete = 'name';
      document.body.appendChild(this.nameInput);

      const inputY = nameLabelY + 32;
      this.nameInputX = width / 2;
      this.nameInputY = inputY;
      this.nameInputW = contentWidth;
      positionHtmlInput(this, this.nameInput, this.nameInputX, this.nameInputY, this.nameInputW);

      this.nameInput.addEventListener('input', () => {
        setStoredPlayerName(this.nameInput?.value ?? '');
      });

      const btnH = 52;
      const offlineBtnY = inputY + 56;
      const offlineButton = makeButton(
        this,
        width / 2,
        offlineBtnY,
        '🤖 OFFLINE PLAY (VS BOTS)',
        '#20a060',
        16,
        contentWidth,
        btnH,
      );

      const onlineBtnY = offlineBtnY + 62;
      const onlineButton = makeButton(
        this,
        width / 2,
        onlineBtnY,
        '🌐 ONLINE MULTIPLAYER',
        '#2878ff',
        16,
        contentWidth,
        btnH,
      );

      const halfW = Math.floor((contentWidth - 10) / 2);
      const utilsY = onlineBtnY + 54;
      const settingsButton = makeButton(
        this,
        width / 2 - halfW / 2 - 5,
        utilsY,
        '⚙️ SETTINGS',
        '#374151',
        14,
        halfW,
        42,
      );

      const howToPlayMenuBtn = makeButton(
        this,
        width / 2 + halfW / 2 + 5,
        utilsY,
        '📖 HOW TO PLAY',
        '#1f2937',
        14,
        halfW,
        42,
      );

      const exitMenuBtnPortrait = makeButton(
        this,
        width / 2,
        utilsY + 48,
        '🚪 EXIT GAME',
        '#9b3030',
        14,
        contentWidth,
        42,
      );

      exitMenuBtnPortrait.on('pointerdown', () => {
        PeerankiAudio.effect('select');
        showExitGameModal();
      });

      offlineButton.on('pointerdown', () => {
        this.cleanup();
        this.scene.start('OfflineSetupScene');
      });

      onlineButton.on('pointerdown', () => {
        this.cleanup();
        this.scene.start('OnlineModeScene');
      });

      settingsButton.on('pointerdown', () => {
        this.cleanup();
        this.scene.start('SettingsScene');
      });

      howToPlayMenuBtn.on('pointerdown', () => {
        PeerankiAudio.effect('select');
        showHowToPlayModal();
      });
    }

    window.addEventListener('resize', this.resizeHandler);

    // Top Header Bar: Clean corner anchors ensuring ZERO collision with the logo
    const topBtnY = 24;

    // Mute toggle on top-left corner
    const isMuted = PeerankiAudio.isMuted();
    const muteButton = makeButton(
      this,
      24,
      topBtnY,
      isMuted ? '🔇' : '🔊',
      isMuted ? '#822727' : '#2d3748',
      15,
      36,
      30,
    ).setDepth(1000);

    // Exit and Guide buttons on top-right corner
    const rightTopBtn = makeButton(
      this,
      width - 26,
      topBtnY,
      '🚪 EXIT',
      '#9b3030',
      11,
      44,
      30,
    ).setDepth(1000);

    const guideTopBtn = makeButton(
      this,
      width - 82,
      topBtnY,
      '❓ GUIDE',
      '#1f2937',
      11,
      54,
      30,
    ).setDepth(1000);

    guideTopBtn.on('pointerdown', () => {
      PeerankiAudio.effect('select');
      showHowToPlayModal();
    });

    muteButton.on('pointerdown', () => {
      PeerankiAudio.toggleMute();
      this.cleanup();
      this.scene.restart();
    });

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      muteButton.setPosition(24, 24);
      rightTopBtn.setPosition(gameSize.width - 26, 24);
      guideTopBtn.setPosition(gameSize.width - 82, 24);
      if (this.nameInput) {
        positionHtmlInput(this, this.nameInput, this.nameInputX, this.nameInputY, this.nameInputW);
      }
    });

    rightTopBtn.on('pointerdown', () => {
      PeerankiAudio.effect('select');
      showExitGameModal();
    });
  }

  private cleanup() {
    window.removeEventListener('resize', this.resizeHandler);
    this.nameInput?.remove();
    this.nameInput = undefined;
    removePeerankiInputs();
  }

  shutdown() {
    this.cleanup();
  }
}

class SettingsScene extends Phaser.Scene {
  constructor() {
    super('SettingsScene');
  }

  create() {
    removePeerankiInputs();
    const { width, height } = this.scale;
    const isLandscape = width >= 640 && width > height * 1.12;
    const settings = loadSettings();

    const redraw = () => this.scene.restart();

    if (isLandscape) {
      const leftColX = width * 0.30;
      const rightColX = width * 0.70;
      const colWidth = Math.min(380, width * 0.38);

      this.add.text(leftColX, height * 0.12, 'SETTINGS', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const addVolumeSetting = (label: string, key: 'musicVolume' | 'soundEffectsVolume', y: number) => {
        this.add.text(leftColX, y - 20, label, {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '13px',
          color: '#ffffff',
          fontStyle: 'bold',
        }).setOrigin(0.5);

        const minus = makeButton(this, leftColX - 85, y + 10, '−', '#374151', 20, 44, 40);
        this.add.text(leftColX, y + 10, `${settings[key]}%`, {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '17px',
          fontStyle: 'bold',
          color: '#f2cf66',
          align: 'center',
          fixedWidth: 70,
          fixedHeight: 40,
          padding: { x: 0, y: 9 },
        }).setOrigin(0.5, 0.5);
        const plus = makeButton(this, leftColX + 85, y + 10, '+', '#374151', 20, 44, 40);

        minus.on('pointerdown', () => {
          settings[key] = Math.max(0, settings[key] - 10);
          saveSettings(settings);
          if (key === 'soundEffectsVolume') PeerankiAudio.effect('click');
          redraw();
        });
        plus.on('pointerdown', () => {
          settings[key] = Math.min(100, settings[key] + 10);
          saveSettings(settings);
          if (key === 'soundEffectsVolume') PeerankiAudio.effect('click');
          redraw();
        });
      };

      addVolumeSetting('MUSIC VOLUME', 'musicVolume', height * 0.32);
      addVolumeSetting('SOUND EFFECTS VOLUME', 'soundEffectsVolume', height * 0.54);

      // Soundtrack Info & Switcher
      const currentTrackTitle = PeerankiAudio.getCurrentTrackTitle();
      const currentTrackFile = PeerankiAudio.getCurrentTrackFilename();
      const themeBg = this.add.graphics();
      themeBg.fillStyle(0x1a222d, 0.85);
      themeBg.lineStyle(1.5, 0x3b82f6, 0.4);
      themeBg.fillRoundedRect(leftColX - 150, height * 0.72, 300, 46, 8);
      themeBg.strokeRoundedRect(leftColX - 150, height * 0.72, 300, 46, 8);

      const soundHitZone = this.add.zone(leftColX, height * 0.72 + 23, 300, 46)
        .setInteractive({ useHandCursor: true });
      soundHitZone.on('pointerdown', () => {
        PeerankiAudio.cycleTrack();
        PeerankiAudio.effect('select');
        redraw();
      });

      this.add.text(leftColX, height * 0.72 + 14, `🎵 MUSIC: ${currentTrackTitle.toUpperCase()}`, {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '12px',
        color: '#60a5fa',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(leftColX, height * 0.72 + 31, `${currentTrackFile} • Tap to Switch`, {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '10.5px',
        color: '#9ca3af',
      }).setOrigin(0.5);

      // Right Column
      const fullscreen = makeButton(this, rightColX, height * 0.24,
        `FULLSCREEN: ${settings.fullscreen ? 'ON' : 'OFF'}`, '#374151', 14, colWidth, 42);
      fullscreen.on('pointerdown', async () => {
        settings.fullscreen = !settings.fullscreen;
        saveSettings(settings);
        if (window.peerankiDesktop) {
          await window.peerankiDesktop.setFullscreen(settings.fullscreen);
        } else if (settings.fullscreen) {
          await document.documentElement.requestFullscreen?.();
        } else if (document.fullscreenElement) {
          await document.exitFullscreen?.();
        }
        redraw();
      });

      const keyboard = makeButton(this, rightColX, height * 0.42,
        `KEYBOARD CONTROLS: ${settings.keyboardControls ? 'ON' : 'OFF'}`, '#374151', 14, colWidth, 42);
      keyboard.on('pointerdown', () => {
        settings.keyboardControls = !settings.keyboardControls;
        saveSettings(settings);
        redraw();
      });

      const serverInfo = getStoredServerRegion();
      const serverBtn = makeButton(this, rightColX, height * 0.58,
        `🌐 SERVER: ${serverInfo.flag} ${serverInfo.isMumbai ? 'MUMBAI (ap-south-1)' : 'SINGAPORE'}`, '#1e293b', 12, colWidth, 40);
      serverBtn.on('pointerdown', () => {
        const next = serverInfo.isMumbai ? 'singapore' : 'mumbai';
        setStoredServerRegion(next);
        PeerankiAudio.effect('select');
        redraw();
      });

      const guideBtn = makeButton(this, rightColX, height * 0.70,
        '📖 HOW TO PLAY GUIDE', '#1e293b', 13, colWidth, 40);
      guideBtn.on('pointerdown', () => {
        PeerankiAudio.effect('select');
        showHowToPlayModal();
      });

      const back = makeButton(this, rightColX, height * 0.84, '⬅ BACK TO MENU', '#252d37', 14, Math.min(220, colWidth * 0.75), 40);
      back.on('pointerdown', () => this.scene.start('MenuScene'));

    } else {
      // PORTRAIT: Guaranteed safe sequential vertical spacing
      const contentWidth = Math.min(320, width - 40);

      this.add.text(width / 2, 42, 'SETTINGS', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const addVolumeSetting = (label: string, key: 'musicVolume' | 'soundEffectsVolume', y: number) => {
        this.add.text(width / 2, y, label, {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '13px',
          color: '#ffffff',
          fontStyle: 'bold',
        }).setOrigin(0.5);

        const minus = makeButton(this, width / 2 - 80, y + 30, '−', '#374151', 20, 44, 38);
        this.add.text(width / 2, y + 30, `${settings[key]}%`, {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '16px',
          fontStyle: 'bold',
          color: '#f2cf66',
          align: 'center',
          fixedWidth: 70,
          fixedHeight: 38,
          padding: { x: 0, y: 8 },
        }).setOrigin(0.5, 0.5);
        const plus = makeButton(this, width / 2 + 80, y + 30, '+', '#374151', 20, 44, 38);

        minus.on('pointerdown', () => {
          settings[key] = Math.max(0, settings[key] - 10);
          saveSettings(settings);
          if (key === 'soundEffectsVolume') PeerankiAudio.effect('click');
          redraw();
        });
        plus.on('pointerdown', () => {
          settings[key] = Math.min(100, settings[key] + 10);
          saveSettings(settings);
          if (key === 'soundEffectsVolume') PeerankiAudio.effect('click');
          redraw();
        });
      };

      addVolumeSetting('MUSIC VOLUME', 'musicVolume', 85);
      addVolumeSetting('SOUND EFFECTS VOLUME', 'soundEffectsVolume', 160);

      const themeY = 236;
      const currentTrackTitle = PeerankiAudio.getCurrentTrackTitle();
      const currentTrackFile = PeerankiAudio.getCurrentTrackFilename();
      const themeBg = this.add.graphics();
      themeBg.fillStyle(0x1a222d, 0.85);
      themeBg.lineStyle(1.5, 0x3b82f6, 0.4);
      themeBg.fillRoundedRect(width / 2 - contentWidth / 2, themeY, contentWidth, 44, 8);
      themeBg.strokeRoundedRect(width / 2 - contentWidth / 2, themeY, contentWidth, 44, 8);

      const soundHitZone = this.add.zone(width / 2, themeY + 22, contentWidth, 44)
        .setInteractive({ useHandCursor: true });
      soundHitZone.on('pointerdown', () => {
        PeerankiAudio.cycleTrack();
        PeerankiAudio.effect('select');
        redraw();
      });

      this.add.text(width / 2, themeY + 14, `🎵 MUSIC: ${currentTrackTitle.toUpperCase()}`, {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '12px',
        color: '#60a5fa',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(width / 2, themeY + 30, `${currentTrackFile} • Tap to Switch`, {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '10.5px',
        color: '#9ca3af',
      }).setOrigin(0.5);

      const fullscreen = makeButton(this, width / 2, 310,
        `FULLSCREEN: ${settings.fullscreen ? 'ON' : 'OFF'}`, '#374151', 14, contentWidth, 42);
      fullscreen.on('pointerdown', async () => {
        settings.fullscreen = !settings.fullscreen;
        saveSettings(settings);
        if (window.peerankiDesktop) {
          await window.peerankiDesktop.setFullscreen(settings.fullscreen);
        } else if (settings.fullscreen) {
          await document.documentElement.requestFullscreen?.();
        } else if (document.fullscreenElement) {
          await document.exitFullscreen?.();
        }
        redraw();
      });

      const keyboard = makeButton(this, width / 2, 362,
        `KEYBOARD CONTROLS: ${settings.keyboardControls ? 'ON' : 'OFF'}`, '#374151', 14, contentWidth, 42);
      keyboard.on('pointerdown', () => {
        settings.keyboardControls = !settings.keyboardControls;
        saveSettings(settings);
        redraw();
      });

      const serverInfo = getStoredServerRegion();
      const serverBtn = makeButton(this, width / 2, 412,
        `🌐 SERVER: ${serverInfo.flag} ${serverInfo.isMumbai ? 'MUMBAI (ap-south-1)' : 'SINGAPORE'}`, '#1e293b', 12, contentWidth, 38);
      serverBtn.on('pointerdown', () => {
        const next = serverInfo.isMumbai ? 'singapore' : 'mumbai';
        setStoredServerRegion(next);
        PeerankiAudio.effect('select');
        redraw();
      });

      const guideBtn = makeButton(this, width / 2, 458,
        '📖 HOW TO PLAY GUIDE', '#1e293b', 13, contentWidth, 38);
      guideBtn.on('pointerdown', () => {
        PeerankiAudio.effect('select');
        showHowToPlayModal();
      });

      const back = makeButton(this, width / 2, 508, '⬅ BACK TO MENU', '#252d37', 14, Math.min(200, contentWidth * 0.70), 38);
      back.on('pointerdown', () => this.scene.start('MenuScene'));
    }
  }
}

class OfflineSetupScene extends Phaser.Scene {
  private selectedPlayers = MIN_PLAYERS;

  constructor() {
    super('OfflineSetupScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;
    const isLandscape = width >= 640 && width > height * 1.12;

    if (isLandscape) {
      // 2-Column Wide Layout: Uses every space of the screen!
      const leftColX = width * 0.28;
      const rightColX = width * 0.72;
      const colWidth = Math.min(460, width * 0.42);

      this.add.text(leftColX, height * 0.14, 'OFFLINE PLAY', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(leftColX, height * 0.21, 'Practice Match vs Bots', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '14px',
        color: '#8a99a8',
      }).setOrigin(0.5);

      // Name Input
      this.add.text(leftColX, height * 0.30, 'YOUR NAME', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '12px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const nameInput = document.createElement('input');
      nameInput.id = 'peeranki-offline-name';
      nameInput.type = 'text';
      nameInput.placeholder = 'Enter your name';
      nameInput.maxLength = 16;
      nameInput.value = getStoredPlayerName();
      nameInput.autocomplete = 'name';
      document.body.appendChild(nameInput);

      positionHtmlInput(this, nameInput, leftColX, height * 0.38, colWidth * 0.88);
      nameInput.addEventListener('input', () => setStoredPlayerName(nameInput.value));

      // Match Duration Picker
      addMatchDurationPicker(this, leftColX, height * 0.54);

      // Back Button
      const backButton = makeButton(
        this,
        leftColX,
        height * 0.80,
        '⬅ BACK TO MENU',
        '#252d37',
        15,
        Math.min(260, colWidth * 0.88),
        44,
      );

      // Right Column: Number of Players & Start
      this.add.text(rightColX, height * 0.16, 'NUMBER OF PLAYERS (2–10)', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '15px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const countBtnW = Math.floor((colWidth * 0.92 - 32) / 5);
      const countBtnH = 44;
      const countGapX = 8;
      const countGapY = 10;
      const row1 = PLAYER_COUNTS.slice(0, 5);
      const row2 = PLAYER_COUNTS.slice(5);

      const row1StartX = rightColX - (row1.length * countBtnW + (row1.length - 1) * countGapX) / 2 + countBtnW / 2;
      const row2StartX = rightColX - (row2.length * countBtnW + (row2.length - 1) * countGapX) / 2 + countBtnW / 2;
      const row1Y = height * 0.30;
      const row2Y = row1Y + countBtnH + countGapY;

      row1.forEach((count, index) => {
        const x = row1StartX + index * (countBtnW + countGapX);
        const button = makeButton(this, x, row1Y, String(count), count === this.selectedPlayers ? '#20a060' : '#374151', 17, countBtnW, countBtnH);
        button.setData('playerCount', count);
        button.on('pointerdown', () => {
          this.selectedPlayers = count;
          this.children.list.forEach((child) => {
            if (child instanceof Phaser.GameObjects.Text && child.getData('playerCount')) {
              child.setStyle({ backgroundColor: child.getData('playerCount') === this.selectedPlayers ? '#20a060' : '#374151' });
            }
          });
        });
      });

      row2.forEach((count, index) => {
        const x = row2StartX + index * (countBtnW + countGapX);
        const button = makeButton(this, x, row2Y, String(count), count === this.selectedPlayers ? '#20a060' : '#374151', 17, countBtnW, countBtnH);
        button.setData('playerCount', count);
        button.on('pointerdown', () => {
          this.selectedPlayers = count;
          this.children.list.forEach((child) => {
            if (child instanceof Phaser.GameObjects.Text && child.getData('playerCount')) {
              child.setStyle({ backgroundColor: child.getData('playerCount') === this.selectedPlayers ? '#20a060' : '#374151' });
            }
          });
        });
      });

      // Start Button directly under right thumb!
      const startButton = makeButton(
        this,
        rightColX,
        height * 0.76,
        '▶ START GAME',
        '#20a060',
        20,
        Math.min(380, colWidth * 0.92),
        56,
      );

      startButton.on('pointerdown', () => {
        const playerName = nameInput.value.trim() || getStoredPlayerName();
        setStoredPlayerName(playerName);
        offlineMode = true;
        offlineMaxPlayers = this.selectedPlayers;
        offlinePlayers = createOfflinePlayers(playerName, offlineMaxPlayers);
        nameInput.remove();
        this.scene.start('GameScene', { offline: true });
      });

      backButton.on('pointerdown', () => {
        nameInput.remove();
        this.scene.start('MenuScene');
      });

      this.events.once('shutdown', () => {
        nameInput.remove();
      });

    } else {
      // Portrait / Compact Layout: Sequential vertical spacing to prevent Android overlapping
      const contentWidth = Math.min(340, width - 36);

      const titleY = Math.max(34, Math.min(46, Math.floor(height * 0.06)));
      this.add.text(width / 2, titleY, 'OFFLINE PLAY', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '26px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const subtitleY = titleY + 28;
      this.add.text(width / 2, subtitleY, 'Play against Bots', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#8a99a8',
      }).setOrigin(0.5);

      const nameLabelY = subtitleY + 28;
      this.add.text(width / 2, nameLabelY, 'YOUR NAME', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '12px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const nameInput = document.createElement('input');
      nameInput.id = 'peeranki-offline-name';
      nameInput.type = 'text';
      nameInput.placeholder = 'Enter your name';
      nameInput.maxLength = 16;
      nameInput.value = getStoredPlayerName();
      nameInput.autocomplete = 'name';
      document.body.appendChild(nameInput);

      const inputY = nameLabelY + 30;
      positionHtmlInput(this, nameInput, width / 2, inputY, contentWidth);
      nameInput.addEventListener('input', () => setStoredPlayerName(nameInput.value));

      const playersLabelY = inputY + 36;
      this.add.text(width / 2, playersLabelY, 'NUMBER OF PLAYERS', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const countBtnW = Math.floor((contentWidth - 32) / 5);
      const countBtnH = 38;
      const countGapX = 8;
      const countGapY = 8;
      const row1 = PLAYER_COUNTS.slice(0, 5);
      const row2 = PLAYER_COUNTS.slice(5);

      const row1StartX = width / 2 - (row1.length * countBtnW + (row1.length - 1) * countGapX) / 2 + countBtnW / 2;
      const row2StartX = width / 2 - (row2.length * countBtnW + (row2.length - 1) * countGapX) / 2 + countBtnW / 2;
      const row1Y = playersLabelY + 26;
      const row2Y = row1Y + countBtnH + countGapY;

      row1.forEach((count, index) => {
        const x = row1StartX + index * (countBtnW + countGapX);
        const button = makeButton(this, x, row1Y, String(count), count === this.selectedPlayers ? '#20a060' : '#374151', 16, countBtnW, countBtnH);
        button.setData('playerCount', count);
        button.on('pointerdown', () => {
          this.selectedPlayers = count;
          this.children.list.forEach((child) => {
            if (child instanceof Phaser.GameObjects.Text && child.getData('playerCount')) {
              child.setStyle({ backgroundColor: child.getData('playerCount') === this.selectedPlayers ? '#20a060' : '#374151' });
            }
          });
        });
      });

      row2.forEach((count, index) => {
        const x = row2StartX + index * (countBtnW + countGapX);
        const button = makeButton(this, x, row2Y, String(count), count === this.selectedPlayers ? '#20a060' : '#374151', 16, countBtnW, countBtnH);
        button.setData('playerCount', count);
        button.on('pointerdown', () => {
          this.selectedPlayers = count;
          this.children.list.forEach((child) => {
            if (child instanceof Phaser.GameObjects.Text && child.getData('playerCount')) {
              child.setStyle({ backgroundColor: child.getData('playerCount') === this.selectedPlayers ? '#20a060' : '#374151' });
            }
          });
        });
      });

      const pickerY = row2Y + countBtnH + 34;
      addMatchDurationPicker(this, width / 2, pickerY);

      const startButton = makeButton(
        this,
        width / 2,
        pickerY + 54,
        '▶ START GAME',
        '#20a060',
        18,
        contentWidth,
        48,
      );

      const backButton = makeButton(
        this,
        width / 2,
        pickerY + 110,
        'BACK',
        '#252d37',
        15,
        Math.min(200, contentWidth * 0.70),
        42,
      );

      startButton.on('pointerdown', () => {
        const playerName = nameInput.value.trim() || getStoredPlayerName();
        setStoredPlayerName(playerName);
        offlineMode = true;
        offlineMaxPlayers = this.selectedPlayers;
        offlinePlayers = createOfflinePlayers(playerName, offlineMaxPlayers);
        nameInput.remove();
        this.scene.start('GameScene', { offline: true });
      });

      backButton.on('pointerdown', () => {
        nameInput.remove();
        this.scene.start('MenuScene');
      });

      this.events.once('shutdown', () => {
        nameInput.remove();
      });
    }
  }
}

class OnlineModeScene extends Phaser.Scene {
  constructor() {
    super('OnlineModeScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;
    const isLandscape = width >= 640 && width > height * 1.12;

    if (isLandscape) {
      // 2-Column Wide Layout: Uses every space of the screen!
      const leftColX = width * 0.28;
      const rightColX = width * 0.72;
      const colWidth = Math.min(460, width * 0.42);

      this.add.text(leftColX, height * 0.16, 'ONLINE PLAY', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '32px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(leftColX, height * 0.23, 'Multiplayer Combat', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '14px',
        color: '#8a99a8',
      }).setOrigin(0.5);

      const serverInfo = getStoredServerRegion();
      this.add.text(leftColX, height * 0.30, `🌐 SERVER: ${serverInfo.flag} ${serverInfo.name}`, {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '12px',
        color: '#60a5fa',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      addMatchDurationPicker(this, leftColX, height * 0.48);

      const backButton = makeButton(
        this,
        leftColX,
        height * 0.76,
        '⬅ BACK TO MENU',
        '#252d37',
        15,
        Math.min(260, colWidth * 0.88),
        44,
      );

      this.add.text(rightColX, height * 0.18, 'CHOOSE ONLINE MODE', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '16px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const cardWidth = Math.min(460, colWidth * 0.94);
      const cardHeight = Math.max(68, Math.min(84, Math.floor(height * 0.22)));

      const friendsButton = makeButton(
        this,
        rightColX,
        height * 0.38,
        '👥 PLAY WITH FRIENDS\nCreate or Join Private Rooms',
        '#2878ff',
        17,
        cardWidth,
        cardHeight,
      );

      const randomButton = makeButton(
        this,
        rightColX,
        height * 0.64,
        '🎲 RANDOM MATCHMAKING\nFast match with open lobbies',
        '#20a060',
        17,
        cardWidth,
        cardHeight,
      );

      friendsButton.on('pointerdown', () => this.scene.start('FriendsScene'));
      randomButton.on('pointerdown', () => this.scene.start('PlayerCountScene', { mode: 'random' }));
      backButton.on('pointerdown', () => this.scene.start('MenuScene'));

    } else {
      // Portrait / Compact Layout: Sequential vertical spacing
      const contentWidth = Math.min(340, width - 36);

      const titleY = Math.max(38, Math.min(52, Math.floor(height * 0.08)));
      this.add.text(width / 2, titleY, 'ONLINE PLAY', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const serverInfo = getStoredServerRegion();
      this.add.text(width / 2, titleY + 28, `🌐 SERVER: ${serverInfo.flag} ${serverInfo.name}`, {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '11.5px',
        color: '#60a5fa',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const pickerY = titleY + 62;
      addMatchDurationPicker(this, width / 2, pickerY);

      const btnH = 54;
      const friendsBtnY = pickerY + 62;
      const friendsButton = makeButton(
        this,
        width / 2,
        friendsBtnY,
        '👥 PLAY WITH FRIENDS',
        '#2878ff',
        17,
        contentWidth,
        btnH,
      );

      const randomBtnY = friendsBtnY + 64;
      const randomButton = makeButton(
        this,
        width / 2,
        randomBtnY,
        '🎲 RANDOM PLAYERS',
        '#20a060',
        17,
        contentWidth,
        btnH,
      );

      const backButton = makeButton(
        this,
        width / 2,
        randomBtnY + 62,
        'BACK',
        '#252d37',
        15,
        Math.min(200, contentWidth * 0.65),
        42,
      );

      friendsButton.on('pointerdown', () => this.scene.start('FriendsScene'));
      randomButton.on('pointerdown', () => this.scene.start('PlayerCountScene', { mode: 'random' }));
      backButton.on('pointerdown', () => this.scene.start('MenuScene'));
    }
  }
}

class FriendsScene extends Phaser.Scene {
  constructor() {
    super('FriendsScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;
    const isLandscape = width >= 640 && width > height * 1.12;

    if (isLandscape) {
      const cardWidth = Math.min(380, width * 0.42);
      const cardHeight = Math.max(72, Math.min(90, Math.floor(height * 0.26)));

      this.add.text(width / 2, height * 0.12, 'PLAY WITH FRIENDS', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '30px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(width / 2, height * 0.20, 'Private Kerala Matchmaking', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#8a99a8',
      }).setOrigin(0.5);

      const createButton = makeButton(
        this,
        width * 0.28,
        height * 0.48,
        '👑 CREATE GAME\nHost room & invite with code',
        '#2878ff',
        17,
        cardWidth,
        cardHeight,
      );

      const joinButton = makeButton(
        this,
        width * 0.72,
        height * 0.48,
        '🚪 JOIN GAME\nEnter 6-character room code',
        '#20a060',
        17,
        cardWidth,
        cardHeight,
      );

      const backButton = makeButton(
        this,
        width / 2,
        height * 0.80,
        '⬅ BACK TO ONLINE MODES',
        '#252d37',
        15,
        280,
        44,
      );

      createButton.on('pointerdown', () => this.scene.start('PlayerCountScene', { mode: 'private' }));
      joinButton.on('pointerdown', () => this.scene.start('JoinScene'));
      backButton.on('pointerdown', () => this.scene.start('OnlineModeScene'));

    } else {
      const contentWidth = Math.min(340, width - 36);
      const btnH = 54;

      const titleY = Math.max(38, Math.min(52, Math.floor(height * 0.08)));
      this.add.text(width / 2, titleY, 'PLAY WITH FRIENDS', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const subTitleY = titleY + 28;
      this.add.text(width / 2, subTitleY, 'Private Kerala Matchmaking', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#8a99a8',
      }).setOrigin(0.5);

      const createBtnY = subTitleY + 56;
      const createButton = makeButton(
        this,
        width / 2,
        createBtnY,
        '👑 CREATE GAME (HOST ROOM)',
        '#2878ff',
        17,
        contentWidth,
        btnH,
      );

      const joinBtnY = createBtnY + 64;
      const joinButton = makeButton(
        this,
        width / 2,
        joinBtnY,
        '🚪 JOIN GAME (ENTER CODE)',
        '#20a060',
        17,
        contentWidth,
        btnH,
      );

      const backButton = makeButton(
        this,
        width / 2,
        joinBtnY + 62,
        'BACK',
        '#252d37',
        15,
        Math.min(200, contentWidth * 0.65),
        42,
      );

      createButton.on('pointerdown', () => this.scene.start('PlayerCountScene', { mode: 'private' }));
      joinButton.on('pointerdown', () => this.scene.start('JoinScene'));
      backButton.on('pointerdown', () => this.scene.start('OnlineModeScene'));
    }
  }
}

class PlayerCountScene extends Phaser.Scene {
  private mode: 'private' | 'random' = 'private';
  private nameInput?: HTMLInputElement;
  private resizeHandler = () => {
    if (this.nameInput) {
      const { width, height } = this.scale;
      const isLandscape = width >= 640 && width > height * 1.12;
      const inputX = isLandscape ? width * 0.72 : width / 2;
      const inputY = isLandscape ? height * 0.32 : 305;
      const inputW = isLandscape ? Math.min(340, width * 0.40) : Math.min(320, width - 40);
      positionHtmlInput(this, this.nameInput, inputX, inputY, inputW);
    }
  };

  constructor() {
    super('PlayerCountScene');
  }

  init(data: { mode?: 'private' | 'random' }) {
    this.mode =
      data?.mode === 'random'
        ? 'random'
        : 'private';
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;
    const isLandscape = width >= 640 && width > height * 1.12;
    let selectedCount = MIN_PLAYERS;

    const choices = PLAYER_COUNTS;
    const choiceButtons: Phaser.GameObjects.Text[] = [];
    const countBtnH = 40;
    const countGapX = 6;
    const countGapY = 8;

    let actionButton: Phaser.GameObjects.Text;
    let backButton: Phaser.GameObjects.Text;
    let selectedText: Phaser.GameObjects.Text;

    if (isLandscape) {
      const leftColX = width * 0.30;
      const rightColX = width * 0.72;
      const colWidth = Math.min(420, width * 0.40);

      this.add.text(
        leftColX,
        height * 0.16,
        this.mode === 'private' ? 'CHOOSE PLAYERS' : 'RANDOM MATCH',
        {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '26px',
          color: '#ffffff',
          fontStyle: 'bold',
        },
      ).setOrigin(0.5);

      this.add.text(
        leftColX,
        height * 0.25,
        this.mode === 'private'
          ? 'Select number of players for your room.'
          : 'Matchmaking for open rooms.',
        {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '13px',
          color: '#8a99a8',
          align: 'center',
        },
      ).setOrigin(0.5);

      selectedText = this.add.text(leftColX, height * 0.38, `${MIN_PLAYERS} PLAYERS`, {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '22px',
        color: '#4da3ff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      actionButton = makeButton(
        this,
        leftColX,
        height * 0.60,
        this.mode === 'private' ? 'CREATE ROOM' : 'FIND MATCH',
        '#2878ff',
        18,
        colWidth,
        50,
      );

      backButton = makeButton(
        this,
        leftColX,
        height * 0.78,
        'BACK',
        '#252d37',
        15,
        Math.min(180, colWidth * 0.65),
        42,
      );

      // Right Column: Grid and Name
      let gridTopY = height * 0.38;
      if (this.mode === 'random') {
        this.add.text(rightColX, height * 0.22, 'YOUR NAME', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '12px',
          color: '#f2cf66',
          fontStyle: 'bold',
        }).setOrigin(0.5);

        this.nameInput = document.createElement('input');
        this.nameInput.id = 'peeranki-random-player-name';
        this.nameInput.type = 'text';
        this.nameInput.placeholder = 'Enter your name';
        this.nameInput.maxLength = 16;
        this.nameInput.value = getStoredPlayerName();
        this.nameInput.autocomplete = 'name';
        this.nameInput.addEventListener('input', () => {
          setStoredPlayerName(this.nameInput?.value ?? '');
        });
        document.body.appendChild(this.nameInput);

        positionHtmlInput(this, this.nameInput, rightColX, height * 0.32, colWidth);
        gridTopY = height * 0.52;
      }

      this.add.text(rightColX, gridTopY - 26, 'SELECT SLOTS', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const maxGridW = Math.min(340, colWidth);
      const countBtnW = Math.floor((maxGridW - 4 * countGapX) / 5);
      const row1 = choices.slice(0, 5);
      const row2 = choices.slice(5);

      const row1TotalW = row1.length * countBtnW + (row1.length - 1) * countGapX;
      const row1StartX = rightColX - row1TotalW / 2 + countBtnW / 2;
      const row2StartX = row1StartX;
      const row1Y = gridTopY + 10;
      const row2Y = row1Y + countBtnH + countGapY;

      row1.forEach((count, index) => {
        const x = row1StartX + index * (countBtnW + countGapX);
        const button = makeButton(this, x, row1Y, String(count), count === selectedCount ? '#2878ff' : '#2a3037', 16, countBtnW, countBtnH);
        choiceButtons.push(button);
        button.on('pointerdown', () => {
          selectedCount = count;
          selectedText.setText(`${selectedCount} PLAYERS`);
          choiceButtons.forEach((btn, idx) => btn.setBackgroundColor(choices[idx] === selectedCount ? '#2878ff' : '#2a3037'));
        });
      });

      row2.forEach((count, index) => {
        const x = row2StartX + index * (countBtnW + countGapX);
        const button = makeButton(this, x, row2Y, String(count), count === selectedCount ? '#2878ff' : '#2a3037', 16, countBtnW, countBtnH);
        choiceButtons.push(button);
        button.on('pointerdown', () => {
          selectedCount = count;
          selectedText.setText(`${selectedCount} PLAYERS`);
          choiceButtons.forEach((btn, idx) => btn.setBackgroundColor(choices[idx] === selectedCount ? '#2878ff' : '#2a3037'));
        });
      });

    } else {
      // PORTRAIT / MOBILE COMPACT
      const maxGridW = Math.min(340, width - 36);
      const countBtnW = Math.floor((maxGridW - 4 * countGapX) / 5);

      this.add.text(
        width / 2,
        46,
        this.mode === 'private' ? 'CHOOSE PLAYERS' : 'RANDOM MATCH',
        {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '24px',
          color: '#ffffff',
          fontStyle: 'bold',
        },
      ).setOrigin(0.5);

      this.add.text(
        width / 2,
        78,
        this.mode === 'private'
          ? 'Choose the number of players for your room.'
          : 'Choose the number of players for matchmaking.',
        {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '13px',
          color: '#8a99a8',
          align: 'center',
        },
      ).setOrigin(0.5);

      selectedText = this.add.text(width / 2, 114, `${MIN_PLAYERS} PLAYERS`, {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '20px',
        color: '#4da3ff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      const row1 = choices.slice(0, 5);
      const row2 = choices.slice(5);

      const row1TotalW = row1.length * countBtnW + (row1.length - 1) * countGapX;
      const row1StartX = width / 2 - row1TotalW / 2 + countBtnW / 2;
      const row2StartX = row1StartX;

      const row1Y = 155;
      const row2Y = row1Y + countBtnH + countGapY;

      row1.forEach((count, index) => {
        const x = row1StartX + index * (countBtnW + countGapX);
        const button = makeButton(this, x, row1Y, String(count), count === selectedCount ? '#2878ff' : '#2a3037', 16, countBtnW, countBtnH);
        choiceButtons.push(button);
        button.on('pointerdown', () => {
          selectedCount = count;
          selectedText.setText(`${selectedCount} PLAYERS`);
          choiceButtons.forEach((btn, idx) => btn.setBackgroundColor(choices[idx] === selectedCount ? '#2878ff' : '#2a3037'));
        });
      });

      row2.forEach((count, index) => {
        const x = row2StartX + index * (countBtnW + countGapX);
        const button = makeButton(this, x, row2Y, String(count), count === selectedCount ? '#2878ff' : '#2a3037', 16, countBtnW, countBtnH);
        choiceButtons.push(button);
        button.on('pointerdown', () => {
          selectedCount = count;
          selectedText.setText(`${selectedCount} PLAYERS`);
          choiceButtons.forEach((btn, idx) => btn.setBackgroundColor(choices[idx] === selectedCount ? '#2878ff' : '#2a3037'));
        });
      });

      const btnWidth = Math.min(320, width - 40);

      if (this.mode === 'random') {
        this.add.text(width / 2, 265, 'YOUR NAME', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '12px',
          color: '#f2cf66',
          fontStyle: 'bold',
        }).setOrigin(0.5);

        this.nameInput = document.createElement('input');
        this.nameInput.id = 'peeranki-random-player-name';
        this.nameInput.type = 'text';
        this.nameInput.placeholder = 'Enter your name';
        this.nameInput.maxLength = 16;
        this.nameInput.value = getStoredPlayerName();
        this.nameInput.autocomplete = 'name';
        this.nameInput.addEventListener('input', () => {
          setStoredPlayerName(this.nameInput?.value ?? '');
        });
        document.body.appendChild(this.nameInput);

        positionHtmlInput(this, this.nameInput, width / 2, 305, btnWidth);

        actionButton = makeButton(this, width / 2, 380, 'FIND MATCH', '#2878ff', 18, btnWidth, 50);
        backButton = makeButton(this, width / 2, 445, 'BACK', '#252d37', 15, Math.min(180, btnWidth * 0.65), 42);
      } else {
        actionButton = makeButton(this, width / 2, 285, 'CREATE ROOM', '#2878ff', 18, btnWidth, 50);
        backButton = makeButton(this, width / 2, 350, 'BACK', '#252d37', 15, Math.min(180, btnWidth * 0.65), 42);
      }
    }

    window.addEventListener('resize', this.resizeHandler);

    actionButton.on('pointerdown', async () => {
      actionButton.disableInteractive();
      backButton.disableInteractive();
      actionButton.setText(
        this.mode === 'private'
          ? 'CREATING...'
          : 'FINDING...',
      );

      await previousRoomCleanup;

      if (this.mode === 'private') {
        const result = await createPrivateRoom(
          selectedCount,
          sessionId,
          getStoredPlayerName(),
        );

        if (!result) {
          actionButton.setText('CREATE FAILED');
          actionButton.setInteractive({
            useHandCursor: true,
          });
          backButton.setInteractive({
            useHandCursor: true,
          });
          return;
        }

        roomCode = String(result.room_code);
        maxPlayers = Number(result.max_players);
        isPublicRoom = false;
        hostSessionId = String(
          result.host_session_id ?? sessionId,
        );

        loadPlayersFromRoom(
          Array.isArray(result.players)
            ? result.players
            : [],
        );

        rememberRoom(roomCode, false);
        startRoomHeartbeat();
        this.scene.start('LobbyScene');
        return;
      }

      const name =
        this.nameInput?.value.trim() || getStoredPlayerName();
      setStoredPlayerName(name);

      const result =
        await findOrCreateRandomRoom(
          selectedCount,
          name,
          sessionId,
        );

      if (!result) {
        actionButton.setText('MATCH FAILED');
        actionButton.setInteractive({
          useHandCursor: true,
        });
        backButton.setInteractive({
          useHandCursor: true,
        });
        return;
      }

      removePeerankiInputs();

      roomCode = String(result.room_code);
      maxPlayers = Number(result.max_players);
      isPublicRoom = true;
      hostSessionId = String(
        result.host_session_id ?? '',
      );

      loadPlayersFromRoom(
        Array.isArray(result.players)
          ? result.players
          : [],
      );

      findMyPlayerId();
      rememberRoom(roomCode, true);
      startRoomHeartbeat();

      this.scene.start('LobbyScene');
    });

    backButton.on('pointerdown', () => {
      removePeerankiInputs();
      this.scene.start(
        this.mode === 'private'
          ? 'FriendsScene'
          : 'OnlineModeScene',
      );
    });
  }

  shutdown() {
    window.removeEventListener(
      'resize',
      this.resizeHandler,
    );
    this.nameInput?.remove();
    this.nameInput = undefined;
  }
}

class JoinScene extends Phaser.Scene {
  private roomInput?: HTMLInputElement;
  private nameInput?: HTMLInputElement;
  private resizeHandler = () => {
    const { width, height } = this.scale;
    const isLandscape = width >= 640 && width > height * 1.12;

    if (this.roomInput) {
      const inputX = isLandscape ? width * 0.72 : width / 2;
      const inputY = isLandscape ? height * 0.28 : 168;
      const inputW = isLandscape ? Math.min(320, width * 0.40) : Math.min(300, width - 40);
      positionHtmlInput(this, this.roomInput, inputX, inputY, inputW);
    }

    if (this.nameInput) {
      const inputX = isLandscape ? width * 0.72 : width / 2;
      const inputY = isLandscape ? height * 0.54 : 272;
      const inputW = isLandscape ? Math.min(320, width * 0.40) : Math.min(300, width - 40);
      positionHtmlInput(this, this.nameInput, inputX, inputY, inputW);
    }
  };

  constructor() {
    super('JoinScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;
    const isLandscape = width >= 640 && width > height * 1.12;

    let joinButton: Phaser.GameObjects.Text;
    let backButton: Phaser.GameObjects.Text;

    if (isLandscape) {
      const leftColX = width * 0.30;
      const rightColX = width * 0.72;
      const colWidth = Math.min(420, width * 0.40);

      this.add.text(leftColX, height * 0.22, 'JOIN PRIVATE GAME', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '26px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(leftColX, height * 0.34, 'Enter the 6-character room code\nshared by the host.', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#8a99a8',
        align: 'center',
        lineSpacing: 4,
      }).setOrigin(0.5);

      backButton = makeButton(
        this,
        leftColX,
        height * 0.65,
        'BACK',
        '#252d37',
        15,
        Math.min(200, colWidth * 0.65),
        42,
      );

      this.add.text(rightColX, height * 0.18, 'ROOM CODE', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.roomInput = this.createInput('ABC123', 'peeranki-room-code', true);

      this.add.text(rightColX, height * 0.44, 'YOUR NAME', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.nameInput = this.createInput('Enter your name', 'peeranki-player-name', false);
      this.nameInput.value = getStoredPlayerName();
      this.nameInput.addEventListener('input', () => {
        setStoredPlayerName(this.nameInput?.value ?? '');
      });

      joinButton = makeButton(
        this,
        rightColX,
        height * 0.76,
        'JOIN GAME',
        '#2878ff',
        18,
        colWidth,
        50,
      );

    } else {
      // PORTRAIT / MOBILE COMPACT: Guaranteed safe sequential vertical spacing
      const contentWidth = Math.min(320, width - 40);

      this.add.text(width / 2, 46, 'JOIN PRIVATE GAME', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '24px',
        color: '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.add.text(width / 2, 78, 'Enter the room code shared by the host', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#8a99a8',
      }).setOrigin(0.5);

      this.add.text(width / 2, 126, 'ROOM CODE', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.roomInput = this.createInput('ABC123', 'peeranki-room-code', true);

      this.add.text(width / 2, 230, 'YOUR NAME', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '13px',
        color: '#f2cf66',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      this.nameInput = this.createInput('Enter your name', 'peeranki-player-name', false);
      this.nameInput.value = getStoredPlayerName();
      this.nameInput.addEventListener('input', () => {
        setStoredPlayerName(this.nameInput?.value ?? '');
      });

      joinButton = makeButton(
        this,
        width / 2,
        356,
        'JOIN GAME',
        '#2878ff',
        18,
        contentWidth,
        50,
      );

      backButton = makeButton(
        this,
        width / 2,
        418,
        'BACK',
        '#252d37',
        15,
        Math.min(180, contentWidth * 0.65),
        42,
      );
    }

    this.resizeHandler();
    window.addEventListener('resize', this.resizeHandler);

    joinButton.on('pointerdown', async () => {
      const code =
        this.roomInput?.value.trim().toUpperCase() ??
        '';
      const name =
        this.nameInput?.value.trim() || getStoredPlayerName();
      setStoredPlayerName(name);

      if (code.length !== 6) {
        joinButton.setText('ENTER 6-CHAR CODE');
        this.roomInput?.focus();
        return;
      }

      joinButton.disableInteractive();
      backButton.disableInteractive();
      joinButton.setText('JOINING...');

      await previousRoomCleanup;

      const result = await joinRoom(
        code,
        name,
        sessionId,
      );

      if (!result) {
        joinButton.setText('JOIN FAILED');
        joinButton.setInteractive({
          useHandCursor: true,
        });
        backButton.setInteractive({
          useHandCursor: true,
        });
        return;
      }

      removePeerankiInputs();

      roomCode = String(result.room_code);
      maxPlayers = Number(result.max_players);
      isPublicRoom = Boolean(result.is_public);
      hostSessionId = String(
        result.host_session_id ?? '',
      );

      loadPlayersFromRoom(
        Array.isArray(result.players)
          ? result.players
          : [],
      );

      findMyPlayerId();
      rememberRoom(roomCode, isPublicRoom);
      startRoomHeartbeat();

      this.scene.start('LobbyScene');
    });

    backButton.on('pointerdown', () => {
      removePeerankiInputs();
      this.scene.start('FriendsScene');
    });
  }

  private createInput(
    placeholder: string,
    id: string,
    uppercase: boolean,
  ) {
    const input = document.createElement('input');

    input.id = id;
    input.type = 'text';
    input.placeholder = placeholder;
    input.maxLength = uppercase ? 6 : 20;
    input.autocomplete = uppercase ? 'off' : 'name';
    input.spellcheck = false;
    input.style.textTransform =
      uppercase ? 'uppercase' : 'none';

    if (uppercase) {
      input.addEventListener('input', () => {
        input.value = input.value
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
      });
    }

    document.body.appendChild(input);
    return input;
  }

  shutdown() {
    window.removeEventListener(
      'resize',
      this.resizeHandler,
    );
    this.roomInput?.remove();
    this.nameInput?.remove();
    this.roomInput = undefined;
    this.nameInput = undefined;
  }
}

class LobbyScene extends Phaser.Scene {
  private playerText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  private startButton?: Phaser.GameObjects.Text;
  private leaveButton?: Phaser.GameObjects.Text;
  private realtimeChannel: any;
  private refreshTimer?: Phaser.Time.TimerEvent;
  private starting = false;
  private lastPlayerCount = 0;

  constructor() {
    super('LobbyScene');
  }

  create() {
    const { width, height } = this.scale;
    const isLandscape = width >= 640 && width > height * 1.12;

    const copyBtnW = isLandscape ? Math.min(320, Math.floor(width * 0.38)) : Math.min(340, width - 36);

    if (isLandscape) {
      const leftColX = width * 0.28;
      const rightColX = width * 0.72;
      const colWidth = Math.min(420, width * 0.40);

      this.add
        .text(leftColX, height * 0.14, 'WAITING ROOM', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '26px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);

      const copyBtn = makeButton(
        this,
        leftColX,
        height * 0.28,
        `📋 ROOM: ${roomCode} (TAP TO COPY)`,
        '#1e293b',
        13,
        copyBtnW,
        42,
      );

      copyBtn.on('pointerdown', async () => {
        try {
          await navigator.clipboard.writeText(roomCode);
          copyBtn.setText(`✅ COPIED: ${roomCode}!`);
          copyBtn.setStyle({ backgroundColor: '#15803d' });
          PeerankiAudio.effect('select');
          this.time.delayedCall(2200, () => {
            copyBtn.setText(`📋 ROOM: ${roomCode} (TAP TO COPY)`);
            copyBtn.setStyle({ backgroundColor: '#1e293b' });
          });
        } catch {
          copyBtn.setText(`ROOM: ${roomCode}`);
        }
      });

      this.add
        .text(
          leftColX,
          height * 0.40,
          `${maxPlayers} PLAYER MATCH${isPublicRoom ? ' • PUBLIC' : ' • PRIVATE'}`,
          {
            fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
            fontSize: '12px',
            color: '#8a99a8',
            fontStyle: 'bold',
          },
        )
        .setOrigin(0.5);

      this.statusText = this.add
        .text(leftColX, height * 0.54, '🟢 Connected • Waiting for players...', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '13px',
          color: '#38e08d',
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: colWidth, useAdvancedWrap: true },
        })
        .setOrigin(0.5);

      if (amHost() && !isPublicRoom) {
        this.startButton = makeButton(
          this,
          leftColX,
          height * 0.70,
          '▶ START GAME',
          '#20a060',
          17,
          colWidth,
          48,
        );

        this.startButton.on('pointerdown', () => {
          void this.startGame();
        });
      }

      this.leaveButton = makeButton(
        this,
        leftColX,
        height * 0.86,
        'LEAVE ROOM',
        '#9b3030',
        14,
        Math.min(220, colWidth * 0.70),
        40,
      );

      this.leaveButton.on('pointerdown', async () => {
        this.leaveButton?.disableInteractive();
        this.statusText?.setText('Leaving room...');
        await leaveCurrentRoom();
        this.scene.start('OnlineModeScene');
      });

      // Right Column: Player Roster Panel
      const rosterW = Math.min(440, Math.floor(width * 0.42));
      const rosterH = Math.min(360, Math.floor(height * 0.80));
      const rosterBg = this.add.graphics();
      rosterBg.fillStyle(0x182029, 0.85);
      rosterBg.lineStyle(1.5, 0x2d3846, 0.8);
      rosterBg.fillRoundedRect(rightColX - rosterW / 2, height * 0.10, rosterW, rosterH, 12);
      rosterBg.strokeRoundedRect(rightColX - rosterW / 2, height * 0.10, rosterW, rosterH, 12);

      this.playerText = this.add
        .text(rightColX, height * 0.14, 'Connecting to room...', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '13px',
          color: '#ffffff',
          align: 'left',
          lineSpacing: 5,
          wordWrap: { width: rosterW - 24, useAdvancedWrap: true },
        })
        .setOrigin(0.5, 0);

    } else {
      // PORTRAIT: Guaranteed sequential top and bottom anchoring to prevent overlap
      this.add
        .text(width / 2, 34, 'WAITING ROOM', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '22px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);

      const copyBtn = makeButton(
        this,
        width / 2,
        74,
        `📋 ROOM: ${roomCode} (TAP TO COPY)`,
        '#1e293b',
        13,
        copyBtnW,
        40,
      );

      copyBtn.on('pointerdown', async () => {
        try {
          await navigator.clipboard.writeText(roomCode);
          copyBtn.setText(`✅ COPIED: ${roomCode}!`);
          copyBtn.setStyle({ backgroundColor: '#15803d' });
          PeerankiAudio.effect('select');
          this.time.delayedCall(2200, () => {
            copyBtn.setText(`📋 ROOM: ${roomCode} (TAP TO COPY)`);
            copyBtn.setStyle({ backgroundColor: '#1e293b' });
          });
        } catch {
          copyBtn.setText(`ROOM: ${roomCode}`);
        }
      });

      this.add
        .text(
          width / 2,
          112,
          `${maxPlayers} PLAYER MATCH${isPublicRoom ? ' • PUBLIC' : ' • PRIVATE'}`,
          {
            fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
            fontSize: '12px',
            color: '#8a99a8',
            fontStyle: 'bold',
          },
        )
        .setOrigin(0.5);

      // Player list anchored from top: grows downwards from y=134
      const pFontSize = maxPlayers > 6 || height < 650 ? '11.5px' : '13px';
      const pSpacing = maxPlayers > 6 || height < 650 ? 2 : 4;
      this.playerText = this.add
        .text(width / 2, 134, 'Connecting to room...', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: pFontSize,
          color: '#ffffff',
          align: 'center',
          lineSpacing: pSpacing,
          wordWrap: { width: Math.min(360, width - 36), useAdvancedWrap: true },
        })
        .setOrigin(0.5, 0);

      // Controls anchored from the bottom
      const lobbyBtnW = Math.min(300, Math.floor(width * 0.84));

      this.statusText = this.add
        .text(width / 2, height - 110, '🟢 Connected • Waiting for players...', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '13px',
          color: '#38e08d',
          fontStyle: 'bold',
          align: 'center',
          wordWrap: { width: lobbyBtnW, useAdvancedWrap: true },
        })
        .setOrigin(0.5);

      if (amHost() && !isPublicRoom) {
        this.startButton = makeButton(
          this,
          width / 2,
          height - 70,
          '▶ START GAME',
          '#20a060',
          17,
          lobbyBtnW,
          46,
        );

        this.startButton.on('pointerdown', () => {
          void this.startGame();
        });
      }

      this.leaveButton = makeButton(
        this,
        width / 2,
        amHost() && !isPublicRoom ? height - 24 : height - 48,
        'LEAVE ROOM',
        '#9b3030',
        14,
        Math.min(180, lobbyBtnW * 0.65),
        38,
      );

      this.leaveButton.on('pointerdown', async () => {
        this.leaveButton?.disableInteractive();
        this.statusText?.setText('Leaving room...');
        await leaveCurrentRoom();
        this.scene.start('OnlineModeScene');
      });
    }

    this.realtimeChannel = subscribeToGameState(
      roomCode,
      (gameState) => {
        this.applyRoomState(gameState);
      },
    );

    void this.refreshLobby();

    this.refreshTimer = this.time.addEvent({
      delay: 3500,
      loop: true,
      callback: () => {
        void this.refreshLobby();
      },
    });
  }

  private applyRoomState(gameState: any) {
    if (!gameState) {
      return;
    }

    if (
      Number.isFinite(Number(gameState.max_players))
    ) {
      maxPlayers = Number(
        gameState.max_players,
      );
    }

    hostSessionId = String(
      gameState.host_session_id ?? hostSessionId,
    );

    if (Array.isArray(gameState.players)) {
      const prevCount = this.lastPlayerCount;
      loadPlayersFromRoom(gameState.players);
      const newCount = connectedPlayers().length;
      if (newCount > prevCount && prevCount > 0) {
        PeerankiAudio.effect('select');
      }
      this.lastPlayerCount = newCount;
      this.updateLobbyText();
    }

    if (gameState.game_status === 'playing') {
      this.openGame();
    }
  }

  private async refreshLobby() {
    if (this.starting) {
      return;
    }

    const result = await fetchGameRoom(roomCode);

    if (!result) {
      this.statusText?.setText(
        'Room closed or connection failed.',
      );
      this.statusText?.setStyle({ color: '#ef4444' });
      return;
    }

    this.applyRoomState(result);

    if (isPublicRoom && amHost()) {
      const count = connectedPlayers().length;

      if (
        count === maxPlayers &&
        result.game_status === 'waiting'
      ) {
        void this.startGame();
      }
    }
  }

  private updateLobbyText() {
    const connected = connectedPlayers();

    let text = `PLAYERS CONNECTED: ${connected.length} / ${maxPlayers}\n\n`;

    connected.forEach((player, index) => {
      const isHost = player.sessionId === hostSessionId;
      const isYou = player.sessionId === sessionId;
      const hostMark = isHost ? ' 👑 HOST' : '';
      const youMark = isYou ? ' (YOU)' : '';

      text += `${index + 1}. ${player.name}${hostMark}${youMark}   🟢 READY\n`;
    });

    for (let i = connected.length; i < maxPlayers; i++) {
      text += `${i + 1}. [Waiting for player to join...]   ⏳\n`;
    }

    this.playerText?.setText(text);

    if (connected.length < maxPlayers) {
      this.statusText?.setText(
        isPublicRoom
          ? `🔍 Matchmaking active... Waiting for ${maxPlayers - connected.length} more player(s)`
          : amHost()
            ? `Share code "${roomCode}" with friends! (${maxPlayers - connected.length} slots left)`
            : 'Waiting for players to join...',
      );
      this.statusText?.setStyle({ color: '#f2cf66' });

      this.startButton?.setVisible(false);
    } else {
      this.statusText?.setText(
        isPublicRoom
          ? '🚀 Room is full! Starting match...'
          : amHost()
            ? '✨ All players joined! Tap START GAME to begin!'
            : '✨ All players joined! Host is starting the match...',
      );
      this.statusText?.setStyle({ color: '#38e08d' });

      this.startButton?.setVisible(true);
    }
  }

  private async startGame() {
    const connected = connectedPlayers();

    if (
      this.starting ||
      !amHost() ||
      connected.length !== maxPlayers
    ) {
      return;
    }

    this.starting = true;
    processedOnlineActionNonces.clear();
    this.startButton?.disableInteractive();
    this.startButton?.setText('STARTING...');

    matchStartedAt = new Date().toISOString();
    matchRound = 1;
    duelRound = 1;
    countingStartIndex = -1;
    roundWinnerId = 0;
    matchOver = false;
    lastRoundMessage = '';
    const cleanPlayers = connected.map(
      (player) => ({
        id: player.id,
        name: player.name,
        avatar: player.avatar || getSelectedAvatarId(),
        stage: 0,
        alive: true,
        session_id: player.sessionId,
        connected: true,
        last_seen: player.lastSeen,
        weapons: ['gun'],
        all_weapons_collected: false,
        elimination_points: 0,
        shield_disabled_round: -1,
        match_started_at: matchStartedAt,
        match_round: 1,
        counting_start_index: -1,
        round_winner_id: 0,
        match_over: false,
        action_request: null,
        duel_choice: null,
        duel_choice_request: null,
        duel_round: 1,
        round_message: '',
        match_duration_minutes: matchDurationMinutes,
      }),
    );

    const { error } = await supabase
      .from('game_states')
      .update({
        players: cleanPlayers,
        current_shooter: null,
        countdown: 0,
        game_status: 'playing',
        updated_at: new Date().toISOString(),
      })
      .eq('room_code', roomCode);

    if (error) {
      console.error(
        'Failed to start game:',
        error,
      );

      this.starting = false;
      this.startButton?.setText('START FAILED');
      this.startButton?.setInteractive({
        useHandCursor: true,
      });
      return;
    }

    loadPlayersFromRoom(cleanPlayers);
    this.openGame();
  }

  private openGame() {
    if (this.scene.isActive('GameScene')) {
      return;
    }

    this.starting = true;
    this.refreshTimer?.remove(false);

    this.scene.start('GameScene');
  }

  shutdown() {
    this.refreshTimer?.remove(false);

    if (this.realtimeChannel) {
      void this.realtimeChannel.unsubscribe();
      this.realtimeChannel = undefined;
    }
  }
}

class GameScene extends Phaser.Scene {
  private uiManager = new GameUIManager();
  private playerObjects: Phaser.GameObjects.Container[] = [];
  private statusText?: Phaser.GameObjects.Text;
  private countText?: Phaser.GameObjects.Text;
  private shooterText?: Phaser.GameObjects.Text;
  private leaveButton?: Phaser.GameObjects.Text;
  private matchText?: Phaser.GameObjects.Text;
  private weaponText?: Phaser.GameObjects.Text;
  private weaponImage?: Phaser.GameObjects.Image;
  private previousRoundText?: Phaser.GameObjects.Text;
  private matchTimer?: Phaser.Time.TimerEvent;
  private actionTimer?: Phaser.Time.TimerEvent;
  private selectedWeapon: WeaponType = 'gun';
  private pendingDoubleTarget = -1;
  private lastActionSeconds = -1;
  private lastMatchSeconds = -1;

 private currentShooter = -1;
private startIndex = -1;
private countNumber = 0;
private nextStartIndex = -1;

  private countingTimer?: Phaser.Time.TimerEvent;
  private nextRoundTimer?: Phaser.Time.TimerEvent;
  private realtimeChannel: any;
  private applyingRemoteState = false;
  private initialized = false;
  private gameFinished = false;
  private victoryPlayed = false;
  private roundPhase: 'counting' | 'shooting' | 'duel' | 'waiting' | 'finished' = 'waiting';
  private duelActive = false;
  private resolvingDuel = false;
  private processingDuelChoices = false;
  private duelUi: Phaser.GameObjects.GameObject[] = [];
  private duelPrompt?: Phaser.GameObjects.Text;
  private duelBotTimer?: Phaser.Time.TimerEvent;
  private uiSyncScheduled = false;
  private uiSyncRafId: number | null = null;
  private currentLatencyMs: number | undefined;
  private pingTimer?: Phaser.Time.TimerEvent;
  private lastAnnouncedRoundMessage = '';
  private lastAnnouncedDuelRound = 1;

  constructor() {
    super('GameScene');
  }

  preload() {
    this.load.image(
      'game_background',
      'assets/background/game_background.webp',
    );
    this.load.image('tower_big', 'assets/towers/tower_big.png');
    this.load.image('tower_small', 'assets/towers/tower_small.png');
    this.load.image('tower_one', 'assets/towers/tower_one.png');
    this.load.image('tower_destroyed', 'assets/towers/tower_destroyed.png');
    WEAPON_ORDER.forEach((weapon) => this.load.image(`weapon-${weapon}`, `assets/weapons/${weapon === 'doublePeeranki' ? 'double_peeranki' : weapon}.png`));
    AVATAR_IDS.forEach((id) => {
      this.load.svg(`avatar_${id}`, `assets/players/avatar_${id}.svg`, { width: 96, height: 96 });
    });
  }

  create() {
    this.gameFinished = false;
    this.victoryPlayed = false;
    this.duelActive = false;
    this.resolvingDuel = false;
    this.processingDuelChoices = false;
    this.clearDuelControls();
    this.roundPhase = 'waiting';
    this.currentShooter = -1;
    this.startIndex = -1;
    this.countNumber = 0;
    this.nextStartIndex = -1;
    this.pendingDoubleTarget = -1;
    this.selectedWeapon = 'gun';
    shootingDeadlineAt = '';
    if (offlineMode) {
      console.log('Offline mode active');
    }

    const canvas = this.game.canvas;
    canvas.style.opacity = '0';
    canvas.style.pointerEvents = 'none';

    this.uiManager.mount('#game', {
      onShootPlayer: (targetIndex: number) => {
        PeerankiAudio.effect('select');
        this.shootPlayer(targetIndex);
        this.scheduleUiSync();
      },
      onSelectWeapon: (weapon: WeaponType) => {
        const localIndex = offlineMode ? 0 : myPlayerId - 1;
        const owned = players[localIndex]?.weapons ?? ['gun'];
        if (ACTIVE_WEAPONS.includes(weapon) && owned.includes(weapon)) {
          this.selectedWeapon = weapon;
          this.pendingDoubleTarget = -1;
          this.refreshWeaponPicker();
          this.scheduleUiSync();
        }
      },
      onCycleWeapon: (direction: number) => {
        this.cycleWeapon(direction);
        this.scheduleUiSync();
      },
      onSubmitDuelChoice: (choice: RpsChoice) => {
        this.submitDuelChoice(choice);
        this.scheduleUiSync();
      },
      onLeaveGame: async () => {
        this.uiManager.unmount();
        canvas.style.opacity = '1';
        canvas.style.pointerEvents = 'auto';
        if (offlineMode) {
          this.scene.start('OfflineSetupScene');
        } else {
          await leaveCurrentRoom();
          this.scene.start('OnlineModeScene');
        }
      },
      onPlayAgain: () => {
        this.uiManager.unmount();
        canvas.style.opacity = '1';
        canvas.style.pointerEvents = 'auto';
        this.scene.restart();
      },
      onToggleAudio: () => {
        const isMuted = PeerankiAudio.toggleMute();
        this.scheduleUiSync();
        return isMuted;
      },
    });

    this.events.once('shutdown', () => {
      this.uiManager.unmount();
      canvas.style.opacity = '1';
      canvas.style.pointerEvents = 'auto';
    });
    const { width, height } = this.scale;
        const background = this.add
      .image(width / 2, height / 2, 'game_background')
      .setOrigin(0.5);

    const scaleX = width / background.width;
    const scaleY = height / background.height;
    const backgroundScale = Math.max(scaleX, scaleY);

    background.setScale(backgroundScale);
    background.setDepth(-100);
    const topOverlay = this.add.rectangle(
  width / 2,
  92,
  width,
  185,
  0x000000,
  0.28,
);

topOverlay.setDepth(-50);
const bottomOverlay = this.add.rectangle(
  width / 2,
  height - 42,
  width,
  90,
  0x000000,
  0.22,
);

bottomOverlay.setDepth(-50);

if (offlineMode) {
  maxPlayers = offlineMaxPlayers;

  players.splice(
    0,
    players.length,
    ...offlinePlayers,
  );

  console.log(
    'Offline players loaded into GameScene:',
    players,
  );

  this.renderPlayers();
}

    this.shooterText = this.add
      .text(width / 2, 76, '', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '20px',
        color: '#4da3ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(width / 2, 105, '', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '15px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    this.matchText = this.add.text(width / 2, 135, `MATCH ${String(matchDurationMinutes).padStart(2, '0')}:00 • ROUND 1`, {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif', fontSize: '23px', color: '#f2cf66', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.previousRoundText = this.add.text(width / 2, 169, '', {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif', fontSize: '14px', color: '#f2cf66', fontStyle: 'bold',
    }).setOrigin(0.5);
    const controlsY = height - 104;
    const previousWeapon = makeButton(this, width / 2 - 155, controlsY, '‹', '#444c55', 15);
    this.weaponImage = this.add.image(width / 2 - 94, controlsY, 'weapon-gun').setDisplaySize(46, 46);
    this.weaponText = this.add.text(width / 2 + 22, controlsY, '', {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif', fontSize: '14px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    const nextWeapon = makeButton(this, width / 2 + 155, controlsY, '›', '#444c55', 15);
    previousWeapon.on('pointerdown', () => this.cycleWeapon(-1));
    nextWeapon.on('pointerdown', () => this.cycleWeapon(1));
    this.refreshWeaponPicker();

    this.countText = this.add
      .text(width / 2, height - 44, '', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '26px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.leaveButton = this.add
      .text(width - 54, 32, 'LEAVE', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
        fontSize: '15px',
        color: '#ffffff',
        backgroundColor: '#9b3030',
        padding: { left: 12, right: 12, top: 9, bottom: 9 },
      })
      .setOrigin(0.5)
      .setDepth(1000)
      .setInteractive({ useHandCursor: true });

    // Keep the touch target inside the visible game area as Phaser FIT resizes.
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.leaveButton?.setPosition(gameSize.width - 54, 32);
    });

    this.leaveButton.on(
      'pointerdown',
      async () => {
        this.leaveButton?.disableInteractive();
        this.statusText?.setText('Leaving game...');
        if (offlineMode) {
          this.scene.start('OfflineSetupScene');
        } else {
          await leaveCurrentRoom();
          this.scene.start('OnlineModeScene');
        }
      },
    );

    if (loadSettings().keyboardControls) {
      this.add.text(width / 2, height - 24, 'Keyboard: press 1–9 (0 = player 10) to choose a target', {
        fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif', fontSize: '12px', color: '#777777',
      }).setOrigin(0.5, 1);
      this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
        const index = event.key === '0' ? 9 : Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < maxPlayers) {
          this.shootPlayer(index);
        }
      });
    }

    if (offlineMode) {
      matchStartedAt = new Date().toISOString();
      matchRound = 1;
      duelRound = 1;
      lastRoundMessage = '';
      matchOver = false;
      players.forEach((player) => {
        player.weapons = ['gun']; player.shieldDisabledRound = -1;
        player.hasCollectedAllWeapons = false;
        player.eliminationPoints = 0;
        player.duelChoice = null; player.duelChoiceRequest = null;
        player.matchStartedAt = matchStartedAt; player.matchRound = matchRound;
      });
      this.statusText?.setText('Offline game ready!');
      this.refreshPreviousRoundText();
      this.startMatchClock();
      this.time.delayedCall(500, () => this.startCounting());
      this.syncUI();
    } else {
      this.startRealtimeSync();
      void this.initializeGame();
      this.startLatencyPing();
      this.syncUI();
    }
  }

  private startLatencyPing() {
    this.pingTimer = this.time.addEvent({
      delay: 3500,
      loop: true,
      callback: async () => {
        if (this.gameFinished || offlineMode) return;
        const t0 = performance.now();
        try {
          const room = await fetchGameRoom(roomCode);
          const rtt = Math.round(performance.now() - t0);
          this.currentLatencyMs = Math.max(12, Math.min(999, rtt));
          if (room) {
            this.applyRemoteGameState(room);
          }
          this.scheduleUiSync();
        } catch {
          // ignore
        }
      },
    });
  }

  private scheduleUiSync() {
    if (this.uiSyncScheduled) return;
    this.uiSyncScheduled = true;
    this.uiSyncRafId = window.requestAnimationFrame(() => {
      this.uiSyncScheduled = false;
      this.uiSyncRafId = null;
      this.syncUI();
    });
  }

  update(_time: number, _delta: number) {
    if (this.gameFinished) return;

    // Smooth frame-based action clock progression and perceived latency mitigation
    if (this.roundPhase === 'shooting' && shootingDeadlineAt) {
      const deadline = Date.parse(shootingDeadlineAt);
      if (Number.isFinite(deadline)) {
        const remainingMs = Math.max(0, deadline - Date.now());
        const seconds = Math.ceil(remainingMs / 1000);
        if (seconds !== this.lastActionSeconds) {
          this.lastActionSeconds = seconds;
          this.scheduleUiSync();
        }
      }
    }
  }

  private syncUI() {
    if (!this.uiManager) return;
    const localIndex = offlineMode ? 0 : myPlayerId - 1;
    const localPlayer = players[localIndex];
    const isMyTurn = !this.gameFinished &&
      this.roundPhase === 'shooting' &&
      this.currentShooter === localIndex &&
      this.currentShooter >= 0;

    const startedAt = Date.parse(matchStartedAt);
    const elapsed = Math.max(0, Date.now() - (Number.isFinite(startedAt) ? startedAt : Date.now()));
    const remaining = Math.max(0, matchDurationMs() - elapsed);
    const remainingSeconds = Math.ceil(remaining / 1000);
    const elapsedSeconds = Math.floor(elapsed / 1000);

    const actionDeadline = shootingDeadlineAt ? Date.parse(shootingDeadlineAt) : 0;
    const actionSecondsLeft = actionDeadline > 0 ? Math.max(0, Math.ceil((actionDeadline - Date.now()) / 1000)) : undefined;
    const shooter = players[this.currentShooter];

    const hudState: HUDState = {
      matchDurationMinutes,
      elapsedSeconds,
      remainingSeconds,
      matchRound,
      gameStatus: this.gameFinished ? 'finished' : this.roundPhase,
      roundPhase: this.roundPhase,
      currentShooterIndex: this.currentShooter,
      currentShooterName: shooter?.name,
      actionSecondsLeft,
      isMyTurn,
      countNumber: this.countNumber,
      statusMessage: this.statusText?.text ?? '',
      announcementMessage: isMyTurn ? '👉 YOUR TURN TO SHOOT!' : (this.shooterText?.text ?? ''),
      previousRoundMessage: lastRoundMessage,
      selectedWeapon: this.selectedWeapon,
      availableWeapons: localPlayer?.weapons ?? ['gun'],
      pendingDoubleTargetIndex: this.pendingDoubleTarget,
      isOffline: offlineMode,
      isHost: amHost(),
      isMuted: PeerankiAudio.isMuted(),
      roomCode: offlineMode ? undefined : roomCode,
      latencyMs: this.currentLatencyMs,
      serverRegionName: getStoredServerRegion().name,
      connectedCount: connectedPlayers().length,
      maxPlayers,
    };

    const uiPlayers: UIPlayer[] = players.slice(0, maxPlayers).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      stage: p.stage,
      alive: p.alive,
      connected: p.connected,
      weapons: p.weapons,
      hasCollectedAllWeapons: p.hasCollectedAllWeapons,
      eliminationPoints: p.eliminationPoints,
      shieldDisabledRound: p.shieldDisabledRound,
      duelChoice: p.duelChoice,
    }));

    const contestants = activePlayers().filter((p) => p.alive);
    const localId = offlineMode ? 1 : myPlayerId;
    const canChoose = this.duelActive && contestants.length === 2 && (localPlayer?.alive ?? false) && contestants.some((p) => p.id === localId);
    const opponent = contestants.find((p) => p.id !== localId);

    const duelState: DuelState = {
      active: this.duelActive && !this.gameFinished,
      round: duelRound,
      contestantIds: contestants.map((p) => p.id),
      canChoose: Boolean(canChoose && !localPlayer?.duelChoice && !localPlayer?.duelChoiceRequest),
      hasSubmitted: Boolean(localPlayer?.duelChoice || localPlayer?.duelChoiceRequest),
      myChoice: localPlayer?.duelChoice ?? null,
      opponentName: opponent?.name ?? 'Opponent',
      opponentSubmitted: Boolean(opponent?.duelChoice),
      opponentChoice: opponent?.duelChoice ?? null,
      resultMessage: this.statusText?.text,
    };

    const connected = connectedPlayers();
    const winners = findMatchWinners(connected);

    const gameOverState: GameOverState = {
      active: this.gameFinished,
      winners: winners.map((p) => ({
        id: p.id,
        name: p.name,
        stage: p.stage,
        alive: p.alive,
        connected: p.connected,
        weapons: p.weapons,
        hasCollectedAllWeapons: p.hasCollectedAllWeapons,
        eliminationPoints: p.eliminationPoints,
        shieldDisabledRound: p.shieldDisabledRound,
      })),
      allPlayers: uiPlayers,
      matchDurationMinutes,
    };

    this.uiManager.updateHUD(hudState);
    this.uiManager.updateBoard(uiPlayers, this.currentShooter, localId, isMyTurn, this.pendingDoubleTarget);
    this.uiManager.updateDuel(duelState);
    this.uiManager.updateGameOver(gameOverState);
  }

  private async initializeGame() {
    const room = await fetchGameRoom(roomCode);

    if (!room) {
      this.statusText?.setText(
        'Unable to load the game room.',
      );
      return;
    }

    if (
      Number.isFinite(Number(room.max_players))
    ) {
      maxPlayers = Number(room.max_players);
    }

    hostSessionId = String(
      room.host_session_id ?? hostSessionId,
    );

    if (Array.isArray(room.players)) {
      loadPlayersFromRoom(room.players);
    }

    this.renderPlayers();
    this.initialized = true;
    this.startMatchClock();
    this.refreshWeaponPicker();
    this.refreshPreviousRoundText();

    if (room.game_status === 'finished') {
      this.showFinishedState();
      return;
    }

    if (
      room.game_status === 'counting' ||
      room.game_status === 'shooting' ||
      room.game_status === 'shot' ||
      room.game_status === 'duel'
    ) {
      this.applyRemoteGameState(room);
      return;
    }

    if (
      room.game_status === 'playing' &&
      amHost()
    ) {
      this.startCounting();
    }
  }

  private renderPlayers() {
    const { width } = this.scale;

    this.playerObjects.forEach(
      (container) => container.destroy(),
    );

    this.playerObjects = [];

    const columns = maxPlayers <= 6 ? 3 : 5;
    const rows = Math.ceil(maxPlayers / columns);
    const cardWidth = columns <= 3 ? 180 : 140;
    const baseSpan = columns <= 3 ? 560 : 760;
    const span = Math.min(width - cardWidth - 48, baseSpan + Math.max(0, width - 900) * 0.55);
    const startX = (width - span) / 2;
    const endX = startX + span;
    const xStep =
  (endX - startX) / (columns - 1);
    const startY = rows <= 2 ? 270 : 245;
    const yStep = rows <= 2 ? 220 : 170;

    players.forEach((_, index) => {
      if (index >= maxPlayers) {
        return;
      }

      const row = Math.floor(index / columns);
      const column = index % columns;

      const x =
        startX + column * xStep;
      const y =
        startY + row * yStep;

      const container = this.add.container(
        x,
        y,
      );

      const background = this.add.rectangle(
        0,
        0,
        cardWidth,
        160,
        0x1b2229,
      );

      background.setStrokeStyle(
        2,
        0x444c55,
      );

      const name = this.add
        .text(12, -48, '', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '15px',
          color: '#ffffff',
          fontStyle: 'bold',
          align: 'center',
        })
        .setOrigin(0.5);

      const tower = this.add.container(0, -3);

      const stage = this.add
        .text(0, 36, '', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '12px',
          color: '#aaaaaa',
        })
        .setOrigin(0.5);

      const slot = this.add
        .text(0, 74, '', {
          fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
          fontSize: '10px',
          color: '#f2cf66',
        })
        .setOrigin(0.5);
      const inventory = this.add.container(0, 55);
      const avatarBadge = this.add.container(-cardWidth / 2 + 20, -48);

      container.add([
        background,
        name,
        tower,
        stage,
        slot,
        inventory,
        avatarBadge,
      ]);

      container.setSize(cardWidth, 160);
      container.setInteractive(
        new Phaser.Geom.Rectangle(
          -cardWidth / 2 - 8,
          -78 - 8,
          cardWidth + 16,
          156 + 16,
        ),
        Phaser.Geom.Rectangle.Contains,
      );

      container.on(
        'pointerdown',
        () => {
          container.setScale(0.96);
          PeerankiAudio.effect('select');
          this.shootPlayer(index);
        },
      );

      container.on('pointerup', () => {
        container.setScale(1);
      });

      container.on('pointerout', () => {
        container.setScale(1);
      });

      this.playerObjects.push(container);
      this.updatePlayerVisual(index);
    });
  }

  private updatePlayerVisual(index: number) {
    const player = players[index];
    const container =
      this.playerObjects[index];

    if (!player || !container) {
      return;
    }

    const background =
      container.list[0] as Phaser.GameObjects.Rectangle;
    const name =
      container.list[1] as Phaser.GameObjects.Text;
    const tower =
      container.list[2] as Phaser.GameObjects.Container;
    const stage =
      container.list[3] as Phaser.GameObjects.Text;
    const slot =
      container.list[4] as Phaser.GameObjects.Text;
    const inventory =
      container.list[5] as Phaser.GameObjects.Container;
    const avatarBadge =
      container.list[6] as Phaser.GameObjects.Container;

    const avatarDef = getAvatarDef(player.avatar);
    avatarBadge.removeAll(true);
    if (player.connected) {
      const ring = this.add.circle(0, 0, 14, 0x0f172a, 0.95)
        .setStrokeStyle(2, avatarDef.borderColorHex, 0.95);
      let visual: Phaser.GameObjects.GameObject;
      if (this.textures.exists(`avatar_${avatarDef.id}`)) {
        visual = this.add.image(0, 0, `avatar_${avatarDef.id}`).setDisplaySize(24, 24);
      } else {
        visual = this.add.text(0, 0, avatarDef.emoji, { fontSize: '15px' }).setOrigin(0.5);
      }
      avatarBadge.add([ring, visual]);
    }

    name.setText(
      player.connected
        ? `${avatarDef.emoji} ${player.name}`
        : `Player ${player.id}`,
    );

    const previousStage = tower.getData('renderedStage') as number | undefined;
    const previousConnected = tower.getData('renderedConnected') as boolean | undefined;
    const stageChanged = previousStage !== undefined && previousConnected === true &&
      player.connected && previousStage !== player.stage;
    if (previousStage !== player.stage || previousConnected !== player.connected) {
      const oldVisuals = [...tower.list];
      if (!stageChanged) {
        tower.removeAll(true);
      }

      const newVisuals: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[] = [];
      if (!player.connected) {
        newVisuals.push(this.add.text(0, 0, '—', {
          fontFamily: 'Arial', fontSize: '28px', color: '#aaaaaa',
        }).setOrigin(0.5));
      } else if (player.stage === 0) {
        newVisuals.push(this.add.image(0, 0, 'tower_big').setDisplaySize(64, 64));
      } else if (player.stage === 1) {
        newVisuals.push(this.add.image(0, 0, 'tower_small').setDisplaySize(58, 58));
      } else if (player.stage === 2) {
        newVisuals.push(this.add.image(0, 0, 'tower_one').setDisplaySize(58, 58));
      } else {
        newVisuals.push(this.add.image(0, 0, 'tower_destroyed').setDisplaySize(58, 58));
      }
      tower.add(newVisuals);
      tower.setData('renderedStage', player.stage);
      tower.setData('renderedConnected', player.connected);

      if (stageChanged) {
        const eliminated = player.stage >= 3;
        const targetScaleX = newVisuals[0]?.scaleX ?? 1;
        const targetScaleY = newVisuals[0]?.scaleY ?? 1;
        newVisuals.forEach((visual) => {
          visual.setAlpha(0);
          visual.setScale(targetScaleX * 0.72, targetScaleY * 0.72);
        });
        const impact = this.add.circle(0, 0, eliminated ? 23 : 16,
          eliminated ? 0xff5b35 : 0xffd166, eliminated ? 0.55 : 0.4)
          .setStrokeStyle(eliminated ? 3 : 2, eliminated ? 0xffd166 : 0xffffff)
          .setDepth(-1);
        tower.addAt(impact, 0);
        this.tweens.killTweensOf(tower);
        this.tweens.add({
          targets: tower,
          x: { from: - (eliminated ? 9 : 5), to: eliminated ? 9 : 5 },
          scale: eliminated ? 1.2 : 1.1,
          duration: eliminated ? 65 : 55,
          yoyo: true,
          repeat: eliminated ? 3 : 2,
          onComplete: () => {
            tower.setX(0);
            tower.setScale(1);
            oldVisuals.forEach((visual) => visual.destroy());
            this.tweens.add({
              targets: newVisuals,
              alpha: 1,
              scaleX: targetScaleX,
              scaleY: targetScaleY,
              duration: eliminated ? 240 : 180,
              ease: 'Back.Out',
              onComplete: () => newVisuals.forEach((visual) => visual.setScale(targetScaleX, targetScaleY)),
            });
          },
        });
        this.tweens.add({
          targets: impact,
          scale: eliminated ? 2.2 : 1.7,
          alpha: 0,
          duration: eliminated ? 330 : 220,
          onComplete: () => impact.destroy(),
        });
      }
    }

    stage.setText(
      player.connected
        ? stageNames[player.stage]
        : 'Empty',
    );

    const visibleWeapons = player.weapons.filter((weapon) => weapon !== 'shield' || player.shieldDisabledRound !== matchRound);
    inventory.removeAll(true);
    if (player.connected) {
      const iconStep = 25;
      visibleWeapons.forEach((weapon, iconIndex) => {
        inventory.add(this.add.image((iconIndex - (visibleWeapons.length - 1) / 2) * iconStep, 0, `weapon-${weapon}`).setDisplaySize(23, 23));
      });
    }
    slot.setText(player.connected ? `⭐ ${player.eliminationPoints} elimination point${player.eliminationPoints === 1 ? '' : 's'}` : 'Available slot');
    slot.setStyle({ fontSize: '10px', color: '#f2cf66', align: 'center' });

    container.setAlpha(
      player.connected
        ? player.alive
          ? 1
          : 0.35
        : 0.28,
    );

    background.setStrokeStyle(
      index === this.currentShooter &&
        player.connected
        ? 3
        : 2,
      index === this.currentShooter &&
        player.connected
        ? 0x4da3ff
        : 0x444c55,
    );
    this.tweens.killTweensOf(container);
    if (index === this.currentShooter && player.connected && player.alive) {
      this.tweens.add({ targets: container, scale: 1.05, duration: 420, yoyo: true, repeat: -1 });
    } else {
      container.setScale(1);
    }

    container.setInteractive(
      player.connected && player.alive,
    );
    this.syncUI();
  }

  private markShooter() {
    for (
      let index = 0;
      index < this.playerObjects.length;
      index += 1
    ) {
      this.updatePlayerVisual(index);
    }
  }

  private startRealtimeSync() {
    this.realtimeChannel = subscribeToGameState(
      roomCode,
      (gameState) => {
        this.applyRemoteGameState(gameState);
      },
    );
  }

  private applyRemoteGameState(gameState: any) {
    if (!gameState) {
      return;
    }

    if (
      Number.isFinite(Number(gameState.max_players))
    ) {
      maxPlayers = Number(
        gameState.max_players,
      );
    }

    hostSessionId = String(
      gameState.host_session_id ?? hostSessionId,
    );

    if (Array.isArray(gameState.players)) {
      // Snapshot previous state before updating to detect combat events for non-host and host players
      const prevPlayers = players.map((p) => ({
        id: p.id,
        name: p.name,
        stage: p.stage,
        alive: p.alive,
        weapons: [...p.weapons],
        shieldDisabledRound: p.shieldDisabledRound,
        connected: p.connected,
      }));

      loadPlayersFromRoom(gameState.players);
      this.refreshWeaponPicker();

      // Non-host (and host client) rich combat audio & visual feedbacks
      if (this.initialized && prevPlayers.length > 0) {
        players.forEach((p, idx) => {
          const prev = prevPlayers.find((pp) => pp.id === p.id);
          if (!prev) return;

          // 1. Tower damage or destruction
          if (p.stage > prev.stage) {
            const isLocal = !offlineMode && p.id === myPlayerId;
            this.uiManager.triggerDamageFlash(idx, isLocal);

            if (!p.alive || p.stage >= 3) {
              PeerankiAudio.effect('tower_destroyed');
              if (isLocal) {
                PeerankiAudio.effect('defeat');
                try { navigator.vibrate?.([200, 100, 200]); } catch {}
                this.uiManager.showToast('💥 YOUR TOWER WAS DEMOLISHED! You are eliminated!', 'alert');
              } else {
                this.uiManager.showToast(`⚡ ${p.name}'s tower was destroyed! Eliminated!`, 'alert');
              }
            } else {
              PeerankiAudio.effect('tower_damage');
              if (isLocal) {
                try { navigator.vibrate?.([80, 40, 80]); } catch {}
                this.uiManager.showToast(`🚨 WARNING: Your tower took damage! (Stage ${p.stage}/3)`, 'alert');
              } else {
                this.uiManager.showToast(`💥 ${p.name}'s tower took damage! (Stage ${p.stage}/3)`, 'alert');
              }
            }
          }

          // 2. Shield stripped permanently by hook
          if (prev.weapons.includes('shield') && !p.weapons.includes('shield')) {
            PeerankiAudio.effect('hook_strip');
            this.uiManager.showToast(`🪝 ${p.name}'s Shield was stripped permanently!`, 'alert');
          }

          // 3. Shield shattered for round
          if (prev.shieldDisabledRound !== matchRound && p.shieldDisabledRound === matchRound) {
            PeerankiAudio.effect('shield_hit');
            this.uiManager.showToast(`🛡️💥 ${p.name}'s Shield was shattered for this round!`, 'alert');
          }

          // 4. Connection status updates
          if (prev.connected && !p.connected) {
            this.uiManager.showToast(`⚠️ ${p.name} disconnected.`, 'info');
          } else if (!prev.connected && p.connected) {
            this.uiManager.showToast(`🟢 ${p.name} reconnected!`, 'success');
          }
        });
      }

      if (this.initialized) {
        if (this.playerObjects.length !== maxPlayers) {
          this.renderPlayers();
        } else {
          this.markShooter();
        }
        this.syncUI();
      }
    }

    if (gameState.game_status === 'finished' || matchOver) {
      this.roundPhase = 'finished';
      this.countingTimer?.remove(false);
      this.countingTimer = undefined;
      this.nextRoundTimer?.remove(false);
      this.nextRoundTimer = undefined;
      this.showFinishedState();
      return;
    }

    if (
      typeof gameState.current_shooter === 'number'
    ) {
      const nextShooter = Number(
        gameState.current_shooter,
      );
      if (nextShooter !== this.currentShooter && gameState.game_status === 'shooting') {
        const isMyTurnNow = !offlineMode && nextShooter === myPlayerId - 1;
        if (isMyTurnNow) {
          PeerankiAudio.effect('shooter_selected');
          try { navigator.vibrate?.([120, 60, 120]); } catch {}
          this.uiManager.showToast('🎯 IT IS YOUR TURN! Select weapon & tap your target!', 'success');
        } else {
          PeerankiAudio.effect('select');
          const shooterName = players[nextShooter]?.name ?? `Player ${nextShooter + 1}`;
          this.uiManager.showToast(`⏳ ${shooterName}'s turn to fire...`, 'info');
        }
      }
      this.currentShooter = nextShooter;
    } else if (gameState.current_shooter === null) {
      this.currentShooter = -1;
    }

    const remoteCount = Number(
      gameState.countdown,
    );

    if (Number.isFinite(remoteCount)) {
      if (remoteCount > 0 && remoteCount !== this.countNumber && gameState.game_status === 'counting') {
        if (remoteCount === COUNT_TO) {
          PeerankiAudio.effect('shooter_selected');
        } else {
          PeerankiAudio.effect('count_tick');
        }
      }
      this.countNumber = remoteCount;
    }

    if (gameState.game_status === 'duel') {
      this.countingTimer?.remove(false);
      this.countingTimer = undefined;
      this.nextRoundTimer?.remove(false);
      this.nextRoundTimer = undefined;
      this.stopActionClock();
      shootingDeadlineAt = '';
      if (!this.duelActive) {
        PeerankiAudio.effect('duel_start');
        const contestants = activePlayers().filter((p) => p.alive);
        const amInDuel = !offlineMode && contestants.some((p) => p.id === myPlayerId);
        if (amInDuel) {
          try { navigator.vibrate?.([150, 80, 150]); } catch {}
          this.uiManager.showToast('⚔️ SUDDEN DEATH DUEL! Pick Rock, Paper, or Scissors!', 'alert');
        } else {
          this.uiManager.showToast('⚔️ Final Duel Showdown underway!', 'info');
        }
      } else if (duelRound > this.lastAnnouncedDuelRound) {
        this.lastAnnouncedDuelRound = duelRound;
        PeerankiAudio.effect('rps_clash');
        PeerankiAudio.effect('rps_tie');
        this.uiManager.showToast(`🤝 Tie in duel! Round ${duelRound} — Pick again!`, 'info');
      }
      this.duelActive = true;
      this.roundPhase = 'duel';
      this.shooterText?.setText('⚔️ Rock–Paper–Scissors duel');
      this.statusText?.setText('Both players choose at the same time.');
      this.renderDuelControls();
      if (amHost()) void this.processPendingDuelChoices();
      return;
    }

    if (this.duelActive) {
      this.duelActive = false;
      this.duelBotTimer?.remove(false);
      this.duelBotTimer = undefined;
      this.clearDuelControls();
      PeerankiAudio.effect('rps_win');
    }

    if (lastRoundMessage && lastRoundMessage !== this.lastAnnouncedRoundMessage && !this.gameFinished) {
      this.lastAnnouncedRoundMessage = lastRoundMessage;
      PeerankiAudio.effect('round_win');
      this.uiManager.showToast(`🏆 ${lastRoundMessage}`, 'success');
    }

    if (amHost()) void this.processPendingAction();

    if (
      gameState.game_status === 'counting'
    ) {
      this.stopActionClock();
      this.roundPhase = 'counting';
      this.countText?.setText(
        `Count ${this.countNumber} / ${COUNT_TO}`,
      );
      this.shooterText?.setText(
        '🎲 Counting to select the shooter',
      );
      this.statusText?.setText(
        'The 10th tower will select the shooter.',
      );

      this.markShooter();
      return;
    }

    if (
      gameState.game_status === 'shooting'
    ) {
      this.countingTimer?.remove(false);
      this.countingTimer = undefined;
      this.roundPhase = 'shooting';
      if (!shootingDeadlineAt && amHost()) {
        shootingDeadlineAt = new Date(Date.now() + ACTION_LIMIT_MS).toISOString();
        void syncGameState(this.currentShooter, COUNT_TO, 'shooting');
      }
      this.startActionClock();
      const shooter =
        players[this.currentShooter];

      this.countText?.setText(
        shootingDeadlineAt
          ? `ACTION ${Math.ceil(Math.max(0, Date.parse(shootingDeadlineAt) - Date.now()) / 1000)}s • choose weapon + target(s)`
          : `Count ${COUNT_TO} / ${COUNT_TO}`,
      );
      this.shooterText?.setText(
        shooter
          ? `🎯 Shooter: ${shooter.name}`
          : '🎯 Shooter selected',
      );
      this.statusText?.setText(
        myPlayerId === this.currentShooter + 1
          ? 'Choose a weapon and target(s) before time runs out.'
          : 'Waiting for the shooter...',
      );
      this.markShooter();
      return;
    }

    if (
      gameState.game_status === 'shot'
    ) {
      this.stopActionClock();
      this.roundPhase = 'waiting';
      this.statusText?.setText(
        'Shot recorded. Next round...',
      );
      this.markShooter();

      if (
  amHost() &&
  !this.nextRoundTimer &&
  !this.countingTimer
) {
  this.nextRoundTimer =
    this.time.delayedCall(
      NEXT_ROUND_DELAY,
      () => {
        this.nextRoundTimer = undefined;

        const nextStartIndex =
          this.nextStartIndex;

        this.nextStartIndex = -1;

        if (this.isGameFinished()) {
          void this.finishRound();
        } else {
          this.startCounting(nextStartIndex >= 0 ? nextStartIndex : undefined);
        }
      },
    );
}

      return;
    }

    if (gameState.game_status === 'round_won') {
      this.stopActionClock();
      this.duelActive = false;
      this.clearDuelControls();
      this.roundPhase = 'waiting';
      this.refreshPreviousRoundText();
      PeerankiAudio.effect('round_win');
      if (lastRoundMessage) {
        this.uiManager.showToast(`🏆 ${lastRoundMessage}`, 'success');
      }
      this.statusText?.setText(lastRoundMessage || 'Round winner advances!');
      this.shooterText?.setText(lastRoundMessage || 'Round winner advances!');
      this.markShooter();
      if (amHost() && !this.nextRoundTimer) {
        this.nextRoundTimer = this.time.delayedCall(NEXT_ROUND_DELAY, () => {
          this.nextRoundTimer = undefined;
          this.startCounting();
        });
      }
      return;
    }

    if (
      gameState.game_status === 'finished'
    ) {
      this.countingTimer?.remove(false);
      this.countingTimer = undefined;
      this.nextRoundTimer?.remove(false);
      this.nextRoundTimer = undefined;
      this.showFinishedState();
    }
  }
  private beginDuel() {
    if (this.duelActive || this.gameFinished) return;
    PeerankiAudio.effect('duel_start');
    this.duelActive = true;
    this.resolvingDuel = false;
    duelRound = 1;
    this.currentShooter = -1;
    this.roundPhase = 'duel';
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;
    this.stopActionClock();
    shootingDeadlineAt = '';
    players.forEach((player) => {
      player.duelChoice = null;
      player.duelChoiceRequest = null;
    });
    this.shooterText?.setText('⚔️ Rock–Paper–Scissors duel');
    this.statusText?.setText('Both remaining players choose at the same time.');
    this.countText?.setText(`DUEL ${duelRound}`);
    this.renderDuelControls();
    if (!offlineMode) void syncGameState(null, 0, 'duel');
    else this.scheduleOfflineBotChoices();
  }

  private clearDuelControls() {
    this.duelUi.forEach((object) => object.destroy());
    this.duelUi = [];
    this.duelPrompt = undefined;
  }

  private renderDuelControls() {
    this.clearDuelControls();
    if (!this.duelActive || this.gameFinished) return;
    const { width, height } = this.scale;
    const contestants = activePlayers().filter((player) => player.alive);
    const localId = offlineMode ? 1 : myPlayerId;
    const localPlayer = players[localId - 1];
    const mayChoose = contestants.length === 2 && localPlayer?.alive && contestants.some((player) => player.id === localId);
    const hasSubmitted = Boolean(localPlayer?.duelChoice || localPlayer?.duelChoiceRequest);

    this.duelPrompt = this.add.text(width / 2, height - 184,
      `DUEL ${duelRound} • ${mayChoose && !hasSubmitted ? 'Choose now' : hasSubmitted ? 'Choice locked — waiting for the other player' : 'Waiting for duel choices'}`,
      { fontFamily: 'Arial', fontSize: '19px', color: '#f2cf66', fontStyle: 'bold', align: 'center' }).setOrigin(0.5).setDepth(50);
    this.duelUi.push(this.duelPrompt);
    if (mayChoose && !hasSubmitted) {
      const buttonY = height - 112;
      const buttonXs = [width / 2 - 175, width / 2, width / 2 + 175];
      RPS_CHOICES.forEach((choice, index) => {
        const button = makeButton(this, buttonXs[index], buttonY, RPS_LABELS[choice], '#34485c', 18);
        button.setPadding(18, 14, 18, 14).setDepth(50);
        button.on('pointerdown', () => {
          PeerankiAudio.effect('click');
          this.submitDuelChoice(choice);
        });
        this.duelUi.push(button);
      });
    }
  }

  private submitDuelChoice(choice: RpsChoice) {
    if (!this.duelActive || this.gameFinished) return;
    const playerId = offlineMode ? 1 : myPlayerId;
    const player = players[playerId - 1];
    const aliveContestants = activePlayers().filter((candidate) => candidate.alive);
    if (!player?.alive || !aliveContestants.some((candidate) => candidate.id === playerId) ||
        player.duelChoice || player.duelChoiceRequest) return;

    if (offlineMode) {
      player.duelChoice = choice;
      this.statusText?.setText(`Your ${RPS_LABELS[choice]} choice is locked. Waiting for the other player...`);
      this.renderDuelControls();
      this.scheduleOfflineBotChoices();
      void this.resolveDuelIfReady();
      return;
    }

    player.duelChoiceRequest = {
      nonce: `${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      playerId,
      round: duelRound,
      choice,
    };
    this.statusText?.setText('Choice sent. Waiting for both players...');
    this.renderDuelControls();
    void syncGameState(null, 0, 'duel').then(() => {
      if (amHost()) return this.processPendingDuelChoices();
    });
  }

  private scheduleOfflineBotChoices() {
    if (!offlineMode || !this.duelActive || this.duelBotTimer) return;
    const missingBots = activePlayers().filter((player) => player.alive && player.id !== 1 && !player.duelChoice);
    if (missingBots.length === 0) return;
    this.duelBotTimer = this.time.delayedCall(420, () => {
      this.duelBotTimer = undefined;
      if (!this.duelActive) return;
      activePlayers().filter((player) => player.alive && player.id !== 1 && !player.duelChoice)
        .forEach((player) => { player.duelChoice = Phaser.Utils.Array.GetRandom(RPS_CHOICES); });
      this.renderDuelControls();
      void this.resolveDuelIfReady();
    });
  }

  private async processPendingDuelChoices() {
    if (!amHost() || !this.duelActive || this.processingDuelChoices || this.gameFinished) return;
    this.processingDuelChoices = true;
    try {
      let changed = false;
      players.forEach((owner) => {
        const request = owner.duelChoiceRequest;
        if (!request) return;
        owner.duelChoiceRequest = null;
        changed = true;
        if (request.playerId === owner.id && request.round === duelRound && owner.connected && owner.alive &&
            !owner.duelChoice && normalizeRpsChoice(request.choice)) {
          owner.duelChoice = request.choice;
        }
      });
      if (changed) await syncGameState(null, 0, 'duel');
      await this.resolveDuelIfReady();
    } finally {
      this.processingDuelChoices = false;
    }
  }

  private async resolveDuelIfReady() {
    if (!this.duelActive || this.resolvingDuel || this.gameFinished || (!offlineMode && !amHost())) return;
    const contestants = activePlayers().filter((player) => player.alive);
    if (contestants.length !== 2 || contestants.some((player) => !player.duelChoice)) return;
    this.resolvingDuel = true;
    const [first, second] = contestants as [Player, Player];
    const firstChoice = first.duelChoice!;
    const secondChoice = second.duelChoice!;
    const duelResult = resolveRpsWinner(firstChoice, secondChoice);
    PeerankiAudio.effect('rps_clash');
    if (duelResult === 'tie') {
      PeerankiAudio.effect('rps_tie');
      this.uiManager?.showToast(`🤝 Tie! Both chose ${RPS_LABELS[firstChoice]}! Choose again.`, 'info');
      first.duelChoice = null;
      second.duelChoice = null;
      players.forEach((player) => { player.duelChoiceRequest = null; });
      duelRound += 1;
      this.countText?.setText(`DUEL ${duelRound}`);
      this.statusText?.setText(`Tie! Both chose ${RPS_LABELS[firstChoice]}. Choose again.`);
      this.renderDuelControls();
      if (!offlineMode) await syncGameState(null, 0, 'duel');
      else this.scheduleOfflineBotChoices();
      this.resolvingDuel = false;
      return;
    }

    PeerankiAudio.effect('rps_win');
    const winner = duelResult === 'first' ? first : second;
    const loser = winner.id === first.id ? second : first;
    const winnerChoice = winner.id === first.id ? firstChoice : secondChoice;
    const loserChoice = winner.id === first.id ? secondChoice : firstChoice;
    loser.alive = false;
    loser.stage = 3;
    players.forEach((player) => {
      player.duelChoice = null;
      player.duelChoiceRequest = null;
    });
    const resultMessage = `${winner.name} won the duel (${RPS_LABELS[winnerChoice]} beats ${RPS_LABELS[loserChoice]}) and Round ${matchRound}!`;
    this.uiManager?.showToast(`⚔️ ${resultMessage}`, 'success');
    this.duelActive = false;
    this.duelBotTimer?.remove(false);
    this.duelBotTimer = undefined;
    this.clearDuelControls();
    this.resolvingDuel = false;
    await this.finishRound(resultMessage);
  }

  private startCounting(forcedStartIndex?: number) {
  if (
    (!offlineMode && !amHost()) ||
    this.countingTimer ||
    this.nextRoundTimer ||
    this.gameFinished
  ) {
    return;
  }
  if (this.matchTimeExpired()) {
    if (offlineMode || amHost()) void this.finishMatch();
    return;
  }

  const aliveIndexes = activePlayers()
    .map((player) => player.id - 1)
    .filter(
      (index) =>
        players[index]?.alive === true,
    );

  if (aliveIndexes.length <= 1) {
    void this.finishRound();
    return;
  }

  if (aliveIndexes.length === 2) {
    this.beginDuel();
    return;
  }

  const forcedStartIsAlive =
  typeof forcedStartIndex === 'number' &&
  aliveIndexes.includes(forcedStartIndex);

this.startIndex = forcedStartIsAlive
  ? forcedStartIndex
  : Phaser.Utils.Array.GetRandom(
      aliveIndexes,
    );

  countingStartIndex = this.startIndex;
  players.forEach((player) => { player.countingStartIndex = countingStartIndex; });

  this.currentShooter = -1;
  this.stopActionClock();
  shootingDeadlineAt = '';
  this.roundPhase = 'counting';
  this.countNumber = 0;

  this.shooterText?.setText(
    `🎲 Start: ${players[this.startIndex].name}`,
  );

  this.statusText?.setText(
    `Counting ${COUNT_TO} towers...`,
  );

  this.countText?.setText(
    `Count 0 / ${COUNT_TO}`,
  );

  if (!offlineMode) {
    void syncGameState(
      null,
      0,
      'counting',
    );
  }

  this.countingTimer =
    this.time.addEvent({
      delay: COUNTING_SPEED,
      repeat: COUNT_TO - 1,

      callback: () => {
        if (this.roundPhase !== 'counting' || this.countNumber >= COUNT_TO) {
          this.countingTimer?.remove(false);
          this.countingTimer = undefined;
          return;
        }
        this.countNumber = Math.min(COUNT_TO, this.countNumber + 1);

        const countedIndex =
          getCountedPlayerIndex(players, this.startIndex, this.countNumber);

        if (countedIndex === -1) {
          return;
        }

        this.currentShooter =
          countedIndex;

        this.countText?.setText(
          `Count ${this.countNumber} / ${COUNT_TO}`,
        );

        this.statusText?.setText(
          `${this.countNumber}. ${players[countedIndex].name}`,
        );

        if (
          this.countNumber === COUNT_TO
        ) {
          this.roundPhase = 'shooting';
          shootingDeadlineAt = new Date(Date.now() + ACTION_LIMIT_MS).toISOString();
          this.startActionClock();
          PeerankiAudio.effect('shooter_selected');
          this.shooterText?.setText(
            `🎯 Shooter: ${players[countedIndex].name}`,
          );

          this.statusText?.setText(
           `${players[countedIndex].name}: choose a weapon and target(s) within 10 seconds.`,
          );

          if (!offlineMode) {
            void syncGameState(
              countedIndex,
              COUNT_TO,
              'shooting',
            );
          }

          this.countingTimer = undefined;

          // 🤖 Offline bot automatically shoots
          if (
            offlineMode &&
            players[countedIndex].id !== 1
          ) {
            this.time.delayedCall(
            350,
              () => {
                this.botShoot(countedIndex);
              },
            );
          } else if (offlineMode) {
            this.statusText?.setText(
              'Choose a weapon and target(s) before time runs out.',
            );
          }
        } else {
          PeerankiAudio.effect('count_tick');
          if (!offlineMode) {
            void broadcastRoomStateDelta(roomCode, {
              current_shooter: countedIndex,
              countdown: this.countNumber,
              game_status: 'counting',
            }).catch((error) => console.warn('[Peeranki] Count display sync failed:', error));
          }
        }

        this.markShooter();
      },

      callbackScope: this,
    });
}

  private startActionClock() {
    this.lastActionSeconds = -1;
    if (!this.actionTimer) {
      this.actionTimer = this.time.addEvent({
        delay: 100,
        loop: true,
        callback: () => this.updateActionClock(),
      });
    }
    this.updateActionClock();
  }

  private updateActionClock() {
    if (this.roundPhase !== 'shooting' || !shootingDeadlineAt) return;
    const deadline = Date.parse(shootingDeadlineAt);
    if (!Number.isFinite(deadline)) return;
    const remaining = Math.max(0, deadline - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    if (seconds !== this.lastActionSeconds) {
      this.lastActionSeconds = seconds;
      this.countText?.setText(`ACTION ${seconds}s • choose weapon + target(s)`);
      if (seconds <= 5 && seconds > 0) {
        PeerankiAudio.effect('timer_tick');
      }
      this.syncUI();
    }
    if (remaining === 0 && (offlineMode || amHost())) this.endActionOnTimeout();
  }

  private stopActionClock() {
    this.actionTimer?.remove(false);
    this.actionTimer = undefined;
  }

  private endActionOnTimeout() {
    if (
      this.gameFinished || this.roundPhase !== 'shooting' ||
      (!offlineMode && !amHost()) || !shootingDeadlineAt ||
      Date.now() < Date.parse(shootingDeadlineAt)
    ) return;

    const shooterIndex = this.currentShooter;
    this.stopActionClock();
    shootingDeadlineAt = '';
    this.pendingDoubleTarget = -1;
    players.forEach((player) => { player.actionRequest = null; });
    this.nextStartIndex = getNextCountingStartIndex(players, shooterIndex);
    this.roundPhase = 'waiting';
    this.statusText?.setText('Time is up. Starting the next tower count...');
    this.countText?.setText('ACTION TIME UP');
    if (!offlineMode) void syncGameState(shooterIndex, COUNT_TO, 'shot');

    if (!this.nextRoundTimer) {
      this.nextRoundTimer = this.time.delayedCall(NEXT_ROUND_DELAY, () => {
        this.nextRoundTimer = undefined;
        const nextStartIndex = this.nextStartIndex;
        this.nextStartIndex = -1;
        if (this.isGameFinished()) void this.finishRound();
        else this.startCounting(nextStartIndex >= 0 ? nextStartIndex : undefined);
      });
    }
  }

private botShoot(shooterIndex: number) {
  if (!offlineMode) {
    return;
  }
  const action = chooseBotAction(players, shooterIndex, matchRound, Math.random);
  if (!action) {
    void this.finishRound();
    return;
  }
  this.statusText?.setText(`${players[shooterIndex].name} is thinking...`);
  this.time.delayedCall(Phaser.Math.Between(500, 1_200), () => {
    if (this.currentShooter !== shooterIndex || this.roundPhase !== 'shooting' || this.gameFinished) return;
    const targetNames = action.targetIds
      .map((id) => players.find((player) => player.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    this.statusText?.setText(`${players[shooterIndex].name} uses ${WEAPON_NAMES[action.weapon]} on ${targetNames.join(' and ')}.`);
    this.runPlayerAction(action);
  });
}

private async requestHostAction(action: PlayerAction) {
  const shooter = players[action.shooterId - 1];
  if (!shooter || action.shooterId !== this.currentShooter + 1 || action.weapon !== this.selectedWeapon ||
      !shootingDeadlineAt || !Number.isFinite(Date.parse(shootingDeadlineAt))) return;
  const nonce = `${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  shooter.actionRequest = { ...action, nonce };
  this.statusText?.setText('Sending action to the host...');
  await syncGameState(this.currentShooter, this.countNumber, 'action_requested');
}

private async processPendingAction() {
  if (!amHost() || this.gameFinished || this.matchTimeExpired()) return;
  const requestOwner = players.find((player) => player.actionRequest !== null);
  const action = requestOwner?.actionRequest;
  if (!requestOwner || !action) return;
  requestOwner.actionRequest = null;
  if (processedOnlineActionNonces.has(action.nonce)) {
    await syncGameState(this.currentShooter, this.countNumber, this.roundPhase === 'shooting' ? 'shooting' : 'shot');
    return;
  }
  processedOnlineActionNonces.add(action.nonce);

  const shooter = players[action.shooterId - 1];
  const authorized = shooter?.sessionId === requestOwner.sessionId && shooter.id === this.currentShooter + 1 && shooter.alive && shooter.connected;
  if (this.roundPhase !== 'shooting') {
    await syncGameState(
      this.currentShooter >= 0 ? this.currentShooter : null,
      this.countNumber,
      this.roundPhase === 'finished' ? 'finished' : 'shot',
    );
    return;
  }
  if (!shootingDeadlineAt || Date.now() >= Date.parse(shootingDeadlineAt)) {
    this.endActionOnTimeout();
    return;
  }

  if (!authorized || !this.runPlayerAction(action)) {
    this.statusText?.setText('The host rejected an invalid or expired action.');
    await syncGameState(this.currentShooter, this.countNumber, 'shooting');
  }
}

private shootPlayer(index: number) {
  if (
    this.applyingRemoteState ||
    this.gameFinished ||
    this.roundPhase !== 'shooting' ||
    this.currentShooter < 0 ||
    !shootingDeadlineAt ||
    ((offlineMode || amHost()) && Date.now() >= Date.parse(shootingDeadlineAt)) ||
    this.matchTimeExpired()
  ) {
    if (shootingDeadlineAt && Date.now() >= Date.parse(shootingDeadlineAt) && (offlineMode || amHost())) {
      this.endActionOnTimeout();
    }
    if (this.matchTimeExpired() && (offlineMode || amHost())) void this.finishMatch();
    return;
  }

  if (
    !offlineMode &&
    myPlayerId !== this.currentShooter + 1
  ) {
    this.statusText?.setText(
      'Only the selected shooter can shoot.',
    );
    return;
  }

  if (index === this.currentShooter) {
    this.statusText?.setText(
      'You cannot shoot yourself.',
    );
    return;
  }

  const target = players[index];

  if (
    !target ||
    !target.connected
  ) {
    return;
  }

  if (!target.alive) {
    this.statusText?.setText(
      'That player is already eliminated.',
    );
    return;
  }

  if (this.selectedWeapon === 'doublePeeranki' && this.pendingDoubleTarget < 0) {
    this.pendingDoubleTarget = index;
    PeerankiAudio.effect('select');
    this.statusText?.setText(`${target.name} is the first target. Choose a different second target.`);
    this.syncUI();
    return;
  }

  if (this.selectedWeapon === 'doublePeeranki' && this.pendingDoubleTarget >= 0) {
    if (index === this.pendingDoubleTarget) {
      this.statusText?.setText('Choose a different second target.');
      return;
    }
    const firstTarget = this.pendingDoubleTarget;
    this.pendingDoubleTarget = -1;
    this.submitPlayerAction({
      shooterId: this.currentShooter + 1,
      weapon: this.selectedWeapon,
      targetIds: [players[firstTarget].id, target.id],
    }, target);
    return;
  }

  this.submitPlayerAction({
    shooterId: this.currentShooter + 1,
    weapon: this.selectedWeapon,
    targetIds: [target.id],
  }, target);
}

private submitPlayerAction(action: PlayerAction, previewTarget?: Player) {
  if (!offlineMode && !amHost()) {
    this.statusText?.setText(`Firing ${WEAPON_NAMES[action.weapon]}...`);
    if (action.weapon === 'peeranki') PeerankiAudio.effect('cannon');
    else if (action.weapon === 'hook') PeerankiAudio.effect('hook');
    else if (action.weapon === 'doublePeeranki') PeerankiAudio.effect('double_peeranki');
    else PeerankiAudio.effect('shoot');
    // Immediate visual recoil so non-host player feels zero latency
    if (previewTarget) this.uiManager.triggerDamageFlash(previewTarget.id - 1, false);
    const targetCard = previewTarget ? this.playerObjects[previewTarget.id - 1] : undefined;
    if (targetCard) {
      this.tweens.add({ targets: targetCard, scale: 1.08, duration: 80, yoyo: true, repeat: 1 });
    }
    this.scheduleUiSync();
    void this.requestHostAction(action);
    return;
  }

  this.runPlayerAction(action);
}

private runPlayerAction(action: PlayerAction): boolean {
  if (this.gameFinished || this.roundPhase !== 'shooting' || (!offlineMode && !amHost())) return false;
  if (this.matchTimeExpired()) {
    if (offlineMode || amHost()) void this.finishMatch();
    return false;
  }
  if (!shootingDeadlineAt || Date.now() >= Date.parse(shootingDeadlineAt)) {
    if (offlineMode || amHost()) this.endActionOnTimeout();
    return false;
  }

  const resolution = resolvePlayerAction(players, action, this.currentShooter, matchRound);
  if (!resolution.accepted) {
    const messages: Record<typeof resolution.reason, string> = {
      wrong_shooter: 'The selected shooter changed. Please wait for the next turn.',
      unavailable_weapon: 'The shooter does not own that weapon.',
      invalid_targets: 'Choose living, connected players other than the shooter.',
      needs_two_targets: 'Double Peeranki needs two different living targets.',
      hook_requires_shield: 'Hook requires a target with a Shield.',
    };
    this.statusText?.setText(messages[resolution.reason]);
    this.syncUI();
    return false;
  }

  this.presentActionResolution(action, resolution);
  this.completePlayerShot(resolution.lastTargetIndex);
  return true;
}

private presentActionResolution(action: PlayerAction, resolution: Extract<ActionResolution, { accepted: true }>) {
  const attacker = players[resolution.shooterIndex];
  if (action.weapon === 'doublePeeranki') PeerankiAudio.effect('double_peeranki');
  else if (action.weapon === 'hook') PeerankiAudio.effect('hook');
  else if (action.weapon === 'peeranki') PeerankiAudio.effect('cannon');
  else PeerankiAudio.effect('shoot');

  resolution.hits.forEach((hit) => {
    const target = players[hit.targetIndex];
    if (!target) return;
    if (hit.action === 'shield_absorbed') {
      PeerankiAudio.effect('shield_hit');
      this.statusText?.setText(`${target.name}'s Shield blocked the Gun shot.`);
      this.uiManager?.showToast(`🛡️ ${target.name}'s Shield blocked ${attacker?.name ?? 'Attacker'}'s Gun shot!`, 'info');
    } else if (hit.action === 'shield_destroyed_for_round') {
      PeerankiAudio.effect('shield_hit');
      this.statusText?.setText(`${target.name}'s Shield was disabled for this round.`);
      this.uiManager?.showToast(`🛡️💥 ${target.name}'s Shield was disabled for this round!`, 'alert');
      const targetCard = this.playerObjects[hit.targetIndex];
      if (targetCard) this.tweens.add({ targets: targetCard, alpha: { from: 0.35, to: 1 }, duration: 110, yoyo: true, repeat: 2 });
    } else if (hit.shieldRemoved) {
      PeerankiAudio.effect('hook_strip');
      this.statusText?.setText(`${target.name}'s Shield was destroyed permanently!`);
      this.uiManager?.showToast(`🪝 ${attacker?.name ?? 'Attacker'} stripped ${target.name}'s Shield permanently!`, 'alert');
      const targetCard = this.playerObjects[hit.targetIndex];
      if (targetCard) this.tweens.add({ targets: targetCard, angle: { from: -5, to: 5 }, alpha: { from: 0.45, to: 1 }, duration: 90, yoyo: true, repeat: 2, onComplete: () => targetCard.setAngle(0) });
    } else if (hit.eliminated) {
      PeerankiAudio.effect('tower_destroyed');
      const attack = hit.weapon === 'peeranki' ? ' was demolished by Peeranki' : ' fell';
      this.uiManager?.showToast(`⚡ ${target.name}'s Tower${attack}! Eliminated!`, 'alert');
    } else {
      PeerankiAudio.effect('tower_damage');
      this.uiManager?.showToast(`💥 ${target.name}'s Tower took damage (Stage ${target.stage})!`, 'alert');
    }
    this.updatePlayerVisual(hit.targetIndex);
  });

  if (attacker) this.updatePlayerVisual(resolution.shooterIndex);
  if (action.weapon === 'hook') this.refreshWeaponPicker();
}

private completePlayerShot(index: number) {
  this.stopActionClock();
  shootingDeadlineAt = '';
  players.forEach((player) => { player.actionRequest = null; });
  this.roundPhase = 'waiting';
  const target = players[index];
  if (!target) return;
  const hitContainer = this.playerObjects[index];
  if (hitContainer) {
    this.tweens.killTweensOf(hitContainer);
    this.tweens.add({ targets: hitContainer, scale: 1.12, angle: 2, duration: 90, yoyo: true, repeat: 1,
      onComplete: () => { hitContainer.setAngle(0); if (this.currentShooter === index) this.updatePlayerVisual(index); },
    });
  }

 this.updatePlayerVisual(index);

if (activePlayers().filter((player) => player.alive).length === 2 && (offlineMode || amHost())) {
  this.beginDuel();
  return;
}

if (offlineMode) {
  const targetContainer =
    this.playerObjects[index];

  if (targetContainer) {
    targetContainer.setScale(1.12);

    this.time.delayedCall(180, () => {
      targetContainer.setScale(1);
    });
  }

  this.shooterText?.setText(
    `💥 ${target.name} was shot!`,
  );
    if (!target.alive) {
      this.statusText?.setText(
        `${target.name} has been eliminated! 💥`,
      );
    } else if (target.stage === 1) {
      this.statusText?.setText(
        `${target.name} split into two small towers!`,
      );
    } else if (target.stage === 2) {
      this.statusText?.setText(
        `${target.name} has one tower remaining!`,
      );
    }

    const alivePlayers = players.filter(
      (player) => player.alive,
    );

    if (alivePlayers.length <= 1) {
      this.time.delayedCall(250, () => void this.finishRound());
      return;
    }

    const nextStartIndex =
  getNextCountingStartIndex(players, index);

this.time.delayedCall(1200, () => {
  this.startCounting(
    nextStartIndex >= 0
      ? nextStartIndex
      : undefined,
  );
});

    return;
  }

// Online mode
this.nextStartIndex =
getNextCountingStartIndex(players, index);

void this.recordShot();
}

  private async recordShot() {
    const alive = activePlayers().filter(
      (player) => player.alive,
    );

    if (alive.length <= 1) {
      if (!offlineMode && !amHost()) {
        await syncGameState(this.currentShooter, COUNT_TO, 'shot');
        return;
      }
      await this.finishRound();
      return;
    }

    await syncGameState(
      this.currentShooter,
      COUNT_TO,
      'shot',
    );
  }

  private refreshWeaponPicker() {
    const localIndex = offlineMode ? 0 : myPlayerId - 1;
    const owned = players[localIndex]?.weapons ?? ['gun'];
    const options = ACTIVE_WEAPONS.filter((weapon) => owned.includes(weapon));
    if (!options.includes(this.selectedWeapon)) this.selectedWeapon = options[0] ?? 'gun';
    this.weaponImage?.setTexture(`weapon-${this.selectedWeapon}`);
    this.weaponText?.setText(WEAPON_NAMES[this.selectedWeapon]);
    this.syncUI();
  }

  private refreshPreviousRoundText() {
    this.previousRoundText?.setText(lastRoundMessage ? `Previous round: ${lastRoundMessage}` : '');
  }

  private cycleWeapon(direction: number) {
    if (this.gameFinished || this.matchTimeExpired()) return;
    const localIndex = offlineMode ? 0 : myPlayerId - 1;
    const owned = players[localIndex]?.weapons ?? ['gun'];
    const options = ACTIVE_WEAPONS.filter((weapon) => owned.includes(weapon));
    if (options.length === 0) return;
    const current = Math.max(0, options.indexOf(this.selectedWeapon));
    this.selectedWeapon = options[(current + direction + options.length) % options.length] ?? 'gun';
    this.pendingDoubleTarget = -1;
    PeerankiAudio.effect('select');
    this.refreshWeaponPicker();
    this.syncUI();
  }

  private matchTimeExpired() {
    const startedAt = Date.parse(matchStartedAt);
    return matchOver || (Number.isFinite(startedAt) && Date.now() >= startedAt + matchDurationMs());
  }

  private startMatchClock() {
    if (!matchStartedAt) matchStartedAt = new Date().toISOString();
    if (this.matchTimer) return;
    this.lastMatchSeconds = -1;
    const update = () => {
      const elapsed = Math.max(0, Date.now() - Date.parse(matchStartedAt));
      const remaining = Math.max(0, matchDurationMs() - elapsed);
      const seconds = Math.ceil(remaining / 1000);
      if (seconds !== this.lastMatchSeconds) {
        this.lastMatchSeconds = seconds;
        this.matchText?.setText(`MATCH ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} • ROUND ${matchRound}`);
        this.syncUI();
      }
      if (remaining === 0 && (offlineMode || amHost()) && !this.gameFinished) void this.finishMatch();
    };
    update();
    this.matchTimer = this.time.addEvent({ delay: 250, loop: true, callback: update });
  }

  private async finishRound(winnerMessage?: string) {
    if (this.gameFinished || this.matchTimeExpired() || (!offlineMode && !amHost())) {
      if (this.matchTimeExpired() && (offlineMode || amHost())) await this.finishMatch();
      return;
    }
    const winner = activePlayers().find((player) => player.alive);
    if (!winner) { await this.finishMatch(); return; }
    const upgrade = nextWeaponUpgrade(winner.weapons, matchRound);
    let message = winnerMessage ?? `${winner.name} wins Round ${matchRound}!`;
    if (upgrade) {
      winner.weapons = normalizeWeapons([...winner.weapons, upgrade]);
      message += ` Earned ${WEAPON_LABELS[upgrade]}.`;
      PeerankiAudio.effect('weapon_upgrade');
    } else {
      message += ' No new weapon unlocked this round.';
      PeerankiAudio.effect('round_win');
    }
    if (hasAllWeapons(winner.weapons)) winner.hasCollectedAllWeapons = true;
    lastRoundMessage = message;
    this.refreshPreviousRoundText();
    roundWinnerId = winner.id;
    matchRound += 1;
    players.forEach((player) => {
      player.stage = 0;
      player.alive = player.connected;
      player.shieldDisabledRound = -1;
      player.matchStartedAt = matchStartedAt;
      player.matchRound = matchRound;
      player.countingStartIndex = -1;
      player.roundWinnerId = roundWinnerId;
      player.matchOver = false;
    });
    this.currentShooter = -1;
    this.roundPhase = 'waiting';
    this.duelActive = false;
    this.resolvingDuel = false;
    this.duelBotTimer?.remove(false);
    this.duelBotTimer = undefined;
    this.clearDuelControls();
    duelRound = 1;
    players.forEach((player) => {
      player.duelChoice = null;
      player.duelChoiceRequest = null;
    });
    countingStartIndex = -1;
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;
    this.pendingDoubleTarget = -1;
    this.shooterText?.setText(message);
    this.statusText?.setText('Preparing the next round...');
    this.refreshWeaponPicker();
    this.renderPlayers();
    const winnerIndex = players.findIndex((player) => player.id === winner.id);
    const winnerCard = this.playerObjects[winnerIndex];
    if (winnerCard) this.tweens.add({ targets: winnerCard, scale: { from: 1, to: 1.12 }, duration: 300, yoyo: true, repeat: 2, ease: 'Back.Out' });
    if (!offlineMode) await syncGameState(null, 0, 'round_won');
    this.markShooter();
    if (!this.nextRoundTimer) {
      this.nextRoundTimer = this.time.delayedCall(NEXT_ROUND_DELAY, () => {
        this.nextRoundTimer = undefined;
        this.startCounting();
      });
    }
  }

  private async finishMatch() {
    if (this.gameFinished || (!offlineMode && !amHost())) return;
    this.gameFinished = true;
    this.duelActive = false;
    this.duelBotTimer?.remove(false);
    this.duelBotTimer = undefined;
    this.clearDuelControls();
    this.stopActionClock();
    shootingDeadlineAt = '';
    this.roundPhase = 'finished';
    matchOver = true;
    players.forEach((player) => { player.matchOver = true; });
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;
    this.nextRoundTimer?.remove(false);
    this.nextRoundTimer = undefined;
    const eligiblePlayers = connectedPlayers();
    const winners = findMatchWinners(eligiblePlayers);
    const topCount = winners[0]?.weapons.length ?? 0;
    if (!offlineMode) await syncGameState(this.currentShooter >= 0 ? this.currentShooter : null, this.countNumber, 'finished');
    this.showFinishedState(winners, topCount);
  }

  private isGameFinished() {
    return (
      activePlayers().filter(
        (player) => player.alive,
      ).length <= 1
    );
  }

 private showFinishedState(
  finalists = connectedPlayers(),
  weaponCount?: number,
) {
  this.duelActive = false;
  this.duelBotTimer?.remove(false);
  this.duelBotTimer = undefined;
  this.clearDuelControls();
  this.stopActionClock();
  shootingDeadlineAt = '';

  const connected = connectedPlayers();
  const winners = weaponCount === undefined
    ? findMatchWinners(finalists)
    : finalists.filter((player) => player.weapons.length === weaponCount);
  const topCount = winners[0]?.weapons.length ?? 0;

  if (!this.victoryPlayed) {
    this.victoryPlayed = true;
    const localId = offlineMode ? 1 : myPlayerId;
    const localWon = winners.some((player) => player.id === localId);
    if (localWon) {
      PeerankiAudio.effect('victory');
    } else {
      PeerankiAudio.effect('defeat');
    }
  }

  const { width, height } = this.scale;

  this.matchTimer?.remove(false);
  this.matchTimer = undefined;

  this.countText?.setText(
    `🏆 ${matchDurationMinutes}-MINUTE MATCH OVER`,
  );

  this.shooterText?.setText('');
  this.statusText?.setText('');

  if (this.children.getByName('game-over-panel')) {
    return;
  }

  /*
   * WINNER OVERLAY
   * Designed to remain readable on desktop and Android.
   */

  const panel = this.add
    .container(
      width / 2,
      height / 2,
    )
    .setName('game-over-panel')
    .setDepth(1000);

  const panelWidth = Math.min(
    width * 0.90,
    480,
  );

  const panelHeight = Math.min(
    height * 0.88,
    520,
  );

  // Dark background covering the game.
  const overlay = this.add.rectangle(
    0,
    0,
    width,
    height,
    0x000000,
    0.65,
  );

  // Main winner card.
  const card = this.add.rectangle(
    0,
    0,
    panelWidth,
    panelHeight,
    0x17212b,
    0.98,
  ).setStrokeStyle(
    3,
    0xf2cf66,
  );

  // Trophy.
  const trophyY = -panelHeight / 2 + 38;
  const trophy = this.add.text(
    0,
    trophyY,
    '🏆',
    {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
      fontSize: '38px',
    },
  ).setOrigin(0.5);

  // WINNER heading.
  const winnerHeadingY = trophyY + 34;
  const winnerHeading = this.add.text(
    0,
    winnerHeadingY,
    winners.length === 1
      ? 'WINNER'
      : 'MATCH TIE',
    {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
      fontSize: '22px',
      color: '#f2cf66',
      fontStyle: 'bold',
      align: 'center',
    },
  ).setOrigin(0.5);

  // Winner name.
  const winnerNameY = winnerHeadingY + 30;
  const winnerName = this.add.text(
    0,
    winnerNameY,
    winners.length === 1
      ? winners[0].name
      : winners.map((player) => player.name).join(' • '),
    {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
      fontSize: winners.length === 1 ? '24px' : '18px',
      color: '#ffffff',
      fontStyle: 'bold',
      align: 'center',
      wordWrap: {
        width: panelWidth - 40,
      },
    },
  ).setOrigin(0.5);

  // Main score.
  const scoreY = winnerNameY + 28;
  const weaponScore = this.add.text(
    0,
    scoreY,
    `⭐ ${topCount}/5 WEAPONS COLLECTED`,
    {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
      fontSize: '14px',
      color: '#38e08d',
      fontStyle: 'bold',
      align: 'center',
    },
  ).setOrigin(0.5);

  // Winner details.
  const winnerDetails = winners.length === 1
    ? `${winners[0].weapons.length}/5 weapons collected`
    : `${winners.length} players tied with ${topCount}/5 weapons`;

  const detailsY = scoreY + 22;
  const details = this.add.text(
    0,
    detailsY,
    winnerDetails,
    {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
      fontSize: '12px',
      color: '#cfd8dc',
      align: 'center',
    },
  ).setOrigin(0.5);

  // Player results (compact list to avoid overflowing buttons on Android screens).
  const maxDisplay = panelHeight < 400 ? 2 : panelHeight < 480 ? 3 : 5;
  const results = connected
    .slice(0, maxDisplay)
    .map(
      (player, idx) =>
        `${idx + 1}. ${player.name}  •  ${player.weapons.length}/5 weapons`,
    )
    .join('\n');

  const resultsY = detailsY + 18;
  const resultsText = this.add.text(
    0,
    resultsY,
    results,
    {
      fontFamily: 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
      fontSize: '12px',
      color: '#94a3b8',
      align: 'center',
      lineSpacing: 3,
      wordWrap: {
        width: panelWidth - 50,
      },
    },
  ).setOrigin(0.5, 0);

  // Buttons.
  const buttonY = panelHeight / 2 - 36;
  const btnW = Math.min(145, Math.floor((panelWidth - 36) / 2));

  const replay = makeButton(
    this,
    -btnW / 2 - 6,
    buttonY,
    'PLAY AGAIN',
    '#20a060',
    14,
    btnW,
    42,
  );

  const menu = makeButton(
    this,
    btnW / 2 + 6,
    buttonY,
    'MAIN MENU',
    '#2878ff',
    14,
    btnW,
    42,
  );

  panel.add([
    overlay,
    card,
    trophy,
    winnerHeading,
    winnerName,
    weaponScore,
    details,
    resultsText,
    replay,
    menu,
  ]);

  /*
   * Winner entrance animation.
   */
  panel.setAlpha(0);
  panel.setScale(0.82);

  this.tweens.add({
    targets: panel,
    alpha: 1,
    scale: 1,
    duration: 500,
    ease: 'Back.Out',
  });

  /*
   * Trophy animation.
   */
  this.tweens.add({
    targets: trophy,
    scale: {
      from: 0.85,
      to: 1.15,
    },
    duration: 700,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.InOut',
  });

  /*
   * Play Again.
   */
  replay.on(
    'pointerdown',
    () => {
      this.shutdown();

      if (offlineMode) {
        this.scene.start(
          'OfflineSetupScene',
        );
      } else {
        void leaveCurrentRoom();
        this.scene.start(
          'OnlineModeScene',
        );
      }
    },
  );

  /*
   * Main Menu.
   */
  menu.on(
    'pointerdown',
    () => {
      this.shutdown();

      if (offlineMode) {
        offlineMode = false;
        players = [];
      } else {
        void leaveCurrentRoom();
      }

      this.scene.start(
        'MenuScene',
      );
    },
  );

  this.markShooter();
}
  shutdown() {
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;
    this.matchTimer?.remove(false);
    this.matchTimer = undefined;
    this.stopActionClock();
    this.duelBotTimer?.remove(false);
    this.duelBotTimer = undefined;
    this.clearDuelControls();

    if (this.uiSyncRafId !== null) {
      window.cancelAnimationFrame(this.uiSyncRafId);
      this.uiSyncRafId = null;
    }
    this.uiSyncScheduled = false;

    this.nextRoundTimer?.remove(false);
    this.nextRoundTimer = undefined;

    this.pingTimer?.remove(false);
    this.pingTimer = undefined;

    if (this.realtimeChannel) {
      void this.realtimeChannel.unsubscribe();
      this.realtimeChannel = undefined;
    }

    this.uiManager.unmount();
    if (this.game.canvas) {
      this.game.canvas.style.opacity = '1';
      this.game.canvas.style.pointerEvents = 'auto';
    }
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#101418',
  parent: 'game',

  input: {
    activePointers: 2,
  },

  scene: [
    MenuScene,
    SettingsScene,
    OnlineModeScene,
    OfflineSetupScene,
    FriendsScene,
    PlayerCountScene,
    JoinScene,
    LobbyScene,
    GameScene,
  ],

  scale: {
    mode: Phaser.Scale.RESIZE,
    parent: 'game',
    width: '100%',
    height: '100%',
  },
};

window.peerankiDesktop?.onFullscreenChange((fullscreen) => {
  const settings = loadSettings();
  settings.fullscreen = fullscreen;
  saveSettings(settings);
});
void window.peerankiDesktop?.setFullscreen(loadSettings().fullscreen);

new Phaser.Game(config);
