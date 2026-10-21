import { Capacitor } from '@capacitor/core';
import {
  parseSupabaseError,
  getSupabaseConfigStatus,
  isProduction,
  type MultiplayerErrorCode,
} from '../supabase';

export interface MultiplayerModalOptions {
  title: string;
  error: unknown;
  roomCode?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

const OVERLAY_ID = 'peeranki-multiplayer-error-modal';

interface BadgeConfig {
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

function getBadgeConfig(code: MultiplayerErrorCode): BadgeConfig {
  switch (code) {
    case 'CONFIG_MISSING':
      return {
        label: 'SETUP REQUIRED',
        bgColor: '#451a03',
        textColor: '#fef08a',
        borderColor: '#ca8a04',
      };
    case 'TABLE_MISSING':
      return {
        label: 'DATABASE TABLE MISSING',
        bgColor: '#450a0a',
        textColor: '#fca5a5',
        borderColor: '#dc2626',
      };
    case 'RPC_MISSING':
      return {
        label: 'DATABASE RPC MISSING',
        bgColor: '#450a0a',
        textColor: '#fca5a5',
        borderColor: '#dc2626',
      };
    case 'ROOM_NOT_FOUND':
      return {
        label: 'ROOM NOT FOUND',
        bgColor: '#082f49',
        textColor: '#7dd3fc',
        borderColor: '#0284c7',
      };
    case 'ROOM_FULL':
      return {
        label: 'ROOM AT CAPACITY',
        bgColor: '#3b0764',
        textColor: '#e9d5ff',
        borderColor: '#9333ea',
      };
    case 'GAME_IN_PROGRESS':
      return {
        label: 'MATCH IN PROGRESS',
        bgColor: '#1e1b4b',
        textColor: '#c7d2fe',
        borderColor: '#6366f1',
      };
    case 'PERMISSION_DENIED':
      return {
        label: 'PERMISSION DENIED',
        bgColor: '#450a0a',
        textColor: '#fecaca',
        borderColor: '#ef4444',
      };
    case 'NETWORK_ERROR':
      return {
        label: 'NETWORK FAILURE',
        bgColor: '#431407',
        textColor: '#fdba74',
        borderColor: '#ea580c',
      };
    default:
      return {
        label: 'MULTIPLAYER ERROR',
        bgColor: '#1e293b',
        textColor: '#cbd5e1',
        borderColor: '#475569',
      };
  }
}

function getResolutionGuidance(code: MultiplayerErrorCode, roomCode?: string): string[] {
  switch (code) {
    case 'CONFIG_MISSING':
      if (Capacitor.isNativePlatform()) {
        return [
          'The Android app was built without its public Supabase settings. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to the project-root .env.local file.',
          'Run npm.cmd run android:build to rebuild and sync the app, then create a new signed APK in Android Studio.',
          'Use only the public/anon key; never put a service-role key in the app.',
        ];
      }
      return [
        'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your Cloudflare deployment settings (Workers & Pages > Settings > Variables and Secrets).',
        'Trigger a new build and deployment so Vite injects the keys.',
        'Use only the public/anon key on the client; never include a service-role key.',
      ];
    case 'TABLE_MISSING':
      return [
        'Open your Supabase dashboard at https://supabase.com/dashboard',
        'Select your project -> SQL Editor -> New Query.',
        'Copy and paste the entire script from supabase/migrations/001_multiplayer.sql and click Run.',
        'Verify that public.game_states appears in Table Editor.',
      ];
    case 'RPC_MISSING':
      return [
        'The required database functions (join_private_room, find_or_create_public_room, etc.) are missing on Supabase.',
        'Open your Supabase dashboard -> SQL Editor -> New Query.',
        'Execute supabase/migrations/001_multiplayer.sql to create all 5 required RPC functions and grant anon access.',
      ];
    case 'ROOM_NOT_FOUND':
      return [
        roomCode
          ? `Verify code "${roomCode}" with the host. Room codes are 6 characters (e.g. ABC123).`
          : 'Verify the 6-character room code with the host.',
        'Ensure the host has created the room and is currently in the lobby.',
        'If the host created the room locally without Supabase configured, cross-device joining is not available.',
      ];
    case 'ROOM_FULL':
      return [
        'All player slots in this match have been filled.',
        'Ask the host to start a match with higher player capacity (up to 10 players).',
        'Or ask the host to create a new room once players leave.',
      ];
    case 'GAME_IN_PROGRESS':
      return [
        'The host has already started this battle.',
        'Wait until the current match concludes and the room returns to the lobby, or create a new room.',
      ];
    case 'PERMISSION_DENIED':
      return [
        'PostgreSQL Row Level Security (RLS) rejected this request.',
        'Ensure that the anon role has SELECT, INSERT, UPDATE on public.game_states and EXECUTE on public RPC functions.',
        'Re-run supabase/migrations/001_multiplayer.sql in the Supabase SQL Editor.',
      ];
    case 'NETWORK_ERROR':
      return [
        'Check your device internet or Wi-Fi connection.',
        'Verify that your Supabase project is active and has not been paused due to inactivity.',
        'Check your browser console for CORS or SSL connection errors.',
      ];
    default:
      return [
        'Please review the technical diagnostics below.',
        'If the issue persists, verify your Supabase configuration and database migration status.',
      ];
  }
}

export function closeMultiplayerErrorModal(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
  }
}

export function showMultiplayerErrorModal(options: MultiplayerModalOptions): void {
  closeMultiplayerErrorModal();

  const mpError = parseSupabaseError(options.error, 'Multiplayer operation failed');
  const config = getSupabaseConfigStatus();
  const badge = getBadgeConfig(mpError.code);
  const steps = getResolutionGuidance(mpError.code, options.roomCode);

  const diagnosticData = {
    error_code: mpError.code,
    user_message: mpError.userMessage,
    technical_details: mpError.technicalDetails || mpError.message || '',
    room_code: options.roomCode || null,
    supabase_configured: config.isConfigured,
    supabase_url: config.url || 'Not configured',
    has_publishable_key: config.hasKey,
    is_production: isProduction,
    timestamp: new Date().toISOString(),
    browser_location: typeof window !== 'undefined' ? window.location.href : '',
  };

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '99999';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.backgroundColor = 'rgba(7, 11, 20, 0.85)';
  overlay.style.backdropFilter = 'blur(8px)';
  overlay.style.padding = '16px';
  overlay.style.boxSizing = 'border-box';
  overlay.style.fontFamily = 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

  const card = document.createElement('div');
  card.style.backgroundColor = '#0f172a';
  card.style.border = '1px solid #334155';
  card.style.borderRadius = '14px';
  card.style.maxWidth = '520px';
  card.style.width = '100%';
  card.style.maxHeight = '90vh';
  card.style.overflowY = 'auto';
  card.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)';
  card.style.color = '#f8fafc';
  card.style.boxSizing = 'border-box';
  card.style.padding = '24px';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '16px';

