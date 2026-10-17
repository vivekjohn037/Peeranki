import React, { useState, useEffect } from 'react';
import { PeerankiAudio, SOUNDTRACK_TRACKS } from '../audio/PeerankiAudio';
import { soundEffectManager } from '../game/SoundEffectManager';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  playerName: string;
  onPlayerNameChange: (name: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  playerName,
  onPlayerNameChange,
}) => {
  const [musicVol, setMusicVol] = useState(70);
  const [sfxVol, setSfxVol] = useState(80);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<1 | 2>(1);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (isOpen) {
      try {
        const stored = JSON.parse(localStorage.getItem('peeranki-settings') ?? '{}');
        if (typeof stored.musicVolume === 'number') setMusicVol(stored.musicVolume);
        if (typeof stored.soundEffectsVolume === 'number') setSfxVol(stored.soundEffectsVolume);
        setIsMuted(PeerankiAudio.isMuted());
        setCurrentTrack(PeerankiAudio.getCurrentTrack());
        setIsFullscreen(Boolean(document.fullscreenElement || (document as any).webkitFullscreenElement));
      } catch {
        // ignore
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const saveSettings = (newMusic: number, newSfx: number) => {
    const s = {
      musicVolume: newMusic,
      soundEffectsVolume: newSfx,
      fullscreen: isFullscreen,
      keyboardControls: true,
      playerName,
      muted: isMuted,
    };
    localStorage.setItem('peeranki-settings', JSON.stringify(s));
    PeerankiAudio.applySettings();
    soundEffectManager.syncVolume();
  };

  const handleMusicChange = (delta: number) => {
    PeerankiAudio.effect('click');
    const next = Math.max(0, Math.min(100, musicVol + delta));
    setMusicVol(next);
    saveSettings(next, sfxVol);
  };

  const handleSfxChange = (delta: number) => {
    const next = Math.max(0, Math.min(100, sfxVol + delta));
    setSfxVol(next);
    saveSettings(musicVol, next);
    PeerankiAudio.effect('shoot');
  };

  const handleTrackChange = (trackId: 1 | 2) => {
    PeerankiAudio.effect('click');
    setCurrentTrack(trackId);
    PeerankiAudio.setTrack(trackId);
  };

  const handleToggleFullscreen = () => {
    PeerankiAudio.effect('click');
    try {
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          void document.documentElement.requestFullscreen().catch(() => undefined);
        } else if ((document.documentElement as any).webkitRequestFullscreen) {
          (document.documentElement as any).webkitRequestFullscreen();
        }
        setIsFullscreen(true);
      } else {
        if (document.exitFullscreen) {
          void document.exitFullscreen().catch(() => undefined);
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch {
      // ignore
    }
  };

  const handleToggleMute = () => {
    const next = PeerankiAudio.toggleMute();
    setIsMuted(next);
  };

  return (
    <div
      className="pk-modal-backdrop"
      style={{ display: 'flex' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pk-duel-card-dialog"
        style={{
          maxWidth: '480px',
          maxHeight: '92dvh',
          overflowY: 'auto',
          boxSizing: 'border-box',
          textAlign: 'left',
          background: '#141c26',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          borderRadius: '16px',
          padding: 'clamp(14px, 2vh, 22px)',
          color: '#f8fafc',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚙️</span> SETTINGS
          </h2>
          <button
            type="button"
            className="pk-htp-close-btn"
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Player Name */}
        <div style={{ marginBottom: '18px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#fbbf24', marginBottom: '6px' }}>
            YOUR NAME
          </label>
          <input
            type="text"
            value={playerName}
            maxLength={16}
            onChange={(e) => onPlayerNameChange(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              backgroundColor: '#182029',
              border: '2px solid #455569',
              borderRadius: '8px',
              color: '#ffffff',
              fontSize: '15px',
              fontWeight: 700,
            }}
          />
        </div>

        {/* Volume: Music */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>🎵 Music Volume</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#fbbf24' }}>{musicVol}%</span>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              className="pk-weapon-cycle-btn"
              style={{ width: '40px', height: '36px', minWidth: '40px', minHeight: '36px' }}
              onClick={() => handleMusicChange(-10)}
            >
              −
            </button>
            <div style={{ flex: 1, height: '8px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${musicVol}%`, height: '100%', background: '#38bdf8' }} />
            </div>
            <button
              type="button"
              className="pk-weapon-cycle-btn"
              style={{ width: '40px', height: '36px', minWidth: '40px', minHeight: '36px' }}
              onClick={() => handleMusicChange(10)}
            >
              +
            </button>
          </div>
        </div>

        {/* Volume: Sound Effects */}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>🔊 Sound Effects</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#fbbf24' }}>{sfxVol}%</span>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              className="pk-weapon-cycle-btn"
              style={{ width: '40px', height: '36px', minWidth: '40px', minHeight: '36px' }}
              onClick={() => handleSfxChange(-10)}
            >
              −
            </button>
            <div style={{ flex: 1, height: '8px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${sfxVol}%`, height: '100%', background: '#10b981' }} />
            </div>
            <button
              type="button"
              className="pk-weapon-cycle-btn"
              style={{ width: '40px', height: '36px', minWidth: '40px', minHeight: '36px' }}
              onClick={() => handleSfxChange(10)}
            >
              +
            </button>
          </div>
        </div>

        {/* Sound Track Selector */}
        <div style={{ marginBottom: '18px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#fbbf24', marginBottom: '8px' }}>
            CHOOSE SOUNDTRACK
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {SOUNDTRACK_TRACKS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleTrackChange(t.id)}
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: currentTrack === t.id ? '2px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.12)',
                  background: currentTrack === t.id ? 'rgba(56, 189, 248, 0.2)' : '#1e293b',
                  color: currentTrack === t.id ? '#ffffff' : '#94a3b8',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>

        {/* Action Toggles */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '22px' }}>
          <button
            type="button"
            onClick={handleToggleMute}
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              background: isMuted ? '#822727' : '#2d3748',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isMuted ? '🔇 UNMUTE' : '🔊 MUTE AUDIO'}
          </button>
          <button
            type="button"
            onClick={handleToggleFullscreen}
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              background: '#2d3748',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {isFullscreen ? '✕ EXIT FULLSCREEN' : '⛶ FULLSCREEN'}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%',
            marginTop: '16px',
            padding: '12px',
            backgroundColor: '#2563eb',
            border: 'none',
            borderRadius: '8px',
            color: '#ffffff',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          DONE
        </button>
      </div>
    </div>
  );
};
