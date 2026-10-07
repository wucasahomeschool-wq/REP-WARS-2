import assert from 'assert';
import { DecisionEngine } from '../src/engine/DecisionEngine';
import { applyCommitmentOutcomeFeedback } from '../src/engine/outcomeFeedback';
import { ActionScorer, ScorerInput } from '../src/scoring/ActionScorer';
import { buildWarlordStates, rebindWarlordRuntime, syncCommitmentsFromWarlordStates, toDecisionEngineSnapshot } from '../src/state/gameStateAdapters';
import { cloneGameState } from '../src/state/cloneGameState';
import { createLegacySampleMapGameState } from '../src/state/createGameState';
import { checkGameStateInvariants } from '../src/state/gameStateInvariants';
import { hydratePersistedPayload } from '../src/persistence/hydrate';
import { encodePersistable } from '../src/persistence/serialization';
import { migrateGameStatePayload } from '../src/persistence/versioning';
import { Orchestrator } from '../src/orchestration/orchestrator';
import { createDefaultRegistry } from '../src/orchestration/engineRegistry';
import { handleAiDecide } from '../src/orchestration/handlers';
import { getCommandDefinition } from '../src/orchestration/commandIndex';
import { runStateTransaction } from '../src/orchestration/transaction';
import { CommandRequest } from '../src/orchestration/protocol';

const FACTION = 'merchant_republic';
const SEED = 17;

// Observe the actual scorer input, not merely the wrapper's displayed fields.
function observeCognition(run: () => void): ScorerInput {
  const original = ActionScorer.prototype.scoreAllActions;
  let observed: ScorerInput | undefined;
  ActionScorer.prototype.scoreAllActions = function (input) {
    observed = input;
    return original.call(this, input);
  };
  try { run(); } finally { ActionScorer.prototype.scoreAllActions = original; }
  assert.ok(observed, 'the decision must reach cognition');
  return observed;
}

function world() {
  return createLegacySampleMapGameState({ seed: SEED });
}

function request(): CommandRequest {
  return { commandId: 'AI_DECIDE', playerId: 'p', parameters: { warlordId: FACTION } };
}

