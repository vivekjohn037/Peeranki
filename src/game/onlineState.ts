interface Snapshot { game_status?: string; players?: Array<{ match_round?: number; duel_round?: number }>; }

export function roomRounds(state: Snapshot) {
  const players = Array.isArray(state.players) ? state.players : [];
  const highest = (key: 'match_round' | 'duel_round') => Math.max(0, ...players.map(player => Number.isInteger(player?.[key]) && player[key]! > 0 ? player[key]! : 0));
  return { matchRound: highest('match_round'), duelRound: highest('duel_round') };
}

/** Used for both Realtime delivery and direct polling recovery of a game scene. */
export function canApplyGameSnapshot(
  current: { matchRound: number; duelRound: number; duelActive: boolean },
  snapshot: Snapshot,
  endsMatchAfterDeparture = false,
): boolean {
  const incoming = roomRounds(snapshot);
  if (incoming.matchRound > 0 && incoming.matchRound < current.matchRound) return false;
  // A later round is authoritative even if the client never received round_won.
  if (incoming.matchRound > current.matchRound) return true;
  if (current.duelActive && snapshot.game_status === 'duel' && incoming.duelRound > 0 && incoming.duelRound < current.duelRound) return false;
  if (current.duelActive && !['duel', 'round_won', 'finished'].includes(snapshot.game_status ?? '') && !endsMatchAfterDeparture) return false;
  return true;
}
