import Phaser from 'phaser';
import './style.css';

import {
  saveGameState,
  subscribeToGameState,
  createRoom,
  joinRoom,
  fetchGameRoom,
  supabase,
} from './supabase';

interface Player {
  id: number;
  name: string;
  stage: number;
  alive: boolean;
}

const players: Player[] = [
  { id: 1, name: 'Player 1', stage: 0, alive: true },
  { id: 2, name: 'Player 2', stage: 0, alive: true },
  { id: 3, name: 'Player 3', stage: 0, alive: true },
  { id: 4, name: 'Player 4', stage: 0, alive: true },
  { id: 5, name: 'Player 5', stage: 0, alive: true },
  { id: 6, name: 'Player 6', stage: 0, alive: true },
];

let roomCode = '';
let myPlayerId = 0;
let myPlayerName = '';

const COUNTING_SPEED = 200;
const COUNT_TO = 10;
const MAX_PLAYERS = 6;

const towerStages = [
  '🗼',
  '🗼🗼',
  '▰',
  '💥',
];

const stageNames = [
  'Big Tower',
  'Two Small Towers',
  'One Tower',
  'Eliminated',
];

function resetPlayers() {
  players.forEach((player, index) => {
    player.id = index + 1;
    player.stage = 0;
    player.alive = true;
  });
}

function updatePlayersFromRoom(roomPlayers: any[]) {
  for (let index = 0; index < MAX_PLAYERS; index += 1) {
    const localPlayer = players[index];
    const remotePlayer = roomPlayers[index];

    if (!remotePlayer) {
      localPlayer.name = `Player ${index + 1}`;
      localPlayer.stage = 0;
      localPlayer.alive = false;
      continue;
    }

    localPlayer.id = Number(remotePlayer.id) || index + 1;
    localPlayer.name =
      typeof remotePlayer.name === 'string' && remotePlayer.name.trim()
        ? remotePlayer.name
        : `Player ${index + 1}`;
    localPlayer.stage = Number.isFinite(remotePlayer.stage)
      ? remotePlayer.stage
      : 0;
    localPlayer.alive =
      typeof remotePlayer.alive === 'boolean'
        ? remotePlayer.alive
        : true;
  }
}

async function syncGameState(
  currentShooter: number | null,
  countNumber: number,
  gameStatus: string,
) {
  if (!roomCode) {
    return;
  }

  await saveGameState(
    roomCode,
    players,
    currentShooter,
    countNumber,
    gameStatus,
  );
}

