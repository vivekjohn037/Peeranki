import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEAPON_ORDER,
  ACTIVE_WEAPONS,
  normalizeWeapons,
  nextWeaponUpgrade,
  resolveRpsWinner,
  calculateHitResult,
  MATCH_DURATIONS,
  getCountedPlayerIndex,
  getNextCountingStartIndex,
  hasAllWeapons,
  findMatchWinners,
} from '../src/game/rules.ts';
import { chooseBotAction, resolvePlayerAction } from '../src/game/engine.ts';
import {
  broadcastRoomStateDelta,
  createPrivateRoom,
  joinRoom,
  findOrCreateRandomRoom,
  getGameState,
  saveGameState,
  touchPlayer,
  leaveRoom,
  subscribeToGameState,
} from '../src/supabase.ts';

test('1. WEAPON DEFINITIONS & SEQUENCING', async (t) => {
  await t.test('Order starts with gun and contains exactly 5 progression tiers', () => {
    assert.deepEqual(WEAPON_ORDER, ['gun', 'peeranki', 'shield', 'hook', 'doublePeeranki']);
    assert.equal(ACTIVE_WEAPONS.includes('shield'), false, 'Shield is passive, not active weapon');
    assert.equal(ACTIVE_WEAPONS.length, 4);
  });

  await t.test('normalizeWeapons validates and enforces prerequisites', () => {
    // Empty or non-array defaults to ['gun']
    assert.deepEqual(normalizeWeapons(null), ['gun']);
    assert.deepEqual(normalizeWeapons(undefined), ['gun']);
    assert.deepEqual(normalizeWeapons([]), ['gun']);

    // Valid progression
    assert.deepEqual(normalizeWeapons(['gun', 'peeranki']), ['gun', 'peeranki']);
    assert.deepEqual(normalizeWeapons(['gun', 'peeranki', 'shield']), ['gun', 'peeranki', 'shield']);

    // Attempting to skip prerequisites should be stripped
    assert.deepEqual(normalizeWeapons(['gun', 'hook']), ['gun']);
    assert.deepEqual(normalizeWeapons(['gun', 'doublePeeranki']), ['gun']);
  });

  await t.test('nextWeaponUpgrade awards weapons round by round sequentially', () => {
    // Player has only gun in round 1
    const up1 = nextWeaponUpgrade(['gun'], 1);
    assert.equal(up1, 'peeranki');

    // Player wins round 2
    const up2 = nextWeaponUpgrade(['gun', 'peeranki'], 2);
    assert.equal(up2, 'shield');

    // Player wins round 3
    const up3 = nextWeaponUpgrade(['gun', 'peeranki', 'shield'], 3);
    assert.equal(up3, 'hook');

    // Player wins round 4
    const up4 = nextWeaponUpgrade(['gun', 'peeranki', 'shield', 'hook'], 4);
    assert.equal(up4, 'doublePeeranki');

    // All collected
    const up5 = nextWeaponUpgrade(['gun', 'peeranki', 'shield', 'hook', 'doublePeeranki'], 5);
    assert.equal(up5, undefined, 'No more upgrades when all collected');
  });
});

