import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SeededRNG } from '../src/utils/SeededRNG';
import { collectNeighborGraphIssues } from '../src/map/graphInvariants';
import { SAMPLE_MAP } from '../src/simulation/SampleMap';
import { runMapValidationTests } from '../src/simulation/mapDemo';
import { runSeededReproducibilityTest, buildLabInput, LabParams } from '../src/simulation/battleTests';
import { BattleEngine, BattleInput } from '../src/battle/BattleEngine';
import { computeWinProbability } from '../src/battle/CombatPower';
import { assertAttackerTroopMonotonicity, assertDefenseBonusMonotonicity } from '../src/simulation/battleStressTests';
import { EVENT_LIST, getEventById, getEventByTypeId } from '../src/events/EventDefinitions';
import { WorldSimulator, ConsequenceApplier } from '../src/events/WorldSimulator';
import { SimulationBuilder, WARLORD_SPECS } from '../src/simulation/SampleMap';
import { BALANCE } from '../src/constants/balance';
import { ActiveEvent, WorldStepInput } from '../src/events/EventModel';
import { MapEngine } from '../src/map/MapEngine';
import { MapTerritorySpec, Army, Territory, WarlordSnapshot, GameStateSnapshot, ActionType, PersonalityType, Decision, FactionId, DiplomaticRelationship, AICommitment } from '../src/types';
import { ScoringHelpers, ActionScorer, ScorerInput } from '../src/scoring/ActionScorer';
import { DecisionEngine, WarlordState, isActiveCommitmentStatus } from '../src/engine/DecisionEngine';
import { PersonalitySystem } from '../src/personality/PersonalitySystem';
import { GoalSystem } from '../src/goals/GoalSystem';
import { MemorySystem } from '../src/memory/MemorySystem';
import { simulateDecisionOutcomes, deriveBattleSeed, battleEngine } from '../src/simulation/cli';
import { GAME_STATE_SCHEMA_VERSION, emptyWorldClock, emptyRewardApplicationState, createActiveInvasion, type GameState } from '../src/types/GameState';
import {
  createGameState,
  createLegacySampleMapGameState,
  cloneGameState,
  checkGameStateInvariants,
  isGameStateStructurallyValid,
  toDecisionEngineSnapshot,
  toWorldStepInput,
  buildWarlordStates,
  syncCommitmentsFromWarlordStates,
} from '../src/state';
import {
  Orchestrator,
  CommandRequest,
  ErrorCode,
  OrchestrationError,
  createDefaultRegistry,
  EngineRegistry,
  classifyFactionInteraction,
} from '../src/orchestration';
import { parseElapsedTicks, type WorldAdvanceResult } from '../src/world';
import {
  calculateMovementDuration,
  isArmyMoving,
  movementTicksRemaining,
} from '../src/army/movement';
import {
  EXECUTABLE_COMMITMENT_ACTIONS,
  UNSUPPORTED_COMMITMENT_ACTIONS,
} from '../src/engine/executableActions';
import { runStateTransaction } from '../src/orchestration/transaction';
import { registerArmyMovementTests } from './armyMovement';
import { registerStrategicAttackTests } from './strategicAttack';
import { registerAiRuntimeTests } from './aiRuntime';
import { registerFoundationHardeningTests } from './foundationHardening';
import { registerLongSimulationTests } from './longSimulation';
import { registerFitnessDomainTests } from './fitnessDomain';
import { registerFitnessLibraryTests } from './fitnessLibrary';
import { registerFitnessSessionTests } from './fitnessSession';
import { registerFitnessEvidenceTests } from './fitnessEvidence';
import { registerFitnessLevelTests } from './fitnessLevel';
import { registerFitnessPersonalizationTests } from './fitnessPersonalization';
import { registerFitnessPhysicalResultTests } from './fitnessPhysicalResult';
import { registerGameRewardTests } from './gameRewards';
import { registerRewardApplicationTests } from './rewardApplication';
import { registerGameplayConsumptionTests } from './gameplayConsumption';
import { registerEconomyCitiesTests } from './economyCities';
import { registerEconomyFoundationTests } from './economyFoundation';
import { registerEconomyDevelopmentsTests } from './economyDevelopments';
import { registerTerritoryDefenseTests } from './territoryDefense';
import { registerAiEconomyTests } from './aiEconomy';
import { registerInvasionLifecycleTests } from './invasionLifecycle';
import { registerPersistenceTests } from './persistence';
import { registerWorldDefinitionTests } from './worldDefinition';
import { registerLevel1ProductionTests } from './level1Production';
import { registerLevel1TutorialTests } from './level1Tutorial';
import { registerWorkoutSelectionTests } from './workoutSelection';
import { registerWorkoutAuthoringTests } from './workoutAuthoring';
import { registerWorkoutProgressionTests } from './workoutProgression';
import { registerWorkoutPauseResumeTests } from './workoutPauseResume';
import { registerAnalyticsTests } from './analytics';
import { registerOrchestratorIntegrationTests } from './orchestratorIntegration';
import { registerLevelAnchorTests } from './levelAnchors';
import { registerPlayerIdentityTests } from './playerIdentity';
import { registerWorldTransitionTests } from './worldTransition';
import { registerGate1VerticalSliceTests } from './gate1VerticalSlice';
import { registerGate1VerticalSliceWorkoutTests } from './gate1VerticalSliceWorkout';
import { registerGate1VerticalSliceAttackTests } from './gate1VerticalSliceAttack';
import { registerGate1VerticalSlicePersistenceTests } from './gate1VerticalSlicePersistence';
import { authoredWorldFields, plantOwnedCities } from './worldTestHelpers';
import { getConstructionProjectDefinition, GAMEPLAY_CONFIG } from '../src/gameplay';