export function registerAiCanonicalReasoningTests(api: { test: (name: string, run: () => void) => void }): void {
  const { test } = api;

  test('Phase A: canonical memory changes replace stale wrapper memory, including removed entries', () => {
    const state = world();
    const runtime = buildWarlordStates(state);
    const next = cloneGameState(state);
    next.factions.get(FACTION)!.memory = [{
      id: 'mem_fresh', turn: 0, type: 'action_failed', withFaction: null,
      territory: null, magnitude: 7, details: { marker: 'canonical' },
    }];
    const rebound = rebindWarlordRuntime(next, runtime);
    const seen = observeCognition(() => new DecisionEngine(SEED).decide(
      rebound.get(FACTION)!, toDecisionEngineSnapshot(next), next.turn,
    ));
    assert.deepStrictEqual(seen.memory.getEntries(), next.factions.get(FACTION)!.memory);
    next.factions.get(FACTION)!.memory = [];
    next.commitments.set(FACTION, null);
    const fresh = rebindWarlordRuntime(next, rebound);
    const empty = observeCognition(() => new DecisionEngine(SEED).decide(
      fresh.get(FACTION)!, toDecisionEngineSnapshot(next), next.turn,
    ));
    assert.deepStrictEqual(empty.memory.getEntries(), []);
  });

  test('Phase A: direct engine cognition refreshes canonical goals and snapshot instead of retained wrapper data', () => {
    const state = world();
    const runtime = buildWarlordStates(state);
    const next = cloneGameState(state);
    const faction = next.factions.get(FACTION)!;
    faction.resources.gold = 4321;
    faction.goals = [{
      id: 'goal_fresh', type: 'economic_growth', priority: 83,
      targetFaction: null, targetTerritory: null, targetRegion: null, targetResource: 'gold',
      progress: 63, targetProgress: 100, deadlineTurn: null, createdTurn: 0,
    }];
    const seen = observeCognition(() => new DecisionEngine(SEED).decide(
      runtime.get(FACTION)!, toDecisionEngineSnapshot(next), next.turn,
    ));
    assert.strictEqual(seen.ctx.self.resources.gold, 4321);
    assert.deepStrictEqual(seen.goals.getAllGoals(), faction.goals);
    assert.notStrictEqual(seen.goals.getAllGoals()[0], faction.goals[0]);
  });

  test('Phase A: AI_DECIDE observes earlier mutations in the same transaction and records history only on its draft', () => {
    const state = world();
    const before = cloneGameState(state);
    const runtime = { aiWarlordStates: buildWarlordStates(state) };
    const registry = createDefaultRegistry();
    registry.registerAi(new DecisionEngine(SEED));
    let next = state;
    const seen = observeCognition(() => {
      next = runStateTransaction(state, (draft) => {
        draft.factions.get(FACTION)!.resources.gold = 7654;
        draft.factions.get(FACTION)!.memory = [{
          id: 'mem_same_transaction', turn: 0, type: 'action_failed', withFaction: null,
          territory: null, magnitude: 2, details: {},
        }];
        return handleAiDecide(draft, {
          req: request(), def: getCommandDefinition('AI_DECIDE')!, registry, runtime,
        });
      }).state;
    });
    assert.strictEqual(seen.ctx.self.resources.gold, 7654);
    assert.strictEqual(seen.memory.getEntries()[0]!.id, 'mem_same_transaction');
    assert.strictEqual(next.factions.get(FACTION)!.lastActions.length, 1);
    assert.deepStrictEqual(state, before, 'cognition must not mutate the preceding committed state');
  });

  test('Phase A: Orchestrator decision preserves the preceding state and persists decision history', () => {
    const state = world();
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    assert.ok(orch.execute(request()).success);
    assert.deepStrictEqual(state, before);
    const current = orch.getState();
    assert.strictEqual(current.factions.get(FACTION)!.lastActions.length, 1);
    const loaded = hydratePersistedPayload(encodePersistable(current));
    assert.deepStrictEqual(loaded.factions.get(FACTION)!.lastActions, current.factions.get(FACTION)!.lastActions);
  });

  test('Phase A: continued, rebuilt, and hydrated runtimes produce the same decision and commitment identity', () => {
    const canonical = world();
    const continued = buildWarlordStates(canonical);
    const engine = new DecisionEngine(SEED);
    engine.decide(continued.get(FACTION)!, toDecisionEngineSnapshot(canonical), canonical.turn);
    canonical.commitments.set(FACTION, { ...continued.get(FACTION)!.activeCommitment!, status: 'completed' });
    const states = [cloneGameState(canonical), cloneGameState(canonical), hydratePersistedPayload(encodePersistable(canonical))];
    const runtimes = [rebindWarlordRuntime(states[0]!, continued), buildWarlordStates(states[1]!), buildWarlordStates(states[2]!)];
    const decisions = states.map((state, i) => new DecisionEngine(SEED).decide(
      runtimes[i]!.get(FACTION)!, toDecisionEngineSnapshot(state), state.turn,
    ));
    assert.deepStrictEqual(decisions[0], decisions[1]);
    assert.deepStrictEqual(decisions[1], decisions[2]);
    assert.notStrictEqual(decisions[0]!.commitment!.id, canonical.commitments.get(FACTION)!.id);
    assert.deepStrictEqual(states[0]!.factions.get(FACTION), states[1]!.factions.get(FACTION));
  });

  test('Phase A: a failed transaction rolls back cognition history and sequence for deterministic retry', () => {
    const state = world();
    const before = cloneGameState(state);
    const runtime = { aiWarlordStates: buildWarlordStates(state) };
    const registry = createDefaultRegistry();
    registry.registerAi(new DecisionEngine(SEED));
    let failedId = '';
    assert.throws(() => runStateTransaction(state, (draft) => {
      handleAiDecide(draft, { req: request(), def: getCommandDefinition('AI_DECIDE')!, registry, runtime });
      failedId = draft.commitments.get(FACTION)!.id;
      throw new Error('abort after cognition');
    }), /abort after cognition/);
    assert.deepStrictEqual(state, before);
    const retry = runStateTransaction(state, (draft) => handleAiDecide(draft, {
      req: request(), def: getCommandDefinition('AI_DECIDE')!, registry, runtime,
    })).state;
    assert.strictEqual(retry.commitments.get(FACTION)!.id, failedId);
    assert.strictEqual(retry.factions.get(FACTION)!.lastActions.length, 1);
  });

  test('Phase A: missing-goal target normalization remains disposable and does not rewrite canonical goals', () => {
    const state = world();
    const faction = state.factions.get(FACTION)!;
    faction.goals = [{
      id: 'goal_missing', type: 'destroy_rival', priority: 80,
      targetFaction: 'missing', targetTerritory: null, targetRegion: null, targetResource: null,
      progress: 4, targetProgress: 100, deadlineTurn: null, createdTurn: 0,
    }];
    const ws = buildWarlordStates(state).get(FACTION)!;
    new DecisionEngine(SEED).decide(ws, toDecisionEngineSnapshot(state), state.turn);
    assert.strictEqual(faction.goals[0]!.progress, 4);
    assert.strictEqual(ws.goals.getAllGoals()[0]!.progress, 100);
    assert.deepStrictEqual(checkGameStateInvariants(state), []);
  });

  test('Phase A: canonical outcome feedback is observed after rebind and save/reload', () => {
    const state = world();
    const oldRuntime = buildWarlordStates(state);
    const next = cloneGameState(state);
    const faction = next.factions.get(FACTION)!;
    const goal = faction.goals[0]!;
    const engine = new DecisionEngine(SEED);
    const ws = buildWarlordStates(next).get(FACTION)!;
    const chosen = engine.decide(ws, toDecisionEngineSnapshot(next), next.turn).commitment!;
    applyCommitmentOutcomeFeedback(next, FACTION, { ...chosen, action: 'BUILD', originatingGoalId: goal.id }, 'completed');
    applyCommitmentOutcomeFeedback(next, FACTION, { ...chosen, action: 'ATTACK' }, 'failed');
    for (const current of [next, hydratePersistedPayload(encodePersistable(next))]) {
      const runtime = rebindWarlordRuntime(current, oldRuntime);
      const seen = observeCognition(() => engine.decide(runtime.get(FACTION)!, toDecisionEngineSnapshot(current), current.turn));
      assert.strictEqual(seen.goals.getAllGoals().find((g) => g.id === goal.id)!.progress, 4);
      assert.ok(seen.memory.getEntries().some((entry) => entry.type === 'action_failed'));
    }
  });

  test('Phase A: schema 16 migration preserves the old commitment ID and continues above its recorded sequence', () => {
    const state = world();
    const ws = buildWarlordStates(state).get(FACTION)!;
    const engine = new DecisionEngine(SEED);
    const decision = engine.decide(ws, toDecisionEngineSnapshot(state), state.turn);
    const old = { ...decision.commitment!, status: 'completed' as const };
    old.id = old.id.replace(/^(cmt_[0-9a-z]+_[0-9a-z]+_-?\d+_)[0-9a-z]+_/, '$1z_');
    assert.ok(old.id.includes('_z_'), 'fixture must encode a base-36 sequence');
    state.commitments.set(FACTION, old);
    const legacy = state as unknown as { schemaVersion: number; factions: Map<string, Record<string, unknown>> };
    legacy.schemaVersion = 16;
    for (const faction of legacy.factions.values()) delete faction.nextAiCommitmentSequence;
    const loaded = hydratePersistedPayload(encodePersistable(state));
    assert.strictEqual(loaded.commitments.get(FACTION)!.id, old.id);
    assert.strictEqual(loaded.factions.get(FACTION)!.nextAiCommitmentSequence, 36);
    const rebuilt = buildWarlordStates(loaded).get(FACTION)!;
    const resumed = engine.decide(rebuilt, toDecisionEngineSnapshot(loaded), loaded.turn);
    assert.ok(resumed.commitment!.id.includes('_10_'), 'the next sequence must be persisted and not reset');
    assert.strictEqual(loaded.factions.get(FACTION)!.nextAiCommitmentSequence, 37);
  });

  test('Phase A: schema 16 without a commitment initializes sequence zero; corrupt current sequences are rejected', () => {
    const state = world();
    state.schemaVersion = 16;
    const loaded = hydratePersistedPayload(encodePersistable(state));
    assert.strictEqual(loaded.factions.get(FACTION)!.nextAiCommitmentSequence, 0);
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const corrupt = cloneGameState(loaded);
      corrupt.factions.get(FACTION)!.nextAiCommitmentSequence = bad;
      assert.throws(() => hydratePersistedPayload(encodePersistable(corrupt)), /invariants/);
    }
  });

  test('Phase A: commitment writeback cannot overwrite an unrelated faction changed after view construction', () => {
    const state = world();
    const runtime = buildWarlordStates(state);
    const other = 'iron_kingdom';
    const ws = runtime.get(other)!;
    new DecisionEngine(SEED).decide(ws, toDecisionEngineSnapshot(state), state.turn);
    state.commitments.set(other, { ...ws.activeCommitment!, status: 'completed' });
    runtime.get(other)!.activeCommitment = null;
    const expected = { ...state.commitments.get(other)! };
    syncCommitmentsFromWarlordStates(state, runtime, [FACTION]);
    assert.deepStrictEqual(state.commitments.get(other), expected);
  });

  test('Phase A: disposable helper mutations cannot leak into canonical goals or memory', () => {
    const state = world();
    const faction = state.factions.get(FACTION)!;
    faction.memory = [{ id: 'mem_detached', turn: 0, type: 'action_failed', withFaction: null,
      territory: null, magnitude: 3, details: { marker: 'canonical' } }];
    const before = cloneGameState(state);
    const ws = buildWarlordStates(state).get(FACTION)!;
    ws.goals.updateProgress(faction.goals[0]!.id, 50);
    ws.memory.getEntries()[0]!.details.marker = 'disposable';
    assert.deepStrictEqual(state, before);
    const seen = observeCognition(() => new DecisionEngine(SEED).decide(ws, toDecisionEngineSnapshot(state), state.turn));
    assert.strictEqual(seen.goals.getAllGoals()[0]!.progress, 0);
    assert.strictEqual(seen.memory.getEntries()[0]!.details.marker, 'canonical');
  });

  test('Phase A: nested memory details are isolated in transaction drafts and disposable cognition', () => {
    const state = world();
    state.factions.get(FACTION)!.memory = [{ id: 'mem_nested', turn: 0, type: 'action_failed',
      withFaction: null, territory: null, magnitude: 1, details: { nested: { values: ['original'] } } }];
    const before = encodePersistable(state);
    const draft = cloneGameState(state);
    const ws = buildWarlordStates(draft).get(FACTION)!;
    const values = (details: Record<string, unknown>) => (details.nested as { values: string[] }).values;
    values(ws.memory.getEntries()[0]!.details).push('wrapper');
    assert.deepStrictEqual(values(draft.factions.get(FACTION)!.memory[0]!.details), ['original']);
    const seen = observeCognition(() => new DecisionEngine(SEED).decide(ws, toDecisionEngineSnapshot(draft), draft.turn));
    values(seen.memory.getEntries()[0]!.details).push('scorer');
    values(draft.factions.get(FACTION)!.memory[0]!.details).push('draft');
    assert.deepStrictEqual(encodePersistable(state), before);
    assert.deepStrictEqual(values(hydratePersistedPayload(before).factions.get(FACTION)!.memory[0]!.details), ['original']);
  });

  test('Phase A: retained commitment wrappers cannot override the current canonical single slot', () => {
    const state = world();
    const ws = buildWarlordStates(state).get(FACTION)!;
    const chosen = new DecisionEngine(SEED).decide(ws, toDecisionEngineSnapshot(state), state.turn).commitment!;
    for (const current of [null, { ...chosen, status: 'completed' as const }]) {
      const draft = cloneGameState(state);
      draft.commitments.set(FACTION, current);
      const reconstructed = cloneGameState(draft);
      ws.activeCommitment = chosen;
      const continued = new DecisionEngine(SEED).decide(ws, toDecisionEngineSnapshot(draft), draft.turn);
      const rebuilt = new DecisionEngine(SEED).decide(buildWarlordStates(reconstructed).get(FACTION)!, toDecisionEngineSnapshot(reconstructed), reconstructed.turn);
      assert.strictEqual(continued.isNewCommitment, true);
      assert.deepStrictEqual(continued, rebuilt);
    }
    state.commitments.set(FACTION, chosen);
    ws.activeCommitment = null;
    const held = new DecisionEngine(SEED).decide(ws, toDecisionEngineSnapshot(state), state.turn);
    assert.strictEqual(held.isNewCommitment, false);
    assert.strictEqual(held.commitment!.id, chosen.id);
  });

  test('Phase A: older-save migration never lowers an existing valid commitment high-water mark', () => {
    const state = world();
    const chosen = new DecisionEngine(SEED).decide(buildWarlordStates(state).get(FACTION)!, toDecisionEngineSnapshot(state), state.turn).commitment!;
    state.commitments.set(FACTION, { ...chosen, status: 'completed' });
    state.factions.get(FACTION)!.nextAiCommitmentSequence = 90;
    state.schemaVersion = 16;
    const loaded = hydratePersistedPayload(encodePersistable(state));
    assert.strictEqual(loaded.factions.get(FACTION)!.nextAiCommitmentSequence, 90);
  });

  test('Phase A: schema 17 and 18 reject a commitment sequence below already-recorded IDs', () => {
    for (const schemaVersion of [17, 18]) {
      const state = world();
      const chosen = new DecisionEngine(SEED).decide(buildWarlordStates(state).get(FACTION)!, toDecisionEngineSnapshot(state), state.turn).commitment!;
      state.commitments.set(FACTION, { ...chosen, status: 'completed' });
      state.factions.get(FACTION)!.nextAiCommitmentSequence = 0;
      state.schemaVersion = schemaVersion;
      assert.throws(() => hydratePersistedPayload(encodePersistable(state)), /reuse a recorded ID/);
    }
  });

  test('Phase A: sequence migration considers persisted movement, attack and invasion references', () => {
    // Test migration separately from structural validation of physical records.
    const state = world(); state.schemaVersion = 16;
    const army = state.armies.values().next().value!;
    const owner = army.owner;
    army.movement = { originTerritoryId: army.location, destinationTerritoryId: army.location,
      status: 'moving', startedAtTick: 0, durationTicks: 1, commitmentId: 'cmt_1_1_0_a_WAIT_none' };
    army.attackIntent = { targetTerritoryId: army.location, stagingTerritoryId: army.location,
      status: 'ready', createdAtTick: 0, commitmentId: 'cmt_1_1_0_k_ATTACK_target', battleSeed: 0 };
    state.activeInvasions.set('identity_fixture', { attackerFactionId: owner,
      commitmentId: 'cmt_1_1_0_u_ATTACK_target' } as never);
    const migrated = migrateGameStatePayload(state);
    assert.strictEqual((migrated.factions as typeof state.factions).get(owner)!.nextAiCommitmentSequence, 31);
    assert.strictEqual(army.movement.commitmentId, 'cmt_1_1_0_a_WAIT_none');
  });
}
