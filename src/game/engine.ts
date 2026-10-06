import { ACTIVE_WEAPONS, calculateHitResult, hasAllWeapons } from './rules.ts';
import type { TargetState, WeaponType } from './rules.ts';

export interface PlayerAction {
  shooterId: number;
  weapon: WeaponType;
  targetIds: number[];
}

export interface EnginePlayer extends TargetState {
  id: number;
  connected: boolean;
  eliminationPoints: number;
}

export interface ResolvedHit {
  targetIndex: number;
  weapon: WeaponType;
  action: ReturnType<typeof calculateHitResult>['action'];
  shieldRemoved: boolean;
  eliminated: boolean;
}

export type ActionResolution =
  | { accepted: true; shooterIndex: number; lastTargetIndex: number; hits: ResolvedHit[] }
  | { accepted: false; reason: 'wrong_shooter' | 'unavailable_weapon' | 'invalid_targets' | 'needs_two_targets' | 'hook_requires_shield' };

/** The one mutation path shared by human and bot actions. */
export function resolvePlayerAction(
  players: EnginePlayer[],
  action: PlayerAction,
  currentShooterIndex: number,
  matchRound: number,
): ActionResolution {
  if (!action || !Array.isArray(action.targetIds)) return { accepted: false, reason: 'invalid_targets' };
  const shooterIndex = action.shooterId - 1;
  if (shooterIndex !== currentShooterIndex || !players[shooterIndex]?.alive || !players[shooterIndex]?.connected) {
    return { accepted: false, reason: 'wrong_shooter' };
  }

  const shooter = players[shooterIndex];
  if (!ACTIVE_WEAPONS.includes(action.weapon) || !shooter.weapons.includes(action.weapon)) {
    return { accepted: false, reason: 'unavailable_weapon' };
  }

  const targetCount = action.weapon === 'doublePeeranki' ? 2 : 1;
  if (action.targetIds.length !== targetCount) {
    return { accepted: false, reason: action.weapon === 'doublePeeranki' ? 'needs_two_targets' : 'invalid_targets' };
  }
  const targetIndexes = action.targetIds.map((id) => players.findIndex((player) => player.id === id));
  if (new Set(targetIndexes).size !== targetCount || targetIndexes.some((index) =>
    index < 0 || index === shooterIndex || !players[index]?.connected || !players[index]?.alive)) {
    return { accepted: false, reason: 'invalid_targets' };
  }

  const firstTarget = players[targetIndexes[0]];
  if (action.weapon === 'hook' && !firstTarget.weapons.includes('shield')) {
    return { accepted: false, reason: 'hook_requires_shield' };
  }

  const weaponSequence: WeaponType[] = action.weapon === 'doublePeeranki'
    ? ['peeranki', 'gun']
    : [action.weapon];
  const hits: ResolvedHit[] = [];
  targetIndexes.forEach((targetIndex, index) => {
    const target = players[targetIndex];
    const weapon = weaponSequence[index];
    const wasAlive = target.alive;
    const result = calculateHitResult(target, weapon, matchRound);
    target.stage = result.newStage;
    target.alive = result.alive;
    target.shieldDisabledRound = result.shieldDisabledRound;
    if (result.shieldRemoved) target.weapons = target.weapons.filter((owned) => owned !== 'shield');
    if (wasAlive && !target.alive && shooter.id !== target.id && hasAllWeapons(shooter.weapons)) {
      shooter.eliminationPoints += 1;
    }
    hits.push({ targetIndex, weapon, action: result.action, shieldRemoved: result.shieldRemoved, eliminated: wasAlive && !target.alive });
  });

  return { accepted: true, shooterIndex, lastTargetIndex: targetIndexes[targetIndexes.length - 1], hits };
}

/** Simple, legal bot strategy: favor immediate eliminations, strip shields, then damage. */
export function chooseBotAction(
  players: readonly EnginePlayer[],
  shooterIndex: number,
  matchRound: number,
  random: () => number = Math.random,
): PlayerAction | null {
  const shooter = players[shooterIndex];
  if (!shooter?.alive || !shooter.connected) return null;
  const targets = players
    .map((player, index) => ({ player, index }))
    .filter(({ player, index }) => index !== shooterIndex && player.alive && player.connected);
  if (targets.length === 0) return null;

  const options: Array<{ action: PlayerAction; score: number }> = [];
  const pick = <T,>(items: T[]): T => items[Math.min(items.length - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * items.length))];
  const add = (weapon: WeaponType, chosen: typeof targets, score: number) => {
    if (!shooter.weapons.includes(weapon)) return;
    options.push({ action: { shooterId: shooter.id, weapon, targetIds: chosen.map(({ player }) => player.id) }, score });
  };

  const unshielded = targets.filter(({ player }) =>
    !player.weapons.includes('shield') || player.shieldDisabledRound === matchRound);
  const shieldOwners = targets.filter(({ player }) => player.weapons.includes('shield'));
  unshielded.forEach((target) => add('peeranki', [target], target.player.stage === 2 ? 12 : 10));
  shieldOwners.forEach((target) => add('hook', [target], 9));
  unshielded.forEach((target) => add('gun', [target], target.player.stage === 2 ? 7 : 4));

  if (targets.length >= 2 && shooter.weapons.includes('doublePeeranki')) {
    const pair = [...targets].sort((a, b) => {
      const score = ({ player }: typeof a) =>
        (player.weapons.includes('shield') && player.shieldDisabledRound !== matchRound ? 0 : 3) + (player.stage === 2 ? 1 : 0);
      return score(b) - score(a);
    }).slice(0, 2);
    add('doublePeeranki', pair, 6 + pair.reduce((sum, item) => sum + (item.player.stage === 2 ? 1 : 0), 0));
  }

  if (options.length === 0) add('gun', [pick(targets)], 1);
  if (options.length === 0) return null;
  const highestScore = Math.max(...options.map(({ score }) => score));
  const best = options.filter(({ score }) => score === highestScore);
  return pick(best).action;
}
