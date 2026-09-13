import assert from 'assert';
import { getAttackFeasibility, isMoveDestinationFeasible } from '../src/engine/feasibility';
import { DecisionEngine, isFactionEliminated, WarlordState } from '../src/engine/DecisionEngine';
import { applyCommitmentOutcomeFeedback } from '../src/engine/outcomeFeedback';
import { ActionScorer, ScorerInput } from '../src/scoring/ActionScorer';
import { armyHasActiveStrategicOperation } from '../src/army/strategicAttack';
import { SeededRNG } from '../src/utils/SeededRNG';
import { MemorySystem } from '../src/memory/MemorySystem';
import { GoalSystem } from '../src/goals/GoalSystem';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { createGameState, cloneGameState } from '../src/state';
import { Army, Territory, GameStateSnapshot, AICommitment, WarlordSnapshot } from '../src/types';
import type { CommandRequest } from '../src/orchestration';
import type { WorldAdvanceResult } from '../src/world';

export interface AiRuntimeTestApi {
  test: (name: string, fn: () => void) => void;
  cmdReq: (commandId: string, playerId: string, parameters?: Record<string, unknown>) => CommandRequest;
  makeCmt: (partial: Partial<AICommitment> & Pick<AICommitment, 'warlordId' | 'action'>) => AICommitment;
  makeTerritory: (overrides: Partial<Territory> & { id: string }) => Territory;
  makeSelf: (id: string, overrides?: Partial<WarlordSnapshot>) => WarlordSnapshot;
}

const ME = 'me_faction';
const ENEMY = 'enemy_faction';

