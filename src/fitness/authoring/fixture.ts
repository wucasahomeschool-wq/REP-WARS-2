/**
 * TEST FIXTURE ONLY.
 * Not production content. The workout-authoring branch owns real catalogs.
 */
import { WorkoutAuthoringDocument, WORKOUT_AUTHORING_FORMAT } from './types';

export const AUTHORED_V2_FIXTURE_CATALOG_ID = 'fixture.workout-authoring.sample';
export const AUTHORED_V2_FIXTURE_CATALOG_VERSION = '0.0.1-test';

export function sampleAuthoringDocumentV2(): WorkoutAuthoringDocument {
  return {
    formatVersion: WORKOUT_AUTHORING_FORMAT,
    catalogId: AUTHORED_V2_FIXTURE_CATALOG_ID,
    catalogVersion: AUTHORED_V2_FIXTURE_CATALOG_VERSION,
    authorNotes: 'Tiny fixture for engine tests. Not a real training program.',
    measurementModels: [
      {
        id: 'mm_reps',
        kind: 'REPETITIONS',
        validPrescriptionKinds: ['REPETITIONS'],
      },
      {
        id: 'mm_duration',
        kind: 'DURATION',
        validPrescriptionKinds: ['DURATION_SECONDS'],
      },
      {
        id: 'mm_hold',
        kind: 'HOLD_DURATION',
        validPrescriptionKinds: ['DURATION_SECONDS'],
      },
    ],
    movementFamilies: [
      {
        id: 'mf_horizontal_push',
        name: 'Horizontal Push',
        stages: [
          { id: 'ms_hp_1', name: 'Stage 1', order: 0 },
          { id: 'ms_hp_2', name: 'Stage 2', order: 1 },
        ],
      },
      {
        id: 'mf_squat',
        name: 'Squat',
        stages: [
          { id: 'ms_sq_1', name: 'Stage 1', order: 0 },
          { id: 'ms_sq_2', name: 'Stage 2', order: 1 },
          { id: 'ms_sq_3', name: 'Stage 3', order: 2 },
        ],
      },
    ],
    progressionBands: [
      {
        id: 'band_1a',
        name: '1A',
        order: 0,
        selectionWindowBandIds: ['band_1a', 'band_1b'],
      },
      {
        id: 'band_1b',
        name: '1B',
        order: 1,
        selectionWindowBandIds: ['band_1a', 'band_1b', 'band_2a'],
      },
      {
        id: 'band_2a',
        name: '2A',
        order: 2,
        selectionWindowBandIds: ['band_1b', 'band_2a'],
      },
    ],
    exercises: [
      {
        id: 'ax_hp_incline',
        name: 'Incline Push',
        movementFamilyId: 'mf_horizontal_push',
        movementStageId: 'ms_hp_1',
        measurementModelId: 'mm_reps',
        defaultPrescription: { kind: 'REPETITIONS', repetitions: 8 },
      },
      {
        id: 'ax_hp_floor',
        name: 'Floor Push',
        movementFamilyId: 'mf_horizontal_push',
        movementStageId: 'ms_hp_2',
        measurementModelId: 'mm_reps',
        defaultPrescription: { kind: 'REPETITIONS', repetitions: 6 },
      },
      {
        id: 'ax_sit_squat',
        name: 'Sit to Stand',
        movementFamilyId: 'mf_squat',
        movementStageId: 'ms_sq_1',
        measurementModelId: 'mm_reps',
        defaultPrescription: { kind: 'REPETITIONS', repetitions: 8 },
      },
      {
        id: 'ax_bodyweight_squat',
        name: 'Bodyweight Squat',
        movementFamilyId: 'mf_squat',
        movementStageId: 'ms_sq_2',
        measurementModelId: 'mm_reps',
        defaultPrescription: { kind: 'REPETITIONS', repetitions: 10 },
      },
      {
        id: 'ax_hold',
        name: 'Brace Hold',
        movementFamilyId: 'mf_horizontal_push',
        movementStageId: 'ms_hp_1',
        measurementModelId: 'mm_hold',
        defaultPrescription: { kind: 'DURATION_SECONDS', durationSeconds: 20 },
      },
      {
        id: 'ax_rest',
        name: 'Rest',
        movementFamilyId: 'mf_horizontal_push',
        movementStageId: 'ms_hp_1',
        measurementModelId: 'mm_duration',
        defaultPrescription: { kind: 'DURATION_SECONDS', durationSeconds: 15 },
        isRest: true,
      },
    ],
    workoutFamilies: [
      {
        id: 'wf_foundations',
        name: 'Foundations',
        workoutIds: ['aw_foundations_short', 'aw_foundations_standard', 'aw_foundations_long'],
      },
      {
        id: 'wf_bridge',
        name: 'Foundations Bridge',
        workoutIds: ['aw_bridge_1a_1b'],
      },
      {
        id: 'wf_band1b',
        name: 'Band 1B',
        workoutIds: ['aw_band1b_standard'],
      },
      {
        id: 'wf_squat_req',
        name: 'Squat Required',
        workoutIds: ['aw_squat_stage2'],
      },
      {
        id: 'wf_band2a',
        name: 'Band 2A',
        workoutIds: ['aw_band2a_standard'],
      },
    ],
    workouts: [
      {
        id: 'aw_foundations_short',
        name: 'Foundations Short',
        familyId: 'wf_foundations',
        size: 'SHORT',
        progressionBandId: 'band_1a',
        movementRequirements: [
          { movementFamilyId: 'mf_horizontal_push', minimumStageId: 'ms_hp_1' },
        ],
        exercises: [
          { exerciseId: 'ax_hp_incline', order: 0, prescription: { kind: 'REPETITIONS', repetitions: 6 }, role: 'UPPER_BODY' },
          { exerciseId: 'ax_rest', order: 1, prescription: { kind: 'DURATION_SECONDS', durationSeconds: 10 }, role: 'REST', skippable: true },
          { exerciseId: 'ax_sit_squat', order: 2, prescription: { kind: 'REPETITIONS', repetitions: 6 }, role: 'LOWER_BODY' },
        ],
      },
      {
        id: 'aw_foundations_standard',
        name: 'Foundations Standard',
        familyId: 'wf_foundations',
        size: 'STANDARD',
        progressionBandId: 'band_1a',
        movementRequirements: [
          { movementFamilyId: 'mf_horizontal_push', minimumStageId: 'ms_hp_1' },
        ],
        exercises: [
          { exerciseId: 'ax_hp_incline', order: 0, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'UPPER_BODY' },
          { exerciseId: 'ax_hp_incline', order: 1, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'UPPER_BODY' },
          { exerciseId: 'ax_hp_floor', order: 2, prescription: { kind: 'REPETITIONS', repetitions: 4 }, role: 'UPPER_BODY' },
          { exerciseId: 'ax_rest', order: 3, prescription: { kind: 'DURATION_SECONDS', durationSeconds: 15 }, role: 'REST', skippable: true },
          { exerciseId: 'ax_sit_squat', order: 4, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'LOWER_BODY' },
        ],
      },
      {
        id: 'aw_foundations_long',
        name: 'Foundations Long',
        familyId: 'wf_foundations',
        size: 'LONG',
        progressionBandId: 'band_1a',
        movementRequirements: [
          { movementFamilyId: 'mf_horizontal_push', minimumStageId: 'ms_hp_1' },
        ],
        exercises: [
          { exerciseId: 'ax_hp_incline', order: 0, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'UPPER_BODY' },
          { exerciseId: 'ax_hp_incline', order: 1, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'UPPER_BODY' },
          { exerciseId: 'ax_hp_floor', order: 2, prescription: { kind: 'REPETITIONS', repetitions: 6 }, role: 'UPPER_BODY' },
          { exerciseId: 'ax_rest', order: 3, prescription: { kind: 'DURATION_SECONDS', durationSeconds: 15 }, role: 'REST', skippable: true },
          { exerciseId: 'ax_sit_squat', order: 4, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'LOWER_BODY' },
          { exerciseId: 'ax_hold', order: 5, prescription: { kind: 'DURATION_SECONDS', durationSeconds: 20 }, role: 'CORE' },
        ],
      },
      {
        id: 'aw_bridge_1a_1b',
        name: 'Bridge 1A to 1B',
        familyId: 'wf_bridge',
        size: 'STANDARD',
        progressionBandId: 'band_1b',
        movementRequirements: [
          { movementFamilyId: 'mf_horizontal_push', minimumStageId: 'ms_hp_1' },
        ],
        exercises: [
          { exerciseId: 'ax_hp_incline', order: 0, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'UPPER_BODY' },
          { exerciseId: 'ax_hp_floor', order: 1, prescription: { kind: 'REPETITIONS', repetitions: 5 }, role: 'UPPER_BODY' },
        ],
        bridge: { fromBandId: 'band_1a', toBandId: 'band_1b' },
      },
      {
        id: 'aw_band1b_standard',
        name: 'Band 1B Standard',
        familyId: 'wf_band1b',
        size: 'STANDARD',
        progressionBandId: 'band_1b',
        movementRequirements: [
          { movementFamilyId: 'mf_horizontal_push', minimumStageId: 'ms_hp_1' },
        ],
        exercises: [
          { exerciseId: 'ax_hp_floor', order: 0, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'UPPER_BODY' },
          { exerciseId: 'ax_bodyweight_squat', order: 1, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'LOWER_BODY' },
        ],
      },
      {
        id: 'aw_squat_stage2',
        name: 'Squat Stage 2',
        familyId: 'wf_squat_req',
        size: 'STANDARD',
        progressionBandId: 'band_1a',
        movementRequirements: [
          { movementFamilyId: 'mf_squat', minimumStageId: 'ms_sq_2' },
        ],
        exercises: [
          { exerciseId: 'ax_bodyweight_squat', order: 0, prescription: { kind: 'REPETITIONS', repetitions: 10 }, role: 'LOWER_BODY' },
        ],
      },
      {
        id: 'aw_band2a_standard',
        name: 'Band 2A Standard',
        familyId: 'wf_band2a',
        size: 'STANDARD',
        progressionBandId: 'band_2a',
        movementRequirements: [
          { movementFamilyId: 'mf_horizontal_push', minimumStageId: 'ms_hp_1' },
        ],
        exercises: [
          { exerciseId: 'ax_hp_floor', order: 0, prescription: { kind: 'REPETITIONS', repetitions: 8 }, role: 'UPPER_BODY' },
        ],
      },
    ],
  };
}
