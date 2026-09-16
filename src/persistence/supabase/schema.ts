/**
 * Future Supabase mapping. No network calls. Rows are JSON-safe documents
 * the production adapter would upsert transactionally.
 */
export const SUPABASE_GAME_STATE_TABLE = 'player_worlds';
export const SUPABASE_WORKOUT_HISTORY_TABLE = 'workout_history';
export const SUPABASE_TELEMETRY_TABLE = 'gameplay_telemetry';

export interface SupabaseGameStateRow {
  player_id: string;
  world_id: string;
  format_version: string;
  schema_version: number;
  world_tick: number;
  state_version: number;
  payload: unknown;
}

export interface SupabaseTelemetryRow {
  event_id: string;
  schema_version: string;
  event_type: string;
  importance: string;
  occurred_at_world_tick: number;
  occurred_at: number | null;
  world_id: string;
  definition_world_id: string | null;
  world_level: number | null;
  player_id: string | null;
  faction_id: string | null;
  session_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  source_system: string;
  command_id: string | null;
  request_id: string | null;
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

-- Append-only gameplay telemetry. Not a second GameState authority.
create table if not exists gameplay_telemetry (
  event_id text primary key,
  schema_version text not null,
  event_type text not null,
  importance text not null,
  occurred_at_world_tick integer not null,
  occurred_at double precision,
  world_id text not null,
  definition_world_id text,
  world_level integer,
  player_id text,
  faction_id text,
  session_id text,
  correlation_id text not null,
  causation_id text,
  source_system text not null,
  command_id text,
  request_id text,
  payload jsonb not null
);

create index if not exists gameplay_telemetry_importance
  on gameplay_telemetry (importance, occurred_at_world_tick);

create index if not exists gameplay_telemetry_player_world
  on gameplay_telemetry (player_id, world_id, occurred_at_world_tick);

create index if not exists gameplay_telemetry_correlation
  on gameplay_telemetry (correlation_id, occurred_at_world_tick);

create index if not exists gameplay_telemetry_session
  on gameplay_telemetry (session_id, occurred_at_world_tick);
`;
