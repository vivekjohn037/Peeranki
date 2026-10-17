import React, { useState } from 'react';
import { MATCH_DURATIONS } from '../game/rules';
import { PeerankiAudio } from '../audio/PeerankiAudio';

interface OnlineModeProps {
  onCreateRoom: (maxPlayers: number, duration: (typeof MATCH_DURATIONS)[number]) => void;
  onJoinRoom: (roomCode: string) => void;
  onQuickMatch: () => void;
  onBack: () => void;
  isLoading: boolean;
}

export const OnlineMode: React.FC<OnlineModeProps> = ({
  onCreateRoom,
  onJoinRoom,
  onQuickMatch,
  onBack,
  isLoading,
}) => {
  const [activeTab, setActiveTab] = useState<'options' | 'create' | 'join'>('options');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [matchDuration, setMatchDuration] = useState<(typeof MATCH_DURATIONS)[number]>(5);
  const [joinCodeInput, setJoinCodeInput] = useState('');

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = joinCodeInput.trim().toUpperCase();
    if (clean.length === 6) {
      PeerankiAudio.effect('select');
      onJoinRoom(clean);
    }
  };

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
          maxWidth: '540px',
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
        {/* Header Bar */}
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
              if (activeTab === 'options') {
                onBack();
              } else {
                setActiveTab('options');
              }
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
            ← {activeTab === 'options' ? 'MAIN MENU' : 'BACK'}
          </button>

          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(15px, 2.2vh, 18px)',
              fontWeight: 800,
              color: '#38bdf8',
              letterSpacing: '0.5px',
            }}
          >
            🌐 ONLINE ARENA
          </h1>

          <div style={{ width: '40px' }} />
        </div>

        {/* Tab 1: Mode Options */}
        {activeTab === 'options' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'clamp(8px, 1.4vh, 14px)',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#fbbf24', letterSpacing: '0.8px' }}>
                SELECT MULTIPLAYER MODE
              </div>
            </div>

            {/* Create Room */}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                PeerankiAudio.effect('select');
                setActiveTab('create');
              }}
              style={{
                padding: 'clamp(10px, 1.6vh, 15px) 14px',
                backgroundColor: '#2563eb',
                border: 'none',
                borderRadius: '12px',
                color: '#ffffff',
                fontSize: 'clamp(13px, 1.8vh, 15px)',
                fontWeight: 800,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
                opacity: isLoading ? 0.6 : 1,
                touchAction: 'manipulation',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}>
                <span style={{ fontSize: '20px' }}>🏠</span>
                <div>
                  <div style={{ lineHeight: 1.1 }}>CREATE PRIVATE ROOM</div>
                  <div style={{ fontSize: '10.5px', fontWeight: 600, opacity: 0.85 }}>
                    Generate a 6-digit code for friends
                  </div>
                </div>
              </div>
              <span>›</span>
            </button>

            {/* Join Room */}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                PeerankiAudio.effect('select');
                setActiveTab('join');
              }}
              style={{
                padding: 'clamp(10px, 1.6vh, 15px) 14px',
                backgroundColor: '#7c3aed',
                border: 'none',
                borderRadius: '12px',
                color: '#ffffff',
                fontSize: 'clamp(13px, 1.8vh, 15px)',
                fontWeight: 800,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 14px rgba(124, 58, 237, 0.35)',
                opacity: isLoading ? 0.6 : 1,
                touchAction: 'manipulation',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}>
                <span style={{ fontSize: '20px' }}>🔑</span>
                <div>
                  <div style={{ lineHeight: 1.1 }}>JOIN ROOM WITH CODE</div>
                  <div style={{ fontSize: '10.5px', fontWeight: 600, opacity: 0.85 }}>
                    Enter an existing match room code
                  </div>
                </div>
              </div>
              <span>›</span>
            </button>

            {/* Quick Match */}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                PeerankiAudio.effect('select');
                onQuickMatch();
              }}
              style={{
                padding: 'clamp(10px, 1.6vh, 15px) 14px',
                backgroundColor: '#10b981',
                border: 'none',
                borderRadius: '12px',
                color: '#ffffff',
                fontSize: 'clamp(13px, 1.8vh, 15px)',
                fontWeight: 800,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                opacity: isLoading ? 0.6 : 1,
                touchAction: 'manipulation',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left' }}>
                <span style={{ fontSize: '20px' }}>⚡</span>
                <div>
                  <div style={{ lineHeight: 1.1 }}>QUICK MATCHMAKING</div>
                  <div style={{ fontSize: '10.5px', fontWeight: 600, opacity: 0.85 }}>
                    Instant 4-player worldwide room
                  </div>
                </div>
              </div>
              <span>›</span>
            </button>

            {isLoading && (
              <div style={{ textAlign: 'center', color: '#38bdf8', fontSize: '12px', fontWeight: 700 }}>
                ⏳ Connecting to match server...
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Create Private Room Form */}
        {activeTab === 'create' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'clamp(8px, 1.5vh, 14px)',
            }}
          >
            {/* Player capacity */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#fbbf24' }}>
                  MAX ARENA PLAYERS
                </span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#38bdf8' }}>
                  {maxPlayers} Players
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                  const isSelected = num === maxPlayers;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        PeerankiAudio.effect('click');
                        setMaxPlayers(num);
                      }}
                      style={{
                        flex: '1 1 0',
                        height: 'clamp(32px, 4.2vh, 38px)',
                        backgroundColor: isSelected ? '#2563eb' : '#1e293b',
                        border: isSelected ? '2px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: '#ffffff',
                        fontSize: 'clamp(11px, 1.6vh, 14px)',
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: isSelected ? '0 0 10px rgba(37, 99, 235, 0.45)' : 'none',
                        touchAction: 'manipulation',
                      }}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Duration */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#fbbf24', marginBottom: '6px' }}>
                MATCH DURATION
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {MATCH_DURATIONS.map((dur) => {
                  const isSelected = dur === matchDuration;
                  return (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => {
                        PeerankiAudio.effect('click');
                        setMatchDuration(dur);
                      }}
                      style={{
                        height: 'clamp(32px, 4.2vh, 38px)',
                        backgroundColor: isSelected ? '#10b981' : '#1e293b',
                        border: isSelected ? '2px solid #34d399' : '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '8px',
                        color: '#ffffff',
                        fontSize: 'clamp(11px, 1.5vh, 13px)',
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: isSelected ? '0 0 10px rgba(16, 185, 129, 0.45)' : 'none',
                        touchAction: 'manipulation',
                      }}
                    >
                      ⏱️ {dur}m
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Create Action */}
            <button
              type="button"
              disabled={isLoading}
              onClick={() => {
                PeerankiAudio.effect('select');
                onCreateRoom(maxPlayers, matchDuration);
              }}
              style={{
                marginTop: '4px',
                padding: 'clamp(10px, 1.8vh, 15px)',
                backgroundColor: '#2563eb',
                border: 'none',
                borderRadius: '12px',
                color: '#ffffff',
                fontSize: 'clamp(13px, 1.8vh, 16px)',
                fontWeight: 800,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 18px rgba(37, 99, 235, 0.4)',
                opacity: isLoading ? 0.6 : 1,
                touchAction: 'manipulation',
              }}
            >
              {isLoading ? 'CREATING ROOM...' : '🚀 CREATE ROOM NOW'}
            </button>
          </div>
        )}

        {/* Tab 3: Join Room Form */}
        {activeTab === 'join' && (
          <form
            onSubmit={handleJoinSubmit}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'clamp(8px, 1.6vh, 16px)',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#fbbf24',
                  letterSpacing: '0.6px',
                  marginBottom: '6px',
                }}
              >
                ENTER 6-CHARACTER ROOM CODE
              </div>
              <input
                type="text"
                value={joinCodeInput}
                maxLength={6}
                placeholder="e.g. 7X9A2B"
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                style={{
                  width: '100%',
                  padding: 'clamp(8px, 1.4vh, 14px)',
                  backgroundColor: '#182029',
                  border: '2px solid #7c3aed',
                  borderRadius: '10px',
                  color: '#ffffff',
                  fontSize: 'clamp(20px, 3vh, 26px)',
                  fontWeight: 900,
                  textAlign: 'center',
                  letterSpacing: '4px',
                  boxSizing: 'border-box',
                  outline: 'none',
                  textTransform: 'uppercase',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || joinCodeInput.trim().length !== 6}
              style={{
                padding: 'clamp(10px, 1.8vh, 15px)',
                backgroundColor: '#7c3aed',
                border: 'none',
                borderRadius: '12px',
                color: '#ffffff',
                fontSize: 'clamp(13px, 1.8vh, 16px)',
                fontWeight: 800,
                cursor: isLoading || joinCodeInput.trim().length !== 6 ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 18px rgba(124, 58, 237, 0.4)',
                opacity: isLoading || joinCodeInput.trim().length !== 6 ? 0.5 : 1,
                touchAction: 'manipulation',
              }}
            >
              {isLoading ? 'JOINING ROOM...' : '🔑 JOIN ARENA NOW'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
};
