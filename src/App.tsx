import React, { useState, useEffect } from 'react';
import { MainMenu } from './components/MainMenu';
import { OfflineSetup } from './components/OfflineSetup';
import { OnlineMode } from './components/OnlineMode';
import { RoomLobby } from './components/RoomLobby';
import { BattleScreen, type BattlePlayer } from './components/BattleScreen';
import { HowToPlayModal } from './components/HowToPlayModal';
import { ExitGameModal } from './components/ExitGameModal';
import { SettingsModal } from './components/SettingsModal';
import { DuelLogModal } from './components/DuelLogModal';
import { MultiplayerErrorModal } from './components/MultiplayerErrorModal';
import {
  getSelectedAvatarId,
  setSelectedAvatarId,
  getBotAvatarId,
  type AnimalAvatarId,
} from './game/avatars';
import { MATCH_DURATIONS } from './game/rules';
import { PeerankiAudio } from './audio/PeerankiAudio';
import {
  createPrivateRoom,
  joinRoom,
  findOrCreateRandomRoom,
  leaveRoom,
} from './supabase';
import './ui/styles.css';

type Screen = 'menu' | 'offline-setup' | 'online-mode' | 'lobby' | 'battle';

export const App: React.FC = () => {
  // Navigation
  const [currentScreen, setCurrentScreen] = useState<Screen>('menu');

  // Player Profile
  const [playerName, setPlayerName] = useState(() => {
    try {
      const stored = localStorage.getItem('peeranki-player-name')?.trim();
      if (stored) return stored.slice(0, 16);
      const s = JSON.parse(localStorage.getItem('peeranki-settings') ?? '{}');
      if (s.playerName?.trim()) return s.playerName.trim().slice(0, 16);
    } catch {
      // ignore
    }
    return 'Player';
  });

  const [selectedAvatar, setSelectedAvatar] = useState<AnimalAvatarId>(() => getSelectedAvatarId());

  // Offline Setup state
  const [playerCount, setPlayerCount] = useState(3);
  const [matchDuration, setMatchDuration] = useState<(typeof MATCH_DURATIONS)[number]>(5);

  // Online Multiplayer state
  const [roomCode, setRoomCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [lobbyPlayers, setLobbyPlayers] = useState<
    { id: number; name: string; avatar: string; connected: boolean; isHost?: boolean }[]
  >([]);
  const [isOnlineLoading, setIsOnlineLoading] = useState(false);
  const [sessionId] = useState(() => {
    let id = sessionStorage.getItem('peeranki-session-id');
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('peeranki-session-id', id);
    }
    return id;
  });

  // Active Battle players
  const [battlePlayers, setBattlePlayers] = useState<BattlePlayer[]>([]);
  const [isOnlineMatch, setIsOnlineMatch] = useState(false);

  // Global Modals
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [duelLogOpen, setDuelLogOpen] = useState(false);
  const [mpError, setMpError] = useState<{ title: string; error: unknown } | null>(null);

  // Audio State
  const [isMuted, setIsMuted] = useState(PeerankiAudio.isMuted());

  useEffect(() => {
    // Start music on first click/action
    PeerankiAudio.startMusic();
    const handleStorage = () => setIsMuted(PeerankiAudio.isMuted());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handlePlayerNameChange = (name: string) => {
    const clean = name.slice(0, 16);
    setPlayerName(clean);
    try {
      localStorage.setItem('peeranki-player-name', clean);
      const s = JSON.parse(localStorage.getItem('peeranki-settings') ?? '{}');
      s.playerName = clean;
      localStorage.setItem('peeranki-settings', JSON.stringify(s));
    } catch {
      // ignore
    }
  };

  const handleAvatarSelect = (avatar: AnimalAvatarId) => {
    setSelectedAvatar(avatar);
    setSelectedAvatarId(avatar);
  };

  const handleToggleMute = () => {
    const next = PeerankiAudio.toggleMute();
    setIsMuted(next);
  };

  // 1. Start Offline Match
  const handleStartOfflineMatch = () => {
    const created: BattlePlayer[] = [
      {
        id: 1,
        name: playerName || 'Player',
        avatar: selectedAvatar,
        stage: 0,
        alive: true,
        connected: true,
        weapons: ['gun'],
        eliminationPoints: 0,
        shieldDisabledRound: -1,
        isBot: false,
      },
    ];

    for (let i = 2; i <= playerCount; i++) {
      created.push({
        id: i,
        name: `Bot ${i - 1}`,
        avatar: getBotAvatarId(i - 1),
        stage: 0,
        alive: true,
        connected: true,
        weapons: ['gun'],
        eliminationPoints: 0,
        shieldDisabledRound: -1,
        isBot: true,
      });
    }

    setBattlePlayers(created);
    setIsOnlineMatch(false);
    setCurrentScreen('battle');
  };

  // 2. Online: Create Private Room
  const handleCreateRoom = async (capacity: number, duration: (typeof MATCH_DURATIONS)[number]) => {
    setIsOnlineLoading(true);
    try {
      const room = await createPrivateRoom(capacity, sessionId, playerName || 'Player');
      setRoomCode(room.room_code);
      setMatchDuration(duration);
      setIsHost(true);
      setLobbyPlayers([
        {
          id: 1,
          name: playerName || 'Player',
          avatar: selectedAvatar,
          connected: true,
          isHost: true,
        },
      ]);
      setPlayerCount(capacity);
      setCurrentScreen('lobby');
    } catch (err) {
      setMpError({ title: 'Room Creation Failed', error: err });
    } finally {
      setIsOnlineLoading(false);
    }
  };

  // 3. Online: Join Room
  const handleJoinRoom = async (code: string) => {
    setIsOnlineLoading(true);
    try {
      const res = await joinRoom(code, playerName || 'Player', sessionId);
      setRoomCode(code);
      setIsHost(false);
      setLobbyPlayers(
        res.players.map((p: any, idx: number) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar || getBotAvatarId(idx),
          connected: p.connected,
          isHost: idx === 0,
        })),
      );
      setPlayerCount(res.max_players);
      setCurrentScreen('lobby');
    } catch (err) {
      setMpError({ title: 'Unable to Join Room', error: err });
    } finally {
      setIsOnlineLoading(false);
    }
  };

  // 4. Online: Quick Match
  const handleQuickMatch = async () => {
    setIsOnlineLoading(true);
    try {
      const res = await findOrCreateRandomRoom(4, sessionId, playerName || 'Player');
      setRoomCode(res.room_code);
      setIsHost(res.host_session_id === sessionId);
      setLobbyPlayers(
        res.players.map((p: any, idx: number) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar || getBotAvatarId(idx),
          connected: p.connected,
          isHost: p.session_id === res.host_session_id,
        })),
      );
      setPlayerCount(res.max_players);
      setCurrentScreen('lobby');
    } catch (err) {
      setMpError({ title: 'Quick Match Failed', error: err });
    } finally {
      setIsOnlineLoading(false);
    }
  };

  // 5. Start Online Match from Lobby
  const handleStartOnlineMatch = (fillWithBots: boolean) => {
    const list: BattlePlayer[] = lobbyPlayers.map((p, idx) => ({
      id: p.id,
      name: p.name,
      avatar: (p.avatar as AnimalAvatarId) || getBotAvatarId(idx),
      stage: 0,
      alive: true,
      connected: p.connected,
      weapons: ['gun'],
      eliminationPoints: 0,
      shieldDisabledRound: -1,
      isBot: false,
    }));

    if (fillWithBots && list.length < playerCount) {
      const needed = playerCount - list.length;
      for (let i = 1; i <= needed; i++) {
        const botId = list.length + 1;
        list.push({
          id: botId,
          name: `Bot ${botId - 1}`,
          avatar: getBotAvatarId(botId - 1),
          stage: 0,
          alive: true,
          connected: true,
          weapons: ['gun'],
          eliminationPoints: 0,
          shieldDisabledRound: -1,
          isBot: true,
        });
      }
    }

    setBattlePlayers(list);
    setIsOnlineMatch(true);
    setCurrentScreen('battle');
  };

  // 6. Leave Room / Leave Match
  const handleLeaveLobby = async () => {
    if (roomCode) {
      try {
        await leaveRoom(roomCode, sessionId);
      } catch {
        // ignore
      }
    }
    setRoomCode('');
    setCurrentScreen('menu');
  };

  const handleLeaveMatch = async () => {
    if (isOnlineMatch && roomCode) {
      try {
        await leaveRoom(roomCode, sessionId);
      } catch {
        // ignore
      }
    }
    setCurrentScreen('menu');
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* 1. Main Menu */}
      {currentScreen === 'menu' && (
        <MainMenu
          playerName={playerName}
          onPlayerNameChange={handlePlayerNameChange}
          selectedAvatar={selectedAvatar}
          onAvatarSelect={handleAvatarSelect}
          onStartOffline={() => setCurrentScreen('offline-setup')}
          onStartOnline={() => setCurrentScreen('online-mode')}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenGuide={() => setHowToPlayOpen(true)}
          onOpenExit={() => setExitModalOpen(true)}
          isMuted={isMuted}
          onToggleMute={handleToggleMute}
        />
      )}

      {/* 2. Offline Setup */}
      {currentScreen === 'offline-setup' && (
        <OfflineSetup
          playerCount={playerCount}
          onPlayerCountChange={setPlayerCount}
          matchDuration={matchDuration}
          onMatchDurationChange={setMatchDuration}
          selectedAvatar={selectedAvatar}
          onAvatarSelect={handleAvatarSelect}
          onStartGame={handleStartOfflineMatch}
          onBack={() => setCurrentScreen('menu')}
        />
      )}

      {/* 3. Online Options */}
      {currentScreen === 'online-mode' && (
        <OnlineMode
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onQuickMatch={handleQuickMatch}
          onBack={() => setCurrentScreen('menu')}
          isLoading={isOnlineLoading}
        />
      )}

      {/* 4. Room Lobby */}
      {currentScreen === 'lobby' && (
        <RoomLobby
          roomCode={roomCode}
          players={lobbyPlayers}
          maxPlayers={playerCount}
          isHost={isHost}
          matchDuration={matchDuration}
          onStartMatch={handleStartOnlineMatch}
          onLeaveRoom={handleLeaveLobby}
        />
      )}

      {/* 5. Live Battle Screen */}
      {currentScreen === 'battle' && (
        <BattleScreen
          initialPlayers={battlePlayers}
          localPlayerId={1}
          matchDurationMinutes={matchDuration}
          isOnline={isOnlineMatch}
          roomCode={roomCode}
          onLeaveMatch={handleLeaveMatch}
          onOpenGuide={() => setHowToPlayOpen(true)}
          onOpenDuelLog={() => setDuelLogOpen(true)}
        />
      )}

      {/* Modals */}
      <HowToPlayModal isOpen={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />
      <ExitGameModal isOpen={exitModalOpen} onClose={() => setExitModalOpen(false)} />
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        playerName={playerName}
        onPlayerNameChange={handlePlayerNameChange}
      />
      <DuelLogModal isOpen={duelLogOpen} onClose={() => setDuelLogOpen(false)} />
      {mpError && (
        <MultiplayerErrorModal
          isOpen={Boolean(mpError)}
          onClose={() => setMpError(null)}
          title={mpError.title}
          error={mpError.error}
          roomCode={roomCode}
        />
      )}
    </div>
  );
};
