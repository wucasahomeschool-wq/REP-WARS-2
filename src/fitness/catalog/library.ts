/**
 * Authored exercise/workout library imported from historical movement lists.
 *
 * This is catalog content only. It does not own prescriptions, purpose
 * selection, or personalization. Existing prototype workouts keep their IDs.
 */
import { BodySection, ExerciseId, ExerciseType, WorkoutId } from '../types';

/** Rep Wars authored default for new rep-based library exercises. Not a source-app number. */
export const LIBRARY_DEFAULT_REPETITIONS = 10;
/** Rep Wars authored default for new timed library exercises and stretches. Not a source-app number. */
export const LIBRARY_DEFAULT_DURATION_SECONDS = 20;

export type LibraryExerciseKind = 'training' | 'stretch';

export interface LibraryExerciseSpec {
  id: ExerciseId;
  name: string;
  type: Exclude<ExerciseType, 'REST'>;
  bodySection: BodySection;
  kind: LibraryExerciseKind;
}

export interface LibraryTemplateSpec {
  id: WorkoutId;
  sourceTemplate: number;
  name: string;
  description: string;
  section: 'CORE' | 'UPPER_BODY' | 'LOWER_BODY';
  exerciseIds: readonly ExerciseId[];
}

function training(
  id: ExerciseId,
  name: string,
  type: Exclude<ExerciseType, 'REST'>,
  bodySection: BodySection,
): LibraryExerciseSpec {
  return { id, name, type, bodySection, kind: 'training' };
}

function stretch(
  id: ExerciseId,
  name: string,
  bodySection: BodySection,
): LibraryExerciseSpec {
  return { id, name, type: 'TIMED', bodySection, kind: 'stretch' };
}

/**
 * Newly authored exercises. Existing catalog IDs (push-ups, squats, lunges,
 * sit-ups, plank, wall sit, and the three current stretches) are reused by
 * templates and are not duplicated here.
 */
