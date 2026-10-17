import React from 'react';
import { ANIMAL_AVATARS, type AnimalAvatarId } from '../game/avatars';
import { PeerankiAudio } from '../audio/PeerankiAudio';

interface MainMenuProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  selectedAvatar: AnimalAvatarId;
  onAvatarSelect: (avatar: AnimalAvatarId) => void;
  onStartOffline: () => void;
  onStartOnline: () => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
  onOpenExit: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  playerName,
  onPlayerNameChange,
  selectedAvatar,
  onAvatarSelect,
  onStartOffline,
  onStartOnline,
  onOpenSettings,
  onOpenGuide,
  onOpenExit,
  isMuted,
  onToggleMute,
}) => {
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
        background: 'radial-gradient(circle at 50% 15%, rgba(40, 120, 255, 0.18) 0%, transparent 65%), #0b0f15',
        backgroundImage: 'radial-gradient(circle at 50% 15%, rgba(40, 120, 255, 0.18) 0%, transparent 65%), url(/assets/background/menu_background.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Background scrim for contrast */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(11, 15, 21, 0.82)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {/* Header bar controls */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'max(8px, env(safe-area-inset-top, 8px)) 14px 6px',
          zIndex: 10,
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          onClick={onToggleMute}
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
          style={{
            background: isMuted ? 'rgba(130, 39, 39, 0.9)' : 'rgba(30, 41, 59, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            borderRadius: '8px',
            color: '#ffffff',
            padding: '5px 10px',
            fontSize: '14px',
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            touchAction: 'manipulation',
          }}
        >
          <span>{isMuted ? '🔇' : '🔊'}</span>
        </button>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            style={{
              background: 'rgba(30, 41, 59, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: '8px',
              color: '#ffffff',
              padding: '5px 10px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              touchAction: 'manipulation',
            }}
          >
            <span>⚙️</span>
            <span className="pk-hide-on-tiny-screen">SETTINGS</span>
          </button>
          <button
            type="button"
            onClick={onOpenGuide}
            title="How to Play Guide"
            style={{
              background: 'rgba(30, 41, 59, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: '8px',
              color: '#ffffff',
              padding: '5px 10px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              touchAction: 'manipulation',
            }}
          >
            <span>📖</span>
            <span className="pk-hide-on-tiny-screen">GUIDE</span>
          </button>
          <button
            type="button"
            onClick={onOpenExit}
            title="Exit Game"
            style={{
              background: 'rgba(155, 48, 48, 0.85)',
              border: 'none',
              borderRadius: '8px',
              color: '#ffffff',
              padding: '5px 10px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              touchAction: 'manipulation',
            }}
          >
            <span>🚪</span>
            <span className="pk-hide-on-tiny-screen">EXIT</span>
          </button>
        </div>
      </header>

      {/* Main Single-Screen Responsive Layout */}
      <main
        style={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: '920px',
          height: '100%',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
          paddingTop: '44px',
          overflow: 'hidden',
        }}
      >
        <div
          className="pk-menu-grid-wrapper"
          style={{
            width: '100%',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'clamp(10px, 2vh, 24px)',
            maxHeight: 'calc(100% - 8px)',
            overflow: 'hidden',
          }}
        >
          {/* Card 1: Warrior Identity & Profile */}
          <section
            style={{
              flex: '1 1 300px',
              maxWidth: '420px',
              minWidth: '260px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              backgroundColor: 'rgba(20, 28, 38, 0.82)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '16px',
              padding: 'clamp(10px, 1.8vh, 20px) clamp(12px, 2vw, 20px)',
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
              boxSizing: 'border-box',
            }}
          >
            {/* Logo + Title Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: 'clamp(6px, 1.2vh, 14px)',
              }}
            >
              <div
                style={{
                  width: 'clamp(42px, 6vh, 60px)',
                  height: 'clamp(42px, 6vh, 60px)',
                  borderRadius: '50%',
                  background: 'rgba(40, 120, 255, 0.18)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 0 16px rgba(40, 120, 255, 0.35)',
                  flexShrink: 0,
                }}
              >
                <img
                  src="/assets/peeranki-logo.webp"
                  alt="Peeranki"
                  style={{ width: '80%', height: '80%', objectFit: 'contain' }}
                />
              </div>

              <div style={{ textAlign: 'left' }}>
                <h1
                  style={{
                    margin: 0,
                    fontSize: 'clamp(20px, 3vh, 26px)',
                    fontWeight: 900,
                    letterSpacing: '1px',
                    color: '#ffffff',
                    lineHeight: 1.1,
                  }}
                >
                  PEERANKI
                </h1>
                <p
                  style={{
                    margin: 0,
                    fontSize: 'clamp(10px, 1.3vh, 12px)',
                    color: '#94a3b8',
                    fontWeight: 600,
                  }}
                >
                  Kerala Strategy Battle
                </p>
              </div>
            </div>

            {/* Name Input */}
            <div style={{ width: '100%', marginBottom: 'clamp(8px, 1.5vh, 14px)' }}>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  color: '#fbbf24',
                  letterSpacing: '0.6px',
                  marginBottom: '4px',
                  textAlign: 'left',
                }}
              >
                YOUR PLAYER NAME
              </div>
              <input
                type="text"
                value={playerName}
                maxLength={16}
                placeholder="Enter player name"
                onChange={(e) => onPlayerNameChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: 'clamp(6px, 1vh, 10px) 12px',
                  backgroundColor: '#182029',
                  border: '1.5px solid #455569',
                  borderRadius: '8px',
                  color: '#ffffff',
                  fontSize: 'clamp(13px, 1.6vh, 15px)',
                  fontWeight: 700,
                  textAlign: 'center',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>

            {/* Avatar Selector */}
            <div style={{ width: '100%' }}>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  color: '#fbbf24',
                  letterSpacing: '0.6px',
                  marginBottom: '6px',
                  textAlign: 'left',
                }}
              >
                CHOOSE WARRIOR AVATAR
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '6px',
                  width: '100%',
                }}
              >
                {ANIMAL_AVATARS.map((av) => {
                  const isSelected = av.id === selectedAvatar;
                  return (
                    <button
                      key={av.id}
                      type="button"
                      onClick={() => {
                        PeerankiAudio.effect('click');
                        onAvatarSelect(av.id);
                      }}
                      title={`${av.name} (${av.title})`}
                      style={{
                        flex: '1 1 0',
                        height: 'clamp(38px, 5.2vh, 48px)',
                        borderRadius: '10px',
                        padding: 0,
                        background: isSelected ? 'rgba(56, 189, 248, 0.25)' : '#182029',
                        border: isSelected
                          ? `2px solid ${av.color}`
                          : '1px solid rgba(255, 255, 255, 0.12)',
                        boxShadow: isSelected ? `0 0 10px ${av.color}66` : 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transform: isSelected ? 'scale(1.06)' : 'scale(1)',
                        transition: 'all 0.15s ease',
                        touchAction: 'manipulation',
                      }}
                    >
                      <img
                        src={`/${av.svgPath}`}
                        alt={av.name}
                        style={{
                          width: 'clamp(24px, 3.2vh, 32px)',
                          height: 'clamp(24px, 3.2vh, 32px)',
                          objectFit: 'contain',
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Card 2: Game Mode Launcher */}
          <section
            style={{
              flex: '1 1 300px',
              maxWidth: '420px',
              minWidth: '260px',
              display: 'flex',
              flexDirection: 'column',
              gap: 'clamp(8px, 1.4vh, 14px)',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                backgroundColor: 'rgba(20, 28, 38, 0.82)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '16px',
                padding: 'clamp(10px, 1.8vh, 18px)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'clamp(8px, 1.4vh, 12px)',
                boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#fbbf24',
                  letterSpacing: '0.8px',
                  textAlign: 'center',
                }}
              >
                SELECT BATTLE ARENA
              </div>

              {/* Offline Battle Button */}
              <button
                type="button"
                onClick={() => {
                  PeerankiAudio.effect('select');
                  onStartOffline();
                }}
                style={{
                  padding: 'clamp(10px, 1.8vh, 16px) 16px',
                  backgroundColor: '#10b981',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#ffffff',
                  fontSize: 'clamp(14px, 1.8vh, 17px)',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: '0 6px 18px rgba(16, 185, 129, 0.35)',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                  touchAction: 'manipulation',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}>
                  <span style={{ fontSize: 'clamp(18px, 2.4vh, 22px)' }}>🤖</span>
                  <div>
                    <div style={{ lineHeight: 1.1 }}>OFFLINE BATTLE</div>
                    <div style={{ fontSize: '11px', fontWeight: 600, opacity: 0.9 }}>
                      Play vs Smart Bots · 2–10 Players
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: '18px', opacity: 0.8 }}>›</span>
              </button>

              {/* Online Multiplayer Button */}
              <button
                type="button"
                onClick={() => {
                  PeerankiAudio.effect('select');
                  onStartOnline();
                }}
                style={{
                  padding: 'clamp(10px, 1.8vh, 16px) 16px',
                  backgroundColor: '#2563eb',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#ffffff',
                  fontSize: 'clamp(14px, 1.8vh, 17px)',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  boxShadow: '0 6px 18px rgba(37, 99, 235, 0.35)',
                  transition: 'transform 0.12s, box-shadow 0.12s',
                  touchAction: 'manipulation',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}>
                  <span style={{ fontSize: 'clamp(18px, 2.4vh, 22px)' }}>🌐</span>
                  <div>
                    <div style={{ lineHeight: 1.1 }}>ONLINE MULTIPLAYER</div>
                    <div style={{ fontSize: '11px', fontWeight: 600, opacity: 0.9 }}>
                      Rooms, Matchmaking & RPS Duels
                    </div>
                  </div>
                </div>
                <span style={{ fontSize: '18px', opacity: 0.8 }}>›</span>
              </button>

              {/* Quick Info Bar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-around',
                  paddingTop: '4px',
                  fontSize: '11px',
                  color: '#94a3b8',
                  fontWeight: 600,
                }}
              >
                <span>🏰 3 Tower Stages</span>
                <span>•</span>
                <span>⚔️ 5 Weapons</span>
                <span>•</span>
                <span>⚡ Real-Time</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};