test('2. COMBAT & SHIELD DAMAGE MECHANICS', async (t) => {
  await t.test('Gun is absorbed by active shield without health loss', () => {
    const target = { stage: 0, alive: true, weapons: ['gun', 'shield'], shieldDisabledRound: -1 };
    const res = calculateHitResult(target, 'gun', 1);
    assert.equal(res.action, 'shield_absorbed');
    assert.equal(res.newStage, 0);
    assert.equal(res.alive, true);
  });

  await t.test('Peeranki disables shield for current round without health loss', () => {
    const target = { stage: 0, alive: true, weapons: ['gun', 'shield'], shieldDisabledRound: -1 };
    const res = calculateHitResult(target, 'peeranki', 1);
    assert.equal(res.action, 'shield_destroyed_for_round');
    assert.equal(res.shieldDisabledRound, 1);
    assert.equal(res.newStage, 0);
    assert.equal(res.alive, true);
  });

  await t.test('Gun damages target once shield is disabled for round', () => {
    // Shield disabled for round 1
    const target = { stage: 0, alive: true, weapons: ['gun', 'shield'], shieldDisabledRound: 1 };
    const res1 = calculateHitResult(target, 'gun', 1);
    assert.equal(res1.action, 'tower_split');
    assert.equal(res1.newStage, 1);
    assert.equal(res1.alive, true);

    const targetStage1 = { stage: 1, alive: true, weapons: ['gun', 'shield'], shieldDisabledRound: 1 };
    const res2 = calculateHitResult(targetStage1, 'gun', 1);
    assert.equal(res2.action, 'last_tower');
    assert.equal(res2.newStage, 2);
    assert.equal(res2.alive, true);

    const targetStage2 = { stage: 2, alive: true, weapons: ['gun', 'shield'], shieldDisabledRound: 1 };
    const res3 = calculateHitResult(targetStage2, 'gun', 1);
    assert.equal(res3.action, 'eliminated');
    assert.equal(res3.newStage, 3);
    assert.equal(res3.alive, false);
  });

  await t.test('Peeranki instant-kills unshielded target', () => {
    const target = { stage: 0, alive: true, weapons: ['gun'], shieldDisabledRound: -1 };
    const res = calculateHitResult(target, 'peeranki', 1);
    assert.equal(res.action, 'eliminated');
    assert.equal(res.alive, false);
  });

  await t.test('Hook permanently strips shield', () => {
    const target = { stage: 0, alive: true, weapons: ['gun', 'shield'], shieldDisabledRound: -1 };
    const res = calculateHitResult(target, 'hook', 1);
    assert.equal(res.action, 'shield_destroyed_permanently');
    assert.equal(res.shieldRemoved, true);
    assert.equal(res.alive, true);
  });

  await t.test('Hook strips a shield even after Peeranki disabled it this round', () => {
    const target = { stage: 1, alive: true, weapons: ['gun', 'shield'], shieldDisabledRound: 1 };
    const res = calculateHitResult(target, 'hook', 1);
    assert.equal(res.action, 'shield_destroyed_permanently');
    assert.equal(res.shieldRemoved, true);
    assert.equal(res.newStage, 1);
    assert.equal(res.alive, true);
  });

  await t.test('Hook fails harmlessly if target has no shield', () => {
    const target = { stage: 0, alive: true, weapons: ['gun'], shieldDisabledRound: -1 };
    const res = calculateHitResult(target, 'hook', 1);
    assert.equal(res.action, 'no_shield_for_hook');
    assert.equal(res.shieldRemoved, false);
  });
});

test('COUNTING SELECTS ONLY LIVING PLAYERS’ TOWERS AND STOPS AT TEN', () => {
  const players = [
    { stage: 0, alive: true, connected: true }, // one tower
    { stage: 1, alive: true, connected: true }, // two towers
    { stage: 2, alive: true, connected: true }, // one tower
    { stage: 3, alive: false, connected: true },
    { stage: 0, alive: true, connected: false },
  ];

  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => getCountedPlayerIndex(players, 0, index + 1)),
    [0, 1, 1, 2],
  );
  assert.deepEqual(
    Array.from({ length: 4 }, (_, index) => getCountedPlayerIndex(players, 1, index + 1)),
    [1, 1, 2, 0],
  );
  assert.equal(getCountedPlayerIndex(players, 0, 10), 1);
  assert.equal(getCountedPlayerIndex(players, 0, 11), -1);
  assert.equal(getCountedPlayerIndex(players, 0, 0), -1);
  assert.equal(getCountedPlayerIndex([], 0, 1), -1);
  assert.equal(getNextCountingStartIndex(players, 0), 0, 'a living shot target gets the next count');
  assert.equal(getNextCountingStartIndex(players, 3), 0, 'eliminated and disconnected players are skipped');
  assert.equal(getNextCountingStartIndex(players.slice(3), 0), -1, 'no eligible player returns -1');
});

