/**
 * GAMESTATE STRUCTURAL INVARIANTS (AUTHORITATIVE RUNTIME GAMESTATE PASS).
 * See docs/AUTHORITATIVE_GAMESTATE_ARCHITECTURE.md, "State invariants".
 *
 * These are structural integrity checks only — they verify the shape of
 * `GameState` is internally consistent (unique ids, valid references, no
 * negative counts, no orphaned/duplicate entities). They do NOT encode new
 * gameplay rules the existing engines don't already enforce (e.g. this
 * file does not decide whether an ATTACK is legal — `validateCommitmentTarget`,
 * already defined in `DecisionEngine.ts`, is reused for in-flight commitments
 * (pending/committed/executing). Terminal commitments may retain a stale
 * target after successful execution.
 */
import { AICommitment, GameStateSnapshot } from '../types';
import { GameState } from '../types/GameState';
import { isActiveCommitmentStatus, validateCommitmentTarget } from '../engine/DecisionEngine';

export interface GameStateInvariantViolation {
  /** Short machine-checkable category, e.g. `'army.negative_troops'`. */
  code: string;
  /** Human-readable detail for test failures/logging. */
  message: string;
}

function toEngineSnapshotView(state: GameState): GameStateSnapshot {
  return {
    turn: state.turn,
    factions: state.factions,
    territories: state.territories,
    armies: state.armies,
    allFactionIds: state.allFactionIds,
  };
}

/**
 * Returns the list of invariant violations found in `state`. An empty
 * array means `state` is structurally valid. Never throws — callers
 * (tests, a future Orchestrator) decide what to do with violations.
 */
export function checkGameStateInvariants(state: GameState): GameStateInvariantViolation[] {
  const violations: GameStateInvariantViolation[] = [];
  const push = (code: string, message: string) => violations.push({ code, message });

  if (!Number.isInteger(state.worldTick) || state.worldTick < 0 || !Number.isFinite(state.worldTick)) {
    push('world.invalid_tick', `worldTick ${state.worldTick} must be a non-negative integer`);
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
  }
  for (const [key, t] of state.territories.entries()) {
    if (key !== t.id) {
      push('territory.key_id_mismatch', `territories map key ${key} does not match Territory.id ${t.id}`);
    }
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

  // ---- army owner/location references are valid ----
  for (const a of state.armies.values()) {
    if (!state.factions.has(a.owner)) {
      push('army.invalid_owner', `army ${a.id} owner ${a.owner} is not a known faction`);
    }
    if (!state.territories.has(a.location)) {
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
    const mv = a.movement;
    if (mv && mv.status === 'moving') {
      if (!state.territories.has(mv.originTerritoryId)) {
        push('army.invalid_movement_origin', `army ${a.id} movement origin ${mv.originTerritoryId} is not a known territory`);
      }
      if (!state.territories.has(mv.destinationTerritoryId)) {
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
        if (mv && mv.status === 'moving') {
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
      if (intent.commitmentId) {
        const c = state.commitments.get(a.owner);
        if (!c || c.id !== intent.commitmentId) {
          push('army.attack_intent_stale_commitment', `army ${a.id} attackIntent commitment ${intent.commitmentId} is not the owner's active commitment`);
        }
      }
    }
  }

  // ---- faction-level structural checks ----
  for (const f of state.factions.values()) {
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

  // ---- AI commitments ----
  const snapshotView = toEngineSnapshotView(state);
  for (const [fid, commitment] of state.commitments.entries()) {
    if (!state.factions.has(fid)) {
      push('commitment.unknown_faction_key', `commitments map has an entry for unknown faction ${fid}`);
    }
    if (commitment === null) continue;
    const c: AICommitment = commitment;
    if (c.warlordId !== fid) {
      push('commitment.faction_mismatch', `commitments[${fid}] has warlordId ${c.warlordId}`);
    }
    if (!state.factions.has(c.warlordId)) {
      push('commitment.invalid_faction', `commitment ${c.id} references unknown faction ${c.warlordId}`);
    }
    // Terminal commitments (completed/failed/interrupted) are historical:
    // a successful ATTACK can capture the target, making the stored target
    // invalid. Only in-flight commitments must still point at a legal target.
    if (isActiveCommitmentStatus(c.status)) {
      const validity = validateCommitmentTarget(c, snapshotView);
      if (!validity.valid) {
        push('commitment.invalid_target', `commitment ${c.id} (${c.action} → ${c.targetId ?? 'none'}) is invalid: ${validity.reason}`);
      }
    }
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

  return violations;
}

/** Convenience predicate for call sites that only care pass/fail. */
export function isGameStateStructurallyValid(state: GameState): boolean {
  return checkGameStateInvariants(state).length === 0;
}
