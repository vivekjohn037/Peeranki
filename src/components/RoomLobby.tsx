import React, { useState } from 'react';
import { getAvatarDef } from '../game/avatars';
import { PeerankiAudio } from '../audio/PeerankiAudio';

interface LobbyPlayer {
  id: number;
  name: string;
  avatar: string;
  connected: boolean;
  isHost?: boolean;
}

interface RoomLobbyProps {
  roomCode: string;
  players: LobbyPlayer[];
  maxPlayers: number;
  isHost: boolean;
  matchDuration: number;
  onStartMatch: (fillWithBots: boolean) => void;
  onLeaveRoom: () => void;
}

export const RoomLobby: React.FC<RoomLobbyProps> = ({
  roomCode,
  players,
  maxPlayers,
  isHost,
  matchDuration,
  onStartMatch,
  onLeaveRoom,
}) => {
  const [copied, setCopied] = useState(false);
  const [fillBots, setFillBots] = useState(true);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const connectedCount = players.filter((p) => p.connected).length;
  const canStart = isHost && (connectedCount >= 2 || fillBots);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'env(safe-area-inset-top, 8px) 12px env(safe-area-inset-bottom, 8px) 12px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: 'radial-gradient(circle at 50% 15%, rgba(40, 120, 255, 0.16) 0%, transparent 65%), #0b0f15',
        backgroundImage: 'radial-gradient(circle at 50% 15%, rgba(40, 120, 255, 0.16) 0%, transparent 65%), url(/assets/background/menu_background.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(11, 15, 21, 0.82)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Main Single-Screen Container */}
      <main
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: '580px',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'rgba(20, 28, 38, 0.88)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '18px',
          padding: 'clamp(10px, 1.8vh, 18px) clamp(12px, 2vw, 20px)',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.55)',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 'clamp(6px, 1vh, 10px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            marginBottom: 'clamp(6px, 1.2vh, 12px)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              PeerankiAudio.effect('click');
              onLeaveRoom();
            }}
            style={{
              background: '#9b3030',
              border: 'none',
              borderRadius: '8px',
              color: '#ffffff',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
          >
            LEAVE
          </button>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '12px', fontWeight: 800, color: '#fbbf24', letterSpacing: '0.5px' }}>
              MULTIPLAYER LOBBY
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              {connectedCount} of {maxPlayers} Players Joined
            </div>
          </div>

          <span style={{ fontSize: '12px', fontWeight: 700, color: '#38bdf8' }}>
            ⏱️ {matchDuration}m
          </span>
        </div>

        {/* Room Code Banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '10px',
            padding: '6px 12px',
            marginBottom: 'clamp(6px, 1.2vh, 10px)',
          }}
        >
          <div>
            <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 700 }}>ROOM CODE: </span>
            <span style={{ fontSize: 'clamp(14px, 2vh, 18px)', fontWeight: 900, color: '#38bdf8', letterSpacing: '2px' }}>
              {roomCode}
            </span>
          </div>

          <button
            type="button"
            onClick={handleCopyCode}
            style={{
              backgroundColor: copied ? '#10b981' : '#2563eb',
              border: 'none',
              borderRadius: '6px',
              color: '#ffffff',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
          >
            {copied ? '✓ COPIED' : '📋 COPY'}
          </button>
        </div>

        {/* Player Roster Grid - perfectly compact */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: maxPlayers > 4 ? 'repeat(auto-fill, minmax(110px, 1fr))' : 'repeat(2, 1fr)',
            gap: '6px',
            flex: '1 1 auto',
            minHeight: '0',
            overflow: 'hidden',
            marginBottom: 'clamp(6px, 1.2vh, 10px)',
          }}
        >
          {Array.from({ length: maxPlayers }).map((_, idx) => {
            const player = players[idx];
            if (player) {
              const avatarDef = getAvatarDef(player.avatar);
              return (
                <div
                  key={player.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 8px',
                    backgroundColor: '#182230',
                    border: `1.5px solid ${player.isHost ? '#fbbf24' : '#334155'}`,
                    borderRadius: '8px',
                    minWidth: 0,
                  }}
                >
                  <img
                    src={`/${avatarDef.svgPath}`}
                    alt={avatarDef.name}
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      border: `1.5px solid ${avatarDef.color}`,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#ffffff',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {player.name}
                    </div>
                    <div style={{ fontSize: '9px', fontWeight: 800, color: player.isHost ? '#fbbf24' : '#10b981' }}>
                      {player.isHost ? '👑 HOST' : '✓ READY'}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`empty-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px 8px',
                  backgroundColor: 'rgba(15, 23, 42, 0.4)',
                  border: '1px dashed rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: '#64748b',
                  fontSize: '10.5px',
                  fontWeight: 600,
                }}
              >
                Slot {idx + 1}: Waiting...
              </div>
            );
          })}
        </div>

        {/* Host Controls or Guest Status */}
        {isHost ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '11px',
                color: '#cbd5e1',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={fillBots}
                onChange={(e) => setFillBots(e.target.checked)}
                style={{ accentColor: '#10b981', cursor: 'pointer' }}
              />
              <span>Fill remaining empty slots with intelligent bots</span>
            </label>

            <button
              type="button"
              disabled={!canStart}
              onClick={() => {
                PeerankiAudio.effect('select');
                onStartMatch(fillBots);
              }}
              style={{
                padding: 'clamp(10px, 1.8vh, 15px)',
                backgroundColor: canStart ? '#10b981' : '#334155',
                border: 'none',
                borderRadius: '12px',
                color: '#ffffff',
                fontSize: 'clamp(13px, 1.8vh, 16px)',
                fontWeight: 800,
                cursor: canStart ? 'pointer' : 'not-allowed',
                boxShadow: canStart ? '0 6px 18px rgba(16, 185, 129, 0.4)' : 'none',
                touchAction: 'manipulation',
              }}
            >
              ⚔️ LAUNCH MATCH NOW
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: '10px',
              backgroundColor: 'rgba(37, 99, 235, 0.15)',
              border: '1px solid rgba(37, 99, 235, 0.3)',
              borderRadius: '10px',
              textAlign: 'center',
              fontSize: '12px',
              fontWeight: 700,
              color: '#93c5fd',
            }}
          >
            ⏳ Waiting for room host to start the battle...
          </div>
        )}
      </main>
    </div>
  );
};
