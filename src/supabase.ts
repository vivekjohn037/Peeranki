import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

function validPlayerCount(value: number) {
  return Number.isInteger(value) && value >= MIN_PLAYERS && value <= MAX_PLAYERS;
}

const globalEnv = typeof globalThis !== 'undefined' ? (globalThis as any).process?.env : undefined;
const supabaseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || globalEnv?.VITE_SUPABASE_URL;
const supabaseKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) || globalEnv?.VITE_SUPABASE_PUBLISHABLE_KEY;

const isSupabaseConfigured = Boolean(
  typeof supabaseUrl === 'string' &&
  supabaseUrl.trim().startsWith('http') &&
  typeof supabaseKey === 'string' &&
  supabaseKey.trim().length > 0,
);

const hasAnySupabaseConfiguration = [supabaseUrl, supabaseKey].some(
  (value) => typeof value === 'string' && value.trim().length > 0,
);

let realClient: SupabaseClient | null = null;
let clientInitializationError: unknown;

if (isSupabaseConfigured) {
  try {
    realClient = createClient(supabaseUrl.trim(), supabaseKey.trim());
  } catch (err) {
    console.error('[Peeranki] Failed to initialize configured Supabase client:', err);
    clientInitializationError = err;
    realClient = null;
  }
} else if (!hasAnySupabaseConfiguration) {
  console.info('[Peeranki] Supabase environment variables not configured; running with local in-memory/broadcast room manager.');
} else {
  clientInitializationError = new Error('Both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required.');
  console.error('[Peeranki] Supabase configuration is incomplete; online rooms are unavailable.');
}

function configuredClient(): SupabaseClient {
  if (realClient) return realClient;
  throw new Error(
    `Supabase is configured but unavailable: ${errorMessage(clientInitializationError)}. Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.`,
    { cause: clientInitializationError },
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
  game_status: string;
  updated_at: string;
  created_at?: string;
  [key: string]: any;
}

const STORAGE_PREFIX = 'peeranki_room_';
const mockRoomsMemory = new Map<string, MockRoomRecord>();
const listenersByRoom = new Map<string, Set<(state: any) => void>>();
const roomEventListenersByRoom = new Map<string, Set<(event: string, payload: any) => void>>();
const ROOM_EVENT_NAMES = new Set(['player_action_request', 'duel_choice_request']);

let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel('peeranki_room_sync');
    broadcastChannel.onmessage = (event) => {
      const { type, roomCode, data, event: roomEvent, payload } = event.data || {};
      if (type === 'ROOM_UPDATE' && roomCode && data) {
        mockRoomsMemory.set(roomCode, data);
        notifyRoomListeners(roomCode, data, false);
      } else if (type === 'ROOM_EVENT' && roomCode && ROOM_EVENT_NAMES.has(roomEvent)) {
        notifyRoomEventListeners(roomCode, roomEvent, payload);
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
  if (broadcast && broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'ROOM_UPDATE', roomCode, data: state });
    } catch {
      // ignore
    }
  }
}

function notifyRoomEventListeners(
  roomCode: string,
  event: string,
  payload: any,
  except?: (event: string, payload: any) => void,
) {
  const listeners = roomEventListenersByRoom.get(roomCode);
  if (!listeners) return;
  listeners.forEach((listener) => {
    if (listener === except) return;
    try {
      listener(event, payload);
    } catch (err) {
      console.error('[Peeranki] Room event listener error:', err);
    }
  });
}

function updateMockRoomPartial(code: string, updates: Partial<MockRoomRecord>) {
  const room = getStoredRoom(code);
  if (!room) return null;
  const updated: MockRoomRecord = {
    ...room,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  persistMockRoom(updated);
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
    return null;
  }

  const hostName = playerName.trim() || 'Player 1';

  if (hasAnySupabaseConfiguration) {
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

        if (error && !String(error.message).toLowerCase().includes('duplicate')) {
          throw new Error(`Supabase room creation failed: ${error.message}`);
        }
      }
      throw new Error('Supabase could not generate a unique room code after several attempts.');
    } catch (err) {
      throw new Error(`Supabase room creation failed: ${errorMessage(err)}`, { cause: err });
    }
  }

  // Local mock room creation
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

  if (!cleanCode || !cleanName || !sessionId) {
    return null;
  }

  if (hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('join_private_room', {
        p_room_code: cleanCode,
        p_player_name: cleanName,
        p_session_id: sessionId,
      });

      if (error) throw new Error(error.message);
      return data;
    } catch (err) {
      throw new Error(`Supabase could not join room ${cleanCode}: ${errorMessage(err)}`, { cause: err });
    }
  }

  // Local mock room join
  const room = getStoredRoom(cleanCode);
  if (!room) {
    return null;
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
      return null;
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
    return null;
  }

  if (hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('find_or_create_public_room', {
        p_max_players: maxPlayers,
        p_player_name: cleanName,
        p_session_id: sessionId,
      });

      if (error) throw new Error(error.message);
      return data;
    } catch (err) {
      throw new Error(`Supabase matchmaking failed: ${errorMessage(err)}`, { cause: err });
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
    game_status: 'waiting',
    updated_at: new Date().toISOString(),
  };

  persistMockRoom(newPublicRoom);
  return newPublicRoom;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchGameRoom(roomCode: string) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode) return null;

  if (hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client
        .from('game_states')
        .select('*')
        .eq('room_code', cleanCode)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (err) {
      throw new Error(`Supabase could not load room ${cleanCode}: ${errorMessage(err)}`, { cause: err });
    }
  }

  return getStoredRoom(cleanCode);
}

export async function getGameState(roomCode: string) {
  return fetchGameRoom(roomCode);
}

