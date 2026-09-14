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
export { displayedRemainingTicks, progressAllConstructions } from './construction/progress';
export { collectTerritoryYield } from './economy/collect';
export { ECONOMY_CONFIG, emptyResources, RESOURCE_KEYS } from './economy/config';
export { productionAccrued, productionAccruedBetween } from './economy/production';
export { peekCollectibleResources, persistAllTerritoryAccrual } from './economy/accrual';
export { settleTerritoryOwnershipChange } from './economy/ownership';
export { progressWorldEconomy } from './economy/worldProgress';
export { cityIdFor, ensureCity } from './cities/city';
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
