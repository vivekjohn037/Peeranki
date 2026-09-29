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
) {
  if (
    maxPlayers < 6 ||
    maxPlayers > 10
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
      },
    ];

    const { data, error } = await supabase
      .from('game_states')
      .insert({
        room_code: roomCode,
        players: initialPlayers,
        max_players: maxPlayers,
        is_public: false,
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
) {
  const cleanCode = roomCode
    .trim()
    .toUpperCase();

  const cleanName = playerName.trim();

  if (!cleanCode || !cleanName) {
    return null;
  }

  const { data, error } =
    await supabase.rpc(
      'join_private_room',
      {
        p_room_code: cleanCode,
        p_player_name: cleanName,
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
) {
  const cleanName = playerName.trim();

  if (
    maxPlayers < 6 ||
    maxPlayers > 10 ||
    !cleanName
  ) {
    return null;
  }

  const { data, error } =
    await supabase.rpc(
      'find_or_create_public_room',
      {
        p_max_players: maxPlayers,
        p_player_name: cleanName,
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

        if (payload.new) {
          callback(payload.new);
        }
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
