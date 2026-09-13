import { skippableForExerciseType, clonePrescription } from '../guards';
import {
  ExerciseId,
  ExercisePrescription,
  WorkoutDefinition,
  WorkoutExercise,
  WorkoutExerciseRole,
} from '../types';
import { cloneWorkoutDefinition, validateWorkoutCatalog } from '../validation';
import { exerciseCatalogById } from './exercises';

interface WorkoutStepSpec {
  exerciseId: ExerciseId;
  role: WorkoutExerciseRole;
  prescription?: ExercisePrescription;
}

function buildSteps(specs: WorkoutStepSpec[]): WorkoutExercise[] {
  const catalog = exerciseCatalogById();
  return specs.map((spec, order) => {
    const def = catalog.get(spec.exerciseId);
    if (!def) {
      throw new Error(`Unknown exercise ${spec.exerciseId}`);
    }
    return {
      exerciseId: spec.exerciseId,
      order,
      prescription: spec.prescription
        ? clonePrescription(spec.prescription)
        : clonePrescription(def.defaultPrescription),
      role: spec.role,
      skippable: skippableForExerciseType(def.type),
    };
  });
}

const WORKOUT_DEFS: WorkoutDefinition[] = [
  {
    id: 'wk_very_easy_mobility',
    name: 'Easy Mobility',
    description: 'Short opening mobility, one rest, and a closing stretch.',
    intendedDifficulty: 'VERY_EASY',
    exercises: buildSteps([
      { exerciseId: 'ex_neck_rolls', role: 'OPENING_STRETCH' },
      { exerciseId: 'ex_arm_circles', role: 'OPENING_STRETCH' },
      { exerciseId: 'ex_rest', role: 'REST', prescription: { kind: 'duration', durationSeconds: 20 } },
      { exerciseId: 'ex_child_pose', role: 'FINAL_STRETCH' },
    ]),
    metadata: { estimatedDurationSeconds: 90, tags: ['mobility', 'short'] },
  },
  {
    id: 'wk_easy_core',
    name: 'Easy Core',
    description: 'Light core work with rest between timed and rep-based steps.',
    intendedDifficulty: 'EASY',
    exercises: buildSteps([
      { exerciseId: 'ex_neck_rolls', role: 'OPENING_STRETCH' },
      { exerciseId: 'ex_sit_ups', role: 'CORE', prescription: { kind: 'repetitions', repetitions: 8 } },
      { exerciseId: 'ex_rest', role: 'REST' },
      { exerciseId: 'ex_plank', role: 'CORE', prescription: { kind: 'duration', durationSeconds: 15 } },
      { exerciseId: 'ex_rest', role: 'REST', prescription: { kind: 'duration', durationSeconds: 20 } },
      { exerciseId: 'ex_child_pose', role: 'FINAL_STRETCH' },
    ]),
    metadata: { estimatedDurationSeconds: 150, tags: ['core'] },
  },
  {
    id: 'wk_moderate_full_body',
    name: 'Moderate Full Body',
    description: 'Upper, lower, and core work with mixed rep and timed exercises.',
    intendedDifficulty: 'MODERATE',
    exercises: buildSteps([
      { exerciseId: 'ex_neck_rolls', role: 'OPENING_STRETCH' },
      { exerciseId: 'ex_arm_circles', role: 'OPENING_STRETCH' },
      { exerciseId: 'ex_push_ups', role: 'UPPER_BODY' },
      { exerciseId: 'ex_rest', role: 'REST' },
      { exerciseId: 'ex_squats', role: 'LOWER_BODY' },
      { exerciseId: 'ex_rest', role: 'REST' },
      { exerciseId: 'ex_sit_ups', role: 'CORE' },
      { exerciseId: 'ex_plank', role: 'CORE' },
      { exerciseId: 'ex_shoulder_stretch', role: 'FINAL_STRETCH' },
      { exerciseId: 'ex_quad_stretch', role: 'FINAL_STRETCH' },
    ]),
    metadata: { estimatedDurationSeconds: 300, tags: ['full-body'] },
  },
  {
    id: 'wk_hard_full_body_basics',
    name: 'Full Body Basics',
    description: 'Hard intended difficulty with repeated push-ups and all body sections.',
    intendedDifficulty: 'HARD',
    exercises: buildSteps([
      { exerciseId: 'ex_neck_rolls', role: 'OPENING_STRETCH' },
      { exerciseId: 'ex_arm_circles', role: 'OPENING_STRETCH' },
      { exerciseId: 'ex_push_ups', role: 'UPPER_BODY', prescription: { kind: 'repetitions', repetitions: 10 } },
      { exerciseId: 'ex_rest', role: 'REST', prescription: { kind: 'duration', durationSeconds: 20 } },
      { exerciseId: 'ex_push_ups', role: 'UPPER_BODY', prescription: { kind: 'repetitions', repetitions: 10 } },
      { exerciseId: 'ex_squats', role: 'LOWER_BODY' },
      { exerciseId: 'ex_lunges', role: 'LOWER_BODY' },
      { exerciseId: 'ex_rest', role: 'REST' },
      { exerciseId: 'ex_sit_ups', role: 'CORE' },
      { exerciseId: 'ex_plank', role: 'CORE', prescription: { kind: 'duration', durationSeconds: 30 } },
      { exerciseId: 'ex_wall_sit', role: 'LOWER_BODY' },
      { exerciseId: 'ex_shoulder_stretch', role: 'FINAL_STRETCH' },
      { exerciseId: 'ex_quad_stretch', role: 'FINAL_STRETCH' },
      { exerciseId: 'ex_child_pose', role: 'FINAL_STRETCH' },
    ]),
    metadata: { estimatedDurationSeconds: 480, tags: ['full-body', 'basics'] },
  },
  {
    id: 'wk_very_hard_endurance',
    name: 'Endurance Circuit',
    description: 'Longer circuit with repeated main lifts and extended timed holds.',
    intendedDifficulty: 'VERY_HARD',
    exercises: buildSteps([
      { exerciseId: 'ex_neck_rolls', role: 'OPENING_STRETCH' },
      { exerciseId: 'ex_arm_circles', role: 'OPENING_STRETCH' },
      { exerciseId: 'ex_push_ups', role: 'UPPER_BODY', prescription: { kind: 'repetitions', repetitions: 15 } },
      { exerciseId: 'ex_rest', role: 'REST', prescription: { kind: 'duration', durationSeconds: 15 } },
      { exerciseId: 'ex_push_ups', role: 'MAIN', prescription: { kind: 'repetitions', repetitions: 15 } },
      { exerciseId: 'ex_squats', role: 'LOWER_BODY', prescription: { kind: 'repetitions', repetitions: 20 } },
      { exerciseId: 'ex_rest', role: 'REST', prescription: { kind: 'duration', durationSeconds: 15 } },
      { exerciseId: 'ex_squats', role: 'MAIN', prescription: { kind: 'repetitions', repetitions: 20 } },
      { exerciseId: 'ex_lunges', role: 'LOWER_BODY', prescription: { kind: 'repetitions', repetitions: 16 } },
      { exerciseId: 'ex_sit_ups', role: 'CORE', prescription: { kind: 'repetitions', repetitions: 20 } },
      { exerciseId: 'ex_rest', role: 'REST' },
      { exerciseId: 'ex_sit_ups', role: 'CORE', prescription: { kind: 'repetitions', repetitions: 20 } },
      { exerciseId: 'ex_plank', role: 'CORE', prescription: { kind: 'duration', durationSeconds: 45 } },
      { exerciseId: 'ex_wall_sit', role: 'LOWER_BODY', prescription: { kind: 'duration', durationSeconds: 40 } },
      { exerciseId: 'ex_shoulder_stretch', role: 'FINAL_STRETCH' },
      { exerciseId: 'ex_quad_stretch', role: 'FINAL_STRETCH' },
      { exerciseId: 'ex_child_pose', role: 'FINAL_STRETCH' },
    ]),
    metadata: { estimatedDurationSeconds: 720, tags: ['endurance', 'long'] },
  },
];

const catalogIssues = validateWorkoutCatalog(WORKOUT_DEFS, exerciseCatalogById());
if (catalogIssues.length > 0) {
  throw new Error(`Invalid workout catalog: ${catalogIssues[0]!.message}`);
}

for (const workout of WORKOUT_DEFS) {
  for (const step of workout.exercises) {
    Object.freeze(step.prescription);
    Object.freeze(step);
  }
  if (workout.metadata.tags) Object.freeze(workout.metadata.tags);
  Object.freeze(workout.exercises);
  Object.freeze(workout.metadata);
  Object.freeze(workout);
}
Object.freeze(WORKOUT_DEFS);

const BY_ID = new Map(WORKOUT_DEFS.map((w) => [w.id, w]));

export function listWorkoutDefinitions(): WorkoutDefinition[] {
  return WORKOUT_DEFS.map(cloneWorkoutDefinition);
}

export function getWorkoutDefinition(id: string): WorkoutDefinition | undefined {
  const found = BY_ID.get(id);
  return found ? cloneWorkoutDefinition(found) : undefined;
}
