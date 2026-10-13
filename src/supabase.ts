import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

function validPlayerCount(value: number) {
  return Number.isInteger(value) && value >= MIN_PLAYERS && value <= MAX_PLAYERS;
}

const globalEnv = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env : undefined;
const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || globalEnv?.VITE_SUPABASE_URL;
const supabaseKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) || globalEnv?.VITE_SUPABASE_PUBLISHABLE_KEY;

export function isServiceRoleKey(key: string | undefined): boolean {
  if (!key || typeof key !== 'string') return false;
  try {
    const parts = key.split('.');
    if (parts.length === 3) {
      let decoded = '';
      if (typeof atob === 'function') {
        decoded = atob(parts[1]);
      } else if (typeof (globalThis as any).Buffer !== 'undefined') {
        decoded = (globalThis as any).Buffer.from(parts[1], 'base64').toString('utf8');
      }
      if (decoded) {
        const payload = JSON.parse(decoded);
        return payload?.role === 'service_role';
      }
    }
  } catch {}
  return false;
}

export const isProduction = Boolean(typeof import.meta !== 'undefined' && import.meta.env?.PROD);

export const isSupabaseConfigured = Boolean(
  typeof supabaseUrl === 'string' &&
  supabaseUrl.trim().startsWith('http') &&
  typeof supabaseKey === 'string' &&
  supabaseKey.trim().length > 0 &&
  !isServiceRoleKey(supabaseKey),
);

export const hasAnySupabaseConfiguration = [supabaseUrl, supabaseKey].some(
  (value) => typeof value === 'string' && value.trim().length > 0,
);

export type MultiplayerErrorCode =
  | 'CONFIG_MISSING'
  | 'TABLE_MISSING'
  | 'RPC_MISSING'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_IN_PROGRESS'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'REALTIME_ERROR'
  | 'UNKNOWN_ERROR';

export class MultiplayerError extends Error {
  readonly code: MultiplayerErrorCode;
  readonly userMessage: string;
  readonly technicalDetails?: string;
  readonly cause?: unknown;

  constructor(
    code: MultiplayerErrorCode,
    userMessage: string,
    technicalDetails?: string,
    cause?: unknown,
  ) {
    super(userMessage);
    this.name = 'MultiplayerError';
    this.code = code;
    this.userMessage = userMessage;
    this.technicalDetails = technicalDetails;
    this.cause = cause;
  }
}

export function parseSupabaseError(err: unknown, defaultMessage = 'Multiplayer request failed'): MultiplayerError {
  if (err instanceof MultiplayerError) return err;

  const msg = err instanceof Error ? err.message : String(err || '');
  const rawCode = String((err as any)?.code || '');
  const details = String((err as any)?.details || '');
  const hint = String((err as any)?.hint || '');
  const status = Number((err as any)?.status || 0);
  const searchStr = `${msg} ${details} ${hint} ${rawCode}`.toLowerCase();

  // 1. Missing or invalid build-time configuration / API key
  if (
    searchStr.includes('vite_supabase_url') ||
    searchStr.includes('vite_supabase_publishable_key') ||
    searchStr.includes('supabase is configured but unavailable') ||
    searchStr.includes('supabase configuration is incomplete') ||
    searchStr.includes('supabase client is not available') ||
    searchStr.includes('supabase backend is not configured') ||
    searchStr.includes('service-role') ||
    searchStr.includes('invalid api key') ||
    searchStr.includes('jwt') ||
    searchStr.includes('apikey')
  ) {
    return new MultiplayerError(
      'CONFIG_MISSING',
      'Supabase backend is not configured in this build.',
      'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be provided during build time.',
      err,
    );
  }

  // 2. Database table missing (PostgreSQL 42P01: undefined_table)
  if (
    rawCode === '42P01' ||
    searchStr.includes('relation "public.game_states" does not exist') ||
    searchStr.includes('relation "game_states" does not exist') ||
    searchStr.includes('table "game_states" does not exist') ||
    searchStr.includes('game_states does not exist')
  ) {
    return new MultiplayerError(
      'TABLE_MISSING',
      'Database table "game_states" is missing on Supabase.',
      'Execute migration supabase/migrations/001_multiplayer.sql in the Supabase SQL Editor.',
      err,
    );
  }

  // 3. RPC function missing (PostgREST PGRST202: function not found in schema cache)
  if (
    rawCode === 'PGRST202' ||
    searchStr.includes('could not find the function') ||
    searchStr.includes('join_private_room') ||
    searchStr.includes('find_or_create_public_room') ||
    searchStr.includes('touch_player') ||
    searchStr.includes('leave_room') ||
    searchStr.includes('cleanup_stale_players')
  ) {
    return new MultiplayerError(
      'RPC_MISSING',
      'Required database RPC function missing on Supabase.',
      'Execute migration supabase/migrations/001_multiplayer.sql in the Supabase SQL Editor.',
      err,
    );
  }

  // 4. Room not found / expired (PostgreSQL P0001, P0002)
  if (
    rawCode === 'P0001' ||
    rawCode === 'P0002' ||
    searchStr.includes('room does not exist') ||
    searchStr.includes('room not found') ||
    searchStr.includes('could not find room')
  ) {
    return new MultiplayerError(
      'ROOM_NOT_FOUND',
      'Room not found. Check the 6-character code or ask host for a new room.',
      msg || details,
      err,
    );
  }

  // 5. Room already full (PostgreSQL P0005)
  if (
    rawCode === 'P0005' ||
    searchStr.includes('room is full') ||
    searchStr.includes('capacity reached') ||
    searchStr.includes('maximum players')
  ) {
    return new MultiplayerError(
      'ROOM_FULL',
      'Room is full. Maximum players already joined.',
      msg || details,
      err,
    );
  }

  // 6. Game already in progress (PostgreSQL P0004)
  if (
    rawCode === 'P0004' ||
    searchStr.includes('game already in progress') ||
    searchStr.includes('match in progress') ||
    searchStr.includes('already started')
  ) {
    return new MultiplayerError(
      'GAME_IN_PROGRESS',
      'This match has already started and cannot accept new players.',
      msg || details,
      err,
    );
  }

  // 7. Permission / RLS failure (PostgreSQL 42501: insufficient_privilege)
  if (
    rawCode === '42501' ||
    status === 401 ||
    status === 403 ||
    searchStr.includes('permission denied') ||
    searchStr.includes('row-level security') ||
    searchStr.includes('rls')
  ) {
    return new MultiplayerError(
      'PERMISSION_DENIED',
      'Database permission denied (Row Level Security check failed).',
      'Ensure anon and authenticated roles have permissions on game_states and RPC functions.',
      err,
    );
  }

  // 8. Network timeout or connection failure
  if (
    searchStr.includes('failed to fetch') ||
    searchStr.includes('networkerror') ||
    searchStr.includes('aborterror') ||
    searchStr.includes('timeout') ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return new MultiplayerError(
      'NETWORK_ERROR',
      'Network connection failed. Could not reach Supabase servers.',
      msg,
      err,
    );
  }

  return new MultiplayerError('UNKNOWN_ERROR', defaultMessage, msg, err);
}