  // Header: Badge + Close button
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '8px';

  const badgeEl = document.createElement('span');
  badgeEl.textContent = badge.label;
  badgeEl.style.fontSize = '11px';
  badgeEl.style.fontWeight = '800';
  badgeEl.style.letterSpacing = '0.06em';
  badgeEl.style.padding = '4px 10px';
  badgeEl.style.borderRadius = '6px';
  badgeEl.style.backgroundColor = badge.bgColor;
  badgeEl.style.color = badge.textColor;
  badgeEl.style.border = `1px solid ${badge.borderColor}`;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Close modal');
  closeBtn.style.background = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.color = '#94a3b8';
  closeBtn.style.fontSize = '24px';
  closeBtn.style.lineHeight = '1';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.padding = '2px 8px';
  closeBtn.style.borderRadius = '6px';
  closeBtn.onmouseenter = () => { closeBtn.style.color = '#ffffff'; closeBtn.style.backgroundColor = '#1e293b'; };
  closeBtn.onmouseleave = () => { closeBtn.style.color = '#94a3b8'; closeBtn.style.backgroundColor = 'transparent'; };
  closeBtn.onclick = () => {
    closeMultiplayerErrorModal();
    options.onDismiss?.();
  };

  header.appendChild(badgeEl);
  header.appendChild(closeBtn);
  card.appendChild(header);

