export {
  GAMEPLAY_CONFIG,
  minutesToTicks,
  playerProtectionTicks,
  defenseResponseTicks,
  successfulDefenseRecoveryTicks,
  failedDefenseContinuationTicks,
  defenseWorkoutMaxDurationTicks,
  acceleratedRemainingTicks,
} from './config';
export type { GameplayConfig } from './config';

export { commitBankedTroopsAndAttack } from './attacks/commitBankedTroops';
export { startConstruction, consumeConstructionEffect } from './construction/consume';
export {
  getConstructionProjectDefinition,
  listConstructionProjectTypes,
  constructionCostEntries,
  constructionCostAmount,
  isConstructionProjectType,
} from './construction/definitions';
export type { ConstructionProjectDefinition, ConstructionCost } from './construction/definitions';
export { displayedRemainingTicks, progressAllConstructions } from './construction/progress';
export { collectTerritoryYield } from './economy/collect';
export { ECONOMY_CONFIG, emptyResources, RESOURCE_KEYS } from './economy/config';
export { effectiveResourceOutput } from './economy/effectiveOutput';
export { productionAccrued, productionAccruedBetween } from './economy/production';
export { peekCollectibleResources, persistAllTerritoryAccrual } from './economy/accrual';
export {
  deriveFactionResourceIncome,
  syncAllFactionResourceIncome,
  syncFactionResourceIncome,
} from './economy/resourceIncome';
export { settleTerritoryOwnershipChange, territoryDestructionHasLosses } from './economy/ownership';
export type { TerritoryDestructionReport } from './economy/ownership';
export { consumeEmpireFood, foodConsumptionDisabled } from './economy/foodConsumption';
export type { FoodConsumptionResult, FoodConsumptionFactionResult } from './economy/foodConsumption';
export { progressWorldEconomy } from './economy/worldProgress';
export { cityIdFor, ensureCity } from './cities/city';
export {
  cityCombatModifiersEnabled,
  territoryHasCity,
  combatDefenseMultiplier,
  defenseWorkoutMultiplier,
  withTerritoryCombatView,
} from './defense/territoryDefense';
export {
  beginInvasionAgainstPlayer,
  maybeHoldAttackAsInvasion,
  armiesForImmediateInvasion,
} from './invasion/create';
export { resolveInvasionBattle } from './invasion/resolve';
export type { InvasionResolveReason } from './invasion/resolve';
export { progressExpiredInvasions, processInvasionTimeouts } from './invasion/progress';
export { isDeadlineElapsed, isOpenInvasion, remainingDeadlineTicks } from './invasion/deadlines';
export {
  canAiAttackPlayer,
  isPlayerProtected,
  isPlayerEmpirePaused,
  isAttackForbiddenOnSnapshot,
  playerFacingTick,
} from './invasion/eligibility';
export { setPlayerEmpirePause } from './invasion/pause';
export {
  isPlayerAnchorProtected,
  isPlayerAnchorProtectedOnSnapshot,
  isPlayerAnchorTerritory,
  playerOwnedAnchorTerritoryIds,
  playerOwnedNonAnchorTerritoryIds,
  assertAnchorAttackAllowed,
  bindLevelAnchors,
  applyPlayerTerritoryLoss,
  ANCHOR_PROTECTED_REASON,
  ANCHOR_PROTECTED_MESSAGE,
} from './anchors';
export {
  evaluateWorldCompletion,
  applyWorldCompletionCheck,
  tryLoadWorldDefinitionForState,
} from './completion';
export type { WorldCompletionView } from './completion';
export {
  bindLevel1Tutorial,
  syncLevel1Tutorial,
  serializeLevel1TutorialView,
  isLevel1TutorialApplicable,
  isLevel1TutorialAiSuppressed,
  expectedActionForBeat,
  tutorialExpectedWorkoutPurpose,
  LEVEL1_SCRIPTED_RAID_TROOPS,
  LEVEL1_TUTORIAL_TILE_IDS,
} from './tutorial/level1';
export type { Level1TutorialPublicView } from './tutorial/level1';