export const LIBRARY_EXERCISES: readonly LibraryExerciseSpec[] = Object.freeze([
  training('ex_hollow_body_hold', 'Hollow body hold', 'TIMED', 'CORE'),
  training('ex_v_ups', 'V-ups', 'REP_BASED', 'CORE'),
  training('ex_toes_to_sky', 'Toes-to-sky', 'REP_BASED', 'CORE'),
  training('ex_bicycle_crunches', 'Bicycle crunches', 'REP_BASED', 'CORE'),
  training('ex_dead_bug', 'Dead bug', 'REP_BASED', 'CORE'),
  training('ex_scissor_kicks', 'Scissor kicks', 'TIMED', 'CORE'),
  training('ex_flutter_kicks', 'Flutter kicks', 'TIMED', 'CORE'),
  training('ex_russian_twists', 'Russian twists', 'REP_BASED', 'CORE'),
  training('ex_crunches', 'Crunches', 'REP_BASED', 'CORE'),
  training('ex_lying_leg_raises', 'Lying leg raises', 'REP_BASED', 'CORE'),
  training('ex_mountain_climbers', 'Mountain climbers', 'TIMED', 'CORE'),
  training('ex_boat_pose_hold', 'Boat pose hold', 'TIMED', 'CORE'),
  training('ex_windshield_wipers', 'Windshield wipers', 'REP_BASED', 'CORE'),
  training('ex_side_plank', 'Side plank', 'TIMED', 'CORE'),
  training('ex_reverse_crunches', 'Reverse crunches', 'REP_BASED', 'CORE'),
  training('ex_standing_toe_touches', 'Standing toe touches', 'REP_BASED', 'CORE'),
  training('ex_heel_taps', 'Heel taps', 'REP_BASED', 'CORE'),
  training('ex_plank_jacks', 'Plank jacks', 'TIMED', 'CORE'),
  training('ex_star_plank_hold', 'Star plank hold', 'TIMED', 'CORE'),
  training('ex_seated_in_and_outs', 'Seated in-and-outs', 'REP_BASED', 'CORE'),
  training('ex_side_lying_oblique_crunch', 'Side-lying oblique crunch', 'REP_BASED', 'CORE'),
  training('ex_plank_shoulder_reach', 'Plank shoulder reach', 'REP_BASED', 'CORE'),
  training('ex_bear_hold', 'Bear hold', 'TIMED', 'CORE'),
  training('ex_sit_throughs', 'Sit-throughs', 'REP_BASED', 'CORE'),

  training('ex_pike_push_ups', 'Pike push-ups', 'REP_BASED', 'UPPER_BODY'),
  training('ex_superman_hold', 'Superman hold', 'TIMED', 'UPPER_BODY'),
  training('ex_diamond_push_ups', 'Diamond push-ups', 'REP_BASED', 'UPPER_BODY'),
  training('ex_wide_grip_push_ups', 'Wide-grip push-ups', 'REP_BASED', 'UPPER_BODY'),
  training('ex_incline_push_ups', 'Incline push-ups', 'REP_BASED', 'UPPER_BODY'),
  training('ex_decline_push_ups', 'Decline push-ups', 'REP_BASED', 'UPPER_BODY'),
  training('ex_tricep_dips', 'Tricep dips', 'REP_BASED', 'UPPER_BODY'),
  training('ex_plank_up_downs', 'Plank up-downs', 'REP_BASED', 'UPPER_BODY'),
  training('ex_archer_push_ups', 'Archer push-ups', 'REP_BASED', 'UPPER_BODY'),
  training('ex_plank_shoulder_taps', 'Plank shoulder taps', 'REP_BASED', 'UPPER_BODY'),
  training('ex_bear_crawl', 'Bear crawl', 'TIMED', 'UPPER_BODY'),
  training('ex_crab_walk', 'Crab walk', 'TIMED', 'UPPER_BODY'),
  training('ex_bottom_push_up_hold', 'Bottom push-up hold', 'TIMED', 'UPPER_BODY'),
  training('ex_wall_walk_ups', 'Wall walk-ups', 'REP_BASED', 'UPPER_BODY'),
  training('ex_clap_push_ups', 'Clap push-ups', 'REP_BASED', 'UPPER_BODY'),
  training('ex_staggered_push_ups', 'Staggered push-ups', 'REP_BASED', 'UPPER_BODY'),
  training('ex_pike_shrugs', 'Pike shrugs', 'REP_BASED', 'UPPER_BODY'),

  training('ex_jump_squats', 'Jump squats', 'REP_BASED', 'LOWER_BODY'),
  training('ex_glute_bridges', 'Glute bridges', 'REP_BASED', 'LOWER_BODY'),
  training('ex_single_leg_glute_bridge', 'Single-leg glute bridge', 'REP_BASED', 'LOWER_BODY'),
  training('ex_reverse_lunges', 'Reverse lunges', 'REP_BASED', 'LOWER_BODY'),
  training('ex_curtsy_lunges', 'Curtsy lunges', 'REP_BASED', 'LOWER_BODY'),
  training('ex_calf_raises', 'Calf raises', 'REP_BASED', 'LOWER_BODY'),
  training('ex_side_lunges', 'Side lunges', 'REP_BASED', 'LOWER_BODY'),
  training('ex_assisted_pistol_squats', 'Assisted pistol squats', 'REP_BASED', 'LOWER_BODY'),
  training('ex_frog_jumps', 'Frog jumps', 'REP_BASED', 'LOWER_BODY'),
  training('ex_step_ups', 'Step-ups', 'REP_BASED', 'LOWER_BODY'),
  training('ex_slow_motion_squats', 'Slow-motion squats', 'REP_BASED', 'LOWER_BODY'),
  training('ex_cossack_squats', 'Cossack squats', 'REP_BASED', 'LOWER_BODY'),
  training('ex_split_squats', 'Split squats', 'REP_BASED', 'LOWER_BODY'),
  training('ex_single_leg_deadlifts', 'Single-leg deadlifts', 'REP_BASED', 'LOWER_BODY'),
  training('ex_glute_bridge_marches', 'Glute bridge marches', 'REP_BASED', 'LOWER_BODY'),
  training('ex_skater_jumps', 'Skater jumps', 'REP_BASED', 'LOWER_BODY'),
  training('ex_wall_sit_pulses', 'Wall sit pulses', 'REP_BASED', 'LOWER_BODY'),
  training('ex_tiptoe_walk', 'Tiptoe walk', 'TIMED', 'LOWER_BODY'),

  stretch('ex_hip_flexor_stretch', 'Hip flexor stretch', 'LOWER_BODY'),
  stretch('ex_hamstring_stretch', 'Hamstring stretch', 'LOWER_BODY'),
  stretch('ex_cobra_stretch', 'Cobra stretch', 'GLOBAL'),
  stretch('ex_doorway_chest_stretch', 'Doorway chest stretch', 'UPPER_BODY'),
  stretch('ex_overhead_tricep_stretch', 'Overhead tricep stretch', 'UPPER_BODY'),
  stretch('ex_figure_four_glute_stretch', 'Figure-4 glute stretch', 'LOWER_BODY'),
  stretch('ex_calf_stretch', 'Calf stretch', 'LOWER_BODY'),
  stretch('ex_cat_cow', 'Cat-cow', 'GLOBAL'),
]);

