import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Supabase environment variables are missing. Check your .env file.'
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
);

function generateRoomCode(): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let code = '';

  for (let index = 0; index < 6; index += 1) {
    const randomIndex = Math.floor(
      Math.random() * characters.length,
    );

    code += characters[randomIndex];
  }

  return code;
}

export async function createRoom() {
  let roomCode = '';

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = generateRoomCode();

    const { data, error } = await supabase
      .from('game_states')
      .select('room_code')
      .eq('room_code', candidate)
      .maybeSingle();

    if (error) {
      console.error('Room check failed:', error);
      return null;
    }

    if (!data) {
      roomCode = candidate;
      break;
    }
  }

  if (!roomCode) {
    console.error('Could not generate a unique room code.');
    return null;
  }

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
      current_shooter: null,
      countdown: 0,
      game_status: 'waiting',
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('Room creation failed:', error);
    return null;
  }

  return data;
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
    console.error('Room code and player name are required.');
    return null;
  }

  const { data: room, error: roomError } = await supabase
    .from('game_states')
    .select('*')
    .eq('room_code', cleanCode)
    .maybeSingle();

  if (roomError) {
    console.error('Room lookup failed:', roomError);
    return null;
  }

  if (!room) {
    console.error('Room does not exist.');
    return null;
  }

  if (room.game_status !== 'waiting') {
    console.error('This game has already started.');
    return null;
  }

  const currentPlayers = Array.isArray(room.players)
    ? room.players
    : [];

  if (currentPlayers.length >= 6) {
    console.error('Room is full.');
    return null;
  }

  const existingPlayer = currentPlayers.find(
    (player: any) =>
      String(player.name ?? '').trim().toLowerCase() ===
      cleanName.toLowerCase(),
  );

  if (existingPlayer) {
    console.error('That player name is already in use.');
    return null;
  }

  const newPlayer = {
    id: currentPlayers.length + 1,
    name: cleanName,
    stage: 0,
    alive: true,
  };

  const updatedPlayers = [
    ...currentPlayers,
    newPlayer,
  ];

  const { data, error } = await supabase
    .from('game_states')
    .update({
      players: updatedPlayers,
      updated_at: new Date().toISOString(),
    })
    .eq('room_code', cleanCode)
    .eq('game_status', 'waiting')
    .select()
    .single();

  if (error) {
    console.error('Joining room failed:', error);
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

  const { data, error } = await supabase
    .from('game_states')
    .select('*')
    .eq('room_code', cleanCode)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch room:', error);
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
  currentShooter: number | null,
  countNumber: number,
  gameStatus: string,
) {
  const cleanCode = roomCode
    .trim()
    .toUpperCase();

  if (!cleanCode) {
    return;
  }

  const { error } = await supabase
    .from('game_states')
    .update({
      players,
      current_shooter: currentShooter,
      countdown: countNumber,
      game_status: gameStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('room_code', cleanCode);

  if (error) {
    console.error('Failed to save game state:', error);
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
    .channel(`game-state-${cleanCode}`)
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
          '📡 Game state received:',
          payload.new,
        );

        if (payload.new) {
          callback(payload.new);
        }
      },
    )
    .subscribe((status, error) => {
      console.log('Realtime status:', status);

      if (error) {
        console.error('Realtime error:', error);
      }
    });

  return channel;
}
