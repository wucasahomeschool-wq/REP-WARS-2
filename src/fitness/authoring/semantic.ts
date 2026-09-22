import { asWorkoutAuthoringDocument, validateAuthoringStructure } from './structural';
import {
  AuthoringIssue,
  AuthoringValidationResult,
  WORKOUT_SIZES,
  WorkoutAuthoringDocument,
  WorkoutSize,
} from './types';

function err(code: string, message: string, path?: string): AuthoringIssue {
  return { severity: 'error', code, message, path };
}

function warn(code: string, message: string, path?: string): AuthoringIssue {
  return { severity: 'warning', code, message, path };
}

function duplicate(ids: string[], path: string, issues: AuthoringIssue[], collection: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push(err('authoring.duplicate_id', `duplicate ${collection} id ${id}`, path));
    }
    seen.add(id);
  }
}

export function validateAuthoringSemantics(doc: WorkoutAuthoringDocument): AuthoringValidationResult {
  const issues: AuthoringIssue[] = [];

  duplicate(doc.measurementModels.map((m) => m.id), 'measurementModels', issues, 'measurement model');
  duplicate(doc.movementFamilies.map((m) => m.id), 'movementFamilies', issues, 'movement family');
  duplicate(doc.progressionBands.map((b) => b.id), 'progressionBands', issues, 'progression band');
  duplicate(doc.exercises.map((e) => e.id), 'exercises', issues, 'exercise');
  duplicate(doc.workoutFamilies.map((f) => f.id), 'workoutFamilies', issues, 'workout family');
  duplicate(doc.workouts.map((w) => w.id), 'workouts', issues, 'workout');

  const models = new Map(doc.measurementModels.map((m) => [m.id, m]));
  const families = new Map(doc.movementFamilies.map((f) => [f.id, f]));
  const bands = new Map(doc.progressionBands.map((b) => [b.id, b]));
  const exercises = new Map(doc.exercises.map((e) => [e.id, e]));
  const workoutFamilies = new Map(doc.workoutFamilies.map((f) => [f.id, f]));
  const workouts = new Map(doc.workouts.map((w) => [w.id, w]));

  const bandOrders = doc.progressionBands.map((b) => b.order);
  if (new Set(bandOrders).size !== bandOrders.length) {
    issues.push(err('authoring.duplicate_band_order', 'progression band order values must be unique', 'progressionBands'));
  }

  for (const family of doc.movementFamilies) {
    const stageIds = family.stages.map((s) => s.id);
    duplicate(stageIds, `movementFamilies.${family.id}.stages`, issues, 'stage');
    const orders = family.stages.map((s) => s.order);
    if (new Set(orders).size !== orders.length) {
      issues.push(err(
        'authoring.duplicate_stage_order',
        `movement family ${family.id} has duplicate stage order`,
        `movementFamilies.${family.id}`,
      ));
    }
  }

  for (const band of doc.progressionBands) {
    if (!band.selectionWindowBandIds.includes(band.id)) {
      issues.push(err(
        'authoring.window_missing_self',
        `selection window for ${band.id} must include its own band`,
        `progressionBands.${band.id}.selectionWindowBandIds`,
      ));
    }
    for (const id of band.selectionWindowBandIds) {
      if (!bands.has(id)) {
        issues.push(err(
          'authoring.window_unknown_band',
          `selection window on ${band.id} references unknown band ${id}`,
          `progressionBands.${band.id}.selectionWindowBandIds`,
        ));
      }
    }
  }

  for (const exercise of doc.exercises) {
    const family = families.get(exercise.movementFamilyId);
    if (!family) {
      issues.push(err(
        'authoring.unknown_movement_family',
        `exercise ${exercise.id} references unknown movement family ${exercise.movementFamilyId}`,
        `exercises.${exercise.id}.movementFamilyId`,
      ));
    } else if (!family.stages.some((s) => s.id === exercise.movementStageId)) {
      issues.push(err(
        'authoring.stage_family_mismatch',
        `exercise ${exercise.id} stage ${exercise.movementStageId} is not in family ${family.id}`,
        `exercises.${exercise.id}.movementStageId`,
      ));
    }
    const model = models.get(exercise.measurementModelId);
    if (!model) {
      issues.push(err(
        'authoring.unknown_measurement_model',
        `exercise ${exercise.id} references unknown measurement model ${exercise.measurementModelId}`,
        `exercises.${exercise.id}.measurementModelId`,
      ));
    } else if (!model.validPrescriptionKinds.includes(exercise.defaultPrescription.kind)) {
      issues.push(err(
        'authoring.invalid_prescription_kind',
        `exercise ${exercise.id} default prescription ${exercise.defaultPrescription.kind} is not valid for ${model.id}`,
        `exercises.${exercise.id}.defaultPrescription`,
      ));
    }
  }

  for (const family of doc.workoutFamilies) {
    for (const workoutId of family.workoutIds) {
      const workout = workouts.get(workoutId);
      if (!workout) {
        issues.push(err(
          'authoring.unknown_workout',
          `workout family ${family.id} lists unknown workout ${workoutId}`,
          `workoutFamilies.${family.id}.workoutIds`,
        ));
      } else if (workout.familyId !== family.id) {
        issues.push(err(
          'authoring.family_membership_mismatch',
          `workout ${workoutId} familyId ${workout.familyId} does not match family ${family.id}`,
          `workoutFamilies.${family.id}`,
        ));
      }
    }
  }

  const completeFamilyIds: string[] = [];
  const incompleteFamilies: AuthoringValidationResult['completeness']['incompleteFamilies'] = [];

  for (const workout of doc.workouts) {
    const family = workoutFamilies.get(workout.familyId);
    if (!family) {
      issues.push(err(
        'authoring.unknown_workout_family',
        `workout ${workout.id} references unknown family ${workout.familyId}`,
        `workouts.${workout.id}.familyId`,
      ));
    } else if (!family.workoutIds.includes(workout.id)) {
      issues.push(err(
        'authoring.family_membership_mismatch',
        `workout ${workout.id} is not listed in family ${family.id}.workoutIds`,
        `workouts.${workout.id}.familyId`,
      ));
    }
    if (!bands.has(workout.progressionBandId)) {
      issues.push(err(
        'authoring.unknown_band',
        `workout ${workout.id} references unknown band ${workout.progressionBandId}`,
        `workouts.${workout.id}.progressionBandId`,
      ));
    }
    const reqFamilies = new Set<string>();
    for (const req of workout.movementRequirements) {
      if (reqFamilies.has(req.movementFamilyId)) {
        issues.push(err(
          'authoring.duplicate_family_requirement',
          `workout ${workout.id} has more than one requirement for ${req.movementFamilyId}`,
          `workouts.${workout.id}.movementRequirements`,
        ));
      }
      reqFamilies.add(req.movementFamilyId);
      const movement = families.get(req.movementFamilyId);
      if (!movement) {
        issues.push(err(
          'authoring.unknown_movement_family',
          `workout ${workout.id} requirement references unknown family ${req.movementFamilyId}`,
          `workouts.${workout.id}.movementRequirements`,
        ));
      } else if (!movement.stages.some((s) => s.id === req.minimumStageId)) {
        issues.push(err(
          'authoring.requirement_stage_mismatch',
          `workout ${workout.id} minimumStageId ${req.minimumStageId} is not in family ${req.movementFamilyId}`,
          `workouts.${workout.id}.movementRequirements`,
        ));
      }
    }
    const orders = workout.exercises.map((step) => step.order);
    const expected = workout.exercises.map((_, i) => i);
    if (orders.slice().sort((a, b) => a - b).join(',') !== expected.join(',') || orders.some((order, i) => order !== i)) {
      issues.push(err(
        'authoring.invalid_exercise_order',
        `workout ${workout.id} exercise order must be 0,1,2... with no gaps or duplicates`,
        `workouts.${workout.id}.exercises`,
      ));
    }
    for (const step of workout.exercises) {
      const exercise = exercises.get(step.exerciseId);
      if (!exercise) {
        issues.push(err(
          'authoring.unknown_exercise',
          `workout ${workout.id} references unknown exercise ${step.exerciseId}`,
          `workouts.${workout.id}.exercises`,
        ));
        continue;
      }
      const model = models.get(exercise.measurementModelId);
      if (model && !model.validPrescriptionKinds.includes(step.prescription.kind)) {
        issues.push(err(
          'authoring.invalid_prescription_kind',
          `workout ${workout.id} step ${step.order} prescription ${step.prescription.kind} is invalid for ${exercise.id}`,
          `workouts.${workout.id}.exercises[${step.order}]`,
        ));
      }
    }
    if (workout.bridge) {
      if (!bands.has(workout.bridge.fromBandId) || !bands.has(workout.bridge.toBandId)) {
        issues.push(err(
          'authoring.invalid_bridge',
          `workout ${workout.id} bridge references an unknown band`,
          `workouts.${workout.id}.bridge`,
        ));
      } else if (workout.bridge.fromBandId === workout.bridge.toBandId) {
        issues.push(err(
          'authoring.invalid_bridge',
          `workout ${workout.id} bridge from and to bands must differ`,
          `workouts.${workout.id}.bridge`,
        ));
      }
    }
  }

  for (const family of doc.workoutFamilies) {
    const sizes = new Set(
      family.workoutIds
        .map((id) => workouts.get(id)?.size)
        .filter((size): size is WorkoutSize => !!size),
    );
    const missing = WORKOUT_SIZES.filter((size) => !sizes.has(size));
    if (missing.length === 0 && family.workoutIds.length > 0) {
      completeFamilyIds.push(family.id);
    } else {
      incompleteFamilies.push({ familyId: family.id, missingSizes: missing });
      issues.push(warn(
        'authoring.incomplete_family',
        `workout family ${family.id} is missing size variants ${missing.join(', ') || '(none authored)'}`,
        `workoutFamilies.${family.id}`,
      ));
    }
  }

  const errors = issues.filter((item) => item.severity === 'error');
  return {
    ok: errors.length === 0,
    issues,
    completeness: { completeFamilyIds, incompleteFamilies },
  };
}

export function validateWorkoutAuthoringDocument(raw: unknown): AuthoringValidationResult {
  const structural = validateAuthoringStructure(raw);
  if (structural.length > 0) {
    return {
      ok: false,
      issues: structural,
      completeness: { completeFamilyIds: [], incompleteFamilies: [] },
    };
  }
  return validateAuthoringSemantics(asWorkoutAuthoringDocument(raw));
}