let realClient: SupabaseClient | null = null;
let clientInitializationError: unknown;

if (isServiceRoleKey(supabaseKey)) {
  console.error(
    '[SECURITY ALERT] A Supabase service-role key was detected in VITE_SUPABASE_PUBLISHABLE_KEY. ' +
    'Service-role keys bypass all Row Level Security and must NEVER be exposed in client builds. ' +
    'Use only your public anon/publishable key on the client.',
  );
  clientInitializationError = new Error('Service-role key cannot be used in client builds.');
} else if (isSupabaseConfigured) {
  try {
    realClient = createClient(supabaseUrl!.trim(), supabaseKey!.trim());
  } catch (err) {
    console.error('[Peeranki] Failed to initialize configured Supabase client:', err);
    clientInitializationError = err;
    realClient = null;
  }
} else if (!hasAnySupabaseConfiguration) {
  if (isProduction) {
    console.warn('[Peeranki] Production build compiled without Supabase credentials. Online multiplayer requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  } else {
    console.info('[Peeranki] Local development: running with in-memory/broadcast mock room manager.');
  }
} else {
  clientInitializationError = new Error('Both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.');
  console.error('[Peeranki] Supabase configuration is incomplete; online rooms are unavailable.');
}

// Purge any sensitive API keys inadvertently cached in client storage
try {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('peeranki_custom_supabase_key');
  }
} catch {}

export interface ServerRegionInfo {
  id: string;
  name: string;
  flag: string;
  location: string;
  isMumbai: boolean;
  endpoint: string;
}

const REGION_STORAGE_KEY = 'peeranki_server_region';
const CUSTOM_URL_STORAGE_KEY = 'peeranki_custom_supabase_url';

export function getStoredServerRegion(): ServerRegionInfo {
  let regionId = 'mumbai';
  try {
    const saved = localStorage.getItem(REGION_STORAGE_KEY);
    if (saved) regionId = saved;
  } catch {}

  const customUrl = getStoredCustomUrl();
  const endpoint = customUrl || (typeof supabaseUrl === 'string' && supabaseUrl ? supabaseUrl : 'https://srygfddukkmrqgdnrbqp.supabase.co');

  if (regionId === 'mumbai' || !regionId) {
    return {
      id: 'mumbai',
      name: 'Mumbai (ap-south-1)',
      flag: '🇮🇳',
      location: 'Mumbai, India',
      isMumbai: true,
      endpoint,
    };
  }

  return {
    id: regionId,
    name: 'Singapore (ap-southeast-1)',
    flag: '🇸🇬',
    location: 'Singapore',
    isMumbai: false,
    endpoint,
  };
}

export function setStoredServerRegion(regionId: string, customUrl?: string) {
  try {
    localStorage.setItem(REGION_STORAGE_KEY, regionId);
    if (customUrl !== undefined) {
      if (customUrl.trim()) {
        localStorage.setItem(CUSTOM_URL_STORAGE_KEY, customUrl.trim());
      } else {
        localStorage.removeItem(CUSTOM_URL_STORAGE_KEY);
      }
    }
  } catch {}
}

