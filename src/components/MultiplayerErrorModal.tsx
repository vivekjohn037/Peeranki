import React from 'react';
import {
  parseSupabaseError,
  getSupabaseConfigStatus,
  isProduction,
  type MultiplayerErrorCode,
} from '../supabase';

interface MultiplayerErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  error: unknown;
  roomCode?: string;
  onRetry?: () => void;
}

export const MultiplayerErrorModal: React.FC<MultiplayerErrorModalProps> = ({
  isOpen,
  onClose,
  title,
  error,
  roomCode,
  onRetry,
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen || !error) return null;

  const mpError = parseSupabaseError(error, 'Multiplayer operation failed');
  const config = getSupabaseConfigStatus();

  const diagnosticData = {
    error_code: mpError.code,
    user_message: mpError.userMessage,
    technical_details: mpError.technicalDetails || mpError.message || '',
    room_code: roomCode || null,
    supabase_configured: config.isConfigured,
    supabase_url: config.url || 'Not configured',
    has_publishable_key: config.hasKey,
    is_production: isProduction,
    timestamp: new Date().toISOString(),
    browser_location: typeof window !== 'undefined' ? window.location.href : '',
  };

  const getBadgeLabel = (code: MultiplayerErrorCode) => {
    switch (code) {
      case 'CONFIG_MISSING': return 'SETUP REQUIRED';
      case 'TABLE_MISSING': return 'DATABASE TABLE MISSING';
      case 'RPC_MISSING': return 'DATABASE RPC MISSING';
      case 'ROOM_NOT_FOUND': return 'ROOM NOT FOUND';
      case 'ROOM_FULL': return 'ROOM AT CAPACITY';
      case 'GAME_IN_PROGRESS': return 'MATCH IN PROGRESS';
      case 'PERMISSION_DENIED': return 'PERMISSION DENIED';
      case 'NETWORK_ERROR': return 'NETWORK FAILURE';
      default: return 'MULTIPLAYER ERROR';
    }
  };

  const getResolutionSteps = (code: MultiplayerErrorCode) => {
    switch (code) {
      case 'CONFIG_MISSING':
        return [
          'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your deployment environment variables.',
          'Trigger a new build so Vite injects the keys.',
          'Use only the public/anon key on the client.',
        ];
      case 'TABLE_MISSING':
        return [
          'Open your Supabase dashboard at https://supabase.com/dashboard',
          'Select SQL Editor -> New Query.',
          'Execute supabase/migrations/001_multiplayer.sql and verify public.game_states exists.',
        ];
      case 'RPC_MISSING':
        return [
          'Required RPC database functions are missing.',
          'Execute supabase/migrations/001_multiplayer.sql to create all required RPC functions.',
        ];
      case 'ROOM_NOT_FOUND':
        return [
          roomCode ? `Verify code "${roomCode}" with the host.` : 'Verify 6-character room code.',
          'Ensure host has created the room and is in lobby.',
        ];
      case 'ROOM_FULL':
        return ['Room is full. Join or create another room.'];
      case 'GAME_IN_PROGRESS':
        return ['The match has already started. Wait or join another room.'];
      default:
        return ['Please review technical diagnostics below or check your network.'];
    }
  };

  const handleCopyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnosticData, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(7, 11, 20, 0.85)',
        backdropFilter: 'blur(8px)',
        padding: '16px',
        boxSizing: 'border-box',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '14px',
          maxWidth: '520px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
          color: '#f8fafc',
          boxSizing: 'border-box',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              padding: '4px 10px',
              borderRadius: '6px',
              backgroundColor: '#451a03',
              color: '#fef08a',
              border: '1px solid #ca8a04',
            }}
          >
            {getBadgeLabel(mpError.code)}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '24px', cursor: 'pointer' }}
          >
            &times;
          </button>
        </div>

        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#ffffff' }}>
          {title.toUpperCase()}
        </h2>

        <div style={{ fontSize: '14px', lineHeight: 1.45, color: '#e2e8f0', fontWeight: 600 }}>
          {mpError.userMessage}
        </div>

        <div
          style={{
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '12px 14px',
          }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#38bdf8',
              marginBottom: '6px',
              letterSpacing: '0.05em',
            }}
          >
            RECOMMENDED ACTION
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: '#cbd5e1' }}>
            {getResolutionSteps(mpError.code).map((step, idx) => (
              <li key={idx} style={{ marginBottom: '4px' }}>
                {step}
              </li>
            ))}
          </ul>
        </div>

        <details
          style={{
            backgroundColor: '#0b0f19',
            border: '1px solid #1e293b',
            borderRadius: '8px',
            padding: '8px 12px',
            fontSize: '12px',
            color: '#94a3b8',
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Diagnostic Information</summary>
          <pre
            style={{
              marginTop: '8px',
              padding: '8px',
              backgroundColor: '#020617',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#e2e8f0',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {JSON.stringify(diagnosticData, null, 2)}
          </pre>
        </details>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {onRetry && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onRetry();
              }}
              style={{
                flex: '1 1 120px',
                padding: '10px 16px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🔄 RETRY
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyDiagnostics}
            style={{
              flex: '1 1 150px',
              padding: '10px 14px',
              backgroundColor: copied ? '#16a34a' : '#334155',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {copied ? '✅ COPIED!' : '📋 COPY DIAGNOSTICS'}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: '1 1 100px',
              padding: '10px 16px',
              backgroundColor: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #475569',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
};
