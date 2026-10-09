import {settleTradeProposal} from '../gameplay/trade/trade';
import {tradeResourceClaims,availableResource} from '../gameplay/trade/resources';
import { timerRemaining } from './proactiveCognition';
import { settlePeaceProposal } from '../gameplay/diplomacy/peace';
import { availableLocalTroops, reinforcementProblem, allocateReinforcement } from '../gameplay/recruitment/reinforcement';
import { AICommitment } from '../types';
import { AIOperation, AIOperationClaim } from '../types/AIOperation';
import { GameState } from '../types/GameState';
import { AIConcretePlan, cloneConcretePlan, comparePlanIds } from '../types/AIConcretePlan';
import { applyCommitmentOutcomeFeedback } from './outcomeFeedback';
import { OrchestrationError, ErrorCode } from '../orchestration/errors';
import { emptyOperationAttention } from './strategicAttention';
import { finishDecisionInitiation } from './decisionOpportunities';

// Optimization only: membership proves a deeply frozen record. It stores no
// world facts, sequences or outcomes; hydration/restart always has identical data.
const immutableTerminals = new WeakSet<AIOperation>();
/** Immutability proof only; never proves current-world validity. */
export function isImmutableTerminalOperation(op: AIOperation): boolean { return immutableTerminals.has(op); }
function freezeTerminal(op: AIOperation): AIOperation {
  // Settlement can also receive manually constructed compatibility records.
  // Freeze an isolated plan rather than assuming every caller used our factory.
  if (op.plan !== undefined) op.plan = cloneConcretePlan(op.plan);
  if(op.initiationTimer){Object.freeze(op.initiationTimer.progress);Object.freeze(op.initiationTimer);}
  Object.freeze(op.reason);
  op.factorBreakdown.forEach(Object.freeze); Object.freeze(op.factorBreakdown);
  Object.freeze(op.claimIds); Object.freeze(op.links); Object.freeze(op.terminal); Object.freeze(op.attention);
  Object.freeze(op); immutableTerminals.add(op);
  return op;
}
export function cloneOperation(op: AIOperation): AIOperation {
  // Terminal records are deeply immutable, so transaction clones can safely
  // share them. Live operations/claims are always copied. This avoids repeatedly
  // rebuilding completed exact plans during long offline catch-up.
  if (immutableTerminals.has(op)) return op;
  const copy = { ...op, ...(op.plan !== undefined ? { plan: cloneConcretePlan(op.plan) } : {}),
    ...(op.initiationTimer ? { initiationTimer: { ...op.initiationTimer, progress: { ...op.initiationTimer.progress } } } : {}),
    reason: [...op.reason], factorBreakdown: op.factorBreakdown.map(f => ({ ...f })),
    claimIds: [...op.claimIds], links: { ...op.links }, attention: { ...op.attention }, terminal: op.terminal ? { ...op.terminal } : null };
  return copy.terminal ? freezeTerminal(copy) : copy;
}
export function operationFromSelection(c: AICommitment, tick: number): AIOperation {
  return cloneOperation({ ...c, phase: 'selected', objective: 'valid', createdAtTick: tick,
    claimIds: [], links: {}, terminal: null, attention: emptyOperationAttention(c.warlordId) });
}
/** Derived live-key index on the canonical Map. Only entries are serialized.
 * Map mutation methods keep keys synchronized; records remain authoritative.
 * Rebuilt on clone/hydration. No independent facts or history retention policy.
 */
