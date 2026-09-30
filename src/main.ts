import Phaser from 'phaser';
import './style.css';

import {
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
  supabase,
} from './supabase';

interface Player {
  id: number;
  name: string;
  stage: number;
  alive: boolean;
  sessionId: string;
  connected: boolean;
  lastSeen: string;
}
// Offline game state
let offlineMode = false;
let offlinePlayers: Player[] = [];
let offlineMaxPlayers = 6;

function createOfflinePlayers(
  playerName: string,
  totalPlayers: number,
): Player[] {
  const offlinePlayers: Player[] = [];

  offlinePlayers.push({
    id: 1,
    name: playerName || 'Player',
    stage: 0,
    alive: true,
    sessionId: 'offline-human',
    connected: true,
    lastSeen: new Date().toISOString(),
  });

  for (let i = 2; i <= totalPlayers; i++) {
    offlinePlayers.push({
      id: i,
      name: `Bot ${i - 1}`,
      stage: 0,
      alive: true,
      sessionId: `offline-bot-${i}`,
      connected: true,
      lastSeen: new Date().toISOString(),
    });
  }

  return offlinePlayers;
}

const MIN_PLAYERS = 5;
const COUNT_TO = 10;
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

const towerStages = ['🗼', '🗼🗼', '▰', '💥'];
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
    stage: 0,
    alive: false,
    sessionId: '',
    connected: false,
    lastSeen: '',
  };
}


