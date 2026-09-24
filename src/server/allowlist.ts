/**
 * Frozen player-facing command ids from src/orchestration/commandIndex.ts.
 * Exposure is allow-only. Do not derive this by excluding harness commands.
 * The catalog itself is not filtered.
 */
const HTTP_EXPOSED_COMMANDS: ReadonlySet<string> = new Set([
  'GET_COMMAND_INDEX',
  'GET_GAME_STATE',
  'GET_VISIBLE_WORLD',
  'GET_WORLD_DEFINITION',
  'GET_FITNESS_CATALOG',
  'GET_WORKOUT_SELECTION',
  'ATTACK',
  'MOVE',
  'BUILD',
  'REINFORCE',
  'DECLARE_WAR',
  'NEGOTIATE',
  'SYNC_PLAYER_WORLD',
  'TRANSITION_TO_NEXT_WORLD',
  'START_CONSTRUCTION',
  'APPLY_CONSTRUCTION_ACCELERATION',
  'COLLECT_RESOURCES',
  'SET_PLAYER_PAUSE',
  'START_WORKOUT',
  'PAUSE_WORKOUT',
  'RESUME_WORKOUT',
  'RECORD_EXERCISE',
  'SKIP_REST',
  'SUBMIT_WORKOUT_FEEDBACK',
  'FINALIZE_WORKOUT',
  'ABANDON_WORKOUT',
  'RECORD_INTEGRITY_FLAG',
]);

export function isCommandExposed(commandId: string): boolean {
  return HTTP_EXPOSED_COMMANDS.has(commandId);
}
