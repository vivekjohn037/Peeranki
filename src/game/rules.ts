export type WeaponType = 'gun' | 'peeranki' | 'shield' | 'hook' | 'doublePeeranki';
export type RpsChoice = 'rock' | 'paper' | 'scissors';

export const WEAPON_ORDER: WeaponType[] = ['gun', 'peeranki', 'shield', 'hook', 'doublePeeranki'];
export const ACTIVE_WEAPONS: WeaponType[] = ['gun', 'peeranki', 'hook', 'doublePeeranki'];

export const WEAPON_LABELS: Record<WeaponType, string> = {
  gun: '🔫 Gun',
  peeranki: '⚡ Peeranki',
  shield: '🛡️ Shield',
  hook: '🪝 Hook',
  doublePeeranki: '💥 Double Peeranki',
};

export const WEAPON_NAMES: Record<WeaponType, string> = {
  gun: 'Gun',
  peeranki: 'Peeranki',
  shield: 'Shield',
  hook: 'Hook',
  doublePeeranki: 'Double Peeranki',
};

export const RPS_CHOICES: RpsChoice[] = ['rock', 'paper', 'scissors'];

export const RPS_LABELS: Record<RpsChoice, string> = {
  rock: '🪨 Rock',
  paper: '📄 Paper',
  scissors: '✂️ Scissors',
};

export const RPS_BEATS: Record<RpsChoice, RpsChoice> = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

export const MATCH_DURATIONS = [3, 5, 10, 15] as const;

export interface CountablePlayer {
  stage: number;
  alive: boolean;
  connected?: boolean;
}

/** Return the zero-based player selected by a one-based tower count (1–10). */
export function getCountedPlayerIndex(
  players: readonly CountablePlayer[],
  startIndex: number,
  count: number,
): number {
  if (!Number.isInteger(count) || count < 1 || count > 10) return -1;
  const alive = players
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => player.alive && player.connected !== false && player.stage < 3);
  if (alive.length === 0) return -1;

  const startPosition = alive.findIndex(({ index }) => index === startIndex);
  const rotated = startPosition < 0
    ? alive
    : [...alive.slice(startPosition), ...alive.slice(0, startPosition)];
  const sequence: number[] = [];
  rotated.forEach(({ player, index }) => {
    const towers = player.stage === 1 ? 2 : player.stage === 0 || player.stage === 2 ? 1 : 0;
    for (let tower = 0; tower < towers; tower += 1) sequence.push(index);
  });
  if (sequence.length === 0) return -1;
  return sequence[(count - 1) % sequence.length] ?? -1;
}

/** Continue after the target that was shot, skipping it only if it is no longer active. */
export function getNextCountingStartIndex(
  players: readonly CountablePlayer[],
  targetIndex: number,
): number {
  const target = players[targetIndex];
  if (target?.alive && target.connected !== false) return targetIndex;
  for (let offset = 1; offset < players.length; offset += 1) {
    const index = (targetIndex + offset + players.length) % players.length;
    const candidate = players[index];
    if (candidate?.alive && candidate.connected !== false) return index;
  }
  return -1;
}

export function hasAllWeapons(weapons: readonly WeaponType[]): boolean {
  return WEAPON_ORDER.every((weapon) => weapons.includes(weapon));
}

export function findMatchWinners<T extends { weapons: readonly WeaponType[] }>(players: readonly T[]): T[] {
  if (players.length === 0) return [];
  const highestCount = Math.max(...players.map((player) => player.weapons.length));
  return players.filter((player) => player.weapons.length === highestCount);
}

export function resolveRpsWinner(c1: RpsChoice, c2: RpsChoice): 'first' | 'second' | 'tie' {
  if (c1 === c2) return 'tie';
  return RPS_BEATS[c1] === c2 ? 'first' : 'second';
}

