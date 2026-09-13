/**
 * Future Supabase mapping. No network calls. Rows are JSON-safe documents
 * the production adapter would upsert transactionally.
 */
export const SUPABASE_GAME_STATE_TABLE = 'player_worlds';
export const SUPABASE_WORKOUT_HISTORY_TABLE = 'workout_history';

export interface SupabaseGameStateRow {
  player_id: string;
  world_id: string;
  format_version: string;
  schema_version: number;
  world_tick: number;
  state_version: number;
  payload: unknown;
}

export interface SupabaseWorkoutHistoryRow {
  player_id: string;
  session_id: string;
  workout_id: string;
  purpose: string;
  completion_state: string;
  eligible_for_fitness: boolean;
  completed_at: number | null;
  completed_at_world_tick: number | null;
  exercise_ids: string[];
  payload: unknown;
}

export const SUPABASE_DDL = `
-- Phase 17L contract only. Not executed in this phase.
create table if not exists player_worlds (
  player_id text primary key,
  world_id text not null,
  format_version text not null,
  schema_version integer not null,
  world_tick integer not null,
  state_version integer not null,
  payload jsonb not null
);

create table if not exists workout_history (
  player_id text not null,
  session_id text not null,
  workout_id text not null,
  purpose text not null,
  completion_state text not null,
  eligible_for_fitness boolean not null,
  completed_at double precision,
  completed_at_world_tick integer,
  exercise_ids text[] not null default '{}',
  payload jsonb not null,
  primary key (player_id, session_id)
);

create index if not exists workout_history_player_completed_at
  on workout_history (player_id, completed_at desc);

create index if not exists workout_history_player_exercise_ids
  on workout_history using gin (exercise_ids);
`;
