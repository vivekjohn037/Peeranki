import { canApplyGameSnapshot, roomRounds } from '../src/game/onlineState.ts';
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
  getVisibleWeapons,
  hasAllWeapons,
  findMatchWinners,
} from '../src/game/rules.ts';
import { chooseBotAction, resolvePlayerAction, SoundEffectManager, soundEffectManager, playResolutionSoundEffects } from '../src/game/engine.ts';
import { DuelLogManager, duelLogManager } from '../src/game/DuelLogManager.ts';
import {
  broadcastRoomStateDelta,
  createPrivateRoom,
  joinRoom,
  findOrCreateRandomRoom,
  getGameState,
  saveGameState,
  setLobbyReady,
  requestPlayerAction,
  touchPlayer,
  leaveRoom,
  subscribeToGameState,
  supabase,
  parseSupabaseError,
  MultiplayerError,
  isServiceRoleKey,
  claimHost,
  shouldAcceptRoomState,
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
  await t.test('Shattered shield icon is hidden for its owner current round only', () => {
    const weapons = ['gun', 'peeranki', 'shield'];
    assert.deepEqual(getVisibleWeapons(weapons, 2, 2), ['gun', 'peeranki']);
    assert.deepEqual(getVisibleWeapons(weapons, 2, 3), weapons);
    assert.deepEqual(getVisibleWeapons(weapons, -1, 2), weapons);
  });

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

  await t.test('online shot requests update only the active shooter entry', async () => {
    const room = await getGameState(roomCode);
    const deadline = new Date(Date.now() + 10_000).toISOString();
    const players = room.players.map((player) => ({
      ...player,
      action_request: null,
      shooting_deadline_at: deadline,
    }));
    await saveGameState(roomCode, players, room.max_players, 0, 10, 'shooting');
    await requestPlayerAction(roomCode, sessionIdHost, { shooterId: 1, weapon: 'gun', targetIds: [2], nonce: 'atomic-shot-test' });
    const updated = await getGameState(roomCode);
    assert.equal(updated.players[0].action_request.nonce, 'atomic-shot-test');
    assert.equal(updated.players[1].action_request, null);
  });

  await t.test('saveGameState persists counting_start_timestamp and clients calculate count locally', async () => {
    const testTimestamp = new Date(Date.now() - 650).toISOString();
    const state = await getGameState(roomCode);
    const updatedPlayers = state.players.map((p) => ({
      ...p,
      counting_start_timestamp: testTimestamp,
    }));
    await saveGameState(roomCode, updatedPlayers, state.max_players, null, 0, 'counting', testTimestamp);

    const reloaded = await getGameState(roomCode);
    assert.equal(reloaded.game_status, 'counting');
    assert.equal(reloaded.counting_start_timestamp, testTimestamp);

    const COUNTING_SPEED = 200;
    const COUNT_TO = 10;
    const calcCount = (timestamp, nowMs = Date.now()) => {
      const elapsed = Math.max(0, nowMs - Date.parse(timestamp));
      return Math.min(COUNT_TO, Math.floor(elapsed / COUNTING_SPEED));
    };

    assert.equal(calcCount(testTimestamp, Date.parse(testTimestamp)), 0);
    assert.equal(calcCount(testTimestamp, Date.parse(testTimestamp) + 200), 1);
    assert.equal(calcCount(testTimestamp, Date.parse(testTimestamp) + 650), 3);
    assert.equal(calcCount(testTimestamp, Date.parse(testTimestamp) + 1000), 5);
    assert.equal(calcCount(testTimestamp, Date.parse(testTimestamp) + 2000), 10);
    assert.equal(calcCount(testTimestamp, Date.parse(testTimestamp) + 9999), 10);
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
  const joined = await joinRoom(room.room_code, 'Target', 'state-target');
  const observed = [];
  const subscriber = subscribeToGameState(room.room_code, (state) => observed.push(state));

  try {
    await saveGameState(room.room_code, joined.players, room.max_players, 0, 4, 'counting');
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

    const shotPlayers = joined.players.map((player) => player.session_id === 'state-target'
      ? { ...player, stage: 1 }
      : player);
    await saveGameState(room.room_code, shotPlayers, room.max_players, 1, 10, 'shot');
    assert.equal(observed[2].game_status, 'shot');
    assert.equal(observed[2].players.find((player) => player.session_id === 'state-target').stage, 1);
  } finally {
    await subscriber.unsubscribe();
  }
});

test('6a. Cross-client room updates accept player changes despite local sequence counters', () => {
  const roomCode = `SEQ${Date.now()}`;
  const before = {
    state_seq: 25,
    updated_at: '2026-01-01T00:00:00.000Z',
    game_status: 'shooting',
    current_shooter: 1,
    countdown: 10,
    players: [{ id: 2, session_id: 'target', connected: true, alive: true, stage: 0, weapons: ['gun'], action_request: null }],
  };
  const after = {
    ...before,
    state_seq: 1,
    updated_at: '2026-01-01T00:00:00.100Z',
    players: [{ ...before.players[0], stage: 1 }],
  };

  assert.equal(shouldAcceptRoomState(roomCode, before), true);
  assert.equal(shouldAcceptRoomState(roomCode, after), true, 'lower per-tab sequence must not hide a newer shot');
  assert.equal(shouldAcceptRoomState(roomCode, after), false, 'an identical duplicate should be ignored');

  const postgresEcho = {
    ...after,
    host_session_id: 'authoritative-host',
    created_at: '2026-01-01T00:00:00.000Z',
    players: [Object.fromEntries(Object.entries(after.players[0]).reverse())],
  };
  assert.equal(
    shouldAcceptRoomState(roomCode, postgresEcho),
    false,
    'the Postgres Changes echo of the same durable broadcast must not replay hit feedback',
  );
});

test('6a2. Action timeout is a distinct forward room transition', () => {
  const roomCode = `TIMEOUT${Date.now()}`;
  const players = [{ id: 1, session_id: 'timeout-host', stage: 0, alive: true, connected: true }];
  assert.equal(shouldAcceptRoomState(roomCode, { game_status: 'shooting', current_shooter: 0, countdown: 10, counting_start_timestamp: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:10.000Z', players }), true);
  assert.equal(shouldAcceptRoomState(roomCode, { game_status: 'action_timeout', current_shooter: 0, countdown: 10, counting_start_timestamp: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:13.000Z', players }), true);
  assert.equal(shouldAcceptRoomState(roomCode, { game_status: 'shooting', current_shooter: 0, countdown: 10, counting_start_timestamp: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:12.000Z', players }), false);
});

test('6a3. A finished room rejects delayed duel updates but accepts a fresh waiting match', () => {
  const roomCode = `FINISH${Date.now()}`;
  const players = [{ id: 1, session_id: 'terminal-host', stage: 0, alive: true, connected: true }];
  assert.equal(shouldAcceptRoomState(roomCode, { game_status: 'finished', updated_at: '2026-10-14T12:00:02.000Z', players }), true);
  assert.equal(shouldAcceptRoomState(roomCode, { game_status: 'duel', updated_at: '2026-10-14T12:00:01.000Z', players }), false);
  assert.equal(shouldAcceptRoomState(roomCode, { game_status: 'waiting', updated_at: '2026-10-14T12:00:03.000Z', players }), true);
});

test('6b. Leaving a live 3-player room finishes the shared match only for that size', async (t) => {
  await t.test('3-player active match becomes finished', async () => {
    const created = await createPrivateRoom(3, 'leave-three-host', 'Host');
    const joined1 = await joinRoom(created.room_code, 'Guest 1', 'leave-three-guest1');
    const joined2 = await joinRoom(created.room_code, 'Guest 2', 'leave-three-guest2');
    await saveGameState(created.room_code, joined2.players, 3, 0, 10, 'shooting');

    const updated = await leaveRoom(created.room_code, 'leave-three-guest1');
    assert.equal(updated.game_status, 'finished');
    const leaver = updated.players.find((player) => player.session_id === 'leave-three-guest1');
    assert.equal(leaver.connected, false);
    assert.equal(leaver.alive, false);
  });

  await t.test('3-player waiting room remains open and 4-player match continues', async () => {
    const waiting = await createPrivateRoom(3, 'leave-wait-host', 'Host');
    await joinRoom(waiting.room_code, 'Guest', 'leave-wait-guest');
    const waitingAfterLeave = await leaveRoom(waiting.room_code, 'leave-wait-guest');
    assert.equal(waitingAfterLeave.game_status, 'waiting');

    const fourPlayer = await createPrivateRoom(4, 'leave-four-host', 'Host');
    const guest1 = await joinRoom(fourPlayer.room_code, 'Guest 1', 'leave-four-guest1');
    const guest2 = await joinRoom(fourPlayer.room_code, 'Guest 2', 'leave-four-guest2');
    const guest3 = await joinRoom(fourPlayer.room_code, 'Guest 3', 'leave-four-guest3');
    await saveGameState(fourPlayer.room_code, guest3.players, 4, 0, 10, 'shooting');
    const fourPlayerAfterLeave = await leaveRoom(fourPlayer.room_code, 'leave-four-guest1');
    assert.equal(fourPlayerAfterLeave.game_status, 'shooting');
  });
});

test('7. MULTIPLAYER ERROR PARSING & RECOVERY', async (t) => {
  await t.test('Maps missing build configuration to CONFIG_MISSING', () => {
    const err = parseSupabaseError(new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY required'));
    assert.equal(err.code, 'CONFIG_MISSING');
    assert.equal(err.userMessage.includes('not configured'), true);
  });

  await t.test('Maps PostgreSQL 42P01 to TABLE_MISSING', () => {
    const err = parseSupabaseError({ code: '42P01', message: 'relation "public.game_states" does not exist' });
    assert.equal(err.code, 'TABLE_MISSING');
    assert.equal(err.userMessage.includes('game_states'), true);
  });

  await t.test('Maps PGRST202 schema cache error to RPC_MISSING', () => {
    const err = parseSupabaseError({ code: 'PGRST202', message: 'Could not find the function public.join_private_room' });
    assert.equal(err.code, 'RPC_MISSING');
    assert.equal(err.userMessage.includes('RPC function missing'), true);
  });

  await t.test('Maps an explicit P0001 room-not-found message to ROOM_NOT_FOUND', () => {
    const err = parseSupabaseError({ code: 'P0001', message: 'Room does not exist' });
    assert.equal(err.code, 'ROOM_NOT_FOUND');
    assert.equal(err.userMessage.includes('Room not found'), true);
  });

  await t.test('Does not misclassify generic matchmaking exceptions as ROOM_NOT_FOUND', () => {
    const err = parseSupabaseError({ code: 'P0001', message: 'That player name is already in use' });
    assert.equal(err.code, 'UNKNOWN_ERROR');
    assert.match(err.technicalDetails, /That player name is already in use/);
  });

  await t.test('Preserves readable details from PostgREST error objects', () => {
    const err = parseSupabaseError({ code: 'P0001', message: 'This player session is already in the room', details: 'Retry the matchmaking request.' });
    assert.equal(err.code, 'UNKNOWN_ERROR');
    assert.match(err.technicalDetails, /This player session is already in the room/);
    assert.doesNotMatch(err.technicalDetails, /\[object Object\]/);
  });

  await t.test('Does not treat P0002 no-data errors as missing rooms', () => {
    const err = parseSupabaseError({ code: 'P0002', message: 'Invalid session identifier' });
    assert.equal(err.code, 'UNKNOWN_ERROR');
    assert.match(err.technicalDetails, /Invalid session identifier/);
  });

  await t.test('Maps P0005 / capacity to ROOM_FULL', () => {
    const err = parseSupabaseError({ code: 'P0005', message: 'Room is full' });
    assert.equal(err.code, 'ROOM_FULL');
    assert.equal(err.userMessage.includes('Room is full'), true);
  });

  await t.test('Maps P0004 / match started to GAME_IN_PROGRESS', () => {
    const err = parseSupabaseError({ code: 'P0004', message: 'Game already in progress' });
    assert.equal(err.code, 'GAME_IN_PROGRESS');
  });

  await t.test('Maps 42501 permission error to PERMISSION_DENIED', () => {
    const err = parseSupabaseError({ code: '42501', message: 'permission denied for table game_states' });
    assert.equal(err.code, 'PERMISSION_DENIED');
  });

  await t.test('Maps fetch errors to NETWORK_ERROR', () => {
    const err = parseSupabaseError(new TypeError('Failed to fetch'));
    assert.equal(err.code, 'NETWORK_ERROR');
    assert.equal(err.userMessage.includes('Network connection failed'), true);
  });

  await t.test('Detects service-role JWT keys vs anon keys', () => {
    // Header: {"alg":"HS256","typ":"JWT"}, Payload: {"role":"service_role","iss":"supabase"}, Signature
    const serviceToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UifQ.mocksignature';
    assert.equal(isServiceRoleKey(serviceToken), true);

    const anonToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIn0.mocksignature';
    assert.equal(isServiceRoleKey(anonToken), false);

    assert.equal(isServiceRoleKey(''), false);
    assert.equal(isServiceRoleKey(undefined), false);
  });

  await t.test('joinRoom validates 6-character code constraint', async () => {
    await assert.rejects(
      async () => {
        await joinRoom('SHORT', 'Player', 'sess-123');
      },
      (err) => {
        return err instanceof MultiplayerError && err.code === 'ROOM_NOT_FOUND';
      },
    );
  });
});

test('8. MULTIPLAYER 3-PLAYER FULL FLOW & COUNTDOWN SYNC', async () => {
  const sessionIdHost = 'flow-host';
  const sessionIdGuest1 = 'flow-guest1';
  const sessionIdGuest2 = 'flow-guest2';

  // 1. Host creates 3-player private room
  const created = await createPrivateRoom(3, sessionIdHost, 'HostAlpha');
  const code = created.room_code;
  assert.equal(created.max_players, 3);
  assert.equal(created.host_session_id, sessionIdHost);

  // 2. Guest 1 and Guest 2 join
  const joined1 = await joinRoom(code, 'GuestBravo', sessionIdGuest1);
  assert.equal(joined1.players.filter((p) => p.connected).length, 2);

  const joined2 = await joinRoom(code, 'GuestCharlie', sessionIdGuest2);
  const connected = joined2.players.filter((p) => p.connected);
  assert.equal(connected.length, 3);

  // 3. Counting phase starts with timestamp & startIndex
  const testTimestamp = new Date().toISOString();
  const startIndex = 0;
  const countingPlayers = connected.map((p) => ({
    ...p,
    counting_start_index: startIndex,
    counting_start_timestamp: testTimestamp,
  }));

  await saveGameState(code, countingPlayers, 3, null, 0, 'counting', testTimestamp);
  const countingState = await getGameState(code);
  assert.equal(countingState.game_status, 'counting');
  assert.equal(countingState.counting_start_timestamp, testTimestamp);

  // 4. Verify all 3 clients derive consistent count progression locally
  const COUNTING_SPEED = 200;
  const COUNT_TO = 10;
  const calcCount = (timestamp, nowMs) => {
    const elapsed = Math.max(0, nowMs - Date.parse(timestamp));
    return Math.min(COUNT_TO, Math.floor(elapsed / COUNTING_SPEED));
  };

  const startMs = Date.parse(testTimestamp);
  assert.equal(calcCount(testTimestamp, startMs), 0);
  assert.equal(calcCount(testTimestamp, startMs + 1000), 5);
  assert.equal(calcCount(testTimestamp, startMs + 2000), 10);

  // Count reaches 10 and selects shooter
  const finalShooterIndex = getCountedPlayerIndex(countingState.players, startIndex, 10);
  assert.equal(finalShooterIndex >= 0 && finalShooterIndex < 3, true);

  // 5. Host transitions room to shooting with 10s deadline
  const actionDeadline = new Date(Date.now() + 10_000).toISOString();
  const shootingPlayers = countingPlayers.map((p) => ({
    ...p,
    shooting_deadline_at: actionDeadline,
  }));
  await saveGameState(code, shootingPlayers, 3, finalShooterIndex, 10, 'shooting');

  const shootingState = await getGameState(code);
  assert.equal(shootingState.game_status, 'shooting');
  assert.equal(shootingState.current_shooter, finalShooterIndex);
  assert.equal(shootingState.countdown, 10);

  // Clean up
  await leaveRoom(code, sessionIdHost);
  await leaveRoom(code, sessionIdGuest1);
  await leaveRoom(code, sessionIdGuest2);
});

test('9. HOST FAILURE & MIGRATION DURING COUNTING', async () => {
  const sessionIdHost = 'fail-host';
  const sessionIdGuest1 = 'fail-guest1';
  const sessionIdGuest2 = 'fail-guest2';

  const room = await createPrivateRoom(3, sessionIdHost, 'OriginalHost');
  const code = room.room_code;
  await joinRoom(code, 'Candidate1', sessionIdGuest1);
  await joinRoom(code, 'Candidate2', sessionIdGuest2);

  // Original host disconnects during match
  await leaveRoom(code, sessionIdHost);

  const roomAfterDisconnect = await getGameState(code);
  const hostPlayer = roomAfterDisconnect.players.find((p) => p.session_id === sessionIdHost);
  assert.equal(hostPlayer === undefined || hostPlayer.connected === false, true);

  // Eligible living candidates excluding the failed host
  const candidates = roomAfterDisconnect.players.filter(
    (p) => p.connected && p.alive && p.session_id && p.session_id !== sessionIdHost
  );
  candidates.sort((a, b) => a.id - b.id);
  assert.equal(candidates.length, 2);
  const newHostCandidate = candidates[0];
  assert.equal(newHostCandidate.session_id, sessionIdGuest1);

  // Candidate claims host
  await claimHost(code, newHostCandidate.session_id, sessionIdHost);
  const migratedRoom = await getGameState(code);
  assert.equal(migratedRoom.host_session_id, sessionIdGuest1);

  // A concurrent claimant using the stale host ID must not replace the elected host.
  await claimHost(code, sessionIdGuest2, sessionIdHost);
  const afterStaleClaim = await getGameState(code);
  assert.equal(afterStaleClaim.host_session_id, sessionIdGuest1);

  // Clean up
  await leaveRoom(code, sessionIdGuest1);
  await leaveRoom(code, sessionIdGuest2);
});

test('10. OFFLINE BOT GAME STATE ISOLATION & LEGAL ACTIONS', async () => {
  for (const playerCount of [3, 5, 8, 10]) {
    const offlinePlayers = Array.from({ length: playerCount }, (_, i) => ({
      id: i + 1,
      name: i === 0 ? 'Human' : `Bot ${i}`,
      stage: 0,
      alive: true,
      weapons: ['gun'],
      hasCollectedAllWeapons: false,
      eliminationPoints: 0,
      shieldDisabledRound: -1,
      connected: true,
    }));

    for (let botIndex = 1; botIndex < playerCount; botIndex++) {
      // Each action is checked against a fresh roster; resolving it mutates player state.
      const actionPlayers = structuredClone(offlinePlayers);
      const action = chooseBotAction(actionPlayers, botIndex, 1, () => 0);
      assert.ok(action, `Bot ${botIndex} in ${playerCount}-player game must choose an action`);
      assert.equal(action.shooterId, botIndex + 1);
      assert.equal(action.weapon, 'gun');
      assert.notEqual(action.targetIds[0], botIndex + 1, 'Bot must not target itself');
      assert.equal(action.targetIds[0] >= 1 && action.targetIds[0] <= playerCount, true);

      const resolution = resolvePlayerAction(actionPlayers, action, botIndex, 1);
      assert.ok(resolution);
      assert.equal(resolution.accepted, true);
    }
  }
});

test('10b. SOUND EFFECT MANAGER AUDIO CLIPS & FEEDBACK LOOP', () => {
  assert.ok(soundEffectManager, 'soundEffectManager singleton must be defined');
  assert.ok(SoundEffectManager.getInstance(), 'SoundEffectManager.getInstance() must return an instance');

  // Verify core gameplay action methods exist
  assert.equal(typeof soundEffectManager.playShoot, 'function');
  assert.equal(typeof soundEffectManager.playTowerDamage, 'function');
  assert.equal(typeof soundEffectManager.playDuelStart, 'function');
  assert.equal(typeof soundEffectManager.playDuelClash, 'function');
  assert.equal(typeof soundEffectManager.playDuelTie, 'function');
  assert.equal(typeof soundEffectManager.playDuelWin, 'function');
  assert.equal(typeof soundEffectManager.playRoundWin, 'function');
  assert.equal(typeof soundEffectManager.playMatchVictory, 'function');
  assert.equal(typeof soundEffectManager.playMatchDefeat, 'function');

  // Verify volume and mute helpers
  assert.equal(typeof soundEffectManager.getStoredVolume(), 'number');
  assert.equal(typeof soundEffectManager.isMuted(), 'boolean');

  // Mock audio triggers for all weapons
  soundEffectManager.playShoot('gun');
  soundEffectManager.playShoot('peeranki');
  soundEffectManager.playShoot('doublePeeranki');
  soundEffectManager.playShoot('hook');

  // Mock audio triggers for tower damage, shield removal, and elimination
  soundEffectManager.playTowerDamage({ action: 'tower_damage', stage: 1 });
  soundEffectManager.playTowerDamage({ action: 'shield_absorbed' });
  soundEffectManager.playTowerDamage({ action: 'shield_destroyed_for_round' });
  soundEffectManager.playTowerDamage({ shieldRemoved: true });
  soundEffectManager.playTowerDamage({ eliminated: true });

  // Mock audio triggers for duel showdown
  soundEffectManager.playDuelStart();
  soundEffectManager.playDuelClash();
  soundEffectManager.playDuelTie();
  soundEffectManager.playDuelWin();

  // Test action resolution sound helper
  const mockResolution = {
    accepted: true,
    shooterIndex: 0,
    lastTargetIndex: 1,
    hits: [
      {
        targetIndex: 1,
        weapon: 'gun',
        action: 'last_tower',
        shieldRemoved: false,
        eliminated: false,
      },
    ],
  };

  playResolutionSoundEffects({ shooterId: 1, weapon: 'gun', targetIds: [2] }, mockResolution);
});

test('10c. DUEL LOG MANAGER POST-MATCH SUMMARY & AUDIT', async (t) => {
  await t.test('Records clash outcomes for ties and decisive wins', () => {
    duelLogManager.clearCurrentMatchLog();

    const tie = duelLogManager.recordDuelOutcome({
      round: 1,
      clashNumber: 1,
      player1: { id: 1, name: 'Alpha', choice: 'rock' },
      player2: { id: 2, name: 'Beta', choice: 'rock' },
      result: 'tie',
    });
    assert.equal(tie.result, 'tie');
    assert.equal(tie.round, 1);
    assert.match(tie.summaryText, /Both picked/);

    const win = duelLogManager.recordDuelOutcome({
      round: 1,
      clashNumber: 2,
      player1: { id: 1, name: 'Alpha', choice: 'paper' },
      player2: { id: 2, name: 'Beta', choice: 'rock' },
      result: 'win',
      winnerId: 1,
      winnerName: 'Alpha',
      winnerChoice: 'paper',
      loserId: 2,
      loserName: 'Beta',
      loserChoice: 'rock',
    });
    assert.equal(win.result, 'win');
    assert.equal(win.winnerName, 'Alpha');
    assert.match(win.narrative, /covers/);

    const matchLog = duelLogManager.getCurrentMatchLog();
    assert.equal(matchLog.length, 2);
  });

  await t.test('Computes aggregate stats and hand frequencies accurately', () => {
    const stats = duelLogManager.getDuelStats();
    assert.equal(stats.totalClashes, 2);
    assert.equal(stats.totalTies, 1);
    assert.equal(stats.totalDecisiveWins, 1);
    assert.equal(stats.rockCount, 3);
    assert.equal(stats.paperCount, 1);
    assert.equal(stats.scissorsCount, 0);
    assert.equal(stats.mostFavoredChoice, 'rock');
    assert.equal(stats.winLeaderboard[0]?.name, 'Alpha');
    assert.equal(stats.winLeaderboard[0]?.wins, 1);
  });

  await t.test('Generates formatted text-based summary with ASCII report', () => {
    const summary = duelLogManager.generateFormattedTextSummary();
    assert.match(summary, /PEERANKI · DUEL SHOWDOWN COMBAT LOG & SUMMARY/);
    assert.match(summary, /Alpha/);
    assert.match(summary, /Beta/);
    assert.match(summary, /Total Clashes Fought : 2/);
    assert.match(summary, /END OF PEERANKI DUEL COMBAT RECORD/);
  });

  await t.test('Provides fallback sample log when no duels occurred yet', () => {
    const freshManager = new DuelLogManager();
    const effective = freshManager.getEffectiveLog();
    assert.ok(effective.entries.length > 0);
    assert.equal(effective.entries[0]?.isSample, true);
  });
});

test('11. CLEANUP REALTIME CONNECTIONS', async () => {
  if (supabase?.realtime) {
    try {
      await supabase.removeAllChannels();
      supabase.realtime.disconnect();
    } catch {}
  }
  setTimeout(() => process.exit(0), 50).unref();
});


test('lobby readiness persists per member, preserves other members, and rejects late changes', async () => {
 const room=await createPrivateRoom(3,'ready-host','Host'); const code=room.room_code;
 await joinRoom(code,'Guest','ready-guest');
 await Promise.all([setLobbyReady(code,'ready-host',true),setLobbyReady(code,'ready-guest',true)]);
 let state=await fetchReadyRoom(code);
 assert.equal(state.players.find(p=>p.session_id==='ready-host').ready,true);
 assert.equal(state.players.find(p=>p.session_id==='ready-guest').ready,true);
 await setLobbyReady(code,'ready-host',false);state=await fetchReadyRoom(code);
 assert.equal(state.players.find(p=>p.session_id==='ready-host').ready,false);
 assert.equal(state.players.find(p=>p.session_id==='ready-guest').ready,true);
 await assert.rejects(setLobbyReady(code,'outsider',true));
 await saveGameState(code,state.players,3,null,0,'playing');
 await assert.rejects(setLobbyReady(code,'ready-host',true));
});
async function fetchReadyRoom(code) { return getGameState(code); }


function roundSnapshot(round, status, updatedAt, duel = 1) {
 return { game_status:status, updated_at:updatedAt, counting_start_timestamp:'2026-10-21T10:00:00.000Z', countdown:status==='shooting'?10:0,
 players:[{id:1,match_round:round,duel_round:duel,alive:true},{id:2,match_round:round,duel_round:duel,alive:true},{id:3,match_round:round,duel_round:duel,alive:status!=='duel'}] };
}

test('missed duel result recovers directly into next round counting or shooting', () => {
 for(const phase of ['counting','shooting']) {
   const key='DUEL-RECOVERY-'+phase;
   const duel=roundSnapshot(1,'duel','2026-10-21T10:00:10.000Z');
   const next=roundSnapshot(2,phase,'2026-10-21T10:00:11.000Z');
   assert.equal(shouldAcceptRoomState(key,duel),true);
   assert.equal(shouldAcceptRoomState(key,next),true,'next round must bypass the old phase guard, even with the same counting timestamp');
   assert.equal(canApplyGameSnapshot({matchRound:1,duelRound:1,duelActive:true},next),true,'a client stuck in the duel must accept polling/realtime recovery');
   assert.deepEqual(roomRounds(next),{matchRound:2,duelRound:1});
 }
});

test('a delayed old-round duel cannot reopen over the current round, even with a newer clock', () => {
 const next=roundSnapshot(2,'shooting','2026-10-21T10:00:11.000Z');
 const delayed=roundSnapshot(1,'duel','2026-10-21T10:00:30.000Z');
 assert.equal(shouldAcceptRoomState('DUEL-ROLLBACK',next),true);
 assert.equal(shouldAcceptRoomState('DUEL-ROLLBACK',delayed),false);
 assert.equal(canApplyGameSnapshot({matchRound:2,duelRound:1,duelActive:false},delayed),false,'polling must obey the same round ordering');
 assert.equal(canApplyGameSnapshot({matchRound:2,duelRound:1,duelActive:false},{...delayed,game_status:'finished'}),false);
});

test('same-round stale shots stay blocked during a duel and tie rounds cannot roll back', () => {
 const current={matchRound:1,duelRound:2,duelActive:true};
 assert.equal(canApplyGameSnapshot(current,roundSnapshot(1,'shooting','2026-10-21T10:00:10.000Z')),false);
 assert.equal(canApplyGameSnapshot(current,roundSnapshot(1,'duel','2026-10-21T10:00:11.000Z',1)),false);
 assert.equal(canApplyGameSnapshot(current,roundSnapshot(1,'duel','2026-10-21T10:00:11.000Z',2)),true);
 assert.equal(canApplyGameSnapshot(current,roundSnapshot(1,'finished','2026-10-21T10:00:12.000Z',2)),true);
 assert.equal(canApplyGameSnapshot(current,roundSnapshot(1,'shot','2026-10-21T10:00:12.000Z',2),true),true,'departure handling must still be allowed');
 assert.equal(shouldAcceptRoomState('TIE-ROLLBACK',roundSnapshot(1,'duel','2026-10-21T10:00:11.000Z',2)),true);
 assert.equal(shouldAcceptRoomState('TIE-ROLLBACK',roundSnapshot(1,'duel','2026-10-21T10:00:12.000Z',1)),false);
});
