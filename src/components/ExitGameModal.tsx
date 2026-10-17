import React, { useEffect } from 'react';
import { PeerankiAudio } from '../audio/PeerankiAudio';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

interface ExitGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
}

export const ExitGameModal: React.FC<ExitGameModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [isClosedScreen, setIsClosedScreen] = React.useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsClosedScreen(false);
      PeerankiAudio.effect('select');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    PeerankiAudio.effect('click');
    if (onConfirm) onConfirm();

    try {
      const desktop = (window as any).peerankiDesktop;
      if (desktop?.quit) {
        desktop.quit();
        return;
      }
      if (Capacitor.isNativePlatform?.() || Capacitor.getPlatform() === 'android') {
        await App.exitApp();
        return;
      }
    } catch {
      // Fallback
    }

    try {
      window.close();
    } catch {
      // ignore
    }

    // In web browsers where window.close is blocked
    setIsClosedScreen(true);
  };

  const handleCancel = () => {
    PeerankiAudio.effect('click');
    onClose();
  };

  return (
    <div
      className="pk-modal-backdrop pk-exit-backdrop"
      style={{ display: 'flex' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isClosedScreen) handleCancel();
      }}
    >
      <div className="pk-exit-dialog">
        {isClosedScreen ? (
          <div className="pk-exit-closed-view">
            <div style={{ fontSize: '48px' }}>👋</div>
            <div className="pk-exit-title">GAME CLOSED</div>
            <p className="pk-exit-desc" style={{ color: '#94a3b8', marginBottom: '16px' }}>
              Thank you for playing <strong>Peeranki</strong>! You can now safely close this browser window or tab.
            </p>
            <button
              type="button"
              className="pk-btn-exit-cancel"
              style={{ minWidth: '160px' }}
              onClick={() => window.location.reload()}
            >
              RELOAD GAME
            </button>
          </div>
        ) : (
          <>
            <div className="pk-exit-icon-badge">⚠️</div>
            <div className="pk-exit-title">EXIT GAME?</div>
            <div className="pk-exit-warning-card">
              <span className="pk-warning-symbol">⚠️</span>
              <p className="pk-exit-warning-text">
                <strong>Warning:</strong> Any unsaved game progress or active multiplayer connection will be terminated.
              </p>
            </div>
            <div className="pk-exit-desc">
              Are you sure you want to close Peeranki and quit the application?
            </div>
            <div className="pk-exit-actions">
              <button type="button" className="pk-btn-exit-cancel" onClick={handleCancel}>
                CANCEL
              </button>
              <button type="button" className="pk-btn-exit-confirm" onClick={handleConfirm}>
                EXIT GAME
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