const liveKeys = new WeakMap<Map<string, AIOperation>, Set<string>>();
function indexOperationMap(map: Map<string, AIOperation>, keys: Set<string>): Map<string, AIOperation> {
  liveKeys.set(map, keys);
  Object.defineProperties(map, {
    set: { value: function(this: Map<string, AIOperation>, id: string, op: AIOperation) {
      if (op.phase === 'terminal') op = cloneOperation(op);
      Map.prototype.set.call(this, id, op);
      const index = liveKeys.get(this);
      if (op.phase === 'terminal') index?.delete(id); else index?.add(id);
      return this;
    } },
    delete: { value: function(this: Map<string, AIOperation>, id: string) {
      liveKeys.get(this)?.delete(id); return Map.prototype.delete.call(this, id);
    } },
    clear: { value: function(this: Map<string, AIOperation>) {
      liveKeys.get(this)?.clear(); Map.prototype.clear.call(this);
    } },
  });
  return map;
}
export function createOperationMap(entries?: Iterable<readonly [string, AIOperation]>): Map<string, AIOperation> {
  const map = indexOperationMap(new Map(), new Set());
  if (entries) for (const [id, op] of entries) map.set(id, op);
  return map;
}
export function cloneOperations(operations: Map<string, AIOperation>): Map<string, AIOperation> {
  const keys = liveKeys.get(operations);
  if (keys) {
    // Indexed maps admit terminal entries only after deep freezing. Native Map
    // copying preserves every historical entry without JS per-record rebuilding;
    // live records (including an in-place terminal transition) remain isolated.
    const copy = indexOperationMap(new Map(operations), new Set(keys));
    for (const id of keys) copy.set(id, cloneOperation(operations.get(id)!));
    return copy;
  }
  // Plain/hydrated maps have no immutability proof yet. Deep-copy everything.
  const copy = createOperationMap();
  for (const [id, op] of operations) copy.set(id, cloneOperation(op));
  return copy;
}
export function sortedOperations(state: GameState, factionId?: string): AIOperation[] {
  return [...state.operations.values()].filter(o => factionId === undefined || o.warlordId === factionId)
    .sort((a, b) => comparePlanIds(a.id, b.id));
}
export function activeOperations(state: GameState, factionId?: string): AIOperation[] {
  const keys = liveKeys.get(state.operations);
  const values = keys ? [...keys].map(id => state.operations.get(id)!) : state.operations.values();
  return [...values].filter(o => o.phase !== 'terminal' && (factionId === undefined || o.warlordId === factionId))
    .sort((a, b) => comparePlanIds(a.id, b.id));
}
export function claimIdentity(kind: AIOperationClaim['kind'], subjectId: string, scopeFactionId?: string, operationId?: string): string {
  if(kind === 'local_troops') return `local_troops:${JSON.stringify([subjectId, operationId])}`;
  return kind === 'engagement_target' ? `${kind}:${JSON.stringify([scopeFactionId, subjectId])}` : `${kind}:${subjectId}`;
}
export function requiredClaims(plan: AIConcretePlan, operationId: string, state?: GameState, linkedInvasion = false): AIOperationClaim[] {
  const claim = (kind: AIOperationClaim['kind'], subjectId: string): AIOperationClaim =>
    ({ id: claimIdentity(kind, subjectId, plan.factionId, operationId), operationId, kind, subjectId,
      ...(kind === 'engagement_target' ? { scopeFactionId: plan.factionId } : {}) });
  switch (plan.action) {
    case 'ATTACK': return [claim('force', plan.armyId), claim('engagement_target', plan.targetTerritoryId),
      ...(linkedInvasion || (state?.playerFactionId && state.territories.get(plan.targetTerritoryId)?.owner === state.playerFactionId)
        ? [claim('invasion_target', plan.targetTerritoryId)] : [])];
    case 'MOVE': case 'RETREAT': return [claim('force', plan.armyId)];
    case 'TRADE': return tradeResourceClaims(plan,operationId);
    case 'BUILD': return [claim('construction_site', plan.territoryId)];
    case 'REINFORCE': return [{...claim('local_troops', plan.territoryId),quantity:plan.quantity},
      plan.destination.kind==='army'?claim('force',plan.destination.armyId):claim('garrison',plan.territoryId)];
    default: return [];
  }
}
export function assertClaimAvailable(state: GameState, kind: AIOperationClaim['kind'], subjectId: string, operationId?: string | null, scopeFactionId?: string): void {
  const claim = state.operationClaims.get(claimIdentity(kind, subjectId, scopeFactionId));
  if (claim && claim.operationId !== operationId) throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, `${kind} ${subjectId} is claimed by ${claim.operationId}`);
}
export function acquireOperationClaims(state: GameState, op: AIOperation): void {
  if (!op.plan) throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED, 'Incomplete legacy reasoning cannot start an operation');
  const claims = requiredClaims(op.plan, op.id, state);
  if(op.plan.action==='REINFORCE' && availableLocalTroops(state,op.plan.territoryId,op.id)<op.plan.quantity)
    throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Local troop quantity already claimed');
  if(op.plan.action==='TRADE' && claims.some(c=>availableResource(state,op.plan!.factionId,c.resourceType!,op.id)<c.quantity!))throw new OrchestrationError(ErrorCode.ACTION_NOT_ALLOWED,'Offered resource quantity already claimed');
  for (const c of claims.filter(c=>c.kind!=='local_troops'&&c.kind!=='resource')) assertClaimAvailable(state, c.kind, c.subjectId, op.id, c.scopeFactionId);
  // All conflicts checked before any writes. Domain start itself runs on an isolated draft.
  for (const c of claims) state.operationClaims.set(c.id, c);
  op.claimIds = claims.map(c => c.id).sort(comparePlanIds);
}
/** Exactly-once terminal reducer. No unfinished physical lifecycle may be erased here. */
export function settleOperation(state: GameState, id: string, outcome: 'completed' | 'failed' | 'interrupted', reason: string): boolean {
  const op = state.operations.get(id);
  if (!op || op.terminal) return false;
  if(op.plan?.action==='TRADE') {
    const p=op.links.tradeProposalId?state.tradeProposals.get(op.links.tradeProposalId):undefined;
    if(p&&['initiating','pending'].includes(p.status))return outcome==='completed'?false:settleTradeProposal(state,p.id,'invalidated');
    if(outcome==='completed'&&p?.status!=='accepted')return false;
  }
  if(op.plan?.action==='OFFER_PEACE') {
    const proposal=op.links.peaceProposalId?state.peaceProposals.get(op.links.peaceProposalId):undefined;
    if(proposal&&['initiating','pending'].includes(proposal.status))
      return outcome==='completed'?false:settlePeaceProposal(state,proposal.id,'invalidated');
    if(outcome==='completed'&&proposal?.status!=='accepted')return false;
  }
  const project = op.links.constructionId ? state.constructions.get(op.links.constructionId) : undefined;
  // A reasoning failure is not a construction cancellation. The domain must
  // complete or destroy its project before its exclusive site can be released.
  if (project?.status === 'in_progress') return false;
  const army = op.links.armyId ? state.armies.get(op.links.armyId) : undefined;
  if (op.links.invasionId && state.activeInvasions.has(op.links.invasionId)) {
    if (!army) {
      // The army may be destroyed by another battle. Release only the extinct
      // force; the invasion domain still owns its existing response/deadline.
      op.objective = 'invalid'; op.phase = 'recovery'; op.status = 'executing'; op.statusReason = reason;
      for (const claimId of [...op.claimIds]) {
        const c = state.operationClaims.get(claimId);
        if (c?.operationId === id && c.kind === 'force') {
          state.operationClaims.delete(claimId); op.claimIds = op.claimIds.filter(x => x !== claimId);
        }
      }
    }
    return false;
  }
  if (army?.movement && ['moving', 'blocked'].includes(army.movement.status) && army.movement.commitmentId === id) {
    if (outcome === 'completed') return false;
    op.objective = 'invalid'; op.phase = 'recovery'; op.status = 'executing'; op.statusReason = reason;
    // The objective target no longer needs an engagement slot; keep the force.
    for (const claimId of [...op.claimIds]) {
      const c = state.operationClaims.get(claimId);
      if (c?.operationId === id && (c.kind === 'engagement_target' || c.kind === 'invasion_target')) {
        state.operationClaims.delete(claimId); op.claimIds = op.claimIds.filter(x => x !== claimId);
      }
    }
    return false; // Keep force/claims until the already-started march reaches its physical boundary.
  }
  if(op.plan?.action==='REINFORCE' && outcome==='completed') {
    // Exact allocation and terminal accounting are one canonical transition.
    // An early/duplicate terminal call can neither allocate nor fake success.
    if(!op.initiationTimer || timerRemaining(state,op.initiationTimer)>0 || reinforcementProblem(state,op.plan,id))return false;
    if(requiredClaims(op.plan,id,state).some(c=>state.operationClaims.get(c.id)?.operationId!==id))return false;
    allocateReinforcement(state,op.plan,id);
    finishDecisionInitiation(state,id,true);
  }
  op.status = outcome; op.phase = 'terminal'; op.statusReason = reason;
  op.terminal = { outcome, reason, atTick: state.worldTick };
  if (op.attention.acquiredAtTick !== null) op.attention.releasedAtTick = state.worldTick;
  finishDecisionInitiation(state, id, false);
  for (const claimId of op.claimIds) {
    if (state.operationClaims.get(claimId)?.operationId === id) state.operationClaims.delete(claimId);
  }
  op.claimIds = [];
  if (army?.attackIntent?.commitmentId === id) army.attackIntent = null;
  if (project?.aiOperationId === id) delete project.aiOperationId;
  if (!op.legacyFeedbackApplied) applyCommitmentOutcomeFeedback(state, op.warlordId, op, outcome);
  freezeTerminal(op);
  state.operations.set(id, op); // Refresh the derived live-key index.
  return true;
}

/** Domain mutations may invalidate an unfinished allocation before its timer
 * boundary (conquest, force destruction, invasion). Settle on the transaction
 * draft before validation; this cannot reroute, create troops, grant relief or
 * touch a preceding committed state. */
export function cancelInvalidReinforcements(state:GameState):void {
  for(const op of activeOperations(state))if(op.plan?.action==='REINFORCE'&&op.phase==='physical') {
    const problem=reinforcementProblem(state,op.plan,op.id);
    if(problem)settleOperation(state,op.id,'failed',problem);
  }
}
