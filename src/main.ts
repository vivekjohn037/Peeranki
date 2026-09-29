import Phaser from 'phaser';
import './style.css';

import {
  saveGameState,
  subscribeToGameState,
  createPrivateRoom,
  joinRoom,
  findOrCreateRandomRoom,
  fetchGameRoom,
  supabase,
} from './supabase';

interface Player {
  id: number;
  name: string;
  stage: number;
  alive: boolean;
}

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 10;
const COUNT_TO = 10;
const COUNTING_SPEED = 200;
const NEXT_ROUND_DELAY = 900;

let roomCode = '';
let myPlayerId = 0;
let myPlayerName = '';
let maxPlayers = MIN_PLAYERS;
let isPublicRoom = false;
let players: Player[] = [];

const towerStages = ['🗼', '🗼🗼', '▰', '💥'];
const stageNames = [
  'Big Tower',
  'Two Small Towers',
  'One Tower',
  'Eliminated',
];

function resetPlayers(playerCount: number) {
  const count = Math.max(
    MIN_PLAYERS,
    Math.min(MAX_PLAYERS, playerCount),
  );

  players = [];

  for (let index = 0; index < count; index += 1) {
    players.push({
      id: index + 1,
      name: `Player ${index + 1}`,
      stage: 0,
      alive: true,
    });
  }
}

function loadPlayersFromRoom(roomPlayers: unknown[]) {
  const safePlayers: Player[] = [];

  roomPlayers.slice(0, MAX_PLAYERS).forEach(
    (rawPlayer: any, index: number) => {
      safePlayers.push({
        id: Number(rawPlayer?.id) || index + 1,
        name:
          typeof rawPlayer?.name === 'string' &&
          rawPlayer.name.trim()
            ? rawPlayer.name
            : `Player ${index + 1}`,
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
      });
    },
  );

  players = safePlayers;
  maxPlayers = Math.max(
    MIN_PLAYERS,
    Math.min(
      MAX_PLAYERS,
      players.length || maxPlayers,
    ),
  );
}

async function syncGameState(
  currentShooter: number | null,
  countNumber: number,
  gameStatus: string,
) {
  if (!roomCode || players.length < MIN_PLAYERS) {
    return;
  }

  await saveGameState(
    roomCode,
    players,
    maxPlayers,
    currentShooter,
    countNumber,
    gameStatus,
  );
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

  const cssWidth = Math.min(width, rect.width * 0.72);

  input.style.position = 'fixed';
  input.style.left = `${rect.left + gameX * scaleX}px`;
  input.style.top = `${rect.top + gameY * scaleY}px`;
  input.style.transform = 'translate(-50%, -50%)';
  input.style.width = `${cssWidth}px`;
  input.style.padding = '13px 16px';
  input.style.fontSize = `${Math.max(16, Math.round(19 * scaleX))}px`;
  input.style.textAlign = 'center';
  input.style.boxSizing = 'border-box';
  input.style.border = '2px solid #444c55';
  input.style.borderRadius = '8px';
  input.style.backgroundColor = '#ffffff';
  input.style.color = '#111111';
  input.style.outline = 'none';
  input.style.zIndex = '10000';
}


