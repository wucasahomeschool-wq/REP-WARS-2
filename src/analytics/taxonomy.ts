/**
 * Canonical gameplay telemetry taxonomy.
 *
 * Importance is defined HERE by event type. Callers never guess it.
 * Names follow existing orchestrator command outcomes and domain ids
 * (attackOutcome, WorkoutPurpose, WorldAiDecisionRecord, etc.).
 *
 * Intentionally absent (technical noise):
 * - render / pointer / UI hover
 * - per-second simulation ticks
 * - BattleEngine narrative phase beats
 * - GET_* read commands
 * - in-flight movement tick updates while status remains `moving`
 * - per-territory economy accrual during ADVANCE_WORLD
 *
 * Domain pause/resume exists on WorkoutSession but has no orchestrator
 * command yet, so those types are catalogued for when a command lands.
 */

export type CatalogImportance = 'CRITICAL' | 'IMPORTANT' | 'INFORMATIONAL' | 'DEBUG';

export const TELEMETRY_EVENT_TYPES = [
  // Combat / territory
  'battle.resolved',
  'territory.conquered',
  'territory.fortified',
  'attack.declared',
  'attack.committed',
  'attack.failed',
  'invasion.started',
  'invasion.resolved',
  'invasion.awaiting_defense',
  'army.moved',
  'army.arrived',
  'army.movement_interrupted',
  'army.reinforced',

  // Fitness / rewards
  'workout.started',
  'workout.paused',
  'workout.resumed',
  'workout.exercise_recorded',
  'workout.rest_skipped',
  'workout.feedback_submitted',
  'workout.completed',
  'workout.abandoned',
  'workout.fitness_result',
  'workout.game_reward',
  'workout.reward_applied',
  'workout.integrity_flag',

  // Economy / construction
  'construction.started',
  'construction.accelerated',
  'construction.completed',
  'resource.collected',
  'resource.golden_yield_used',
  'resource.spent',
  'resource.consumed',
  'stability.changed',
  'city.founded',
  'development.completed',
  'building.destroyed',

  // AI / world
  'ai.decision_selected',
  'ai.decision_cycle',
  'ai.commitment_resolved',
  'ai.defend_posture',
  'world.advanced',
  'world.synced',
  'world.catch_up',
  'imperial.event_triggered',
  'diplomacy.war_declared',
  'diplomacy.negotiated',

  // Player empire
  'player.pause.started',
  'player.pause.ended',

  // Persistence / command diagnostics
  'persistence.saved',
  'persistence.loaded',
  'persistence.save_conflict',
  'persistence.save_failed',
  'persistence.retry',
  'command.rejected',
  'command.validation_failed',
  'anchor.protection_blocked',
  'anchor.became_attackable',
  'level.defeated',
  'level.completed',
  'level.transitioned',
  'tutorial.beat_changed',
  'tutorial.scripted_invasion',
] as const;

const CRITICAL: readonly string[] = [
  'battle.resolved',
  'territory.conquered',
  'invasion.started',
  'invasion.resolved',
  'workout.reward_applied',
  'construction.completed',
  'player.pause.started',
  'player.pause.ended',
  'level.defeated',
  'level.completed',
  'level.transitioned',
];

const IMPORTANT: readonly string[] = [
  'attack.declared',
  'attack.committed',
  'attack.failed',
  'invasion.awaiting_defense',
  'workout.started',
  'workout.completed',
  'workout.abandoned',
  'workout.feedback_submitted',
  'construction.started',
  'resource.collected',
  'resource.golden_yield_used',
  'stability.changed',
  'city.founded',
  'development.completed',
  'building.destroyed',
  'ai.decision_selected',
  'ai.commitment_resolved',
  'world.synced',
  'territory.fortified',
  'army.reinforced',
  'anchor.protection_blocked',
  'anchor.became_attackable',
  'tutorial.beat_changed',
  'tutorial.scripted_invasion',
];

const DEBUG: readonly string[] = [
  'command.rejected',
  'command.validation_failed',
  'persistence.save_conflict',
  'persistence.save_failed',
  'persistence.retry',
  'army.movement_interrupted',
  'workout.integrity_flag',
];

const CRITICAL_SET = new Set(CRITICAL);
const IMPORTANT_SET = new Set(IMPORTANT);
const DEBUG_SET = new Set(DEBUG);

export function importanceFor(eventType: string): CatalogImportance {
  if (CRITICAL_SET.has(eventType)) return 'CRITICAL';
  if (IMPORTANT_SET.has(eventType)) return 'IMPORTANT';
  if (DEBUG_SET.has(eventType)) return 'DEBUG';
  return 'INFORMATIONAL';
}

export function isTelemetryEventType(value: string): value is (typeof TELEMETRY_EVENT_TYPES)[number] {
  return (TELEMETRY_EVENT_TYPES as readonly string[]).includes(value);
}

const READ_ONLY_COMMANDS = new Set([
  'GET_COMMAND_INDEX',
  'GET_GAME_STATE',
  'GET_VISIBLE_WORLD',
  'GET_WORLD_DEFINITION',
  'GET_FITNESS_CATALOG',
  'GET_WORKOUT_SELECTION',
]);

export function isReadOnlyCommand(commandId: string): boolean {
  return READ_ONLY_COMMANDS.has(commandId);
}

const VALIDATION_ERROR_CODES = new Set([
  'INVALID_COMMAND',
  'MISSING_PARAMETER',
  'INVALID_PARAMETER',
  'INVALID_TARGET',
  'INVALID_TERRITORY',
  'INVALID_ARMY',
  'INVALID_FACTION',
  'INVALID_GAME_STATE',
  'WORKOUT_SESSION_INVALID',
]);

export function isValidationErrorCode(code: string): boolean {
  return VALIDATION_ERROR_CODES.has(code);
}