test('ELIMINATION BONUS IS AWARDED ONCE ONLY AFTER ALL FIVE WEAPONS', () => {
  const makePlayer = (id, options = {}) => ({
    id,
    stage: 0,
    alive: true,
    connected: true,
    weapons: ['gun'],
    shieldDisabledRound: -1,
    eliminationPoints: 0,
    ...options,
  });
  const fullSet = ['gun', 'peeranki', 'shield', 'hook', 'doublePeeranki'];
  const players = [
    makePlayer(1, { weapons: fullSet }),
    makePlayer(2, { stage: 2 }),
    makePlayer(3, { stage: 2 }),
  ];

  const firstShot = resolvePlayerAction(players, { shooterId: 1, weapon: 'gun', targetIds: [2] }, 0, 5);
  assert.equal(firstShot.accepted, true);
  assert.equal(players[0].eliminationPoints, 1);
  const repeatedShot = resolvePlayerAction(players, { shooterId: 1, weapon: 'gun', targetIds: [2] }, 0, 5);
  assert.equal(repeatedShot.accepted, false);
  assert.equal(players[0].eliminationPoints, 1, 'the same elimination cannot be scored twice');

  const partialPlayers = [makePlayer(1), makePlayer(2, { stage: 2 })];
  const partialShot = resolvePlayerAction(partialPlayers, { shooterId: 1, weapon: 'gun', targetIds: [2] }, 0, 5);
  assert.equal(partialShot.accepted, true);
  assert.equal(partialPlayers[0].eliminationPoints, 0);
});

test('MATCH SCORE KEEPS TIES AND RECOGNIZES THE FULL WEAPON SET', () => {
  const allWeapons = ['gun', 'peeranki', 'shield', 'hook', 'doublePeeranki'];
  assert.equal(hasAllWeapons(allWeapons), true);
  assert.equal(hasAllWeapons(allWeapons.slice(0, 4)), false);
  const players = [
    { name: 'A', weapons: ['gun', 'peeranki'] },
    { name: 'B', weapons: ['gun', 'peeranki'] },
    { name: 'C', weapons: ['gun'] },
  ];
  assert.deepEqual(findMatchWinners(players).map((player) => player.name), ['A', 'B']);
});

test('HUMAN AND BOT ACTIONS USE THE SAME VALIDATED RESOLVER', () => {
  const makePlayer = (id, options = {}) => ({
    id,
    stage: 0,
    alive: true,
    connected: true,
    weapons: ['gun'],
    shieldDisabledRound: -1,
    eliminationPoints: 0,
    ...options,
  });
  const players = [
    makePlayer(1, { weapons: ['gun', 'shield', 'hook', 'doublePeeranki'] }),
    makePlayer(2, { weapons: ['gun', 'shield'], shieldDisabledRound: 3 }),
    makePlayer(3, { weapons: ['gun', 'shield'] }),
  ];

  const botAction = chooseBotAction(players, 0, 3, () => 0);
  assert.deepEqual(botAction, { shooterId: 1, weapon: 'hook', targetIds: [2] });
  const botResult = resolvePlayerAction(players, botAction, 0, 3);
  assert.equal(botResult.accepted, true);
  assert.equal(players[1].weapons.includes('shield'), false, 'Hook strips even a currently disabled Shield');

  const humanResult = resolvePlayerAction(players, {
    shooterId: 1,
    weapon: 'doublePeeranki',
    targetIds: [2, 3],
  }, 0, 3);
  assert.equal(humanResult.accepted, true);
  assert.deepEqual(humanResult.hits.map((hit) => hit.weapon), ['peeranki', 'gun']);
  assert.equal(players[1].alive, false, 'the first Double Peeranki hit applies Peeranki rules');
  assert.equal(players[2].stage, 0, 'the second Gun is blocked by that target’s active Shield');

  const duplicateTargetResult = resolvePlayerAction(players, {
    shooterId: 1,
    weapon: 'doublePeeranki',
    targetIds: [3, 3],
  }, 0, 3);
  assert.deepEqual(duplicateTargetResult, { accepted: false, reason: 'invalid_targets' });
});

test('OFFLINE BOT ACTIONS STAY LEGAL FOR EVERY SUPPORTED PLAYER COUNT', () => {
  for (let playerCount = 3; playerCount <= 10; playerCount += 1) {
    const players = Array.from({ length: playerCount }, (_, index) => ({
      id: index + 1,
      stage: index % 3,
      alive: true,
      connected: true,
      weapons: index === playerCount - 1 ? ['gun', 'peeranki', 'shield', 'hook', 'doublePeeranki'] : ['gun'],
      shieldDisabledRound: -1,
      eliminationPoints: 0,
    }));
    const botIndex = playerCount - 1;
    const action = chooseBotAction(players, botIndex, 1, () => 0);
    assert.ok(action, `${playerCount} player game supplies a bot action`);
    assert.equal(action.shooterId, playerCount);
    assert.equal(action.targetIds.includes(playerCount), false);
    assert.equal(new Set(action.targetIds).size, action.targetIds.length);
    assert.equal(action.targetIds.length, action.weapon === 'doublePeeranki' ? 2 : 1);
    assert.equal(resolvePlayerAction(players, action, botIndex, 1).accepted, true);
  }
});