function getStoredCustomUrl(): string | null {
  try {
    return localStorage.getItem(CUSTOM_URL_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getSupabaseConfigStatus() {
  return {
    isConfigured: isSupabaseConfigured,
    hasAnyConfig: hasAnySupabaseConfiguration,
    url: typeof supabaseUrl === 'string' && supabaseUrl ? supabaseUrl.replace(/^(https?:\/\/[^/]+).*/, '$1') : '',
    hasKey: typeof supabaseKey === 'string' && supabaseKey.trim().length > 0,
    isProduction,
  };
}

function configuredClient(): SupabaseClient {
  if (isServiceRoleKey(supabaseKey)) {
    throw new MultiplayerError(
      'CONFIG_MISSING',
      'Security error: Supabase service-role key detected in client build.',
      'A service-role key bypasses all Row Level Security. Replace VITE_SUPABASE_PUBLISHABLE_KEY with your project anon/publishable key and rebuild.',
    );
  }
  if (!isSupabaseConfigured) {
    if (!supabaseUrl && !supabaseKey) {
      throw new MultiplayerError(
        'CONFIG_MISSING',
        'Supabase backend is not configured in this build.',
        'Production multiplayer requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY environment variables set at build time.',
      );
    }
    if (!supabaseUrl || !supabaseUrl.trim().startsWith('http')) {
      throw new MultiplayerError(
        'CONFIG_MISSING',
        'Invalid Supabase URL configured.',
        `VITE_SUPABASE_URL must be a valid HTTPS URL (e.g. https://your-project.supabase.co). Current value: "${supabaseUrl || ''}"`,
      );
    }
    if (!supabaseKey || supabaseKey.trim().length === 0) {
      throw new MultiplayerError(
        'CONFIG_MISSING',
        'Missing Supabase publishable key.',
        'VITE_SUPABASE_PUBLISHABLE_KEY must be provided during build time.',
      );
    }
  }
  if (realClient) return realClient;
  throw new MultiplayerError(
    'CONFIG_MISSING',
    'Supabase client failed to initialize.',
    `Initialization error: ${errorMessage(clientInitializationError)}. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.`,
    clientInitializationError,
  );
}

// -------------------------------------------------------------
// In-Memory / Cross-Tab Broadcast Mock Room Store
// -------------------------------------------------------------
interface MockRoomRecord {
  room_code: string;
  players: any[];
  max_players: number;
  is_public: boolean;
  host_session_id: string;
  current_shooter: number | null;
  countdown: number;
  counting_start_timestamp?: string | null;
  game_status: string;
  updated_at: string;
  created_at?: string;
  [key: string]: any;
}

const STORAGE_PREFIX = 'peeranki_room_';
const mockRoomsMemory = new Map<string, MockRoomRecord>();
const listenersByRoom = new Map<string, Set<(state: any) => void>>();

let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel('peeranki_room_sync');
    broadcastChannel.onmessage = (event) => {
      const { type, roomCode, data } = event.data || {};
      if (type === 'ROOM_UPDATE' && roomCode && data) {
        mockRoomsMemory.set(roomCode, data);
        notifyRoomListeners(roomCode, data, false);
      } else if (type === 'PEER_ACTION_EVENT' && roomCode) {
        const { event: actionEvent, payload, sender_id } = event.data;
        const subs = roomSubscribers.get(roomCode);
        if (subs) {
          subs.forEach((sub) => {
            if (sub.id !== sender_id) {
              sub.eventCallback?.(actionEvent, payload);
            }
          });
        }
      }
    };
  }
} catch {
  // BroadcastChannel unavailable
}

function getStoredRoom(code: string): MockRoomRecord | null {
  const cleanCode = code.trim().toUpperCase();
  if (mockRoomsMemory.has(cleanCode)) {
    return mockRoomsMemory.get(cleanCode)!;
  }
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${cleanCode}`);
    if (raw) {
      const parsed = JSON.parse(raw) as MockRoomRecord;
      mockRoomsMemory.set(cleanCode, parsed);
      return parsed;
    }
  } catch {
    // sessionStorage error fallback
  }
  return null;
}

function persistMockRoom(room: MockRoomRecord, broadcast = true) {
  const cleanCode = room.room_code.trim().toUpperCase();
  mockRoomsMemory.set(cleanCode, room);
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${cleanCode}`, JSON.stringify(room));
  } catch {
    // sessionStorage quota or disabled
  }
  notifyRoomListeners(cleanCode, room, broadcast);
}

function notifyRoomListeners(roomCode: string, state: any, broadcast: boolean) {
  const listeners = listenersByRoom.get(roomCode);
  if (listeners) {
    listeners.forEach((cb) => {
      try {
        cb(state);
      } catch (err) {
        console.error('[Peeranki] Room listener callback error:', err);
      }
    });
  }
  const subs = roomSubscribers.get(roomCode);
  if (subs) {
    subs.forEach((sub) => {
      try {
        sub.stateCallback(state);
      } catch (err) {
        console.error('[Peeranki] Room subscriber callback error:', err);
      }
    });
  }
  if (broadcast && broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'ROOM_UPDATE', roomCode, data: state });
    } catch {
      // ignore
    }
  }
}

