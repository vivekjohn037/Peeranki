import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Supabase environment variables are missing. Check your .env file.',
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
);

function generateRoomCode() {
  const characters =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let code = '';

  for (let index = 0; index < 6; index += 1) {
    const randomIndex = Math.floor(
      Math.random() * characters.length,
    );

    code += characters[randomIndex];
  }

  return code;
}

export async function createPrivateRoom(
  maxPlayers: number,
  sessionId: string,
) {
  if (
    maxPlayers < 6 ||
    maxPlayers > 10 ||
    !sessionId
  ) {
    return null;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const roomCode = generateRoomCode();

    const initialPlayers = [
      {
        id: 1,
        name: 'Player 1',
        stage: 0,
        alive: true,
        session_id: sessionId,
        connected: true,
        last_seen: new Date().toISOString(),
      },
    ];

    const { data, error } = await supabase
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

    if (
      error &&
      !String(error.message)
        .toLowerCase()
        .includes('duplicate')
    ) {
      console.error(
        'Private room creation failed:',
        error,
      );
      return null;
    }
  }

  console.error(
    'Could not generate a unique private room code.',
  );

  return null;
}

export async function joinRoom(
  roomCode: string,
  playerName: string,
  sessionId: string,
) {
  const cleanCode = roomCode
    .trim()
    .toUpperCase();
  const cleanName = playerName.trim();

  if (!cleanCode || !cleanName || !sessionId) {
    return null;
  }

  const { data, error } = await supabase.rpc(
    'join_private_room',
    {
      p_room_code: cleanCode,
      p_player_name: cleanName,
      p_session_id: sessionId,
    },
  );

  if (error) {
    console.error(
      'Join room failed:',
      error,
    );
    return null;
  }

  return data;
}

export async function findOrCreateRandomRoom(
  maxPlayers: number,
  playerName: string,
  sessionId: string,
) {
  const cleanName = playerName.trim();

  if (
    maxPlayers < 6 ||
    maxPlayers > 10 ||
    !cleanName ||
    !sessionId
  ) {
    return null;
  }

  const { data, error } = await supabase.rpc(
    'find_or_create_public_room',
    {
      p_max_players: maxPlayers,
      p_player_name: cleanName,
      p_session_id: sessionId,
    },
  );

  if (error) {
    console.error(
      'Random matchmaking failed:',
      error,
    );
    return null;
  }

  return data;
}

export async function fetchGameRoom(
  roomCode: string,
) {
  const cleanCode = roomCode
    .trim()
    .toUpperCase();

  if (!cleanCode) {
    return null;
  }

  const { data, error } = await supabase
    .from('game_states')
    .select('*')
    .eq('room_code', cleanCode)
    .maybeSingle();

  if (error) {
    console.error(
      'Failed to fetch room:',
      error,
    );
    return null;
  }

  return data;
}

export async function getGameState(
  roomCode: string,
) {
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
  const cleanCode = roomCode
    .trim()
    .toUpperCase();

  if (
    !cleanCode ||
    maxPlayers < 6 ||
    maxPlayers > 10
  ) {
    return;
  }

  const { error } = await supabase
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
    console.error(
      'Failed to save game state:',
      error,
    );
  }
}

export async function touchPlayer(
  roomCode: string,
  sessionId: string,
) {
  const cleanCode = roomCode
    .trim()
    .toUpperCase();

  if (!cleanCode || !sessionId) {
    return null;
  }

  const { data, error } = await supabase.rpc(
    'touch_player',
    {
      p_room_code: cleanCode,
      p_session_id: sessionId,
    },
  );

  if (error) {
    console.error(
      'Heartbeat failed:',
      error,
    );
    return null;
  }

  return data;
}

export async function cleanupStalePlayers(
  roomCode: string,
  staleSeconds = 30,
) {
  const cleanCode = roomCode
    .trim()
    .toUpperCase();

  if (!cleanCode) {
    return null;
  }

  const { data, error } = await supabase.rpc(
    'cleanup_stale_players',
    {
      p_room_code: cleanCode,
      p_stale_seconds: staleSeconds,
    },
  );

  if (error) {
    console.error(
      'Stale-player cleanup failed:',
      error,
    );
    return null;
  }

  return data;
}

export async function leaveRoom(
  roomCode: string,
  sessionId: string,
) {
  const cleanCode = roomCode
    .trim()
    .toUpperCase();

  if (!cleanCode || !sessionId) {
    return null;
  }

  const { data, error } = await supabase.rpc(
    'leave_room',
    {
      p_room_code: cleanCode,
      p_session_id: sessionId,
    },
  );

  if (error) {
    console.error(
      'Leave room failed:',
      error,
    );
    return null;
  }

  return data;
}

export function leaveRoomBestEffort(
  roomCode: string,
  sessionId: string,
) {
  const cleanCode = roomCode
    .trim()
    .toUpperCase();

  if (!cleanCode || !sessionId) {
    return;
  }

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
    // Best-effort only during page shutdown.
  }
}

export function subscribeToGameState(
  roomCode: string,
  callback: (gameState: any) => void,
) {
  const cleanCode = roomCode
    .trim()
    .toUpperCase();

  const channel = supabase
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
        console.log(
          '📡 Peeranki room update:',
          payload.new,
        );

        callback(payload.new ?? null);
      },
    )
    .subscribe((status, error) => {
      console.log(
        'Realtime status:',
        status,
      );

      if (error) {
        console.error(
          'Realtime error:',
          error,
        );
      }
    });

  return channel;
}
