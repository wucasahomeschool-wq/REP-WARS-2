import {bankedTroops} from '../gameplay/military/troopBank';
import { isContentFingerprint } from '../worldDefinition/contentIdentity';
import { RESPONSE_POLICY } from '../constants/aiResponse';
import { validateCompletionRewardEntitlement } from '../rewards/completionEntitlement';
import { armySequenceFloor } from '../army/identity';
import {responseStateProblems} from './responseInvariants';
import {conflictStateProblems} from './conflictInvariants';
import {cognitionStateProblems} from './cognitionInvariants';
import {tradeStateProblems} from './tradeInvariants';
import { peaceStateProblems } from './peaceInvariants';
import { REINFORCE_INITIATION } from '../constants/recruitment';
import { RECRUITMENT_WORK_PER_TICK, simulationWork } from '../gameplay/recruitment/recruitment';
import { reinforcementProblem } from '../gameplay/recruitment/reinforcement';
import { pressureStateProblems, sourcePlanBindingProblem } from './pressureInvariants';
import { activeOperations, requiredClaims, claimIdentity, isImmutableTerminalOperation } from '../engine/operations';
import { concretePlanProblem, planTargetId } from '../types/AIConcretePlan';
import { recordedAiCommitmentSequenceFloors } from '../engine/commitmentIdentity';
/**
 * GAMESTATE STRUCTURAL INVARIANTS (AUTHORITATIVE RUNTIME GAMESTATE PASS).
 * See docs/AUTHORITATIVE_GAMESTATE_ARCHITECTURE.md, "State invariants".
 *
 * These are structural integrity checks only — they verify the shape of
 * `GameState` is internally consistent (unique ids, valid references, no
 * negative counts, no orphaned/duplicate entities). They do NOT encode new
 * gameplay rules the existing engines don't already enforce (e.g. this
 * file does not decide whether an ATTACK is currently eligible.
 * Structural operation/claim linkage is validated separately from fresh plan
 * eligibility. A changed objective is legal world state until its lifecycle
 * observes invalidation; unfinished physical travel remains authoritative.
 */
import { GameState } from '../types/GameState';
import { collectNeighborGraphIssues } from '../map/graphInvariants';
import { BALANCE } from '../constants/balance';
import { WORLD_TICK_DURATION_MS } from '../world/realtimeClock';
import { validateGameplaySessionLease } from '../world/presenceLeases';

// Successful structural validation of a deeply immutable terminal record is
// reusable. World references, key identity, sequence floors and time bounds are
// still checked against every current transaction. Mutable/hydrated records
// never inherit this proof; corruption is not cached away.
const validatedTerminals = new WeakMap<object, number>();

export interface GameStateInvariantViolation {
  /** Short machine-checkable category, e.g. `'army.negative_troops'`. */
  code: string;
  /** Human-readable detail for test failures/logging. */
  message: string;
}

function isOpenInvasionStatus(status: string): boolean {
  return status === 'pending_response' || status === 'defense_in_progress';
}

/**
 * Returns the list of invariant violations found in `state`. An empty
 * array means `state` is structurally valid. Never throws — callers
 * (tests, a future Orchestrator) decide what to do with violations.
 */
function checkGameplaySessionLeases(
  state: GameState,
  push: (code: string, message: string) => void,
): void {
  const leases = state.gameplaySessionLeases;
  if (!Array.isArray(leases)) {
    push('world.invalid_gameplay_session_leases', 'gameplaySessionLeases must be an array');
    return;
  }
  const seen = new Set<string>();
  const openRequests = new Set<string>();
  for (const lease of leases) {
    let valid;
    try {
      valid = validateGameplaySessionLease(lease);
    } catch {
      push('world.invalid_gameplay_session_leases', 'gameplaySessionLeases contains invalid authority');
      return;
    }
    if (seen.has(valid.sessionId)) {
      push('world.invalid_gameplay_session_leases', 'gameplaySessionLeases contains a duplicate session id');
      return;
    }
    seen.add(valid.sessionId);
    if (valid.openedByRequestId != null) {
      if (openRequests.has(valid.openedByRequestId)) {
        push('world.invalid_gameplay_session_leases', 'gameplaySessionLeases contains a duplicate open request id');
        return;
      }
      openRequests.add(valid.openedByRequestId);
    }
  }
}

