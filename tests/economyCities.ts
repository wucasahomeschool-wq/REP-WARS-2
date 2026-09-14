import assert from 'assert';
import {
  AdjustableClock,
  ECONOMY_CONFIG,
  ErrorCode,
  GAMEPLAY_CONFIG,
  Orchestrator,
  acceleratedRemainingTicks,
  beginWorkoutSession,
  checkGameStateInvariants,
  GAME_STATE_SCHEMA_VERSION,
  cloneGameState,
  collectTerritoryYield,
  completeExercise,
  consumeConstructionEffect,
  createGameState,
  createLegacySampleMapGameState,
  getCurrentExercise,
  peekCollectibleResources,
  productionAccrued,
  progressWorldEconomy,
  runWorkoutRewardPipeline,
  settleTerritoryOwnershipChange,
  skipExercise,
  startConstruction,
  submitWorkoutFeedback,
} from '../src';
import type {
  CommandRequest,
  GameState,
  SessionOpResult,
  WorkoutDefinition,
  WorkoutPurpose,
  WorkoutSession,
} from '../src';
import { cityIdFor } from '../src/gameplay';
import { plantCity, plantOwnedCities } from './worldTestHelpers';

export interface EconomyCitiesTestApi {
  test: (name: string, fn: () => void) => void;
}

const PLAYER_ID = 'player_1';
const PLAYER_FACTION = 'iron_kingdom';
const OTHER_FACTION = 'celestial_theocracy';
const SPIRE = 'iron_spire';
const HOME = 'iron_kingdom_east';
const UNOWNED = 'burning_desert';
const OTHER_TILE = 'golden_hills';

