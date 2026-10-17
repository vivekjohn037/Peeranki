import React from 'react';
import { ANIMAL_AVATARS, type AnimalAvatarId } from '../game/avatars';
import { MATCH_DURATIONS } from '../game/rules';
import { PeerankiAudio } from '../audio/PeerankiAudio';

interface OfflineSetupProps {
  playerCount: number;
  onPlayerCountChange: (count: number) => void;
  matchDuration: (typeof MATCH_DURATIONS)[number];
  onMatchDurationChange: (duration: (typeof MATCH_DURATIONS)[number]) => void;
  selectedAvatar: AnimalAvatarId;
  onAvatarSelect: (avatar: AnimalAvatarId) => void;
  onStartGame: () => void;
  onBack: () => void;
}

export const OfflineSetup: React.FC<OfflineSetupProps> = ({
  playerCount,
  onPlayerCountChange,
  matchDuration,
  onMatchDurationChange,
  selectedAvatar,
  onAvatarSelect,
  onStartGame,
  onBack,
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

      {/* Main Single-Screen Form Container */}
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
          padding: 'clamp(12px, 2vh, 20px) clamp(14px, 2.5vw, 24px)',
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
            paddingBottom: 'clamp(6px, 1.2vh, 12px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            marginBottom: 'clamp(8px, 1.4vh, 16px)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              PeerankiAudio.effect('click');
              onBack();
            }}
            style={{
              background: '#1e293b',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: '8px',
              color: '#ffffff',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              touchAction: 'manipulation',
            }}
          >
            ← BACK
          </button>

          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(15px, 2.2vh, 18px)',
              fontWeight: 800,
              color: '#fbbf24',
              letterSpacing: '0.5px',
            }}
          >
            🤖 OFFLINE BATTLE
          </h1>

          <div style={{ width: '40px' }} />
        </div>

        {/* Form Body - zero scroll */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'clamp(8px, 1.5vh, 16px)',
          }}
        >
          {/* 1. Choose Avatar */}
          <section>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 800,
                color: '#fbbf24',
                marginBottom: '6px',
                letterSpacing: '0.5px',
              }}
            >
              1. CHOOSE YOUR WARRIOR AVATAR
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '6px',
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
                      height: 'clamp(40px, 6vh, 52px)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.22)' : '#182029',
                      border: isSelected ? `2px solid ${av.color}` : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      boxShadow: isSelected ? `0 0 12px ${av.color}44` : 'none',
                      transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                      transition: 'all 0.15s ease',
                      touchAction: 'manipulation',
                    }}
                  >
                    <img
                      src={`/${av.svgPath}`}
                      alt={av.name}
                      style={{
                        width: 'clamp(24px, 3.5vh, 32px)',
                        height: 'clamp(24px, 3.5vh, 32px)',
                        objectFit: 'contain',
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Number of Players */}
          <section>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '6px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#fbbf24',
                  letterSpacing: '0.5px',
                }}
              >
                2. PLAYERS IN ARENA
              </span>
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 800,
                  color: '#38bdf8',
                }}
              >
                {playerCount} Players (You + {playerCount - 1} Bots)
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '6px',
                width: '100%',
              }}
            >
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                const isSelected = num === playerCount;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      PeerankiAudio.effect('click');
                      onPlayerCountChange(num);
                    }}
                    style={{
                      flex: '1 1 0',
                      height: 'clamp(34px, 4.5vh, 42px)',
                      backgroundColor: isSelected ? '#10b981' : '#1e293b',
                      border: isSelected ? '2px solid #34d399' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: '#ffffff',
                      fontSize: 'clamp(12px, 1.8vh, 15px)',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: isSelected ? '0 0 10px rgba(16, 185, 129, 0.45)' : 'none',
                      touchAction: 'manipulation',
                    }}
                  >
                    {num}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. Match Duration */}
          <section>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 800,
                color: '#fbbf24',
                marginBottom: '6px',
                letterSpacing: '0.5px',
              }}
            >
              3. MATCH DURATION
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '8px',
              }}
            >
              {MATCH_DURATIONS.map((minutes) => {
                const isSelected = minutes === matchDuration;
                return (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => {
                      PeerankiAudio.effect('click');
                      onMatchDurationChange(minutes);
                    }}
                    style={{
                      height: 'clamp(34px, 4.5vh, 40px)',
                      backgroundColor: isSelected ? '#2563eb' : '#1e293b',
                      border: isSelected ? '2px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: '#ffffff',
                      fontSize: 'clamp(11px, 1.5vh, 13px)',
                      fontWeight: 800,
                      cursor: 'pointer',
                      textAlign: 'center',
                      boxShadow: isSelected ? '0 0 10px rgba(37, 99, 235, 0.4)' : 'none',
                      touchAction: 'manipulation',
                    }}
                  >
                    ⏱️ {minutes}m
                  </button>
                );
              })}
            </div>
          </section>

          {/* Start Game Action */}
          <button
            type="button"
            onClick={() => {
              PeerankiAudio.effect('select');
              onStartGame();
            }}
            style={{
              marginTop: '4px',
              padding: 'clamp(10px, 1.8vh, 16px)',
              backgroundColor: '#10b981',
              border: 'none',
              borderRadius: '12px',
              color: '#ffffff',
              fontSize: 'clamp(14px, 2vh, 17px)',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(16, 185, 129, 0.4)',
              transition: 'transform 0.12s',
              touchAction: 'manipulation',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
          >
            ⚔️ START BATTLE NOW
          </button>
        </div>
      </main>
    </div>
  );
};