  // Title
  const titleEl = document.createElement('h2');
  titleEl.textContent = options.title.toUpperCase();
  titleEl.style.margin = '0';
  titleEl.style.fontSize = '20px';
  titleEl.style.fontWeight = '800';
  titleEl.style.color = '#ffffff';
  titleEl.style.letterSpacing = '0.02em';
  card.appendChild(titleEl);

  // User message
  const msgEl = document.createElement('div');
  msgEl.style.fontSize = '14.5px';
  msgEl.style.lineHeight = '1.45';
  msgEl.style.color = '#e2e8f0';
  msgEl.style.fontWeight = '600';
  msgEl.textContent = mpError.userMessage;
  card.appendChild(msgEl);

  // Resolution Guidance Box
  const guidanceBox = document.createElement('div');
  guidanceBox.style.backgroundColor = '#1e293b';
  guidanceBox.style.border = '1px solid #334155';
  guidanceBox.style.borderRadius = '8px';
  guidanceBox.style.padding = '12px 14px';

  const guidanceTitle = document.createElement('div');
  guidanceTitle.textContent = 'RECOMMENDED ACTION';
  guidanceTitle.style.fontSize = '11px';
  guidanceTitle.style.fontWeight = '700';
  guidanceTitle.style.color = '#38bdf8';
  guidanceTitle.style.marginBottom = '6px';
  guidanceTitle.style.letterSpacing = '0.05em';
  guidanceBox.appendChild(guidanceTitle);

  const list = document.createElement('ul');
  list.style.margin = '0';
  list.style.paddingLeft = '18px';
  list.style.fontSize = '12.5px';
  list.style.lineHeight = '1.4';
  list.style.color = '#cbd5e1';

  steps.forEach((step) => {
    const li = document.createElement('li');
    li.style.marginBottom = '4px';
    li.textContent = step;
    list.appendChild(li);
  });
  guidanceBox.appendChild(list);
  card.appendChild(guidanceBox);

  // Technical details (collapsible)
  const detailsDetails = document.createElement('details');
  detailsDetails.style.backgroundColor = '#0b0f19';
  detailsDetails.style.border = '1px solid #1e293b';
  detailsDetails.style.borderRadius = '8px';
  detailsDetails.style.padding = '8px 12px';
  detailsDetails.style.fontSize = '12px';
  detailsDetails.style.color = '#94a3b8';

  const summary = document.createElement('summary');
  summary.textContent = 'Diagnostic Information';
  summary.style.cursor = 'pointer';
  summary.style.fontWeight = '600';
  summary.style.color = '#94a3b8';
  summary.style.outline = 'none';
  detailsDetails.appendChild(summary);

  const techContent = document.createElement('div');
  techContent.style.marginTop = '8px';
  techContent.style.padding = '8px';
  techContent.style.backgroundColor = '#020617';
  techContent.style.borderRadius = '6px';
  techContent.style.fontFamily = 'monospace';
  techContent.style.fontSize = '11px';
  techContent.style.color = '#e2e8f0';
  techContent.style.wordBreak = 'break-word';
  techContent.style.whiteSpace = 'pre-wrap';
  techContent.textContent = JSON.stringify(diagnosticData, null, 2);
  detailsDetails.appendChild(techContent);
  card.appendChild(detailsDetails);

  // Action Buttons
  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.flexWrap = 'wrap';
  btnRow.style.gap = '10px';
  btnRow.style.marginTop = '6px';