export function checkGameStateInvariants(state: GameState): GameStateInvariantViolation[] {
  const violations: GameStateInvariantViolation[] = [];
  if (state.definitionContentFingerprint !== null && !isContentFingerprint(state.definitionContentFingerprint)) {
    violations.push({ code: 'world.invalid_content_fingerprint', message: 'World content fingerprint must be null or a versioned SHA-256 digest' });
  }
  const push = (code: string, message: string) => violations.push({ code, message });
  for(const message of responseStateProblems(state))push('response.invalid_state',message);
  for(const message of cognitionStateProblems(state))push('cognition.invalid_state',message);
  for(const message of peaceStateProblems(state)) push('peace.invalid_state',message);
  for(const message of pressureStateProblems(state)) push('pressure.invalid_state',message);
  if (!(state.operations instanceof Map) || !(state.operationClaims instanceof Map)) {
    push('operation.missing_storage', 'canonical operation and claim maps are required');
    for(const problem of conflictStateProblems(state))push('conflict.invalid_state',problem);
    return violations;
  }
  if (!state.strategicAttention || !Number.isSafeInteger(state.strategicAttention.capacity) || state.strategicAttention.capacity < 0)
    push('attention.invalid_capacity', 'Per-faction ordinary capacity must be a non-negative safe integer');
  if (!(state.aiDecisionOpportunities instanceof Map)) {
    push('opportunity.missing_storage', 'Canonical decision opportunities are required'); return violations;
  }
  for (const [factionId, opportunity] of state.aiDecisionOpportunities) {
    if (!opportunity || !state.factions.has(factionId)) { push('opportunity.invalid_owner', `Opportunity owner ${factionId} is invalid`); continue; }
    if (opportunity.lastBoundaryTick !== null && (!Number.isSafeInteger(opportunity.lastBoundaryTick) || opportunity.lastBoundaryTick < 0 || opportunity.lastBoundaryTick > state.worldTick))
      push('opportunity.invalid_boundary', `Opportunity ${factionId} has invalid boundary`);
    if (opportunity.primaryOperationId !== null) {
      const primary = state.operations.get(opportunity.primaryOperationId);
      if (!primary || primary.warlordId !== factionId || !(primary.phase === 'selected' || ['REINFORCE','OFFER_PEACE','TRADE'].includes(primary.action) && primary.phase === 'physical'))
        push('opportunity.invalid_primary', `Opportunity ${factionId} does not own a pending initiation`);
    }
  }

  if (!Number.isInteger(state.worldTick) || state.worldTick < 0 || !Number.isFinite(state.worldTick)) {
    push('world.invalid_tick', `worldTick ${state.worldTick} must be a non-negative integer`);
  }
  if (state.lastProcessedAtMs !== null && (!Number.isInteger(state.lastProcessedAtMs) || !Number.isFinite(state.lastProcessedAtMs))) {
    push('world.invalid_processed_at', `lastProcessedAtMs ${String(state.lastProcessedAtMs)} must be an integer epoch millisecond or null`);
  }
  if (!Number.isSafeInteger(state.accruedTargetWorldTick) || state.accruedTargetWorldTick < 0) {
    push('world.invalid_accrued_target', `accruedTargetWorldTick ${String(state.accruedTargetWorldTick)} must be a non-negative safe integer`);
  }
  if (
    !Number.isInteger(state.subTickMicroticks)
    || state.subTickMicroticks < 0
    || state.subTickMicroticks >= BALANCE.temporal.microticksPerSimulationTick
  ) {
    push('world.invalid_subtick', `subTickMicroticks ${String(state.subTickMicroticks)} is outside the fixed-point range`);
  }
  if (
    !Number.isInteger(state.accrualDivisionRemainder)
    || state.accrualDivisionRemainder < 0
    || state.accrualDivisionRemainder >= WORLD_TICK_DURATION_MS
  ) {
    push('world.invalid_accrual_remainder', `accrualDivisionRemainder ${String(state.accrualDivisionRemainder)} is outside the fixed-point range`);
  }
  if (state.lastAccrualAtMs !== null && !Number.isSafeInteger(state.lastAccrualAtMs)) {
    push('world.invalid_accrual_at', `lastAccrualAtMs ${String(state.lastAccrualAtMs)} must be a safe integer epoch millisecond or null`);
  }
  if (state.lastAccrualAtMs === null && (state.subTickMicroticks !== 0 || state.accrualDivisionRemainder !== 0)) {
    push('world.unanchored_fraction', 'Fractional accrual cannot exist before lastAccrualAtMs is set');
  }
  if (
    state.lastAccrualAtMs !== null
    && Number.isSafeInteger(state.worldTick)
    && Number.isSafeInteger(state.accruedTargetWorldTick)
    && state.worldTick > state.accruedTargetWorldTick
  ) {
    push(
      'world.accrued_target_behind',
      `worldTick ${state.worldTick} is ahead of accruedTargetWorldTick ${state.accruedTargetWorldTick}`,
    );
  }
  checkGameplaySessionLeases(state, push);
  if (!Number.isInteger(state.lastFoodConsumptionTick) || state.lastFoodConsumptionTick < 0 || !Number.isFinite(state.lastFoodConsumptionTick)) {
    push('economy.invalid_food_consumption_tick', `lastFoodConsumptionTick ${state.lastFoodConsumptionTick} must be a non-negative integer`);
  }
  if (!Number.isInteger(state.turn) || !Number.isFinite(state.turn)) {
    push('world.invalid_turn', `turn ${state.turn} must be a finite integer`);
  }
  for (const [fid, tick] of state.lastAiDecisionTick.entries()) {
    if (!state.factions.has(fid)) {
      push('world.unknown_decision_faction', `lastAiDecisionTick has an entry for unknown faction ${fid}`);
    }
    if (!Number.isInteger(tick) || !Number.isFinite(tick)) {
      push('world.invalid_decision_tick', `lastAiDecisionTick[${fid}] is ${tick}`);
    }
  }

  // ---- unique / consistent ids ----
  const factionIdSet = new Set(state.allFactionIds);
  if (factionIdSet.size !== state.allFactionIds.length) {
    push('faction.duplicate_id', 'allFactionIds contains duplicate faction ids');
  }
  for (const fid of state.allFactionIds) {
    if (!state.factions.has(fid)) {
      push('faction.missing_from_map', `allFactionIds lists ${fid}, but factions map has no entry for it`);
    }
  }
  for (const [key, snap] of state.factions.entries()) {
    if (key !== snap.id) {
      push('faction.key_id_mismatch', `factions map key ${key} does not match WarlordSnapshot.id ${snap.id}`);
    }
    if (!factionIdSet.has(key)) {
      push('faction.missing_from_all_ids', `factions map has ${key}, but allFactionIds does not list it`);
    }
  }
  for (const [key, t] of state.territories.entries()) {
    if (key !== t.id) {
      push('territory.key_id_mismatch', `territories map key ${key} does not match Territory.id ${t.id}`);
    }
  }
  if (!Number.isSafeInteger(state.nextArmySequence) || state.nextArmySequence < 0
    || state.nextArmySequence < armySequenceFloor(state.armies.keys())) {
    push('army.invalid_identity_sequence', 'Army identity sequence is missing, invalid or below existing runtime identities');
  }
  for (const [key, a] of state.armies.entries()) {
    if (key !== a.id) {
      push('army.key_id_mismatch', `armies map key ${key} does not match Army.id ${a.id}`);
    }
  }

  // ---- territory ownership references a valid faction ----
  for (const t of state.territories.values()) {
    if (t.owner !== null && !state.factions.has(t.owner)) {
      push('territory.invalid_owner', `territory ${t.id} owner ${t.owner} is not a known faction`);
    }
  }

  const seenAnchors = new Set<string>();
  for (const id of state.levelAnchorTerritoryIds ?? []) {
    if (seenAnchors.has(id)) {
      push('anchor.duplicate_id', `levelAnchorTerritoryIds contains duplicate ${id}`);
    }
    seenAnchors.add(id);
    if (!state.territories.has(id)) {
      push('anchor.unknown_territory', `levelAnchorTerritoryIds lists unknown territory ${id}`);
    }
  }
  const defeat = state.levelDefeat;
  if (!defeat || (defeat.status !== 'active' && defeat.status !== 'defeated')) {
    push('level.invalid_defeat_status', `levelDefeat.status is ${String(defeat?.status)}`);
  } else if (!Array.isArray(defeat.previousWorldIds)) {
    push('level.invalid_previous_worlds', 'levelDefeat.previousWorldIds must be an array');
  }

  const tutorial = state.level1Tutorial;
  if (tutorial !== null && tutorial !== undefined) {
    const beat = tutorial.beat;
    if (
      beat !== 'FIRST_WORKOUT_PENDING'
      && beat !== 'FIRST_ATTACK_AVAILABLE'
      && beat !== 'SCRIPTED_ATTACK_PENDING'
      && beat !== 'DEFENSE_PENDING'
      && beat !== 'FINAL_WORKOUT_PENDING'
      && beat !== 'FINAL_ATTACK_AVAILABLE'
      && beat !== 'COMPLETE'
    ) {
      push('tutorial.invalid_beat', `level1Tutorial.beat is ${String(beat)}`);
    }
    if (typeof tutorial.active !== 'boolean' || typeof tutorial.completed !== 'boolean') {
      push('tutorial.invalid_flags', 'level1Tutorial.active and completed must be booleans');
    }
  }

  // ---- army owner/location references are valid ----
  for (const a of state.armies.values()) {
    if (!state.factions.has(a.owner)) {
      push('army.invalid_owner', `army ${a.id} owner ${a.owner} is not a known faction`);
    }
    if (!state.territories.has(a.location) && !(a.movement?.status === 'blocked' && a.location === a.movement.originTerritoryId)) {
      push('army.invalid_location', `army ${a.id} location ${a.location} is not a known territory`);
    }
    if (a.soldiers < 0 || a.knights < 0 || a.siegeEngines < 0) {
      push('army.negative_troops', `army ${a.id} has a negative troop/siege count`);
    }
    if (a.morale < 0 || a.supply < 0) {
      push('army.negative_morale_or_supply', `army ${a.id} has negative morale or supply`);
    }
    // NO-RETREAT RULE (Phase 4): a losing army is eliminated (removed from
    // the map entirely), never left behind with zero fighting strength.
    // See docs/BATTLE_ENGINE_CORRECTNESS.md and `cli.ts`'s `eliminateArmies`.
    if (a.soldiers + a.knights + a.siegeEngines <= 0) {
      push('army.defeated_but_present', `army ${a.id} has 0 total troops/siege but is still present in the canonical armies map`);
    }
    const ownerSnap = state.factions.get(a.owner);
    if (ownerSnap && !ownerSnap.armies.includes(a.id)) {
      push('army.not_listed_by_owner', `army ${a.id} owner ${a.owner} does not list this army in armies[]`);
    }
    const mv = a.movement;
    if (mv && (mv.status === 'moving' || mv.status === 'blocked')) {
      if (mv.status !== 'blocked' && !state.territories.has(mv.originTerritoryId)) {
        push('army.invalid_movement_origin', `army ${a.id} movement origin ${mv.originTerritoryId} is not a known territory`);
      }
      if (mv.status !== 'blocked' && !state.territories.has(mv.destinationTerritoryId)) {
        push('army.invalid_movement_destination', `army ${a.id} movement destination ${mv.destinationTerritoryId} is not a known territory`);
      }
      if (a.location !== mv.originTerritoryId) {
        push('army.moving_location_mismatch', `army ${a.id} is moving from ${mv.originTerritoryId} but location is ${a.location}`);
      }
      if (!Number.isInteger(mv.durationTicks) || mv.durationTicks < 1) {
        push('army.invalid_movement_duration', `army ${a.id} movement durationTicks ${mv.durationTicks} must be an integer >= 1`);
      }
      if (!Number.isInteger(mv.startedAtTick) || mv.startedAtTick < 0) {
        push('army.invalid_movement_start', `army ${a.id} movement startedAtTick ${mv.startedAtTick} is invalid`);
      }
    }
    if (mv?.status === 'blocked' && (!Number.isSafeInteger(mv.haltedAtTick) || mv.haltedAtTick! < mv.startedAtTick || mv.haltedAtTick! > state.worldTick || !mv.interruptionReason))
      push('army.invalid_movement_halt', `army ${a.id} blocked march lacks its physical boundary/reason`);
    if (mv && mv.status !== 'blocked' && (mv.haltedAtTick !== undefined || mv.interruptionReason !== undefined))
      push('army.invalid_movement_halt', `army ${a.id} unblocked march carries halt state`);
    const intent = a.attackIntent;
    if (intent) {
      if (!state.territories.has(intent.targetTerritoryId)) {
        push('army.invalid_attack_target', `army ${a.id} attackIntent target ${intent.targetTerritoryId} is not a known territory`);
      }
      if (!state.territories.has(intent.stagingTerritoryId)) {
        push('army.invalid_attack_staging', `army ${a.id} attackIntent staging ${intent.stagingTerritoryId} is not a known territory`);
      }
      if (intent.stagingTerritoryId === intent.targetTerritoryId) {
        push('army.attack_stages_on_target', `army ${a.id} attackIntent staging equals target ${intent.targetTerritoryId}`);
      }
      if (intent.status === 'pending_movement') {
        if (mv && (mv.status === 'moving' || mv.status === 'blocked')) {
          if (mv.destinationTerritoryId !== intent.stagingTerritoryId) {
            push('army.attack_intent_dest_mismatch', `army ${a.id} is moving to ${mv.destinationTerritoryId} but attack staging is ${intent.stagingTerritoryId}`);
          }
        } else if (a.location !== intent.stagingTerritoryId) {
          push('army.attack_intent_not_moving', `army ${a.id} has pending_movement attackIntent but is not moving to staging`);
        }
      }
      if (intent.status === 'ready' && a.location !== intent.stagingTerritoryId) {
        push('army.attack_ready_location_mismatch', `army ${a.id} ready attack staging is ${intent.stagingTerritoryId} but location is ${a.location}`);
      }
      if (!Number.isInteger(intent.battleSeed) || !Number.isFinite(intent.battleSeed)) {
        push('army.invalid_attack_battle_seed', `army ${a.id} attackIntent battleSeed ${intent.battleSeed} is not a finite integer`);
      }
      if (intent.holdForInvasionId) {
        const held = state.activeInvasions.get(intent.holdForInvasionId);
        if (!held || !isOpenInvasionStatus(held.status)) {
          push('army.hold_for_resolved_invasion', `army ${a.id} holdForInvasionId ${intent.holdForInvasionId} does not reference an open invasion`);
        }
      }
      if (intent.commitmentId) {
        const c = state.operations.get(intent.commitmentId);
        if (!c || c.warlordId !== a.owner || c.phase === 'terminal') {
          push('army.attack_intent_stale_commitment', `army ${a.id} attackIntent commitment ${intent.commitmentId} is not the owner's active commitment`);
        }
      }
    }
  }

  // ---- faction-level structural checks ----
  const sequenceFloors = recordedAiCommitmentSequenceFloors(state);
  for (const f of state.factions.values()) {
    if (!Number.isSafeInteger(f.nextAiCommitmentSequence) || f.nextAiCommitmentSequence < 0) {
      push('faction.invalid_ai_commitment_sequence', `faction ${f.id} has invalid AI commitment sequence ${f.nextAiCommitmentSequence}`);
    } else if (f.nextAiCommitmentSequence < (sequenceFloors.get(f.id) ?? 0)) {
      push('faction.invalid_ai_commitment_sequence', `faction ${f.id} AI commitment sequence would reuse a recorded ID`);
    }
    const armySeen = new Set<string>();
    for (const aid of f.armies) {
      if (armySeen.has(aid)) {
        push('faction.duplicate_army_ref', `faction ${f.id} lists army ${aid} more than once`);
      }
      armySeen.add(aid);
      const a = state.armies.get(aid);
      if (!a) {
        push('faction.dangling_army_ref', `faction ${f.id} references army ${aid}, which does not exist`);
      }
      else if (a.owner !== f.id) {
        push('faction.army_owner_mismatch', `faction ${f.id} lists army ${aid}, but that army's owner is ${a.owner}`);
      }
    }
    const territorySeen = new Set<string>();
    for (const tid of f.territories) {
      if (territorySeen.has(tid)) {
        push('faction.duplicate_territory_ref', `faction ${f.id} lists territory ${tid} more than once`);
      }
      territorySeen.add(tid);
      const t = state.territories.get(tid);
      if (!t) {
        push('faction.dangling_territory_ref', `faction ${f.id} references territory ${tid}, which does not exist`);
      }
      else if (t.owner !== f.id) {
        // Also covers "captured territory cannot simultaneously have two
        // owners": `Territory.owner` is a single scalar field, and this
        // check ensures every faction's own bookkeeping agrees with it.
        push('faction.territory_owner_mismatch', `faction ${f.id} lists territory ${tid}, but that territory's owner is ${t.owner}`);
      }
    }
    for (const k of Object.keys(f.resources) as (keyof typeof f.resources)[]) {
      const v = f.resources[k];
      if (!Number.isFinite(v) || v < 0) {
        push('faction.malformed_resources', `faction ${f.id} resources.${k} is ${v}`);
      }
    }
    for (const [k, v] of Object.entries(f.resourceIncome)) {
      if (typeof v === 'number' && !Number.isFinite(v)) {
        push('faction.malformed_resource_income', `faction ${f.id} resourceIncome.${k} is ${v}`);
      }
    }
    if (f.ambition < 0 || f.ambition > 1 || !Number.isFinite(f.ambition)) {
      push('faction.invalid_ambition', `faction ${f.id} ambition ${f.ambition} is outside [0, 1]`);
    }
  }

  // ---- territory ↔ faction consistency in the other direction ----
  // (a territory owned by a real faction must actually be listed there)
  for (const t of state.territories.values()) {
    if (t.owner !== null) {
      const owner = state.factions.get(t.owner);
      if (owner && !owner.territories.includes(t.id)) {
        push('territory.owner_does_not_list_it', `territory ${t.id} is owned by ${t.owner}, but that faction's territories[] does not include it`);
      }
    }
  }

  // ---- canonical operations and hard physical claims ----
  const attentionTotals = new Map<string, { ordinary: number; historical: number; emergency:number }>();
  for (const [id, op] of state.operations) {
    const validatedAt = op && validatedTerminals.get(op);
    if (validatedAt !== undefined && state.worldTick >= validatedAt
      && id === op.id && state.factions.has(op.warlordId)) continue;
    const beforeOperation = violations.length;
    if (!op || !Array.isArray(op.claimIds) || !op.links || typeof op.links !== 'object' || Array.isArray(op.links)) {
      push('operation.invalid_shape', `operation ${id} lacks canonical linkage/claims`); continue;
    }
    if(op.hostileCounterpartyId!==undefined&&(op.action!=='ATTACK'||op.hostileCounterpartyId===op.warlordId||!state.factions.has(op.hostileCounterpartyId)))
      push('operation.invalid_hostile_counterparty', `Operation ${id} has invalid opposing faction linkage`);
    if (id !== op.id) push('operation.id_mismatch', `operations key ${id} differs from ${op.id}`);
    const attention = op.attention;
    if (!attention || attention.factionId !== op.warlordId || !Number.isSafeInteger(attention.cost) || attention.cost < 0 || typeof attention.grandfathered !== 'boolean')
      push('attention.invalid_owner_cost', `Operation ${id} has invalid Attention ownership/cost`);
    else {
      const acquired = attention.acquiredAtTick, released = attention.releasedAtTick;
      if (acquired !== null && (!Number.isSafeInteger(acquired) || acquired < op.createdAtTick || acquired > state.worldTick))
        push('attention.invalid_acquisition', `Operation ${id} has invalid Attention boundary`);
      if (released !== null && (acquired === null || !Number.isSafeInteger(released) || released < acquired || released > state.worldTick))
        push('attention.invalid_release', `Operation ${id} has invalid Attention release`);
      if (op.phase === 'terminal' && acquired !== null && released === null)
        push('attention.terminal_charge', `Terminal operation ${id} retains Attention`);
      if (attention.cost > 0 && acquired === null)
        push('attention.missing_acquisition', `Operation ${id} has a charge without acquisition`);
      if (op.terminal && acquired !== null && released !== op.terminal.atTick)
        push('attention.terminal_boundary', `Operation ${id} did not release at its terminal boundary`);
      if (op.phase === 'selected' && (attention.cost !== 0 || acquired !== null || released !== null))
        push('attention.selected_charge', `Selection ${id} acquired Attention before initiation`);
      if (['physical','recovery'].includes(op.phase)) {
        if (['ATTACK','MOVE','RETREAT','BUILD','OFFER_PEACE','TRADE'].includes(op.action) && attention.cost === 0)
          push('attention.missing_physical_cost', `Physical operation ${id} bypasses ordinary Attention`);
        if (released !== null || (attention.cost > 0 && acquired === null)) push('attention.missing_charge', `Physical operation ${id} lacks its charge`);
        const totals = attentionTotals.get(op.warlordId) ?? { ordinary: 0, historical: 0, emergency:0 };
        const emergency=attention.emergency?.overflow??0;
        if(emergency){const context=state.aiResponses.get(attention.emergency!.contextId);if(!Number.isSafeInteger(emergency)||emergency<0||emergency>attention.cost||op.responseContextId!==context?.id||context?.factionId!==op.warlordId||context.lane!=='REACTIVE_EMERGENCY'||!Number.isSafeInteger(attention.emergency!.revision)||attention.emergency!.revision<0||attention.emergency!.revision>context.revision)push('attention.invalid_emergency',`Invalid emergency charge ${id}`);}
        totals[attention.grandfathered ? 'historical' : 'ordinary'] += attention.cost-emergency;
        totals.emergency+=emergency;
        attentionTotals.set(op.warlordId, totals);
      }
    }
    if (!state.factions.has(op.warlordId)) push('operation.unknown_faction', `operation ${id} has unknown faction`);
    if (!['selected','physical','recovery','terminal'].includes(op.phase)) push('operation.invalid_phase', `operation ${id} has invalid phase`);
    if (!Number.isSafeInteger(op.createdAtTick) || op.createdAtTick < 0 || op.createdAtTick > state.worldTick) push('operation.invalid_boundary', `operation ${id} has invalid created boundary`);
    const planProblem = op.plan === undefined ? 'missing' : concretePlanProblem(op.plan);
    if(op.sourceContextId!==undefined && (!op.plan || planProblem || sourcePlanBindingProblem(op.sourceContextId,op.plan)))
      push('operation.invalid_source_binding', `operation ${id} disagrees with its semantic source`);
    if (op.plan !== undefined) {
      const problem = planProblem;
      if (problem) push('commitment.invalid_plan', `operation ${id}: ${problem}`);
      else if (op.plan.action !== op.action || op.plan.factionId !== op.warlordId || planTargetId(op.plan) !== op.targetId)
        push('commitment.plan_mismatch', `operation ${id} metadata disagrees with its plan`);
    } else if (op.phase !== 'terminal') push('operation.incomplete_live_plan', `operation ${id} lacks an exact plan`);
    if ((op.phase === 'terminal') !== (op.terminal !== null)) push('operation.terminal_mismatch', `operation ${id} terminal state disagrees`);
    if (op.terminal && (op.status !== op.terminal.outcome || op.claimIds.length)) push('operation.terminal_claim', `terminal operation ${id} retains claims or mismatched outcome`);
    if (op.terminal && !['completed','failed','interrupted'].includes(op.terminal.outcome)) push('operation.invalid_outcome', `operation ${id} has invalid terminal outcome`);
    if (op.terminal && (!Number.isSafeInteger(op.terminal.atTick) || op.terminal.atTick < op.createdAtTick || op.terminal.atTick > state.worldTick))
      push('operation.invalid_terminal_boundary', `operation ${id} has invalid terminal boundary`);
    if (op.phase === 'selected' && (op.claimIds.length || Object.keys(op.links).length || !['pending','committed'].includes(op.status)))
      push('operation.selected_physical_state', `selected operation ${id} owns physical state`);
    if (['physical','recovery'].includes(op.phase) && op.status !== 'executing') push('operation.status_mismatch', `physical operation ${id} is not executing`);
    if (!['valid','invalid'].includes(op.objective) || (op.phase === 'recovery' && op.objective !== 'invalid'))
      push('operation.invalid_objective', `operation ${id} objective/phase disagrees`);
    if (new Set(op.claimIds).size !== op.claimIds.length) push('operation.duplicate_claim', `operation ${id} duplicates claim references`);
    for (const claimId of op.claimIds) if (state.operationClaims.get(claimId)?.operationId !== id)
      push('operation.missing_claim', `operation ${id} lacks owned claim ${claimId}`);
    if ((op.phase === 'physical' || op.phase === 'recovery') && op.plan && !planProblem) {
      if (!['ATTACK','MOVE','RETREAT','BUILD','REINFORCE','OFFER_PEACE','TRADE'].includes(op.plan.action)) push('operation.unavailable_physical_action', `operation ${id} has no implemented physical lifecycle`);
      const extinctInvader = op.phase === 'recovery' && !!op.links.invasionId && state.activeInvasions.has(op.links.invasionId)
        && 'armyId' in op.plan && !state.armies.has(op.plan.armyId);
      for (const c of requiredClaims(op.plan, id, state, !!op.links.invasionId).filter(c => extinctInvader ? c.kind !== 'force' : op.phase !== 'recovery' || c.kind === 'force')) if (state.operationClaims.get(c.id)?.operationId !== id)
        push('operation.missing_claim', `physical operation ${id} lacks ${c.id}`);
      if ('armyId' in op.plan) {
        const army = state.armies.get(op.plan.armyId);
        if (!extinctInvader && (!army || army.owner !== op.warlordId || op.links.armyId !== army.id)) push('operation.invalid_force_link', `operation ${id} force linkage disagrees`);
        if (army?.movement && army.movement.commitmentId !== id) push('operation.movement_link', `operation ${id} does not own its physical march`);
        if (army?.attackIntent && army.attackIntent.commitmentId !== id) push('operation.attack_link', `operation ${id} does not own its attack intent`);
        const destination = op.plan.action === 'ATTACK' ? op.plan.stagingTerritoryId
          : op.plan.action === 'MOVE' ? op.plan.destinationTerritoryId : op.plan.fallbackTerritoryId;
        if (army?.movement && (army.movement.originTerritoryId !== op.plan.originTerritoryId || army.movement.destinationTerritoryId !== destination))
          push('operation.movement_plan_mismatch', `operation ${id} physical route differs from exact plan`);
        if (op.plan.action === 'ATTACK' && army?.attackIntent && (army.attackIntent.targetTerritoryId !== op.plan.targetTerritoryId
          || army.attackIntent.stagingTerritoryId !== op.plan.stagingTerritoryId || army.attackIntent.onlyArmyId !== op.plan.armyId))
          push('operation.attack_plan_mismatch', `operation ${id} attack intent differs from exact plan`);
        if (!extinctInvader && !army?.movement && !army?.attackIntent) push('operation.missing_physical_force', `operation ${id} has no ongoing force lifecycle`);
      }
      if (op.plan.action === 'BUILD') {
        const project = op.links.constructionId ? state.constructions.get(op.links.constructionId) : undefined;
        if (!project || project.aiOperationId !== id || project.factionId !== op.warlordId || project.status !== 'in_progress'
          || project.territoryId !== op.plan.territoryId || project.projectType !== op.plan.projectType)
          push('operation.invalid_construction_link', `operation ${id} construction linkage disagrees`);
      }
    }
    if (violations.length === beforeOperation && isImmutableTerminalOperation(op))
      validatedTerminals.set(op, state.worldTick);
  }
  for (const [factionId, totals] of attentionTotals) {
    if(totals.emergency>RESPONSE_POLICY.emergencyExtraCapacity)push('attention.emergency_over_capacity',`Faction ${factionId} exceeds narrow emergency allowance`);
    if (totals.ordinary > state.strategicAttention?.capacity || (!totals.historical && totals.ordinary + totals.historical > state.strategicAttention?.capacity))
      push('attention.ordinary_over_capacity', `Faction ${factionId} exceeds normal capacity without historical work`);
  }
  for (const [id, claim] of state.operationClaims) {
    if (!claim || typeof claim !== 'object') { push('claim.invalid_shape', `claim ${id} is malformed`); continue; }
    const op = state.operations.get(claim.operationId);
    if (!['force','construction_site','engagement_target','invasion_target','banked_troops','local_troops','garrison','resource'].includes(claim.kind)) push('claim.invalid_kind', `claim ${id} has unknown kind`);
    if (id !== claim.id || claim.kind!=='resource'&&id !== claimIdentity(claim.kind, claim.subjectId, claim.scopeFactionId, claim.operationId)) push('claim.invalid_identity', `claim ${id} has inconsistent subject identity`);
    if (!op || op.phase === 'terminal' || !op.claimIds?.includes(id)) push('claim.orphan', `claim ${id} has no active owning operation`);
    if (op?.plan && !concretePlanProblem(op.plan) && !requiredClaims(op.plan, op.id, state, !!op.links.invasionId).some(c => c.id === id))
      push('claim.plan_mismatch', `claim ${id} is not required by its owner's exact plan`);
    if (claim.kind === 'engagement_target' && claim.scopeFactionId !== op?.warlordId) push('claim.invalid_scope', `claim ${id} faction scope disagrees`);
    if (claim.kind==='banked_troops'?!state.factions.has(claim.subjectId):claim.kind==='resource'?!state.factions.has(claim.scopeFactionId!):claim.kind === 'force' ? !state.armies.has(claim.subjectId) : !state.territories.has(claim.subjectId))
      push('claim.missing_subject', `claim ${id} subject no longer exists`);
  }
  if(!Number.isSafeInteger(state.empireFoodBaselinePerCycle)||state.empireFoodBaselinePerCycle<0)push('economy.invalid_baseline','Invalid empire Food baseline');
  if(!Array.isArray(state.completedWorldIds)||state.completedWorldIds.some(id=>typeof id!=='string'||!id)||new Set(state.completedWorldIds).size!==state.completedWorldIds.length)push('campaign.invalid_trophies','Invalid completed worlds');
  for(const t of state.territories.values())if(t.foodUpkeep!==undefined&&(!Number.isSafeInteger(t.foodUpkeep)||t.foodUpkeep<0))push('economy.invalid_upkeep','Invalid territory Food upkeep');
  const banks=new Map<string,number>();
  for(const c of state.operationClaims.values())if(c.kind==='banked_troops'){
    if(!Number.isSafeInteger(c.quantity)||c.quantity!<=0)push('claim.invalid_bank_quantity','Invalid bank reservation');
    banks.set(c.subjectId,(banks.get(c.subjectId)??0)+(c.quantity??0));
    const op=state.operations.get(c.operationId);
    if(op?.plan?.action!=='REINFORCE'||op.plan.quantity!==c.quantity||op.warlordId!==c.subjectId)push('claim.bank_mismatch','Invalid bank claim owner');
  }
  for(const f of state.factions.values())if(!Number.isSafeInteger(bankedTroops(state,f.id))||bankedTroops(state,f.id)<(banks.get(f.id)??0)||bankedTroops(state,f.id)<0)push('recruitment.invalid_bank','Invalid or over-reserved faction troop bank');
  const quantities = new Map<string,number>();
  for(const claim of state.operationClaims.values())if(claim.kind==='local_troops') {
    if(!Number.isSafeInteger(claim.quantity)||claim.quantity!<=0)push('claim.invalid_quantity',`Invalid local quantity ${claim.id}`);
    quantities.set(claim.subjectId,(quantities.get(claim.subjectId)??0)+(claim.quantity??0));
    const op=state.operations.get(claim.operationId);
    if(op?.plan?.action!=='REINFORCE'||op.plan.quantity!==claim.quantity)push('claim.quantity_mismatch',`Claim ${claim.id} changed selected quantity`);
  }
  let earnedRecruitmentFrontier:bigint|undefined;
  try {
    const processed=BigInt(state.worldTick)*RECRUITMENT_WORK_PER_TICK;
    const accrued=simulationWork({wholeTicks:state.accruedTargetWorldTick,subTickMicroticks:state.subTickMicroticks,accrualDivisionRemainder:state.accrualDivisionRemainder});
    earnedRecruitmentFrontier=processed>accrued?processed:accrued;
  } catch { /* Invalid clock fields already have their own structural violations. */ }
  if(!(state.territoryRecruitment instanceof Map))push('recruitment.missing_map','Canonical local recruitment map missing');
  else for(const [id,pool] of state.territoryRecruitment) {
    if(!pool||typeof pool!=='object'){push('recruitment.invalid_shape',`Malformed local pool ${id}`);continue;}
    const t=state.territories.get(id);
    if(!t||!state.factions.has(pool.factionId)||t.owner===null||pool.territoryId!==id||pool.factionId!==t.owner||pool.factionId===state.playerFactionId)push('recruitment.invalid_owner',`Invalid local pool ${id}`);
    if(!Number.isSafeInteger(pool.troops)||pool.troops<0||(quantities.get(id)??0)>pool.troops)push('recruitment.invalid_quantity',`Invalid or over-reserved local pool ${id}`);
    try {if(typeof pool.fractionalWork!=='string'||typeof pool.accruedThroughWork!=='string'||!/^(0|[1-9][0-9]*)$/.test(pool.fractionalWork)||!/^(0|[1-9][0-9]*)$/.test(pool.accruedThroughWork)||BigInt(pool.fractionalWork)>=RECRUITMENT_WORK_PER_TICK||(earnedRecruitmentFrontier!==undefined&&BigInt(pool.accruedThroughWork)>earnedRecruitmentFrontier))throw new Error();}catch{push('recruitment.invalid_work',`Invalid exact recruitment progress ${id}`);}
  }
  for (const op of activeOperations(state))if(op.plan?.action==='REINFORCE'&&op.phase==='physical') {
    if(!op.initiationTimer||op.initiationTimer.onlineDurationMs!==REINFORCE_INITIATION.initiationOnlineMs||op.initiationTimer.offlineDurationMs!==REINFORCE_INITIATION.initiationOfflineMs||reinforcementProblem(state,op.plan,op.id))push('recruitment.invalid_initiation',`Invalid live allocation ${op.id}`);
  }
  for (const army of state.armies.values()) {
    const counterparty=army.movement?.hostileCounterpartyId;
    if(counterparty!==undefined&&(counterparty===army.owner||!state.factions.has(counterparty)))
      push('peace.invalid_hostile_march',`Army ${army.id} has invalid hostile travel linkage`);
    if(counterparty!==undefined&&army.attackIntent?.targetFactionId&&counterparty!==army.attackIntent.targetFactionId)
      push('peace.invalid_hostile_march',`Army ${army.id} travel and attack counterparties disagree`);
    if(counterparty!==undefined&&army.movement?.commitmentId){
      const op=state.operations.get(army.movement.commitmentId);
      if(op?.action!=='ATTACK'||op.hostileCounterpartyId!==counterparty)
        push('peace.invalid_hostile_march',`Army ${army.id} travel and operation counterparties disagree`);
    }
    for (const id of [army.movement?.commitmentId, army.attackIntent?.commitmentId]) {
      if (!id) continue;
      const op = state.operations.get(id);
      if (!op || op.phase === 'terminal' || op.warlordId !== army.owner || state.operationClaims.get(`force:${army.id}`)?.operationId !== id)
        push('operation.orphan_physical_force', `army ${army.id} physical lifecycle lacks its operation/force claim`);
    }
  }
  for (const inv of state.activeInvasions.values()) {
    if (!inv.commitmentId) continue;
    const op = state.operations.get(inv.commitmentId);
    if (!op || op.phase === 'terminal' || op.links.invasionId !== inv.id || op.warlordId !== inv.attackerFactionId)
      push('operation.orphan_invasion', `invasion ${inv.id} lacks its operation link`);
    if (op?.plan?.action !== 'ATTACK' || op.plan.targetTerritoryId !== inv.territoryId
      || inv.attackingArmyIds.length !== 1 || inv.attackingArmyIds[0] !== op.plan.armyId)
      push('operation.invasion_plan_mismatch', `invasion ${inv.id} differs from its exact attack plan`);
  }
  for (const project of state.constructions.values()) if (project.aiOperationId) {
    const op = state.operations.get(project.aiOperationId);
    if (!op || op.phase === 'terminal' || op.links.constructionId !== project.id || project.status !== 'in_progress')
      push('operation.orphan_construction', `project ${project.id} lacks its active operation`);
  }

  // ---- active events reference valid entities where required ----
  for (const e of state.activeEvents) {
    if (e.territoryId !== null && !state.territories.has(e.territoryId)) {
      push('event.invalid_territory', `active event ${e.instanceId} references unknown territory ${e.territoryId}`);
    }
    if (e.factionId !== null && !state.factions.has(e.factionId)) {
      push('event.invalid_faction', `active event ${e.instanceId} references unknown faction ${e.factionId}`);
    }
  }
  const eventIdSeen = new Set<string>();
  for (const e of state.activeEvents) {
    if (eventIdSeen.has(e.instanceId)) {
      push('event.duplicate_instance_id', `active event instanceId ${e.instanceId} appears more than once`);
    }
    eventIdSeen.add(e.instanceId);
  }

  // ---- territory neighbor graph (committed states must be internally consistent) ----
  for (const issue of collectNeighborGraphIssues(state.territories)) {
    push(`territory.neighbor_${issue.kind}`, `territory ${issue.territoryId} neighbor ${issue.neighborId} (${issue.kind})`);
  }

  // ---- authored world identity + region membership ----
  for (const t of state.territories.values()) {
    if (!t.regionId || !state.regions.has(t.regionId)) {
      push('territory.unknown_region', `territory ${t.id} regionId ${t.regionId} is not in state.regions`);
    }
  }
  for (const [rid, region] of state.regions.entries()) {
    if (rid !== region.id) {
      push('region.key_id_mismatch', `regions map key ${rid} does not match ${region.id}`);
    }
    for (const tid of region.territoryIds) {
      if (!state.territories.has(tid)) {
        push('region.unknown_territory', `region ${rid} lists unknown territory ${tid}`);
      }
    }
  }

  // ---- player reward application (Phase 17H) ----
  const rewards = state.playerRewards;
  if (!rewards) {
    push('reward.missing_player_rewards', 'playerRewards is required on canonical GameState');
  } else {
    const troops = rewards.bankedTroops;
    if (!Number.isSafeInteger(troops) || troops < 0) {
      push('reward.invalid_banked_troops', `bankedTroops ${String(troops)} must be a non-negative safe integer`);
    }
    for (const [index, effect] of rewards.pendingConstructionEffects.entries()) {
      if (!Number.isFinite(effect.workerPower) || effect.workerPower < 0) {
        push('reward.invalid_construction_power', `pendingConstructionEffects[${index}].workerPower is ${String(effect.workerPower)}`);
      }
      if (effect.permanence !== 'TEMPORARY_ACCELERATION') {
        push('reward.invalid_construction_permanence', `pendingConstructionEffects[${index}] must be a temporary acceleration`);
      }
    }
    for (const [index, effect] of rewards.pendingGoldenYieldEffects.entries()) {
      if (!Number.isFinite(effect.multiplier) || effect.multiplier < 0) {
        push('reward.invalid_golden_yield_multiplier', `pendingGoldenYieldEffects[${index}].multiplier is ${String(effect.multiplier)}`);
      }
      if (effect.permanence !== 'EPHEMERAL' || effect.effect !== 'ONE_TIME_COLLECTION' || effect.consumed !== false) {
        push('reward.invalid_golden_yield_semantics', `pendingGoldenYieldEffects[${index}] must be an unconsumed one-time ephemeral effect`);
      }
    }
    const appliedIds = new Set<string>();
    for (const record of rewards.appliedRewards) {
      if (!record.applicationId || appliedIds.has(record.applicationId)) {
        push('reward.duplicate_application_id', `appliedRewards contains a missing or duplicate applicationId ${record.applicationId}`);
      }
      appliedIds.add(record.applicationId);
    }
  }

  if (!state.activeInvasions) {
    push('invasion.missing_map', 'activeInvasions is required on canonical GameState');
  } else {
    let inProgressDefenseCount = 0;
    for (const [key, invasion] of state.activeInvasions.entries()) {
      if (key !== invasion.id) {
        push('invasion.key_id_mismatch', `activeInvasions map key ${key} does not match invasion.id ${invasion.id}`);
      }
      if (!isOpenInvasionStatus(invasion.status)) {
        push('invasion.inactive_in_active_map', `invasion ${invasion.id} status is ${invasion.status}`);
      }
      if (!state.factions.has(invasion.defenderFactionId)) {
        push('invasion.invalid_defender', `invasion ${invasion.id} defender ${invasion.defenderFactionId} is not a known faction`);
      }
      if (!state.factions.has(invasion.attackerFactionId)) {
        push('invasion.invalid_attacker', `invasion ${invasion.id} attacker ${invasion.attackerFactionId} is not a known faction`);
      }
      if (invasion.attackerFactionId === invasion.defenderFactionId) {
        push('invasion.self_attack', `invasion ${invasion.id} attacker and defender are the same faction`);
      }
      const territory = state.territories.get(invasion.territoryId);
      if (!territory) {
        push('invasion.invalid_territory', `invasion ${invasion.id} territory ${invasion.territoryId} is not a known territory`);
      } else if (territory.owner !== invasion.defenderFactionId) {
        push('invasion.territory_owner_mismatch', `invasion ${invasion.id} territory ${invasion.territoryId} owner is ${String(territory.owner)}`);
      }
      for (const [label, tick] of [
        ['startedAtTick', invasion.startedAtTick],
        ['notifiedAtTick', invasion.notifiedAtTick],
        ['responseDeadlineTick', invasion.responseDeadlineTick],
      ] as const) {
        if (!Number.isInteger(tick) || !Number.isFinite(tick) || tick < 0) {
          push('invasion.invalid_timing', `invasion ${invasion.id} ${label} is ${String(tick)}`);
        }
      }
      if (invasion.notifiedAtTick < invasion.startedAtTick) {
        push('invasion.timing_order', `invasion ${invasion.id} notifiedAtTick precedes startedAtTick`);
      }
      if (invasion.responseDeadlineTick < invasion.notifiedAtTick) {
        push('invasion.timing_order', `invasion ${invasion.id} responseDeadlineTick precedes notifiedAtTick`);
      }
      const mob = invasion.defenseMobilization;
      if (mob) {
        if (!Number.isFinite(mob.defensePower) || mob.defensePower < 0) {
          push('invasion.invalid_defense_power', `invasion ${invasion.id} defensePower is ${String(mob.defensePower)}`);
        }
        if (typeof mob.playerId !== 'string' || mob.playerId.trim() === '') {
          push('invasion.invalid_defense_player', `invasion ${invasion.id} defense mobilization has an invalid playerId`);
        }
        if (mob.workoutStartedAtTick !== null && (!Number.isInteger(mob.workoutStartedAtTick) || mob.workoutStartedAtTick < 0)) {
          push('invasion.invalid_defense_workout_start', `invasion ${invasion.id} workoutStartedAtTick is ${String(mob.workoutStartedAtTick)}`);
        }
      }
      if (invasion.defenseWorkoutStartedAtTick !== null && (!Number.isInteger(invasion.defenseWorkoutStartedAtTick) || invasion.defenseWorkoutStartedAtTick < 0)) {
        push('invasion.invalid_defense_workout_start', `invasion ${invasion.id} defenseWorkoutStartedAtTick is ${String(invasion.defenseWorkoutStartedAtTick)}`);
      }
      if (invasion.defenseCompletionDeadlineTick !== null && (!Number.isInteger(invasion.defenseCompletionDeadlineTick) || invasion.defenseCompletionDeadlineTick < 0)) {
        push('invasion.invalid_defense_completion_deadline', `invasion ${invasion.id} defenseCompletionDeadlineTick is ${String(invasion.defenseCompletionDeadlineTick)}`);
      }
      if (invasion.status === 'pending_response') {
        if (invasion.defenseWorkoutStartedAtTick !== null || invasion.defenseCompletionDeadlineTick !== null || invasion.defenseSessionId !== null) {
          push('invasion.pending_has_defense_start', `invasion ${invasion.id} is pending_response but has defense-start fields`);
        }
        if (mob) {
          push('invasion.pending_has_mobilization', `invasion ${invasion.id} is pending_response but has a defense mobilization`);
        }
      }
      if (invasion.status === 'defense_in_progress') {
        if (invasion.defenseWorkoutStartedAtTick === null) {
          push('invasion.missing_defense_start', `invasion ${invasion.id} is defense_in_progress without defenseWorkoutStartedAtTick`);
        }
        if (invasion.defenseCompletionDeadlineTick === null) {
          push('invasion.missing_defense_completion_deadline', `invasion ${invasion.id} is defense_in_progress without defenseCompletionDeadlineTick`);
        }
        if (
          invasion.defenseWorkoutStartedAtTick !== null
          && invasion.defenseWorkoutStartedAtTick > invasion.responseDeadlineTick
        ) {
          push('invasion.defense_started_after_deadline', `invasion ${invasion.id} defense started after the response deadline`);
        }
        if (
          invasion.defenseWorkoutStartedAtTick !== null
          && invasion.defenseCompletionDeadlineTick !== null
          && invasion.defenseCompletionDeadlineTick < invasion.defenseWorkoutStartedAtTick
        ) {
          push('invasion.timing_order', `invasion ${invasion.id} defenseCompletionDeadlineTick precedes defenseWorkoutStartedAtTick`);
        }
      }
      if (invasion.defenderFactionId === state.playerFactionId && invasion.status === 'defense_in_progress') {
        inProgressDefenseCount += 1;
      }
    }
    if (inProgressDefenseCount > 1) {
      push('invasion.duplicate_active_defense', 'player has more than one defense_in_progress invasion');
    }
  }

  if (!state.constructions) {
    push('construction.missing_map', 'constructions is required on canonical GameState');
  } else {
    const inProgressByTerritory = new Map<string, string>();
    for (const [key, project] of state.constructions.entries()) {
      if (key !== project.id) {
        push('construction.key_id_mismatch', `constructions map key ${key} does not match id ${project.id}`);
      }
      if (!state.factions.has(project.factionId)) {
        push('construction.invalid_owner', `construction ${project.id} owner ${project.factionId} is not a known faction`);
      }
      if (!state.territories.has(project.territoryId)) {
        push('construction.invalid_territory', `construction ${project.id} territory ${project.territoryId} is not a known territory`);
      }
      if (!Number.isFinite(project.remainingTicks) || project.remainingTicks < 0) {
        push('construction.invalid_remaining', `construction ${project.id} remainingTicks is ${String(project.remainingTicks)}`);
      }
      if (!Number.isInteger(project.lastProgressTick) || project.lastProgressTick < 0) {
        push('construction.invalid_last_progress', `construction ${project.id} lastProgressTick is ${String(project.lastProgressTick)}`);
      }
      if (project.status === 'completed') {
        if (project.remainingTicks !== 0) {
          push('construction.completed_remaining', `completed construction ${project.id} remainingTicks is ${project.remainingTicks}`);
        }
        if (project.completedAtTick === null) {
          push('construction.missing_completed_tick', `completed construction ${project.id} has no completedAtTick`);
        }
      }
      if (project.status === 'in_progress') {
        const prev = inProgressByTerritory.get(project.territoryId);
        if (prev) {
          push('construction.multiple_in_progress', `territory ${project.territoryId} has multiple in-progress constructions (${prev}, ${project.id})`);
        } else {
          inProgressByTerritory.set(project.territoryId, project.id);
        }
      }
    }
  }

  if (!state.cities) {
    push('city.missing_map', 'cities is required on canonical GameState');
  } else {
    for (const [key, city] of state.cities.entries()) {
      if (key !== city.id) {
        push('city.key_id_mismatch', `cities map key ${key} does not match id ${city.id}`);
      }
      const territory = state.territories.get(city.territoryId);
      if (!territory) {
        push('city.invalid_territory', `city ${city.id} territory ${city.territoryId} is not a known territory`);
      } else if (territory.owner === null) {
        push('city.unowned_territory', `city ${city.id} exists on unowned territory ${city.territoryId}`);
      } else if (territory.owner !== city.factionId) {
        push('city.owner_mismatch', `city ${city.id} faction ${city.factionId} does not match territory owner ${territory.owner}`);
      }
      if (!state.factions.has(city.factionId)) {
        push('city.invalid_faction', `city ${city.id} faction ${city.factionId} is not a known faction`);
      }
      for (const building of city.buildings) {
        if (building.type !== 'FORTIFICATION') {
          push('city.invalid_building', `city ${city.id} has unsupported building ${String(building.type)}`);
        }
        if (!Number.isInteger(building.level) || building.level < 0 || building.level > 5) {
          push('city.invalid_building_level', `city ${city.id} building level ${String(building.level)} is invalid`);
        }
        if (!Number.isInteger(building.completedAtTick) || building.completedAtTick < 0) {
          push('city.invalid_building_tick', `city ${city.id} building completedAtTick is ${String(building.completedAtTick)}`);
        }
      }
    }
  }

  if (!state.territoryEconomy) {
    push('economy.missing_map', 'territoryEconomy is required on canonical GameState');
  } else {
    for (const [key, rec] of state.territoryEconomy.entries()) {
      if (key !== rec.territoryId) {
        push('economy.key_id_mismatch', `territoryEconomy map key ${key} does not match territoryId ${rec.territoryId}`);
      }
      if (!state.territories.has(rec.territoryId)) {
        push('economy.invalid_territory', `territoryEconomy ${rec.territoryId} is not a known territory`);
      }
      if(rec.foodAccrualTick!==undefined && (!Number.isSafeInteger(rec.foodAccrualTick)||rec.foodAccrualTick<0||rec.foodAccrualTick>state.worldTick))push('economy.invalid_food_stamp',`Invalid local Food stamp ${rec.territoryId}`);
      if (!Number.isInteger(rec.lastAccrualTick) || rec.lastAccrualTick < 0) {
        push('economy.invalid_last_accrual', `territoryEconomy ${rec.territoryId} lastAccrualTick is ${String(rec.lastAccrualTick)}`);
      }
      for (const [rk, rv] of Object.entries(rec.uncollected)) {
        if (!Number.isFinite(rv) || rv < 0 || Number.isNaN(rv)) {
          push('economy.malformed_uncollected', `territoryEconomy ${rec.territoryId} uncollected.${rk} is ${String(rv)}`);
        }
      }
    }
  }

  if (!state.territoryInfrastructure) {
    push('infrastructure.missing_map', 'territoryInfrastructure is required on canonical GameState');
  } else {
    for (const [key, rec] of state.territoryInfrastructure.entries()) {
      if (key !== rec.territoryId) {
        push('infrastructure.key_id_mismatch', `territoryInfrastructure map key ${key} does not match territoryId ${rec.territoryId}`);
      }
      if (!state.territories.has(rec.territoryId)) {
        push('infrastructure.invalid_territory', `territoryInfrastructure ${rec.territoryId} is not a known territory`);
      }
      const stamps: Array<[string, number | null]> = [
        ['farmCompletedAtTick', rec.farmCompletedAtTick],
        ['mineCompletedAtTick', rec.mineCompletedAtTick],
        ['lumberCompletedAtTick', rec.lumberCompletedAtTick],
      ];
      for (const [field, tick] of stamps) {
        if (tick !== null && (!Number.isInteger(tick) || tick < 0)) {
          push('infrastructure.invalid_completed_tick', `territoryInfrastructure ${rec.territoryId}.${field} is ${String(tick)}`);
        }
      }
    }
  }

  if (!state.playerFitness) {
    push('fitness.missing_player_fitness', 'playerFitness is required on canonical GameState');
  } else if (state.playerFitness.estimate && state.playerFitness.estimate.level < 0) {
    push('fitness.invalid_estimate', 'playerFitness.estimate.level must be non-negative');
  } else {
    const session = state.playerFitness.activeSession;
    if (session?.completionRewardEntitlement !== undefined) {
      try {
        validateCompletionRewardEntitlement(session.completionRewardEntitlement, session);
        if (session.prescribedWorkout.workoutId !== session.workoutId) throw new Error('Workout prescription identity mismatch');
      } catch {
        push('fitness.invalid_completion_entitlement', 'Workout completion entitlement has invalid terms or session binding');
      }
    }
    if (session && (session.state === 'ACTIVE' || session.state === 'PAUSED') && session.purpose === 'DEFENSE') {
      const invasionId = session.gameplayContext?.invasionId;
      const invasion = invasionId ? state.activeInvasions.get(invasionId) : undefined;
      if (!invasion || !isOpenInvasionStatus(invasion.status)) {
        push('fitness.defense_session_missing_invasion', 'ACTIVE DEFENSE session does not reference an open invasion');
      } else {
        if (state.playerFactionId && invasion.defenderFactionId !== state.playerFactionId) {
          push('fitness.defense_session_wrong_player', 'ACTIVE DEFENSE session is not owned by the local defender');
        }
        if (invasion.defenseSessionId && invasion.defenseSessionId !== session.sessionId) {
          push('fitness.defense_session_mismatch', 'ACTIVE DEFENSE session does not match invasion.defenseSessionId');
        }
        if (invasion.status !== 'defense_in_progress') {
          push('fitness.defense_session_invasion_not_in_progress', 'ACTIVE DEFENSE session is linked to a pending_response invasion');
        }
      }
    }
  }

  if (!state.playerEmpirePause) {
    push('pause.missing', 'playerEmpirePause is required on canonical GameState');
  }

  if (!state.attackerCooldowns) {
    push('cooldown.missing_map', 'attackerCooldowns is required on canonical GameState');
  } else {
    for (const [fid, cooldown] of state.attackerCooldowns.entries()) {
      if (!state.factions.has(fid)) {
        push('cooldown.unknown_faction', `attackerCooldowns has an entry for unknown faction ${fid}`);
      }
      if (cooldown.recoveryUntilTick !== null && (!Number.isInteger(cooldown.recoveryUntilTick) || cooldown.recoveryUntilTick < 0)) {
        push('cooldown.invalid_recovery', `attackerCooldowns[${fid}].recoveryUntilTick is ${String(cooldown.recoveryUntilTick)}`);
      }
      if (cooldown.continuationUntilTick !== null && (!Number.isInteger(cooldown.continuationUntilTick) || cooldown.continuationUntilTick < 0)) {
        push('cooldown.invalid_continuation', `attackerCooldowns[${fid}].continuationUntilTick is ${String(cooldown.continuationUntilTick)}`);
      }
    }
  }

  for(const problem of tradeStateProblems(state))push('trade.invalid_state',problem);
  for(const problem of conflictStateProblems(state))push('conflict.invalid_state',problem);
  return violations;
}

/** Convenience predicate for call sites that only care pass/fail. */
export function isGameStateStructurallyValid(state: GameState): boolean {
  return checkGameStateInvariants(state).length === 0;
}