class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height * 0.22, 'പീരങ്കി', {
        fontFamily: 'Arial',
        fontSize: '64px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height * 0.32, 'Traditional Kerala Game', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    const createButton = this.add
      .text(width / 2, height * 0.50, 'CREATE GAME', {
        fontFamily: 'Arial',
        fontSize: '26px',
        color: '#ffffff',
        backgroundColor: '#2878ff',
        padding: {
          x: 40,
          y: 18,
        },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const joinButton = this.add
      .text(width / 2, height * 0.65, 'JOIN GAME', {
        fontFamily: 'Arial',
        fontSize: '26px',
        color: '#ffffff',
        backgroundColor: '#444c55',
        padding: {
          x: 48,
          y: 18,
        },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const statusText = this.add
      .text(width / 2, height * 0.80, '', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    createButton.on('pointerdown', async () => {
      createButton.disableInteractive();
      joinButton.disableInteractive();

      createButton.setText('CREATING...');
      statusText.setText('');

      const result = await createRoom();

      if (!result) {
        createButton.setText('CREATE FAILED');
        createButton.setInteractive({ useHandCursor: true });
        joinButton.setInteractive({ useHandCursor: true });
        statusText.setText('Check Supabase and try again.');
        return;
      }

      roomCode = String(result.room_code);
      myPlayerId = 1;
      myPlayerName = 'Player 1';

      this.scene.start('LobbyScene');
    });

    joinButton.on('pointerdown', () => {
      this.scene.start('JoinScene');
    });
  }
}

class JoinScene extends Phaser.Scene {
  private roomInput?: HTMLInputElement;
  private nameInput?: HTMLInputElement;

  constructor() {
    super('JoinScene');
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, 90, 'JOIN GAME', {
        fontFamily: 'Arial',
        fontSize: '40px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 160, 'Room Code', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    this.roomInput = document.createElement('input');
    this.roomInput.placeholder = 'ABC123';
    this.roomInput.maxLength = 6;
    this.roomInput.autocomplete = 'off';
    this.roomInput.style.position = 'fixed';
    this.roomInput.style.left = '50%';
    this.roomInput.style.top = '38%';
    this.roomInput.style.transform = 'translate(-50%, -50%)';
    this.roomInput.style.width = '220px';
    this.roomInput.style.padding = '12px';
    this.roomInput.style.fontSize = '22px';
    this.roomInput.style.textAlign = 'center';
    this.roomInput.style.textTransform = 'uppercase';
    document.body.appendChild(this.roomInput);

    this.add
      .text(width / 2, 235, 'Your Name', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    this.nameInput = document.createElement('input');
    this.nameInput.placeholder = 'Enter your name';
    this.nameInput.maxLength = 20;
    this.nameInput.autocomplete = 'off';
    this.nameInput.style.position = 'fixed';
    this.nameInput.style.left = '50%';
    this.nameInput.style.top = '51%';
    this.nameInput.style.transform = 'translate(-50%, -50%)';
    this.nameInput.style.width = '220px';
    this.nameInput.style.padding = '12px';
    this.nameInput.style.fontSize = '20px';
    this.nameInput.style.textAlign = 'center';
    document.body.appendChild(this.nameInput);

    const joinButton = this.add
      .text(width / 2, height * 0.70, 'JOIN', {
        fontFamily: 'Arial',
        fontSize: '26px',
        color: '#ffffff',
        backgroundColor: '#2878ff',
        padding: {
          x: 50,
          y: 16,
        },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const backButton = this.add
      .text(width / 2, height * 0.84, 'BACK', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    joinButton.on('pointerdown', async () => {
      const code = this.roomInput?.value.trim().toUpperCase() ?? '';
      const name = this.nameInput?.value.trim() ?? '';

      if (code.length !== 6) {
        joinButton.setText('ENTER 6-CHAR CODE');
        return;
      }

      if (!name) {
        joinButton.setText('ENTER NAME');
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

      roomCode = String(result.room_code);

      const joinedPlayers = Array.isArray(result.players)
        ? result.players
        : [];

      const me = joinedPlayers.find(
        (player: any) => player.name === name,
      );

      myPlayerId = Number(me?.id) || 0;
      myPlayerName = name;

      this.scene.start('LobbyScene');
    });

    backButton.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });
  }

  shutdown() {
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
  private refreshTimer?: Phaser.Time.TimerEvent;
  private starting = false;

  constructor() {
    super('LobbyScene');
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, 70, 'WAITING ROOM', {
        fontFamily: 'Arial',
        fontSize: '38px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 120, `ROOM: ${roomCode}`, {
        fontFamily: 'Arial',
        fontSize: '28px',
        color: '#4da3ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 155, `You: ${myPlayerName}`, {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    this.playerText = this.add
      .text(width / 2, 260, 'Loading players...', {
        fontFamily: 'Arial',
        fontSize: '22px',
        color: '#ffffff',
        align: 'center',
        lineSpacing: 8,
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(width / 2, 440, 'Waiting for players...', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    this.startButton = this.add
      .text(width / 2, height * 0.88, 'START GAME', {
        fontFamily: 'Arial',
        fontSize: '24px',
        color: '#ffffff',
        backgroundColor: '#2878ff',
        padding: {
          x: 40,
          y: 16,
        },
      })
      .setOrigin(0.5);

    if (myPlayerId === 1) {
      this.startButton.setInteractive({
        useHandCursor: true,
      });

      this.startButton.on('pointerdown', () => {
        void this.startGame();
      });
    } else {
      this.startButton.setVisible(false);
    }

    void this.refreshLobby();

    this.refreshTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        void this.refreshLobby();
      },
    });
  }

  private async refreshLobby() {
    if (this.starting) {
      return;
    }

    const result = await fetchGameRoom(roomCode);

    if (!result) {
      this.statusText?.setText('Room could not be found.');
      return;
    }

    const lobbyPlayers = Array.isArray(result.players)
      ? result.players
      : [];

    updatePlayersFromRoom(lobbyPlayers);

    let text = `PLAYERS ${lobbyPlayers.length}/${MAX_PLAYERS}\n\n`;

    lobbyPlayers.forEach((player: any, index: number) => {
      const hostMark = Number(player.id) === 1 ? ' 👑' : '';
      text += `${index + 1}. ${player.name}${hostMark}\n`;
    });

    this.playerText?.setText(text);

    if (result.game_status === 'playing') {
      this.starting = true;
      this.refreshTimer?.remove(false);
      this.scene.start('GameScene');
      return;
    }

    if (lobbyPlayers.length < MAX_PLAYERS) {
      this.statusText?.setText(
        myPlayerId === 1
          ? 'Waiting for 6 players...'
          : 'Waiting for the host to start...',
      );

      if (myPlayerId === 1) {
        this.startButton?.setVisible(false);
      }
    } else {
      this.statusText?.setText(
        myPlayerId === 1
          ? 'All 6 players are ready!'
          : 'All 6 players are ready. Waiting for host...',
      );

      if (myPlayerId === 1) {
        this.startButton?.setVisible(true);
      }
    }
  }

  private async startGame() {
    if (myPlayerId !== 1 || this.starting) {
      return;
    }

    this.starting = true;
    this.startButton?.disableInteractive();
    this.startButton?.setText('STARTING...');

    const { data: room, error: readError } = await supabase
      .from('game_states')
      .select('players')
      .eq('room_code', roomCode)
      .maybeSingle();

    if (readError || !room) {
      this.starting = false;
      this.startButton?.setText('START FAILED');
      this.startButton?.setInteractive({ useHandCursor: true });
      return;
    }

    const roomPlayers = Array.isArray(room.players)
      ? room.players
      : [];

    if (roomPlayers.length !== MAX_PLAYERS) {
      this.starting = false;
      this.startButton?.setText('NEED 6 PLAYERS');
      this.startButton?.setInteractive({ useHandCursor: true });
      return;
    }

    resetPlayers();
    updatePlayersFromRoom(roomPlayers);

    const { error } = await supabase
      .from('game_states')
      .update({
        players,
        current_shooter: null,
        countdown: 0,
        game_status: 'playing',
        updated_at: new Date().toISOString(),
      })
      .eq('room_code', roomCode);

    if (error) {
      console.error('Failed to start game:', error);
      this.starting = false;
      this.startButton?.setText('START FAILED');
      this.startButton?.setInteractive({ useHandCursor: true });
      return;
    }

    this.refreshTimer?.remove(false);
    this.scene.start('GameScene');
  }

  shutdown() {
    this.refreshTimer?.remove(false);
  }
}

class GameScene extends Phaser.Scene {
  private playerObjects: Phaser.GameObjects.Container[] = [];

  private statusText?: Phaser.GameObjects.Text;
  private countText?: Phaser.GameObjects.Text;
  private shooterText?: Phaser.GameObjects.Text;

  private currentShooter = -1;
  private countNumber = 0;
  private startIndex = -1;

  private countingTimer?: Phaser.Time.TimerEvent;
  private delayedNextCycle?: Phaser.Time.TimerEvent;

  private realtimeChannel: any;
  private applyingRemoteState = false;

  constructor() {
    super('GameScene');
  }

  create() {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, 38, 'പീരങ്കി', {
        fontFamily: 'Arial',
        fontSize: '42px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.shooterText = this.add
      .text(width / 2, 82, 'Preparing game...', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: '#4da3ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(width / 2, 112, '', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: '#bbbbbb',
      })
      .setOrigin(0.5);

    this.countText = this.add
      .text(width / 2, height - 48, '', {
        fontFamily: 'Arial',
        fontSize: '30px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.createPlayers();
    this.startRealtimeSync();

    void this.initializeFromRoom();
  }

  private async initializeFromRoom() {
    const room = await fetchGameRoom(roomCode);

    if (!room) {
      this.statusText?.setText('Room not found.');
      return;
    }

    const roomPlayers = Array.isArray(room.players)
      ? room.players
      : [];

    updatePlayersFromRoom(roomPlayers);

    for (let index = 0; index < players.length; index += 1) {
      this.updatePlayerVisual(index);
    }

    if (room.game_status === 'finished') {
      this.showFinishedState();
      return;
    }

    if (
      myPlayerId === 1 &&
      room.game_status === 'playing' &&
      !this.countingTimer &&
      !this.delayedNextCycle
    ) {
      this.startCounting();
    }
  }

  private createPlayers() {
    const positions = [
      [230, 190],
      [670, 190],
      [230, 315],
      [670, 315],
      [230, 440],
      [670, 440],
    ];

    players.forEach((player, index) => {
      const [x, y] = positions[index];

      const container = this.add.container(x, y);

      const background = this.add.rectangle(
        0,
        0,
        300,
        100,
        0x1b2229,
      );

      background.setStrokeStyle(2, 0x444c55);

      const name = this.add.text(
        -130,
        -35,
        player.name,
        {
          fontFamily: 'Arial',
          fontSize: '18px',
          color: '#ffffff',
          fontStyle: 'bold',
        },
      );

      const tower = this.add
        .text(
          0,
          5,
          towerStages[player.stage],
          {
            fontFamily: 'Arial',
            fontSize: '32px',
          },
        )
        .setOrigin(0.5);

      const stage = this.add
        .text(
          0,
          37,
          stageNames[player.stage],
          {
            fontFamily: 'Arial',
            fontSize: '13px',
            color: '#aaaaaa',
          },
        )
        .setOrigin(0.5);

      container.add([
        background,
        name,
        tower,
        stage,
      ]);

      container.setSize(300, 100);
      container.setInteractive(
        new Phaser.Geom.Rectangle(-150, -50, 300, 100),
        Phaser.Geom.Rectangle.Contains,
      );

      container.on('pointerdown', () => {
        this.shootPlayer(index);
      });

      this.playerObjects.push(container);
    });
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
    if (!gameState || !Array.isArray(gameState.players)) {
      return;
    }

    this.applyingRemoteState = true;

    updatePlayersFromRoom(gameState.players);

    for (let index = 0; index < players.length; index += 1) {
      this.updatePlayerVisual(index);
    }

    if (typeof gameState.current_shooter === 'number') {
      this.currentShooter = gameState.current_shooter;

      const shooter = players[this.currentShooter];

      if (shooter) {
        this.shooterText?.setText(
          `🎯 Shooter: ${shooter.name}`,
        );
      }
    }

    const remoteCount = Number(gameState.countdown);

    if (Number.isFinite(remoteCount)) {
      this.countNumber = remoteCount;
    }

    if (gameState.game_status === 'counting') {
      this.countText?.setText(
        `Count ${this.countNumber} / ${COUNT_TO}`,
      );

      this.statusText?.setText(
        'Counting through the players...',
      );

      this.shooterText?.setText(
        '🎲 Selecting the 10th player...',
      );
    }

    if (gameState.game_status === 'shooting') {
      this.countText?.setText(
        `Count ${COUNT_TO} / ${COUNT_TO}`,
      );

      const shooter = players[this.currentShooter];

      this.shooterText?.setText(
        shooter
          ? `🎯 Shooter: ${shooter.name}`
          : '🎯 Shooter selected',
      );

      if (myPlayerId === this.currentShooter + 1) {
        this.statusText?.setText(
          'You are the shooter — choose an active player.',
        );
      } else {
        this.statusText?.setText(
          'Waiting for the shooter...',
        );
      }
    }

    if (gameState.game_status === 'shot') {
      this.countText?.setText(
        `Count ${COUNT_TO} / ${COUNT_TO}`,
      );

      this.statusText?.setText(
        'Shot recorded. Starting next round...',
      );

      if (
        myPlayerId === 1 &&
        !this.delayedNextCycle &&
        !this.countingTimer
      ) {
        this.delayedNextCycle = this.time.delayedCall(
          900,
          () => {
            this.delayedNextCycle = undefined;

            if (!this.isGameFinished()) {
              this.startCounting();
            }
          },
        );
      }
    }

    if (gameState.game_status === 'finished') {
      this.countingTimer?.remove(false);
      this.countingTimer = undefined;
      this.delayedNextCycle?.remove(false);
      this.delayedNextCycle = undefined;
      this.showFinishedState();
    }

    this.applyingRemoteState = false;
  }

  private startCounting() {
    if (myPlayerId !== 1) {
      return;
    }

    if (this.countingTimer || this.delayedNextCycle) {
      return;
    }

    const aliveIndexes = players
      .map((player, index) => (player.alive ? index : -1))
      .filter((index) => index !== -1);

    if (aliveIndexes.length <= 1) {
      this.finishGame();
      return;
    }

    this.currentShooter = -1;
    this.startIndex = Phaser.Utils.Array.GetRandom(
      aliveIndexes,
    );
    this.countNumber = 0;

    this.shooterText?.setText(
      '🎲 Randomly selecting a starting player...',
    );

    this.statusText?.setText(
      `Start: ${players[this.startIndex].name}`,
    );

    this.countText?.setText(
      `Count 0 / ${COUNT_TO}`,
    );

    void syncGameState(
      null,
      0,
      'counting',
    );

    this.countingTimer = this.time.addEvent({
      delay: COUNTING_SPEED,
      repeat: COUNT_TO - 1,
      callback: () => {
        this.countNumber += 1;

        const currentIndex = this.getCountedPlayerIndex(
          this.startIndex,
          this.countNumber,
        );

        this.currentShooter = currentIndex;

        this.countText?.setText(
          `Count ${this.countNumber} / ${COUNT_TO}`,
        );

        this.statusText?.setText(
          `${this.countNumber}. ${players[currentIndex].name}`,
        );

        void syncGameState(
          currentIndex,
          this.countNumber,
          this.countNumber === COUNT_TO
            ? 'shooting'
            : 'counting',
        );

        if (this.countNumber < COUNT_TO) {
          this.shooterText?.setText(
            '🎲 Counting...',
          );
        } else {
          this.shooterText?.setText(
            `🎯 Shooter: ${players[currentIndex].name}`,
          );

          this.statusText?.setText(
            `${players[currentIndex].name} is the 10th player. Choose a target.`,
          );
        }
      },
    });

    // The timer runs exactly 10 callbacks. After the 10th count,
    // the callback above changes the state to 'shooting'.
    // We clear the reference here on the next game-state action.
  }

  private getCountedPlayerIndex(
    startIndex: number,
    count: number,
  ) {
    const aliveIndexes = players
      .map((player, index) => (player.alive ? index : -1))
      .filter((index) => index !== -1);

    if (aliveIndexes.length === 0) {
      return -1;
    }

    const startPosition = aliveIndexes.indexOf(
      startIndex,
    );

    const safeStartPosition =
      startPosition === -1 ? 0 : startPosition;

    const position =
      (safeStartPosition + count - 1) %
      aliveIndexes.length;

    return aliveIndexes[position];
  }

  private shootPlayer(index: number) {
    if (this.applyingRemoteState) {
      return;
    }

    if (myPlayerId !== this.currentShooter + 1) {
      this.statusText?.setText(
        'Only the selected shooter can shoot.',
      );
      return;
    }

    if (this.currentShooter < 0) {
      return;
    }

    if (index === this.currentShooter) {
      this.statusText?.setText(
        'You cannot shoot yourself!',
      );
      return;
    }

    const target = players[index];

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

    void this.recordShot(index);
  }

  private async recordShot(index: number) {
    const target = players[index];

    this.statusText?.setText(
      `${target.name} was shot!`,
    );

    const alivePlayers = players.filter(
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
      players.filter((player) => player.alive).length <= 1
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

    if (winner) {
      this.shooterText?.setText(
        `${winner.name} wins!`,
      );
    }

    this.statusText?.setText(
      'The game has ended.',
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

    tower.setText(
      towerStages[player.stage],
    );

    stage.setText(
      stageNames[player.stage],
    );

    container.setAlpha(
      player.alive ? 1 : 0.4,
    );
  }

  shutdown() {
    this.countingTimer?.remove(false);
    this.countingTimer = undefined;

    this.delayedNextCycle?.remove(false);
    this.delayedNextCycle = undefined;

    if (this.realtimeChannel) {
      void this.realtimeChannel.unsubscribe();
      this.realtimeChannel = undefined;
    }
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 900,
  height: 600,
  backgroundColor: '#101418',
  parent: 'game',

  scene: [
    MenuScene,
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