  // 1. Retry button
  if (options.onRetry) {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = '🔄 RETRY';
    retryBtn.style.flex = '1 1 120px';
    retryBtn.style.padding = '10px 16px';
    retryBtn.style.backgroundColor = '#2563eb';
    retryBtn.style.color = '#ffffff';
    retryBtn.style.border = 'none';
    retryBtn.style.borderRadius = '8px';
    retryBtn.style.fontWeight = '700';
    retryBtn.style.fontSize = '13.5px';
    retryBtn.style.cursor = 'pointer';
    retryBtn.style.transition = 'background-color 0.15s';
    retryBtn.onmouseenter = () => { retryBtn.style.backgroundColor = '#1d4ed8'; };
    retryBtn.onmouseleave = () => { retryBtn.style.backgroundColor = '#2563eb'; };
    retryBtn.onclick = () => {
      closeMultiplayerErrorModal();
      options.onRetry?.();
    };
    btnRow.appendChild(retryBtn);
  }

  // 2. Copy button
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = '📋 COPY DIAGNOSTICS';
  copyBtn.style.flex = '1 1 150px';
  copyBtn.style.padding = '10px 14px';
  copyBtn.style.backgroundColor = '#334155';
  copyBtn.style.color = '#ffffff';
  copyBtn.style.border = 'none';
  copyBtn.style.borderRadius = '8px';
  copyBtn.style.fontWeight = '700';
  copyBtn.style.fontSize = '13px';
  copyBtn.style.cursor = 'pointer';
  copyBtn.style.transition = 'background-color 0.15s';
  copyBtn.onmouseenter = () => { copyBtn.style.backgroundColor = '#475569'; };
  copyBtn.onmouseleave = () => { copyBtn.style.backgroundColor = '#334155'; };
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnosticData, null, 2));
      const origText = copyBtn.textContent;
      copyBtn.textContent = '✅ COPIED!';
      copyBtn.style.backgroundColor = '#16a34a';
      setTimeout(() => {
        copyBtn.textContent = origText;
        copyBtn.style.backgroundColor = '#334155';
      }, 2500);
    } catch {
      copyBtn.textContent = '❌ COPY FAILED';
      setTimeout(() => {
        copyBtn.textContent = '📋 COPY DIAGNOSTICS';
      }, 2000);
    }
  };
  btnRow.appendChild(copyBtn);

  // 3. Dismiss button
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.textContent = 'DISMISS';
  dismissBtn.style.flex = '1 1 100px';
  dismissBtn.style.padding = '10px 16px';
  dismissBtn.style.backgroundColor = '#1e293b';
  dismissBtn.style.color = '#cbd5e1';
  dismissBtn.style.border = '1px solid #475569';
  dismissBtn.style.borderRadius = '8px';
  dismissBtn.style.fontWeight = '600';
  dismissBtn.style.fontSize = '13px';
  dismissBtn.style.cursor = 'pointer';
  dismissBtn.style.transition = 'background-color 0.15s, color 0.15s';
  dismissBtn.onmouseenter = () => { dismissBtn.style.backgroundColor = '#334155'; dismissBtn.style.color = '#ffffff'; };
  dismissBtn.onmouseleave = () => { dismissBtn.style.backgroundColor = '#1e293b'; dismissBtn.style.color = '#cbd5e1'; };
  dismissBtn.onclick = () => {
    closeMultiplayerErrorModal();
    options.onDismiss?.();
  };
  btnRow.appendChild(dismissBtn);

  card.appendChild(btnRow);
  overlay.appendChild(card);

  // Keyboard and outside click handlers
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', keyHandler);
      closeMultiplayerErrorModal();
      options.onDismiss?.();
    }
  };
  window.addEventListener('keydown', keyHandler);

  overlay.onclick = (e) => {
    if (e.target === overlay) {
      window.removeEventListener('keydown', keyHandler);
      closeMultiplayerErrorModal();
      options.onDismiss?.();
    }
  };

  document.body.appendChild(overlay);
}
