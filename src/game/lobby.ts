export function hasReadyQuorum(players: readonly { connected?: boolean; ready?: boolean }[], capacity: number): boolean {
  const connected = players.filter(player => player.connected !== false);
  return Number.isInteger(capacity) && capacity >= 3 && capacity <= 10 && connected.length === capacity && connected.every(player => player.ready === true);
}