export function registerAiRuntimeTests(api: AiRuntimeTestApi): void {
  const { test, cmdReq, makeCmt, makeTerritory, makeSelf } = api;

  function army(id: string, owner: string, location: string, soldiers = 800): Army {
    return {
      id, owner, location, soldiers, knights: 0, siegeEngines: 0,
      morale: 80, supply: 80, movement: null, attackIntent: null,
    };
  }

  function buildSnapshot(opts: {
    myTerritories: Territory[];
    enemyTerritories: Territory[];
    myArmies: Army[];
  }): { gameState: GameStateSnapshot; self: WarlordSnapshot } {
    const territories = new Map<string, Territory>();
    for (const t of [...opts.myTerritories, ...opts.enemyTerritories]) territories.set(t.id, t);
    const armies = new Map<string, Army>();
    for (const a of opts.myArmies) armies.set(a.id, a);
    const diplomacy = new Map([[ENEMY, {
      target: ENEMY, state: 'at_war' as const, opinion: -80, treaties: [], yearsAtPeace: 0, yearsAtWar: 3,
    }]]);
    const self = makeSelf(ME, {
      territories: opts.myTerritories.map((t) => t.id),
      armies: opts.myArmies.map((a) => a.id),
      diplomacy,
      knownFactions: [ME, ENEMY],
    });
    const enemy = makeSelf(ENEMY, { territories: opts.enemyTerritories.map((t) => t.id), armies: [] });
    const gameState: GameStateSnapshot = {
      turn: 1,
      factions: new Map([[ME, self], [ENEMY, enemy]]),
      territories,
      armies,
      allFactionIds: [ME, ENEMY],
    };
    return { gameState, self };
  }

  console.log('Phase 16 — attack feasibility layer');

  test('getAttackFeasibility: unreachable when no border and no one-hop staging', () => {
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: ['mid'] });
    const mid = makeTerritory({ id: 'mid', owner: null, neighboring: ['home', 'target'] });
    const target = makeTerritory({ id: 'target', owner: ENEMY, neighboring: ['mid'] });
    const a = army('a1', ME, 'home');
    const { gameState, self } = buildSnapshot({ myTerritories: [home], enemyTerritories: [mid, target], myArmies: [a] });
    const ctx = WarlordState.buildContext(self, gameState);
    const result = getAttackFeasibility(ctx, 'target');
    assert.strictEqual(result.feasibility, 'unreachable');
  });

  test('getAttackFeasibility: immediate when an eligible army already borders the target', () => {
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: ['target'] });
    const target = makeTerritory({ id: 'target', owner: ENEMY, neighboring: ['home'], garrison: 10 });
    const a = army('a1', ME, 'home');
    const { gameState, self } = buildSnapshot({ myTerritories: [home], enemyTerritories: [target], myArmies: [a] });
    const ctx = WarlordState.buildContext(self, gameState);
    const result = getAttackFeasibility(ctx, 'target');
    assert.strictEqual(result.feasibility, 'immediate');
    assert.ok(result.immediateArmies.some((army2) => army2.id === 'a1'));
  });

  test('getAttackFeasibility: staging when only a one-hop march reaches a legal staging tile', () => {
    const rear = makeTerritory({ id: 'rear', owner: ME, neighboring: ['staging'] });
    const staging = makeTerritory({ id: 'staging', owner: ME, neighboring: ['rear', 'target'] });
    const target = makeTerritory({ id: 'target', owner: ENEMY, neighboring: ['staging'], garrison: 10 });
    const a = army('a1', ME, 'rear');
    const { gameState, self } = buildSnapshot({
      myTerritories: [rear, staging], enemyTerritories: [target], myArmies: [a],
    });
    const ctx = WarlordState.buildContext(self, gameState);
    const result = getAttackFeasibility(ctx, 'target');
    assert.strictEqual(result.feasibility, 'staging');
    assert.strictEqual(result.stagingArmyId, 'a1');
    assert.strictEqual(result.stagingTerritoryId, 'staging');
  });

  test('getAttackFeasibility: staging army must be eligible (troop floor) or attack stays unreachable', () => {
    const rear = makeTerritory({ id: 'rear', owner: ME, neighboring: ['staging'] });
    const staging = makeTerritory({ id: 'staging', owner: ME, neighboring: ['rear', 'target'] });
    const target = makeTerritory({ id: 'target', owner: ENEMY, neighboring: ['staging'], garrison: 10 });
    const weak = army('weak', ME, 'rear', 10);
    const { gameState, self } = buildSnapshot({
      myTerritories: [rear, staging], enemyTerritories: [target], myArmies: [weak],
    });
    const ctx = WarlordState.buildContext(self, gameState);
    const result = getAttackFeasibility(ctx, 'target');
    assert.strictEqual(result.feasibility, 'unreachable');
  });

  console.log('Phase 16 — MOVE feasibility layer');

  test('isMoveDestinationFeasible: false when the only adjacent army is already moving', () => {
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: ['dest'] });
    const dest = makeTerritory({ id: 'dest', owner: null, neighboring: ['home'] });
    const a = army('a1', ME, 'home');
    a.movement = { originTerritoryId: 'home', destinationTerritoryId: 'dest', startedAtTick: 0, durationTicks: 3, status: 'moving', commitmentId: null };
    const { gameState, self } = buildSnapshot({ myTerritories: [home], enemyTerritories: [dest], myArmies: [a] });
    const ctx = WarlordState.buildContext(self, gameState);
    assert.strictEqual(isMoveDestinationFeasible(ctx, 'dest'), false);
  });

  test('isMoveDestinationFeasible: false when the only adjacent army has a pending attack intent', () => {
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: ['dest'] });
    const dest = makeTerritory({ id: 'dest', owner: null, neighboring: ['home'] });
    const a = army('a1', ME, 'home');
    a.attackIntent = { targetTerritoryId: 'dest', stagingTerritoryId: 'home', createdAtTick: 0, status: 'pending_movement', commitmentId: null, battleSeed: 1 };
    const { gameState, self } = buildSnapshot({ myTerritories: [home], enemyTerritories: [dest], myArmies: [a] });
    const ctx = WarlordState.buildContext(self, gameState);
    assert.strictEqual(armyHasActiveStrategicOperation(a), true);
    assert.strictEqual(isMoveDestinationFeasible(ctx, 'dest'), false);
  });

  test('isMoveDestinationFeasible: true when a stationary army is adjacent', () => {
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: ['dest'] });
    const dest = makeTerritory({ id: 'dest', owner: null, neighboring: ['home'] });
    const a = army('a1', ME, 'home');
    const { gameState, self } = buildSnapshot({ myTerritories: [home], enemyTerritories: [dest], myArmies: [a] });
    const ctx = WarlordState.buildContext(self, gameState);
    assert.strictEqual(isMoveDestinationFeasible(ctx, 'dest'), true);
  });

  test('isMoveDestinationFeasible: false with no army at all adjacent to destination', () => {
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: ['far'] });
    const far = makeTerritory({ id: 'far', owner: null, neighboring: ['home', 'dest'] });
    const dest = makeTerritory({ id: 'dest', owner: null, neighboring: ['far'] });
    const a = army('a1', ME, 'home');
    const { gameState, self } = buildSnapshot({ myTerritories: [home], enemyTerritories: [far, dest], myArmies: [a] });
    const ctx = WarlordState.buildContext(self, gameState);
    assert.strictEqual(isMoveDestinationFeasible(ctx, 'dest'), false);
  });

  console.log('Phase 16 — ActionScorer / DecisionEngine feasibility integration');

  function scorerInputFor(self: WarlordSnapshot, gameState: GameStateSnapshot, seed = 7): ScorerInput {
    const ctx = WarlordState.buildContext(self, gameState);
    return { ctx, turn: 1, rng: new SeededRNG(seed), memory: new MemorySystem(), goals: new GoalSystem(self.goals) };
  }

  test('ActionScorer.scoreAttack never scores an unreachable target', () => {
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: ['mid'] });
    const mid = makeTerritory({ id: 'mid', owner: null, neighboring: ['home', 'target'] });
    const target = makeTerritory({ id: 'target', owner: ENEMY, neighboring: ['mid'] });
    const a = army('a1', ME, 'home');
    const { gameState, self } = buildSnapshot({ myTerritories: [home], enemyTerritories: [mid, target], myArmies: [a] });
    const scorer = new ActionScorer();
    const scored = scorer.scoreAllActions(scorerInputFor(self, gameState));
    assert.ok(!scored.some((s) => s.action === 'ATTACK' && s.targetId === 'target'));
  });

  test('ActionScorer.scoreAttack scores a staging-only target lower than an equivalent immediate one', () => {
    const homeImm = makeTerritory({ id: 'home_imm', owner: ME, neighboring: ['target_imm'] });
    const targetImm = makeTerritory({ id: 'target_imm', owner: ENEMY, neighboring: ['home_imm'], garrison: 10 });
    const rear = makeTerritory({ id: 'rear', owner: ME, neighboring: ['staging'] });
    const staging = makeTerritory({ id: 'staging', owner: ME, neighboring: ['rear', 'target_stage'] });
    const targetStage = makeTerritory({ id: 'target_stage', owner: ENEMY, neighboring: ['staging'], garrison: 10 });
    const a1 = army('a_imm', ME, 'home_imm');
    const a2 = army('a_stage', ME, 'rear');
    const { gameState, self } = buildSnapshot({
      myTerritories: [homeImm, rear, staging],
      enemyTerritories: [targetImm, targetStage],
      myArmies: [a1, a2],
    });
    const scorer = new ActionScorer();
    const scored = scorer.scoreAllActions(scorerInputFor(self, gameState));
    const immediate = scored.find((s) => s.action === 'ATTACK' && s.targetId === 'target_imm');
    const staged = scored.find((s) => s.action === 'ATTACK' && s.targetId === 'target_stage');
    assert.ok(immediate, 'immediate target should be scored');
    assert.ok(staged, 'staging-reachable target should be scored');
    assert.ok(staged!.reasoning.some((r) => r.includes('staging')));
    assert.ok(staged!.score < immediate!.score, `staging score ${staged!.score} should be < immediate score ${immediate!.score}`);
  });

  test('ActionScorer.scoreMove never picks a destination whose only adjacent army is busy', () => {
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: ['dest_busy'] });
    const destBusy = makeTerritory({ id: 'dest_busy', owner: ENEMY, neighboring: ['home'] });
    const a = army('a1', ME, 'home');
    a.movement = { originTerritoryId: 'home', destinationTerritoryId: 'dest_busy', startedAtTick: 0, durationTicks: 3, status: 'moving', commitmentId: null };
    const { gameState, self } = buildSnapshot({ myTerritories: [home], enemyTerritories: [destBusy], myArmies: [a] });
    const scorer = new ActionScorer();
    const scored = scorer.scoreAllActions(scorerInputFor(self, gameState));
    const move = scored.find((s) => s.action === 'MOVE');
    assert.ok(move);
    assert.notStrictEqual(move!.targetId, 'dest_busy');
  });

  console.log('Phase 16 — faction elimination');

  test('isFactionEliminated: true with zero territories and zero armies', () => {
    const snap = makeSelf('ghost', { territories: [], armies: [] });
    assert.strictEqual(isFactionEliminated(snap), true);
  });

  test('isFactionEliminated: false with an army but no territory', () => {
    const snap = makeSelf('raider', { territories: [], armies: ['a1'] });
    assert.strictEqual(isFactionEliminated(snap), false);
  });

  test('isFactionEliminated: false with a territory but no army', () => {
    const snap = makeSelf('garrisoned', { territories: ['home'], armies: [] });
    assert.strictEqual(isFactionEliminated(snap), false);
  });

  test('ContinuousWorldEngine never runs AI_DECIDE for an already-eliminated faction', () => {
    const state = createGameState({ seed: 5, playerFactionId: 'merchant_republic' });
    const ghost = makeSelf('ghost_empire', { territories: [], armies: [] });
    state.factions.set('ghost_empire', ghost);
    state.allFactionIds.push('ghost_empire');
    state.commitments.set('ghost_empire', null);
    const orch = new Orchestrator(state);
    assert.strictEqual(isFactionEliminated(orch.getState().factions.get('ghost_empire')!), true);
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 20 }));
    assert.strictEqual(res.success, true);
    const advance = res.payload.worldAdvance as WorldAdvanceResult;
    assert.ok(!advance.aiDecisions.some((d) => d.factionId === 'ghost_empire'));
    assert.strictEqual(orch.getState().commitments.get('ghost_empire'), null);
  });

  console.log('Phase 16 — AI decision lastActions bookkeeping (WAIT anti-repetition wiring)');

  test('DecisionEngine.decide records the chosen action onto WarlordSnapshot.lastActions', () => {
    const engine = new DecisionEngine(11);
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: [] });
    const self = makeSelf(ME, { territories: ['home'], armies: [] });
    const gameState: GameStateSnapshot = {
      turn: 1, factions: new Map([[ME, self]]), territories: new Map([['home', home]]),
      armies: new Map(), allFactionIds: [ME],
    };
    const ws = new WarlordState(self);
    assert.strictEqual(self.lastActions.length, 0);
    engine.decide(ws, gameState, 1);
    assert.strictEqual(self.lastActions.length, 1);
    assert.strictEqual(self.lastActions[0]!.turn, 1);
  });

  console.log('Phase 16 — goal progress + memory outcome feedback');

  function stateWithSelf(overrides: Partial<WarlordSnapshot> = {}) {
    const self = makeSelf(ME, overrides);
    const state = createGameState({ seed: 1 });
    state.factions.set(ME, self);
    if (!state.allFactionIds.includes(ME)) state.allFactionIds.push(ME);
    return { state, self };
  }

  test('applyCommitmentOutcomeFeedback: successful ATTACK with an originating goal records progress on the canonical GameState', () => {
    const { state } = stateWithSelf({ goals: [{
      id: 'goal_0', type: 'destroy_rival', priority: 80, targetFaction: ENEMY, targetTerritory: null,
      targetRegion: null, targetResource: null, progress: 0, targetProgress: 100, deadlineTurn: null, createdTurn: 0,
    }] });
    const commitment = makeCmt({ warlordId: ME, action: 'ATTACK', targetId: 'target', originatingGoalId: 'goal_0' });
    applyCommitmentOutcomeFeedback(state, ME, commitment, 'completed');
    const goal = state.factions.get(ME)!.goals.find((g) => g.id === 'goal_0')!;
    assert.ok(goal.progress > 0, 'goal progress should increase after a successful ATTACK');
  });

  test('applyCommitmentOutcomeFeedback: failed action does not record goal progress', () => {
    const { state } = stateWithSelf({ goals: [{
      id: 'goal_0', type: 'destroy_rival', priority: 80, targetFaction: ENEMY, targetTerritory: null,
      targetRegion: null, targetResource: null, progress: 0, targetProgress: 100, deadlineTurn: null, createdTurn: 0,
    }] });
    const commitment = makeCmt({ warlordId: ME, action: 'ATTACK', targetId: 'target', originatingGoalId: 'goal_0' });
    applyCommitmentOutcomeFeedback(state, ME, commitment, 'failed');
    const goal = state.factions.get(ME)!.goals.find((g) => g.id === 'goal_0')!;
    assert.strictEqual(goal.progress, 0);
  });

  test('applyCommitmentOutcomeFeedback: goal progress survives GameState cloning', () => {
    const { state } = stateWithSelf({ goals: [{
      id: 'goal_0', type: 'expand_to_resources', priority: 70, targetFaction: null, targetTerritory: null,
      targetRegion: null, targetResource: null, progress: 0, targetProgress: 100, deadlineTurn: null, createdTurn: 0,
    }] });
    const commitment = makeCmt({ warlordId: ME, action: 'EXPAND', targetId: 'target', originatingGoalId: 'goal_0' });
    applyCommitmentOutcomeFeedback(state, ME, commitment, 'completed');
    const cloned = cloneGameState(state);
    assert.strictEqual(cloned.factions.get(ME)!.goals.find((g) => g.id === 'goal_0')!.progress, 15);
    // cloned goal object must be independent of the source.
    cloned.factions.get(ME)!.goals[0]!.progress = 99;
    assert.strictEqual(state.factions.get(ME)!.goals.find((g) => g.id === 'goal_0')!.progress, 15);
  });

  test('applyCommitmentOutcomeFeedback: failed ATTACK/EXPAND/MOVE records an action_failed memory entry', () => {
    const { state, self } = stateWithSelf();
    for (const action of ['ATTACK', 'EXPAND', 'MOVE'] as const) {
      const commitment = makeCmt({ warlordId: ME, action, targetId: 'target' });
      applyCommitmentOutcomeFeedback(state, ME, commitment, 'failed');
    }
    void self;
    const entries = state.factions.get(ME)!.memory.filter((m) => m.type === 'action_failed');
    assert.strictEqual(entries.length, 3);
  });

  test('applyCommitmentOutcomeFeedback: completed action does not record an action_failed memory entry', () => {
    const { state } = stateWithSelf();
    const commitment = makeCmt({ warlordId: ME, action: 'ATTACK', targetId: 'target' });
    applyCommitmentOutcomeFeedback(state, ME, commitment, 'completed');
    assert.strictEqual(state.factions.get(ME)!.memory.filter((m) => m.type === 'action_failed').length, 0);
  });

  test('applyCommitmentOutcomeFeedback: interrupted MOVE records an action_failed memory entry (not just hard failure)', () => {
    const { state } = stateWithSelf();
    const commitment = makeCmt({ warlordId: ME, action: 'MOVE', targetId: 'target' });
    applyCommitmentOutcomeFeedback(state, ME, commitment, 'interrupted');
    assert.strictEqual(state.factions.get(ME)!.memory.filter((m) => m.type === 'action_failed').length, 1);
  });

  test('applyCommitmentOutcomeFeedback: no-ops quietly if the faction no longer exists', () => {
    const { state } = stateWithSelf();
    state.factions.delete(ME);
    const commitment = makeCmt({ warlordId: ME, action: 'ATTACK', targetId: 'target' });
    assert.doesNotThrow(() => applyCommitmentOutcomeFeedback(state, ME, commitment, 'failed'));
  });

  console.log('Phase 16 — real ATTACK commitment feedback wiring through the Orchestrator');

  test('a completed ATTACK commitment with an originating goal advances that goal via RESOLVE_COMMITMENT', () => {
    const home = makeTerritory({ id: 'home', owner: ME, neighboring: ['target'] });
    const target = makeTerritory({ id: 'target', owner: ENEMY, neighboring: ['home'], garrison: 5 });
    const a = army('a1', ME, 'home', 900);
    const selfSnap = makeSelf(ME, {
      territories: ['home'], armies: ['a1'],
      goals: [{
        id: 'goal_x', type: 'destroy_rival', priority: 80, targetFaction: ENEMY, targetTerritory: null,
        targetRegion: null, targetResource: null, progress: 0, targetProgress: 100, deadlineTurn: null, createdTurn: 0,
      }],
    });
    const enemySnap = makeSelf(ENEMY, { territories: ['target'], armies: [] });
    const state = createGameState({ seed: 3 });
    state.factions = new Map([[ME, selfSnap], [ENEMY, enemySnap]]);
    state.allFactionIds = [ME, ENEMY];
    state.territories = new Map([['home', home], ['target', target]]);
    state.armies = new Map([[a.id, a]]);
    state.cities = new Map();
    state.territoryEconomy = new Map();
    state.commitments = new Map([[ME, makeCmt({
      warlordId: ME, action: 'ATTACK', targetId: 'target', status: 'committed', originatingGoalId: 'goal_x',
    })], [ENEMY, null]]);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'p', { factionId: ME }));
    assert.strictEqual(res.success, true);
    const goal = orch.getState().factions.get(ME)!.goals.find((g) => g.id === 'goal_x');
    assert.ok(goal && goal.progress > 0, 'goal_x should have advanced (on the canonical GameState) after the successful attack resolved');
  });
}