function loadPlayersFromRoom(roomPlayers: unknown[]) {
  const byId = new Map<number, Player>();

  roomPlayers.forEach((rawPlayer: any) => {
    const id = Number(rawPlayer?.id);

    if (!Number.isInteger(id) || id < 1 || id > maxPlayers) {
      return;
    }

    byId.set(id, {
      id,
      name:
        typeof rawPlayer?.name === 'string' &&
        rawPlayer.name.trim()
          ? rawPlayer.name
          : `Player ${id}`,
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
  width = 280,
) {
  const canvas = scene.game.canvas;
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / scene.scale.width;
  const scaleY = rect.height / scene.scale.height;
  const cssWidth = Math.min(
    width,
    rect.width * 0.72,
  );

  input.style.position = 'fixed';
  input.style.left = `${
    rect.left + gameX * scaleX
  }px`;
  input.style.top = `${
    rect.top + gameY * scaleY
  }px`;
  input.style.transform = 'translate(-50%, -50%)';
  input.style.width = `${cssWidth}px`;
  input.style.padding = '13px 16px';
  input.style.fontSize = `${Math.max(
    16,
    Math.round(19 * scaleX),
  )}px`;
  input.style.textAlign = 'center';
  input.style.boxSizing = 'border-box';
  input.style.border = '2px solid #444c55';
  input.style.borderRadius = '8px';
  input.style.backgroundColor = '#ffffff';
  input.style.color = '#111111';
  input.style.outline = 'none';
  input.style.zIndex = '10000';
}

function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  backgroundColor = '#2878ff',
  fontSize = 24,
) {
  return scene.add
    .text(x, y, label, {
      fontFamily: 'Arial',
      fontSize: `${fontSize}px`,
      color: '#ffffff',
      backgroundColor,
      padding: {
        x: 34,
        y: 16,
      },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
}

class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;

    this.add
      .text(width / 2, height * 0.23, 'പീരങ്കി', {
        fontFamily: 'Arial',
        fontSize: '64px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.33,
        'Traditional Kerala Game',
        {
          fontFamily: 'Arial',
          fontSize: '20px',
          color: '#bbbbbb',
        },
      )
      .setOrigin(0.5);

    const offlineButton = makeButton(
  this,
  width / 2,
  height * 0.45,
  'OFFLINE PLAY',
  '#20a060',
  28,
);

const onlineButton = makeButton(
  this,
  width / 2,
  height * 0.60,
  'ONLINE PLAY',
  '#2878ff',
  28,
);

offlineButton.on('pointerdown', () => {
  this.scene.start('OfflineSetupScene');
});

onlineButton.on('pointerdown', () => {
  this.scene.start('OnlineModeScene');
});
  }
}
class OfflineSetupScene extends Phaser.Scene {
  private selectedPlayers = 6;
  

  constructor() {
    super('OfflineSetupScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;

    this.add
      .text(width / 2, 90, 'OFFLINE PLAY', {
        fontFamily: 'Arial',
        fontSize: '42px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 155, 'Play against Bots', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    // Player name
    this.add
      .text(width / 2, height * 0.30, 'YOUR NAME', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const nameInput = document.createElement('input');

    nameInput.id = 'peeranki-offline-name';
    nameInput.type = 'text';
    nameInput.placeholder = 'Enter your name';
    nameInput.maxLength = 16;
    nameInput.value = 'Player';

    document.body.appendChild(nameInput);

    const rect = this.game.canvas.getBoundingClientRect();

nameInput.style.position = 'fixed';
nameInput.style.left = `${rect.left + rect.width / 2}px`;
nameInput.style.top = `${rect.top + rect.height * 0.37}px`;
nameInput.style.transform = 'translate(-50%, -50%)';
nameInput.style.width = `${Math.min(320, rect.width * 0.65)}px`;
nameInput.style.padding = '13px 16px';
nameInput.style.fontSize = '18px';
nameInput.style.textAlign = 'center';
nameInput.style.boxSizing = 'border-box';
nameInput.style.border = '2px solid #444c55';
nameInput.style.borderRadius = '8px';
nameInput.style.backgroundColor = '#ffffff';
nameInput.style.color = '#111111';
nameInput.style.outline = 'none';
nameInput.style.zIndex = '10000';

    this.add
      .text(width / 2, height * 0.49, 'NUMBER OF PLAYERS', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const playerCounts = [6, 7, 8, 9, 10];

    playerCounts.forEach((count, index) => {
      const row = index < 3 ? 0 : 1;
      const column = row === 0 ? index : index - 3;

      const x =
        width / 2 +
        (column - (row === 0 ? 1 : 0.5)) * 100;

      const y =
        height * 0.58 +
        row * 75;

      const button = makeButton(
        this,
        x,
        y,
        String(count),
        count === this.selectedPlayers ? '#20a060' : '#444c55',
        22,
      );

      button.setData('playerCount', count);

      button.on('pointerdown', () => {
        this.selectedPlayers = count;

        this.children.list.forEach((child) => {
          if (
            child instanceof Phaser.GameObjects.Text &&
            child.getData('playerCount')
          ) {
            const childCount = child.getData('playerCount');

            child.setStyle({
              backgroundColor:
                childCount === this.selectedPlayers
                  ? '#20a060'
                  : '#444c55',
            });
          }
        });
      });

      
    });

    const startButton = makeButton(
      this,
      width / 2,
      height * 0.79,
      'START GAME',
      '#20a060',
      22,
    );

   startButton.on('pointerdown', () => {
  const playerName =
    nameInput.value.trim() || 'Player';

  offlineMode = true;
  offlineMaxPlayers = this.selectedPlayers;

  offlinePlayers = createOfflinePlayers(
    playerName,
    offlineMaxPlayers,
  );

  console.log('Offline players created:', offlinePlayers);

  nameInput.remove();

  this.scene.start('GameScene', {
    offline: true,
  });
});

    const backButton = this.add
      .text(width / 2, height * 0.91, 'BACK', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backButton.on('pointerdown', () => {
      nameInput.remove();
      this.scene.start('MenuScene');
    });

    this.events.once('shutdown', () => {
      nameInput.remove();
    });
  }
}
class OnlineModeScene extends Phaser.Scene {
  constructor() {
    super('OnlineModeScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;

    this.add
      .text(width / 2, 90, 'ONLINE PLAY', {
        fontFamily: 'Arial',
        fontSize: '42px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const friendsButton = makeButton(
      this,
      width / 2,
      height * 0.40,
      'PLAY WITH FRIENDS',
      '#2878ff',
      22,
    );

    const randomButton = makeButton(
      this,
      width / 2,
      height * 0.55,
      'RANDOM PLAYERS',
      '#444c55',
      22,
    );

    const backButton = this.add
      .text(width / 2, height * 0.76, 'BACK', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    friendsButton.on('pointerdown', () => {
      this.scene.start('FriendsScene');
    });

    randomButton.on('pointerdown', () => {
      this.scene.start('PlayerCountScene', {
        mode: 'random',
      });
    });

    backButton.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });
  }
}

class FriendsScene extends Phaser.Scene {
  constructor() {
    super('FriendsScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;

    this.add
      .text(width / 2, 90, 'PLAY WITH FRIENDS', {
        fontFamily: 'Arial',
        fontSize: '36px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const createButton = makeButton(
      this,
      width / 2,
      height * 0.40,
      'CREATE GAME',
    );

    const joinButton = makeButton(
      this,
      width / 2,
      height * 0.55,
      'JOIN GAME',
      '#444c55',
    );

    const backButton = this.add
      .text(width / 2, height * 0.76, 'BACK', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    createButton.on('pointerdown', () => {
      this.scene.start('PlayerCountScene', {
        mode: 'private',
      });
    });

    joinButton.on('pointerdown', () => {
      this.scene.start('JoinScene');
    });

    backButton.on('pointerdown', () => {
      this.scene.start('OnlineModeScene');
    });
  }
}

class PlayerCountScene extends Phaser.Scene {
  private mode: 'private' | 'random' = 'private';
  private nameInput?: HTMLInputElement;
  private resizeHandler = () => {
    if (this.nameInput) {
      positionHtmlInput(
        this,
        this.nameInput,
        450,
        360,
      );
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

    const { width } = this.scale;
    let selectedCount = MIN_PLAYERS;

    this.add
      .text(
        width / 2,
        75,
        this.mode === 'private'
          ? 'CHOOSE PLAYERS'
          : 'RANDOM MATCH',
        {
          fontFamily: 'Arial',
          fontSize: '36px',
          color: '#ffffff',
          fontStyle: 'bold',
        },
      )
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        125,
        this.mode === 'private'
          ? 'Choose the number of players for your room.'
          : 'Choose the number of players for random matchmaking.',
        {
          fontFamily: 'Arial',
          fontSize: '17px',
          color: '#bbbbbb',
          align: 'center',
        },
      )
      .setOrigin(0.5);

    const selectedText = this.add
      .text(width / 2, 185, '6 PLAYERS', {
        fontFamily: 'Arial',
        fontSize: '26px',
        color: '#4da3ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const choices = [6, 7, 8, 9, 10];
    const choiceButtons: Phaser.GameObjects.Text[] = [];

    choices.forEach((count, index) => {
      const x = 210 + index * 120;

      const button = this.add
        .text(x, 250, String(count), {
          fontFamily: 'Arial',
          fontSize: '24px',
          color: '#ffffff',
          backgroundColor:
            count === selectedCount
              ? '#2878ff'
              : '#2a3037',
          padding: {
            x: 20,
            y: 16,
          },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      choiceButtons.push(button);

      button.on('pointerdown', () => {
        selectedCount = count;
        selectedText.setText(
          `${selectedCount} PLAYERS`,
        );

        choiceButtons.forEach(
          (choiceButton, choiceIndex) => {
            choiceButton.setBackgroundColor(
              choices[choiceIndex] === selectedCount
                ? '#2878ff'
                : '#2a3037',
            );
          },
        );
      });
    });

    if (this.mode === 'random') {
      this.add
        .text(width / 2, 315, 'YOUR NAME', {
          fontFamily: 'Arial',
          fontSize: '18px',
          color: '#bbbbbb',
        })
        .setOrigin(0.5);

      this.nameInput = document.createElement('input');
      this.nameInput.id =
        'peeranki-random-player-name';
      this.nameInput.type = 'text';
      this.nameInput.placeholder = 'Enter your name';
      this.nameInput.maxLength = 20;
      this.nameInput.autocomplete = 'name';
      document.body.appendChild(this.nameInput);

      positionHtmlInput(
        this,
        this.nameInput,
        450,
        360,
      );

      window.addEventListener(
        'resize',
        this.resizeHandler,
      );
    }

    const actionButton = makeButton(
      this,
      width / 2,
      this.mode === 'random' ? 470 : 400,
      this.mode === 'private'
        ? 'CREATE ROOM'
        : 'FIND MATCH',
    );

    const backButton = this.add
      .text(
        width / 2,
        this.mode === 'random' ? 555 : 500,
        'BACK',
        {
          fontFamily: 'Arial',
          fontSize: '18px',
          color: '#bbbbbb',
        },
      )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

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
        this.nameInput?.value.trim() ?? '';

      if (!name) {
        actionButton.setText('ENTER NAME');
        actionButton.setInteractive({
          useHandCursor: true,
        });
        backButton.setInteractive({
          useHandCursor: true,
        });
        this.nameInput?.focus();
        return;
      }

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
    if (this.roomInput) {
      positionHtmlInput(
        this,
        this.roomInput,
        450,
        225,
      );
    }

    if (this.nameInput) {
      positionHtmlInput(
        this,
        this.nameInput,
        450,
        350,
      );
    }
  };

  constructor() {
    super('JoinScene');
  }

  create() {
    removePeerankiInputs();

    const { width } = this.scale;

    this.add
      .text(width / 2, 75, 'JOIN PRIVATE GAME', {
        fontFamily: 'Arial',
        fontSize: '36px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 165, 'ROOM CODE', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.roomInput = this.createInput(
      'ABC123',
      'peeranki-room-code',
      true,
    );

    this.add
      .text(width / 2, 290, 'YOUR NAME', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.nameInput = this.createInput(
      'Enter your name',
      'peeranki-player-name',
      false,
    );

    this.resizeHandler();
    window.addEventListener(
      'resize',
      this.resizeHandler,
    );

    const joinButton = makeButton(
      this,
      width / 2,
      480,
      'JOIN GAME',
    );

    const backButton = this.add
      .text(width / 2, 575, 'BACK', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    joinButton.on('pointerdown', async () => {
      const code =
        this.roomInput?.value.trim().toUpperCase() ??
        '';
      const name =
        this.nameInput?.value.trim() ?? '';

      if (code.length !== 6) {
        joinButton.setText('ENTER 6-CHAR CODE');
        this.roomInput?.focus();
        return;
      }

      if (!name) {
        joinButton.setText('ENTER NAME');
        this.nameInput?.focus();
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

  constructor() {
    super('LobbyScene');
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, 55, 'WAITING ROOM', {
        fontFamily: 'Arial',
        fontSize: '38px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        105,
        `ROOM: ${roomCode}`,
        {
          fontFamily: 'Arial',
          fontSize: '27px',
          color: '#4da3ff',
          fontStyle: 'bold',
        },
      )
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        140,
        `${maxPlayers} PLAYER MATCH${
          isPublicRoom
            ? ' • RANDOM'
            : ' • PRIVATE'
        }`,
        {
          fontFamily: 'Arial',
          fontSize: '15px',
          color: '#bbbbbb',
        },
      )
      .setOrigin(0.5);

    this.playerText = this.add
      .text(width / 2, 255, 'Loading players...', {
        fontFamily: 'Arial',
        fontSize: '21px',
        color: '#ffffff',
        align: 'center',
        lineSpacing: 7,
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(width / 2, 470, '', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    if (amHost() && !isPublicRoom) {
      this.startButton = makeButton(
        this,
        width / 2,
        height * 0.82,
        'START GAME',
        '#2878ff',
        22,
      );

      this.startButton.on(
        'pointerdown',
        () => {
          void this.startGame();
        },
      );
    }

    this.leaveButton = this.add
      .text(width / 2, height * 0.94, 'LEAVE ROOM', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#ff7777',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.leaveButton.on(
      'pointerdown',
      async () => {
        this.leaveButton?.disableInteractive();
        this.statusText?.setText('Leaving room...');
        await leaveCurrentRoom();
        this.scene.start('OnlineModeScene');
      },
    );

    this.realtimeChannel = subscribeToGameState(
      roomCode,
      (gameState) => {
        this.applyRoomState(gameState);
      },
    );

    void this.refreshLobby();

    this.refreshTimer = this.time.addEvent({
      delay: 1500,
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
      loadPlayersFromRoom(gameState.players);
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

    let text =
      `PLAYERS ${connected.length}/${maxPlayers}\n\n`;

    connected.forEach((player, index) => {
      const hostMark =
        player.sessionId === hostSessionId
          ? ' 👑'
          : '';
      const youMark =
        player.sessionId === sessionId
          ? ' • YOU'
          : '';

      text +=
        `${index + 1}. ${player.name}` +
        `${hostMark}${youMark}\n`;
    });

    this.playerText?.setText(text);

    if (connected.length < maxPlayers) {
      this.statusText?.setText(
        isPublicRoom
          ? `Finding players... ${connected.length}/${maxPlayers}`
          : amHost()
            ? `Waiting for ${maxPlayers - connected.length} more player(s)...`
            : 'Waiting for the host to start...',
      );

      this.startButton?.setVisible(false);
    } else {
      this.statusText?.setText(
        isPublicRoom
          ? 'Match full — starting...'
          : amHost()
            ? 'All players are ready!'
            : 'All players are ready. Waiting for host...',
      );

      if (amHost() && !isPublicRoom) {
        this.startButton?.setVisible(true);
      }
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
    this.startButton?.disableInteractive();
    this.startButton?.setText('STARTING...');

    const cleanPlayers = connected.map(
      (player) => ({
        id: player.id,
        name: player.name,
        stage: 0,
        alive: true,
        session_id: player.sessionId,
        connected: true,
        last_seen: player.lastSeen,
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
  private playerObjects: Phaser.GameObjects.Container[] = [];
  private statusText?: Phaser.GameObjects.Text;
  private countText?: Phaser.GameObjects.Text;
  private shooterText?: Phaser.GameObjects.Text;
  private leaveButton?: Phaser.GameObjects.Text;

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

  constructor() {
    super('GameScene');
  }

  create() {
    if (offlineMode) {
  console.log('Offline mode active');
}
    const { width, height } = this.scale;

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

    this.add
      .text(width / 2, 35, 'പീരങ്കി', {
        fontFamily: 'Arial',
        fontSize: '40px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.shooterText = this.add
      .text(width / 2, 76, '', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#4da3ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(width / 2, 105, '', {
        fontFamily: 'Arial',
        fontSize: '15px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    this.countText = this.add
      .text(width / 2, height - 35, '', {
        fontFamily: 'Arial',
        fontSize: '26px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.leaveButton = this.add
      .text(width - 75, 28, 'LEAVE', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: '#ff7777',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.leaveButton.on(
      'pointerdown',
      async () => {
        this.leaveButton?.disableInteractive();
        this.statusText?.setText('Leaving game...');
        await leaveCurrentRoom();
        this.scene.start('OnlineModeScene');
      },
    );

    if (offlineMode) {
  this.statusText?.setText('Offline game ready!');

  this.time.delayedCall(500, () => {
    this.startCounting();
  });
} else {
  this.startRealtimeSync();
  void this.initializeGame();
}
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

    if (room.game_status === 'finished') {
      this.showFinishedState();
      return;
    }

    if (
      room.game_status === 'counting' ||
      room.game_status === 'shooting' ||
      room.game_status === 'shot'
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
    this.playerObjects.forEach(
      (container) => container.destroy(),
    );

    this.playerObjects = [];

    const columns = maxPlayers <= 6 ? 3 : 5;
    const rows = Math.ceil(maxPlayers / columns);
    const startX = 170;
    const endX = 730;
    const xStep =
  (endX - startX) / (columns - 1);
    const startY = rows <= 2 ? 225 : 175;
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
        180,
        135,
        0x1b2229,
      );

      background.setStrokeStyle(
        2,
        0x444c55,
      );

      const name = this.add
        .text(0, -48, '', {
          fontFamily: 'Arial',
          fontSize: '16px',
          color: '#ffffff',
          fontStyle: 'bold',
          align: 'center',
        })
        .setOrigin(0.5);

      const tower = this.add
        .text(0, -3, '', {
          fontFamily: 'Arial',
          fontSize: '34px',
        })
        .setOrigin(0.5);

      const stage = this.add
        .text(0, 38, '', {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: '#aaaaaa',
        })
        .setOrigin(0.5);

      const slot = this.add
        .text(0, 60, '', {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: '#777777',
        })
        .setOrigin(0.5);

      container.add([
        background,
        name,
        tower,
        stage,
        slot,
      ]);

      container.setSize(180, 135);
      container.setInteractive(
        new Phaser.Geom.Rectangle(
          -90,
          -67,
          180,
          134,
        ),
        Phaser.Geom.Rectangle.Contains,
      );

      container.on(
        'pointerdown',
        () => {
          container.setScale(0.96);
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
      container.list[2] as Phaser.GameObjects.Text;
    const stage =
      container.list[3] as Phaser.GameObjects.Text;
    const slot =
      container.list[4] as Phaser.GameObjects.Text;

    name.setText(
      player.connected
        ? player.name
        : `Player ${player.id}`,
    );

    tower.setText(
      player.connected
        ? towerStages[player.stage]
        : '—',
    );

    stage.setText(
      player.connected
        ? stageNames[player.stage]
        : 'Empty',
    );

    slot.setText(
      player.connected
        ? `Player ${player.id}`
        : 'Available slot',
    );

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

    container.setInteractive(
      player.connected && player.alive,
    );
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
      loadPlayersFromRoom(gameState.players);

      if (this.initialized) {
        this.renderPlayers();
      }
    }

    if (
      typeof gameState.current_shooter === 'number'
    ) {
      this.currentShooter = Number(
        gameState.current_shooter,
      );
    }

    const remoteCount = Number(
      gameState.countdown,
    );

    if (Number.isFinite(remoteCount)) {
      this.countNumber = remoteCount;
    }

    if (
      gameState.game_status === 'counting'
    ) {
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
      const shooter =
        players[this.currentShooter];

      this.countText?.setText(
        `Count ${COUNT_TO} / ${COUNT_TO}`,
      );
      this.shooterText?.setText(
        shooter
          ? `🎯 Shooter: ${shooter.name}`
          : '🎯 Shooter selected',
      );
      this.statusText?.setText(
        myPlayerId === this.currentShooter + 1
          ? 'You are the shooter — choose a player.'
          : 'Waiting for the shooter...',
      );
      this.markShooter();
      return;
    }

    if (
      gameState.game_status === 'shot'
    ) {
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

        if (!this.isGameFinished()) {
          this.startCounting(
            nextStartIndex >= 0
              ? nextStartIndex
              : undefined,
          );
        }
      },
    );
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
private startCounting(forcedStartIndex?: number) {
  if (
    (!offlineMode && !amHost()) ||
    this.countingTimer ||
    this.nextRoundTimer ||
    this.gameFinished
  ) {
    return;
  }

  const aliveIndexes = activePlayers()
    .map((player) => player.id - 1)
    .filter(
      (index) =>
        players[index]?.alive === true,
    );

  if (aliveIndexes.length <= 1) {
    void this.finishGame();
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

  this.currentShooter = -1;
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
        this.countNumber += 1;

        const countedIndex =
          this.getCountedPlayerIndex(
            this.startIndex,
            this.countNumber,
          );

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
          this.shooterText?.setText(
            `🎯 Shooter: ${players[countedIndex].name}`,
          );

          this.statusText?.setText(
           `${players[countedIndex].name} has the 10th tower.`,
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
              700,
              () => {
                this.botShoot(countedIndex);
              },
            );
          } else if (offlineMode) {
            this.statusText?.setText(
              'You are the shooter — choose a target.',
            );
          }
        } else {
          if (!offlineMode) {
            void syncGameState(
              countedIndex,
              this.countNumber,
              'counting',
            );
          }
        }

        this.markShooter();
      },

      callbackScope: this,
    });
}

private botShoot(shooterIndex: number) {
  if (!offlineMode) {
    return;
  }

  const possibleTargets = players
    .map((player, index) => ({
      player,
      index,
    }))
    .filter(
      ({ player, index }) =>
        player.alive &&
        index !== shooterIndex,
    );

  if (possibleTargets.length === 0) {
    void this.finishGame();
    return;
  }

  // Easy bot: randomly choose an alive player
  const selectedTarget =
    Phaser.Utils.Array.GetRandom(
      possibleTargets,
    );

  this.statusText?.setText(
    `${players[shooterIndex].name} is shooting ${selectedTarget.player.name}...`,
  );

  this.time.delayedCall(500, () => {
    this.applyOfflineShot(
      shooterIndex,
      selectedTarget.index,
    );
  });
}

private applyOfflineShot(
  _shooterIndex: number,
  targetIndex: number,
) {
  if (!offlineMode) {
    return;
  }

  const target = players[targetIndex];

  if (!target || !target.alive) {
    return;
  }

  target.stage += 1;

  if (target.stage >= 3) {
    target.stage = 3;
    target.alive = false;
  }

  this.updatePlayerVisual(targetIndex);

const targetContainer =
  this.playerObjects[targetIndex];

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
    this.time.delayedCall(1000, () => {
      void this.finishGame();
    });

    return;
  }

  // Start the next counting cycle
  const nextStartIndex =
  this.getNextCountingStartIndex(
    targetIndex,
  );

this.time.delayedCall(1200, () => {
  this.startCounting(
    nextStartIndex >= 0
      ? nextStartIndex
      : undefined,
  );
});
}

  private getCountedPlayerIndex(
  startIndex: number,
  count: number,
) {
  const aliveIndexes = activePlayers()
    .map((player) => player.id - 1)
    .filter(
      (index) =>
        players[index]?.alive === true,
    );

  if (aliveIndexes.length === 0) {
    return -1;
  }

  // Build the counting sequence using towers.
  // Stage 0 = 1 tower
  // Stage 1 = 2 towers
  // Stage 2 = 1 tower
  const countingSequence: number[] = [];

  const startPosition =
    aliveIndexes.indexOf(startIndex);

  const safeStartPosition =
    startPosition >= 0
      ? startPosition
      : 0;

  for (
    let offset = 0;
    offset < aliveIndexes.length;
    offset += 1
  ) {
    const position =
      (safeStartPosition + offset) %
      aliveIndexes.length;

    const playerIndex =
      aliveIndexes[position];

    const player =
      players[playerIndex];

    if (!player) {
      continue;
    }

    const towerCount =
      player.stage === 1
        ? 2
        : 1;

    for (
      let tower = 0;
      tower < towerCount;
      tower += 1
    ) {
      countingSequence.push(playerIndex);
    }
  }

  if (countingSequence.length === 0) {
    return -1;
  }

  const sequencePosition =
    (count - 1) %
    countingSequence.length;

  return countingSequence[sequencePosition];
}

private getNextCountingStartIndex(
  targetIndex: number,
) {
  if (players[targetIndex]?.alive) {
    return targetIndex;
  }

  for (
    let offset = 1;
    offset < players.length;
    offset += 1
  ) {
    const candidateIndex =
      (targetIndex + offset) %
      players.length;

    const candidate =
      players[candidateIndex];

    if (
      candidate?.alive &&
      candidate.connected
    ) {
      return candidateIndex;
    }
  }

  return -1;
}

private shootPlayer(index: number) {
  if (
    this.applyingRemoteState ||
    this.gameFinished ||
    this.currentShooter < 0
  ) {
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

  target.stage += 1;

  if (target.stage >= 3) {
    target.stage = 3;
    target.alive = false;
  }

 this.updatePlayerVisual(index);

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
      this.time.delayedCall(1000, () => {
        void this.finishGame();
      });

      return;
    }

    const nextStartIndex =
  this.getNextCountingStartIndex(index);

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
  this.getNextCountingStartIndex(index);

void this.recordShot();
}

  private async recordShot() {
    const alive = activePlayers().filter(
      (player) => player.alive,
    );

    if (alive.length <= 1) {
      await syncGameState(
        this.currentShooter,
        COUNT_TO,
        'finished',
      );
      this.showFinishedState();
      return;
    }

    await syncGameState(
      this.currentShooter,
      COUNT_TO,
      'shot',
    );
  }

  private isGameFinished() {
    return (
      activePlayers().filter(
        (player) => player.alive,
      ).length <= 1
    );
  }

  private async finishGame() {
    if (this.gameFinished) {
      return;
    }

    this.gameFinished = true;

    await syncGameState(
      this.currentShooter >= 0
        ? this.currentShooter
        : null,
      this.countNumber,
      'finished',
    );

    this.showFinishedState();
  }

  private showFinishedState() {
    this.gameFinished = true;

    const winner = activePlayers().find(
      (player) => player.alive,
    );

    this.countText?.setText(
      '🏆 GAME OVER',
    );
    this.shooterText?.setText(
      winner
        ? `${winner.name} wins!`
        : 'Game finished',
    );
    this.statusText?.setText(
      'The game has ended.',
    );
    this.markShooter();
  }

  shutdown() {
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;

    this.nextRoundTimer?.remove(false);
    this.nextRoundTimer = undefined;

    if (this.realtimeChannel) {
      void this.realtimeChannel.unsubscribe();
      this.realtimeChannel = undefined;
    }
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 900,
  height: 700,
  backgroundColor: '#101418',
  parent: 'game',

  input: {
    activePointers: 2,
  },

  scene: [
    MenuScene,
    OnlineModeScene,
    OfflineSetupScene,
    FriendsScene,
    PlayerCountScene,
    JoinScene,
    LobbyScene,
    GameScene,
  ],

  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);
