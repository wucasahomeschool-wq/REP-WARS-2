export {
  calculateMovementDuration,
  beginArmyMovement,
  progressArmyMovements,
  isArmyMoving,
  isMovementCommitmentInFlight,
  findMovingArmyForCommitment,
  movementTicksRemaining,
  cloneArmyMovement,
  movementResultsToHandlerBits,
} from './movement';
export type {
  MovementDurationInput,
  BeginArmyMovementParams,
  MovementTickResult,
} from './movement';
export {
  startStrategicAttack,
  executeReadyStrategicAttack,
  selectDelayedAttackPlan,
  listImmediateAttackingArmies,
  listLegalStagingTerritoryIds,
  isLegalStagingTerritory,
  isStrategicAttackInFlight,
  isActiveAttackIntent,
  cloneAttackIntent,
  invalidateStaleAttackIntents,
  MIN_ATTACKING_TROOPS,
} from './strategicAttack';
export type {
  StrategicAttackParams,
  DelayedAttackPlan,
  StrategicAttackHost,
  StaleAttackInvalidation,
} from './strategicAttack';
