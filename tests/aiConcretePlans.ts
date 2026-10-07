import assert from 'assert';
import { AICommitment, Army, Territory, WarlordSnapshot, GameStateSnapshot, ScoredAction } from '../src/types';
import { AIConcretePlan, AttackPlan, BuildPlan, MovePlan, RetreatPlan, PROACTIVE_AI_ACTIONS, makeConcretePlan, planTargetId, concretePlanProblem } from '../src/types/AIConcretePlan';
import { generateConcretePlans, validateConcretePlan } from '../src/engine/concretePlans';
import { DecisionEngine, WarlordState, cloneCommitment } from '../src/engine/DecisionEngine';
import { ActionScorer } from '../src/scoring/ActionScorer';
import { SeededRNG } from '../src/utils/SeededRNG';
import { MemorySystem } from '../src/memory/MemorySystem';
import { GoalSystem } from '../src/goals/GoalSystem';
import { GameState } from '../src/types/GameState';
import { createLegacySampleMapGameState } from '../src/state/createGameState';
import { cloneGameState } from '../src/state/cloneGameState';
import { toDecisionEngineSnapshot, buildWarlordStates } from '../src/state/gameStateAdapters';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { Orchestrator, createDefaultRegistry, CommandRequest } from '../src/orchestration';
import { BattleEngine, BattleInput } from '../src/battle/BattleEngine';
import { ensureCity } from '../src/gameplay/cities/city';
import { getConstructionProjectDefinition } from '../src/gameplay/construction/definitions';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { encodePersistable } from '../src/persistence/serialization';
import { authoredWorldFields } from './worldTestHelpers';

