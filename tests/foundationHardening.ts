import assert from 'assert';
import { BALANCE } from '../src/constants/balance';
import { ActionScorer } from '../src/scoring/ActionScorer';
import { WarlordState, isFactionEliminated } from '../src/engine/DecisionEngine';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { ErrorCode } from '../src/orchestration/errors';
import { isArmyVisibleTo, serializePublicGameState, serializeVisibleWorld } from '../src/orchestration/publicView';
import { cloneGameState, checkGameStateInvariants, createGameState } from '../src/state';
import { Army, Territory, WarlordSnapshot, AICommitment, GameStateSnapshot } from '../src/types';
import type { CommandRequest } from '../src/orchestration';
import { MemorySystem } from '../src/memory/MemorySystem';
import { GoalSystem } from '../src/goals/GoalSystem';
import { SeededRNG } from '../src/utils/SeededRNG';
import { SAMPLE_MAP, WARLORD_SPECS } from '../src/simulation/SampleMap';
import { runLongSimulation } from '../src/simulation/longRunHarness';
import type { WorldAdvanceResult } from '../src/world';

export interface FoundationHardeningTestApi {
  test: (name: string, fn: () => void) => void;
  cmdReq: (commandId: string, playerId: string, parameters?: Record<string, unknown>) => CommandRequest;
  makeCmt: (partial: Partial<AICommitment> & Pick<AICommitment, 'warlordId' | 'action'>) => AICommitment;
  makeTerritory: (overrides: Partial<Territory> & { id: string }) => Territory;
  makeSelf: (id: string, overrides?: Partial<WarlordSnapshot>) => WarlordSnapshot;
}

