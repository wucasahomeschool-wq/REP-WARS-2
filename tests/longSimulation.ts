import assert from 'assert';
import { runLongSimulation } from '../src/simulation/longRunHarness';
import { checkGameStateInvariants } from '../src/state';
import { isActiveCommitmentStatus } from '../src/engine/DecisionEngine';
import { ActionType } from '../src/types';
import { WARLORD_SPECS } from '../src/simulation/SampleMap';

export interface LongSimulationTestApi {
  test: (name: string, fn: () => void) => void;
}

function actionTotal(counts: Partial<Record<ActionType, number>> | undefined, actions: ActionType[]): number {
  if (!counts) return 0;
  return actions.reduce((s, a) => s + (counts[a] ?? 0), 0);
}

export function registerLongSimulationTests(api: LongSimulationTestApi): void {
  const { test } = api;

  console.log('Phase 16 — long deterministic AI simulation harness');

  test('deterministic 50-tick simulation: identical seed produces identical outcomes', () => {
    const a = runLongSimulation({ seed: 100, ticks: 50 });
    const b = runLongSimulation({ seed: 100, ticks: 50 });
    assert.strictEqual(a.finalState.worldTick, b.finalState.worldTick);
    assert.strictEqual(a.battlesResolved, b.battlesResolved);
    assert.strictEqual(a.territoriesChangedOwner, b.territoriesChangedOwner);
    assert.deepStrictEqual(
      [...a.actionCounts.entries()].sort(),
      [...b.actionCounts.entries()].sort(),
    );
    for (const fid of a.finalState.allFactionIds) {
      assert.deepStrictEqual(a.finalState.territories, b.finalState.territories);
      const fa = a.finalState.factions.get(fid)!;
      const fb = b.finalState.factions.get(fid)!;
      assert.strictEqual(fa.resources.gold, fb.resources.gold, `faction ${fid} gold diverged`);
      assert.strictEqual(fa.territories.length, fb.territories.length, `faction ${fid} territory count diverged`);
    }
  });

  test('deterministic 100-tick simulation: identical seed produces identical outcomes', () => {
    const a = runLongSimulation({ seed: 7, ticks: 100 });
    const b = runLongSimulation({ seed: 7, ticks: 100 });
    assert.strictEqual(a.finalState.worldTick, b.finalState.worldTick);
    assert.strictEqual(a.battlesResolved, b.battlesResolved);
    assert.deepStrictEqual(a.newlyEliminated, b.newlyEliminated);
  });

  test('different seeds are not forced into identical outcomes (sanity: harness is not a no-op)', () => {
    const a = runLongSimulation({ seed: 1, ticks: 60 });
    const b = runLongSimulation({ seed: 2, ticks: 60 });
    const differs = a.battlesResolved !== b.battlesResolved
      || a.territoriesChangedOwner !== b.territoriesChangedOwner
      || JSON.stringify([...a.actionCounts.entries()]) !== JSON.stringify([...b.actionCounts.entries()]);
    assert.ok(differs, 'two different seeds produced byte-identical simulation statistics');
  });

  test('a 100-tick simulation never produces an invalid GameState', () => {
    const result = runLongSimulation({ seed: 42, ticks: 100 });
    const violations = checkGameStateInvariants(result.finalState);
    assert.deepStrictEqual(violations, [], `invariant violations: ${JSON.stringify(violations)}`);
  });

  test('a faction already eliminated at tick 0 never runs AI_DECIDE over 80 ticks', () => {
    const ghostSpec = {
      ...WARLORD_SPECS.find((s) => s.id === 'merchant_republic')!,
      id: 'ghost_empire',
      name: 'Ghost Empire',
      startingTerritories: [] as string[],
      startingArmy: { soldiers: 0, knights: 0, siege: 0 },
    };
    const result = runLongSimulation({
      seed: 42,
      ticks: 80,
      warlordSpecs: [...WARLORD_SPECS, ghostSpec],
    });
    assert.ok(result.eliminatedAtStart.includes('ghost_empire'));
    assert.strictEqual(result.decisionsForEliminatedFactions, 0);
    assert.ok(!result.actionCounts.has('ghost_empire'));
  });

  test('no orphan armies: every army in the final state belongs to an existing faction', () => {
    const result = runLongSimulation({ seed: 9, ticks: 90 });
    for (const army of result.finalState.armies.values()) {
      assert.ok(result.finalState.factions.has(army.owner), `army ${army.id} owner ${army.owner} does not exist`);
    }
  });

  test('no permanently-active ATTACK commitment with a target that is no longer a foreign territory', () => {
    const result = runLongSimulation({ seed: 21, ticks: 90 });
    for (const [factionId, commitment] of result.finalState.commitments) {
      if (!commitment || commitment.action !== 'ATTACK' || !isActiveCommitmentStatus(commitment.status)) continue;
      if (!commitment.targetId) continue;
      const target = result.finalState.territories.get(commitment.targetId);
      assert.ok(target, `ATTACK commitment target ${commitment.targetId} missing entirely`);
      assert.ok(target!.owner && target!.owner !== factionId, `ATTACK commitment for ${factionId} targets a non-foreign territory`);
    }
  });

  test('the harness runs multiple ticks without any command-level ADVANCE_WORLD failure', () => {
    const result = runLongSimulation({ seed: 55, ticks: 120 });
    assert.strictEqual(result.advanceFailures, 0);
    assert.strictEqual(result.ticksAdvanced, 120);
  });

  test('personality differentiation: aggressive faction shows more war-like actions than defensive across seeds', () => {
    const warlike: ActionType[] = ['ATTACK', 'DECLARE_WAR'];
    let aggressiveTotal = 0;
    let defensiveTotal = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = runLongSimulation({ seed, ticks: 60 });
      aggressiveTotal += actionTotal(result.actionCounts.get('ashen_horde'), warlike);
      defensiveTotal += actionTotal(result.actionCounts.get('iron_kingdom'), warlike);
    }
    assert.ok(
      aggressiveTotal >= defensiveTotal,
      `aggressive ashen_horde (${aggressiveTotal} war-like actions) should not trail defensive iron_kingdom (${defensiveTotal}) across 5 seeds`,
    );
  });

  test('personality differentiation: economic faction shows more BUILD/REINFORCE than aggressive across seeds', () => {
    const economic: ActionType[] = ['BUILD', 'REINFORCE'];
    let economicTotal = 0;
    let aggressiveTotal = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const result = runLongSimulation({ seed, ticks: 60 });
      economicTotal += actionTotal(result.actionCounts.get('merchant_republic'), economic);
      aggressiveTotal += actionTotal(result.actionCounts.get('ashen_horde'), economic);
    }
    assert.ok(
      economicTotal >= aggressiveTotal,
      `economic merchant_republic (${economicTotal} build/reinforce actions) should not trail aggressive ashen_horde (${aggressiveTotal}) across 5 seeds`,
    );
  });

  test('no faction is stuck repeating only WAIT for the entire simulation while it still has territory', () => {
    const result = runLongSimulation({ seed: 42, ticks: 100 });
    for (const [factionId, counts] of result.actionCounts) {
      const snap = result.finalState.factions.get(factionId);
      if (!snap || snap.territories.length === 0) continue;
      const totalActions = Object.values(counts).reduce((s, v) => s + (v ?? 0), 0);
      const waitOnly = (counts.WAIT ?? 0) === totalActions;
      assert.ok(!waitOnly || totalActions < 3, `${factionId} did nothing but WAIT for ${totalActions} decisions`);
    }
  });

  test('a longer 150-tick multi-faction simulation completes and stays structurally valid', () => {
    const result = runLongSimulation({ seed: 77, ticks: 150 });
    assert.strictEqual(result.ticksAdvanced, 150);
    assert.deepStrictEqual(checkGameStateInvariants(result.finalState), []);
    assert.ok(result.finalState.allFactionIds.length >= 2);
  });
}
