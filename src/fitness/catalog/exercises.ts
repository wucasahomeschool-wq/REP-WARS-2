import { cloneExerciseDefinition, validateExerciseCatalog } from '../validation';
import { ExerciseDefinition, ExerciseId } from '../types';
import {
  LIBRARY_DEFAULT_DURATION_SECONDS,
  LIBRARY_DEFAULT_REPETITIONS,
  LIBRARY_EXERCISES,
  LibraryExerciseSpec,
} from './library';

function fromLibrarySpec(spec: LibraryExerciseSpec): ExerciseDefinition {
  return {
    id: spec.id,
    name: spec.name,
    type: spec.type,
    bodySection: spec.bodySection,
    defaultPrescription: spec.type === 'REP_BASED'
      ? { kind: 'repetitions', repetitions: LIBRARY_DEFAULT_REPETITIONS }
      : { kind: 'duration', durationSeconds: LIBRARY_DEFAULT_DURATION_SECONDS },
    isRest: false,
    metadata: spec.kind === 'stretch' ? { notes: 'Stretch' } : {},
  };
}

const EXERCISE_DEFS: ExerciseDefinition[] = [
  {
    id: 'ex_rest',
    name: 'Rest',
    type: 'REST',
    bodySection: 'GLOBAL',
    defaultPrescription: { kind: 'duration', durationSeconds: 30 },
    isRest: true,
    metadata: { notes: 'Blank recovery interval. Skippable.' },
  },
  {
    id: 'ex_neck_rolls',
    name: 'Neck rolls',
    type: 'TIMED',
    bodySection: 'GLOBAL',
    defaultPrescription: { kind: 'duration', durationSeconds: 20 },
    isRest: false,
    metadata: { notes: 'Opening mobility' },
  },
  {
    id: 'ex_arm_circles',
    name: 'Arm circles',
    type: 'TIMED',
    bodySection: 'UPPER_BODY',
    defaultPrescription: { kind: 'duration', durationSeconds: 20 },
    isRest: false,
    metadata: { notes: 'Opening / upper-body warmup' },
  },
  {
    id: 'ex_push_ups',
    name: 'Push-ups',
    type: 'REP_BASED',
    bodySection: 'UPPER_BODY',
    defaultPrescription: { kind: 'repetitions', repetitions: 10 },
    isRest: false,
    metadata: {},
  },
  {
    id: 'ex_squats',
    name: 'Squats',
    type: 'REP_BASED',
    bodySection: 'LOWER_BODY',
    defaultPrescription: { kind: 'repetitions', repetitions: 12 },
    isRest: false,
    metadata: {},
  },
  {
    id: 'ex_lunges',
    name: 'Lunges',
    type: 'REP_BASED',
    bodySection: 'LOWER_BODY',
    defaultPrescription: { kind: 'repetitions', repetitions: 10 },
    isRest: false,
    metadata: {},
  },
  {
    id: 'ex_sit_ups',
    name: 'Sit-ups',
    type: 'REP_BASED',
    bodySection: 'CORE',
    defaultPrescription: { kind: 'repetitions', repetitions: 12 },
    isRest: false,
    metadata: {},
  },
  {
    id: 'ex_plank',
    name: 'Plank',
    type: 'TIMED',
    bodySection: 'CORE',
    defaultPrescription: { kind: 'duration', durationSeconds: 20 },
    isRest: false,
    metadata: {},
  },
  {
    id: 'ex_wall_sit',
    name: 'Wall sit',
    type: 'TIMED',
    bodySection: 'LOWER_BODY',
    defaultPrescription: { kind: 'duration', durationSeconds: 20 },
    isRest: false,
    metadata: {},
  },
  {
    id: 'ex_shoulder_stretch',
    name: 'Shoulder stretch',
    type: 'TIMED',
    bodySection: 'UPPER_BODY',
    defaultPrescription: { kind: 'duration', durationSeconds: 20 },
    isRest: false,
    metadata: { notes: 'Final stretching' },
  },
  {
    id: 'ex_quad_stretch',
    name: 'Quad stretch',
    type: 'TIMED',
    bodySection: 'LOWER_BODY',
    defaultPrescription: { kind: 'duration', durationSeconds: 20 },
    isRest: false,
    metadata: { notes: 'Final stretching' },
  },
  {
    id: 'ex_child_pose',
    name: 'Child pose',
    type: 'TIMED',
    bodySection: 'GLOBAL',
    defaultPrescription: { kind: 'duration', durationSeconds: 30 },
    isRest: false,
    metadata: { notes: 'Closing stretch' },
  },
  ...LIBRARY_EXERCISES.map(fromLibrarySpec),
];

const catalogIssues = validateExerciseCatalog(EXERCISE_DEFS);
if (catalogIssues.length > 0) {
  throw new Error(`Invalid exercise catalog: ${catalogIssues[0]!.message}`);
}

for (const exercise of EXERCISE_DEFS) {
  Object.freeze(exercise.defaultPrescription);
  Object.freeze(exercise.metadata);
  Object.freeze(exercise);
}
Object.freeze(EXERCISE_DEFS);

const BY_ID = new Map<ExerciseId, ExerciseDefinition>(EXERCISE_DEFS.map((e) => [e.id, e]));

export function listExerciseDefinitions(): ExerciseDefinition[] {
  return EXERCISE_DEFS.map(cloneExerciseDefinition);
}

export function getExerciseDefinition(id: ExerciseId): ExerciseDefinition | undefined {
  const found = BY_ID.get(id);
  return found ? cloneExerciseDefinition(found) : undefined;
}

export function exerciseCatalogById(): ReadonlyMap<ExerciseId, ExerciseDefinition> {
  return BY_ID;
}
