// Predefined Animal-Themed Avatars for Peeranki Game

export type AnimalAvatarId = 'elephant' | 'tiger' | 'lion' | 'eagle' | 'leopard';

export interface AnimalAvatarDef {
  id: AnimalAvatarId;
  name: string;
  emoji: string;
  title: string;
  badge: string;
  color: string;
  borderColorHex: number;
  bgGradient: [string, string];
  description: string;
  svgPath: string;
}

export const ANIMAL_AVATARS: readonly AnimalAvatarDef[] = [
  {
    id: 'elephant',
    name: 'Royal Elephant',
    emoji: '🐘',
    title: 'Komban',
    badge: '🐘 KOMBAN',
    color: '#38bdf8',
    borderColorHex: 0x38bdf8,
    bgGradient: ['#1e3a8a', '#0284c7'],
    description: 'Majestic Kerala Tusker with sacred golden Nettipattam.',
    svgPath: 'assets/players/avatar_elephant.svg',
  },
  {
    id: 'tiger',
    name: 'Bengal Tiger',
    emoji: '🐅',
    title: 'Puli',
    badge: '🐅 PULI',
    color: '#fb923c',
    borderColorHex: 0xfb923c,
    bgGradient: ['#7c2d12', '#ea580c'],
    description: 'Fierce jungle apex predator with piercing amber gaze.',
    svgPath: 'assets/players/avatar_tiger.svg',
  },
  {
    id: 'lion',
    name: 'Regal Lion',
    emoji: '🦁',
    title: 'Simham',
    badge: '🦁 SIMHAM',
    color: '#facc15',
    borderColorHex: 0xfacc15,
    bgGradient: ['#854d0e', '#ca8a04'],
    description: 'Crowned battlefield monarch with golden battle coronet.',
    svgPath: 'assets/players/avatar_lion.svg',
  },
  {
    id: 'eagle',
    name: 'Golden Eagle',
    emoji: '🦅',
    title: 'Garudan',
    badge: '🦅 GARUDAN',
    color: '#34d399',
    borderColorHex: 0x34d399,
    bgGradient: ['#064e3b', '#059669'],
    description: 'Sharp-eyed sky sentinel with hooked golden talons.',
    svgPath: 'assets/players/avatar_eagle.svg',
  },
  {
    id: 'leopard',
    name: 'Shadow Leopard',
    emoji: '🐆',
    title: 'Panther',
    badge: '🐆 PANTHER',
    color: '#c084fc',
    borderColorHex: 0xc084fc,
    bgGradient: ['#4c1d95', '#7c3aed'],
    description: 'Silent midnight phantom with glowing emerald eyes.',
    svgPath: 'assets/players/avatar_leopard.svg',
  },
] as const;

export const AVATAR_IDS: AnimalAvatarId[] = ['elephant', 'tiger', 'lion', 'eagle', 'leopard'];

const AVATAR_STORAGE_KEY = 'peeranki_player_avatar';

export function getSelectedAvatarId(): AnimalAvatarId {
  try {
    const stored = localStorage.getItem(AVATAR_STORAGE_KEY);
    if (stored && (AVATAR_IDS as string[]).includes(stored)) {
      return stored as AnimalAvatarId;
    }
  } catch {
    // fallback
  }
  return 'elephant';
}

export function setSelectedAvatarId(id: AnimalAvatarId): void {
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

export function getAvatarDef(id?: string | null): AnimalAvatarDef {
  const found = ANIMAL_AVATARS.find((a) => a.id === id);
  return found || ANIMAL_AVATARS[0];
}

export function getBotAvatarId(botIndex: number): AnimalAvatarId {
  // Rotate predefined animal avatars for bots so each bot has a distinct animal
  return AVATAR_IDS[(botIndex + 1) % AVATAR_IDS.length];
}