test('3. ROCK-PAPER-SCISSORS DUEL ENGINE', async (t) => {
  await t.test('Rock beats Scissors, Scissors beats Paper, Paper beats Rock', () => {
    assert.equal(resolveRpsWinner('rock', 'scissors'), 'first');
    assert.equal(resolveRpsWinner('scissors', 'paper'), 'first');
    assert.equal(resolveRpsWinner('paper', 'rock'), 'first');

    assert.equal(resolveRpsWinner('scissors', 'rock'), 'second');
    assert.equal(resolveRpsWinner('paper', 'scissors'), 'second');
    assert.equal(resolveRpsWinner('rock', 'paper'), 'second');
  });

  await t.test('Matching choices result in a tie', () => {
    assert.equal(resolveRpsWinner('rock', 'rock'), 'tie');
    assert.equal(resolveRpsWinner('paper', 'paper'), 'tie');
    assert.equal(resolveRpsWinner('scissors', 'scissors'), 'tie');
  });
});

test('4. MATCH CONFIGURATION & TIMINGS', async (t) => {
  await t.test('Match durations conform to 3, 5, 10, 15 minutes', () => {
    assert.deepEqual([...MATCH_DURATIONS], [3, 5, 10, 15]);
  });
});

test('5. SUPABASE MULTIPLAYER ROOM LIFECYCLE', async (t) => {
  const sessionIdHost = 'test-session-host-123';
  const sessionIdGuest = 'test-session-guest-456';
  const playerName = 'Commander';

  let roomCode = '';

  await t.test('createPrivateRoom initializes room with custom player name', async () => {
    const room = await createPrivateRoom(4, sessionIdHost, playerName);
    assert.ok(room, 'Room was created');
    assert.equal(room.players.length, 1);
    assert.equal(room.players[0].name, playerName, 'Host name matches custom input');
    assert.equal(room.players[0].session_id, sessionIdHost);
    assert.equal(room.max_players, 4);
    assert.equal(room.game_status, 'waiting');
    roomCode = room.room_code;
    assert.equal(typeof roomCode, 'string');
    assert.equal(roomCode.length, 6);
  });

  await t.test('joinRoom adds player up to max capacity', async () => {
    const joinResult = await joinRoom(roomCode, 'GuestPlayer', sessionIdGuest);
    assert.ok(joinResult);
    assert.equal(joinResult.players.length, 2);
    assert.equal(joinResult.players[1].name, 'GuestPlayer');
  });

  await t.test('touchPlayer updates last_seen timestamp', async () => {
    const touched = await touchPlayer(roomCode, sessionIdHost);
    assert.ok(touched);
  });

  await t.test('saveGameState & getGameState synchronize state', async () => {
    const state = await getGameState(roomCode);
    assert.ok(state);
    await saveGameState(roomCode, state.players, state.max_players, 1, 0, 'shooting');

    const reloaded = await getGameState(roomCode);
    assert.equal(reloaded.game_status, 'shooting');
    assert.equal(reloaded.current_shooter, 1);
  });

  await t.test('leaveRoom disconnects player cleanly', async () => {
    await leaveRoom(roomCode, sessionIdGuest);
    const updated = await getGameState(roomCode);
    assert.ok(updated);
    const guest = updated.players.find(p => p.session_id === sessionIdGuest);
    assert.equal(guest === undefined || guest.connected === false, true, 'Guest is removed from lobby or disconnected');
  });
});

test('6. ROOM STATE UPDATES REACH LOCAL SUBSCRIBERS', async () => {
  const room = await createPrivateRoom(3, 'state-host', 'Host');
  const observed = [];
  const subscriber = subscribeToGameState(room.room_code, (state) => observed.push(state));

  try {
    await saveGameState(room.room_code, room.players, room.max_players, 0, 4, 'counting');
    assert.equal(observed.length, 1);
    assert.equal(observed[0].game_status, 'counting');
    assert.equal(observed[0].countdown, 4);
    await broadcastRoomStateDelta(room.room_code, {
      current_shooter: 1,
      countdown: 5,
      game_status: 'counting',
    });
    assert.equal(observed.length, 2);
    assert.equal(observed[1].countdown, 5);
    assert.equal(observed[1].current_shooter, 1);
  } finally {
    await subscriber.unsubscribe();
  }
});