Object.freeze(LIBRARY_EXERCISES);

/** Existing catalog IDs reused by imported templates. Do not duplicate. */
export const LIBRARY_REUSED_EXERCISE_IDS = Object.freeze([
  'ex_plank',
  'ex_sit_ups',
  'ex_push_ups',
  'ex_squats',
  'ex_lunges',
  'ex_wall_sit',
  'ex_quad_stretch',
  'ex_shoulder_stretch',
  'ex_child_pose',
]);

export const EXISTING_STRETCH_EXERCISE_IDS = Object.freeze([
  'ex_neck_rolls',
  'ex_arm_circles',
  'ex_shoulder_stretch',
  'ex_quad_stretch',
  'ex_child_pose',
]);

export const LIBRARY_STRETCH_EXERCISE_IDS: readonly ExerciseId[] = Object.freeze(
  LIBRARY_EXERCISES.filter((spec) => spec.kind === 'stretch').map((spec) => spec.id),
);

export const ALL_STRETCH_EXERCISE_IDS: readonly ExerciseId[] = Object.freeze([
  ...EXISTING_STRETCH_EXERCISE_IDS,
  ...LIBRARY_STRETCH_EXERCISE_IDS,
]);

function core(sourceTemplate: number, exerciseIds: readonly ExerciseId[]): LibraryTemplateSpec {
  const n = String(sourceTemplate).padStart(2, '0');
  return {
    id: `wk_core_${n}`,
    sourceTemplate,
    name: `Core circuit ${n}`,
    description: 'Authored core exercise sequence.',
    section: 'CORE',
    exerciseIds,
  };
}

function upper(sourceTemplate: number, index: number, exerciseIds: readonly ExerciseId[]): LibraryTemplateSpec {
  const n = String(index).padStart(2, '0');
  return {
    id: `wk_upper_${n}`,
    sourceTemplate,
    name: `Upper-body circuit ${n}`,
    description: 'Authored upper-body exercise sequence.',
    section: 'UPPER_BODY',
    exerciseIds,
  };
}

function lower(sourceTemplate: number, index: number, exerciseIds: readonly ExerciseId[]): LibraryTemplateSpec {
  const n = String(index).padStart(2, '0');
  return {
    id: `wk_lower_${n}`,
    sourceTemplate,
    name: `Lower-body circuit ${n}`,
    description: 'Authored lower-body exercise sequence.',
    section: 'LOWER_BODY',
    exerciseIds,
  };
}

