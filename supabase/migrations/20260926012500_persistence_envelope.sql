-- Authoritative persistence envelope.
-- These tables store the existing PersistedWorldRecord, workout-history
-- entries, and append-only telemetry. They are not a second GameState.

create table public.player_worlds (
  player_id text primary key,
  world_id text not null,
  format_version text not null,
  schema_version integer not null,
  world_tick integer not null,
  state_version integer not null,
  payload jsonb not null
);

create table public.workout_history (
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

create index workout_history_player_completed_at
  on public.workout_history (player_id, completed_at desc);

create index workout_history_player_exercise_ids
  on public.workout_history using gin (exercise_ids);

create table public.gameplay_telemetry (
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

create index gameplay_telemetry_importance
  on public.gameplay_telemetry (importance, occurred_at_world_tick);

create index gameplay_telemetry_player_world
  on public.gameplay_telemetry (player_id, world_id, occurred_at_world_tick);

create index gameplay_telemetry_correlation
  on public.gameplay_telemetry (correlation_id, occurred_at_world_tick);

create index gameplay_telemetry_session
  on public.gameplay_telemetry (session_id, occurred_at_world_tick);

alter table public.player_worlds enable row level security;
alter table public.workout_history enable row level security;
alter table public.gameplay_telemetry enable row level security;

revoke all on table public.player_worlds from public, anon, authenticated;
revoke all on table public.workout_history from public, anon, authenticated;
revoke all on table public.gameplay_telemetry from public, anon, authenticated;

grant select, insert, update, delete on table public.player_worlds to service_role;
grant select, insert, update, delete on table public.workout_history to service_role;
grant select, insert on table public.gameplay_telemetry to service_role;