function removePeerankiInputs() {
  document
    .querySelectorAll('input[id^="peeranki-"]')
    .forEach((element) => element.remove());
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
      .text(width / 2, height * 0.33, 'Traditional Kerala Game', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    const onlineButton = makeButton(
      this,
      width / 2,
      height * 0.54,
      'ONLINE PLAY',
      '#2878ff',
      28,
    );

    onlineButton.on('pointerdown', () => {
      this.scene.start('OnlineModeScene');
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
      .text(width / 2, 100, 'ONLINE PLAY', {
        fontFamily: 'Arial',
        fontSize: '42px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const friendsButton = makeButton(
      this,
      width / 2,
      height * 0.42,
      'PLAY WITH FRIENDS',
      '#2878ff',
      22,
    );

    const randomButton = makeButton(
      this,
      width / 2,
      height * 0.58,
      'RANDOM PLAYERS',
      '#444c55',
      22,
    );

    const backButton = this.add
      .text(width / 2, height * 0.80, 'BACK', {
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
      this.scene.start('PlayerCountScene', { mode: 'random' });
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
      .text(width / 2, 100, 'PLAY WITH FRIENDS', {
        fontFamily: 'Arial',
        fontSize: '36px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const createButton = makeButton(
      this,
      width / 2,
      height * 0.42,
      'CREATE GAME',
      '#2878ff',
    );

    const joinButton = makeButton(
      this,
      width / 2,
      height * 0.57,
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
      positionHtmlInput(this, this.nameInput, 450, 360);
    }
  };

  constructor() {
    super('PlayerCountScene');
  }

  init(data: { mode?: 'private' | 'random' }) {
    this.mode = data?.mode === 'random' ? 'random' : 'private';
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;
    let selectedCount = 6;

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
          ? 'Choose the number of players for your private room.'
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
          backgroundColor: count === 6 ? '#2878ff' : '#2a3037',
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
        selectedText.setText(`${selectedCount} PLAYERS`);

        choiceButtons.forEach((choiceButton, choiceIndex) => {
          choiceButton.setBackgroundColor(
            choices[choiceIndex] === selectedCount
              ? '#2878ff'
              : '#2a3037',
          );
        });
      });
    });

    if (this.mode === 'random') {
      this.add
        .text(width / 2, 315, 'Your Name', {
          fontFamily: 'Arial',
          fontSize: '18px',
          color: '#bbbbbb',
        })
        .setOrigin(0.5);

      this.nameInput = document.createElement('input');
      this.nameInput.id = 'peeranki-random-player-name';
      this.nameInput.type = 'text';
      this.nameInput.placeholder = 'Enter your name';
      this.nameInput.maxLength = 20;
      this.nameInput.autocomplete = 'name';
      document.body.appendChild(this.nameInput);

      positionHtmlInput(this, this.nameInput, 450, 360);
      window.addEventListener('resize', this.resizeHandler);
    }

    const actionButton = makeButton(
      this,
      width / 2,
      this.mode === 'random' ? 470 : 400,
      this.mode === 'private' ? 'CREATE ROOM' : 'FIND MATCH',
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
        this.mode === 'private' ? 'CREATING...' : 'FINDING...',
      );

      if (this.mode === 'private') {
        resetPlayers(selectedCount);

        const result = await createPrivateRoom(selectedCount);

        if (!result) {
          actionButton.setText('CREATE FAILED');
          actionButton.setInteractive({ useHandCursor: true });
          backButton.setInteractive({ useHandCursor: true });
          return;
        }

        roomCode = String(result.room_code);
        maxPlayers = Number(result.max_players);
        isPublicRoom = false;
        myPlayerId = 1;
        myPlayerName = 'Player 1';

        loadPlayersFromRoom(
          Array.isArray(result.players) ? result.players : players,
        );

        this.scene.start('LobbyScene');
        return;
      }

      const name = this.nameInput?.value.trim() ?? '';

      if (!name) {
        actionButton.setText('ENTER NAME');
        actionButton.setInteractive({ useHandCursor: true });
        backButton.setInteractive({ useHandCursor: true });
        this.nameInput?.focus();
        return;
      }

      const result = await findOrCreateRandomRoom(
        selectedCount,
        name,
      );

      if (!result) {
        actionButton.setText('MATCH FAILED');
        actionButton.setInteractive({ useHandCursor: true });
        backButton.setInteractive({ useHandCursor: true });
        return;
      }

      removePeerankiInputs();

      roomCode = String(result.room_code);
      maxPlayers = Number(result.max_players);
      isPublicRoom = true;

      const roomPlayers = Array.isArray(result.players)
        ? result.players
        : [];

      loadPlayersFromRoom(roomPlayers);

      const me = players.find(
        (player) =>
          player.name.toLowerCase() === name.toLowerCase(),
      );

      myPlayerId = me?.id ?? 1;
      myPlayerName = name;

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
    window.removeEventListener('resize', this.resizeHandler);
    this.nameInput?.remove();
    this.nameInput = undefined;
  }
}

class JoinScene extends Phaser.Scene {
  private roomInput?: HTMLInputElement;
  private nameInput?: HTMLInputElement;
  private resizeHandler = () => {
    if (this.roomInput) {
      positionHtmlInput(this, this.roomInput, 450, 225);
    }

    if (this.nameInput) {
      positionHtmlInput(this, this.nameInput, 450, 350);
    }
  };

  constructor() {
    super('JoinScene');
  }

  create() {
    removePeerankiInputs();

    const { width, height } = this.scale;

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
    window.addEventListener('resize', this.resizeHandler);

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
        this.roomInput?.value.trim().toUpperCase() ?? '';
      const name = this.nameInput?.value.trim() ?? '';

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

      const result = await joinRoom(code, name);

      if (!result) {
        joinButton.setText('JOIN FAILED');
        joinButton.setInteractive({ useHandCursor: true });
        backButton.setInteractive({ useHandCursor: true });
        return;
      }

      removePeerankiInputs();

      roomCode = String(result.room_code);
      maxPlayers = Number(result.max_players);
      isPublicRoom = false;

      const roomPlayers = Array.isArray(result.players)
        ? result.players
        : [];

      loadPlayersFromRoom(roomPlayers);

      const me = players.find(
        (player) =>
          player.name.toLowerCase() === name.toLowerCase(),
      );

      myPlayerId = me?.id ?? 0;
      myPlayerName = name;

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
    input.style.textTransform = uppercase ? 'uppercase' : 'none';

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
    window.removeEventListener('resize', this.resizeHandler);
    this.roomInput?.remove();
    this.nameInput?.remove();
    this.roomInput = undefined;
    this.nameInput = undefined;
  }
}

class LobbyScene extends Phaser.Scene {
  private playerText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  private roomText?: Phaser.GameObjects.Text;
  private startButton?: Phaser.GameObjects.Text;
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

    this.roomText = this.add
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
          isPublicRoom ? ' • RANDOM' : ' • PRIVATE'
        }`,
        {
          fontFamily: 'Arial',
          fontSize: '15px',
          color: '#bbbbbb',
        },
      )
      .setOrigin(0.5);

    this.playerText = this.add
      .text(width / 2, 250, 'Loading players...', {
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

    if (myPlayerId === 1) {
      this.startButton = makeButton(
        this,
        width / 2,
        height * 0.88,
        'START GAME',
        '#2878ff',
        22,
      );

      this.startButton.on('pointerdown', () => {
        void this.startGame();
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
      delay: 1200,
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

    if (Number.isFinite(Number(gameState.max_players))) {
      maxPlayers = Number(gameState.max_players);
    }

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
        'Room not found or connection failed.',
      );
      return;
    }

    this.applyRoomState(result);
  }

  private updateLobbyText() {
    let text = `PLAYERS ${players.length}/${maxPlayers}\n\n`;

    players.forEach((player, index) => {
      const hostMark =
        player.id === 1 ? ' 👑' : '';
      const youMark =
        player.id === myPlayerId ? ' • YOU' : '';

      text += `${index + 1}. ${player.name}${hostMark}${youMark}\n`;
    });

    this.playerText?.setText(text);

    if (players.length < maxPlayers) {
      this.statusText?.setText(
        isPublicRoom
          ? 'Finding players...'
          : myPlayerId === 1
            ? `Waiting for ${maxPlayers - players.length} more player(s)...`
            : 'Waiting for the host to start...',
      );

      this.startButton?.setVisible(false);
    } else {
      this.statusText?.setText(
        myPlayerId === 1
          ? 'All players are ready!'
          : 'All players are ready. Waiting for host...',
      );

      if (myPlayerId === 1) {
        this.startButton?.setVisible(true);
      }
    }
  }

  private async startGame() {
    if (
      this.starting ||
      myPlayerId !== 1 ||
      players.length !== maxPlayers
    ) {
      return;
    }

    this.starting = true;
    this.startButton?.disableInteractive();
    this.startButton?.setText('STARTING...');

    const cleanPlayers = players.map(
      (player, index) => ({
        id: index + 1,
        name: player.name,
        stage: 0,
        alive: true,
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

    players = cleanPlayers;
    this.openGame();
  }

  private openGame() {
    if (this.starting && this.scene.isActive('GameScene')) {
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

  private currentShooter = -1;
  private startIndex = -1;
  private countNumber = 0;

  private countingTimer?: Phaser.Time.TimerEvent;
  private nextRoundTimer?: Phaser.Time.TimerEvent;

  private realtimeChannel: any;
  private applyingRemoteState = false;
  private initialized = false;

  constructor() {
    super('GameScene');
  }

  create() {
    const { width, height } = this.scale;

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

    this.startRealtimeSync();
    void this.initializeGame();
  }

  private async initializeGame() {
    const room = await fetchGameRoom(roomCode);

    if (!room) {
      this.statusText?.setText(
        'Unable to load the game room.',
      );
      return;
    }

    if (Number.isFinite(Number(room.max_players))) {
      maxPlayers = Number(room.max_players);
    }

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
      room.game_status === 'shooting' ||
      room.game_status === 'counting'
    ) {
      this.applyRemoteGameState(room);
      return;
    }

    if (
      room.game_status === 'playing' &&
      myPlayerId === 1
    ) {
      this.startCounting();
    }
  }

  private renderPlayers() {
    this.playerObjects.forEach(
      (container) => container.destroy(),
    );

    this.playerObjects = [];

    const activePlayers = players.slice(
      0,
      maxPlayers,
    );

    const columns = 5;
    const rows = Math.ceil(
      activePlayers.length / columns,
    );

    const startX = 100;
    const endX = 800;
    const xStep =
      columns === 1
        ? 0
        : (endX - startX) / (columns - 1);

    const startY = rows === 1 ? 295 : 235;
    const yStep = rows <= 2 ? 215 : 150;

    activePlayers.forEach((player, index) => {
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
        165,
        150,
        0x1b2229,
      );

      background.setStrokeStyle(
        2,
        0x444c55,
      );

      const name = this.add
        .text(
          0,
          -54,
          player.name,
          {
            fontFamily: 'Arial',
            fontSize: '16px',
            color: '#ffffff',
            fontStyle: 'bold',
            align: 'center',
          },
        )
        .setOrigin(0.5);

      const tower = this.add
        .text(
          0,
          -4,
          towerStages[player.stage],
          {
            fontFamily: 'Arial',
            fontSize: '35px',
          },
        )
        .setOrigin(0.5);

      const stage = this.add
        .text(
          0,
          38,
          stageNames[player.stage],
          {
            fontFamily: 'Arial',
            fontSize: '12px',
            color: '#aaaaaa',
            align: 'center',
          },
        )
        .setOrigin(0.5);

      const idText = this.add
        .text(
          0,
          62,
          `Player ${player.id}`,
          {
            fontFamily: 'Arial',
            fontSize: '11px',
            color: '#777777',
          },
        )
        .setOrigin(0.5);

      container.add([
        background,
        name,
        tower,
        stage,
        idText,
      ]);

      container.setSize(165, 150);

      container.setInteractive(
        new Phaser.Geom.Rectangle(
          -82,
          -75,
          164,
          150,
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

      container.on(
        'pointerup',
        () => container.setScale(1),
      );

      container.on(
        'pointerout',
        () => container.setScale(1),
      );

      this.playerObjects.push(container);
    });

    this.playerObjects.forEach(
      (_, index) => this.updatePlayerVisual(index),
    );
  }

  private updatePlayerVisual(index: number) {
    const player = players[index];
    const container = this.playerObjects[index];

    if (!player || !container) {
      return;
    }

    const name = container.list[1] as Phaser.GameObjects.Text;
    const tower = container.list[2] as Phaser.GameObjects.Text;
    const stage = container.list[3] as Phaser.GameObjects.Text;

    name.setText(player.name);
    tower.setText(towerStages[player.stage]);
    stage.setText(stageNames[player.stage]);

    container.setAlpha(
      player.alive ? 1 : 0.35,
    );

    if (index === this.currentShooter) {
      const background =
        container.list[0] as Phaser.GameObjects.Rectangle;

      background.setStrokeStyle(
        3,
        0x4da3ff,
      );
    } else {
      const background =
        container.list[0] as Phaser.GameObjects.Rectangle;

      background.setStrokeStyle(
        2,
        0x444c55,
      );
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

    if (Array.isArray(gameState.players)) {
      loadPlayersFromRoom(
        gameState.players,
      );

      if (this.initialized) {
        this.renderPlayers();
      }
    }

    if (
      Number.isFinite(Number(gameState.max_players))
    ) {
      maxPlayers = Number(
        gameState.max_players,
      );
    }

    if (
      typeof gameState.current_shooter === 'number'
    ) {
      this.currentShooter =
        Number(gameState.current_shooter);
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
        'The 10th player will become the shooter.',
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
        myPlayerId === 1 &&
        !this.nextRoundTimer &&
        !this.countingTimer
      ) {
        this.nextRoundTimer =
          this.time.delayedCall(
            NEXT_ROUND_DELAY,
            () => {
              this.nextRoundTimer = undefined;

              if (!this.isGameFinished()) {
                this.startCounting();
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

  private markShooter() {
    for (
      let index = 0;
      index < this.playerObjects.length;
      index += 1
    ) {
      this.updatePlayerVisual(index);
    }
  }

  private startCounting() {
    if (
      myPlayerId !== 1 ||
      this.countingTimer ||
      this.nextRoundTimer
    ) {
      return;
    }

    const aliveIndexes = players
      .map(
        (player, index) =>
          player.alive ? index : -1,
      )
      .filter(
        (index) => index !== -1,
      );

    if (aliveIndexes.length <= 1) {
      void this.finishGame();
      return;
    }

    this.startIndex =
      Phaser.Utils.Array.GetRandom(
        aliveIndexes,
      );

    this.currentShooter = -1;
    this.countNumber = 0;

    this.shooterText?.setText(
      `🎲 Start: ${players[this.startIndex].name}`,
    );

    this.statusText?.setText(
      `Counting ${COUNT_TO} players...`,
    );

    this.countText?.setText(
      `Count 0 / ${COUNT_TO}`,
    );

    void syncGameState(
      null,
      0,
      'counting',
    );

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
              `${players[countedIndex].name} is the 10th player — choose a target.`,
            );

            void syncGameState(
              countedIndex,
              this.countNumber,
              'shooting',
            );
          } else {
            void syncGameState(
              countedIndex,
              this.countNumber,
              'counting',
            );
          }

          this.markShooter();
        },
        callbackScope: this,
      });

    this.countingTimer.remove(false);
  }

  private getCountedPlayerIndex(
    startIndex: number,
    count: number,
  ) {
    const aliveIndexes = players
      .map(
        (player, index) =>
          player.alive ? index : -1,
      )
      .filter(
        (index) => index !== -1,
      );

    if (aliveIndexes.length === 0) {
      return -1;
    }

    const startPosition =
      aliveIndexes.indexOf(startIndex);

    const safeStartPosition =
      startPosition >= 0
        ? startPosition
        : 0;

    const position =
      (safeStartPosition + count - 1) %
      aliveIndexes.length;

    return aliveIndexes[position];
  }

  private shootPlayer(index: number) {
    if (
      this.applyingRemoteState ||
      this.currentShooter < 0
    ) {
      return;
    }

    if (
      myPlayerId !==
      this.currentShooter + 1
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

    if (!target) {
      return;
    }

    if (!target.alive) {
      this.statusText?.setText(
        'That player is eliminated.',
      );
      return;
    }

    target.stage += 1;

    if (target.stage >= 3) {
      target.stage = 3;
      target.alive = false;
    }

    this.updatePlayerVisual(index);

    void this.recordShot();
  }

  private async recordShot() {
    const alivePlayers =
      players.filter(
        (player) => player.alive,
      );

    if (alivePlayers.length <= 1) {
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
      players.filter(
        (player) => player.alive,
      ).length <= 1
    );
  }

  private async finishGame() {
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
    const winner = players.find(
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
