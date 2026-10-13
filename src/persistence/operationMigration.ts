import { GameState } from '../types/GameState';
import { AICommitment } from '../types';
import { concretePlanProblem } from '../types/AIConcretePlan';
import { operationFromSelection, requiredClaims, createOperationMap } from '../engine/operations';

/** Preserve domain truth; never reconstruct a historical strategic choice that was not saved. */
export function migrateLegacyOperations(state: GameState, commitments: Map<string, AICommitment | null>): void {
  state.operations = createOperationMap(); state.operationClaims = new Map();
  const counts = new Map<string, number>();
  for (const c of commitments.values()) if (c) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  for (const [factionId, c] of [...commitments].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!c) continue;
    if (c.warlordId !== factionId) throw new Error('Legacy commitment faction binding mismatch');
    const id = counts.get(c.id)! > 1 ? `${c.id}|${JSON.stringify(factionId)}` : c.id;
    const op = operationFromSelection({ ...c, id }, c.startedAtTick ?? state.worldTick);
    if (id !== c.id) op.legacyCommitmentId = c.id;
    const archive = (reason: string) => {
      op.legacy = true; op.phase = 'terminal'; op.status = 'interrupted'; op.statusReason = reason;
      op.terminal = { outcome: 'interrupted', reason, atTick: state.worldTick };
    };
    if (c.plan === undefined) archive('legacy reasoning lacked exact strategic parameters');
    else if (concretePlanProblem(c.plan)) {
      // Keep malformed plans for invariant rejection, not legacy fallback.
      archive('invalid persisted concrete plan');
    } else {
      const plan = c.plan;
      const army = 'armyId' in plan ? state.armies.get(plan.armyId) : undefined;
      const invasions = [...state.activeInvasions.values()].filter(i => i.commitmentId === c.id && i.attackerFactionId === factionId);
      const invasion = invasions.length === 1 ? invasions[0] : undefined;
      const projects = plan.action === 'BUILD' ? [...state.constructions.values()].filter(p => p.factionId === factionId
        && p.territoryId === plan.territoryId && p.projectType === plan.projectType && p.status === 'in_progress') : [];
      const expectedDestination = plan.action === 'ATTACK' ? plan.stagingTerritoryId : plan.action === 'MOVE' ? plan.destinationTerritoryId : plan.action === 'RETREAT' ? plan.fallbackTerritoryId : undefined;
      const exactMovement = army?.movement?.commitmentId === c.id && 'originTerritoryId' in plan
        && army.movement.originTerritoryId === plan.originTerritoryId && army.movement.destinationTerritoryId === expectedDestination;
      const exactAttack = plan.action === 'ATTACK' && army?.attackIntent?.commitmentId === c.id
        && army.attackIntent.targetTerritoryId === plan.targetTerritoryId && army.attackIntent.stagingTerritoryId === plan.stagingTerritoryId
        && army.attackIntent.onlyArmyId === plan.armyId;
      // One matching link cannot authorize another conflicting physical link.
      // Archive ambiguous reasoning while preserving all existing domain work.
      const physicalLinksAgree = invasions.length <= 1 && (!army?.movement || exactMovement) && (!army?.attackIntent || exactAttack)
        && (!invasion || (plan.action === 'ATTACK' && invasion.territoryId === plan.targetTerritoryId
          && invasion.attackingArmyIds.length === 1 && invasion.attackingArmyIds[0] === plan.armyId));
      if (army?.owner === factionId && physicalLinksAgree && (exactMovement || exactAttack)) {
        op.links.armyId = army.id; op.phase = 'physical'; op.status = 'executing';
        if (army.movement?.commitmentId === c.id) army.movement.commitmentId = op.id;
        if (army.attackIntent?.commitmentId === c.id) army.attackIntent.commitmentId = op.id;
        if (invasion) { op.links.invasionId = invasion.id; invasion.commitmentId = op.id; }
      } else if (plan.action === 'BUILD' && projects.length === 1) {
        if (c.status === 'completed') op.legacyFeedbackApplied = true;
        op.links.constructionId = projects[0]!.id; projects[0]!.aiOperationId = op.id;
        op.phase = 'physical'; op.status = 'executing';
      } else if (army?.movement || army?.attackIntent || invasions.length) {
        archive('ambiguous or mismatched physical lifecycle');
      } else if (c.status === 'pending' || c.status === 'committed') {
        if (['ATTACK','MOVE','RETREAT','BUILD','WAIT'].includes(c.action)) op.phase = 'selected';
        else archive('final lifecycle unavailable');
      } else if (c.status === 'completed' || c.status === 'failed' || c.status === 'interrupted') {
        op.phase = 'terminal'; op.terminal = { outcome: c.status, reason: c.statusReason ?? 'historical terminal', atTick: state.worldTick };
      } else archive('no uniquely linked physical lifecycle');
      if (op.phase === 'physical') {
        const claims = requiredClaims(plan, op.id, state, !!op.links.invasionId);
        if (claims.some(cl => state.operationClaims.has(cl.id))) archive('ambiguous legacy physical claim ownership');
        else for (const claim of claims) { state.operationClaims.set(claim.id, claim); op.claimIds.push(claim.id); }
      }
    }
    if (state.operations.has(op.id)) throw new Error(`Duplicate legacy operation ID ${op.id}`);
    state.operations.set(op.id, op);
  }
  // Physical legacy work continues autonomously. Detach reasoning IDs that
  // cannot truthfully be linked; do not clear movement or fabricate a plan.
  for (const army of state.armies.values()) {
    if (army.movement?.commitmentId) {
      const op = state.operations.get(army.movement.commitmentId);
      if (op?.phase !== 'physical' || op.links.armyId !== army.id) army.movement.commitmentId = null;
    }
    if (army.attackIntent?.commitmentId) {
      const op = state.operations.get(army.attackIntent.commitmentId);
      if (op?.phase !== 'physical' || op.links.armyId !== army.id) army.attackIntent.commitmentId = null;
    }
  }
  for (const project of state.constructions.values()) {
    if (project.aiOperationId && state.operations.get(project.aiOperationId)?.phase !== 'physical') delete project.aiOperationId;
  }
  for (const inv of state.activeInvasions.values()) {
    if (inv.commitmentId) {
      const op = state.operations.get(inv.commitmentId);
      if (op?.phase !== 'physical' || op.links.invasionId !== inv.id) inv.commitmentId = null;
    }
  }
}