export function registerFoundationHardeningTests(api: FoundationHardeningTestApi): void {
  const { test, cmdReq, makeCmt, makeTerritory, makeSelf } = api;

  function publicState(res: { payload: Record<string, unknown> }): Record<string, unknown> {
    return res.payload.gameState as Record<string, unknown>;
  }

  function armyList(payload: Record<string, unknown>): Array<Record<string, unknown>> {
    return (payload.armies as Array<Record<string, unknown>>) ?? [];
  }

  console.log('Phase 16.5A — player/faction authorization');

  test('player can act as their own faction', () => {
    const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
    const owned = orch.getState().factions.get('merchant_republic')!.territories[0]!;
    const res = orch.execute(cmdReq('BUILD', 'player_1', { territoryId: owned, factionId: 'merchant_republic' }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
  });

  test('player cannot act as another faction by passing factionId', () => {
    const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
    const owned = orch.getState().factions.get('iron_kingdom')!.territories[0]!;
    const before = cloneGameState(orch.getState());
    const res = orch.execute(cmdReq('BUILD', 'attacker', { territoryId: owned, factionId: 'iron_kingdom' }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.ok(!JSON.stringify(res.errors).includes('iron_kingdom'));
    assert.deepStrictEqual(orch.getState(), before);
  });

  test('invalid faction is rejected without granting another empire', () => {
    const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
    const owned = orch.getState().factions.get('merchant_republic')!.territories[0]!;
    const missing = orch.execute(cmdReq('BUILD', 'player_1', { territoryId: owned, factionId: 'no_such_empire' }));
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
  });

  test('AI can still act as its own faction through RESOLVE_COMMITMENT', () => {
    const state = createGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    const owned = 'iron_kingdom_east';
    state.commitments.set('iron_kingdom', makeCmt({
      warlordId: 'iron_kingdom',
      action: 'BUILD',
      targetId: owned,
    }));
    const orch = new Orchestrator(state);
    const fortBefore = orch.getState().territories.get(owned)!.fortification;
    const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'player_1', { factionId: 'iron_kingdom' }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().territories.get(owned)!.fortification, fortBefore + 1);
  });

  test('ADVANCE_WORLD continues to run as a system command', () => {
    const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'player_1', { elapsedTicks: 1, factionId: 'iron_kingdom' }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().worldTick, 1);
  });

  test('authorization cannot be bypassed by changing only factionId on ATTACK', () => {
    const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
    const before = cloneGameState(orch.getState());
    const res = orch.execute(cmdReq('ATTACK', 'player_1', {
      territoryId: 'iron_spire',
      factionId: 'ashen_horde',
      seed: 1,
    }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.deepStrictEqual(orch.getState(), before);
  });

  test('GET_VISIBLE_WORLD cannot be used to inspect another faction fog view', () => {
    const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
    const res = orch.execute(cmdReq('GET_VISIBLE_WORLD', 'player_1', { factionId: 'ashen_horde' }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
  });

  console.log('Phase 16.5A — fog of war / public view');

  test('player can see their own armies in GET_GAME_STATE', () => {
    const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
    const ownArmy = [...orch.getState().armies.values()].find((a) => a.owner === 'merchant_republic')!;
    const res = orch.execute(cmdReq('GET_GAME_STATE', 'player_1'));
    assert.strictEqual(res.success, true);
    const armies = armyList(publicState(res));
    assert.ok(armies.some((a) => a.id === ownArmy.id && a.location === ownArmy.location));
  });

  test('hidden enemy armies are not exposed in public or visible-world payloads', () => {
    const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
    const hidden = [...orch.getState().armies.values()].find((a) => a.owner === 'ashen_horde')!;
    assert.strictEqual(isArmyVisibleTo(orch.getState(), 'merchant_republic', hidden), false);
    const pub = orch.execute(cmdReq('GET_GAME_STATE', 'player_1'));
    const vis = orch.execute(cmdReq('GET_VISIBLE_WORLD', 'player_1'));
    const blob = JSON.stringify(pub.payload) + JSON.stringify(vis.payload);
    assert.ok(!blob.includes(hidden.id), 'hidden army id must not appear in player-facing payloads');
    const pubArmies = armyList(publicState(pub));
    assert.ok(!pubArmies.some((a) => a.id === hidden.id));
    assert.ok(!pubArmies.some((a) => a.location === hidden.location && a.owner === 'ashen_horde'));
    const visArmies = armyList(vis.payload.visibleWorld as Record<string, unknown>);
    assert.ok(!visArmies.some((a) => a.id === hidden.id));
  });

  test('enemy army on a scouted/known tile is visible without leaking hidden ones', () => {
    const state = createGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    const ashenArmy = [...state.armies.values()].find((a) => a.owner === 'ashen_horde')!;
    const visibleLoc = 'central_plains';
    ashenArmy.location = visibleLoc;
    const hiddenLoc = 'frozen_peaks';
    const extra: Army = {
      ...ashenArmy,
      id: 'hidden_ashen_host',
      location: hiddenLoc,
    };
    state.armies.set(extra.id, extra);
    const ashen = state.factions.get('ashen_horde')!;
    ashen.armies.push(extra.id);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('GET_GAME_STATE', 'player_1'));
    const armies = armyList(publicState(res));
    assert.ok(armies.some((a) => a.id === ashenArmy.id && a.location === visibleLoc));
    assert.ok(!armies.some((a) => a.id === extra.id));
    assert.ok(!JSON.stringify(res.payload).includes('hidden_ashen_host'));
  });

  test('public view does not leak hidden army strength or attack plans', () => {
    const orch = new Orchestrator(createGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
    const hidden = [...orch.getState().armies.values()].find((a) => a.owner === 'ashen_horde')!;
    const res = orch.execute(cmdReq('GET_GAME_STATE', 'player_1'));
    const blob = JSON.stringify(res.payload);
    assert.ok(!blob.includes(hidden.id));
    for (const a of armyList(publicState(res))) {
      if (a.owner !== 'merchant_republic') {
        assert.strictEqual(a.pendingAttackTargetId, null);
        assert.strictEqual(a.morale, null);
      }
    }
  });

  test('serializePublicGameState without a viewer omits army details', () => {
    const state = createGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    const view = serializePublicGameState(state, null);
    assert.deepStrictEqual(view.armies, []);
    const visible = serializeVisibleWorld(state, 'merchant_republic');
    assert.ok(Array.isArray(visible.armies));
  });

  console.log('Phase 16.5A — BUILD gold and stone');

  test('enough gold and stone → build succeeds and deducts both', () => {
    const state = createGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    const { gold: costG, stone: costS } = BALANCE.territory.fortificationCostPerLevel;
    const goldBefore = state.factions.get(fid)!.resources.gold;
    const stoneBefore = state.factions.get(fid)!.resources.stone;
    const fortBefore = state.territories.get(owned)!.fortification;
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('BUILD', 'p', { territoryId: owned }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.strictEqual(orch.getState().factions.get(fid)!.resources.gold, goldBefore - costG);
    assert.strictEqual(orch.getState().factions.get(fid)!.resources.stone, stoneBefore - costS);
    assert.strictEqual(orch.getState().territories.get(owned)!.fortification, fortBefore + 1);
  });

  test('enough gold + insufficient stone → build fails and does not mutate', () => {
    const state = createGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    state.factions.get(fid)!.resources.stone = BALANCE.territory.fortificationCostPerLevel.stone - 1;
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('BUILD', 'p', { territoryId: owned }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.INSUFFICIENT_RESOURCES);
    assert.deepStrictEqual(orch.getState(), before);
  });

  test('insufficient gold + enough stone → build fails and does not mutate', () => {
    const state = createGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    state.factions.get(fid)!.resources.gold = BALANCE.territory.fortificationCostPerLevel.gold - 1;
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('BUILD', 'p', { territoryId: owned }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.INSUFFICIENT_RESOURCES);
    assert.deepStrictEqual(orch.getState(), before);
  });

  test('insufficient gold and stone → build fails', () => {
    const state = createGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    state.factions.get(fid)!.resources.gold = 0;
    state.factions.get(fid)!.resources.stone = 0;
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('BUILD', 'p', { territoryId: owned }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.INSUFFICIENT_RESOURCES);
  });

  test('maximum fortification rejects BUILD without charging resources', () => {
    const state = createGameState({ seed: 42, playerFactionId: 'merchant_republic' });
    const fid = 'merchant_republic';
    const owned = state.factions.get(fid)!.territories[0]!;
    state.territories.get(owned)!.fortification = 5;
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('BUILD', 'p', { territoryId: owned }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
    assert.deepStrictEqual(orch.getState(), before);
  });

  console.log('Phase 16.5A — live totalMilitaryPower');

  test('initial military power matches live armies and garrisons', () => {
    const state = createGameState({ seed: 42 });
    const fid = 'iron_kingdom';
    const snap = state.factions.get(fid)!;
    const ctx = WarlordState.buildContext(snap, {
      turn: 0,
      factions: state.factions,
      territories: state.territories,
      armies: state.armies,
      allFactionIds: state.allFactionIds,
    });
    assert.ok(ctx.self.totalMilitaryPower > 0);
    assert.strictEqual(ctx.self.totalMilitaryPower, snap.totalMilitaryPower);
  });

  test('army changes update military power used by AI scoring', () => {
    const home = makeTerritory({ id: 'home', owner: 'me', neighboring: ['enemy'], garrison: 10 });
    const enemyT = makeTerritory({ id: 'enemy', owner: 'foe', neighboring: ['home'], garrison: 10 });
    const army: Army = {
      id: 'host', owner: 'me', location: 'home',
      soldiers: 400, knights: 0, siegeEngines: 0, morale: 80, supply: 80, movement: null, attackIntent: null,
    };
    const me = makeSelf('me', {
      territories: ['home'], armies: ['host'], totalMilitaryPower: 999999,
      knownFactions: ['me', 'foe'],
    });
    const foe = makeSelf('foe', { territories: ['enemy'], armies: [], totalMilitaryPower: 1 });
    const gs: GameStateSnapshot = {
      turn: 1,
      factions: new Map([['me', me], ['foe', foe]]),
      territories: new Map([['home', home], ['enemy', enemyT]]),
      armies: new Map([[army.id, army]]),
      allFactionIds: ['me', 'foe'],
    };
    const before = WarlordState.buildContext(me, gs).self.totalMilitaryPower;
    army.soldiers = 50;
    const after = WarlordState.buildContext(me, gs).self.totalMilitaryPower;
    assert.ok(after < before);
    assert.ok(after < 999999);
  });

  test('destroyed armies cannot remain represented in stale power', () => {
    const home = makeTerritory({ id: 'home', owner: 'me', garrison: 0 });
    const army: Army = {
      id: 'host', owner: 'me', location: 'home',
      soldiers: 800, knights: 0, siegeEngines: 0, morale: 80, supply: 80, movement: null, attackIntent: null,
    };
    const me = makeSelf('me', { territories: ['home'], armies: ['host'], totalMilitaryPower: 800 });
    const gs: GameStateSnapshot = {
      turn: 1,
      factions: new Map([['me', me]]),
      territories: new Map([['home', home]]),
      armies: new Map([[army.id, army]]),
      allFactionIds: ['me'],
    };
    assert.ok(WarlordState.buildContext(me, gs).self.totalMilitaryPower >= 800);
    gs.armies.delete('host');
    me.armies = [];
    assert.strictEqual(WarlordState.buildContext(me, gs).self.totalMilitaryPower, 0);
  });

  test('AI scoring uses live power rather than an obsolete snapshot field', () => {
    const home = makeTerritory({ id: 'home', owner: 'me', neighboring: ['them'], garrison: 5 });
    const themT = makeTerritory({ id: 'them', owner: 'foe', neighboring: ['home'], garrison: 5 });
    const me = makeSelf('me', {
      territories: ['home'], armies: [], totalMilitaryPower: 1,
      knownFactions: ['me', 'foe'],
      diplomacy: new Map([['foe', {
        target: 'foe', state: 'neutral', opinion: 0, treaties: [], yearsAtPeace: 1, yearsAtWar: 0,
      }]]),
    });
    const foeArmy: Army = {
      id: 'foe_host', owner: 'foe', location: 'them',
      soldiers: 5000, knights: 0, siegeEngines: 0, morale: 80, supply: 80, movement: null, attackIntent: null,
    };
    const foe = makeSelf('foe', {
      territories: ['them'], armies: ['foe_host'], totalMilitaryPower: 1,
    });
    const gs: GameStateSnapshot = {
      turn: 1,
      factions: new Map([['me', me], ['foe', foe]]),
      territories: new Map([['home', home], ['them', themT]]),
      armies: new Map([[foeArmy.id, foeArmy]]),
      allFactionIds: ['me', 'foe'],
    };
    const ctx = WarlordState.buildContext(me, gs);
    assert.ok(ctx.allFactions.get('foe')!.totalMilitaryPower > 1000);
    const scored = new ActionScorer().scoreAllActions({
      ctx, turn: 1, rng: new SeededRNG(1), memory: new MemorySystem(), goals: new GoalSystem([]),
    });
    assert.ok(scored.length > 0);
  });

  console.log('Phase 16.5A — sample map celestial theocracy');

  test('SAMPLE_MAP celestial_theocracy starts with consistent land and army', () => {
    const state = createGameState({ seed: 1 });
    const theo = state.factions.get('celestial_theocracy')!;
    assert.ok(theo.territories.length > 0);
    assert.ok(theo.armies.length > 0);
    assert.strictEqual(isFactionEliminated(theo), false);
    for (const tid of theo.territories) {
      assert.strictEqual(state.territories.get(tid)!.owner, 'celestial_theocracy');
    }
    for (const aid of theo.armies) {
      assert.strictEqual(state.armies.get(aid)!.owner, 'celestial_theocracy');
    }
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
    assert.ok(WARLORD_SPECS.some((s) => s.id === 'celestial_theocracy' && s.startingTerritories.length > 0));
    assert.ok(SAMPLE_MAP.some((t) => t.owner === 'celestial_theocracy'));
  });

  console.log('Phase 16.5A — scout fallback visibility');

  test('valid adjacent scout succeeds on a hand-authored world', () => {
    const orch = new Orchestrator(createGameState({ seed: 5, playerFactionId: 'merchant_republic' }));
    const res = orch.execute(cmdReq('SCOUT', 'p', { territoryId: 'central_plains' }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    assert.ok(orch.getState().factions.get('merchant_republic')!.knownTerritories.includes('central_plains'));
  });

  test('non-adjacent hidden target cannot be revealed via missing mapWorld', () => {
    const orch = new Orchestrator(createGameState({ seed: 5, playerFactionId: 'merchant_republic' }));
    assert.strictEqual(orch.getState().mapWorld, null);
    const before = cloneGameState(orch.getState());
    const res = orch.execute(cmdReq('SCOUT', 'p', { territoryId: 'frozen_peaks' }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.FOG_OF_WAR);
    assert.deepStrictEqual(orch.getState().factions.get('merchant_republic')!.knownTerritories, before.factions.get('merchant_republic')!.knownTerritories);
  });

  test('invalid territory scout is rejected', () => {
    const orch = new Orchestrator(createGameState({ seed: 5, playerFactionId: 'merchant_republic' }));
    const res = orch.execute(cmdReq('SCOUT', 'p', { territoryId: 'no_such_tile' }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.INVALID_TERRITORY);
  });

  test('arbitrary far territory ids cannot be learned from a null mapWorld', () => {
    const orch = new Orchestrator(createGameState({ seed: 5, playerFactionId: 'merchant_republic' }));
    const res = orch.execute(cmdReq('SCOUT', 'p', { territoryId: 'burning_desert' }));
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.FOG_OF_WAR);
  });

  console.log('Phase 16.5A — GameState invariant gaps');

  test('allFactionIds must match the factions map', () => {
    const state = createGameState({ seed: 1 });
    state.allFactionIds.push('merchant_republic');
    assert.ok(checkGameStateInvariants(state).some((v) => v.code === 'faction.duplicate_id'));
    const extra = createGameState({ seed: 1 });
    extra.factions.set('ghost', makeSelf('ghost'));
    assert.ok(checkGameStateInvariants(extra).some((v) => v.code === 'faction.missing_from_all_ids'));
  });

  test('army membership must agree in both directions', () => {
    const state = createGameState({ seed: 1, playerFactionId: 'merchant_republic' });
    const army = [...state.armies.values()][0]!;
    const owner = state.factions.get(army.owner)!;
    owner.armies = owner.armies.filter((id) => id !== army.id);
    assert.ok(checkGameStateInvariants(state).some((v) => v.code === 'army.not_listed_by_owner'));
  });

  test('territory neighbor ids must exist', () => {
    const state = createGameState({ seed: 1 });
    const t = state.territories.get('central_plains')!;
    t.neighboring.push('missing_neighbor_tile');
    assert.ok(checkGameStateInvariants(state).some((v) => v.code === 'territory.neighbor_missing_neighbor'));
  });

  test('visibility maps cannot reference unknown factions or territories', () => {
    const state = createGameState({ seed: 1, playerFactionId: 'merchant_republic' });
    state.visibility.set('nope', {
      owner: 'nope',
      visibility: new Map([['central_plains', {
        state: 'scouted', lastUpdatedTurn: 0, turnsSinceSeen: null, revealedBy: 'scout',
      }]]),
      knownThemes: new Set(),
      knownRegions: new Set(),
    });
    const codes = checkGameStateInvariants(state).map((v) => v.code);
    assert.ok(codes.includes('visibility.unknown_faction'));
    state.visibility.delete('nope');
    state.visibility.set('merchant_republic', {
      owner: 'ashen_horde',
      visibility: new Map([['not_a_tile', {
        state: 'scouted', lastUpdatedTurn: 0, turnsSinceSeen: null, revealedBy: 'scout',
      }]]),
      knownThemes: new Set(),
      knownRegions: new Set(),
    });
    const more = checkGameStateInvariants(state).map((v) => v.code);
    assert.ok(more.includes('visibility.owner_mismatch'));
    assert.ok(more.includes('visibility.unknown_territory'));
  });

  test('injected eliminated faction does not receive AI_DECIDE', () => {
    const state = createGameState({ seed: 5, playerFactionId: 'merchant_republic' });
    const ghost = makeSelf('ghost_empire', { territories: [], armies: [] });
    state.factions.set('ghost_empire', ghost);
    state.allFactionIds.push('ghost_empire');
    state.commitments.set('ghost_empire', null);
    const orch = new Orchestrator(state);
    assert.strictEqual(isFactionEliminated(ghost), true);
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 8 }));
    assert.strictEqual(res.success, true, res.errors[0]?.message);
    const advance = res.payload.worldAdvance as WorldAdvanceResult;
    assert.ok(!advance.aiDecisions.some((d) => d.factionId === 'ghost_empire'));
  });

  test('long simulation still reports zero decisions for factions eliminated at start', () => {
    const ghostSpec = {
      ...WARLORD_SPECS.find((s) => s.id === 'merchant_republic')!,
      id: 'ghost_empire',
      name: 'Ghost Empire',
      startingTerritories: [] as string[],
      startingArmy: { soldiers: 0, knights: 0, siege: 0 },
    };
    const result = runLongSimulation({
      seed: 3,
      ticks: 20,
      playerFactionId: 'merchant_republic',
      warlordSpecs: [...WARLORD_SPECS, ghostSpec],
    });
    assert.ok(result.eliminatedAtStart.includes('ghost_empire'));
    assert.strictEqual(result.decisionsForEliminatedFactions, 0);
  });
}