export function normalizeWeapons(value: unknown): WeaponType[] {
  if (!Array.isArray(value)) return ['gun'];
  const valid = value.filter((weapon): weapon is WeaponType =>
    typeof weapon === 'string' && WEAPON_ORDER.includes(weapon as WeaponType));
  const available = new Set<WeaponType>(valid);
  const normalized: WeaponType[] = ['gun'];
  WEAPON_ORDER.slice(1).forEach((weapon, index) => {
    const prerequisites = WEAPON_ORDER.slice(1, index + 1);
    if (available.has(weapon) && prerequisites.every((prerequisite) => normalized.includes(prerequisite))) {
      normalized.push(weapon);
    }
  });
  return normalized;
}

export function nextWeaponUpgrade(weapons: WeaponType[], round: number): WeaponType | undefined {
  const eligible = WEAPON_ORDER.slice(1, Math.min(round, WEAPON_ORDER.length - 1) + 1);
  return eligible.find((weapon) => {
    const index = WEAPON_ORDER.indexOf(weapon);
    const prerequisites = WEAPON_ORDER.slice(1, index);
    return !weapons.includes(weapon) && prerequisites.every((prerequisite) => weapons.includes(prerequisite));
  });
}

export function normalizeRpsChoice(value: unknown): RpsChoice | null {
  return typeof value === 'string' && RPS_CHOICES.includes(value as RpsChoice)
    ? value as RpsChoice
    : null;
}

export interface TargetState {
  stage: number;
  alive: boolean;
  weapons: WeaponType[];
  shieldDisabledRound: number;
}

export function calculateHitResult(
  target: TargetState,
  weapon: WeaponType,
  matchRound: number,
): {
  action: 'shield_destroyed_permanently' | 'shield_destroyed_for_round' | 'shield_absorbed' | 'no_shield_for_hook' | 'tower_split' | 'last_tower' | 'eliminated';
  shieldRemoved: boolean;
  shieldDisabledRound: number;
  newStage: number;
  alive: boolean;
} {
  const hasShield = target.weapons.includes('shield') && target.shieldDisabledRound !== matchRound;

  if (weapon === 'hook') {
    // Hook removes the Shield itself, even if Peeranki disabled it for this round.
    if (target.weapons.includes('shield')) {
      return {
        action: 'shield_destroyed_permanently',
        shieldRemoved: true,
        shieldDisabledRound: target.shieldDisabledRound,
        newStage: target.stage,
        alive: target.alive,
      };
    }
    return {
      action: 'no_shield_for_hook',
      shieldRemoved: false,
      shieldDisabledRound: target.shieldDisabledRound,
      newStage: target.stage,
      alive: target.alive,
    };
  }

  if (hasShield && (weapon === 'gun' || weapon === 'peeranki')) {
    if (weapon === 'peeranki') {
      return {
        action: 'shield_destroyed_for_round',
        shieldRemoved: false,
        shieldDisabledRound: matchRound,
        newStage: target.stage,
        alive: target.alive,
      };
    }
    return {
      action: 'shield_absorbed',
      shieldRemoved: false,
      shieldDisabledRound: target.shieldDisabledRound,
      newStage: target.stage,
      alive: target.alive,
    };
  }

  if (weapon === 'peeranki') {
    return {
      action: 'eliminated',
      shieldRemoved: false,
      shieldDisabledRound: target.shieldDisabledRound,
      newStage: 3,
      alive: false,
    };
  }

  // Gun or default attack without shield
  const nextStage = target.stage + 1;
  if (nextStage >= 3) {
    return {
      action: 'eliminated',
      shieldRemoved: false,
      shieldDisabledRound: target.shieldDisabledRound,
      newStage: 3,
      alive: false,
    };
  }

  return {
    action: nextStage === 1 ? 'tower_split' : 'last_tower',
    shieldRemoved: false,
    shieldDisabledRound: target.shieldDisabledRound,
    newStage: nextStage,
    alive: true,
  };
}