interface Api {
  test(name: string, run: () => void): void;
  makeSelf(id: string, overrides?: Partial<WarlordSnapshot>): WarlordSnapshot;
  makeTerritory(overrides: Partial<Territory> & { id: string }): Territory;
  makeCmt(partial: Partial<AICommitment> & Pick<AICommitment, 'warlordId' | 'action'>): AICommitment;
  cmdReq(commandId: string, playerId: string, parameters?: Record<string, unknown>): CommandRequest;
}
export function registerAiConcretePlanTests(api: Api): void {
  const { test, makeSelf, makeTerritory, makeCmt, cmdReq } = api;
  function world(): GameState {
    const state = createLegacySampleMapGameState({ seed: 37 });
    const specs: [string, string | null, string[]][] = [
      ['home', 'me', ['stage', 'fallback', 'field']],
      ['stage', 'me', ['home', 'target', 'fallback']],
      ['fallback', 'me', ['home', 'stage', 'field', 'target']],
      ['target', 'enemy', ['stage', 'fallback']],
      ['field', null, ['home', 'fallback']], ['safe', 'spectator', []],
    ];
    state.territories = new Map(specs.map(([id, owner, neighboring]) => [id, makeTerritory({ id, owner, neighboring, garrison: 20 })]));
    Object.assign(state, authoredWorldFields(state.territories));
    const army = (id: string, location: string): Army => ({ id, location, owner: 'me', soldiers: 600, knights: 10, siegeEngines: 0, morale: 80, supply: 80 });
    state.armies = new Map([['a', army('a', 'home')], ['z', army('z', 'home')]]);
    state.factions = new Map(['me', 'enemy', 'spectator'].map(id => [id, makeSelf(id, {
      territories: specs.filter(s => s[1] === id).map(s => s[0]), armies: id === 'me' ? ['a', 'z'] : [],
      knownFactions: ['me', 'enemy', 'spectator'], knownTerritories: specs.map(s => s[0]),
      resources: { gold: 10000, food: 10000, iron: 10000, wood: 10000, stone: 10000 },
      diplomacy: new Map(), goals: [], memory: [],
    })]));
    state.allFactionIds = ['me', 'enemy', 'spectator'];
    state.playerFactionId = 'spectator'; state.levelAnchorTerritoryIds = ['safe'];
    state.commitments = new Map(state.allFactionIds.map(id => [id, null]));
    state.cities.clear(); state.constructions.clear(); state.territoryInfrastructure.clear();
    state.territoryEconomy.clear(); state.activeInvasions.clear(); state.attackerCooldowns.clear();
    state.activeEvents = []; state.eventHistory = [];
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
    return state;
  }
  const plans = (state: GameState) => generateConcretePlans(toDecisionEngineSnapshot(state), 'me');
  function commit(state: GameState, plan: AIConcretePlan): void {
    state.commitments.set('me', { ...makeCmt({ warlordId: 'me', action: plan.action, targetId: planTargetId(plan) }), plan });
  }
  function input(state: GameStateSnapshot, seed = 4) {
    return { ctx: WarlordState.buildContext(state.factions.get('me')!, state), turn: state.turn,
      rng: new SeededRNG(seed), memory: new MemorySystem(), goals: new GoalSystem([]) };
  }
  class RecordingBattle extends BattleEngine {
    inputs: BattleInput[] = [];
    override resolve(value: BattleInput) { this.inputs.push(value); return super.resolve(value); }
  }

  test('Phase B: vocabulary is exactly eight; unavailable final sources produce no fake plans', () => {
    assert.deepStrictEqual([...PROACTIVE_AI_ACTIONS], ['ATTACK', 'REINFORCE', 'BUILD', 'MOVE', 'OFFER_PEACE', 'TRADE', 'RETREAT', 'WAIT']);
    const state = world(); state.armies.get('z')!.location = 'field';
    const generated = plans(state);
    assert.deepStrictEqual([...new Set(generated.map(p => p.action))].sort(), ['ATTACK', 'BUILD', 'MOVE', 'RETREAT', 'WAIT']);
    assert.ok(!generated.some(p => ['REINFORCE', 'OFFER_PEACE', 'TRADE', 'DEFEND', 'NEGOTIATE', 'DECLARE_WAR', 'EXPAND', 'SCOUT', 'COLLECT'].includes(p.action)));
  });
  test('Phase B: generators enumerate every legal force/staging combination rather than best-first truncation', () => {
    const attack = plans(world()).filter((p): p is AttackPlan => p.action === 'ATTACK');
    assert.deepStrictEqual(attack.map(p => [p.armyId, p.stagingTerritoryId]).sort(), [['a', 'fallback'], ['a', 'stage'], ['z', 'fallback'], ['z', 'stage']]);
    assert.strictEqual(new Set(attack.map(p => p.id)).size, 4);
  });
  test('Phase B: exact ATTACK army/target survive scoring and execution', () => {
    const state = world(); state.armies.get('a')!.location = 'stage'; state.armies.get('z')!.location = 'stage';
    const plan = plans(state).find((p): p is AttackPlan => p.action === 'ATTACK' && p.armyId === 'z' && p.stagingTerritoryId === 'stage')!;
    const scored = new ActionScorer().scorePlans([plan], input(toDecisionEngineSnapshot(state)));
    assert.strictEqual(scored[0]!.plan.id, plan.id);
    const choose = new DecisionEngine(4) as unknown as { selectWithRandomness(a: ScoredAction[], r: SeededRNG): { selected: ScoredAction } };
    commit(state, choose.selectWithRandomness(scored, new SeededRNG(4)).selected.plan!);
    const battle = new RecordingBattle(); const registry = createDefaultRegistry(); registry.registerBattle(battle);
    const orch = new Orchestrator(state, registry);
    const result = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' }));
    assert.strictEqual(result.success, true, result.errors[0]?.message);
    assert.strictEqual(battle.inputs.length, 1);
    assert.deepStrictEqual(battle.inputs[0]!.attackerArmies.map(a => (a as Army).id), ['z']);
    assert.strictEqual(orch.getState().armies.get('a')!.soldiers, 600);
  });
  test('Phase B: ATTACK uses exact selected staging even when another force/route is preferred by legacy selection', () => {
    const state = world();
    const plan = plans(state).find((p): p is AttackPlan => p.action === 'ATTACK' && p.armyId === 'z' && p.stagingTerritoryId === 'stage')!;
    commit(state, plan);
    const orch = new Orchestrator(state);
    const result = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' }));
    assert.strictEqual(result.success, true, result.errors[0]?.message);
    assert.strictEqual(orch.getState().armies.get('z')!.movement!.destinationTerritoryId, 'stage');
    assert.strictEqual(orch.getState().armies.get('a')!.movement, undefined);
    assert.strictEqual(orch.getState().armies.get('z')!.attackIntent!.onlyArmyId, 'z');
  });
  for (const action of ['MOVE', 'RETREAT'] as const) test(`Phase B: ${action} consumes exact army and destination, not first army/neighbor`, () => {
    const state = world();
    if (action === 'RETREAT') for (const army of state.armies.values()) army.location = 'field';
    const plan = plans(state).find(p => p.action === action && p.armyId === 'z'
      && (p.action === 'MOVE' ? p.destinationTerritoryId : p.action === 'RETREAT' ? p.fallbackTerritoryId : '') === 'fallback')! as MovePlan | RetreatPlan;
    commit(state, plan);
    const orch = new Orchestrator(state);
    const result = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' }));
    assert.strictEqual(result.success, true, result.errors[0]?.message);
    assert.strictEqual(orch.getState().armies.get('z')!.movement!.destinationTerritoryId, 'fallback');
    assert.strictEqual(orch.getState().armies.get('a')!.movement, undefined);
    assert.strictEqual(orch.getState().commitments.get('me')!.plan!.id, plan.id);
  });
  for (const projectType of ['CITY', 'FARM', 'MINE', 'LUMBER', 'FORTIFICATION'] as const) test(`Phase B: BUILD executes exact ${projectType} on exact site`, () => {
    const state = world(); if (projectType === 'FORTIFICATION') ensureCity(state, 'home', 'me');
    const plan = plans(state).find((p): p is BuildPlan => p.action === 'BUILD' && p.projectType === projectType && p.territoryId === 'home')!;
    assert.ok(plan); commit(state, plan);
    const orch = new Orchestrator(state);
    const result = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' }));
    assert.strictEqual(result.success, true, result.errors[0]?.message);
    const projects = [...orch.getState().constructions.values()];
    assert.strictEqual(projects.length, 1); assert.strictEqual(projects[0]!.projectType, projectType); assert.strictEqual(projects[0]!.territoryId, 'home');
    assert.strictEqual(orch.getState().factions.get('me')!.resources.gold, 10000 - getConstructionProjectDefinition(projectType).cost.gold);
  });
  test('Phase B: legality excludes wrong-owner, moving/engaged armies, invalid targets and impossible routes', () => {
    const state = world(); const original = plans(state).find((p): p is AttackPlan => p.action === 'ATTACK')!;
    state.armies.get('a')!.owner = 'enemy';
    state.armies.get('z')!.movement = { originTerritoryId: 'home', destinationTerritoryId: 'stage', status: 'moving', startedAtTick: 0, durationTicks: 4, commitmentId: null };
    assert.ok(!plans(state).some(p => p.action === 'ATTACK' || p.action === 'MOVE' || p.action === 'RETREAT'));
    const clean = world(); clean.armies.get('a')!.attackIntent = { targetTerritoryId: 'target', stagingTerritoryId: 'stage', status: 'ready', createdAtTick: 0, commitmentId: null, battleSeed: 0 };
    assert.ok(!plans(clean).some(p => 'armyId' in p && p.armyId === 'a'));
    for (const patch of [{ targetTerritoryId: 'missing' }, { targetTerritoryId: 'home' }, { route: ['home', 'target'] }]) {
      const { id, ...draft } = original;
      assert.strictEqual(validateConcretePlan(makeConcretePlan({ ...draft, ...patch }), toDecisionEngineSnapshot(world())).valid, false);
    }
  });
  test('Phase B: construction eligibility uses actual ownership, occupancy, requirements, capacity and costs', () => {
    const state = world();
    assert.ok(!plans(state).some(p => p.action === 'BUILD' && (p.territoryId === 'target' || p.projectType === 'FORTIFICATION')));
    state.territoryInfrastructure.set('home', { territoryId: 'home', farmCompletedAtTick: 0, mineCompletedAtTick: null, lumberCompletedAtTick: null });
    assert.ok(!plans(state).some(p => p.action === 'BUILD' && p.territoryId === 'home' && p.projectType === 'FARM'));
    const plan = plans(state).find((p): p is BuildPlan => p.action === 'BUILD' && p.territoryId === 'home')!;
    commit(state, plan); const orch = new Orchestrator(state);
    assert.strictEqual(orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' })).success, true);
    assert.ok(!plans(orch.getState()).some(p => p.action === 'BUILD' && p.territoryId === 'home'));
    state.factions.get('me')!.resources = { gold: 0, food: 0, iron: 0, wood: 0, stone: 0 };
    assert.ok(!plans(state).some(p => p.action === 'BUILD'));
  });
  test('Phase B: execution invalidates changed exact force without substituting another legal force', () => {
    const state = world(); const plan = plans(state).find((p): p is MovePlan => p.action === 'MOVE' && p.armyId === 'z')!;
    commit(state, plan); state.armies.get('z')!.location = 'safe';
    const orch = new Orchestrator(state);
    const result = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' }));
    assert.strictEqual(result.success, false); assert.strictEqual(result.payload.commitmentOutcome, 'failed');
    assert.strictEqual(orch.getState().armies.get('a')!.movement, undefined);
  });
  test('Phase B: generation IDs/order and selected plan are invariant under insertion order, reconstruction and reload', () => {
    const state = createLegacySampleMapGameState({ seed: 37 });
    const a = generateConcretePlans(toDecisionEngineSnapshot(state), 'merchant_republic');
    const reordered = cloneGameState(state);
    reordered.armies = new Map([...reordered.armies].reverse()); reordered.territories = new Map([...reordered.territories].reverse());
    for (const t of reordered.territories.values()) t.neighboring.reverse();
    assert.deepStrictEqual(generateConcretePlans(toDecisionEngineSnapshot(reordered), 'merchant_republic'), a);
    const reload = hydratePersistedPayload(encodePersistable(state));
    assert.deepStrictEqual(generateConcretePlans(toDecisionEngineSnapshot(reload), 'merchant_republic'), a);
    const decide = (s: GameState) => new DecisionEngine(37).decide(buildWarlordStates(s).get('merchant_republic')!, toDecisionEngineSnapshot(s), s.turn).commitment!.plan;
    assert.deepStrictEqual(decide(state), decide(reload));
  });
  test('Phase B: bounded near-top selection is seeded; clearly inferior plans cannot win', () => {
    const candidates = plans(world()).slice(0, 3);
    const scores = candidates.map((plan, i) => ({ action: plan.action, plan, targetId: planTargetId(plan), targetName: null,
      score: i === 2 ? -100 : 90 + i, baseScore: 0, reasoning: [], factorBreakdown: [] }));
    const engine = new DecisionEngine(42) as unknown as { selectWithRandomness(a: ScoredAction[], r: SeededRNG): { selected: ScoredAction } };
    const chosen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const selected = engine.selectWithRandomness(scores, new SeededRNG(seed)).selected;
      chosen.add(selected.plan!.id);
      assert.notStrictEqual(selected.plan!.id, candidates[2]!.id);
      assert.strictEqual(selected.plan!.id, engine.selectWithRandomness([...scores].reverse(), new SeededRNG(seed)).selected.plan!.id);
    }
    assert.strictEqual(chosen.size, 2, 'seeded variation stays inside the two near-top alternatives');
  });
  test('Phase B: plans and nested parameters are immutable and isolated when commitment/state is cloned', () => {
    const state = world(); const plan = plans(state).find((p): p is AttackPlan => p.action === 'ATTACK')!;
    commit(state, plan); const c = cloneCommitment(state.commitments.get('me')!);
    assert.notStrictEqual(c.plan, plan); assert.ok(Object.isFrozen(c.plan));
    assert.ok(Object.isFrozen((c.plan as AttackPlan).route));
    assert.throws(() => ((c.plan as AttackPlan).route as string[]).push('illegal'));
    const before = encodePersistable(state); plans(state); new ActionScorer().scoreAllActions(input(toDecisionEngineSnapshot(state)));
    assert.deepStrictEqual(encodePersistable(state), before);
  });
  test('Phase B: persistence retains exact plans; schema 17 legacy commitments remain un-reconstructed', () => {
    const state = createLegacySampleMapGameState({ seed: 37 }); const faction = 'merchant_republic';
    const plan = generateConcretePlans(toDecisionEngineSnapshot(state), faction).find(p => p.action === 'BUILD')!;
    state.commitments.set(faction, { ...makeCmt({ warlordId: faction, action: plan.action, targetId: planTargetId(plan) }), plan });
    const loaded = hydratePersistedPayload(encodePersistable(state));
    assert.deepStrictEqual(loaded.commitments.get(faction)!.plan, plan);
    assert.ok(Object.isFrozen(loaded.commitments.get(faction)!.plan));
    delete state.commitments.get(faction)!.plan; state.schemaVersion = 17;
    assert.strictEqual(hydratePersistedPayload(encodePersistable(state)).commitments.get(faction)!.plan, undefined);
  });
  test('Phase B: future-shaped pool and proposal contracts do not enable legacy execution', () => {
    const state = world();
    const future = [
      makeConcretePlan({ action: 'REINFORCE', factionId: 'me', territoryId: 'home', sourcePoolId: 'pool_home', quantity: 30, destination: { kind: 'garrison', territoryId: 'home' } }),
      makeConcretePlan({ action: 'TRADE', factionId: 'me', counterpartyId: 'enemy', offered: { iron: 20 }, requested: { wood: 30 } }),
      makeConcretePlan({ action: 'OFFER_PEACE', factionId: 'me', counterpartyId: 'enemy' }),
    ];
    for (const p of future) {
      assert.strictEqual(concretePlanProblem(p), null); const s = cloneGameState(state); commit(s, p);
      const orch = new Orchestrator(s); const result = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' }));
      assert.strictEqual(result.success, false); assert.strictEqual(result.errors[0]!.code, 'FEATURE_NOT_IMPLEMENTED');
      assert.strictEqual(orch.getState().territories.get('home')!.garrison, 20);
      assert.strictEqual(orch.getState().factions.get('me')!.resources.gold, 10000);
    }
  });
  test('Phase B: WAIT has no physical target or economic reward; single-commitment gating remains', () => {
    const state = world(); const plan = plans(state).find(p => p.action === 'WAIT')!;
    commit(state, plan);
    const ws = buildWarlordStates(state).get('me')!;
    const decision = new DecisionEngine(42).decide(ws, toDecisionEngineSnapshot(state), state.turn);
    assert.strictEqual(decision.isNewCommitment, false); assert.strictEqual(decision.commitment!.plan!.id, plan.id);
    const orch = new Orchestrator(state); const before = { ...state.factions.get('me')!.resources };
    assert.strictEqual(orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' })).success, true);
    assert.deepStrictEqual(orch.getState().factions.get('me')!.resources, before);
  });
  test('Phase B: changed attack army fails without substituting an available attacker', () => {
    const state = world(); state.armies.get('a')!.location = 'stage'; state.armies.get('z')!.location = 'stage';
    const plan = plans(state).find((p): p is AttackPlan => p.action === 'ATTACK' && p.armyId === 'z' && p.stagingTerritoryId === 'stage')!;
    commit(state, plan); state.armies.get('z')!.soldiers = 20; state.armies.get('z')!.knights = 0;
    const battle = new RecordingBattle(); const registry = createDefaultRegistry(); registry.registerBattle(battle);
    const orch = new Orchestrator(state, registry);
    const result = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' }));
    assert.strictEqual(result.success, false); assert.strictEqual(result.payload.commitmentOutcome, 'failed');
    assert.strictEqual(battle.inputs.length, 0); assert.strictEqual(orch.getState().armies.get('a')!.soldiers, 600);
  });
  test('Phase B: an exact fortification upgrade cannot silently become the next different level', () => {
    const state = world(); ensureCity(state, 'home', 'me');
    const plan = plans(state).find((p): p is BuildPlan => p.action === 'BUILD' && p.projectType === 'FORTIFICATION' && p.territoryId === 'home')!;
    assert.strictEqual(plan.targetFortificationLevel, state.territories.get('home')!.fortification + 1);
    state.territories.get('home')!.fortification++;
    assert.strictEqual(validateConcretePlan(plan, toDecisionEngineSnapshot(state)).valid, false);
  });
  test('Phase B: an active exact movement can be polled without selecting another force', () => {
    const state = world(); const plan = plans(state).find((p): p is MovePlan => p.action === 'MOVE' && p.armyId === 'z')!;
    commit(state, plan); const orch = new Orchestrator(state);
    const first = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' }));
    assert.strictEqual(first.success, true);
    const second = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' }));
    assert.strictEqual(second.success, true); assert.strictEqual(second.payload.armyId, 'z');
    assert.strictEqual(orch.getState().armies.get('a')!.movement, undefined);
  });
  test('Phase B: turn-only legacy harness rejects concrete operations rather than substituting parameters', () => {
    const { simulateDecisionOutcomes } = require('../src/simulation/cli');
    const state = world(); const plan = plans(state).find(p => p.action === 'MOVE')!; commit(state, plan);
    const runtime = buildWarlordStates(state);
    const decision = new DecisionEngine(37).decide(runtime.get('me')!, toDecisionEngineSnapshot(state), state.turn);
    const before = encodePersistable(state);
    assert.throws(() => simulateDecisionOutcomes([decision], runtime, toDecisionEngineSnapshot(state), state.turn, 37, false), /canonical --world/);
    assert.deepStrictEqual(encodePersistable(state), before);
  });
  test('Phase B: WAIT rejects physical-target parameters and legacy WAIT no longer grants income', () => {
    const { simulateDecisionOutcomes } = require('../src/simulation/cli');
    const state = world(); const plan = plans(state).find(p => p.action === 'WAIT')!;
    const { id, ...draft } = plan;
    const invalid = makeConcretePlan({ ...draft, targetTerritoryId: 'home' } as never);
    assert.ok(concretePlanProblem(invalid));
    const runtime = buildWarlordStates(state); const me = state.factions.get('me')!;
    me.resourceIncome = { gold: 10000, food: 10000 }; const before = { ...me.resources };
    simulateDecisionOutcomes([{ action: 'WAIT', warlordId: 'me', targetId: null }], runtime, toDecisionEngineSnapshot(state), state.turn, 37, false);
    assert.deepStrictEqual(me.resources, before);
  });
  test('Phase B: malformed persisted plan identity and binding are rejected', () => {
    const state = world(); const plan = plans(state)[0]!; commit(state, plan);
    state.commitments.get('me')!.plan = { ...plan, id: 'tampered' };
    assert.ok(checkGameStateInvariants(state).some(v => v.code === 'commitment.invalid_plan'));
    state.commitments.get('me')!.plan = plan; state.commitments.get('me')!.targetId = 'wrong';
    assert.ok(checkGameStateInvariants(state).some(v => v.code === 'commitment.plan_mismatch'));
  });

  test('Phase B: falsy malformed plans are rejected instead of restoring legacy execution', () => {
    for (const invalid of [null, false, 0, '']) {
      const state = world();
      const plan = plans(state).find((p): p is MovePlan => p.action === 'MOVE')!;
      commit(state, plan);
      state.commitments.get('me')!.plan = invalid as never;
      assert.ok(checkGameStateInvariants(state).some(v => v.code === 'commitment.invalid_plan'));
      assert.throws(() => hydratePersistedPayload(encodePersistable(state)), /invariants/);
      const before = encodePersistable(state);
      const orch = new Orchestrator(state);
      assert.strictEqual(orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' })).success, false);
      assert.ok([...orch.getState().armies.values()].every(a => !a.movement));
      assert.deepStrictEqual(encodePersistable(state), before, 'preceding committed state remains untouched');
    }
  });

  test('Phase B: contradictory legacy display targets fail before any concrete operation starts', () => {
    const state = world(); const plan = plans(state).find((p): p is MovePlan => p.action === 'MOVE')!;
    commit(state, plan); state.commitments.get('me')!.targetId = 'target';
    const orch = new Orchestrator(state);
    assert.strictEqual(orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'me' })).success, false);
    assert.ok([...orch.getState().armies.values()].every(a => !a.movement));
  });
}
