/**
 * AI RUNTIME INTEGRATION PASS — decision/execution feasibility layer.
 *
 * `ActionScorer` answers "how desirable is this action?"; this module
 * answers the separate question "can this action actually happen against
 * CURRENT `GameStateSnapshot`?" Keeping the two questions in separate
 * files/functions is the point of this pass: `ActionScorer` calls into
 * here for structural yes/no checks instead of re-deriving its own
 * (potentially inconsistent) notion of reachability, and neither this
 * file nor `ActionScorer` re-implements BattleEngine/movement-duration
 * math — both already live in `BattleEngine`/`src/army/movement.ts` and
 * are reused by reference (`listImmediateAttackingArmies`,
 * `selectDelayedAttackPlan`), not duplicated.
 *
 * This is intentionally the SAME logic `startStrategicAttack` (Phase 15)
 * uses to decide immediate-vs-staging-vs-reject, called through the same
 * exported functions, against the same `ActionContext.gameState`
 * (`GameStateSnapshot`) the scorer already has. See
 * docs/AI_RUNTIME_INTEGRATION.md, "Attack feasibility".
 */
import { ActionContext, Army, ArmyId, TerritoryId } from '../types';
import {
  armyHasActiveStrategicOperation,
  listImmediateAttackingArmies,
  selectDelayedAttackPlan,
} from '../army/strategicAttack';

/**
 * A. `immediate`   — some eligible army is already standing on a legal
 *    staging tile bordering the target; `startStrategicAttack` resolves
 *    battle the same tick.
 * B. `staging`     — no immediate army, but a deterministic one-hop
 *    staging plan exists; `startStrategicAttack` starts a march and the
 *    attack completes on arrival (Phase 15 MOVE → ATTACK chain).
 * C. `unreachable` — neither; `startStrategicAttack` would reject this
 *    target outright. No multi-hop planning is attempted (out of scope).
 */
export type AttackFeasibility = 'immediate' | 'staging' | 'unreachable';

export interface AttackFeasibilityResult {
  feasibility: AttackFeasibility;
  /** Populated only when `feasibility === 'immediate'`. */
  immediateArmies: Army[];
  /** Populated only when `feasibility === 'staging'`. */
  stagingArmyId: ArmyId | null;
  stagingTerritoryId: TerritoryId | null;
}

export function getAttackFeasibility(
  ctx: ActionContext,
  targetTerritoryId: TerritoryId,
): AttackFeasibilityResult {
  const immediateArmies = listImmediateAttackingArmies(ctx.gameState, ctx.self.id, targetTerritoryId);
  if (immediateArmies.length > 0) {
    return { feasibility: 'immediate', immediateArmies, stagingArmyId: null, stagingTerritoryId: null };
  }
  const plan = selectDelayedAttackPlan(ctx.gameState, ctx.self.id, targetTerritoryId);
  if (plan) {
    return {
      feasibility: 'staging',
      immediateArmies: [],
      stagingArmyId: plan.armyId,
      stagingTerritoryId: plan.stagingTerritoryId,
    };
  }
  return { feasibility: 'unreachable', immediateArmies: [], stagingArmyId: null, stagingTerritoryId: null };
}

/**
 * MOVE feasibility: a destination is only genuinely reachable right now if
 * at least one of this faction's armies is (a) stationary — not already
 * moving and not mid-strategic-attack, i.e. no conflicting attack intent
 * — and (b) currently adjacent to it. `executeMoveCommitment`
 * (`src/orchestration/handlers.ts`) picks the first such army by id; this
 * function answers only "does at least one exist", so `ActionScorer`
 * cannot select a MOVE destination that execution would immediately
 * reject with `NOT_ADJACENT`.
 */
export function isMoveDestinationFeasible(ctx: ActionContext, destinationTerritoryId: TerritoryId): boolean {
  return ctx.myArmies.some((a) => {
    if (armyHasActiveStrategicOperation(a)) return false;
    const loc = ctx.allTerritories.get(a.location);
    return !!loc && loc.neighboring.includes(destinationTerritoryId);
  });
}
