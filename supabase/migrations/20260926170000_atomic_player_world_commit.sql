-- One transaction for an authoritative world save and its workout-history upserts.
-- The function raises persistence.conflict or persistence.invalid_state.
-- A raise aborts the statement, so neither table keeps a partial write.

create or replace function public.commit_authoritative_player_world(
  p_expected_version integer,
  p_world jsonb,
  p_history jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_player_id text;
  v_current integer;
  v_next integer;
  v_entry jsonb;
  v_exercises text[];
begin
  if p_expected_version is null or p_expected_version < 0
     or p_world is null or jsonb_typeof(p_world) <> 'object'
     or p_history is null or jsonb_typeof(p_history) <> 'array'
     or coalesce(p_world->>'player_id', '') = ''
     or coalesce(p_world->>'world_id', '') = ''
     or coalesce(p_world->>'format_version', '') = ''
  then
    raise exception 'persistence.invalid_state' using errcode = '22023';
  end if;

  v_player_id := p_world->>'player_id';

  select state_version into v_current
  from public.player_worlds
  where player_id = v_player_id
  for update;

  if not found then
    v_current := 0;
  end if;

  if v_current is distinct from p_expected_version then
    raise exception 'persistence.conflict'
      using errcode = 'P0001',
            detail = p_expected_version::text || ' ' || v_current::text;
  end if;

  v_next := v_current + 1;

  begin
    insert into public.player_worlds (
      player_id,
      world_id,
      format_version,
      schema_version,
      world_tick,
      state_version,
      payload
    ) values (
      v_player_id,
      p_world->>'world_id',
      p_world->>'format_version',
      (p_world->>'schema_version')::integer,
      (p_world->>'world_tick')::integer,
      v_next,
      p_world->'payload'
    )
    on conflict (player_id) do update set
      world_id = excluded.world_id,
      format_version = excluded.format_version,
      schema_version = excluded.schema_version,
      world_tick = excluded.world_tick,
      state_version = excluded.state_version,
      payload = excluded.payload;
  exception
    when unique_violation then
      raise exception 'persistence.conflict'
        using errcode = 'P0001',
              detail = p_expected_version::text || ' ' || v_current::text;
    when not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'persistence.invalid_state' using errcode = '22023';
  end;

  for v_entry in select value from jsonb_array_elements(p_history)
  loop
    if v_entry is null or jsonb_typeof(v_entry) <> 'object'
       or v_entry->>'player_id' is distinct from v_player_id
       or coalesce(v_entry->>'session_id', '') = ''
       or coalesce(v_entry->>'workout_id', '') = ''
       or coalesce(v_entry->>'purpose', '') = ''
       or coalesce(v_entry->>'completion_state', '') = ''
       or jsonb_typeof(v_entry->'eligible_for_fitness') <> 'boolean'
       or jsonb_typeof(v_entry->'exercise_ids') <> 'array'
       or v_entry->'payload' is null
       or jsonb_typeof(v_entry->'payload') = 'null'
    then
      raise exception 'persistence.invalid_state' using errcode = '22023';
    end if;

    select coalesce(array_agg(item), '{}'::text[]) into v_exercises
    from jsonb_array_elements_text(v_entry->'exercise_ids') as item;

    insert into public.workout_history (
      player_id,
      session_id,
      workout_id,
      purpose,
      completion_state,
      eligible_for_fitness,
      completed_at,
      completed_at_world_tick,
      exercise_ids,
      payload
    ) values (
      v_player_id,
      v_entry->>'session_id',
      v_entry->>'workout_id',
      v_entry->>'purpose',
      v_entry->>'completion_state',
      (v_entry->>'eligible_for_fitness')::boolean,
      case
        when v_entry->'completed_at' is null or jsonb_typeof(v_entry->'completed_at') = 'null' then null
        else (v_entry->>'completed_at')::double precision
      end,
      case
        when v_entry->'completed_at_world_tick' is null or jsonb_typeof(v_entry->'completed_at_world_tick') = 'null' then null
        else (v_entry->>'completed_at_world_tick')::integer
      end,
      v_exercises,
      v_entry->'payload'
    )
    on conflict (player_id, session_id) do update set
      workout_id = excluded.workout_id,
      purpose = excluded.purpose,
      completion_state = excluded.completion_state,
      eligible_for_fitness = excluded.eligible_for_fitness,
      completed_at = excluded.completed_at,
      completed_at_world_tick = excluded.completed_at_world_tick,
      exercise_ids = excluded.exercise_ids,
      payload = excluded.payload;
  end loop;

  return jsonb_build_object(
    'player_id', v_player_id,
    'world_id', p_world->>'world_id',
    'state_version', v_next
  );
end;
$$;

revoke all on function public.commit_authoritative_player_world(integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_authoritative_player_world(integer, jsonb, jsonb) to service_role;