export async function saveGameState(
  roomCode: string,
  players: unknown[],
  maxPlayers: number,
  currentShooter: number | null,
  countNumber: number,
  gameStatus: string,
) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode || !validPlayerCount(maxPlayers)) {
    return;
  }

  if (hasAnySupabaseConfiguration) {
    const client = configuredClient();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const { error } = await client
        .from('game_states')
        .update({
          players,
          max_players: maxPlayers,
          current_shooter: currentShooter,
          countdown: countNumber,
          game_status: gameStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('room_code', cleanCode)
        .abortSignal(controller.signal);

      if (error) {
        throw error;
      }
    } catch (err) {
      throw new Error(`Supabase could not save game state: ${errorMessage(err)}`, { cause: err });
    } finally {
      window.clearTimeout(timeout);
    }
    return;
  }

  // Also update local mock room
  updateMockRoomPartial(cleanCode, {
    players: players as any[],
    max_players: maxPlayers,
    current_shooter: currentShooter,
    countdown: countNumber,
    game_status: gameStatus,
  });
}

export async function touchPlayer(roomCode: string, sessionId: string) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode || !sessionId) return null;

  if (hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('touch_player', {
        p_room_code: cleanCode,
        p_session_id: sessionId,
      });
      if (error) throw error;
      return data;
    } catch (err) {
      throw new Error(`Supabase player heartbeat failed: ${errorMessage(err)}`, { cause: err });
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

  if (hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('cleanup_stale_players', {
        p_room_code: cleanCode,
        p_stale_seconds: staleSeconds,
      });
      if (error) throw error;
      return data;
    } catch (err) {
      throw new Error(`Supabase stale-player cleanup failed: ${errorMessage(err)}`, { cause: err });
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

  if (hasAnySupabaseConfiguration) {
    const client = configuredClient();
    try {
      const { data, error } = await client.rpc('leave_room', {
        p_room_code: cleanCode,
        p_session_id: sessionId,
      });
      if (error) throw error;
      return data;
    } catch (err) {
      throw new Error(`Supabase could not leave room ${cleanCode}: ${errorMessage(err)}`, { cause: err });
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

export function subscribeToGameState(
  roomCode: string,
  callback: (gameState: any) => void,
  onRoomEvent?: (event: string, payload: any) => void,
) {
  const cleanCode = roomCode.trim().toUpperCase();

  let realChannel: any = null;
  let realtimeStatus = 'CLOSED';
  if (onRoomEvent) {
    if (!roomEventListenersByRoom.has(cleanCode)) roomEventListenersByRoom.set(cleanCode, new Set());
    roomEventListenersByRoom.get(cleanCode)!.add(onRoomEvent);
  }

  if (hasAnySupabaseConfiguration) {
    try {
      const client = configuredClient();
      realChannel = client
        .channel(`peeranki-room-${cleanCode}`, { config: { broadcast: { self: false, ack: true } } })
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'game_states',
            filter: `room_code=eq.${cleanCode}`,
          },
          (payload) => {
            callback(payload.new ?? null);
          },
        )
        .on('broadcast', { event: 'player_action_request' }, ({ payload }) => {
          onRoomEvent?.('player_action_request', payload);
        })
        .on('broadcast', { event: 'duel_choice_request' }, ({ payload }) => {
          onRoomEvent?.('duel_choice_request', payload);
        })
        .subscribe((status, error) => {
          realtimeStatus = status;
          if (error) {
            console.error('[Peeranki] Supabase realtime error:', error);
          }
        });
    } catch (err) {
      console.error('[Peeranki] Failed to subscribe to Supabase realtime:', err);
    }
  } else {
    // Local listeners are only valid in explicitly unconfigured mode.
    if (!listenersByRoom.has(cleanCode)) listenersByRoom.set(cleanCode, new Set());
    listenersByRoom.get(cleanCode)!.add(callback);
  }

  return {
    sendEvent: async (event: string, payload: any) => {
      if (!ROOM_EVENT_NAMES.has(event)) {
        throw new Error(`Unsupported room event: ${event}`);
      }

      if (hasAnySupabaseConfiguration) {
        if (!realChannel || realtimeStatus !== 'SUBSCRIBED') {
          throw new Error(`The online room connection is not ready (${realtimeStatus}). Please try again.`);
        }
        try {
          const status = await realChannel.send({ type: 'broadcast', event, payload });
          if (status !== 'ok') {
            throw new Error(`Realtime returned ${status}`);
          }
        } catch (err) {
          throw new Error(`Supabase could not send the room action: ${errorMessage(err)}`, { cause: err });
        }
        return;
      }

      const peerListeners = roomEventListenersByRoom.get(cleanCode);
      const hasLocalPeer = Boolean(peerListeners && [...peerListeners].some((listener) => listener !== onRoomEvent));
      if (!broadcastChannel && !hasLocalPeer) {
        throw new Error('Cross-device online play requires Supabase to be configured.');
      }
      notifyRoomEventListeners(cleanCode, event, payload, onRoomEvent);
      if (broadcastChannel) {
        try {
          broadcastChannel.postMessage({ type: 'ROOM_EVENT', roomCode: cleanCode, event, payload });
        } catch (err) {
          throw new Error(`Could not send the local room action: ${errorMessage(err)}`, { cause: err });
        }
      }
    },
    unsubscribe: async () => {
      listenersByRoom.get(cleanCode)?.delete(callback);
      if (onRoomEvent) {
        roomEventListenersByRoom.get(cleanCode)?.delete(onRoomEvent);
      }
      if (realChannel) {
        try {
          await realChannel.unsubscribe();
        } catch (err) {
          console.error('[Peeranki] Supabase realtime unsubscribe failed:', err);
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

