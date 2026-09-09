export * from './types';
export { BALANCE, ACTION_NAMES, PERSONALITY_NAMES, TERRAIN_NAMES } from './constants/balance';
export { SeededRNG } from './utils/SeededRNG';
export { PersonalitySystem } from './personality/PersonalitySystem';
export { MemorySystem, MemorySummary } from './memory/MemorySystem';
export { GoalSystem, GoalAlignmentResult, InitialGoalContext } from './goals/GoalSystem';
export { ScoringHelpers, ActionScorer, ScorerInput } from './scoring/ActionScorer';
export { DecisionEngine, WarlordState, validateCommitmentTarget, isActiveCommitmentStatus, cloneCommitment } from './engine/DecisionEngine';
export { EXECUTABLE_COMMITMENT_ACTIONS, UNSUPPORTED_COMMITMENT_ACTIONS, isExecutableCommitmentAction } from './engine/executableActions';
export { BattleEngine, BattleInput, BattleResult, BattleCalculation, BattleSideBreakdown, CasualtyBreakdown } from './battle/BattleEngine';
export {
  ArmyLike,
  TerritoryLike,
  UnitBreakdown,
  CombatPowerBreakdown,
  sumUnits,
  averageMorale,
  computeRawUnitPower,
  computeAttackerPower,
  computeDefenderPower,
  computeWinProbability,
  computeMilitaryAdvantageRatio,
} from './battle/CombatPower';
export { MapEngine } from './map/MapEngine';
export { collectNeighborGraphIssues, NeighborGraphIssue } from './map/graphInvariants';
export { NamingSystem } from './map/NamingSystem';
export { DEFAULT_THEME_LIBRARY, IRON_HILLS, CHRISTMAS_TREE_MOUNTAINS, TUNA_ISLES, EMBER_PLAINS, CRYSTAL_COAST, MISTWOOD, GOLDEN_DESERT } from './map/Themes';
export { SimulationBuilder, SAMPLE_MAP, WARLORD_SPECS, MapTerritorySpec, WarlordSpec } from './simulation/SampleMap';
export {
  LabParams,
  BatchStats,
  ScenarioReport,
  buildLabInput,
  runBattleLabSingle,
  runBattleLabBatch,
  formatBatchStats,
  runBattleTestSuite,
  runSeededReproducibilityTest,
  runStatisticalSample,
  formatTestSuite,
} from './simulation/battleTests';
export {
  EXTREME_RATIO_SCENARIOS,
  EQUAL_FORCE_SCENARIOS,
  RATIO_SCENARIOS,
  RatioScenario,
  PropertyCheckResult,
  StressReport,
  runStressScenario,
  assertAttackerTroopMonotonicity,
  assertAttackerMoraleMonotonicity,
  assertDefenseBonusMonotonicity,
  runFullStressSuite,
  formatStressCsvReport,
} from './simulation/battleStressTests';

// ====== IMPERIAL EVENT & WORLD SIMULATION ENGINE ======
export {
  EventSeverity, SEVERITY_ORDER, EventCategory, EventStatus, EffectTarget, HistoryKind,
  ConditionContext, WorldHelper, TriggerScore, ImperialChoice, ConsequenceDelta,
  ChainDefinition, EventDefinition, ActiveEvent, TriggeredEvent, HistoryEntry,
  WorldStepInput, WorldStepOutput, EventConditionFn,
  buildDefaultSeverityTable, pickSeverityFromTable, severityScale, severityAtLeast,
} from './events/EventModel';
export {
  WorldHelperImpl, buildConditionContext, buildTriggerFn, COMMON_ELIGIBILITY,
  computeFactionStabilityModifier, candidateTerritoriesForEvents,
} from './events/EventTriggers';
export {
  EVENT_REGISTRY, EVENT_LIST, getEventById, getEventByTypeId, evaluateAllTriggersForTerritory,
} from './events/EventDefinitions';
export { WorldSimulator, ConsequenceApplier } from './events/WorldSimulator';

// ====== AUTHORITATIVE RUNTIME GAMESTATE ======
export { GameState, GAME_STATE_SCHEMA_VERSION, emptyWorldClock } from './types/GameState';
export {
  createGameState,
  CreateGameStateOptions,
  cloneGameState,
  checkGameStateInvariants,
  isGameStateStructurallyValid,
  GameStateInvariantViolation,
  toDecisionEngineSnapshot,
  toWorldStepInput,
  buildWarlordStates,
  rebindWarlordRuntime,
  syncCommitmentsFromWarlordStates,
} from './state';

// ====== ORCHESTRATOR (Phase 10) ======
export {
  Orchestrator,
  EngineRegistry,
  createDefaultRegistry,
  COMMAND_INDEX,
  getCommandDefinition,
  commandIndexSummary,
  ErrorCode,
  OrchestrationError,
} from './orchestration';
export type { CommandRequest, CommandResponse, StateChange } from './orchestration';

// ====== CONTINUOUS WORLD (Phase 13) ======
export {
  ContinuousWorldEngine,
  parseElapsedTicks,
  runEventEngineTurn,
  commitmentDurationTicksFor,
} from './world';
export type {
  WorldAdvanceResult,
  WorldSimulationHost,
  WorldTimeStamp,
  WorldAiDecisionRecord,
  WorldCommitmentProgressRecord,
  WorldCommitmentResolutionRecord,
  WorldEventStepResult,
} from './world';

export {
  calculateMovementDuration,
  beginArmyMovement,
  progressArmyMovements,
  isArmyMoving,
  startStrategicAttack,
  selectDelayedAttackPlan,
  isLegalStagingTerritory,
} from './army';
export type { MovementDurationInput, MovementTickResult, DelayedAttackPlan } from './army';