function updateMockRoomPartial(code: string, updates: Partial<MockRoomRecord>, notify = true) {
  const room = getStoredRoom(code);
  if (!room) return null;
  const updated: MockRoomRecord = {
    ...room,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  const cleanCode = updated.room_code.trim().toUpperCase();
  mockRoomsMemory.set(cleanCode, updated);
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${cleanCode}`, JSON.stringify(updated));
  } catch {
    // sessionStorage quota or disabled
  }
  if (notify) {
    notifyRoomListeners(cleanCode, updated, true);
  }
  return updated;
}

// -------------------------------------------------------------
// Supabase Client Export
// -------------------------------------------------------------
const mockSupabaseProxy: any = {
  from: (table: string) => {
    void table;
    return {
      select: () => ({
        eq: (col: string, val: any) => ({
          maybeSingle: async () => {
            if (col === 'room_code') {
              return { data: getStoredRoom(String(val)), error: null };
            }
            return { data: null, error: null };
          },
          single: async () => {
            if (col === 'room_code') {
              const r = getStoredRoom(String(val));
              return r ? { data: r, error: null } : { data: null, error: new Error('Room not found') };
            }
            return { data: null, error: new Error('Not found') };
          },
        }),
      }),
      insert: (record: any) => ({
        select: () => ({
          single: async () => {
            persistMockRoom(record);
            return { data: record, error: null };
          },
        }),
      }),
      update: (updates: any) => ({
        eq: async (col: string, val: any) => {
          if (col === 'room_code') {
            updateMockRoomPartial(String(val), updates);
          }
          return { error: null };
        },
      }),
    };
  },
  rpc: async () => ({ data: null, error: null }),
  channel: (name: string) => {
    const match = name.match(/peeranki-room-(.+)/);
    const roomCode = match ? match[1].trim().toUpperCase() : '';
    let listener: ((state: any) => void) | null = null;
    return {
      on: function (_event: string, _opts: any, callback: (payload: { new: any }) => void) {
        listener = (roomState: any) => {
          callback({ new: roomState });
        };
        if (roomCode) {
          if (!listenersByRoom.has(roomCode)) {
            listenersByRoom.set(roomCode, new Set());
          }
          listenersByRoom.get(roomCode)!.add(listener);
        }
        return this;
      },
      subscribe: function (cb?: (status: string, error?: any) => void) {
        if (cb) cb('SUBSCRIBED');
        return {
          unsubscribe: async () => {
            if (roomCode && listener) {
              listenersByRoom.get(roomCode)?.delete(listener);
            }
          },
        };
      },
    };
  },
};

const unavailableSupabaseProxy: any = {
  from: () => { throw new Error('Supabase is configured but unavailable. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'); },
  rpc: async () => { throw new Error('Supabase is configured but unavailable. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'); },
  channel: () => { throw new Error('Supabase is configured but unavailable. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'); },
};

export const supabase: any = realClient ?? (hasAnySupabaseConfiguration ? unavailableSupabaseProxy : mockSupabaseProxy);

// -------------------------------------------------------------
// Game Room Actions
// -------------------------------------------------------------
function generateRoomCode() {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters[randomIndex];
  }
  return code;
}

export async function createPrivateRoom(
  maxPlayers: number,
  sessionId: string,
  playerName = 'Player 1',
) {
  if (!validPlayerCount(maxPlayers) || !sessionId) {
    throw new MultiplayerError('UNKNOWN_ERROR', 'Invalid player count or session identifier.');
  }

  const hostName = playerName.trim() || 'Player 1';

  if (isProduction || hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const roomCode = generateRoomCode();
        const initialPlayers = [
          {
            id: 1,
            name: hostName,
            stage: 0,
            alive: true,
            session_id: sessionId,
            connected: true,
            last_seen: new Date().toISOString(),
          },
        ];

        const { data, error } = await client
          .from('game_states')
          .insert({
            room_code: roomCode,
            players: initialPlayers,
            max_players: maxPlayers,
            is_public: false,
            host_session_id: sessionId,
            current_shooter: null,
            countdown: 0,
            game_status: 'waiting',
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (!error && data) {
          return data;
        }

        if (error) {
          if (String(error.message).toLowerCase().includes('duplicate') || String((error as any).code).includes('23505')) {
            continue;
          }
          throw parseSupabaseError(error, 'Supabase room creation failed');
        }
      }
      throw new MultiplayerError('UNKNOWN_ERROR', 'Could not generate unique room code after several attempts.');
    } catch (err) {
      throw parseSupabaseError(err, 'Supabase room creation failed');
    }
  }

  // Local mock room creation (development only)
  const roomCode = generateRoomCode();
  const initialPlayers = [
    {
      id: 1,
      name: hostName,
      stage: 0,
      alive: true,
      session_id: sessionId,
      connected: true,
      last_seen: new Date().toISOString(),
      weapons: ['gun'],
      all_weapons_collected: false,
      elimination_points: 0,
      shield_disabled_round: -1,
    },
  ];

  const mockRoom: MockRoomRecord = {
    room_code: roomCode,
    players: initialPlayers,
    max_players: maxPlayers,
    is_public: false,
    host_session_id: sessionId,
    current_shooter: null,
    countdown: 0,
    counting_start_timestamp: null,
    game_status: 'waiting',
    updated_at: new Date().toISOString(),
  };

  persistMockRoom(mockRoom);
  return mockRoom;
}

export async function joinRoom(
  roomCode: string,
  playerName: string,
  sessionId: string,
) {
  const cleanCode = roomCode.trim().toUpperCase();
  const cleanName = playerName.trim();

  if (!cleanCode || cleanCode.length !== 6) {
    throw new MultiplayerError(
      'ROOM_NOT_FOUND',
      'Please enter a valid 6-character room code.',
      `Received room code: "${cleanCode}"`,
    );
  }

  if (!cleanName) {
    throw new MultiplayerError(
      'UNKNOWN_ERROR',
      'Please enter your player name before joining.',
    );
  }

  if (!sessionId) {
    throw new MultiplayerError(
      'UNKNOWN_ERROR',
      'Session identifier missing. Please refresh the page.',
    );
  }

  if (isProduction || hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('join_private_room', {
        p_room_code: cleanCode,
        p_player_name: cleanName,
        p_session_id: sessionId,
      });

      if (error) {
        throw parseSupabaseError(error, `Could not join room ${cleanCode}`);
      }
      if (!data) {
        throw new MultiplayerError('ROOM_NOT_FOUND', `Room ${cleanCode} not found or is closed.`);
      }
      return data;
    } catch (err) {
      throw parseSupabaseError(err, `Could not join room ${cleanCode}`);
    }
  }

  // Local mock room join (development only)
  const room = getStoredRoom(cleanCode);
  if (!room) {
    throw new MultiplayerError(
      'ROOM_NOT_FOUND',
      `Room ${cleanCode} not found in local session.`,
      `Local mock store could not find room code ${cleanCode}.`,
    );
  }

  const existingPlayerIndex = room.players.findIndex(
    (p: any) => p.session_id === sessionId,
  );

  if (existingPlayerIndex >= 0) {
    room.players[existingPlayerIndex].name = cleanName;
    room.players[existingPlayerIndex].connected = true;
    room.players[existingPlayerIndex].last_seen = new Date().toISOString();
  } else {
    const connectedCount = room.players.filter((p: any) => p.connected).length;
    if (connectedCount >= room.max_players) {
      throw new MultiplayerError(
        'ROOM_FULL',
        `Room ${cleanCode} is full (capacity: ${room.max_players}).`,
      );
    }
    const usedIds = new Set(room.players.map((p: any) => Number(p.id)));
    let nextId = 1;
    while (usedIds.has(nextId) && nextId <= room.max_players) {
      nextId += 1;
    }
    room.players.push({
      id: nextId,
      name: cleanName,
      stage: 0,
      alive: true,
      session_id: sessionId,
      connected: true,
      last_seen: new Date().toISOString(),
      weapons: ['gun'],
      all_weapons_collected: false,
      elimination_points: 0,
      shield_disabled_round: -1,
    });
  }

  room.updated_at = new Date().toISOString();
  persistMockRoom(room);
  return room;
}

export async function findOrCreateRandomRoom(
  maxPlayers: number,
  playerName: string,
  sessionId: string,
) {
  const cleanName = playerName.trim();

  if (!validPlayerCount(maxPlayers) || !cleanName || !sessionId) {
    throw new MultiplayerError('UNKNOWN_ERROR', 'Invalid player count, name, or session identifier.');
  }

  if (isProduction || hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('find_or_create_public_room', {
        p_max_players: maxPlayers,
        p_player_name: cleanName,
        p_session_id: sessionId,
      });

      if (error) throw parseSupabaseError(error, 'Matchmaking failed');
      if (!data) throw new MultiplayerError('UNKNOWN_ERROR', 'Matchmaking returned empty room data.');
      return data;
    } catch (err) {
      throw parseSupabaseError(err, 'Matchmaking failed');
    }
  }

  // Local mock room matchmaking
  // Find any waiting public room with matching max players and available space
  for (const [, room] of mockRoomsMemory.entries()) {
    if (
      room.is_public &&
      room.max_players === maxPlayers &&
      room.game_status === 'waiting'
    ) {
      const connected = room.players.filter((p: any) => p.connected);
      if (connected.length < room.max_players) {
        return joinRoom(room.room_code, cleanName, sessionId);
      }
    }
  }

  // Otherwise create a new public room
  const roomCode = generateRoomCode();
  const initialPlayers = [
    {
      id: 1,
      name: cleanName,
      stage: 0,
      alive: true,
      session_id: sessionId,
      connected: true,
      last_seen: new Date().toISOString(),
      weapons: ['gun'],
      all_weapons_collected: false,
      elimination_points: 0,
      shield_disabled_round: -1,
    },
  ];

  const newPublicRoom: MockRoomRecord = {
    room_code: roomCode,
    players: initialPlayers,
    max_players: maxPlayers,
    is_public: true,
    host_session_id: sessionId,
    current_shooter: null,
    countdown: 0,
    counting_start_timestamp: null,
    game_status: 'waiting',
    updated_at: new Date().toISOString(),
  };

  persistMockRoom(newPublicRoom);
  return newPublicRoom;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const raw = (error as any).message || (error as any).details || (error as any).hint;
    if (raw) return String(raw);
  }
  return error instanceof Error ? error.message : String(error);
}

export async function fetchGameRoom(roomCode: string) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode) return null;

  if (isProduction || hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client
        .from('game_states')
        .select('*')
        .eq('room_code', cleanCode)
        .maybeSingle();

      if (error) throw parseSupabaseError(error, `Could not load room ${cleanCode}`);
      if (data && !data.counting_start_timestamp && Array.isArray(data.players)) {
        const timestampHolder = data.players.find((p: any) => typeof p?.counting_start_timestamp === 'string' && p.counting_start_timestamp);
        if (timestampHolder) {
          data.counting_start_timestamp = timestampHolder.counting_start_timestamp;
        }
      }
      return data;
    } catch (err) {
      throw parseSupabaseError(err, `Could not load room ${cleanCode}`);
    }
  }

  return getStoredRoom(cleanCode);
}

export async function getGameState(roomCode: string) {
  return fetchGameRoom(roomCode);
}

const activeRealtimeChannels = new Map<string, any>();
let roomSequenceCounter = 0;
const lastRoomStateSeq = new Map<string, number>();
const lastRoomUpdatedAt = new Map<string, number>();

function shouldAcceptRoomState(roomCode: string, state: any): boolean {
  if (!state || typeof state !== 'object') return false;
  const seq = typeof state.state_seq === 'number' ? state.state_seq : -1;
  const time = state.updated_at ? Date.parse(state.updated_at) : 0;
  const lastSeq = lastRoomStateSeq.get(roomCode) ?? -1;
  const lastTime = lastRoomUpdatedAt.get(roomCode) ?? 0;

  if (seq > 0 && lastSeq > 0) {
    if (seq <= lastSeq) return false;
    lastRoomStateSeq.set(roomCode, seq);
    if (time > lastTime) lastRoomUpdatedAt.set(roomCode, time);
    return true;
  }

  if (time > 0 && lastTime > 0) {
    if (time <= lastTime) return false;
    lastRoomUpdatedAt.set(roomCode, time);
    if (seq > lastSeq) lastRoomStateSeq.set(roomCode, seq);
    return true;
  }

  if (seq > 0) lastRoomStateSeq.set(roomCode, seq);
  if (time > 0) lastRoomUpdatedAt.set(roomCode, time);
  return true;
}

export async function saveGameState(
  roomCode: string,
  players: unknown[],
  maxPlayers: number,
  currentShooter: number | null,
  countNumber: number,
  gameStatus: string,
  countingStartTimestamp?: string | null,
) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode || !validPlayerCount(maxPlayers)) {
    return;
  }

  const seq = ++roomSequenceCounter;
  const now = new Date().toISOString();
  lastRoomStateSeq.set(cleanCode, seq);
  lastRoomUpdatedAt.set(cleanCode, Date.parse(now));

  const statePayload = {
    room_code: cleanCode,
    players,
    max_players: maxPlayers,
    current_shooter: currentShooter,
    countdown: countNumber,
    counting_start_timestamp: countingStartTimestamp ?? null,
    game_status: gameStatus,
    updated_at: now,
    state_seq: seq,
  };

  // 1. Instantly broadcast state over active Realtime channel if available (sub-40ms WebSocket delivery)
  const activeChan = activeRealtimeChannels.get(cleanCode);
  if (activeChan) {
    try {
      void activeChan.send({
        type: 'broadcast',
        event: 'state_delta',
        payload: statePayload,
      });
    } catch {
      // Best-effort fast broadcast
    }
  }

  // 2. Instantly notify local subscribers on this client
  notifyRoomListeners(cleanCode, statePayload, false);
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({
        type: 'ROOM_UPDATE',
        roomCode: cleanCode,
        data: statePayload,
      });
    } catch {
      // ignore
    }
  }

  // 3. Update local mock room store (without duplicate notify)
  updateMockRoomPartial(cleanCode, {
    players: players as any[],
    max_players: maxPlayers,
    current_shooter: currentShooter,
    countdown: countNumber,
    counting_start_timestamp: countingStartTimestamp ?? null,
    game_status: gameStatus,
    state_seq: seq,
  }, false);

  if (hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const updateData: Record<string, any> = {
        players,
        max_players: maxPlayers,
        current_shooter: currentShooter,
        countdown: countNumber,
        game_status: gameStatus,
        updated_at: now,
      };
      if (countingStartTimestamp !== undefined) {
        updateData.counting_start_timestamp = countingStartTimestamp;
      }

      const { error } = await client
        .from('game_states')
        .update(updateData)
        .eq('room_code', cleanCode);

      if (error) {
        const errStr = `${(error as any)?.code || ''} ${(error as any)?.message || ''} ${(error as any)?.details || ''}`.toLowerCase();
        if ((errStr.includes('counting_start_timestamp') || (error as any).code === '42703' || (error as any).code === 'PGRST204') && 'counting_start_timestamp' in updateData) {
          delete updateData.counting_start_timestamp;
          const retry = await client
            .from('game_states')
            .update(updateData)
            .eq('room_code', cleanCode);
          if (retry.error) throw retry.error;
        } else {
          throw error;
        }
      }
    } catch (err) {
      throw new Error(`Supabase could not save game state: ${errorMessage(err)}`, { cause: err });
    }
    return;
  }
}

/** Send transient authoritative turn/count fields without persisting a database write per tick. */
export async function broadcastRoomStateDelta(
  roomCode: string,
  delta: {
    current_shooter: number | null;
    countdown?: number;
    game_status: string;
    counting_start_timestamp?: string | null;
  },
) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode) return;
  const seq = ++roomSequenceCounter;
  const state = {
    room_code: cleanCode,
    countdown: 0,
    ...delta,
    updated_at: new Date().toISOString(),
    state_seq: seq,
  };
  lastRoomStateSeq.set(cleanCode, seq);
  lastRoomUpdatedAt.set(cleanCode, Date.parse(state.updated_at));

  notifyRoomListeners(cleanCode, state, false);

  const channel = activeRealtimeChannels.get(cleanCode);
  if (channel) {
    try {
      const status = await channel.send({ type: 'broadcast', event: 'state_delta', payload: state });
      if (status === 'ok') return;
    } catch {
      // Fall through to the HTTP broadcast path.
    }
    try {
      const result = await channel.httpSend('state_delta', state, { timeout: 5_000 });
      if (result?.success) return;
    } catch {
      // A count animation is best effort; durable game state is written at phase changes.
    }
  }

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'ROOM_UPDATE', roomCode: cleanCode, data: state });
    } catch {
      // Best-effort local room synchronization.
    }
  }
}

export async function touchPlayer(roomCode: string, sessionId: string) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode || !sessionId) return null;

  if (isProduction || hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('touch_player', {
        p_room_code: cleanCode,
        p_session_id: sessionId,
      });
      if (error) throw error;
      return data;
    } catch (err) {
      console.warn('[Peeranki] Supabase player heartbeat failed:', errorMessage(err));
      return null;
    }
  }

  const room = getStoredRoom(cleanCode);
  if (room) {
    const player = room.players.find((p: any) => p.session_id === sessionId);
    if (player) {
      player.last_seen = new Date().toISOString();
      player.connected = true;
      persistMockRoom(room, false);
      return room;
    }
  }
  return null;
}

export async function cleanupStalePlayers(roomCode: string, staleSeconds = 30) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode) return null;

  if (isProduction || hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('cleanup_stale_players', {
        p_room_code: cleanCode,
        p_stale_seconds: staleSeconds,
      });
      if (error) throw error;
      return data;
    } catch (err) {
      console.warn('[Peeranki] Supabase stale-player cleanup failed:', errorMessage(err));
      return null;
    }
  }

  const room = getStoredRoom(cleanCode);
  if (room) {
    const cutoff = Date.now() - staleSeconds * 1000;
    let changed = false;
    room.players.forEach((p: any) => {
      if (p.connected && p.last_seen && new Date(p.last_seen).getTime() < cutoff) {
        p.connected = false;
        changed = true;
      }
    });
    if (changed) {
      persistMockRoom(room);
    }
    return room;
  }
  return null;
}

export async function leaveRoom(roomCode: string, sessionId: string) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode || !sessionId) return null;

  if (isProduction || hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('leave_room', {
        p_room_code: cleanCode,
        p_session_id: sessionId,
      });
      if (error) throw error;
      return data;
    } catch (err) {
      console.warn(`[Peeranki] Supabase could not leave room ${cleanCode}:`, errorMessage(err));
      return null;
    }
  }

  const room = getStoredRoom(cleanCode);
  if (room) {
    const player = room.players.find((p: any) => p.session_id === sessionId);
    if (player) {
      player.connected = false;
      player.alive = false;
      persistMockRoom(room);
      return room;
    }
  }
  return null;
}

export function leaveRoomBestEffort(roomCode: string, sessionId: string) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode || !sessionId) return;

  if (hasAnySupabaseConfiguration) {
    const url = `${supabaseUrl}/rest/v1/rpc/leave_room`;
    try {
      void fetch(url, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          p_room_code: cleanCode,
          p_session_id: sessionId,
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Best-effort only
    }
  }

  if (!hasAnySupabaseConfiguration) {
    void leaveRoom(cleanCode, sessionId).catch((err) => {
      console.error('[Peeranki] Local room cleanup failed:', err);
    });
  }
}

export interface RoomSubscription {
  unsubscribe: () => Promise<void>;
  sendEvent: (event: string, payload: any) => Promise<void>;
}

interface RoomSubscriberEntry {
  id: string;
  stateCallback: (gameState: any) => void;
  eventCallback?: (event: string, payload: any) => void;
}

const roomSubscribers = new Map<string, Set<RoomSubscriberEntry>>();

export function subscribeToGameState(
  roomCode: string,
  stateCallback: (gameState: any) => void,
  eventCallback?: (event: string, payload: any) => void,
): RoomSubscription {
  const cleanCode = roomCode.trim().toUpperCase();
  const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  if (!roomSubscribers.has(cleanCode)) {
    roomSubscribers.set(cleanCode, new Set());
  }

  const currentEntry: RoomSubscriberEntry = {
    id: subId,
    stateCallback,
    eventCallback,
  };
  roomSubscribers.get(cleanCode)!.add(currentEntry);

  if (hasAnySupabaseConfiguration) {
    if (!activeRealtimeChannels.has(cleanCode)) {
      try {
        const client = configuredClient();
        const realChannel = client
          .channel(`peeranki-room-${cleanCode}`, {
            config: {
              broadcast: { self: false },
            },
          })
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'game_states',
              filter: `room_code=eq.${cleanCode}`,
            },
            (payload) => {
              const next = payload.new ?? null;
              if (next && shouldAcceptRoomState(cleanCode, next)) {
                roomSubscribers.get(cleanCode)?.forEach((entry) => {
                  try {
                    entry.stateCallback(next);
                  } catch (err) {
                    console.error('[Peeranki] Subscriber state callback error:', err);
                  }
                });
              }
            },
          )
          .on('broadcast', { event: 'state_delta' }, (payload) => {
            if (payload.payload && shouldAcceptRoomState(cleanCode, payload.payload)) {
              roomSubscribers.get(cleanCode)?.forEach((entry) => {
                try {
                  entry.stateCallback(payload.payload);
                } catch (err) {
                  console.error('[Peeranki] Subscriber state delta callback error:', err);
                }
              });
            }
          })
          .on('broadcast', { event: 'peer_action_event' }, (payload) => {
            const data = payload.payload;
            if (data && data.event) {
              roomSubscribers.get(cleanCode)?.forEach((entry) => {
                if (entry.id !== data.sender_id) {
                  try {
                    entry.eventCallback?.(data.event, data.payload);
                  } catch (err) {
                    console.error('[Peeranki] Subscriber peer action callback error:', err);
                  }
                }
              });
            }
          })
          .subscribe((_status, error) => {
            if (error) {
              console.error('[Peeranki] Supabase realtime error:', error);
            }
          });
        activeRealtimeChannels.set(cleanCode, realChannel);
      } catch (err) {
        console.error('[Peeranki] Failed to subscribe to Supabase realtime:', err);
      }
    }
  }

  return {
    sendEvent: async (event: string, payload: any) => {
      // 1. Dispatch directly to other local subscribers of the room (excluding sender)
      const subs = roomSubscribers.get(cleanCode);
      if (subs) {
        subs.forEach((sub) => {
          if (sub.id !== subId) {
            try {
              sub.eventCallback?.(event, payload);
            } catch (err) {
              console.error('[Peeranki] Local event dispatch error:', err);
            }
          }
        });
      }

      // 2. Broadcast via Supabase Realtime channel
      const chan = activeRealtimeChannels.get(cleanCode);
      if (chan) {
        try {
          void chan.send({
            type: 'broadcast',
            event: 'peer_action_event',
            payload: { event, payload, sender_id: subId },
          });
        } catch {
          // best-effort
        }
      }

      // 3. Broadcast across browser tabs
      if (broadcastChannel) {
        try {
          broadcastChannel.postMessage({
            type: 'PEER_ACTION_EVENT',
            roomCode: cleanCode,
            event,
            payload,
            sender_id: subId,
          });
        } catch {
          // ignore
        }
      }
    },
    unsubscribe: async () => {
      const subs = roomSubscribers.get(cleanCode);
      if (subs) {
        subs.delete(currentEntry);
        if (subs.size === 0) {
          roomSubscribers.delete(cleanCode);
          lastRoomStateSeq.delete(cleanCode);
          lastRoomUpdatedAt.delete(cleanCode);
          const chan = activeRealtimeChannels.get(cleanCode);
          activeRealtimeChannels.delete(cleanCode);
          if (chan) {
            try {
              await chan.unsubscribe();
              if (hasAnySupabaseConfiguration) {
                const client = configuredClient();
                await client.removeChannel(chan);
                if (activeRealtimeChannels.size === 0 && roomSubscribers.size === 0) {
                  (client as any).realtime?.disconnect?.();
                }
              }
            } catch (err) {
              console.error('[Peeranki] Supabase realtime unsubscribe failed:', err);
            }
          }
        }
      }
    },
  };
}

export async function updatePlayerAvatar(
  roomCode: string,
  sessionId: string,
  avatar: string,
) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode || !sessionId) return;

  if (hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const room = await fetchGameRoom(cleanCode);
      if (room && Array.isArray(room.players)) {
        const updated = room.players.map((p: any) =>
          p.session_id === sessionId ? { ...p, avatar } : p,
        );
        await client
          .from('game_states')
          .update({ players: updated, updated_at: new Date().toISOString() })
          .eq('room_code', cleanCode);
      }
    } catch (err) {
      throw new Error(`Supabase could not update the player avatar: ${errorMessage(err)}`, { cause: err });
    }
    return;
  }

  // Update in local mock storage
  const mock = getStoredRoom(cleanCode);
  if (mock && Array.isArray(mock.players)) {
    mock.players = mock.players.map((p: any) =>
      p.session_id === sessionId ? { ...p, avatar } : p,
    );
    mock.updated_at = new Date().toISOString();
    persistMockRoom(mock);
    notifyRoomListeners(cleanCode, mock, true);
  }
}