function must<T>(result: SessionOpResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.code} ${result.error.message}`);
  return result.value;
}

function cmdReq(commandId: string, parameters: Record<string, unknown> = {}): CommandRequest {
  return { commandId, playerId: PLAYER_ID, requestId: `${commandId}_17j`, parameters };
}

function playerState(): GameState {
  return createLegacySampleMapGameState({ seed: 17, playerFactionId: PLAYER_FACTION });
}

function tinyWorkout(): WorkoutDefinition {
  return {
    id: 'wk_17j_tiny',
    name: '17J Tiny',
    description: 'Fixture',
    intendedDifficulty: 'MODERATE',
    exercises: [
      { exerciseId: 'ex_push_ups', order: 0, prescription: { kind: 'repetitions', repetitions: 10 }, role: 'UPPER_BODY', skippable: false },
      { exerciseId: 'ex_rest', order: 1, prescription: { kind: 'duration', durationSeconds: 15 }, role: 'REST', skippable: true },
      { exerciseId: 'ex_plank', order: 2, prescription: { kind: 'duration', durationSeconds: 20 }, role: 'CORE', skippable: false },
      { exerciseId: 'ex_squats', order: 3, prescription: { kind: 'repetitions', repetitions: 8 }, role: 'LOWER_BODY', skippable: false },
      { exerciseId: 'ex_child_pose', order: 4, prescription: { kind: 'duration', durationSeconds: 10 }, role: 'FINAL_STRETCH', skippable: false },
    ],
    metadata: {},
  };
}

function completeAll(session: WorkoutSession, clock: AdjustableClock): WorkoutSession {
  let current = session;
  while (current.state === 'ACTIVE') {
    const step = getCurrentExercise(current);
    assert.ok(step, 'expected current exercise');
    clock.advance(1_000);
    if (step.skippable && step.exerciseType === 'REST') {
      current = must(skipExercise(current, step.order, clock.now()), `skip ${step.order}`);
      continue;
    }
    if (step.prescription.kind === 'repetitions') {
      current = must(completeExercise(current, {
        order: step.order,
        repetitions: step.prescription.repetitions,
      }, clock.now()), `reps ${step.order}`);
    } else {
      current = must(completeExercise(current, {
        order: step.order,
        durationSeconds: step.prescription.durationSeconds,
      }, clock.now()), `timed ${step.order}`);
    }
  }
  return current;
}

function completedSession(purpose: WorkoutPurpose, sessionId: string, extras: {
  constructionId?: string;
  collectionTerritoryId?: string;
} = {}): WorkoutSession {
  const clock = new AdjustableClock(1_000);
  let session = must(beginWorkoutSession({
    playerId: PLAYER_ID,
    purpose,
    intendedDifficulty: 'MODERATE',
    workout: tinyWorkout(),
    sessionId,
    now: clock.now(),
    gameplayContext: {
      constructionId: extras.constructionId,
      collectionTerritoryId: extras.collectionTerritoryId,
      startedAtWorldTick: 0,
    },
  }), 'begin');
  session = completeAll(session, clock);
  return must(submitWorkoutFeedback(session, 'ABOUT_RIGHT', clock.now()), 'feedback');
}

function expectedYield(ticks: number) {
  const output = playerState().territories.get(SPIRE)!.resourceOutput;
  return productionAccrued(output, ticks);
}

function advance(orch: Orchestrator, ticks: number) {
  const res = orch.execute(cmdReq('ADVANCE_WORLD', { elapsedTicks: ticks }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  return res;
}

/** Offline/lazy catch-up without running AI/events (ADVANCE_WORLD is capped at 64). */
function jump(orch: Orchestrator, ticks: number) {
  orch.getState().worldTick += ticks;
  progressWorldEconomy(orch.getState());
}

function snapshotEconomy(state: GameState) {
  return JSON.parse(JSON.stringify({
    resources: { ...state.factions.get(PLAYER_FACTION)!.resources },
    otherResources: { ...state.factions.get(OTHER_FACTION)!.resources },
    uncollected: [...state.territoryEconomy.entries()].map(([id, rec]) => ({
      id,
      lastAccrualTick: rec.lastAccrualTick,
      uncollected: { ...rec.uncollected },
    })),
    cities: [...state.cities.entries()].map(([id, city]) => ({
      id,
      factionId: city.factionId,
      territoryId: city.territoryId,
      buildings: city.buildings.map((b) => ({ ...b })),
    })),
    constructions: [...state.constructions.entries()].map(([id, project]) => ({ ...project })),
    pendingGY: state.playerRewards.pendingGoldenYieldEffects.map((e) => ({ ...e })),
    pendingWorkers: state.playerRewards.pendingConstructionEffects.map((e) => ({ ...e })),
  }));
}

function pushGoldenYield(state: GameState, multiplier = 2): void {
  state.playerRewards.pendingGoldenYieldEffects.push({
    applicationId: 'gy_17j',
    sessionId: 'wses_gy_17j',
    workoutId: 'wk',
    playerId: PLAYER_ID,
    multiplier,
    effect: 'ONE_TIME_COLLECTION',
    permanence: 'EPHEMERAL',
    consumed: false,
    appliedAtTick: state.worldTick,
    sourcePhysicalOutput: 10,
  });
}

function pushWorkers(state: GameState, workerPower = 5): void {
  state.playerRewards.pendingConstructionEffects.push({
    applicationId: 'cw_17j',
    sessionId: 'wses_cw_17j',
    workoutId: 'wk',
    playerId: PLAYER_ID,
    workerPower,
    permanence: 'TEMPORARY_ACCELERATION',
    appliedAtTick: state.worldTick,
    sourcePhysicalOutput: 10,
  });
}

export function registerEconomyCitiesTests(api: EconomyCitiesTestApi): void {
  const { test } = api;

  console.log('Phase 17J — economy, cities, construction time');

  test('legacy SAMPLE_MAP seeds territory economy and no cities', () => {
    const state = playerState();
    assert.strictEqual(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
    assert.strictEqual(state.cities.size, 0);
    assert.strictEqual(state.territoryEconomy.size, state.territories.size);
    for (const t of state.territories.values()) {
      const rec = state.territoryEconomy.get(t.id);
      assert.ok(rec);
      assert.strictEqual(rec.lastAccrualTick, 0);
      assert.strictEqual(rec.uncollected.gold, 0);
      assert.ok(!state.cities.has(cityIdFor(t.id)));
    }
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('passive production follows the centralized elapsed × output / cycle equation', () => {
    assert.strictEqual(ECONOMY_CONFIG.ticksPerProductionCycle, 60);
    const one = expectedYield(1);
    const hour = expectedYield(60);
    const day = expectedYield(1440);
    assert.strictEqual(one.gold, 0);
    assert.strictEqual(hour.gold, 30);
    assert.strictEqual(hour.iron, 45);
    assert.strictEqual(hour.stone, 20);
    assert.strictEqual(day.gold, 720);
  });

  test('owned territories accrue over world time; unowned territories do not', () => {
    const orch = new Orchestrator(playerState());
    jump(orch, 1);
    assert.deepStrictEqual(peekCollectibleResources(orch.getState(), SPIRE), expectedYield(1));
    assert.strictEqual(peekCollectibleResources(orch.getState(), UNOWNED).gold, 0);
    jump(orch, 59);
    assert.deepStrictEqual(peekCollectibleResources(orch.getState(), SPIRE), expectedYield(60));
    assert.strictEqual(peekCollectibleResources(orch.getState(), UNOWNED).gold, 0);
  });

  test('long elapsed periods accrue exactly once and do not require per-tick writes', () => {
    const orch = new Orchestrator(playerState());
    jump(orch, 1);
    assert.deepStrictEqual(peekCollectibleResources(orch.getState(), SPIRE), expectedYield(1));
    jump(orch, 59);
    assert.deepStrictEqual(peekCollectibleResources(orch.getState(), SPIRE), expectedYield(60));
    jump(orch, 1380);
    assert.deepStrictEqual(peekCollectibleResources(orch.getState(), SPIRE), expectedYield(1440));
    jump(orch, 4320);
    assert.deepStrictEqual(peekCollectibleResources(orch.getState(), SPIRE), expectedYield(5760));
    assert.strictEqual(orch.getState().territoryEconomy.get(SPIRE)!.lastAccrualTick, 5760);
    assert.strictEqual(orch.getState().worldTick, 5760);
  });

  test('collection transfers uncollected yield and resets it; a second collect is not a duplicate', () => {
    const orch = new Orchestrator(playerState());
    const goldBefore = orch.getState().factions.get(PLAYER_FACTION)!.resources.gold;
    const ironBefore = orch.getState().factions.get(PLAYER_FACTION)!.resources.iron;
    jump(orch, 60);
    const collect = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: SPIRE }));
    assert.strictEqual(collect.success, true, collect.errors[0]?.message);
    const expected = expectedYield(60);
    assert.strictEqual(collect.payload.collected, expected.gold);
    assert.strictEqual(orch.getState().factions.get(PLAYER_FACTION)!.resources.gold, goldBefore + expected.gold);
    assert.strictEqual(orch.getState().factions.get(PLAYER_FACTION)!.resources.iron, ironBefore + expected.iron);
    assert.strictEqual(orch.getState().territoryEconomy.get(SPIRE)!.uncollected.gold, 0);
    const second = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: SPIRE }));
    assert.strictEqual(second.success, true);
    assert.strictEqual(second.payload.collected, 0);
    assert.strictEqual(orch.getState().factions.get(PLAYER_FACTION)!.resources.gold, goldBefore + expected.gold);
  });

  test('invalid territory and wrong owner collections are rejected without mutation', () => {
    const orch = new Orchestrator(playerState());
    jump(orch, 60);
    const before = snapshotEconomy(orch.getState());
    const missing = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: 'no_such_tile' }));
    assert.strictEqual(missing.success, false);
    const stolen = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: OTHER_TILE }));
    assert.strictEqual(stolen.success, false);
    assert.strictEqual(stolen.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    const impersonate = orch.execute(cmdReq('COLLECT_RESOURCES', {
      territoryId: OTHER_TILE,
      factionId: OTHER_FACTION,
    }));
    assert.strictEqual(impersonate.success, false);
    assert.deepStrictEqual(snapshotEconomy(orch.getState()), before);
  });

  test('numeric overflow on collection is rejected and leaves reserves unchanged', () => {
    const state = playerState();
    state.worldTick = 60;
    state.factions.get(PLAYER_FACTION)!.resources.gold = Number.MAX_SAFE_INTEGER - 1;
    const beforeGold = state.factions.get(PLAYER_FACTION)!.resources.gold;
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: SPIRE }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.INVALID_GAME_STATE);
    assert.strictEqual(orch.getState().factions.get(PLAYER_FACTION)!.resources.gold, beforeGold);
    assert.ok(peekCollectibleResources(orch.getState(), SPIRE).gold > 0);
  });

  test('Golden Yield uses the stored multiplier once; a retry is normal collection', () => {
    const state = playerState();
    state.worldTick = 60;
    const session = completedSession('GOLDEN_YIELD', 'wses_17j_gy', { collectionTerritoryId: SPIRE });
    const applied = runWorkoutRewardPipeline(state, session, PLAYER_ID);
    assert.ok(applied.ok, applied.error?.message);
    const pending = applied.state.playerRewards.pendingGoldenYieldEffects[0]!;
    assert.ok(pending.multiplier > 1);
    const base = expectedYield(60);
    const orch = new Orchestrator(applied.state);
    const first = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: SPIRE, useGoldenYield: true }));
    assert.strictEqual(first.success, true, first.errors[0]?.message);
    assert.strictEqual(first.payload.multiplier, pending.multiplier);
    assert.strictEqual(first.payload.collected, Math.floor(base.gold * pending.multiplier));
    assert.strictEqual(orch.getState().playerRewards.pendingGoldenYieldEffects.length, 0);
    jump(orch, 60);
    const retry = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: SPIRE, useGoldenYield: true }));
    assert.strictEqual(retry.success, false);
    const normal = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: SPIRE }));
    assert.strictEqual(normal.success, true);
    assert.strictEqual(normal.payload.multiplier, 1);
    assert.strictEqual(normal.payload.collected, expectedYield(60).gold);
  });

  test('failed Golden Yield collection leaves the effect and resources untouched', () => {
    const state = playerState();
    pushGoldenYield(state, 2);
    const orch = new Orchestrator(state);
    const before = snapshotEconomy(orch.getState());
    const empty = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: SPIRE, useGoldenYield: true }));
    assert.strictEqual(empty.success, false);
    const stolen = orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: OTHER_TILE, useGoldenYield: true }));
    assert.strictEqual(stolen.success, false);
    assert.throws(() => collectTerritoryYield(cloneGameState(orch.getState()), {
      factionId: PLAYER_FACTION,
      territoryId: SPIRE,
      playerId: 'player_2',
      consumeGoldenYield: true,
    }));
    assert.deepStrictEqual(snapshotEconomy(orch.getState()), before);
    assert.strictEqual(orch.getState().playerRewards.pendingGoldenYieldEffects.length, 1);
  });

  test('Golden Yield cannot be spent on another faction\'s territory', () => {
    const state = playerState();
    state.worldTick = 60;
    pushGoldenYield(state, 3);
    assert.throws(() => collectTerritoryYield(state, {
      factionId: PLAYER_FACTION,
      territoryId: OTHER_TILE,
      playerId: PLAYER_ID,
      consumeGoldenYield: true,
    }));
    assert.strictEqual(state.playerRewards.pendingGoldenYieldEffects.length, 1);
  });

  test('cities belong to the owning faction and reject invalid relationships', () => {
    const state = playerState();
    plantCity(state, SPIRE);
    const city = state.cities.get(cityIdFor(SPIRE))!;
    assert.strictEqual(city.factionId, PLAYER_FACTION);
    assert.strictEqual(city.territoryId, SPIRE);
    const clone = cloneGameState(state);
    clone.cities.get(cityIdFor(SPIRE))!.factionId = OTHER_FACTION;
    assert.ok(checkGameStateInvariants(clone).some((v) => v.code === 'city.owner_mismatch'));
    const unowned = cloneGameState(state);
    unowned.cities.get(cityIdFor(SPIRE))!.territoryId = UNOWNED;
    unowned.cities.get(cityIdFor(SPIRE))!.id = cityIdFor(UNOWNED);
    unowned.cities.set(cityIdFor(UNOWNED), unowned.cities.get(cityIdFor(SPIRE))!);
    unowned.cities.delete(cityIdFor(SPIRE));
    assert.ok(checkGameStateInvariants(unowned).some((v) => v.code === 'city.unowned_territory'));
  });

  test('construction starts without a workout, deducts resources once, and rejects insufficient funds', () => {
    const ready = playerState();
    plantOwnedCities(ready);
    const orch = new Orchestrator(ready);
    const goldBefore = orch.getState().factions.get(PLAYER_FACTION)!.resources.gold;
    const stoneBefore = orch.getState().factions.get(PLAYER_FACTION)!.resources.stone;
    const started = orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_17j' }));
    assert.strictEqual(started.success, true, started.errors[0]?.message);
    assert.strictEqual(
      orch.getState().factions.get(PLAYER_FACTION)!.resources.gold,
      goldBefore - GAMEPLAY_CONFIG.constructionGoldCost,
    );
    assert.strictEqual(
      orch.getState().factions.get(PLAYER_FACTION)!.resources.stone,
      stoneBefore - GAMEPLAY_CONFIG.constructionStoneCost,
    );
    const project = orch.getState().constructions.get('con_17j')!;
    assert.strictEqual(project.status, 'in_progress');
    assert.strictEqual(project.remainingTicks, GAMEPLAY_CONFIG.defaultConstructionDurationTicks);
    assert.ok(orch.getState().cities.has(cityIdFor(HOME)));

    const poor = playerState();
    plantOwnedCities(poor);
    poor.factions.get(PLAYER_FACTION)!.resources.gold = 0;
    poor.factions.get(PLAYER_FACTION)!.resources.stone = 0;
    const poorOrch = new Orchestrator(poor);
    const before = snapshotEconomy(poorOrch.getState());
    const fail = poorOrch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_broke' }));
    assert.strictEqual(fail.success, false);
    assert.strictEqual(fail.errors[0]!.code, ErrorCode.INSUFFICIENT_RESOURCES);
    assert.deepStrictEqual(snapshotEconomy(poorOrch.getState()), before);
  });

  test('prototype allows only one in-progress construction per territory', () => {
    const ready = playerState();
    plantOwnedCities(ready);
    const orch = new Orchestrator(ready);
    assert.strictEqual(orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_a' })).success, true);
    const second = orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_b' }));
    assert.strictEqual(second.success, false);
    assert.strictEqual(second.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.ok(!orch.getState().constructions.has('con_b'));
  });

  test('construction progresses with world time and completes exactly once', () => {
    const ready = playerState();
    plantOwnedCities(ready);
    const orch = new Orchestrator(ready);
    const fortBefore = orch.getState().territories.get(HOME)!.fortification;
    orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_time' }));
    advance(orch, 10);
    const mid = orch.getState().constructions.get('con_time')!;
    assert.strictEqual(mid.status, 'in_progress');
    assert.strictEqual(mid.remainingTicks, GAMEPLAY_CONFIG.defaultConstructionDurationTicks - 10);
    advance(orch, 10);
    const done = orch.getState().constructions.get('con_time')!;
    assert.strictEqual(done.status, 'completed');
    assert.strictEqual(done.remainingTicks, 0);
    assert.strictEqual(orch.getState().territories.get(HOME)!.fortification, fortBefore + 1);
    const city = orch.getState().cities.get(cityIdFor(HOME))!;
    assert.ok(city.buildings.some((b) => b.type === 'FORTIFICATION' && b.level === fortBefore + 1));
    jump(orch, 60);
    assert.strictEqual(orch.getState().constructions.get('con_time')!.status, 'completed');
    assert.strictEqual(orch.getState().territories.get(HOME)!.fortification, fortBefore + 1);
  });

  test('Extra Construction Workers accelerate one project and are consumed once', () => {
    const state = playerState();
    plantOwnedCities(state);
    startConstruction(state, { factionId: PLAYER_FACTION, territoryId: HOME, projectId: 'con_work' });
    const remainingBefore = state.constructions.get('con_work')!.remainingTicks;
    const session = completedSession('EXTRA_CONSTRUCTION_WORKERS', 'wses_17j_cw', { constructionId: 'con_work' });
    const applied = runWorkoutRewardPipeline(state, session, PLAYER_ID);
    assert.ok(applied.ok, applied.error?.message);
    const power = applied.state.playerRewards.pendingConstructionEffects[0]!.workerPower;
    const orch = new Orchestrator(applied.state);
    const res = orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_work' }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    const expected = acceleratedRemainingTicks(remainingBefore, power);
    assert.strictEqual(orch.getState().constructions.get('con_work')!.remainingTicks, expected);
    assert.strictEqual(orch.getState().playerRewards.pendingConstructionEffects.length, 0);
    const again = orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_work' }));
    assert.strictEqual(again.success, false);
  });

  test('invalid or completed construction targets do not consume worker effects', () => {
    const ready = playerState();
    plantOwnedCities(ready);
    const orch = new Orchestrator(ready);
    orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_done' }));
    pushWorkers(orch.getState(), 50);
    const missing = orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'nope' }));
    assert.strictEqual(missing.success, false);
    assert.strictEqual(orch.getState().playerRewards.pendingConstructionEffects.length, 1);
    advance(orch, GAMEPLAY_CONFIG.defaultConstructionDurationTicks);
    assert.strictEqual(orch.getState().constructions.get('con_done')!.status, 'completed');
    const completed = orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_done' }));
    assert.strictEqual(completed.success, false);
    assert.strictEqual(orch.getState().playerRewards.pendingConstructionEffects.length, 1);
  });

  test('worker acceleration plus world-time progression does not double-count', () => {
    const ready = playerState();
    plantOwnedCities(ready);
    const orch = new Orchestrator(ready);
    orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_mix' }));
    advance(orch, 5);
    assert.strictEqual(orch.getState().constructions.get('con_mix')!.remainingTicks, 15);
    pushWorkers(orch.getState(), 5);
    orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_mix' }));
    assert.strictEqual(orch.getState().constructions.get('con_mix')!.remainingTicks, 10);
    advance(orch, 5);
    const project = orch.getState().constructions.get('con_mix')!;
    assert.strictEqual(project.status, 'in_progress');
    assert.strictEqual(project.remainingTicks, 5);
  });

  test('player cannot start or accelerate another faction\'s construction', () => {
    const state = playerState();
    plantOwnedCities(state);
    startConstruction(state, { factionId: OTHER_FACTION, territoryId: OTHER_TILE, projectId: 'con_other' });
    pushWorkers(state, 5);
    const orch = new Orchestrator(state);
    const stealStart = orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: OTHER_TILE, constructionId: 'con_steal' }));
    assert.strictEqual(stealStart.success, false);
    const stealAccel = orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'con_other' }));
    assert.strictEqual(stealAccel.success, false);
    assert.strictEqual(orch.getState().playerRewards.pendingConstructionEffects.length, 1);
    assert.strictEqual(orch.getState().constructions.get('con_other')!.remainingTicks, GAMEPLAY_CONFIG.defaultConstructionDurationTicks);
  });

  test('ownership transfer forfeits uncollected yield and starts the new owner\'s clock', () => {
    const orch = new Orchestrator(playerState());
    jump(orch, 60);
    assert.strictEqual(peekCollectibleResources(orch.getState(), SPIRE).gold, 30);
    const oldGold = orch.getState().factions.get(PLAYER_FACTION)!.resources.gold;
    const newGold = orch.getState().factions.get(OTHER_FACTION)!.resources.gold;
    const state = orch.getState();
    const tile = state.territories.get(SPIRE)!;
    const previous = tile.owner;
    const loser = state.factions.get(PLAYER_FACTION)!;
    loser.territories = loser.territories.filter((id) => id !== SPIRE);
    const winner = state.factions.get(OTHER_FACTION)!;
    if (!winner.territories.includes(SPIRE)) winner.territories.push(SPIRE);
    tile.owner = OTHER_FACTION;
    settleTerritoryOwnershipChange(state, SPIRE, OTHER_FACTION);
    assert.strictEqual(peekCollectibleResources(state, SPIRE).gold, 0);
    assert.strictEqual(state.factions.get(PLAYER_FACTION)!.resources.gold, oldGold);
    assert.strictEqual(state.factions.get(OTHER_FACTION)!.resources.gold, newGold);
    assert.ok(!state.cities.has(cityIdFor(SPIRE)));
    assert.strictEqual(previous, PLAYER_FACTION);
    state.worldTick += 60;
    progressWorldEconomy(state);
    assert.strictEqual(peekCollectibleResources(state, SPIRE).gold, 30);
    collectTerritoryYield(state, {
      factionId: OTHER_FACTION,
      territoryId: SPIRE,
      playerId: PLAYER_ID,
      consumeGoldenYield: false,
    });
    assert.strictEqual(state.factions.get(OTHER_FACTION)!.resources.gold, newGold + 30);
    assert.throws(() => collectTerritoryYield(state, {
      factionId: PLAYER_FACTION,
      territoryId: SPIRE,
      playerId: PLAYER_ID,
      consumeGoldenYield: false,
    }));
  });

  test('unowned tiles do not backfill production after they are claimed', () => {
    const orch = new Orchestrator(playerState());
    jump(orch, 60);
    assert.strictEqual(peekCollectibleResources(orch.getState(), UNOWNED).gold, 0);
    const state = orch.getState();
    const tile = state.territories.get(UNOWNED)!;
    tile.owner = PLAYER_FACTION;
    state.factions.get(PLAYER_FACTION)!.territories.push(UNOWNED);
    settleTerritoryOwnershipChange(state, UNOWNED, PLAYER_FACTION);
    assert.strictEqual(peekCollectibleResources(state, UNOWNED).gold, 0);
    assert.ok(!state.cities.has(cityIdFor(UNOWNED)));
    state.worldTick += 60;
    progressWorldEconomy(state);
    const output = tile.resourceOutput;
    assert.deepStrictEqual(peekCollectibleResources(state, UNOWNED), productionAccrued(output, 60));
  });

  test('in-progress construction is cancelled without refund when a territory changes owner', () => {
    const ready = playerState();
    plantOwnedCities(ready);
    const orch = new Orchestrator(ready);
    const goldBefore = orch.getState().factions.get(PLAYER_FACTION)!.resources.gold;
    orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_lost' }));
    const spent = goldBefore - orch.getState().factions.get(PLAYER_FACTION)!.resources.gold;
    assert.ok(spent > 0);
    const state = orch.getState();
    const tile = state.territories.get(HOME)!;
    state.factions.get(PLAYER_FACTION)!.territories = state.factions.get(PLAYER_FACTION)!.territories.filter((id) => id !== HOME);
    state.factions.get(OTHER_FACTION)!.territories.push(HOME);
    tile.owner = OTHER_FACTION;
    settleTerritoryOwnershipChange(state, HOME, OTHER_FACTION);
    assert.ok(!state.constructions.has('con_lost'));
    assert.strictEqual(state.factions.get(PLAYER_FACTION)!.resources.gold, goldBefore - spent);
  });

  test('public views expose own economy and hide other factions\' private economy', () => {
    const ready = playerState();
    plantOwnedCities(ready);
    const orch = new Orchestrator(ready);
    jump(orch, 60);
    orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_view' }));
    pushGoldenYield(orch.getState(), 2);
    pushWorkers(orch.getState(), 4);
    const res = orch.execute(cmdReq('GET_GAME_STATE', {}));
    assert.strictEqual(res.success, true);
    const view = res.payload.gameState as {
      factions: Array<{ id: string; resources?: unknown }>;
      playerGameplay?: {
        resources: { gold: number };
        cities: Array<{ territoryId: string }>;
        uncollected: Record<string, { gold: number }>;
        constructions: Array<{ id: string; remainingTicks: number }>;
        pendingGoldenYieldEffects: unknown[];
        pendingConstructionEffects: unknown[];
      };
    };
    assert.ok(view.factions.every((f) => f.resources === undefined));
    const pg = view.playerGameplay!;
    assert.strictEqual(pg.resources.gold, orch.getState().factions.get(PLAYER_FACTION)!.resources.gold);
    assert.ok(pg.cities.some((c) => c.territoryId === SPIRE));
    assert.ok(!pg.cities.some((c) => c.territoryId === OTHER_TILE));
    assert.strictEqual(pg.uncollected[SPIRE]!.gold, expectedYield(60).gold);
    assert.ok(!pg.uncollected[OTHER_TILE]);
    assert.ok(pg.constructions.some((c) => c.id === 'con_view'));
    assert.strictEqual(pg.pendingGoldenYieldEffects.length, 1);
    assert.strictEqual(pg.pendingConstructionEffects.length, 1);
    assert.ok(!('playerRewards' in view));
  });

  test('economy and city state JSON round-trips and satisfies invariants', () => {
    const ready = playerState();
    plantOwnedCities(ready);
    const orch = new Orchestrator(ready);
    jump(orch, 60);
    orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: HOME, constructionId: 'con_json' }));
    const state = orch.getState();
    const encoded = JSON.stringify({
      cities: [...state.cities.entries()],
      territoryEconomy: [...state.territoryEconomy.entries()],
      constructions: [...state.constructions.entries()],
      resources: [...state.factions.entries()].map(([id, f]) => [id, f.resources]),
    });
    const decoded = JSON.parse(encoded) as Record<string, unknown>;
    assert.strictEqual(JSON.stringify(decoded), encoded);
    assert.ok(!encoded.includes('NaN'));
    assert.ok(!encoded.includes('Infinity'));
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
    const bad = cloneGameState(state);
    bad.territoryEconomy.get(SPIRE)!.uncollected.gold = Number.NaN;
    assert.ok(checkGameStateInvariants(bad).some((v) => v.code === 'economy.malformed_uncollected'));
  });

  test('failed economy commands are atomic', () => {
    const orch = new Orchestrator(playerState());
    jump(orch, 60);
    const before = snapshotEconomy(orch.getState());
    orch.execute(cmdReq('COLLECT_RESOURCES', { territoryId: OTHER_TILE }));
    orch.execute(cmdReq('START_CONSTRUCTION', { territoryId: OTHER_TILE }));
    orch.execute(cmdReq('APPLY_CONSTRUCTION_ACCELERATION', { constructionId: 'missing' }));
    assert.deepStrictEqual(snapshotEconomy(orch.getState()), before);
  });
}