let failed = 0;
let passed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${name}`);
    console.error(`    ${msg}`);
  }
}

console.log('SeededRNG contract');
test('values are in [0, 1)', () => {
  const rng = new SeededRNG(1);
  for (let i = 0; i < 20000; i++) {
    const v = rng.next();
    assert.ok(v >= 0, `value ${v} < 0`);
    assert.ok(v < 1, `value ${v} was not < 1`);
  }
});
test('same seed produces same sequence', () => {
  const a = new SeededRNG(12345);
  const b = new SeededRNG(12345);
  for (let i = 0; i < 500; i++) {
    assert.strictEqual(a.next(), b.next());
  }
});
test('different seeds can produce different sequences', () => {
  const a = new SeededRNG(1);
  const b = new SeededRNG(2);
  let differ = false;
  for (let i = 0; i < 50; i++) {
    if (a.next() !== b.next()) {
      differ = true;
      break;
    }
  }
  assert.ok(differ, 'seeds 1 and 2 produced identical sequences');
});
test('reset() restores the original sequence', () => {
  const rng = new SeededRNG(99);
  const first = [rng.next(), rng.next(), rng.next()];
  const reset = rng.reset();
  assert.deepStrictEqual([reset.next(), reset.next(), reset.next()], first);
});

console.log('Neighbor graph checker');
test('detects missing neighbor references', () => {
  const issues = collectNeighborGraphIssues([
    { id: 'a', neighboring: ['missing'] },
  ]);
  assert.ok(issues.some((i) => i.kind === 'missing_neighbor' && i.neighborId === 'missing'));
});
test('detects self-neighbors', () => {
  const issues = collectNeighborGraphIssues([
    { id: 'a', neighboring: ['a'] },
  ]);
  assert.ok(issues.some((i) => i.kind === 'self_neighbor'));
});
test('detects non-reciprocal edges', () => {
  const issues = collectNeighborGraphIssues([
    { id: 'a', neighboring: ['b'] },
    { id: 'b', neighboring: [] },
  ]);
  assert.ok(issues.some((i) => i.kind === 'non_reciprocal'));
});
test('detects duplicate neighbor ids', () => {
  const issues = collectNeighborGraphIssues([
    { id: 'a', neighboring: ['b', 'b'] },
    { id: 'b', neighboring: ['a'] },
  ]);
  assert.ok(issues.some((i) => i.kind === 'duplicate_neighbor' && i.territoryId === 'a' && i.neighborId === 'b'));
});
test('accepts a reciprocal graph', () => {
  const issues = collectNeighborGraphIssues([
    { id: 'a', neighboring: ['b'] },
    { id: 'b', neighboring: ['a'] },
  ]);
  assert.strictEqual(issues.length, 0);
});
test('SAMPLE_MAP neighbor graph is well-formed', () => {
  const issues = collectNeighborGraphIssues(
    SAMPLE_MAP.map((s) => ({ id: s.id, neighboring: s.neighbors })),
  );
  assert.deepStrictEqual(issues, [], JSON.stringify(issues));
});

console.log('Map validation suite');
test('map validation tests all pass', () => {
  const results = runMapValidationTests();
  const failing = results.filter((t) => !t.pass);
  assert.strictEqual(
    failing.length,
    0,
    failing.map((t) => `${t.name}: ${t.detail}`).join('\n'),
  );
});

console.log('Battle reproducibility');
test('same battle seed yields identical results', () => {
  const repro = runSeededReproducibilityTest();
  assert.ok(repro.same, 'seeded battle results diverged');
});
test('same battle seed reproduces siege/garrison fields exactly (not just winner/casualties)', () => {
  const engine = new BattleEngine();
  const buildInput = (seed: number): BattleInput => buildLabInput({
    attackerTroops: 1200, attackerKnights: 80, attackerSiege: 6, attackerQuality: 1.05, attackerMorale: 80,
    defenderTroops: 900, defenderKnights: 40, defenderSiege: 3, defenderGarrison: 200, defenderQuality: 0.95, defenderMorale: 60,
    terrain: 'forest', fortification: 2,
  }, seed);
  const r1 = engine.resolve(buildInput(2026));
  const r2 = engine.resolve(buildInput(2026));
  assert.strictEqual(r1.attacker.remainingSiegeEngines, r2.attacker.remainingSiegeEngines);
  assert.strictEqual(r1.defender.remainingSiegeEngines, r2.defender.remainingSiegeEngines);
  assert.strictEqual(r1.defenderSurrendered, r2.defenderSurrendered);
  assert.strictEqual(r1.events.length, r2.events.length);
  assert.deepStrictEqual(r1.readableLog, r2.readableLog);
});

console.log('Battle engine correctness — no retreat / elimination');
test('BattleResult no longer carries retreat fields; the losing side has zero remaining troops and siege engines', () => {
  const engine = new BattleEngine();
  const input = buildLabInput({
    attackerTroops: 3000, attackerKnights: 400, attackerSiege: 10, attackerQuality: 1.2, attackerMorale: 90,
    defenderTroops: 200, defenderGarrison: 100, defenderQuality: 0.8, defenderMorale: 40,
    terrain: 'plains', fortification: 0,
  }, 123);
  const result = engine.resolve(input);
  assert.ok(!('retreated' in result.attacker), 'attacker breakdown must not have a "retreated" field');
  assert.ok(!('retreatSurvivorsPct' in result.attacker), 'attacker breakdown must not have "retreatSurvivorsPct"');
  assert.ok(!('retreated' in result.defender), 'defender breakdown must not have a "retreated" field');
  assert.ok(!('retreatSurvivorsPct' in result.defender), 'defender breakdown must not have "retreatSurvivorsPct"');
  assert.notStrictEqual(result.winner, 'draw', 'this scenario is lopsided enough to always have a clear winner');
  const loserSide = result.winner === 'attacker' ? result.defender : result.attacker;
  assert.strictEqual(loserSide.remainingTroops, 0, 'the losing side must have zero remaining troops — armies do not retreat');
  assert.strictEqual(loserSide.remainingSiegeEngines, 0, 'the losing side must have zero remaining siege engines');
});
test('Losing army is fully eliminated (troops + siege + garrison); territory outcome stays consistent with who lost', () => {
  const engine = new BattleEngine();
  const input = buildLabInput({
    attackerTroops: 5000, attackerKnights: 500, attackerSiege: 20, attackerQuality: 1.3, attackerMorale: 90,
    defenderTroops: 300, defenderKnights: 20, defenderSiege: 5, defenderGarrison: 150, defenderQuality: 0.7, defenderMorale: 40,
    terrain: 'plains', fortification: 0,
  }, 321);
  const result = engine.resolve(input);
  assert.notStrictEqual(result.winner, 'draw');
  const loser = result.winner === 'attacker' ? result.defender : result.attacker;
  const winner = result.winner === 'attacker' ? result.attacker : result.defender;
  assert.strictEqual(loser.remaining.soldiers, 0, 'loser soldiers must be fully eliminated');
  assert.strictEqual(loser.remaining.knights, 0, 'loser knights must be fully eliminated');
  assert.strictEqual(loser.remaining.siegeEngines, 0, 'loser siege engines must be fully eliminated');
  assert.strictEqual(loser.remaining.garrison ?? 0, 0, 'loser garrison must be fully eliminated');
  assert.ok(winner.remainingTroops > 0, 'the winning side must retain a surviving field army');
  if (result.winner === 'attacker') {
    assert.ok(result.territoryOutcome === 'captured' || result.territoryOutcome === 'contested',
      'attacker victory must leave territory captured or contested, never unchanged');
  } else {
    assert.strictEqual(result.territoryOutcome, 'unchanged', 'defender victory must leave territory unchanged');
  }
});

console.log('Battle engine correctness — siege/casualty accounting');
test('Mixed soldiers+siege casualty accounting is internally consistent (troop rate excludes siege, both bounded to [0,1])', () => {
  const engine = new BattleEngine();
  const paramSets: LabParams[] = [
    { attackerTroops: 10, attackerSiege: 100, attackerQuality: 1, attackerMorale: 75, defenderTroops: 500, defenderQuality: 1, defenderMorale: 75, terrain: 'plains' },
    { attackerTroops: 500, attackerSiege: 0, attackerQuality: 1, attackerMorale: 75, defenderTroops: 10, defenderSiege: 100, defenderQuality: 1, defenderMorale: 75, terrain: 'plains' },
    { attackerTroops: 1000, attackerSiege: 50, attackerQuality: 1, attackerMorale: 75, defenderTroops: 1000, defenderSiege: 50, defenderQuality: 1, defenderMorale: 75, terrain: 'plains' },
    { attackerTroops: 200, attackerSiege: 3, attackerQuality: 1, attackerMorale: 75, defenderTroops: 0, defenderSiege: 0, defenderGarrison: 200, defenderQuality: 1, defenderMorale: 75, terrain: 'plains' },
  ];
  for (const params of paramSets) {
    for (let seed = 1; seed <= 20; seed++) {
      const input = buildLabInput(params, seed * 1000 + 3);
      const result = engine.resolve(input);
      for (const side of [result.attacker, result.defender]) {
        assert.ok(side.casualties.casualtyRate >= 0 && side.casualties.casualtyRate <= 1,
          `troop casualtyRate ${side.casualties.casualtyRate} out of [0,1] for ${side.side}`);
        assert.ok(side.casualties.siegeCasualtyRate >= 0 && side.casualties.siegeCasualtyRate <= 1,
          `siegeCasualtyRate ${side.casualties.siegeCasualtyRate} out of [0,1] for ${side.side}`);
        assert.strictEqual(side.casualties.total, side.initialTroops - side.remainingTroops,
          `${side.side}: troop casualties.total must equal initialTroops - remainingTroops (siege excluded from both)`);
        assert.strictEqual(side.casualties.siegeEngines, side.initialSiegeEngines - side.remainingSiegeEngines,
          `${side.side}: siege casualties must equal initialSiegeEngines - remainingSiegeEngines`);
      }
    }
  }
});

console.log('Battle engine correctness — small-number edge cases');
test('Small-number battles (1v1, 1v2, 2v1, 2v2) never produce impossible states', () => {
  const engine = new BattleEngine();
  const combos: [number, number][] = [[1, 1], [1, 2], [2, 1], [2, 2]];
  for (const [atk, def] of combos) {
    for (let seed = 1; seed <= 50; seed++) {
      const input = buildLabInput({
        attackerTroops: atk, attackerQuality: 1, attackerMorale: 75,
        defenderTroops: 0, defenderGarrison: def, defenderQuality: 1, defenderMorale: 75,
        terrain: 'plains',
      }, seed);
      const result = engine.resolve(input);
      for (const side of [result.attacker, result.defender]) {
        assert.ok(side.remainingTroops >= 0, 'remainingTroops must not be negative');
        assert.ok(side.casualties.total >= 0, 'casualties must not be negative');
        assert.ok(side.casualties.total <= side.initialTroops, 'casualties cannot exceed initial troops');
        assert.ok(side.remainingTroops <= side.initialTroops, 'remaining cannot exceed initial troops');
      }
      if (result.winner !== 'draw') {
        const loser = result.winner === 'attacker' ? result.defender : result.attacker;
        const winner = result.winner === 'attacker' ? result.attacker : result.defender;
        assert.strictEqual(loser.remainingTroops, 0, 'loser must be fully eliminated even at tiny force sizes');
        assert.ok(winner.remainingTroops >= 1, 'a winner starting with >=1 troop must not be rounded down to zero survivors');
      }
    }
  }
});

console.log('Battle engine correctness — probability bounds & monotonicity');
test('computeWinProbability always returns a value in [0,1], across extreme power ratios', () => {
  const pairs: [number, number][] = [
    [0.0001, 0.0001], [1, 1], [500, 500], [1, 1e9], [1e9, 1], [1e-6, 1e6], [1e6, 1e-6], [123.456, 78.9],
  ];
  for (const [a, d] of pairs) {
    const p = computeWinProbability(a, d);
    assert.ok(p >= 0 && p <= 1, `probability ${p} out of [0,1] for attackerPower=${a}, defenderPower=${d}`);
  }
  assert.ok(Math.abs(computeWinProbability(500, 500) - 0.5) < 1e-9, 'equal power must give ~50/50 odds');
});
test('Attacker win rate is monotonic non-decreasing as attacker troop count increases (property check)', () => {
  const res = assertAttackerTroopMonotonicity(1500, 800000);
  assert.ok(res.passed, res.detail);
});
test('Defender win rate is monotonic non-decreasing as terrain/fortification defense bonus increases (property check)', () => {
  const res = assertDefenseBonusMonotonicity(1500, 810000);
  assert.ok(res.passed, res.detail);
});

console.log('Battle engine correctness — purity & result arithmetic');
test('BattleEngine.resolve does not mutate its input (armies, territory, nested arrays)', () => {
  const engine = new BattleEngine();
  const input = buildLabInput({
    attackerTroops: 1200, attackerKnights: 80, attackerSiege: 6, attackerQuality: 1.1, attackerMorale: 80,
    defenderTroops: 900, defenderKnights: 40, defenderSiege: 3, defenderGarrison: 200, defenderQuality: 0.9, defenderMorale: 60,
    terrain: 'forest', fortification: 2,
  }, 555);
  const before = JSON.parse(JSON.stringify(input));
  engine.resolve(input);
  const after = JSON.parse(JSON.stringify(input));
  assert.deepStrictEqual(after, before, 'BattleEngine.resolve mutated its input');
});
test('Result arithmetic is consistent: remaining + casualties = initial for every unit category, both sides', () => {
  const engine = new BattleEngine();
  const paramSets: LabParams[] = [
    { attackerTroops: 2500, attackerKnights: 400, attackerSiege: 20, attackerQuality: 1, attackerMorale: 85, defenderTroops: 0, defenderGarrison: 250, defenderQuality: 1, defenderMorale: 75, terrain: 'plains' },
    { attackerTroops: 400, attackerKnights: 50, attackerSiege: 0, attackerQuality: 1, attackerMorale: 60, defenderTroops: 0, defenderGarrison: 800, defenderQuality: 1, defenderMorale: 85, terrain: 'fortress', fortification: 5 },
    { attackerTroops: 1000, attackerKnights: 150, attackerSiege: 5, attackerQuality: 1, attackerMorale: 75, defenderTroops: 1000, defenderKnights: 150, defenderSiege: 5, defenderGarrison: 0, defenderQuality: 1, defenderMorale: 75, terrain: 'plains' },
  ];
  for (const params of paramSets) {
    for (let seed = 1; seed <= 25; seed++) {
      const input = buildLabInput(params, seed * 7 + 1);
      const result = engine.resolve(input);
      for (const side of [result.attacker, result.defender]) {
        assert.strictEqual(side.remaining.soldiers + side.casualties.soldiers, side.unitBreakdown.soldiers,
          `${side.side} soldiers: remaining + casualties must equal initial`);
        assert.strictEqual(side.remaining.knights + side.casualties.knights, side.unitBreakdown.knights,
          `${side.side} knights: remaining + casualties must equal initial`);
        assert.strictEqual(side.remaining.siegeEngines + side.casualties.siegeEngines, side.unitBreakdown.siegeEngines,
          `${side.side} siegeEngines: remaining + casualties must equal initial`);
        if (side.unitBreakdown.garrison !== undefined) {
          assert.strictEqual((side.remaining.garrison ?? 0) + (side.casualties.garrison ?? 0), side.unitBreakdown.garrison,
            `${side.side} garrison: remaining + casualties must equal initial`);
        }
        assert.strictEqual(side.remainingTroops + side.casualties.total, side.initialTroops,
          `${side.side} troop aggregate: remaining + casualties must equal initial`);
        assert.strictEqual(side.remainingSiegeEngines + side.casualties.siegeEngines, side.initialSiegeEngines,
          `${side.side} siege aggregate: remaining + casualties must equal initial`);
      }
    }
  }
});

console.log('Event engine (TypeScript source)');
test('BALANCE.events is present (no stale JS balance)', () => {
  assert.ok(BALANCE.events, 'BALANCE.events missing');
  assert.ok(BALANCE.events.world.maxEventsPerTurn > 0);
});
test('event registry loads from TypeScript definitions', () => {
  assert.ok(EVENT_LIST.length > 0, 'EVENT_LIST empty');
  assert.ok(getEventById(EVENT_LIST[0]!.id));
});
test('WorldSimulator.simulate runs against the TS implementation', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const sim = new WorldSimulator();
  const input: WorldStepInput = {
    turn: 1,
    territories: gameState.territories,
    factions: gameState.factions,
    activeEvents: [],
    eventHistory: [],
    playerFactionId: 'merchant_republic',
    seed: 42,
  };
  const out = sim.simulate(input);
  assert.ok(Array.isArray(out.summary));
  assert.ok(out.mutatedTerritories.size > 0);
});

console.log('Canonical types & state architecture');
test('WorldSimulator.simulate does not mutate its input activeEvents (shared-state regression)', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 7);
  const original: ActiveEvent = {
    instanceId: 'inst_test_1',
    typeId: 'test_event',
    category: 'environmental',
    title: 'Test Event',
    description: 'A test event about to expire',
    causes: ['test'],
    severity: 'minor',
    status: 'active',
    territoryId: null,
    factionId: null,
    triggeredTurn: 1,
    durationTurns: 1,
    startedTurn: 1,
    expiresTurn: 1, // turn 5 below is >= this, so simulate() should expire it in the OUTPUT only
    consequences: [],
    chainSuppressed: false,
    chainDelays: [{ toEventId: 'chain_target', delayRemaining: 2, probability: 0.5, severity: 'minor' }],
    choicesPending: [],
  };
  const beforeStatus = original.status;
  const beforeDelay = original.chainDelays[0]!.delayRemaining;

  const sim = new WorldSimulator();
  const out = sim.simulate({
    turn: 5,
    territories: gameState.territories,
    factions: gameState.factions,
    activeEvents: [original],
    eventHistory: [],
    seed: 7,
  });

  // The ORIGINAL object passed in must be untouched...
  assert.strictEqual(original.status, beforeStatus, 'simulate() mutated the caller\'s ActiveEvent.status in place');
  assert.strictEqual(original.chainDelays[0]!.delayRemaining, beforeDelay, 'simulate() mutated the caller\'s chainDelays entry in place');
  // ...while the RETURNED copy reflects the computed change.
  assert.strictEqual(out.newActiveEvents[0]!.status, 'expired', 'returned event should be expired');
});
test('WorldSimulator.resolveChoice does not mutate its input activeEvents (shared-state regression)', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 7);
  const original: ActiveEvent = {
    instanceId: 'inst_test_2',
    typeId: 'test_event',
    category: 'environmental',
    title: 'Test Event',
    description: 'A test event with a pending choice',
    causes: ['test'],
    severity: 'minor',
    status: 'active',
    territoryId: null,
    factionId: null,
    triggeredTurn: 1,
    durationTurns: 10,
    startedTurn: 1,
    expiresTurn: 11,
    consequences: [],
    chainSuppressed: false,
    chainDelays: [],
    choicesPending: [{ id: 'ignore', label: 'Ignore', description: 'Do nothing' }],
  };
  const beforePending = original.choicesPending.length;

  const sim = new WorldSimulator();
  sim.resolveChoice({
    turn: 2,
    territories: gameState.territories,
    factions: gameState.factions,
    activeEvents: [original],
    eventHistory: [],
    seed: 7,
    activeEventInstanceId: 'inst_test_2',
    choiceId: 'ignore',
  });

  assert.strictEqual(original.choicesPending.length, beforePending, 'resolveChoice() mutated the caller\'s choicesPending in place');
  assert.strictEqual(original.choiceTaken, undefined, 'resolveChoice() mutated the caller\'s ActiveEvent.choiceTaken in place');
});
test('LEGACY MapEngine.toTerritorySpecs still matches MapTerritorySpec (fixture only)', () => {
  const engine = new MapEngine(42);
  const { world } = engine.generateInitialWorld({
    worldSeed: 42,
    playerFactionIds: ['a', 'b'],
    initialTerritoryCount: 6,
  });
  const specs: MapTerritorySpec[] = engine.toTerritorySpecs(world);
  assert.ok(specs.length > 0, 'expected at least one spec');
  const s = specs[0]!;
  const expectedKeys = ['id', 'name', 'terrain', 'neighbors', 'population', 'baseValue',
    'resourceOutput', 'fortification', 'garrison', 'isCapital', 'owner'].sort();
  assert.deepStrictEqual(Object.keys(s).sort(), expectedKeys, 'toTerritorySpecs() shape drifted from MapTerritorySpec');
});

// ============================================================
// AI DECISION CORRECTNESS PASS — regression tests
// ============================================================

function makeSelf(id: string, overrides: Partial<WarlordSnapshot> = {}): WarlordSnapshot {
  return {
    id,
    name: id,
    personality: PersonalitySystem.createPreset('expansionist'),
    territories: [],
    armies: [],
    totalMilitaryPower: 0,
    resources: { gold: 1000, food: 1000, iron: 1000, wood: 1000, stone: 1000 },
    resourceIncome: { gold: 100, food: 100, iron: 100, wood: 100, stone: 100 },
    diplomacy: new Map(),
    memory: [],
    goals: [],
    currentThreats: [],
    knownFactions: [id],
    knownTerritories: [],
    lastActions: [],
    reputation: 50,
    stability: 70,
    ambition: 0.5,
    ...overrides,
  };
}

function makeTerritory(overrides: Partial<Territory> & { id: string }): Territory {
  return {
    owner: null,
    regionId: 'r_test',
    terrain: 'plains',
    neighboring: [],
    population: 1000,
    baseValue: 10,
    resourceOutput: {},
    fortification: 0,
    garrison: 0,
    ...overrides,
  };
}

console.log('AI decision correctness — attack scoring sees defender field army');
test('estimateMilitaryAdvantage considers a defending field army stationed at the target, not just garrison', () => {
  const attackerArmies: Army[] = [
    { id: 'atk1', owner: 'me', location: 'home', soldiers: 1000, knights: 0, siegeEngines: 0, morale: 75, supply: 75 },
  ];
  const targetTerritory = makeTerritory({ id: 'target', owner: 'enemy', neighboring: ['home'], garrison: 200 });
  const defendingArmy: Army = { id: 'def1', owner: 'enemy', location: 'target', soldiers: 3000, knights: 200, siegeEngines: 0, morale: 80, supply: 80 };
  const irrelevantArmy: Army = { id: 'irrelevant', owner: 'enemy', location: 'somewhere_else', soldiers: 9000, knights: 0, siegeEngines: 0, morale: 80, supply: 80 };

  const withoutDefenderArmy = ScoringHelpers.estimateMilitaryAdvantage(
    attackerArmies, targetTerritory, new Map([['irrelevant', irrelevantArmy]]),
  );
  const withDefenderArmy = ScoringHelpers.estimateMilitaryAdvantage(
    attackerArmies, targetTerritory, new Map([['irrelevant', irrelevantArmy], ['def1', defendingArmy]]),
  );
  assert.ok(withDefenderArmy.ratio < withoutDefenderArmy.ratio,
    "a defending field army stationed at the target must reduce the attacker's estimated advantage ratio");
  assert.ok(withDefenderArmy.advantage < withoutDefenderArmy.advantage,
    "a defending field army stationed at the target must reduce the attacker's estimated advantage score");

  const garrisonOnlyBaseline = ScoringHelpers.estimateMilitaryAdvantage(attackerArmies, targetTerritory, new Map());
  assert.strictEqual(withoutDefenderArmy.ratio, garrisonOnlyBaseline.ratio,
    'an army stationed elsewhere must not affect the military advantage estimate for this target');
});

console.log('AI decision correctness — local defense threat');
test('computeLocalHostilePower scales with force actually stationed at the hostile territory, not with unrelated totals', () => {
  const weakHostile = makeTerritory({ id: 'weak', owner: 'enemy', garrison: 10 });
  const strongHostile = makeTerritory({ id: 'strong', owner: 'enemy', garrison: 800 });
  const armyAtStrong: Army = { id: 'a1', owner: 'enemy', location: 'strong', soldiers: 2000, knights: 100, siegeEngines: 0, morale: 80, supply: 80 };
  const armyElsewhere: Army = { id: 'a2', owner: 'enemy', location: 'far_away', soldiers: 50000, knights: 0, siegeEngines: 0, morale: 80, supply: 80 };
  const allArmies = new Map<string, Army>([['a1', armyAtStrong], ['a2', armyElsewhere]]);

  const weakThreat = ScoringHelpers.computeLocalHostilePower(weakHostile, allArmies);
  const strongThreat = ScoringHelpers.computeLocalHostilePower(strongHostile, allArmies);
  assert.ok(weakThreat < 50, `an almost-undefended hostile neighbor should read as a small local threat, got ${weakThreat}`);
  assert.ok(strongThreat > weakThreat * 10,
    'a hostile territory with a large garrison and a large field army stationed on it must read as a much bigger local threat');
  assert.strictEqual(
    ScoringHelpers.computeLocalHostilePower(weakHostile, new Map()),
    ScoringHelpers.computeLocalHostilePower(weakHostile, allArmies),
    "an army stationed elsewhere must not affect this territory's local threat figure",
  );
});

console.log('AI decision correctness — reinforcement cost consistency');
test('scoreReinforce affordability check uses BALANCE.economy.reinforcementCost, the same source cli.ts execution charges', () => {
  const RC = BALANCE.economy.reinforcementCost;
  const territories = new Map<string, Territory>([
    ['home', makeTerritory({ id: 'home', owner: 'me', garrison: 50 })],
  ]);
  const armies = new Map<string, Army>();
  const scorer = new ActionScorer();
  const scoreReinforceHome = (gold: number, food: number) => {
    const self = makeSelf('me', {
      territories: ['home'],
      totalMilitaryPower: 50,
      resources: { gold, food, iron: 1000, wood: 1000, stone: 1000 },
    });
    const gameState: GameStateSnapshot = { turn: 1, factions: new Map([['me', self]]), territories, armies, allFactionIds: ['me'] };
    const ctx = WarlordState.buildContext(self, gameState);
    const input: ScorerInput = { ctx, turn: 1, rng: new SeededRNG(1), memory: new MemorySystem(), goals: new GoalSystem([]) };
    return scorer.scoreAllActions(input).find((s) => s.action === 'REINFORCE' && s.targetId === 'home')!;
  };

  const affordableResult = scoreReinforceHome(RC.gold, RC.food);
  assert.ok(affordableResult.factorBreakdown.some((f) => f.factor === 'Resources available'),
    'exactly enough gold/food for the real REINFORCE cost must be treated as affordable');
  assert.ok(!affordableResult.factorBreakdown.some((f) => f.factor === 'Resource constraints'));

  const shortResult = scoreReinforceHome(RC.gold - 1, RC.food);
  assert.ok(shortResult.factorBreakdown.some((f) => f.factor === 'Resource constraints'),
    'one gold short of the real REINFORCE cost must be treated as unaffordable, matching what execution would refuse to charge');

  // Guard against silently rebalancing the shared, authoritative cost values.
  assert.strictEqual(RC.gold, 250);
  assert.strictEqual(RC.food, 150);
  assert.strictEqual(RC.garrisonGain, 100);
});

console.log('AI decision correctness — trade respects surplus depth, not just low current need');
function scoreTradeIronBonus(myIronResources: number, myIronIncome: number): number {
  const me = makeSelf('me', {
    knownFactions: ['me', 'other'],
    resources: { gold: 1000, food: 1000, iron: myIronResources, wood: 1000, stone: 1000 },
    resourceIncome: { gold: 100, food: 100, iron: myIronIncome, wood: 100, stone: 100 },
  });
  const other = makeSelf('other', {
    resources: { gold: 5000, food: 5000, iron: 10, wood: 5000, stone: 5000 },
    resourceIncome: { gold: 100, food: 100, iron: 50, wood: 100, stone: 100 },
  });
  const gameState: GameStateSnapshot = {
    turn: 1,
    factions: new Map([['me', me], ['other', other]]),
    territories: new Map(),
    armies: new Map(),
    allFactionIds: ['me', 'other'],
  };
  const ctx = WarlordState.buildContext(me, gameState);
  const scorer = new ActionScorer();
  const input: ScorerInput = { ctx, turn: 1, rng: new SeededRNG(1), memory: new MemorySystem(), goals: new GoalSystem([]) };
  const trade = scorer.scoreAllActions(input).find((s) => s.action === 'TRADE' && s.targetId === 'other');
  assert.ok(trade, 'expected a TRADE score for the known trade partner');
  const complementarity = trade!.factorBreakdown.find((f) => f.factor === 'Resource complementarity');
  return complementarity ? complementarity.contribution : 0;
}
test('a razor-thin resource surplus contributes only a small trade bonus', () => {
  // iron = 2401, income = 100 puts `mySurplus.iron` just barely above 0 (~0.00028).
  const contribution = scoreTradeIronBonus(2401, 100);
  assert.ok(contribution < 1, `expected a razor-thin surplus to contribute a small bonus, got ${contribution}`);
});
test('a deep resource surplus contributes a much larger trade bonus for the same partner need', () => {
  // iron = 100000, income = 100 puts `mySurplus.iron` at its cap (1.0).
  const contribution = scoreTradeIronBonus(100000, 100);
  assert.ok(contribution > 40, `expected a deep surplus to contribute a large bonus, got ${contribution}`);
});
test('no resource surplus at all contributes no trade bonus for that resource, even if the partner badly needs it', () => {
  // iron = 0, income = 0 -> `mySurplus.iron` is undefined (the inc<=0 branch never registers a surplus).
  const contribution = scoreTradeIronBonus(0, 0);
  assert.strictEqual(contribution, 0);
});

console.log('AI decision correctness — control_region goal target bug');
test('control_region goal no longer uses the broken id.split("_")[0] region heuristic for ATTACK/EXPAND alignment', () => {
  const goals = new GoalSystem([]);
  goals.addGoal({ type: 'control_region', priority: 80, targetRegion: 't', createdTurn: 0 });
  const territories = new Map<string, Territory>([
    ['t_23_mis', makeTerritory({ id: 't_23_mis', owner: 'enemy' })],
  ]);
  const self = makeSelf('me');
  // Under the old buggy heuristic, 't_23_mis'.split('_')[0] === 't' === goal.targetRegion,
  // so an ATTACK on ANY territory whose id happened to start with 't_' would have been
  // (accidentally) reported as region-aligned, regardless of actual region membership.
  const result = goals.evaluateActionAlignment({
    actionType: 'ATTACK', targetFaction: 'enemy', targetTerritory: 't_23_mis',
    self, currentTurn: 0, allTerritories: territories,
  });
  assert.strictEqual(result.alignedGoals.length, 0,
    'ATTACK must not be credited as aligned with control_region via id-prefix guessing');
});
test('control_region aligns BUILD when the target territory is in the named region', () => {
  const goals = new GoalSystem([]);
  goals.addGoal({ type: 'control_region', priority: 80, targetRegion: 'r_home', createdTurn: 0 });
  const self = makeSelf('me');
  const territories = new Map([
    ['home', makeTerritory({ id: 'home', owner: 'me', regionId: 'r_home' })],
  ]);
  const result = goals.evaluateActionAlignment({
    actionType: 'BUILD', targetTerritory: 'home',
    self, currentTurn: 0, allTerritories: territories,
  });
  assert.strictEqual(result.alignedGoals.length, 1);
});

console.log('AI decision correctness — invalid/null goal targets handled safely');
test('destroy_rival and form_alliance goals generated by generateInitialGoals have null targetFaction and never misreport alignment', () => {
  const rng = new SeededRNG(7);
  const aggressiveGoals = GoalSystem.generateInitialGoals('aggressive', 'me', 0, rng);
  const destroyRival = aggressiveGoals.find((g) => g.type === 'destroy_rival');
  assert.ok(destroyRival, 'expected an aggressive faction to generate a destroy_rival goal');
  assert.strictEqual(destroyRival!.targetFaction, null,
    'generateInitialGoals has no faction context to pick a real rival from, so this must stay null rather than a fabricated id');
  const goals = new GoalSystem(aggressiveGoals);
  const result = goals.evaluateActionAlignment({
    actionType: 'ATTACK', targetFaction: 'some_other_faction', targetTerritory: 'some_territory',
    self: makeSelf('me'), currentTurn: 0, allTerritories: new Map(),
  });
  assert.ok(!result.alignedGoals.some((g) => g.type === 'destroy_rival'),
    'a null-target destroy_rival goal must not claim alignment with an attack on an arbitrary faction');
  assert.ok(!result.misalignedGoals.some((g) => g.type === 'destroy_rival'));
});
test('evaluateActionAlignment does not throw for actions with no target at all (e.g. WAIT)', () => {
  const goals = new GoalSystem(GoalSystem.generateInitialGoals('defensive', 'me', 0, new SeededRNG(3)));
  assert.doesNotThrow(() => {
    goals.evaluateActionAlignment({ actionType: 'WAIT', self: makeSelf('me'), currentTurn: 0, allTerritories: new Map() });
  });
});

console.log('AI decision correctness — personality reference sanity');
test('every ActionType has a valid, defined personality-bias trait mapping', () => {
  const actions: ActionType[] = ['ATTACK', 'DEFEND', 'REINFORCE', 'BUILD', 'MOVE', 'NEGOTIATE', 'OFFER_PEACE', 'DECLARE_WAR', 'TRADE', 'RETREAT', 'WAIT'];
  const personality = PersonalitySystem.createPreset('aggressive');
  for (const action of actions) {
    const bias = PersonalitySystem.getActionBias(action, personality);
    assert.ok(Number.isFinite(bias), `getActionBias(${action}) returned a non-finite value`);
  }
});
test('every PersonalityType preset defines all Personality trait fields with values in [0,1]', () => {
  const types: PersonalityType[] = ['defensive', 'aggressive', 'expansionist', 'opportunistic', 'diplomatic', 'economic'];
  const traitKeys = ['aggression', 'defensiveness', 'expansionism', 'opportunism', 'diplomacy', 'economics', 'riskTolerance', 'patience', 'forgivingness', 'loyalty'] as const;
  for (const t of types) {
    const p = PersonalitySystem.createPreset(t);
    assert.strictEqual(p.type, t);
    for (const k of traitKeys) {
      const v = (p as unknown as Record<string, number>)[k];
      assert.ok(typeof v === 'number' && v >= 0 && v <= 1, `${t}.${k} = ${v} is not in [0,1]`);
    }
  }
});

console.log('AI decision correctness — action selection / alternatives');
test('DecisionEngine.decide topAlternatives never includes the action that was actually selected', () => {
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const engine = new DecisionEngine(42);
  for (const [, ws] of warlordStates) {
    const decision = engine.decide(ws, gameState, 1);
    const dup = decision.topAlternatives.find(
      (a) => a.action === decision.action && a.targetId === decision.targetId && a.score === decision.score,
    );
    assert.ok(!dup, `topAlternatives for ${decision.warlordName} included the selected action (${decision.action}) as if it were a distinct alternative`);
  }
});
test('DecisionEngine.decide is deterministic for a fixed seed given identical state', () => {
  const run1 = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const run2 = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const decisions1 = new DecisionEngine(42).decideAll(run1.warlordStates, run1.gameState, 1);
  const decisions2 = new DecisionEngine(42).decideAll(run2.warlordStates, run2.gameState, 1);
  assert.deepStrictEqual(
    decisions1.map((d) => ({ action: d.action, targetId: d.targetId, score: d.score })),
    decisions2.map((d) => ({ action: d.action, targetId: d.targetId, score: d.score })),
    'identical seed + identical state must produce identical decisions',
  );
});

console.log('Engine execution consistency — balance/cost centralization');
test('BUILD affordability (scorer) and cli read BALANCE mirror of construction definition', () => {
  const scorerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'scoring', 'ActionScorer.ts'), 'utf8');
  const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'simulation', 'cli.ts'), 'utf8');
  assert.ok(/fortificationCostPerLevel/.test(scorerSrc), 'ActionScorer.scoreBuild must read BALANCE.territory.fortificationCostPerLevel');
  assert.ok(/fortificationCostPerLevel/.test(cliSrc), "cli.ts's BUILD execution must read BALANCE.territory.fortificationCostPerLevel");
  const def = getConstructionProjectDefinition('FORTIFICATION');
  assert.strictEqual(BALANCE.territory.fortificationCostPerLevel.gold, def.cost.gold);
  assert.strictEqual(BALANCE.territory.fortificationCostPerLevel.stone, def.cost.stone);
});
test('REINFORCE affordability (scorer) and REINFORCE cost (cli.ts execution) both read BALANCE.economy.reinforcementCost', () => {
  const scorerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'scoring', 'ActionScorer.ts'), 'utf8');
  const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'simulation', 'cli.ts'), 'utf8');
  assert.ok(/reinforcementCost\b/.test(scorerSrc) && /reinforcementCost\b/.test(cliSrc),
    'both ActionScorer and cli.ts must read the same BALANCE.economy.reinforcementCost value');
});

console.log('AI decision correctness — AI does not resolve battles itself');
test('ActionScorer does not import or instantiate BattleEngine — battle resolution stays authoritative in BattleEngine', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'scoring', 'ActionScorer.ts'), 'utf8');
  // Doc comments are allowed to MENTION BattleEngine (to explain the shared
  // CombatPower boundary); what must never appear is an actual import of it
  // or a call that would resolve a battle a second time.
  assert.ok(!/import[^;]*BattleEngine/.test(src) && !/BattleEngine\s*\(/.test(src) && !/BattleEngine\.resolve/.test(src),
    'ActionScorer must only use shared CombatPower estimate helpers, never import/instantiate/call BattleEngine directly, to avoid a second battle-resolution model');
});

// ── ENGINE EXECUTION CONSISTENCY PASS (Phase 6) ────────────────────────
// Minimal, self-contained 2-territory/2-faction scenarios built directly
// from canonical types (no SAMPLE_MAP dependency) so ATTACK/EXPAND
// execution can be tested in isolation and deterministically.

function buildTwoFactionScenario(opts: {
  attackerId: FactionId;
  defenderId: FactionId;
  homeGarrison?: number;
  frontGarrison?: number;
  atkArmySoldiers?: number;
  defArmySoldiers?: number;
}): { gameState: GameStateSnapshot; warlordStates: Map<FactionId, WarlordState>; front: Territory } {
  const { attackerId, defenderId } = opts;
  const home = makeTerritory({ id: 'home', owner: attackerId, neighboring: ['front'], garrison: opts.homeGarrison ?? 50 });
  const front = makeTerritory({ id: 'front', owner: defenderId, neighboring: ['home'], garrison: opts.frontGarrison ?? 20 });
  const territories = new Map<string, Territory>([['home', home], ['front', front]]);
  const armies = new Map<string, Army>();
  if (opts.atkArmySoldiers) {
    armies.set('atk_army', { id: 'atk_army', owner: attackerId, location: 'home', soldiers: opts.atkArmySoldiers, knights: 0, siegeEngines: 0, morale: 75, supply: 80 });
  }
  if (opts.defArmySoldiers) {
    armies.set('def_army', { id: 'def_army', owner: defenderId, location: 'front', soldiers: opts.defArmySoldiers, knights: 0, siegeEngines: 0, morale: 75, supply: 80 });
  }
  const atkSnap = makeSelf(attackerId, { territories: ['home'], armies: opts.atkArmySoldiers ? ['atk_army'] : [] });
  const defSnap = makeSelf(defenderId, { territories: ['front'], armies: opts.defArmySoldiers ? ['def_army'] : [] });
  const factions = new Map([[attackerId, atkSnap], [defenderId, defSnap]]);
  const gameState: GameStateSnapshot = { turn: 1, factions, territories, armies, allFactionIds: [attackerId, defenderId] };
  const warlordStates = new Map<FactionId, WarlordState>([
    [attackerId, new WarlordState(atkSnap)],
    [defenderId, new WarlordState(defSnap)],
  ]);
  return { gameState, warlordStates, front };
}

function attackDecision(warlordId: FactionId, targetId: string): Decision {
  return {
    warlordId, warlordName: warlordId, turn: 1, action: 'ATTACK',
    targetId, targetName: targetId, reasoning: [], score: 100, topAlternatives: [], confidence: 1,
  };
}

console.log('Engine execution consistency — ATTACK uses BattleEngine');
test('cli.ts does not duplicate battle math — ATTACK execution calls battleEngine.resolve() and never reimplements win-probability/casualty formulas', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'simulation', 'cli.ts'), 'utf8');
  assert.ok(/battleEngine\.resolve\(/.test(src), 'ATTACK execution must call battleEngine.resolve()');
  assert.ok(!/computeWinProbability|computeCasualtyRates|computeAttackerPower|computeDefenderPower/.test(src),
    'cli.ts must not reimplement BattleEngine/CombatPower math — it must call the engine, not duplicate its formulas');
});
test('ATTACK execution applies the exact BattleResult from BattleEngine: capture, garrison, and survivor counts all match', () => {
  const attackerId = 'atk_faction';
  const defenderId = 'def_faction';
  const { gameState, warlordStates, front } = buildTwoFactionScenario({
    attackerId, defenderId, atkArmySoldiers: 500, frontGarrison: 20,
  });
  const frontSnapshotBeforeMutation: Territory = { ...front };

  // Independently resolve the exact same BattleInput a correct ATTACK
  // execution must construct, to get an authoritative expected result to
  // diff the harness's state mutation against.
  const expectedSeed = deriveBattleSeed(42, 1, attackerId, defenderId, 'front');
  const expected = battleEngine.resolve({
    turn: 1,
    seed: expectedSeed,
    attackerFactionId: attackerId,
    defenderFactionId: defenderId,
    attackerArmies: [{ id: 'atk_army', owner: attackerId, location: 'home', soldiers: 500, knights: 0, siegeEngines: 0, morale: 75, supply: 80 }],
    defenderArmies: [],
    defenderGarrison: 20,
    territory: frontSnapshotBeforeMutation,
  });
  // Sanity-check the fixture: with 500 soldiers vs. a 20-garrison target,
  // seed 42/turn 1 must deterministically produce a capture (if this ever
  // fails, the fixture — not the harness — needs a new seed/numbers).
  assert.strictEqual(expected.winner, 'attacker');
  assert.strictEqual(expected.territoryOutcome, 'captured');

  simulateDecisionOutcomes([attackDecision(attackerId, 'front')], warlordStates, gameState, 1, 42, false);

  const frontAfter = gameState.territories.get('front')!;
  assert.strictEqual(frontAfter.owner, attackerId, 'captured territory must change owner to the attacker');
  assert.strictEqual(frontAfter.garrison, expected.defender.remaining.garrison ?? 0,
    'territory garrison after battle must equal BattleResult.defender.remaining.garrison exactly');
  assert.ok(!warlordStates.get(defenderId)!.snapshot.territories.includes('front'),
    'defender must lose the captured territory from their territory list');
  assert.ok(warlordStates.get(attackerId)!.snapshot.territories.includes('front'),
    'attacker must gain the captured territory in their territory list');
  const survivor = gameState.armies.get('atk_army');
  assert.ok(survivor, 'winning attacker army must still exist (no-retreat rule only eliminates the LOSER)');
  assert.strictEqual(survivor!.soldiers, expected.attacker.remaining.soldiers,
    "surviving army's soldier count must equal BattleResult.attacker.remaining.soldiers exactly");
  assert.strictEqual(survivor!.location, 'front', 'surviving attacker force advances into the territory it just captured');
});
test('ATTACK execution honors the no-retreat rule on loss: the losing attacker army is fully eliminated, not left with survivors or a "retreated" status', () => {
  const attackerId = 'weak_atk';
  const defenderId = 'strong_def';
  const { gameState, warlordStates } = buildTwoFactionScenario({
    attackerId, defenderId, atkArmySoldiers: 150, frontGarrison: 1000,
  });
  gameState.territories.get('front')!.fortification = 2;

  simulateDecisionOutcomes([attackDecision(attackerId, 'front')], warlordStates, gameState, 1, 42, false);

  assert.strictEqual(gameState.territories.get('front')!.owner, defenderId, 'defender must keep the territory on a loss');
  assert.strictEqual(gameState.armies.get('atk_army'), undefined,
    'the eliminated (losing) attacker army must be removed from gameState.armies entirely — no retreat, no lingering zero-strength army object');
  assert.ok(!warlordStates.get(attackerId)!.snapshot.armies.includes('atk_army'),
    "the attacker's own army-id list must no longer reference the eliminated army");
});
test('ATTACK resolution is deterministic for a fixed seed: identical starting state produces an identical BattleResult and identical state mutation', () => {
  const scenarioA = buildTwoFactionScenario({ attackerId: 'a1', defenderId: 'd1', atkArmySoldiers: 300, frontGarrison: 80 });
  const scenarioB = buildTwoFactionScenario({ attackerId: 'a1', defenderId: 'd1', atkArmySoldiers: 300, frontGarrison: 80 });
  simulateDecisionOutcomes([attackDecision('a1', 'front')], scenarioA.warlordStates, scenarioA.gameState, 1, 42, false);
  simulateDecisionOutcomes([attackDecision('a1', 'front')], scenarioB.warlordStates, scenarioB.gameState, 1, 42, false);
  assert.strictEqual(scenarioA.gameState.territories.get('front')!.owner, scenarioB.gameState.territories.get('front')!.owner);
  assert.strictEqual(scenarioA.gameState.territories.get('front')!.garrison, scenarioB.gameState.territories.get('front')!.garrison);
  const armyA = scenarioA.gameState.armies.get('atk_army');
  const armyB = scenarioB.gameState.armies.get('atk_army');
  assert.strictEqual(armyA?.soldiers, armyB?.soldiers);
});
test('an ATTACK decision with no adjacent army above the eligibility threshold results in no battle and no state change', () => {
  // No atkArmySoldiers supplied -> attacker has zero eligible armies, same
  // as the >100 soldiers+knights eligibility ActionScorer.scoreAttack uses.
  const { gameState, warlordStates } = buildTwoFactionScenario({ attackerId: 'atk2', defenderId: 'def2', frontGarrison: 20 });
  simulateDecisionOutcomes([attackDecision('atk2', 'front')], warlordStates, gameState, 1, 42, false);
  assert.strictEqual(gameState.territories.get('front')!.owner, 'def2', 'without an eligible attacking army, no battle must occur and ownership must not change');
});

// ── EVENT ENGINE CORRECTNESS PASS (Phase 7) ────────────────────────────

function makeActiveEvent(overrides: Partial<ActiveEvent> & { instanceId: string; typeId: string }): ActiveEvent {
  return {
    category: 'environmental',
    title: overrides.typeId,
    description: 'test',
    causes: ['test'],
    severity: 'minor',
    status: 'active',
    territoryId: null,
    factionId: null,
    triggeredTurn: 1,
    durationTurns: 10,
    startedTurn: 1,
    expiresTurn: 11,
    consequences: [],
    chainSuppressed: false,
    chainDelays: [],
    choicesPending: [],
    ...overrides,
  };
}

function snapshotFaction(f: WarlordSnapshot) {
  return {
    gold: f.resources.gold,
    food: f.resources.food,
    stability: f.stability,
    incomeGold: f.resourceIncome.gold ?? 0,
  };
}

console.log('Event engine correctness — determinism');
test('WorldSimulator.simulate is deterministic for the same seed and initial state, including instance and history IDs', () => {
  const build = () => SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const a = build();
  const b = build();
  const sim = new WorldSimulator();
  const mkInput = (gs: typeof a.gameState): WorldStepInput => ({
    turn: 3,
    territories: gs.territories,
    factions: gs.factions,
    armies: gs.armies,
    activeEvents: [],
    eventHistory: [],
    seed: 42,
  });
  const outA = sim.simulate(mkInput(a.gameState));
  const outB = sim.simulate(mkInput(b.gameState));
  assert.deepStrictEqual(
    outA.newActiveEvents.map((e) => e.instanceId),
    outB.newActiveEvents.map((e) => e.instanceId),
    'instance IDs must match across identical seeded runs',
  );
  assert.deepStrictEqual(
    outA.newEventHistory.map((h) => h.id),
    outB.newEventHistory.map((h) => h.id),
    'history IDs must match across identical seeded runs',
  );
  assert.deepStrictEqual(
    outA.triggeredEvents.map((t) => `${t.definition.typeId}:${t.territoryId}:${t.severity}`),
    outB.triggeredEvents.map((t) => `${t.definition.typeId}:${t.territoryId}:${t.severity}`),
  );
  assert.deepStrictEqual(outA.summary, outB.summary);
});
test('different seeds may produce different event instance IDs / outcomes', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const sim = new WorldSimulator();
  const base = {
    turn: 3,
    territories: gameState.territories,
    factions: gameState.factions,
    armies: gameState.armies,
    activeEvents: [] as ActiveEvent[],
    eventHistory: [] as [],
  };
  const outA = sim.simulate({ ...base, seed: 1 });
  const outB = sim.simulate({ ...base, seed: 2 });
  const idsA = outA.newActiveEvents.map((e) => e.instanceId).join('|');
  const idsB = outB.newActiveEvents.map((e) => e.instanceId).join('|');
  const histA = outA.newEventHistory.map((h) => h.id).join('|');
  const histB = outB.newEventHistory.map((h) => h.id).join('|');
  assert.ok(idsA !== idsB || histA !== histB || outA.summary.join() !== outB.summary.join(),
    'different seeds should not be forced to produce identical IDs and summaries');
});
test('instance IDs within a single simulate() call are unique', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 7);
  const sim = new WorldSimulator();
  const out = sim.simulate({
    turn: 1,
    territories: gameState.territories,
    factions: gameState.factions,
    armies: gameState.armies,
    activeEvents: [],
    eventHistory: [],
    seed: 7,
  });
  const ids = out.newActiveEvents.map((e) => e.instanceId);
  assert.strictEqual(ids.length, new Set(ids).size, 'duplicate instance IDs in one simulate() call');
});

console.log('Event engine correctness — invalid type does not fall back');
test('getEventByTypeId returns undefined for an unknown type rather than another event', () => {
  assert.ok(getEventByTypeId('drought'));
  assert.strictEqual(getEventByTypeId('not_a_real_event'), undefined);
  assert.strictEqual(getEventByTypeId(''), undefined);
});
test('an unknown ActiveEvent typeId does not silently become drought (or any other event)', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  for (const t of gameState.territories.values()) t.population = 0; // no new world-condition triggers
  const target = [...gameState.territories.values()].find((t) => t.owner)!;
  const foodBefore = target.resourceOutput.food ?? 0;
  const fake = makeActiveEvent({
    instanceId: 'inst_fake',
    typeId: 'not_a_real_event',
    territoryId: target.id,
    factionId: target.owner,
    expiresTurn: 99,
  });
  const sim = new WorldSimulator();
  const out = sim.simulate({
    turn: 2,
    territories: gameState.territories,
    factions: gameState.factions,
    activeEvents: [fake],
    eventHistory: [],
    seed: 42,
  });
  const foodAfter = out.mutatedTerritories.get(target.id)!.resourceOutput.food ?? 0;
  assert.strictEqual(foodAfter, foodBefore,
    'unknown type must not apply another event\'s per-turn effects (EVENT_LIST[0] fallback regression)');
  assert.ok(!out.perTurnConsequences.some((c) => (c.message || '').toLowerCase().includes('drought')),
    'unknown type must not emit drought per-turn consequences');
});

console.log('Event engine correctness — choice cost validation');
test('unaffordable choice fails and leaves the entire relevant state unchanged', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const target = [...gameState.territories.values()].find((t) => t.owner)!;
  const faction = gameState.factions.get(target.owner!)!;
  const costGold = BALANCE.events.choices.importFoodCostGoldPerSeverity.minor;
  faction.resources.gold = costGold - 1;
  const before = snapshotFaction(faction);
  const popBefore = target.population;
  const ev = makeActiveEvent({
    instanceId: 'inst_food',
    typeId: 'food_shortage',
    category: 'economic',
    territoryId: target.id,
    factionId: faction.id,
    choicesPending: [{
      id: 'import_food',
      label: 'Import food',
      description: 'cost',
      cost: { gold: costGold },
    }],
  });
  const sim = new WorldSimulator();
  const out = sim.resolveChoice({
    turn: 2,
    territories: gameState.territories,
    factions: gameState.factions,
    armies: gameState.armies,
    activeEvents: [ev],
    eventHistory: [],
    seed: 42,
    activeEventInstanceId: 'inst_food',
    choiceId: 'import_food',
  });
  assert.ok(out.messages.some((m) => m.toLowerCase().includes('cannot afford')),
    `expected unaffordable message, got: ${out.messages.join(' | ')}`);
  const afterFac = out.mutatedFactions.get(faction.id)!;
  assert.deepStrictEqual(snapshotFaction(afterFac), before, 'faction resources/stability must not change');
  assert.strictEqual(out.mutatedTerritories.get(target.id)!.population, popBefore);
  const returned = out.updatedActive.find((e) => e.instanceId === 'inst_food')!;
  assert.strictEqual(returned.choicesPending.length, 1, 'pending choice must remain');
  assert.strictEqual(returned.choiceTaken, undefined, 'choiceTaken must not be set');
  assert.strictEqual(out.paidCost, undefined);
  assert.strictEqual(ev.choicesPending.length, 1, 'caller-owned event must stay unmutated');
  assert.strictEqual(faction.resources.gold, before.gold, 'caller-owned faction gold must stay unmutated');
});
test('affordable choice pays the cost and applies consequences', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const target = [...gameState.territories.values()].find((t) => t.owner)!;
  const faction = gameState.factions.get(target.owner!)!;
  const costGold = BALANCE.events.choices.importFoodCostGoldPerSeverity.minor;
  faction.resources.gold = costGold + 50;
  const goldBefore = faction.resources.gold;
  const stabBefore = faction.stability;
  const ev = makeActiveEvent({
    instanceId: 'inst_food2',
    typeId: 'food_shortage',
    category: 'economic',
    territoryId: target.id,
    factionId: faction.id,
    choicesPending: [{
      id: 'import_food',
      label: 'Import food',
      description: 'cost',
      cost: { gold: costGold },
    }],
  });
  const sim = new WorldSimulator();
  const out = sim.resolveChoice({
    turn: 2,
    territories: gameState.territories,
    factions: gameState.factions,
    armies: gameState.armies,
    activeEvents: [ev],
    eventHistory: [],
    seed: 42,
    activeEventInstanceId: 'inst_food2',
    choiceId: 'import_food',
  });
  const after = out.mutatedFactions.get(faction.id)!;
  assert.strictEqual(after.resources.gold, goldBefore - costGold);
  assert.strictEqual(after.stability, Math.max(0, Math.min(100, stabBefore + BALANCE.events.choices.importFoodStabilityRestore)));
  const returned = out.updatedActive.find((e) => e.instanceId === 'inst_food2')!;
  assert.strictEqual(returned.choicesPending.length, 0);
  assert.ok(returned.choiceTaken);
  assert.strictEqual(returned.choiceTaken!.id, 'import_food');
  assert.strictEqual(out.paidCost?.gold, costGold);
});

console.log('Event engine correctness — chain / clone isolation');
test('event chain delay objects are not shared between instances or with the caller', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const shared = { toEventId: 'evt_food_shortage', delayRemaining: 4, probability: 0, severity: 'minor' as const };
  const e1 = makeActiveEvent({ instanceId: 'c1', typeId: 'drought', chainDelays: [shared], expiresTurn: 99 });
  const e2 = makeActiveEvent({ instanceId: 'c2', typeId: 'drought', chainDelays: [shared], expiresTurn: 99 });
  const defDelay = getEventById('evt_drought')!.canChainFrom![0]!.delayMinTurns;
  const sim = new WorldSimulator();
  const out = sim.simulate({
    turn: 2,
    territories: gameState.territories,
    factions: gameState.factions,
    activeEvents: [e1, e2],
    eventHistory: [],
    seed: 42,
  });
  assert.strictEqual(shared.delayRemaining, 4, 'caller-owned chainDelays entry must not be decremented');
  const o1 = out.newActiveEvents.find((e) => e.instanceId === 'c1')!;
  const o2 = out.newActiveEvents.find((e) => e.instanceId === 'c2')!;
  assert.strictEqual(o1.chainDelays[0]!.delayRemaining, 3);
  assert.strictEqual(o2.chainDelays[0]!.delayRemaining, 3);
  o1.chainDelays[0]!.delayRemaining = 0;
  assert.strictEqual(o2.chainDelays[0]!.delayRemaining, 3, 'mutating one instance delay must not change the other');
  assert.strictEqual(getEventById('evt_drought')!.canChainFrom![0]!.delayMinTurns, defDelay,
    'EventDefinition.canChainFrom must not be mutated when instances are seeded');
});
test('expired events stop receiving per-turn effects and stay marked expired', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  for (const t of gameState.territories.values()) t.population = 0;
  const target = [...gameState.territories.values()].find((t) => t.owner)!;
  const foodBefore = target.resourceOutput.food ?? 0;
  const ev = makeActiveEvent({
    instanceId: 'exp1',
    typeId: 'drought',
    territoryId: target.id,
    factionId: target.owner,
    status: 'expired',
    expiresTurn: 1,
  });
  const sim = new WorldSimulator();
  const out = sim.simulate({
    turn: 5,
    territories: gameState.territories,
    factions: gameState.factions,
    activeEvents: [ev],
    eventHistory: [],
    seed: 42,
  });
  const returned = out.newActiveEvents.find((e) => e.instanceId === 'exp1')!;
  assert.strictEqual(returned.status, 'expired');
  const foodAfter = out.mutatedTerritories.get(target.id)!.resourceOutput.food ?? 0;
  assert.strictEqual(foodAfter, foodBefore, 'expired drought must not keep applying per-turn food suppression');
});

console.log('Event engine correctness — effect application');
test('territory-local resourceOutputPct does not rewrite faction-wide resourceIncome', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const target = [...gameState.territories.values()].find((t) => t.owner)!;
  target.resourceOutput = { ...target.resourceOutput, gold: 10 };
  const faction = gameState.factions.get(target.owner!)!;
  const incomeBefore = faction.resourceIncome.gold ?? 0;
  const outGoldBefore = target.resourceOutput.gold ?? 0;
  const applier = new ConsequenceApplier(gameState.territories, gameState.factions);
  applier.applyDelta({
    territoryId: target.id,
    delta: { resourceOutputPct: { gold: 0.5 } },
    message: 'local boost',
  });
  assert.strictEqual(applier.factions.get(faction.id)!.resourceIncome.gold ?? 0, incomeBefore,
    'a territory-local production boost must not scale empire-wide income');
  assert.strictEqual(applier.territories.get(target.id)!.resourceOutput.gold, Math.round(outGoldBefore * 1.5));
});
test('moraleDeltaArmy is applied to the faction\'s armies when armies are provided, not discarded', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const factionId = gameState.allFactionIds[0]!;
  const army = [...gameState.armies.values()].find((a) => a.owner === factionId);
  assert.ok(army, 'sample map should have at least one army');
  const moraleBefore = army!.morale;
  const applier = new ConsequenceApplier(gameState.territories, gameState.factions, gameState.armies);
  applier.applyDelta({
    factionId,
    delta: { moraleDeltaArmy: -6 },
    message: 'army rations stretched thin',
  });
  const after = applier.armies!.get(army!.id)!;
  assert.strictEqual(after.morale, Math.max(0, moraleBefore - 6));
  assert.strictEqual(army!.morale, moraleBefore, 'caller-owned army must not be mutated');
});
test('relationshipDeltaOpinion is one-sided as the existing diplomacy map requires', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const [aId, bId] = gameState.allFactionIds;
  const a = gameState.factions.get(aId)!;
  const b = gameState.factions.get(bId)!;
  const aOpBefore = a.diplomacy.get(bId)!.opinion;
  const bOpBefore = b.diplomacy.get(aId)!.opinion;
  const applier = new ConsequenceApplier(gameState.territories, gameState.factions);
  applier.applyDelta({
    factionId: aId,
    delta: { relationshipDeltaOpinion: { target: bId, delta: -15 } },
    message: 'opinion shift',
  });
  assert.strictEqual(applier.factions.get(aId)!.diplomacy.get(bId)!.opinion, Math.max(-100, aOpBefore - 15));
  assert.strictEqual(applier.factions.get(bId)!.diplomacy.get(aId)!.opinion, bOpBefore,
    'B\'s opinion of A must not change unless a second delta is issued');
});

console.log('Event engine correctness — invalid inputs fail safely');
test('resolveChoice on a missing instance, unknown type, invalid choice, or already-resolved event does not throw and does not apply costs', () => {
  const { gameState } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const target = [...gameState.territories.values()].find((t) => t.owner)!;
  const faction = gameState.factions.get(target.owner!)!;
  const goldBefore = faction.resources.gold;
  const sim = new WorldSimulator();
  const base = {
    turn: 2,
    territories: gameState.territories,
    factions: gameState.factions,
    armies: gameState.armies,
    eventHistory: [],
    seed: 42,
  };
  const missing = sim.resolveChoice({
    ...base,
    activeEvents: [],
    activeEventInstanceId: 'nope',
    choiceId: 'import_food',
  });
  assert.ok(missing.messages[0]);
  const unknown = makeActiveEvent({
    instanceId: 'u1',
    typeId: 'not_a_real_event',
    territoryId: target.id,
    factionId: faction.id,
    choicesPending: [{ id: 'import_food', label: 'x', description: 'x', cost: { gold: 10 } }],
  });
  const unknownOut = sim.resolveChoice({
    ...base,
    activeEvents: [unknown],
    activeEventInstanceId: 'u1',
    choiceId: 'import_food',
  });
  assert.ok(unknownOut.messages.some((m) => m.toLowerCase().includes('unknown')));
  assert.strictEqual(unknownOut.mutatedFactions.get(faction.id)!.resources.gold, goldBefore);
  const resolved = makeActiveEvent({
    instanceId: 'r1',
    typeId: 'food_shortage',
    status: 'expired',
    territoryId: target.id,
    factionId: faction.id,
    choicesPending: [{ id: 'import_food', label: 'x', description: 'x', cost: { gold: 10 } }],
  });
  const resolvedOut = sim.resolveChoice({
    ...base,
    activeEvents: [resolved],
    activeEventInstanceId: 'r1',
    choiceId: 'import_food',
  });
  assert.ok(resolvedOut.messages.some((m) => m.toLowerCase().includes('not active')));
  assert.doesNotThrow(() => {
    sim.simulate({
      turn: 1,
      territories: new Map(),
      factions: new Map(),
      activeEvents: [],
      eventHistory: [],
      seed: 1,
    });
  });
});

function freezeWorld(gs: GameStateSnapshot): string {
  return JSON.stringify({
    territories: [...gs.territories.entries()].map(([id, t]) => ({
      id, owner: t.owner, garrison: t.garrison, fortification: t.fortification,
      population: t.population, neighboring: t.neighboring, resourceOutput: t.resourceOutput,
    })),
    armies: [...gs.armies.entries()].map(([id, a]) => ({
      id, owner: a.owner, location: a.location, soldiers: a.soldiers, knights: a.knights,
    })),
    factions: [...gs.factions.entries()].map(([id, f]) => ({
      id,
      territories: f.territories,
      armies: f.armies,
      resources: f.resources,
      resourceIncome: f.resourceIncome,
      reputation: f.reputation,
      stability: f.stability,
      diplomacy: [...f.diplomacy.entries()].map(([k, r]) => ({ k, state: r.state, opinion: r.opinion })),
    })),
  });
}

function scoreWorld(
  self: WarlordSnapshot,
  gameState: GameStateSnapshot,
  goals: GoalSystem,
  seed = 1,
) {
  const ctx = WarlordState.buildContext(self, gameState);
  return new ActionScorer().scoreAllActions({
    ctx,
    turn: 1,
    rng: new SeededRNG(seed),
    memory: new MemorySystem(),
    goals,
  });
}

function makeRel(target: string, state: DiplomaticRelationship['state'] = 'hostile', opinion = -50): DiplomaticRelationship {
  return {
    target,
    state,
    opinion,
    treaties: [],
    yearsAtPeace: 0,
    yearsAtWar: state === 'at_war' ? 2 : 0,
  };
}

function buildAmbitionWorld(opts: {
  ambition: number;
  personality: PersonalityType;
  threatened: boolean;
  goals?: GoalSystem;
}): { self: WarlordSnapshot; gameState: GameStateSnapshot; goals: GoalSystem } {
  const home = makeTerritory({
    id: 'home', owner: 'me', neighboring: ['empty', 'threat'], garrison: opts.threatened ? 20 : 400,
    resourceOutput: { food: 10 },
  });
  const empty = makeTerritory({
    id: 'empty', owner: null, neighboring: ['home'], garrison: 10,
    resourceOutput: { food: 40, gold: 20 },
  });
  const threat = makeTerritory({
    id: 'threat', owner: 'enemy', neighboring: ['home'],
    garrison: opts.threatened ? 4000 : 30,
    resourceOutput: { iron: 5 },
  });
  const territories = new Map<string, Territory>([['home', home], ['empty', empty], ['threat', threat]]);
  const armies = new Map<string, Army>();
  if (opts.threatened) {
    armies.set('en_army', {
      id: 'en_army', owner: 'enemy', location: 'threat',
      soldiers: 3000, knights: 200, siegeEngines: 0, morale: 80, supply: 80,
    });
  }
  armies.set('my_army', {
    id: 'my_army', owner: 'me', location: 'home',
    soldiers: opts.threatened ? 150 : 800, knights: 0, siegeEngines: 0, morale: 80, supply: 80,
  });
  const enemy = makeSelf('enemy', {
    personality: PersonalitySystem.createPreset('aggressive'),
    territories: ['threat'],
    armies: opts.threatened ? ['en_army'] : [],
    knownFactions: ['me', 'enemy'],
    knownTerritories: ['home', 'empty', 'threat'],
  });
  const self = makeSelf('me', {
    personality: PersonalitySystem.createPreset(opts.personality),
    ambition: opts.ambition,
    territories: ['home'],
    armies: ['my_army'],
    knownFactions: ['me', 'enemy'],
    knownTerritories: ['home', 'empty', 'threat'],
    diplomacy: new Map([['enemy', makeRel('enemy', 'hostile', -60)]]),
    goals: [],
  });
  const goals = opts.goals ?? new GoalSystem([
    {
      id: 'goal_0', type: 'expand_to_resources', priority: 90,
      targetFaction: null, targetTerritory: null, targetRegion: null, targetResource: 'food',
      progress: 0, targetProgress: 100, deadlineTurn: null, createdTurn: 0,
    },
    {
      id: 'goal_1', type: 'dominant_faction', priority: 70,
      targetFaction: null, targetTerritory: null, targetRegion: null, targetResource: null,
      progress: 0, targetProgress: 100, deadlineTurn: null, createdTurn: 0,
    },
  ]);
  const factions = new Map([['me', self], ['enemy', enemy]]);
  const gameState: GameStateSnapshot = {
    turn: 1, factions, territories, armies, allFactionIds: ['me', 'enemy'],
  };
  return { self, gameState, goals };
}

console.log('AI commitment & ambition — lifecycle');
test('AI with no commitment creates one', () => {
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const engine = new DecisionEngine(42);
  const ws = warlordStates.get('ashen_horde')!;
  assert.strictEqual(ws.activeCommitment, null);
  const d = engine.decide(ws, gameState, 1);
  assert.ok(d.commitment, 'decide() must return a commitment');
  assert.strictEqual(d.isNewCommitment, true);
  assert.strictEqual(d.commitment!.status, 'committed');
  assert.strictEqual(ws.activeCommitment!.id, d.commitment!.id);
  assert.ok(d.commitment!.id.startsWith('cmt_'), 'commitment id must use the deterministic cmt_ prefix');
});
test('AI with an active commitment does not select a different action every evaluation', () => {
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const engine = new DecisionEngine(42);
  const first = engine.decideAll(warlordStates, gameState, 1);
  const second = engine.decideAll(warlordStates, gameState, 2);
  assert.strictEqual(first.length, second.length);
  for (let i = 0; i < first.length; i++) {
    assert.strictEqual(second[i]!.isNewCommitment, false, `${second[i]!.warlordId} must hold, not re-decide`);
    assert.strictEqual(second[i]!.action, first[i]!.action);
    assert.strictEqual(second[i]!.targetId, first[i]!.targetId);
    assert.strictEqual(second[i]!.commitment!.id, first[i]!.commitment!.id);
  }
});
test('completed commitment allows reassessment', () => {
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const engine = new DecisionEngine(42);
  const ws = warlordStates.get('ashen_horde')!;
  const first = engine.decide(ws, gameState, 1);
  engine.completeCommitment(ws, 'done');
  assert.strictEqual(ws.activeCommitment!.status, 'completed');
  const next = engine.decide(ws, gameState, 2);
  assert.strictEqual(next.isNewCommitment, true);
  assert.notStrictEqual(next.commitment!.id, first.commitment!.id);
});
test('failed commitment allows reassessment', () => {
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const engine = new DecisionEngine(42);
  const ws = warlordStates.get('iron_kingdom')!;
  const first = engine.decide(ws, gameState, 1);
  engine.failCommitment(ws, 'failed in test');
  const next = engine.decide(ws, gameState, 2);
  assert.strictEqual(next.isNewCommitment, true);
  assert.notStrictEqual(next.commitment!.id, first.commitment!.id);
});
test('interrupted commitment allows reassessment', () => {
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const engine = new DecisionEngine(42);
  const ws = warlordStates.get('merchant_republic')!;
  const first = engine.decide(ws, gameState, 1);
  engine.interruptCommitment(ws, 'interrupted in test');
  const next = engine.decide(ws, gameState, 2);
  assert.strictEqual(next.isNewCommitment, true);
  assert.notStrictEqual(next.commitment!.id, first.commitment!.id);
});
test('invalid target fails the commitment and triggers reassessment', () => {
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const engine = new DecisionEngine(42);
  let subject: { ws: WarlordState; first: Decision } | null = null;
  for (const [id, ws] of warlordStates) {
    const d = engine.decide(ws, gameState, 1);
    if (d.targetId && gameState.territories.has(d.targetId)) {
      subject = { ws, first: d };
      void id;
      break;
    }
  }
  assert.ok(subject, 'expected at least one warlord to commit to a territory target');
  const gone = subject!.first.targetId!;
  gameState.territories.delete(gone);
  const next = engine.decide(subject!.ws, gameState, 2);
  assert.strictEqual(subject!.ws.lastTerminalCommitment!.status, 'failed');
  assert.ok((subject!.ws.lastTerminalCommitment!.statusReason ?? '').includes('no longer exists'));
  assert.strictEqual(next.isNewCommitment, true);
  assert.notStrictEqual(next.commitment!.id, subject!.first.commitment!.id);
});
test('commitment IDs are deterministic for the same seed and state', () => {
  const run1 = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const run2 = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const d1 = new DecisionEngine(42).decideAll(run1.warlordStates, run1.gameState, 1);
  const d2 = new DecisionEngine(42).decideAll(run2.warlordStates, run2.gameState, 1);
  assert.deepStrictEqual(
    d1.map((d) => ({ action: d.action, targetId: d.targetId, id: d.commitment!.id })),
    d2.map((d) => ({ action: d.action, targetId: d.targetId, id: d.commitment!.id })),
  );
});
test('different commitments in one simulation do not collide', () => {
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const engine = new DecisionEngine(42);
  const first = engine.decideAll(warlordStates, gameState, 1);
  const ids = first.map((d) => d.commitment!.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'first-wave commitment ids must be unique');
  for (const [, ws] of warlordStates)
    engine.completeCommitment(ws, 'wave1');
  const second = engine.decideAll(warlordStates, gameState, 2);
  const all = [...ids, ...second.map((d) => d.commitment!.id)];
  assert.strictEqual(new Set(all).size, all.length, 'later commitments must not reuse earlier ids');
});
test('same seed + same state produces the same decision and commitment', () => {
  const a = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 7);
  const b = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 7);
  const d1 = new DecisionEngine(7).decideAll(a.warlordStates, a.gameState, 3);
  const d2 = new DecisionEngine(7).decideAll(b.warlordStates, b.gameState, 3);
  assert.deepStrictEqual(
    d1.map((d) => ({ action: d.action, targetId: d.targetId, score: d.score, id: d.commitment!.id, status: d.commitment!.status })),
    d2.map((d) => ({ action: d.action, targetId: d.targetId, score: d.score, id: d.commitment!.id, status: d.commitment!.status })),
  );
});

console.log('AI commitment & ambition — ambition vs personality vs survival');
test('ambition affects long-term goal/action scoring when not threatened', () => {
  const low = buildAmbitionWorld({ ambition: 0.1, personality: 'expansionist', threatened: false });
  const high = buildAmbitionWorld({ ambition: 0.9, personality: 'expansionist', threatened: false });
  const lowAtk = scoreWorld(low.self, low.gameState, low.goals).find((s) => s.action === 'ATTACK');
  const highAtk = scoreWorld(high.self, high.gameState, high.goals).find((s) => s.action === 'ATTACK');
  assert.ok(lowAtk && highAtk);
  assert.ok(highAtk!.score > lowAtk!.score, 'higher ambition must raise goal-aligned ATTACK when not threatened');
  assert.ok(highAtk!.factorBreakdown.some((f) => f.factor.startsWith('Ambition')),
    'high-ambition ATTACK must expose an Ambition scoring factor');
});
test('personality and ambition remain separate factors', () => {
  const exp = buildAmbitionWorld({ ambition: 0.9, personality: 'expansionist', threatened: false });
  const def = buildAmbitionWorld({ ambition: 0.9, personality: 'defensive', threatened: false });
  const expScores = scoreWorld(exp.self, exp.gameState, exp.goals);
  const defScores = scoreWorld(def.self, def.gameState, def.goals);
  const expAtk = expScores.find((s) => s.action === 'ATTACK');
  const defAtk = defScores.find((s) => s.action === 'ATTACK');
  const expBias = expAtk!.factorBreakdown.find((f) => f.factor === 'Personality bias')!.contribution;
  const defBias = defAtk!.factorBreakdown.find((f) => f.factor === 'Personality bias')!.contribution;
  assert.ok(expBias !== defBias, 'different personalities must produce different personality-bias contributions at the same ambition');

  const lowA = buildAmbitionWorld({ ambition: 0.1, personality: 'expansionist', threatened: false });
  const highA = buildAmbitionWorld({ ambition: 0.9, personality: 'expansionist', threatened: false });
  const lowAtk = scoreWorld(lowA.self, lowA.gameState, lowA.goals).find((s) => s.action === 'ATTACK')!;
  const highAtk = scoreWorld(highA.self, highA.gameState, highA.goals).find((s) => s.action === 'ATTACK')!;
  assert.strictEqual(
    lowAtk.factorBreakdown.find((f) => f.factor === 'Personality bias')!.contribution,
    highAtk.factorBreakdown.find((f) => f.factor === 'Personality bias')!.contribution,
    'changing ambition must not change the personality-bias factor',
  );
});
test('high ambition does not apply offensive bonuses under an immediate survival threat', () => {
  const mid = buildAmbitionWorld({ ambition: 0.5, personality: 'expansionist', threatened: true });
  const high = buildAmbitionWorld({ ambition: 1.0, personality: 'expansionist', threatened: true });
  const midAtk = scoreWorld(mid.self, mid.gameState, mid.goals).find((s) => s.action === 'ATTACK')!;
  const highAtk = scoreWorld(high.self, high.gameState, high.goals).find((s) => s.action === 'ATTACK')!;
  assert.ok(!highAtk.factorBreakdown.some((f) => f.factor === 'Ambition (strategic push)'),
    'threatened ATTACK must not carry an offensive Ambition push');
  void midAtk;
  const midDef = scoreWorld(mid.self, mid.gameState, mid.goals).find((s) => s.action === 'DEFEND')!;
  const highDef = scoreWorld(high.self, high.gameState, high.goals).find((s) => s.action === 'DEFEND')!;
  assert.strictEqual(midDef.score, highDef.score, 'DEFEND must be independent of ambition');
});
test('goal data influences action selection where a valid target exists', () => {
  const withContext = GoalSystem.generateInitialGoals('aggressive', 'me', 0, new SeededRNG(1), {
    otherFactionIds: ['rival', 'friend'],
    rivalFactionIds: ['rival'],
    allianceCandidateIds: ['friend'],
  });
  const destroy = withContext.find((g) => g.type === 'destroy_rival')!;
  assert.strictEqual(destroy.targetFaction, 'rival', 'context must attach a real rival, not a fabricated unknown id');
  const goals = new GoalSystem(withContext);
  const aligned = goals.evaluateActionAlignment({
    actionType: 'ATTACK', targetFaction: 'rival', targetTerritory: 'rival_land',
    self: makeSelf('me'), currentTurn: 0, allTerritories: new Map(),
  });
  const other = goals.evaluateActionAlignment({
    actionType: 'ATTACK', targetFaction: 'friend', targetTerritory: 'friend_land',
    self: makeSelf('me'), currentTurn: 0, allTerritories: new Map(),
  });
  assert.ok(aligned.alignedGoals.some((g) => g.type === 'destroy_rival'));
  assert.ok(!other.alignedGoals.some((g) => g.type === 'destroy_rival'));
  assert.ok(aligned.scoreContribution > other.scoreContribution,
    'ATTACK on the rival named by the goal must outscore ATTACK on a non-target faction via goal alignment');

  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const ashenGoals = warlordStates.get('ashen_horde')!.goals.getAllGoals();
  const ashenDestroy = ashenGoals.find((g) => g.type === 'destroy_rival');
  assert.ok(ashenDestroy?.targetFaction, 'SimulationBuilder must pass faction context so destroy_rival is scoreable');
  assert.ok(gameState.factions.has(ashenDestroy!.targetFaction!), 'rival target must be a real faction in the built world');
});
test('AI decide/commitment does not mutate world state', () => {
  const { gameState, warlordStates } = SimulationBuilder.buildFromSpecs(SAMPLE_MAP, WARLORD_SPECS, 42);
  const before = freezeWorld(gameState);
  const engine = new DecisionEngine(42);
  const d = engine.decideAll(warlordStates, gameState, 1);
  assert.strictEqual(freezeWorld(gameState), before, 'decide() must not change territories/armies/resources/diplomacy');
  d[0]!.commitment!.status = 'failed';
  d[0]!.commitment!.reason.push('caller mutation');
  const held = engine.decide(warlordStates.get(d[0]!.warlordId)!, gameState, 1);
  assert.strictEqual(held.commitment!.status, 'committed');
  assert.ok(!held.commitment!.reason.includes('caller mutation'));
});

console.log('AI commitment & ambition — strategic RETREAT vs no-battle-retreat');
test('strategic RETREAT is repositioning off non-owned ground, not a battle-retreat mechanic', () => {
  const scorerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'scoring', 'ActionScorer.ts'), 'utf8');
  const retreatFn = scorerSrc.split('private scoreRetreat')[1]!.split('private scoreWait')[0];
  assert.ok(/loc\.owner === ctx\.self\.id/.test(retreatFn),
    'scoreRetreat must skip armies already on owned territory');
  assert.ok(!/BattleEngine/.test(retreatFn), 'scoreRetreat must not call BattleEngine');
  assert.ok(/strategic, not battle retreat/.test(retreatFn));

  const home = makeTerritory({ id: 'home', owner: 'me', neighboring: ['field', 'enemy_land'], garrison: 100 });
  const field = makeTerritory({ id: 'field', owner: null, neighboring: ['home', 'enemy_land'], garrison: 0 });
  const enemyLand = makeTerritory({ id: 'enemy_land', owner: 'enemy', neighboring: ['home', 'field'], garrison: 10 });
  const territories = new Map([['home', home], ['field', field], ['enemy_land', enemyLand]]);
  const armies = new Map<string, Army>([
    ['safe', { id: 'safe', owner: 'me', location: 'home', soldiers: 40, knights: 0, siegeEngines: 0, morale: 50, supply: 50 }],
  ]);
  const me = makeSelf('me', {
    territories: ['home'], armies: ['safe'],
    knownFactions: ['me', 'enemy'], knownTerritories: ['home', 'field', 'enemy_land'],
    diplomacy: new Map([['enemy', makeRel('enemy', 'at_war', -80)]]),
  });
  const enemyArmy: Army = {
    id: 'horde', owner: 'enemy', location: 'enemy_land',
    soldiers: 50000, knights: 0, siegeEngines: 0, morale: 80, supply: 80,
  };
  armies.set(enemyArmy.id, enemyArmy);
  const enemy = makeSelf('enemy', {
    territories: ['enemy_land'], armies: ['horde'],
    knownFactions: ['me', 'enemy'],
  });
  const gs: GameStateSnapshot = {
    turn: 1,
    factions: new Map([['me', me], ['enemy', enemy]]),
    territories, armies, allFactionIds: ['me', 'enemy'],
  };
  const ownedOnly = scoreWorld(me, gs, new GoalSystem([]));
  const retreatOwned = ownedOnly.find((s) => s.action === 'RETREAT')!;
  assert.notStrictEqual(retreatOwned.targetId, 'home',
    'an army on owned land must not be scored as a battlefield retreat off the home territory');

  armies.set('exposed', {
    id: 'exposed', owner: 'me', location: 'field',
    soldiers: 40, knights: 0, siegeEngines: 0, morale: 50, supply: 50,
  });
  me.armies = ['safe', 'exposed'];
  const exposed = scoreWorld(me, gs, new GoalSystem([]));
  const retreatExposed = exposed.find((s) => s.action === 'RETREAT')!;
  assert.strictEqual(retreatExposed.targetId, 'field',
    'strategic RETREAT targets the non-owned location the endangered army is standing on');

  const typesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'types', 'index.ts'), 'utf8');
  assert.ok(/`retreat` was removed/.test(typesSrc) || !/TerritoryOutcome = .*retreat/.test(typesSrc));
  const battleSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'battle', 'BattleEngine.ts'), 'utf8');
  assert.ok(!/territoryOutcome:\s*'retreat'/.test(battleSrc));
  assert.ok(!/\bretreat_required\b/.test(battleSrc));
});

// ============================================================
// AUTHORITATIVE RUNTIME GAMESTATE PASS — regression tests
// ============================================================
console.log('');
console.log('Authoritative runtime GameState — shape & initialization');

test('createGameState() contains the expected major state domains', () => {
  const state = createGameState({ seed: 42 });
  const keys = Object.keys(state).sort();
  const expected = [
    'activeEvents', 'activeInvasions', 'allFactionIds', 'armies', 'attackerCooldowns', 'cities', 'commitments', 'constructions',
    'definitionFormatVersion', 'definitionWorldId', 'eventHistory',
    'factions', 'lastAiDecisionTick', 'lastFoodConsumptionTick', 'level1Tutorial', 'levelAnchorTerritoryIds', 'levelDefeat', 'playerEmpirePause', 'playerFactionId', 'playerFitness', 'playerRewards', 'regions', 'schemaVersion', 'territories', 'territoryEconomy', 'territoryInfrastructure',
    'turn', 'worldLevel', 'worldName', 'worldSeed', 'worldTick',
  ].sort();
  assert.deepStrictEqual(keys, expected, 'GameState shape drifted from the documented domains');
  assert.strictEqual(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
  assert.ok(state.factions.size > 0, 'must contain at least one faction');
  assert.ok(state.territories.size > 0, 'must contain at least one territory');
  assert.ok(state.armies.size > 0, 'must contain at least one army');
  assert.strictEqual(state.definitionWorldId, 'Level 1');
  assert.ok(state.regions.size > 0);
  assert.strictEqual(state.activeEvents.length, 0);
  assert.strictEqual(state.eventHistory.length, 0);
  assert.strictEqual(state.worldTick, 0);
  assert.strictEqual(state.lastFoodConsumptionTick, 0);
  assert.strictEqual(state.lastAiDecisionTick.size, 0);
  assert.strictEqual(state.territoryInfrastructure.size, state.territories.size);
  assert.strictEqual(state.playerRewards.bankedTroops, 0);
  assert.strictEqual(state.playerRewards.pendingConstructionEffects.length, 0);
  assert.strictEqual(state.playerRewards.pendingGoldenYieldEffects.length, 0);
  assert.strictEqual(state.playerRewards.appliedRewards.length, 0);
  assert.strictEqual(state.activeInvasions.size, 0);
});

test('createGameState() seeds one null commitment per faction', () => {
  const state = createGameState({ seed: 7 });
  assert.strictEqual(state.commitments.size, state.allFactionIds.length);
  for (const fid of state.allFactionIds) {
    assert.ok(state.commitments.has(fid), `commitments must have an entry for ${fid}`);
    assert.strictEqual(state.commitments.get(fid), null, `${fid} must start with no active commitment`);
  }
});

test('createGameState() is deterministic: same seed produces an equivalent GameState', () => {
  const a = createGameState({ seed: 1234 });
  const b = createGameState({ seed: 1234 });
  assert.deepStrictEqual(a, b, 'same seed must produce a structurally identical GameState');
});

test('createGameState() allows different seeds to produce different GameStates', () => {
  const a = createGameState({ seed: 1 });
  const b = createGameState({ seed: 2 });
  assert.notStrictEqual(a.worldSeed, b.worldSeed);
});

test('createGameState() respects a custom playerFactionId', () => {
  const state = createLegacySampleMapGameState({ seed: 1, playerFactionId: 'iron_kingdom' });
  assert.strictEqual(state.playerFactionId, 'iron_kingdom');
  assert.ok(state.factions.has(state.playerFactionId!), 'playerFactionId must reference a real faction');
});

console.log('Authoritative runtime GameState — structural invariants');

test('a freshly created GameState has zero invariant violations', () => {
  const state = createGameState({ seed: 42 });
  const violations = checkGameStateInvariants(state);
  assert.deepStrictEqual(violations, [], `expected no violations, got: ${JSON.stringify(violations)}`);
  assert.ok(isGameStateStructurallyValid(state));
});

test('invariants catch an army with an unknown owner', () => {
  const state = createGameState({ seed: 42 });
  const clone = cloneGameState(state);
  const [army] = clone.armies.values();
  army!.owner = 'no_such_faction';
  const violations = checkGameStateInvariants(clone);
  assert.ok(violations.some((v) => v.code === 'army.invalid_owner'));
  // Mutating the clone must never affect the source.
  assert.notStrictEqual([...state.armies.values()][0]!.owner, 'no_such_faction');
});

test('invariants catch an army with an unknown location', () => {
  const state = createGameState({ seed: 42 });
  const clone = cloneGameState(state);
  const [army] = clone.armies.values();
  army!.location = 'no_such_territory';
  const violations = checkGameStateInvariants(clone);
  assert.ok(violations.some((v) => v.code === 'army.invalid_location'));
});

test('invariants catch negative troop counts', () => {
  const state = createGameState({ seed: 42 });
  const clone = cloneGameState(state);
  const [army] = clone.armies.values();
  army!.soldiers = -5;
  const violations = checkGameStateInvariants(clone);
  assert.ok(violations.some((v) => v.code === 'army.negative_troops'));
});

test('invariants catch a defeated (0-troop) army left in the canonical armies map', () => {
  const state = createGameState({ seed: 42 });
  const clone = cloneGameState(state);
  const [army] = clone.armies.values();
  army!.soldiers = 0;
  army!.knights = 0;
  army!.siegeEngines = 0;
  const violations = checkGameStateInvariants(clone);
  assert.ok(violations.some((v) => v.code === 'army.defeated_but_present'));
});

test('invariants catch a territory owned by an unknown faction', () => {
  const state = createGameState({ seed: 42 });
  const clone = cloneGameState(state);
  const [territory] = clone.territories.values();
  territory!.owner = 'no_such_faction';
  const violations = checkGameStateInvariants(clone);
  assert.ok(violations.some((v) => v.code === 'territory.invalid_owner'));
});

test('invariants catch a faction listing a territory it does not own', () => {
  const state = createGameState({ seed: 42 });
  const clone = cloneGameState(state);
  const [faction] = clone.factions.values();
  const foreignOwnedTerritory = [...clone.territories.values()].find((t) => t.owner !== faction!.id);
  assert.ok(foreignOwnedTerritory, 'fixture must have at least one territory not owned by the first faction');
  faction!.territories.push(foreignOwnedTerritory!.id);
  const violations = checkGameStateInvariants(clone);
  assert.ok(violations.some((v) => v.code === 'faction.territory_owner_mismatch'));
});

test('invariants catch an active commitment with an invalid target', () => {
  const state = createGameState({ seed: 42 });
  const clone = cloneGameState(state);
  const [fid] = clone.allFactionIds;
  const [victimTerritoryId] = clone.territories.keys();
  clone.commitments.set(fid!, {
    id: 'cmt_test', warlordId: fid!, action: 'ATTACK', targetId: victimTerritoryId!, targetName: null,
    status: 'committed', createdTurn: 0, originatingGoalId: null, reason: [], priority: 0, score: 0,
    confidence: 0, personalityBias: 0, ambitionInfluence: 0, factorBreakdown: [], statusReason: null,
  });
  // ATTACK on a territory the same faction already owns (or that is
  // unowned) is not a valid attack target — reuses `validateCommitmentTarget`.
  const t = clone.territories.get(victimTerritoryId!)!;
  t.owner = fid!;
  const violations = checkGameStateInvariants(clone);
  assert.ok(violations.some((v) => v.code === 'commitment.invalid_target'));
});

test('invariants catch an active event referencing an unknown territory/faction', () => {
  const state = createGameState({ seed: 42 });
  const clone = cloneGameState(state);
  clone.activeEvents.push({
    instanceId: 'evt_test', typeId: 'drought', category: 'environmental', title: 'x', description: 'x',
    causes: [], severity: 'minor', status: 'active', territoryId: 'no_such_territory', factionId: 'no_such_faction',
    triggeredTurn: 0, durationTurns: 1, startedTurn: 0, expiresTurn: 1, consequences: [], chainDelays: [],
    choicesPending: [],
  });
  const violations = checkGameStateInvariants(clone);
  assert.ok(violations.some((v) => v.code === 'event.invalid_territory'));
  assert.ok(violations.some((v) => v.code === 'event.invalid_faction'));
});

test('invariants catch an invalid lastFoodConsumptionTick', () => {
  const state = cloneGameState(createGameState({ seed: 42 }));
  state.lastFoodConsumptionTick = -1;
  assert.ok(checkGameStateInvariants(state).some((v) => v.code === 'economy.invalid_food_consumption_tick'));
});

test('invariants catch malformed territoryInfrastructure', () => {
  const state = cloneGameState(createGameState({ seed: 42 }));
  const [tid] = state.territories.keys();
  state.territoryInfrastructure.get(tid!)!.farmCompletedAtTick = -3;
  assert.ok(checkGameStateInvariants(state).some((v) => v.code === 'infrastructure.invalid_completed_tick'));
  state.territoryInfrastructure.get(tid!)!.farmCompletedAtTick = null;
  state.territoryInfrastructure.set('bogus', {
    territoryId: 'bogus',
    farmCompletedAtTick: null,
    mineCompletedAtTick: null,
    lumberCompletedAtTick: null,
  });
  assert.ok(checkGameStateInvariants(state).some((v) => v.code === 'infrastructure.invalid_territory'));
});

console.log('Authoritative runtime GameState — cloning / snapshot isolation');

test('cloneGameState produces a deep copy that shares no mutable nested state', () => {
  const source = createGameState({ seed: 42 });
  source.activeEvents.push({
    instanceId: 'evt_src', typeId: 'drought', category: 'environmental', title: 'src', description: 'src',
    causes: ['x'], severity: 'minor', status: 'active', territoryId: null, factionId: null,
    triggeredTurn: 0, durationTurns: 3, startedTurn: 0, expiresTurn: 3,
    consequences: [{ delta: { resources: { gold: 5 } }, message: 'm' }],
    chainDelays: [{ toEventId: 'y', delayRemaining: 1, probability: 0.5, severity: 'minor' }],
    choicesPending: [{ id: 'c1', label: 'l', description: 'd', cost: { gold: 1 } }],
  });
  const [fid] = source.allFactionIds;
  source.lastAiDecisionTick.set(fid!, 3);
  source.commitments.set(fid!, {
    id: 'cmt_src', warlordId: fid!, action: 'WAIT', targetId: null, targetName: null, status: 'committed',
    createdTurn: 0, originatingGoalId: null, reason: ['r1'], priority: 0, score: 0, confidence: 0,
    personalityBias: 0, ambitionInfluence: 0, factorBreakdown: [{ factor: 'f', weight: 1, contribution: 1 }],
    statusReason: null,
  });
  const [tid] = source.territories.keys();
  const attackerId = source.allFactionIds.find((id) => id !== fid) ?? fid!;
  source.playerRewards.bankedTroops = 12;
  source.playerRewards.pendingConstructionEffects.push({
    applicationId: 'app_src',
    sessionId: 'wses_src',
    workoutId: 'wk_src',
    playerId: 'player_1',
    workerPower: 3,
    permanence: 'TEMPORARY_ACCELERATION',
    appliedAtTick: 0,
    sourcePhysicalOutput: 12,
  });
  source.activeInvasions.set('inv_src', createActiveInvasion({
    id: 'inv_src',
    defenderFactionId: fid!,
    attackerFactionId: attackerId,
    territoryId: tid!,
    startedAtTick: 0,
    notifiedAtTick: 0,
    responseDeadlineTick: 30,
  }));

  const clone = cloneGameState(source);
  assert.deepStrictEqual(clone, source, 'a fresh clone must be deep-equal to its source');

  // Mutate every kind of nested structure on the clone.
  const [cloneTerritory] = clone.territories.values();
  cloneTerritory!.neighboring.push('mutated');
  cloneTerritory!.resourceOutput.gold = 999999;
  const [cloneArmy] = clone.armies.values();
  cloneArmy!.soldiers = 999999;
  const [cloneFaction] = clone.factions.values();
  cloneFaction!.resources.gold = 999999;
  cloneFaction!.territories.push('mutated');
  cloneFaction!.memory.push({ id: 'mem_mutated', turn: 0, type: 'attack_made', withFaction: null, territory: null, magnitude: 1, details: {} });
  cloneFaction!.goals.push({ id: 'goal_mutated', type: 'economic_growth', priority: 1, targetFaction: null, targetTerritory: null, targetRegion: null, targetResource: null, progress: 0, targetProgress: 1, deadlineTurn: null, createdTurn: 0 });
  for (const rel of cloneFaction!.diplomacy.values()) {
    rel.opinion = -999;
    break;
  }
  clone.commitments.get(fid!)!.reason.push('mutated');
  clone.commitments.set('mutated_key', null);
  clone.lastAiDecisionTick.set(fid!, 99);
  clone.worldTick = 999;
  clone.activeEvents[0]!.status = 'expired';
  clone.activeEvents[0]!.causes.push('mutated');
  clone.activeEvents[0]!.consequences[0]!.message = 'mutated';
  clone.activeEvents.push({ ...clone.activeEvents[0]!, instanceId: 'evt_extra' });
  clone.allFactionIds.push('mutated_faction');
  const [regionId] = clone.regions.keys();
  if (regionId) clone.regions.get(regionId)!.territoryIds.push('mutated');
  clone.playerRewards.bankedTroops = 99;
  clone.playerRewards.pendingConstructionEffects[0]!.workerPower = 99;
  clone.activeInvasions.get('inv_src')!.defenseMobilization = {
    applicationId: 'app_mut',
    sessionId: 'wses_mut',
    workoutId: 'wk_mut',
    playerId: 'player_x',
    defensePower: 50,
    attachedAtTick: 1,
    workoutStartedAtTick: 1,
    sourcePhysicalOutput: 50,
  };
  const [cloneCity] = clone.cities.values();
  if (cloneCity) {
    cloneCity.factionId = 'mutated_faction';
    cloneCity.buildings.push({ type: 'FORTIFICATION', level: 9, completedAtTick: 1 });
  }
  const [cloneEcon] = clone.territoryEconomy.values();
  if (cloneEcon) {
    cloneEcon.uncollected.gold = 999999;
    cloneEcon.lastAccrualTick = 999;
  }
  clone.lastFoodConsumptionTick = 999;
  if (clone.level1Tutorial) clone.level1Tutorial.beat = 'COMPLETE';
  const [cloneInfra] = clone.territoryInfrastructure.values();
  if (cloneInfra) {
    cloneInfra.farmCompletedAtTick = 999;
    cloneInfra.mineCompletedAtTick = 999;
    cloneInfra.lumberCompletedAtTick = 999;
  }

  // The original `source` must be completely unaffected.
  assert.strictEqual([...source.territories.values()][0]!.neighboring.includes('mutated'), false);
  assert.notStrictEqual([...source.territories.values()][0]!.resourceOutput.gold, 999999);
  assert.notStrictEqual([...source.armies.values()][0]!.soldiers, 999999);
  assert.notStrictEqual([...source.factions.values()][0]!.resources.gold, 999999);
  assert.strictEqual([...source.factions.values()][0]!.territories.includes('mutated'), false);
  assert.strictEqual([...source.factions.values()][0]!.memory.some((m) => m.id === 'mem_mutated'), false);
  assert.strictEqual([...source.factions.values()][0]!.goals.some((g) => g.id === 'goal_mutated'), false);
  for (const rel of [...source.factions.values()][0]!.diplomacy.values()) {
    assert.notStrictEqual(rel.opinion, -999);
  }
  assert.strictEqual(source.commitments.get(fid!)!.reason.includes('mutated'), false);
  assert.strictEqual(source.commitments.has('mutated_key'), false);
  assert.strictEqual(source.lastAiDecisionTick.get(fid!), 3);
  assert.strictEqual(source.worldTick, 0);
  assert.strictEqual(source.activeEvents[0]!.status, 'active');
  assert.strictEqual(source.activeEvents[0]!.causes.includes('mutated'), false);
  assert.strictEqual(source.activeEvents[0]!.consequences[0]!.message, 'm');
  assert.strictEqual(source.activeEvents.length, 1);
  assert.strictEqual(source.allFactionIds.includes('mutated_faction'), false);
  assert.strictEqual(source.playerRewards.bankedTroops, 12);
  assert.strictEqual(source.playerRewards.pendingConstructionEffects[0]!.workerPower, 3);
  assert.strictEqual(source.activeInvasions.get('inv_src')!.defenseMobilization, null);
  assert.notStrictEqual([...source.cities.values()][0]?.factionId, 'mutated_faction');
  assert.notStrictEqual([...source.territoryEconomy.values()][0]?.uncollected.gold, 999999);
  assert.strictEqual(source.lastFoodConsumptionTick, 0);
  assert.notStrictEqual(source.level1Tutorial?.beat, 'COMPLETE');
  assert.strictEqual([...source.territoryInfrastructure.values()][0]?.farmCompletedAtTick, null);
});

test('cloneGameState output still satisfies structural invariants', () => {
  const state = createGameState({ seed: 9 });
  const clone = cloneGameState(state);
  assert.deepStrictEqual(checkGameStateInvariants(clone), []);
});

console.log('Authoritative runtime GameState — engine adapters & AI commitment sync');

test('toDecisionEngineSnapshot exposes the exact slice DecisionEngine needs', () => {
  const state = createGameState({ seed: 3 });
  const snap = toDecisionEngineSnapshot(state);
  assert.strictEqual(snap.turn, state.turn);
  assert.strictEqual(snap.factions, state.factions, 'must be the same live reference, not a copy');
  assert.strictEqual(snap.territories, state.territories);
  assert.strictEqual(snap.armies, state.armies);
  assert.strictEqual(snap.allFactionIds, state.allFactionIds);
});

test('toWorldStepInput exposes the exact slice WorldSimulator needs', () => {
  const state = createGameState({ seed: 3 });
  const input = toWorldStepInput(state);
  assert.strictEqual(input.turn, state.turn);
  assert.strictEqual(input.seed, state.worldSeed);
  assert.strictEqual(input.territories, state.territories);
  assert.strictEqual(input.factions, state.factions);
  assert.strictEqual(input.activeEvents, state.activeEvents);
  assert.strictEqual(input.eventHistory, state.eventHistory);
  assert.strictEqual(input.playerFactionId, state.playerFactionId);
});

test('buildWarlordStates + DecisionEngine.decideAll + syncCommitmentsFromWarlordStates round-trips through GameState', () => {
  const state = createGameState({ seed: 42 });
  const warlordStates = buildWarlordStates(state);
  assert.strictEqual(warlordStates.size, state.allFactionIds.length);
  for (const ws of warlordStates.values()) {
    assert.strictEqual(ws.activeCommitment, null, 'fresh GameState has no commitments to seed from');
  }

  const engine = new DecisionEngine(42);
  const snapshot = toDecisionEngineSnapshot(state);
  engine.decideAll(warlordStates, snapshot, 1);
  syncCommitmentsFromWarlordStates(state, warlordStates);

  for (const fid of state.allFactionIds) {
    const commitment = state.commitments.get(fid);
    assert.ok(commitment, `${fid} must have a commitment recorded in GameState after decide + sync`);
    assert.strictEqual(commitment!.warlordId, fid);
    // Must be an independent clone, not the same object `warlordStates` holds.
    assert.notStrictEqual(commitment, warlordStates.get(fid)!.activeCommitment);
  }
  assert.deepStrictEqual(checkGameStateInvariants(state), [], 'GameState must remain structurally valid after a real decide() round-trip');

  // Rebuilding WarlordStates from the now-populated GameState must pick up
  // the same commitments rather than resetting them to null.
  const rebuilt = buildWarlordStates(state);
  for (const fid of state.allFactionIds) {
    assert.strictEqual(rebuilt.get(fid)!.activeCommitment?.id, state.commitments.get(fid)!.id);
  }
});

test('a real WorldSimulator turn step against toWorldStepInput(state) does not mutate the GameState', () => {
  const state = createLegacySampleMapGameState({ seed: 11, playerFactionId: 'iron_kingdom' });
  const before = cloneGameState(state);
  const sim = new WorldSimulator();
  const input = toWorldStepInput(state);
  const output = sim.simulate(input);
  assert.deepStrictEqual(state, before, 'WorldSimulator.simulate must not mutate the GameState it was handed a view of');
  assert.ok(output.mutatedTerritories.size > 0);
  assert.ok(output.mutatedFactions.size > 0);
});

console.log('Authoritative runtime GameState — no hidden second world (spot check)');

test('createGameState uses authored WorldDefinition resources, not SAMPLE_MAP', () => {
  const state = createGameState({ seed: 42 });
  assert.strictEqual(state.definitionWorldId, 'Level 1');
  assert.deepStrictEqual(state.factions.get('f_player')!.resources, {
    gold: 400, food: 400, iron: 80, wood: 80, stone: 80,
  });
});

function buildOrchestratorAttackScenario(): { orchestrator: Orchestrator; attackerId: FactionId; defenderId: FactionId } {
  const attackerId = 'atk_faction';
  const defenderId = 'def_faction';
  const { gameState: snap } = buildTwoFactionScenario({
    attackerId,
    defenderId,
    atkArmySoldiers: 500,
    frontGarrison: 20,
  });
  const commitments = new Map<FactionId, null>();
  for (const fid of snap.allFactionIds) commitments.set(fid, null);
  const state: GameState = {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    turn: snap.turn,
    ...emptyWorldClock(),
    ...emptyRewardApplicationState(),
    worldSeed: 42,
    factions: snap.factions,
    allFactionIds: [...snap.allFactionIds],
    playerFactionId: attackerId,
    territories: snap.territories,
    ...authoredWorldFields(snap.territories),
    armies: snap.armies,
    commitments,
    activeEvents: [],
    eventHistory: [],
  };
  return { orchestrator: new Orchestrator(state, createDefaultRegistry()), attackerId, defenderId };
}

function cmdReq(commandId: string, playerId: string, parameters: Record<string, unknown> = {}): CommandRequest {
  return { commandId, playerId, requestId: `${commandId}_test`, parameters };
}

console.log('Orchestrator foundation — routing & read-only commands');

test('valid command routes correctly (GET_COMMAND_INDEX)', () => {
  const orch = new Orchestrator(createGameState({ seed: 1 }));
  const res = orch.execute(cmdReq('GET_COMMAND_INDEX', 'player_1'));
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.commandId, 'GET_COMMAND_INDEX');
  assert.ok((res.payload.summary as { count: number }).count >= 10);
});

test('invalid command returns INVALID_COMMAND', () => {
  const orch = new Orchestrator(createGameState({ seed: 1 }));
  const res = orch.execute(cmdReq('NOT_A_REAL_COMMAND', 'player_1'));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errors[0]!.code, ErrorCode.INVALID_COMMAND);
});

test('unsupported command returns FEATURE_NOT_IMPLEMENTED', () => {
  const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 1, playerFactionId: 'merchant_republic' }));
  const res = orch.execute(cmdReq('TRADE', 'player_1', { targetFactionId: 'iron_kingdom' }));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errors[0]!.code, ErrorCode.FEATURE_NOT_IMPLEMENTED);
});

test('GET_GAME_STATE does not mutate authoritative state', () => {
  const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 5, playerFactionId: 'merchant_republic' }));
  const before = cloneGameState(orch.getState());
  const res = orch.execute(cmdReq('GET_GAME_STATE', 'player_1'));
  assert.strictEqual(res.success, true);
  assert.deepStrictEqual(orch.getState(), before);
});

test('GET_VISIBLE_WORLD does not mutate authoritative state', () => {
  const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 5, playerFactionId: 'merchant_republic' }));
  const before = cloneGameState(orch.getState());
  const res = orch.execute(cmdReq('GET_VISIBLE_WORLD', 'player_1'));
  assert.strictEqual(res.success, true);
  assert.deepStrictEqual(orch.getState(), before);
});

console.log('Orchestrator foundation — ATTACK / economy commands');

test('ATTACK calls BattleEngine and orchestrator does not duplicate battle math', () => {
  const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'handlers.ts'), 'utf8');
  const attackSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'army', 'strategicAttack.ts'), 'utf8');
  assert.ok(handlerSrc.includes('startStrategicAttack'));
  assert.ok(/battle\.resolve\(/.test(attackSrc));
  assert.ok(!/computeWinProbability|computeCasualtyRates/.test(handlerSrc));
  assert.ok(!/computeWinProbability|computeCasualtyRates/.test(attackSrc));
});

test('successful ATTACK updates GameState correctly (integration)', () => {
  const { orchestrator, attackerId } = buildOrchestratorAttackScenario();
  const beforeOwner = orchestrator.getState().territories.get('front')!.owner;
  const res = orchestrator.execute(cmdReq('ATTACK', 'player_1', { territoryId: 'front', factionId: attackerId, seed: 42 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.notStrictEqual(orchestrator.getState().territories.get('front')!.owner, beforeOwner);
  assert.ok(res.territoriesChanged.some((c) => c.field === 'owner'));
  assert.ok(res.events.some((e) => e.kind === 'battle'));
  assert.deepStrictEqual(checkGameStateInvariants(orchestrator.getState()), []);
});

test('failed/invalid ATTACK leaves state unchanged', () => {
  const { orchestrator, attackerId } = buildOrchestratorAttackScenario();
  const before = cloneGameState(orchestrator.getState());
  const res = orchestrator.execute(cmdReq('ATTACK', 'player_1', { territoryId: 'home', factionId: attackerId }));
  assert.strictEqual(res.success, false);
  assert.deepStrictEqual(orchestrator.getState(), before);
});

test('BUILD starts timed fortification using construction definition cost', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  plantOwnedCities(state);
  const fid = 'merchant_republic';
  const owned = state.factions.get(fid)!.territories[0]!;
  const t0 = state.territories.get(owned)!;
  const fortBefore = t0.fortification;
  const goldBefore = state.factions.get(fid)!.resources.gold;
  const { gold: costG, stone: costS } = BALANCE.territory.fortificationCostPerLevel;
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('BUILD', 'player_1', { territoryId: owned, factionId: fid }));
  assert.strictEqual(res.success, true);
  assert.strictEqual(orch.getState().territories.get(owned)!.fortification, fortBefore);
  assert.strictEqual(orch.getState().factions.get(fid)!.resources.gold, goldBefore - costG);
  assert.ok(res.resourcesChanged.some((r) => r.resource === 'stone' && r.from - r.to === costS));
  const adv = orch.execute(cmdReq('ADVANCE_WORLD', 'player_1', { elapsedTicks: GAMEPLAY_CONFIG.defaultConstructionDurationTicks }));
  assert.strictEqual(adv.success, true);
  assert.strictEqual(orch.getState().territories.get(owned)!.fortification, fortBefore + 1);
});

test('REINFORCE uses centralized BALANCE reinforcement cost', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'iron_kingdom' });
  const fid = 'iron_kingdom';
  const owned = state.factions.get(fid)!.territories[0]!;
  const garBefore = state.territories.get(owned)!.garrison;
  const { gold: costG, food: costF, garrisonGain } = BALANCE.economy.reinforcementCost;
  const goldBefore = state.factions.get(fid)!.resources.gold;
  const foodBefore = state.factions.get(fid)!.resources.food;
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('REINFORCE', 'player_1', { territoryId: owned, factionId: fid }));
  assert.strictEqual(res.success, true);
  assert.strictEqual(orch.getState().territories.get(owned)!.garrison, garBefore + garrisonGain);
  assert.strictEqual(orch.getState().factions.get(fid)!.resources.gold, goldBefore - costG);
  assert.strictEqual(orch.getState().factions.get(fid)!.resources.food, foodBefore - costF);
});

test('insufficient resources leaves state unchanged on BUILD', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  plantOwnedCities(state);
  const fid = 'merchant_republic';
  const owned = state.factions.get(fid)!.territories[0]!;
  state.factions.get(fid)!.resources.gold = 0;
  const before = cloneGameState(state);
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('BUILD', 'player_1', { territoryId: owned, factionId: fid }));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errors[0]!.code, ErrorCode.INSUFFICIENT_RESOURCES);
  assert.deepStrictEqual(orch.getState(), before);
});

test('GameState invariants run after state-changing commands', () => {
  const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
  const fid = 'merchant_republic';
  const owned = orch.getState().factions.get(fid)!.territories[0]!;
  const res = orch.execute(cmdReq('REINFORCE', 'player_1', { territoryId: owned, factionId: fid }));
  assert.strictEqual(res.success, true);
  assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
});

test('invalid final state is rejected by transaction (no partial commit)', () => {
  const state = createGameState({ seed: 42 });
  assert.throws(() => {
    runStateTransaction(state, (draft) => {
      const [army] = draft.armies.values();
      army!.soldiers = -1;
      return {
        stateChanges: [], events: [], notifications: [], presentation: null,
        resourcesChanged: [], territoriesChanged: [], armiesChanged: [],
        newlyAvailableActions: [], payload: {},
      };
    });
  }, (err: unknown) => err instanceof OrchestrationError && err.code === ErrorCode.INVALID_GAME_STATE);
});

console.log('Orchestrator foundation — determinism & world step');

test('deterministic command replay for ATTACK', () => {
  const a = buildOrchestratorAttackScenario();
  const b = buildOrchestratorAttackScenario();
  const req = cmdReq('ATTACK', 'player_1', { territoryId: 'front', factionId: a.attackerId, seed: 99 });
  const ra = a.orchestrator.execute(req);
  const rb = b.orchestrator.execute(req);
  assert.strictEqual(ra.success, true);
  assert.strictEqual(rb.success, true);
  assert.deepStrictEqual(ra.payload.battleResult, rb.payload.battleResult);
  assert.deepStrictEqual(a.orchestrator.getState(), b.orchestrator.getState());
});

test('command response accurately reports resource spend on BUILD alias', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  plantOwnedCities(state);
  const fid = 'merchant_republic';
  const owned = state.factions.get(fid)!.territories[0]!;
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('BUILD', 'player_1', { territoryId: owned, factionId: fid }));
  assert.ok(res.resourcesChanged.some((r) => r.resource === 'gold'));
  assert.ok(res.resourcesChanged.some((r) => r.resource === 'stone'));
  assert.ok(res.payload.constructionId);
  assert.ok(res.stateChanges.some((c) => c.entity === 'territory'));
});

test('ADVANCE_WORLD applies WorldSimulator result without a second authoritative state object', () => {
  const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 77, playerFactionId: 'merchant_republic' }));
  const turnBefore = orch.getState().turn;
  const tickBefore = orch.getState().worldTick;
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'player_1'));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(orch.getState().turn, turnBefore + 1);
  assert.strictEqual(orch.getState().worldTick, tickBefore + 1);
  assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
  assert.ok(res.payload.worldAdvance);
});

test('AI_DECIDE updates commitments without mutating territories/armies maps', () => {
  const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
  const terrBefore = cloneGameState(orch.getState()).territories;
  const armiesBefore = cloneGameState(orch.getState()).armies;
  const res = orch.execute(cmdReq('AI_DECIDE', 'player_1', { warlordId: 'ashen_horde' }));
  assert.strictEqual(res.success, true);
  assert.deepStrictEqual(orch.getState().territories, terrBefore);
  assert.deepStrictEqual(orch.getState().armies, armiesBefore);
  assert.ok(orch.getState().commitments.get('ashen_horde'));
});

function snapshotToGameState(snap: GameStateSnapshot, playerFactionId: FactionId | null, worldSeed = 42): GameState {
  const commitments = new Map<FactionId, AICommitment | null>();
  for (const fid of snap.allFactionIds) commitments.set(fid, null);
  return {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    turn: snap.turn,
    ...emptyWorldClock(),
    ...emptyRewardApplicationState(),
    worldSeed,
    factions: snap.factions,
    allFactionIds: [...snap.allFactionIds],
    playerFactionId,
    territories: snap.territories,
    ...authoredWorldFields(snap.territories),
    armies: snap.armies,
    commitments,
    activeEvents: [],
    eventHistory: [],
  };
}

function buildParityBattleState(playerFactionId: FactionId | null, withSpectator = false): GameState {
  const attackerId = 'atk_faction';
  const defenderId = 'def_faction';
  const { gameState: snap } = buildTwoFactionScenario({
    attackerId, defenderId, atkArmySoldiers: 500, frontGarrison: 20,
  });
  if (withSpectator) {
    snap.factions.set('spectator', makeSelf('spectator', { territories: ['camp'] }));
    snap.territories.set('camp', makeTerritory({ id: 'camp', owner: 'spectator', neighboring: [], garrison: 10 }));
    snap.allFactionIds = [...snap.allFactionIds, 'spectator'];
  }
  return snapshotToGameState(snap, playerFactionId);
}

function makeAttackCommitment(warlordId: FactionId, targetId: string): AICommitment {
  return {
    id: `cmt_${warlordId}_${targetId}`,
    warlordId,
    action: 'ATTACK',
    targetId,
    targetName: targetId,
    status: 'committed',
    createdTurn: 1,
    originatingGoalId: null,
    reason: ['test'],
    priority: 100,
    score: 100,
    confidence: 1,
    personalityBias: 0,
    ambitionInfluence: 0,
    factorBreakdown: [],
    statusReason: null,
  };
}

class RecordingBattleEngine extends BattleEngine {
  readonly inputs: BattleInput[] = [];
  resolve(input: BattleInput) {
    this.inputs.push(input);
    return super.resolve(input);
  }
}

console.log('Player/AI interaction architecture — participant parity');

test('Player → AI ATTACK routes through BattleEngine', () => {
  const battle = new RecordingBattleEngine();
  const reg = createDefaultRegistry();
  reg.registerBattle(battle);
  const orch = new Orchestrator(buildParityBattleState('atk_faction'), reg);
  const res = orch.execute(cmdReq('ATTACK', 'player_1', { territoryId: 'front', seed: 42 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(battle.inputs.length, 1);
  assert.strictEqual(battle.inputs[0]!.attackerFactionId, 'atk_faction');
  assert.strictEqual(battle.inputs[0]!.defenderFactionId, 'def_faction');
  assert.strictEqual(res.payload.interactionKind, 'player_vs_ai');
  assert.ok(res.payload.battleResult);
});

test('AI → Player ATTACK creates an invasion instead of resolving immediately', () => {
  const battle = new RecordingBattleEngine();
  const reg = createDefaultRegistry();
  reg.registerBattle(battle);
  const state = buildParityBattleState('def_faction');
  state.commitments.set('atk_faction', makeAttackCommitment('atk_faction', 'front'));
  const orch = new Orchestrator(state, reg);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'player_1', { factionId: 'atk_faction', seed: 42 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(battle.inputs.length, 0, 'BattleEngine waits for the defense window');
  assert.strictEqual(res.payload.attackOutcome, 'invasion_created');
  assert.ok(res.payload.invasionId);
  assert.strictEqual(orch.getState().activeInvasions.size, 1);
  assert.strictEqual(orch.getState().territories.get('front')!.owner, 'def_faction');
});

test('AI → AI ATTACK uses the same BattleEngine path', () => {
  const battle = new RecordingBattleEngine();
  const reg = createDefaultRegistry();
  reg.registerBattle(battle);
  const state = buildParityBattleState('spectator', true);
  state.commitments.set('atk_faction', makeAttackCommitment('atk_faction', 'front'));
  const orch = new Orchestrator(state, reg);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'player_1', { factionId: 'atk_faction', seed: 42 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(battle.inputs.length, 1);
  assert.strictEqual(res.payload.interactionKind, 'ai_vs_ai');
  assert.strictEqual(
    classifyFactionInteraction('spectator', 'atk_faction', 'def_faction'),
    'ai_vs_ai',
  );
});

test('no duplicate player-vs-AI battle formula exists; all pairings share BattleResult', () => {
  const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'handlers.ts'), 'utf8');
  const orchSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'orchestrator.ts'), 'utf8');
  const deSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'DecisionEngine.ts'), 'utf8');
  assert.ok(!/computeWinProbability|computeCasualtyRates/.test(handlerSrc));
  assert.ok(!/computeWinProbability|computeCasualtyRates/.test(orchSrc));
  assert.ok(!/computeWinProbability|computeCasualtyRates/.test(deSrc));
  assert.ok(!/playerBattle|aiBattle|PlayerBattle|AIBattle/.test(handlerSrc));

  const runPlayer = () => {
    const orch = new Orchestrator(buildParityBattleState('atk_faction'));
    return orch.execute(cmdReq('ATTACK', 'player_1', { territoryId: 'front', seed: 42 }));
  };
  const runAi = (player: FactionId, spectator: boolean) => {
    const state = buildParityBattleState(player, spectator);
    state.commitments.set('atk_faction', makeAttackCommitment('atk_faction', 'front'));
    const orch = new Orchestrator(state);
    return orch.execute(cmdReq('RESOLVE_COMMITMENT', 'player_1', { factionId: 'atk_faction', seed: 42 }));
  };
  const pva = runPlayer();
  const aia = runAi('spectator', true);
  assert.strictEqual(pva.success && aia.success, true);
  assert.deepStrictEqual(pva.payload.battleResult, aia.payload.battleResult);
  const invasionRes = runAi('def_faction', false);
  assert.strictEqual(invasionRes.success, true);
  assert.strictEqual(invasionRes.payload.attackOutcome, 'invasion_created');
  assert.ok(!invasionRes.payload.battleResult);
});

test('player and AI share the same territory / army GameState representation after battle', () => {
  const orch = new Orchestrator(buildParityBattleState('atk_faction'));
  const res = orch.execute(cmdReq('ATTACK', 'player_1', { territoryId: 'front', seed: 42 }));
  assert.strictEqual(res.success, true);
  const st = orch.getState();
  const front = st.territories.get('front')!;
  const br = res.payload.battleResult as { territoryId: string; attacker: { factionId: string } };
  assert.strictEqual(br.territoryId, 'front');
  assert.strictEqual(front.id, br.territoryId);
  assert.ok(st.factions.has(br.attacker.factionId));
  assert.ok(st.armies.size >= 0);
  assert.deepStrictEqual(checkGameStateInvariants(st), []);
});

test('event rules are participant-agnostic (WorldSimulator does not branch on playerFactionId)', () => {
  const simSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'events', 'WorldSimulator.ts'), 'utf8');
  const defSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'events', 'EventDefinitions.ts'), 'utf8');
  assert.ok(!/playerFactionId/.test(simSrc), 'WorldSimulator must not branch event rules on playerFactionId');
  assert.ok(!/playerFactionId/.test(defSrc));
  const a = createLegacySampleMapGameState({ seed: 99, playerFactionId: 'merchant_republic' });
  const b = createLegacySampleMapGameState({ seed: 99, playerFactionId: 'ashen_horde' });
  const outA = new WorldSimulator().simulate(toWorldStepInput(a));
  const outB = new WorldSimulator().simulate(toWorldStepInput(b));
  assert.deepStrictEqual(
    outA.triggeredEvents.map((t) => [t.definition.typeId, t.territoryId, t.factionId]),
    outB.triggeredEvents.map((t) => [t.definition.typeId, t.territoryId, t.factionId]),
  );
});

test('AI reasoning does not mutate GameState directly; Orchestrator is the mutation boundary', () => {
  const deSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'DecisionEngine.ts'), 'utf8');
  assert.ok(!deSrc.includes('types/GameState'), 'DecisionEngine must not import authoritative GameState');
  assert.ok(!deSrc.includes('BattleEngine'), 'DecisionEngine must not resolve battles');
  const orchSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'orchestrator.ts'), 'utf8');
  assert.ok(/runStateTransaction/.test(orchSrc));
  const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
  const before = cloneGameState(orch.getState());
  const res = orch.execute(cmdReq('AI_DECIDE', 'player_1', { warlordId: 'ashen_horde' }));
  assert.strictEqual(res.success, true);
  assert.deepStrictEqual(orch.getState().territories, before.territories);
  assert.deepStrictEqual(orch.getState().armies, before.armies);
});

test('AI_DECIDE does not run DecisionEngine for the player faction', () => {
  const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' }));
  const res = orch.execute(cmdReq('AI_DECIDE', 'player_1', { warlordId: 'merchant_republic' }));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
});

test('unsupported diplomacy remains FEATURE_NOT_IMPLEMENTED for player and AI callers', () => {
  const orch = new Orchestrator(createLegacySampleMapGameState({ seed: 1, playerFactionId: 'merchant_republic' }));
  const peaceP = orch.execute(cmdReq('OFFER_PEACE', 'player_1', { targetFactionId: 'iron_kingdom' }));
  const peaceAi = orch.execute(cmdReq('OFFER_PEACE', 'player_1', {
    targetFactionId: 'iron_kingdom', factionId: 'ashen_horde',
  }));
  const tradeP = orch.execute(cmdReq('TRADE', 'player_1', { targetFactionId: 'iron_kingdom' }));
  const tradeAi = orch.execute(cmdReq('TRADE', 'player_1', {
    targetFactionId: 'iron_kingdom', factionId: 'ashen_horde',
  }));
  for (const r of [peaceP, peaceAi, tradeP, tradeAi]) {
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.errors[0]!.code, ErrorCode.FEATURE_NOT_IMPLEMENTED);
  }
});

test('no DiplomacyEngine was introduced; SCOUT handler is gone', () => {
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'diplomacy')));
  const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'handlers.ts'), 'utf8');
  assert.ok(!/handleScout/.test(handlerSrc));
  assert.ok(!/executeExpand/.test(handlerSrc));
});

test('player command and AI commitment converge on executeAttack; AI vs player waits for defense', () => {
  const battle = new RecordingBattleEngine();
  const state = buildParityBattleState('def_faction');
  state.commitments.set('atk_faction', makeAttackCommitment('atk_faction', 'front'));
  const reg = createDefaultRegistry();
  reg.registerBattle(battle);
  const orch = new Orchestrator(state, reg);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'player_1', { factionId: 'atk_faction' }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(battle.inputs.length, 0);
  assert.strictEqual(res.payload.attackOutcome, 'invasion_created');
  const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'handlers.ts'), 'utf8');
  assert.ok(/case 'ATTACK':[\s\S]*executeAttack/.test(handlerSrc));
});

function makeCmt(partial: Partial<AICommitment> & Pick<AICommitment, 'warlordId' | 'action'>): AICommitment {
  return {
    id: partial.id ?? `cmt_${partial.warlordId}_${partial.action}`,
    warlordId: partial.warlordId,
    action: partial.action,
    targetId: partial.targetId ?? null,
    targetName: partial.targetName ?? partial.targetId ?? null,
    status: partial.status ?? 'committed',
    createdTurn: partial.createdTurn ?? 1,
    originatingGoalId: partial.originatingGoalId ?? null,
    reason: partial.reason ?? ['test'],
    priority: partial.priority ?? 50,
    score: partial.score ?? 50,
    confidence: partial.confidence ?? 1,
    personalityBias: partial.personalityBias ?? 0,
    ambitionInfluence: partial.ambitionInfluence ?? 0,
    factorBreakdown: partial.factorBreakdown ?? [],
    statusReason: partial.statusReason ?? null,
    startedAtTick: partial.startedAtTick,
    durationTicks: partial.durationTicks,
    completionCondition: partial.completionCondition,
  };
}

function buildRetreatOrchestratorState(): GameState {
  const fid = 'atk_faction';
  const home = makeTerritory({ id: 'home', owner: fid, neighboring: ['wild'], garrison: 50 });
  const wild = makeTerritory({ id: 'wild', owner: null, neighboring: ['home'], garrison: 10 });
  const army: Army = {
    id: 'atk_army', owner: fid, location: 'wild',
    soldiers: 200, knights: 0, siegeEngines: 0, morale: 75, supply: 80,
  };
  const snap = makeSelf(fid, { territories: ['home'], armies: ['atk_army'] });
  return {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    turn: 1,
    ...emptyWorldClock(),
    ...emptyRewardApplicationState(),
    worldSeed: 42,
    factions: new Map([[fid, snap]]),
    allFactionIds: [fid],
    playerFactionId: fid,
    territories: new Map([['home', home], ['wild', wild]]),
    ...authoredWorldFields(new Map([['home', home], ['wild', wild]])),
    armies: new Map([[army.id, army]]),
    commitments: new Map([[fid, null]]),
    activeEvents: [],
    eventHistory: [],
  };
}

console.log('AI commitment execution completeness');

test('every ActionType is classified executable or unsupported', () => {
  const all: ActionType[] = [
    'ATTACK', 'DEFEND', 'REINFORCE', 'BUILD', 'MOVE',
    'NEGOTIATE', 'OFFER_PEACE', 'DECLARE_WAR', 'TRADE', 'RETREAT', 'WAIT',
  ];
  for (const a of all) {
    assert.ok(
      EXECUTABLE_COMMITMENT_ACTIONS.has(a) || UNSUPPORTED_COMMITMENT_ACTIONS.has(a),
      `${a} must be listed as executable or unsupported`,
    );
  }
});

test('AI ATTACK commitment executes through BattleEngine', () => {
  const battle = new RecordingBattleEngine();
  const state = buildParityBattleState('spectator', true);
  state.commitments.set('atk_faction', makeCmt({ warlordId: 'atk_faction', action: 'ATTACK', targetId: 'front' }));
  const reg = createDefaultRegistry();
  reg.registerBattle(battle);
  const orch = new Orchestrator(state, reg);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'atk_faction', seed: 42 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(battle.inputs.length, 1);
  assert.strictEqual(res.payload.commitmentOutcome, 'completed');
  assert.strictEqual(orch.getState().commitments.get('atk_faction')!.status, 'completed');
  assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
});

test('AI BUILD commitment starts timed fortification construction', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'ashen_horde' });
  plantOwnedCities(state);
  const fid = 'merchant_republic';
  const owned = state.factions.get(fid)!.territories[0]!;
  const { gold: costG } = BALANCE.territory.fortificationCostPerLevel;
  const goldBefore = state.factions.get(fid)!.resources.gold;
  const fortBefore = state.territories.get(owned)!.fortification;
  state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'BUILD', targetId: owned }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(orch.getState().territories.get(owned)!.fortification, fortBefore);
  assert.strictEqual(orch.getState().factions.get(fid)!.resources.gold, goldBefore - costG);
  orch.execute(cmdReq('ADVANCE_WORLD', 'ai', { elapsedTicks: GAMEPLAY_CONFIG.defaultConstructionDurationTicks }));
  assert.strictEqual(orch.getState().territories.get(owned)!.fortification, fortBefore + 1);
});

test('AI REINFORCE commitment uses shared REINFORCE / BALANCE cost', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  const fid = 'iron_kingdom';
  const owned = state.factions.get(fid)!.territories[0]!;
  const { gold: costG, food: costF, garrisonGain } = BALANCE.economy.reinforcementCost;
  const goldBefore = state.factions.get(fid)!.resources.gold;
  const foodBefore = state.factions.get(fid)!.resources.food;
  const garBefore = state.territories.get(owned)!.garrison;
  state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'REINFORCE', targetId: owned }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(orch.getState().territories.get(owned)!.garrison, garBefore + garrisonGain);
  assert.strictEqual(orch.getState().factions.get(fid)!.resources.gold, goldBefore - costG);
  assert.strictEqual(orch.getState().factions.get(fid)!.resources.food, foodBefore - costF);
});

test('AI MOVE commitment executes through shared handleMove', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  const fid = 'merchant_republic';
  const armyId = state.factions.get(fid)!.armies[0]!;
  const loc = state.armies.get(armyId)!.location;
  const dest = state.territories.get(loc)!.neighboring[0]!;
  const originT = state.territories.get(loc)!;
  const destT = state.territories.get(dest)!;
  const duration = calculateMovementDuration({ origin: originT, destination: destT });
  state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'MOVE', targetId: dest }));
  const orch = new Orchestrator(state);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'handlers.ts'), 'utf8');
  const moveFn = src.slice(src.indexOf('function executeMoveCommitment'), src.indexOf('function executeStrategicRetreat'));
  assert.ok(moveFn.includes('handleMove'));
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(res.payload.arrivalPending, true);
  assert.strictEqual(orch.getState().armies.get(armyId)!.location, loc, 'army stays at origin until arrival');
  assert.strictEqual(orch.getState().armies.get(armyId)!.movement?.status, 'moving');
  assert.strictEqual(orch.getState().commitments.get(fid)!.status, 'executing');
  const tick = orch.getState().worldTick;
  orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
  assert.strictEqual(orch.getState().worldTick, tick + duration);
  assert.strictEqual(orch.getState().armies.get(armyId)!.location, dest);
  assert.ok(!isArmyMoving(orch.getState().armies.get(armyId)!));
  assert.strictEqual(orch.getState().commitments.get(fid)!.status, 'completed');
});

test('AI NEGOTIATE commitment uses shared handleNegotiate', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  const fid = 'ashen_horde';
  const target = 'iron_kingdom';
  const before = state.factions.get(fid)!.diplomacy.get(target)!.opinion;
  state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'NEGOTIATE', targetId: target }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.ok(orch.getState().factions.get(fid)!.diplomacy.get(target)!.opinion > before);
});

test('AI DECLARE_WAR commitment uses shared handleDeclareWar', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  const fid = 'ashen_horde';
  const target = 'iron_kingdom';
  state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'DECLARE_WAR', targetId: target }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(orch.getState().factions.get(fid)!.diplomacy.get(target)!.state, 'at_war');
  assert.strictEqual(orch.getState().factions.get(target)!.diplomacy.get(fid)!.state, 'at_war');
});

test('AI DEFEND completes immediately and does not stay active', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  const fid = 'ashen_horde';
  const owned = state.factions.get(fid)!.territories[0]!;
  state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'DEFEND', targetId: owned }));
  const orch = new Orchestrator(state);
  const terrBefore = cloneGameState(orch.getState()).territories;
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(res.payload.commitmentOutcome, 'completed');
  assert.ok(!isActiveCommitmentStatus(orch.getState().commitments.get(fid)!.status));
  assert.deepStrictEqual(orch.getState().territories, terrBefore);
});

test('AI WAIT completes immediately and cannot remain infinitely active', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  const fid = 'iron_kingdom';
  state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'WAIT' }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(res.payload.commitmentOutcome, 'completed');
  assert.ok(!isActiveCommitmentStatus(orch.getState().commitments.get(fid)!.status));
});

test('AI RETREAT repositions via MOVE and never invokes BattleEngine', () => {
  const state = buildRetreatOrchestratorState();
  state.commitments.set('atk_faction', makeCmt({ warlordId: 'atk_faction', action: 'RETREAT', targetId: 'wild' }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'atk_faction' }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(orch.getState().armies.get('atk_army')!.location, 'wild');
  assert.strictEqual(orch.getState().armies.get('atk_army')!.movement?.status, 'moving');
  assert.strictEqual(orch.getState().commitments.get('atk_faction')!.status, 'executing');
  const origin = orch.getState().territories.get('wild')!;
  const dest = orch.getState().territories.get('home')!;
  const duration = calculateMovementDuration({ origin, destination: dest });
  orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: duration }));
  assert.strictEqual(orch.getState().armies.get('atk_army')!.location, 'home');
  assert.strictEqual(orch.getState().commitments.get('atk_faction')!.status, 'completed');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'orchestration', 'handlers.ts'), 'utf8');
  const retreatFn = src.slice(src.indexOf('function executeStrategicRetreat'), src.indexOf('export function handleDeclareWar'));
  assert.ok(retreatFn.includes('handleMove'));
  assert.ok(!retreatFn.includes('BattleEngine'));
  assert.ok(!retreatFn.includes('resolve('));
});

test('stale commitment target fails safely without world mutation', () => {
  const state = buildParityBattleState('atk_faction');
  state.commitments.set('atk_faction', makeCmt({ warlordId: 'atk_faction', action: 'ATTACK', targetId: 'home' }));
  const orch = new Orchestrator(state);
  const beforeTerr = cloneGameState(orch.getState()).territories;
  const beforeArmies = cloneGameState(orch.getState()).armies;
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'atk_faction' }));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errors[0]!.code, ErrorCode.INVALID_TARGET);
  assert.strictEqual(orch.getState().commitments.get('atk_faction')!.status, 'failed');
  assert.deepStrictEqual(orch.getState().territories, beforeTerr);
  assert.deepStrictEqual(orch.getState().armies, beforeArmies);
});

test('completed commitment cannot execute twice', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  const fid = 'ashen_horde';
  state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'WAIT' }));
  const orch = new Orchestrator(state);
  const first = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
  assert.strictEqual(first.success, true, first.errors[0]?.message);
  const second = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: fid }));
  assert.strictEqual(second.success, false);
  assert.strictEqual(second.errors[0]!.code, ErrorCode.ACTION_NOT_ALLOWED);
});

test('failed commitment permits reassessment', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  const fid = 'ashen_horde';
  state.commitments.set(fid, makeCmt({
    warlordId: fid, action: 'ATTACK', targetId: state.factions.get(fid)!.territories[0]!, status: 'failed',
  }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('AI_DECIDE', 'ai', { warlordId: fid }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  const next = orch.getState().commitments.get(fid);
  assert.ok(next);
  assert.ok(isActiveCommitmentStatus(next!.status));
});

test('interrupted commitment permits reassessment', () => {
  const state = createLegacySampleMapGameState({ seed: 42, playerFactionId: 'merchant_republic' });
  const fid = 'iron_kingdom';
  state.commitments.set(fid, makeCmt({ warlordId: fid, action: 'WAIT', status: 'interrupted' }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('AI_DECIDE', 'ai', { warlordId: fid }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  const next = orch.getState().commitments.get(fid);
  assert.ok(next && isActiveCommitmentStatus(next.status));
});

test('unsupported TRADE commitment returns FEATURE_NOT_IMPLEMENTED and fails', () => {
  const state = createLegacySampleMapGameState({ seed: 1, playerFactionId: 'merchant_republic' });
  state.commitments.set('ashen_horde', makeCmt({
    warlordId: 'ashen_horde', action: 'TRADE', targetId: 'iron_kingdom',
  }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('RESOLVE_COMMITMENT', 'ai', { factionId: 'ashen_horde' }));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errors[0]!.code, ErrorCode.FEATURE_NOT_IMPLEMENTED);
  assert.strictEqual(orch.getState().commitments.get('ashen_horde')!.status, 'failed');
  assert.strictEqual(res.payload.reassessmentRequired, true);
});

console.log('Continuous world simulation foundation');

function worldAdvance(res: { payload: Record<string, unknown> }): WorldAdvanceResult {
  return res.payload.worldAdvance as WorldAdvanceResult;
}

function sampleWorldOrch(seed = 42): Orchestrator {
  return new Orchestrator(createLegacySampleMapGameState({ seed, playerFactionId: 'merchant_republic' }));
}

test('world time advances correctly by elapsedTicks', () => {
  const orch = sampleWorldOrch(11);
  assert.strictEqual(orch.getState().worldTick, 0);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 3 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(orch.getState().worldTick, 3);
  assert.strictEqual(orch.getState().turn, 3);
  const wa = worldAdvance(res);
  assert.strictEqual(wa.previousWorldTick, 0);
  assert.strictEqual(wa.newWorldTick, 3);
  assert.strictEqual(wa.ticksAdvanced, 3);
  assert.strictEqual(wa.eventResults.length, 3);
});

test('zero elapsed time is a no-op', () => {
  const orch = sampleWorldOrch(12);
  const before = cloneGameState(orch.getState());
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 0 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.deepStrictEqual(orch.getState(), before);
  const wa = worldAdvance(res);
  assert.strictEqual(wa.ticksAdvanced, 0);
  assert.strictEqual(wa.aiDecisions.length, 0);
  assert.strictEqual(wa.eventResults.length, 0);
});

test('invalid elapsed time is rejected and leaves state unchanged', () => {
  const cases: unknown[] = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 999];
  for (const elapsedTicks of cases) {
    const state = createLegacySampleMapGameState({ seed: 13, playerFactionId: 'merchant_republic' });
    const before = cloneGameState(state);
    const orch = new Orchestrator(state);
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: elapsedTicks as number }));
    assert.strictEqual(res.success, false, `elapsedTicks=${String(elapsedTicks)} should fail`);
    assert.strictEqual(res.errors[0]!.code, ErrorCode.INVALID_PARAMETER);
    assert.deepStrictEqual(orch.getState(), before);
  }
  assert.throws(() => parseElapsedTicks({ elapsedTicks: -2 }), (err: unknown) => (
    err instanceof OrchestrationError && err.code === ErrorCode.INVALID_PARAMETER
  ));
});

test('deterministic advancement: identical GameState + seed + elapsed ticks match', () => {
  const run = () => {
    const orch = sampleWorldOrch(21);
    const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 4 }));
    return { res, state: cloneGameState(orch.getState()) };
  };
  const a = run();
  const b = run();
  assert.strictEqual(a.res.success && b.res.success, true);
  assert.deepStrictEqual(a.state, b.state);
  assert.deepStrictEqual(worldAdvance(a.res).aiDecisions, worldAdvance(b.res).aiDecisions);
  assert.deepStrictEqual(worldAdvance(a.res).commitmentResolutions, worldAdvance(b.res).commitmentResolutions);
  assert.deepStrictEqual(worldAdvance(a.res).eventResults, worldAdvance(b.res).eventResults);
});

test('AI with no commitment can decide', () => {
  const orch = sampleWorldOrch(31);
  for (const fid of orch.getState().allFactionIds) {
    if (fid !== 'merchant_republic') {
      assert.strictEqual(orch.getState().commitments.get(fid), null);
    }
  }
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.ok(worldAdvance(res).aiDecisions.length > 0, 'at least one AI faction should decide');
  const decided = worldAdvance(res).aiDecisions.map((d) => d.factionId);
  assert.ok(!decided.includes('merchant_republic'), 'player faction must not receive AI_DECIDE');
});

test('AI with an active commitment does not repeatedly decide', () => {
  const orch = sampleWorldOrch(32);
  const first = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(first.success, true, first.errors[0]?.message);
  const idsAfterFirst = new Map(
    [...orch.getState().commitments.entries()].map(([k, v]) => [k, v?.id ?? null]),
  );
  const second = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(second.success, true, second.errors[0]?.message);
  assert.strictEqual(worldAdvance(second).aiDecisions.length, 0, 'reassessment cadence must block a second decide');
  for (const [fid, id] of idsAfterFirst) {
    if (!id) continue;
    const c = orch.getState().commitments.get(fid);
    if (c && isActiveCommitmentStatus(c.status)) {
      assert.strictEqual(c.id, id, `${fid} must keep the same in-flight commitment`);
    }
  }
});

test('commitment progresses while duration remains', () => {
  const state = createLegacySampleMapGameState({ seed: 33, playerFactionId: 'merchant_republic' });
  state.commitments.set('ashen_horde', makeCmt({
    warlordId: 'ashen_horde',
    action: 'WAIT',
    durationTicks: 3,
    startedAtTick: 0,
    completionCondition: 'duration_elapsed',
  }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  const c = orch.getState().commitments.get('ashen_horde')!;
  assert.ok(isActiveCommitmentStatus(c.status), 'WAIT with remaining duration must stay active');
  const progress = worldAdvance(res).commitmentProgress.find((p) => p.factionId === 'ashen_horde');
  assert.ok(progress);
  assert.strictEqual(progress!.ticksRemaining, 2);
  assert.strictEqual(worldAdvance(res).commitmentResolutions.filter((r) => r.factionId === 'ashen_horde').length, 0);
});

test('commitment resolves when duration elapses', () => {
  const state = createLegacySampleMapGameState({ seed: 34, playerFactionId: 'merchant_republic' });
  state.commitments.set('ashen_horde', makeCmt({
    warlordId: 'ashen_horde',
    action: 'WAIT',
    durationTicks: 2,
    startedAtTick: 0,
    completionCondition: 'duration_elapsed',
  }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 2 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(orch.getState().commitments.get('ashen_horde')!.status, 'completed');
  const resolutions = worldAdvance(res).commitmentResolutions.filter((r) => r.factionId === 'ashen_horde');
  assert.strictEqual(resolutions.length, 1);
  assert.strictEqual(resolutions[0]!.outcome, 'completed');
});

test('completed commitment is not executed twice', () => {
  const state = createLegacySampleMapGameState({ seed: 35, playerFactionId: 'merchant_republic' });
  state.commitments.set('ashen_horde', makeCmt({
    warlordId: 'ashen_horde',
    action: 'WAIT',
    durationTicks: 0,
    startedAtTick: 0,
    completionCondition: 'duration_elapsed',
  }));
  const orch = new Orchestrator(state);
  const first = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(first.success, true, first.errors[0]?.message);
  const id = orch.getState().commitments.get('ashen_horde')!.id;
  assert.strictEqual(orch.getState().commitments.get('ashen_horde')!.status, 'completed');
  const second = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(second.success, true, second.errors[0]?.message);
  const again = worldAdvance(second).commitmentResolutions.filter((r) => r.commitmentId === id);
  assert.strictEqual(again.length, 0);
  assert.strictEqual(orch.getState().commitments.get('ashen_horde')!.status, 'completed');
});

test('failed commitment can reassess after cadence', () => {
  const state = createLegacySampleMapGameState({ seed: 36, playerFactionId: 'merchant_republic' });
  state.commitments.set('ashen_horde', makeCmt({
    warlordId: 'ashen_horde',
    action: 'TRADE',
    targetId: 'iron_kingdom',
    durationTicks: 0,
    startedAtTick: 0,
  }));
  const orch = new Orchestrator(state);
  const failStep = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(failStep.success, true, failStep.errors[0]?.message);
  assert.strictEqual(orch.getState().commitments.get('ashen_horde')!.status, 'failed');
  const cooldown = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(worldAdvance(cooldown).aiDecisions.filter((d) => d.factionId === 'ashen_horde').length, 0);
  const reassess = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(reassess.success, true, reassess.errors[0]?.message);
  const decided = worldAdvance(reassess).aiDecisions.filter((d) => d.factionId === 'ashen_horde');
  assert.ok(decided.length === 1, 'failed TRADE must become eligible for AI_DECIDE after reassessment interval');
  assert.notStrictEqual(decided[0]!.commitmentId, 'cmt_ashen_horde_TRADE');
});

test('unsupported commitment cannot remain active', () => {
  const state = createLegacySampleMapGameState({ seed: 37, playerFactionId: 'merchant_republic' });
  state.commitments.set('ashen_horde', makeCmt({
    warlordId: 'ashen_horde',
    action: 'OFFER_PEACE',
    targetId: 'iron_kingdom',
    durationTicks: 5,
    startedAtTick: 0,
  }));
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  const c = orch.getState().commitments.get('ashen_horde')!;
  assert.strictEqual(c.status, 'failed');
  assert.ok(!isActiveCommitmentStatus(c.status));
  const resn = worldAdvance(res).commitmentResolutions.find((r) => r.factionId === 'ashen_horde');
  assert.ok(resn);
  assert.strictEqual(resn!.success, false);
});

test('multiple AI factions advance independently', () => {
  const orch = sampleWorldOrch(38);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  const decided = new Set(worldAdvance(res).aiDecisions.map((d) => d.factionId));
  assert.ok(decided.has('ashen_horde'));
  assert.ok(decided.has('iron_kingdom'));
  assert.ok(decided.has('celestial_theocracy'));
  assert.ok(!decided.has('merchant_republic'));
});

test('one AI faction failing does not corrupt unrelated factions', () => {
  const state = createLegacySampleMapGameState({ seed: 39, playerFactionId: 'merchant_republic' });
  state.commitments.set('ashen_horde', makeCmt({
    warlordId: 'ashen_horde',
    action: 'TRADE',
    targetId: 'iron_kingdom',
    durationTicks: 0,
    startedAtTick: 0,
  }));
  state.commitments.set('iron_kingdom', makeCmt({
    warlordId: 'iron_kingdom',
    action: 'WAIT',
    durationTicks: 0,
    startedAtTick: 0,
  }));
  const ironTerritories = [...state.factions.get('iron_kingdom')!.territories];
  const orch = new Orchestrator(state);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.strictEqual(orch.getState().commitments.get('ashen_horde')!.status, 'failed');
  assert.strictEqual(orch.getState().commitments.get('iron_kingdom')!.status, 'completed');
  assert.deepStrictEqual(orch.getState().factions.get('iron_kingdom')!.territories, ironTerritories);
  assert.ok(orch.getState().factions.has('celestial_theocracy'));
  assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
});

test('event advancement records EventEngine steps', () => {
  const orch = sampleWorldOrch(41);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 2 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  const wa = worldAdvance(res);
  assert.strictEqual(wa.eventResults.length, 2);
  assert.strictEqual(wa.eventResults[0]!.turn, 1);
  assert.strictEqual(wa.eventResults[1]!.turn, 2);
  assert.strictEqual(orch.getState().turn, 2);
});

test('event history is stored on GameState after advancement', () => {
  const orch = sampleWorldOrch(42);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 3 }));
  assert.strictEqual(res.success, true, res.errors[0]?.message);
  assert.ok(Array.isArray(orch.getState().eventHistory));
  assert.strictEqual(
    orch.getState().eventHistory.length,
    worldAdvance(res).eventResults[worldAdvance(res).eventResults.length - 1]!.historyLength,
  );
});

test('GameState invariants hold after world advancement', () => {
  const orch = sampleWorldOrch(43);
  orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 5 }));
  assert.deepStrictEqual(checkGameStateInvariants(orch.getState()), []);
});

test('ADVANCE_WORLD orchestrator command returns a useful inspectable payload', () => {
  const orch = sampleWorldOrch(44);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.commandId, 'ADVANCE_WORLD');
  const wa = worldAdvance(res);
  assert.ok(Array.isArray(wa.aiDecisions));
  assert.ok(Array.isArray(wa.commitmentProgress));
  assert.ok(Array.isArray(wa.commitmentResolutions));
  assert.ok(Array.isArray(wa.eventResults));
  assert.ok(Array.isArray(wa.stateChanges));
  assert.ok(Array.isArray(wa.notifications));
  assert.ok(Array.isArray(wa.errors));
  assert.strictEqual(res.payload.worldTick, 1);
  assert.ok(!('aiWarlordStates' in res.payload));
});

test('atomic failure: missing EventEngine leaves authoritative state unchanged', () => {
  const state = createLegacySampleMapGameState({ seed: 45, playerFactionId: 'merchant_republic' });
  const before = cloneGameState(state);
  const reg = new EngineRegistry();
  reg.registerBattle(new BattleEngine());
  reg.registerAi(new DecisionEngine());
  const orch = new Orchestrator(state, reg);
  const res = orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.errors[0]!.code, ErrorCode.ENGINE_UNAVAILABLE);
  assert.deepStrictEqual(orch.getState(), before);
});

test('deterministic multi-step simulation matches chunked ticks', () => {
  const initial = createLegacySampleMapGameState({ seed: 46, playerFactionId: 'merchant_republic' });
  const batched = new Orchestrator(cloneGameState(initial));
  const stepped = new Orchestrator(cloneGameState(initial));
  const batchRes = batched.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 4 }));
  assert.strictEqual(batchRes.success, true, batchRes.errors[0]?.message);
  for (let i = 0; i < 4; i++) {
    const step = stepped.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
    assert.strictEqual(step.success, true, step.errors[0]?.message);
  }
  assert.deepStrictEqual(batched.getState(), stepped.getState());
});

test('continuous world code does not use wall-clock randomness', () => {
  const files = [
    path.join(__dirname, '..', 'src', 'world', 'ContinuousWorldEngine.ts'),
    path.join(__dirname, '..', 'src', 'world', 'worldTime.ts'),
    path.join(__dirname, '..', 'src', 'world', 'eventTick.ts'),
    path.join(__dirname, '..', 'src', 'army', 'movement.ts'),
  ];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!/\bDate\.now\s*\(/.test(src), `${file} must not call Date.now()`);
    assert.ok(!/\bMath\.random\s*\(/.test(src), `${file} must not call Math.random()`);
  }
  const a = sampleWorldOrch(47);
  const b = sampleWorldOrch(47);
  a.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 3 }));
  b.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 3 }));
  assert.deepStrictEqual(a.getState(), b.getState());
});

test('player commitments are not auto-resolved by ADVANCE_WORLD', () => {
  const state = createLegacySampleMapGameState({ seed: 48, playerFactionId: 'merchant_republic' });
  state.commitments.set('merchant_republic', makeCmt({
    warlordId: 'merchant_republic',
    action: 'WAIT',
    durationTicks: 0,
    startedAtTick: 0,
  }));
  const orch = new Orchestrator(state);
  orch.execute(cmdReq('ADVANCE_WORLD', 'p', { elapsedTicks: 1 }));
  assert.strictEqual(orch.getState().commitments.get('merchant_republic')!.status, 'committed');
});

test('ContinuousWorldEngine is a coordinator, not a second AI/battle implementation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'world', 'ContinuousWorldEngine.ts'), 'utf8');
  assert.ok(/host\.decide|host\.resolve|host\.runEventTurn|host\.executePendingAttack/.test(src));
  assert.ok(!/new ActionScorer|new BattleEngine|computeWinProbability/.test(src));
  assert.ok(src.includes('progressArmyMovements'));
  assert.ok(!src.includes('calculateMovementDuration'), 'travel math stays in src/army/movement.ts');
});

registerArmyMovementTests({
  test,
  cmdReq,
  makeCmt,
  makeTerritory,
  makeSelf,
});

registerStrategicAttackTests({
  test,
  cmdReq,
  makeCmt,
  makeTerritory,
  makeSelf,
});

registerAiRuntimeTests({
  test,
  cmdReq,
  makeCmt,
  makeTerritory,
  makeSelf,
});

registerFoundationHardeningTests({
  test,
  cmdReq,
  makeCmt,
  makeTerritory,
  makeSelf,
});

registerLongSimulationTests({ test });

registerFitnessDomainTests({ test });

registerFitnessLibraryTests({ test });

registerFitnessSessionTests({ test });

registerFitnessEvidenceTests({ test });

registerFitnessLevelTests({ test });

registerFitnessPersonalizationTests({ test });

registerFitnessPhysicalResultTests({ test });

registerGameRewardTests({ test });

registerRewardApplicationTests({ test });

registerGameplayConsumptionTests({ test });

registerEconomyCitiesTests({ test });
registerEconomyFoundationTests({ test });
registerEconomyDevelopmentsTests({ test });
registerTerritoryDefenseTests({ test });
registerAiEconomyTests({ test });

registerInvasionLifecycleTests({ test });

registerPersistenceTests({ test });

registerPlayerIdentityTests({ test });

registerWorldTransitionTests({ test });

registerGate1VerticalSliceTests({ test });

registerGate1VerticalSliceWorkoutTests({ test });

registerGate1VerticalSliceAttackTests({ test });

registerGate1VerticalSlicePersistenceTests({ test });

registerWorldDefinitionTests({ test });

registerLevel1ProductionTests({ test });

registerLevel1TutorialTests({ test });

registerWorkoutSelectionTests({ test });

registerWorkoutAuthoringTests({ test });

registerWorkoutProgressionTests({ test });

registerWorkoutPauseResumeTests({ test });

registerAnalyticsTests({ test });

registerOrchestratorIntegrationTests({ test });

registerLevelAnchorTests({ test });

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
