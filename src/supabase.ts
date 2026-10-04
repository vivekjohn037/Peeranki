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

let realClient: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  try {
    realClient = createClient(supabaseUrl.trim(), supabaseKey.trim());
  } catch (err) {
    console.warn('[Peeranki] Failed to initialize Supabase client:', err);
    realClient = null;
  }
} else {
  console.info('[Peeranki] Supabase environment variables not configured; running with local in-memory/broadcast room manager.');
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

let broadcastChannel: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel('peeranki_room_sync');
    broadcastChannel.onmessage = (event) => {
      const { type, roomCode, data } = event.data || {};
      if (type === 'ROOM_UPDATE' && roomCode && data) {
        mockRoomsMemory.set(roomCode, data);
        notifyRoomListeners(roomCode, data, false);
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

export const supabase: any = realClient ?? mockSupabaseProxy;

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

  if (realClient) {
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

        const { data, error } = await realClient
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
          console.warn('[Peeranki] Real Supabase private room creation failed, falling back to local store:', error);
          break;
        }
      }
    } catch (err) {
      console.warn('[Peeranki] Real Supabase error on createPrivateRoom:', err);
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

  if (realClient) {
    try {
      const { data, error } = await realClient.rpc('join_private_room', {
        p_room_code: cleanCode,
        p_player_name: cleanName,
        p_session_id: sessionId,
      });

      if (!error && data) {
        return data;
      }
      console.warn('[Peeranki] Real Supabase join room failed, falling back to local store:', error);
    } catch (err) {
      console.warn('[Peeranki] Real Supabase join error:', err);
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

  if (realClient) {
    try {
      const { data, error } = await realClient.rpc('find_or_create_public_room', {
        p_max_players: maxPlayers,
        p_player_name: cleanName,
        p_session_id: sessionId,
      });

      if (!error && data) {
        return data;
      }
      console.warn('[Peeranki] Real Supabase matchmaking failed, falling back to local store:', error);
    } catch (err) {
      console.warn('[Peeranki] Real Supabase matchmaking error:', err);
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

export async function fetchGameRoom(roomCode: string) {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!cleanCode) return null;

  if (realClient) {
    try {
      const { data, error } = await realClient
        .from('game_states')
        .select('*')
        .eq('room_code', cleanCode)
        .maybeSingle();

      if (!error && data) {
        return data;
      }
    } catch (err) {
      console.warn('[Peeranki] Real Supabase fetch room error:', err);
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

  if (realClient) {
    try {
      const { error } = await realClient
        .from('game_states')
        .update({
          players,
          max_players: maxPlayers,
          current_shooter: currentShooter,
          countdown: countNumber,
          game_status: gameStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('room_code', cleanCode);

      if (error) {
        console.warn('[Peeranki] Failed to save game state to Supabase:', error);
      }
    } catch (err) {
      console.warn('[Peeranki] Save game state error:', err);
    }
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

  if (realClient) {
    try {
      const { data, error } = await realClient.rpc('touch_player', {
        p_room_code: cleanCode,
        p_session_id: sessionId,
      });
      if (!error) return data;
    } catch {
      // fallback
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

  if (realClient) {
    try {
      const { data, error } = await realClient.rpc('cleanup_stale_players', {
        p_room_code: cleanCode,
        p_stale_seconds: staleSeconds,
      });
      if (!error) return data;
    } catch {
      // fallback
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

  if (realClient) {
    try {
      const { data, error } = await realClient.rpc('leave_room', {
        p_room_code: cleanCode,
        p_session_id: sessionId,
      });
      if (!error) return data;
    } catch {
      // fallback
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

  if (isSupabaseConfigured) {
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

  void leaveRoom(cleanCode, sessionId);
}

export function subscribeToGameState(
  roomCode: string,
  callback: (gameState: any) => void,
) {
  const cleanCode = roomCode.trim().toUpperCase();

  // Register local subscriber
  if (!listenersByRoom.has(cleanCode)) {
    listenersByRoom.set(cleanCode, new Set());
  }
  listenersByRoom.get(cleanCode)!.add(callback);

  let realChannel: any = null;
  if (realClient) {
    try {
      realChannel = realClient
        .channel(`peeranki-room-${cleanCode}`)
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
        .subscribe((_status, error) => {
          if (error) {
            console.warn('[Peeranki] Supabase realtime error:', error);
          }
        });
    } catch (err) {
      console.warn('[Peeranki] Failed to subscribe to Supabase realtime:', err);
    }
  }

  return {
    unsubscribe: async () => {
      listenersByRoom.get(cleanCode)?.delete(callback);
      if (realChannel) {
        try {
          await realChannel.unsubscribe();
        } catch {
          // ignore
        }
      }
    },
  };
}
