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
import { collectNeighborGraphIssues } from '../map/graphInvariants';

export interface GameStateInvariantViolation {
  /** Short machine-checkable category, e.g. `'army.negative_troops'`. */
  code: string;
  /** Human-readable detail for test failures/logging. */
  message: string;
}

function isOpenInvasionStatus(status: string): boolean {
  return status === 'pending_response' || status === 'defense_in_progress';
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
    if (!factionIdSet.has(key)) {
      push('faction.missing_from_all_ids', `factions map has ${key}, but allFactionIds does not list it`);
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
    const ownerSnap = state.factions.get(a.owner);
    if (ownerSnap && !ownerSnap.armies.includes(a.id)) {
      push('army.not_listed_by_owner', `army ${a.id} owner ${a.owner} does not list this army in armies[]`);
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
      if (intent.holdForInvasionId) {
        const held = state.activeInvasions.get(intent.holdForInvasionId);
        if (!held || !isOpenInvasionStatus(held.status)) {
          push('army.hold_for_resolved_invasion', `army ${a.id} holdForInvasionId ${intent.holdForInvasionId} does not reference an open invasion`);
        }
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

  // ---- territory neighbor graph (committed states must be internally consistent) ----
  for (const issue of collectNeighborGraphIssues(state.territories)) {
    push(`territory.neighbor_${issue.kind}`, `territory ${issue.territoryId} neighbor ${issue.neighborId} (${issue.kind})`);
  }

  // ---- visibility maps reference real factions and territories ----
  for (const [fid, vis] of state.visibility.entries()) {
    if (!state.factions.has(fid)) {
      push('visibility.unknown_faction', `visibility map exists for unknown faction ${fid}`);
    }
    if (vis.owner !== fid) {
      push('visibility.owner_mismatch', `visibility map key ${fid} has owner ${vis.owner}`);
    }
    for (const tid of vis.visibility.keys()) {
      if (!state.territories.has(tid)) {
        push('visibility.unknown_territory', `visibility[${fid}] references unknown territory ${tid}`);
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

  if (!state.playerFitness) {
    push('fitness.missing_player_fitness', 'playerFitness is required on canonical GameState');
  } else if (state.playerFitness.estimate && state.playerFitness.estimate.level < 0) {
    push('fitness.invalid_estimate', 'playerFitness.estimate.level must be non-negative');
  } else {
    const session = state.playerFitness.activeSession;
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

  return violations;
}

/** Convenience predicate for call sites that only care pass/fail. */
export function isGameStateStructurallyValid(state: GameState): boolean {
  return checkGameStateInvariants(state).length === 0;
}