export const LIBRARY_TEMPLATES: readonly LibraryTemplateSpec[] = Object.freeze([
  core(1, ['ex_plank', 'ex_crunches', 'ex_bicycle_crunches', 'ex_lying_leg_raises', 'ex_hollow_body_hold', 'ex_russian_twists', 'ex_dead_bug', 'ex_v_ups']),
  core(2, ['ex_hollow_body_hold', 'ex_boat_pose_hold', 'ex_v_ups', 'ex_standing_toe_touches', 'ex_sit_ups', 'ex_reverse_crunches', 'ex_flutter_kicks', 'ex_plank', 'ex_crunches']),
  core(3, ['ex_bicycle_crunches', 'ex_scissor_kicks', 'ex_flutter_kicks', 'ex_mountain_climbers', 'ex_russian_twists', 'ex_windshield_wipers', 'ex_lying_leg_raises', 'ex_plank']),
  core(4, ['ex_plank', 'ex_hollow_body_hold', 'ex_side_plank', 'ex_boat_pose_hold', 'ex_superman_hold', 'ex_plank', 'ex_side_plank']),
  core(5, ['ex_crunches', 'ex_reverse_crunches', 'ex_bicycle_crunches', 'ex_russian_twists', 'ex_v_ups', 'ex_lying_leg_raises', 'ex_flutter_kicks', 'ex_scissor_kicks', 'ex_plank', 'ex_hollow_body_hold']),
  core(6, ['ex_russian_twists', 'ex_bicycle_crunches', 'ex_windshield_wipers', 'ex_mountain_climbers', 'ex_side_plank', 'ex_scissor_kicks', 'ex_plank']),
  core(7, ['ex_dead_bug', 'ex_hollow_body_hold', 'ex_flutter_kicks', 'ex_scissor_kicks', 'ex_reverse_crunches', 'ex_crunches', 'ex_lying_leg_raises', 'ex_plank']),
  core(8, ['ex_plank', 'ex_v_ups', 'ex_bicycle_crunches', 'ex_russian_twists', 'ex_lying_leg_raises', 'ex_hollow_body_hold', 'ex_mountain_climbers', 'ex_side_plank', 'ex_boat_pose_hold', 'ex_crunches']),
  core(9, ['ex_plank', 'ex_plank_jacks', 'ex_plank_shoulder_reach', 'ex_star_plank_hold', 'ex_side_plank', 'ex_bear_hold', 'ex_plank']),
  core(10, ['ex_heel_taps', 'ex_side_lying_oblique_crunch', 'ex_sit_throughs', 'ex_bicycle_crunches', 'ex_plank_shoulder_reach', 'ex_seated_in_and_outs', 'ex_crunches']),
  core(11, ['ex_bear_hold', 'ex_sit_throughs', 'ex_bear_crawl', 'ex_plank_jacks', 'ex_star_plank_hold', 'ex_heel_taps', 'ex_plank']),
  core(12, ['ex_seated_in_and_outs', 'ex_russian_twists', 'ex_boat_pose_hold', 'ex_heel_taps', 'ex_side_lying_oblique_crunch', 'ex_hollow_body_hold', 'ex_crunches']),
  core(13, ['ex_hollow_body_hold', 'ex_flutter_kicks', 'ex_scissor_kicks', 'ex_lying_leg_raises', 'ex_dead_bug', 'ex_toes_to_sky', 'ex_hollow_body_hold', 'ex_plank']),
  core(14, ['ex_sit_ups', 'ex_reverse_crunches', 'ex_lying_leg_raises', 'ex_dead_bug', 'ex_boat_pose_hold', 'ex_plank', 'ex_star_plank_hold']),
  core(15, ['ex_side_lying_oblique_crunch', 'ex_russian_twists', 'ex_windshield_wipers', 'ex_side_plank', 'ex_heel_taps', 'ex_bicycle_crunches', 'ex_side_plank']),
  core(16, ['ex_flutter_kicks', 'ex_scissor_kicks', 'ex_mountain_climbers', 'ex_flutter_kicks', 'ex_plank_jacks', 'ex_scissor_kicks', 'ex_hollow_body_hold']),
  core(17, ['ex_crunches', 'ex_bicycle_crunches', 'ex_plank', 'ex_reverse_crunches', 'ex_hollow_body_hold']),
  core(18, ['ex_sit_ups', 'ex_v_ups', 'ex_standing_toe_touches', 'ex_crunches', 'ex_sit_throughs', 'ex_seated_in_and_outs', 'ex_plank']),

  upper(19, 1, ['ex_push_ups', 'ex_wide_grip_push_ups', 'ex_diamond_push_ups', 'ex_tricep_dips', 'ex_superman_hold', 'ex_push_ups']),
  upper(20, 2, ['ex_pike_push_ups', 'ex_plank_shoulder_taps', 'ex_plank_up_downs', 'ex_pike_push_ups', 'ex_superman_hold', 'ex_tricep_dips']),
  upper(21, 3, ['ex_bear_crawl', 'ex_crab_walk', 'ex_bear_crawl', 'ex_plank_shoulder_taps', 'ex_wide_grip_push_ups', 'ex_crab_walk', 'ex_superman_hold']),
  upper(22, 4, ['ex_push_ups', 'ex_wide_grip_push_ups', 'ex_diamond_push_ups', 'ex_archer_push_ups', 'ex_incline_push_ups', 'ex_decline_push_ups', 'ex_pike_push_ups']),
  upper(23, 5, ['ex_diamond_push_ups', 'ex_tricep_dips', 'ex_diamond_push_ups', 'ex_plank_up_downs', 'ex_tricep_dips', 'ex_pike_push_ups', 'ex_superman_hold']),
  upper(24, 6, ['ex_superman_hold', 'ex_push_ups', 'ex_plank_shoulder_taps', 'ex_superman_hold', 'ex_bear_crawl', 'ex_wide_grip_push_ups', 'ex_superman_hold']),
  upper(25, 7, ['ex_wide_grip_push_ups', 'ex_diamond_push_ups', 'ex_wide_grip_push_ups', 'ex_diamond_push_ups', 'ex_archer_push_ups', 'ex_plank_up_downs', 'ex_tricep_dips']),
  upper(26, 8, ['ex_push_ups', 'ex_clap_push_ups', 'ex_staggered_push_ups', 'ex_bottom_push_up_hold', 'ex_clap_push_ups', 'ex_tricep_dips', 'ex_superman_hold']),
  upper(27, 9, ['ex_wall_walk_ups', 'ex_pike_push_ups', 'ex_pike_shrugs', 'ex_plank_shoulder_taps', 'ex_wall_walk_ups', 'ex_bottom_push_up_hold']),
  upper(28, 10, ['ex_push_ups', 'ex_pike_push_ups', 'ex_tricep_dips', 'ex_plank_shoulder_taps', 'ex_wide_grip_push_ups', 'ex_superman_hold', 'ex_bottom_push_up_hold']),
  upper(29, 11, ['ex_incline_push_ups', 'ex_push_ups', 'ex_decline_push_ups', 'ex_pike_push_ups', 'ex_incline_push_ups', 'ex_plank_up_downs', 'ex_superman_hold']),
  upper(30, 12, ['ex_wide_grip_push_ups', 'ex_push_ups', 'ex_staggered_push_ups', 'ex_decline_push_ups', 'ex_bottom_push_up_hold', 'ex_diamond_push_ups', 'ex_superman_hold']),
  upper(31, 13, ['ex_crab_walk', 'ex_tricep_dips', 'ex_crab_walk', 'ex_bear_crawl', 'ex_plank_up_downs', 'ex_superman_hold']),
  upper(32, 14, ['ex_pike_push_ups', 'ex_pike_shrugs', 'ex_wall_walk_ups', 'ex_plank_shoulder_taps', 'ex_pike_push_ups', 'ex_superman_hold']),
  upper(33, 15, ['ex_push_ups', 'ex_diamond_push_ups', 'ex_tricep_dips', 'ex_superman_hold', 'ex_bottom_push_up_hold']),

  lower(34, 1, ['ex_squats', 'ex_slow_motion_squats', 'ex_jump_squats', 'ex_side_lunges', 'ex_wall_sit', 'ex_squats', 'ex_calf_raises']),
  lower(35, 2, ['ex_lunges', 'ex_reverse_lunges', 'ex_side_lunges', 'ex_curtsy_lunges', 'ex_lunges', 'ex_wall_sit', 'ex_calf_raises']),
  lower(36, 3, ['ex_glute_bridges', 'ex_single_leg_glute_bridge', 'ex_squats', 'ex_curtsy_lunges', 'ex_glute_bridges', 'ex_step_ups', 'ex_single_leg_glute_bridge']),
  lower(37, 4, ['ex_jump_squats', 'ex_frog_jumps', 'ex_jump_squats', 'ex_step_ups', 'ex_frog_jumps', 'ex_wall_sit', 'ex_calf_raises']),
  lower(38, 5, ['ex_squats', 'ex_lunges', 'ex_glute_bridges', 'ex_calf_raises', 'ex_reverse_lunges', 'ex_wall_sit', 'ex_squats', 'ex_step_ups', 'ex_calf_raises']),
  lower(39, 6, ['ex_single_leg_glute_bridge', 'ex_assisted_pistol_squats', 'ex_curtsy_lunges', 'ex_single_leg_glute_bridge', 'ex_assisted_pistol_squats', 'ex_step_ups', 'ex_wall_sit']),
  lower(40, 7, ['ex_slow_motion_squats', 'ex_wall_sit', 'ex_slow_motion_squats', 'ex_glute_bridges', 'ex_reverse_lunges', 'ex_slow_motion_squats', 'ex_calf_raises']),
  lower(41, 8, ['ex_frog_jumps', 'ex_curtsy_lunges', 'ex_frog_jumps', 'ex_jump_squats', 'ex_side_lunges', 'ex_frog_jumps', 'ex_wall_sit', 'ex_calf_raises']),
  lower(42, 9, ['ex_cossack_squats', 'ex_split_squats', 'ex_side_lunges', 'ex_cossack_squats', 'ex_wall_sit_pulses', 'ex_calf_raises']),
  lower(43, 10, ['ex_single_leg_deadlifts', 'ex_split_squats', 'ex_glute_bridge_marches', 'ex_single_leg_deadlifts', 'ex_assisted_pistol_squats', 'ex_tiptoe_walk']),
  lower(44, 11, ['ex_skater_jumps', 'ex_frog_jumps', 'ex_jump_squats', 'ex_skater_jumps', 'ex_frog_jumps', 'ex_wall_sit_pulses', 'ex_calf_raises']),
  lower(45, 12, ['ex_calf_raises', 'ex_tiptoe_walk', 'ex_calf_raises', 'ex_skater_jumps', 'ex_tiptoe_walk', 'ex_wall_sit']),
  lower(46, 13, ['ex_squats', 'ex_split_squats', 'ex_wall_sit', 'ex_slow_motion_squats', 'ex_step_ups', 'ex_wall_sit_pulses', 'ex_calf_raises']),
  lower(47, 14, ['ex_single_leg_deadlifts', 'ex_glute_bridges', 'ex_glute_bridge_marches', 'ex_single_leg_glute_bridge', 'ex_reverse_lunges', 'ex_single_leg_deadlifts', 'ex_calf_raises']),
  lower(48, 15, ['ex_wall_sit', 'ex_wall_sit_pulses', 'ex_squats', 'ex_wall_sit', 'ex_calf_raises', 'ex_wall_sit_pulses']),
  lower(49, 16, ['ex_step_ups', 'ex_lunges', 'ex_step_ups', 'ex_calf_raises', 'ex_split_squats', 'ex_wall_sit']),
  lower(50, 17, ['ex_squats', 'ex_lunges', 'ex_glute_bridges', 'ex_calf_raises', 'ex_wall_sit']),
  lower(51, 18, ['ex_glute_bridges', 'ex_curtsy_lunges', 'ex_single_leg_glute_bridge', 'ex_glute_bridge_marches', 'ex_cossack_squats', 'ex_side_lunges', 'ex_wall_sit']),
]);

Object.freeze(LIBRARY_TEMPLATES);
for (const template of LIBRARY_TEMPLATES) {
  Object.freeze(template.exerciseIds);
  Object.freeze(template);
}
