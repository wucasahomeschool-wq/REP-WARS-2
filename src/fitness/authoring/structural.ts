import {
  AUTHORED_EXERCISE_ROLES,
  AUTHORED_PRESCRIPTION_KINDS,
  AuthoredPrescription,
  AuthoringIssue,
  MEASUREMENT_MODEL_KINDS,
  WORKOUT_AUTHORING_FORMAT,
  WORKOUT_SIZES,
  WorkoutAuthoringDocument,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function issue(code: string, message: string, path?: string): AuthoringIssue {
  return { severity: 'error', code, message, path };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPosInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function validatePrescription(raw: unknown, path: string, issues: AuthoringIssue[]): void {
  if (!isRecord(raw) || typeof raw.kind !== 'string') {
    issues.push(issue('authoring.invalid_prescription', 'prescription must be an object with kind', path));
    return;
  }
  if (!(AUTHORED_PRESCRIPTION_KINDS as readonly string[]).includes(raw.kind)) {
    issues.push(issue('authoring.invalid_prescription', `unknown prescription kind ${raw.kind}`, path));
    return;
  }
  if (raw.kind === 'REPETITIONS') {
    if (!isPosInt(raw.repetitions)) {
      issues.push(issue('authoring.invalid_prescription', 'REPETITIONS requires repetitions >= 1', path));
    }
    return;
  }
  if (!isPosInt(raw.durationSeconds)) {
    issues.push(issue('authoring.invalid_prescription', 'DURATION_SECONDS requires durationSeconds >= 1', path));
  }
}

function asPrescription(raw: unknown): AuthoredPrescription {
  const rec = raw as Record<string, unknown>;
  if (rec.kind === 'REPETITIONS') {
    return { kind: 'REPETITIONS', repetitions: rec.repetitions as number };
  }
  return { kind: 'DURATION_SECONDS', durationSeconds: rec.durationSeconds as number };
}

/**
 * Structural checks mirroring the JSON Schema 2020-12 file.
 * Cross-references are left to semantic validation.
 */
export function validateAuthoringStructure(raw: unknown): AuthoringIssue[] {
  const issues: AuthoringIssue[] = [];
  if (!isRecord(raw)) {
    return [issue('authoring.not_object', 'Authoring document must be an object')];
  }
  if (raw.formatVersion !== WORKOUT_AUTHORING_FORMAT) {
    issues.push(issue('authoring.format', `formatVersion must be ${WORKOUT_AUTHORING_FORMAT}`, 'formatVersion'));
  }
  if (!isNonEmptyString(raw.catalogId)) {
    issues.push(issue('authoring.missing_id', 'catalogId is required', 'catalogId'));
  }
  if (!isNonEmptyString(raw.catalogVersion)) {
    issues.push(issue('authoring.missing_id', 'catalogVersion is required', 'catalogVersion'));
  }
  const arrays: Array<keyof WorkoutAuthoringDocument> = [
    'measurementModels', 'movementFamilies', 'progressionBands',
    'exercises', 'workoutFamilies', 'workouts',
  ];
  for (const key of arrays) {
    if (!Array.isArray(raw[key])) {
      issues.push(issue('authoring.invalid_array', `${key} must be an array`, key));
    }
  }
  if (!Array.isArray(raw.measurementModels) || !Array.isArray(raw.movementFamilies)
    || !Array.isArray(raw.progressionBands) || !Array.isArray(raw.exercises)
    || !Array.isArray(raw.workoutFamilies) || !Array.isArray(raw.workouts)) {
    return issues;
  }

  raw.measurementModels.forEach((item, i) => {
    const path = `measurementModels[${i}]`;
    if (!isRecord(item)) {
      issues.push(issue('authoring.invalid_object', 'measurement model must be an object', path));
      return;
    }
    if (!isNonEmptyString(item.id)) issues.push(issue('authoring.empty_id', 'id is required', `${path}.id`));
    if (!(MEASUREMENT_MODEL_KINDS as readonly string[]).includes(String(item.kind))) {
      issues.push(issue('authoring.invalid_enum', 'invalid measurement model kind', `${path}.kind`));
    }
    if (!Array.isArray(item.validPrescriptionKinds) || item.validPrescriptionKinds.length === 0) {
      issues.push(issue('authoring.invalid_array', 'validPrescriptionKinds is required', `${path}.validPrescriptionKinds`));
    } else {
      for (const kind of item.validPrescriptionKinds) {
        if (!(AUTHORED_PRESCRIPTION_KINDS as readonly string[]).includes(String(kind))) {
          issues.push(issue('authoring.invalid_enum', `invalid prescription kind ${String(kind)}`, `${path}.validPrescriptionKinds`));
        }
      }
    }
  });

  raw.movementFamilies.forEach((item, i) => {
    const path = `movementFamilies[${i}]`;
    if (!isRecord(item)) {
      issues.push(issue('authoring.invalid_object', 'movement family must be an object', path));
      return;
    }
    if (!isNonEmptyString(item.id)) issues.push(issue('authoring.empty_id', 'id is required', `${path}.id`));
    if (!isNonEmptyString(item.name)) issues.push(issue('authoring.invalid_name', 'name is required', `${path}.name`));
    if (!Array.isArray(item.stages) || item.stages.length === 0) {
      issues.push(issue('authoring.invalid_array', 'stages must be a non-empty array', `${path}.stages`));
      return;
    }
    item.stages.forEach((stage, si) => {
      const sp = `${path}.stages[${si}]`;
      if (!isRecord(stage)) {
        issues.push(issue('authoring.invalid_object', 'stage must be an object', sp));
        return;
      }
      if (!isNonEmptyString(stage.id)) issues.push(issue('authoring.empty_id', 'stage id is required', `${sp}.id`));
      if (!isNonEmptyString(stage.name)) issues.push(issue('authoring.invalid_name', 'stage name is required', `${sp}.name`));
      if (!isNonNegInt(stage.order)) issues.push(issue('authoring.invalid_order', 'stage order must be an integer >= 0', `${sp}.order`));
    });
  });

  raw.progressionBands.forEach((item, i) => {
    const path = `progressionBands[${i}]`;
    if (!isRecord(item)) {
      issues.push(issue('authoring.invalid_object', 'progression band must be an object', path));
      return;
    }
    if (!isNonEmptyString(item.id)) issues.push(issue('authoring.empty_id', 'id is required', `${path}.id`));
    if (!isNonEmptyString(item.name)) issues.push(issue('authoring.invalid_name', 'name is required', `${path}.name`));
    if (!isNonNegInt(item.order)) issues.push(issue('authoring.invalid_order', 'band order must be an integer >= 0', `${path}.order`));
    if (!Array.isArray(item.selectionWindowBandIds) || item.selectionWindowBandIds.length === 0) {
      issues.push(issue('authoring.invalid_array', 'selectionWindowBandIds must be a non-empty array', `${path}.selectionWindowBandIds`));
    } else if (!item.selectionWindowBandIds.every((id) => isNonEmptyString(id))) {
      issues.push(issue('authoring.empty_id', 'selection window ids must be non-empty strings', `${path}.selectionWindowBandIds`));
    }
  });

  raw.exercises.forEach((item, i) => {
    const path = `exercises[${i}]`;
    if (!isRecord(item)) {
      issues.push(issue('authoring.invalid_object', 'exercise must be an object', path));
      return;
    }
    if (!isNonEmptyString(item.id)) issues.push(issue('authoring.empty_id', 'id is required', `${path}.id`));
    if (!isNonEmptyString(item.name)) issues.push(issue('authoring.invalid_name', 'name is required', `${path}.name`));
    if (!isNonEmptyString(item.movementFamilyId)) issues.push(issue('authoring.empty_id', 'movementFamilyId is required', `${path}.movementFamilyId`));
    if (!isNonEmptyString(item.movementStageId)) issues.push(issue('authoring.empty_id', 'movementStageId is required', `${path}.movementStageId`));
    if (!isNonEmptyString(item.measurementModelId)) issues.push(issue('authoring.empty_id', 'measurementModelId is required', `${path}.measurementModelId`));
    validatePrescription(item.defaultPrescription, `${path}.defaultPrescription`, issues);
    if (item.isRest !== undefined && typeof item.isRest !== 'boolean') {
      issues.push(issue('authoring.invalid_type', 'isRest must be boolean when present', `${path}.isRest`));
    }
  });

  raw.workoutFamilies.forEach((item, i) => {
    const path = `workoutFamilies[${i}]`;
    if (!isRecord(item)) {
      issues.push(issue('authoring.invalid_object', 'workout family must be an object', path));
      return;
    }
    if (!isNonEmptyString(item.id)) issues.push(issue('authoring.empty_id', 'id is required', `${path}.id`));
    if (!isNonEmptyString(item.name)) issues.push(issue('authoring.invalid_name', 'name is required', `${path}.name`));
    if (!Array.isArray(item.workoutIds) || !item.workoutIds.every((id) => isNonEmptyString(id))) {
      issues.push(issue('authoring.invalid_array', 'workoutIds must be an array of non-empty strings', `${path}.workoutIds`));
    }
  });

  raw.workouts.forEach((item, i) => {
    const path = `workouts[${i}]`;
    if (!isRecord(item)) {
      issues.push(issue('authoring.invalid_object', 'workout must be an object', path));
      return;
    }
    if (!isNonEmptyString(item.id)) issues.push(issue('authoring.empty_id', 'id is required', `${path}.id`));
    if (!isNonEmptyString(item.name)) issues.push(issue('authoring.invalid_name', 'name is required', `${path}.name`));
    if (!isNonEmptyString(item.familyId)) issues.push(issue('authoring.empty_id', 'familyId is required', `${path}.familyId`));
    if (!(WORKOUT_SIZES as readonly string[]).includes(String(item.size))) {
      issues.push(issue('authoring.invalid_size', 'size must be SHORT, STANDARD, or LONG', `${path}.size`));
    }
    if (!isNonEmptyString(item.progressionBandId)) {
      issues.push(issue('authoring.empty_id', 'progressionBandId is required', `${path}.progressionBandId`));
    }
    if (!Array.isArray(item.movementRequirements)) {
      issues.push(issue('authoring.invalid_array', 'movementRequirements must be an array', `${path}.movementRequirements`));
    } else {
      item.movementRequirements.forEach((req, ri) => {
        const rp = `${path}.movementRequirements[${ri}]`;
        if (!isRecord(req)) {
          issues.push(issue('authoring.invalid_object', 'requirement must be an object', rp));
          return;
        }
        if (!isNonEmptyString(req.movementFamilyId)) issues.push(issue('authoring.empty_id', 'movementFamilyId is required', `${rp}.movementFamilyId`));
        if (!isNonEmptyString(req.minimumStageId)) issues.push(issue('authoring.empty_id', 'minimumStageId is required', `${rp}.minimumStageId`));
      });
    }
    if (!Array.isArray(item.exercises) || item.exercises.length === 0) {
      issues.push(issue('authoring.invalid_array', 'exercises must be a non-empty array', `${path}.exercises`));
    } else {
      item.exercises.forEach((step, si) => {
        const sp = `${path}.exercises[${si}]`;
        if (!isRecord(step)) {
          issues.push(issue('authoring.invalid_object', 'workout exercise must be an object', sp));
          return;
        }
        if (!isNonEmptyString(step.exerciseId)) issues.push(issue('authoring.empty_id', 'exerciseId is required', `${sp}.exerciseId`));
        if (!isNonNegInt(step.order)) issues.push(issue('authoring.invalid_order', 'order must be an integer >= 0', `${sp}.order`));
        validatePrescription(step.prescription, `${sp}.prescription`, issues);
        if (step.role !== undefined && !(AUTHORED_EXERCISE_ROLES as readonly string[]).includes(String(step.role))) {
          issues.push(issue('authoring.invalid_enum', 'invalid exercise role', `${sp}.role`));
        }
        if (step.skippable !== undefined && typeof step.skippable !== 'boolean') {
          issues.push(issue('authoring.invalid_type', 'skippable must be boolean', `${sp}.skippable`));
        }
      });
    }
    if (item.bridge !== undefined && item.bridge !== null) {
      if (!isRecord(item.bridge)) {
        issues.push(issue('authoring.invalid_bridge', 'bridge must be an object or null', `${path}.bridge`));
      } else {
        if (!isNonEmptyString(item.bridge.fromBandId)) {
          issues.push(issue('authoring.invalid_bridge', 'bridge.fromBandId is required', `${path}.bridge.fromBandId`));
        }
        if (!isNonEmptyString(item.bridge.toBandId)) {
          issues.push(issue('authoring.invalid_bridge', 'bridge.toBandId is required', `${path}.bridge.toBandId`));
        }
      }
    }
  });

  return issues;
}

export function isWorkoutAuthoringDocument(raw: unknown): raw is WorkoutAuthoringDocument {
  return validateAuthoringStructure(raw).length === 0;
}

/** Narrow a structurally valid document. Caller must have already validated. */
export function asWorkoutAuthoringDocument(raw: unknown): WorkoutAuthoringDocument {
  const rec = raw as Record<string, unknown>;
  return {
    formatVersion: WORKOUT_AUTHORING_FORMAT,
    catalogId: String(rec.catalogId),
    catalogVersion: String(rec.catalogVersion),
    authorNotes: typeof rec.authorNotes === 'string' ? rec.authorNotes : undefined,
    measurementModels: (rec.measurementModels as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id),
      kind: item.kind as WorkoutAuthoringDocument['measurementModels'][number]['kind'],
      validPrescriptionKinds: [...(item.validPrescriptionKinds as WorkoutAuthoringDocument['measurementModels'][number]['validPrescriptionKinds'])],
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    })),
    movementFamilies: (rec.movementFamilies as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id),
      name: String(item.name),
      notes: typeof item.notes === 'string' ? item.notes : undefined,
      stages: (item.stages as Array<Record<string, unknown>>).map((stage) => ({
        id: String(stage.id),
        name: String(stage.name),
        order: stage.order as number,
        notes: typeof stage.notes === 'string' ? stage.notes : undefined,
      })),
    })),
    progressionBands: (rec.progressionBands as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id),
      name: String(item.name),
      order: item.order as number,
      selectionWindowBandIds: [...(item.selectionWindowBandIds as string[])],
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    })),
    exercises: (rec.exercises as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id),
      name: String(item.name),
      description: typeof item.description === 'string' ? item.description : undefined,
      movementFamilyId: String(item.movementFamilyId),
      movementStageId: String(item.movementStageId),
      measurementModelId: String(item.measurementModelId),
      defaultPrescription: asPrescription(item.defaultPrescription),
      isRest: item.isRest === true,
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    })),
    workoutFamilies: (rec.workoutFamilies as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id),
      name: String(item.name),
      workoutIds: [...(item.workoutIds as string[])],
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    })),
    workouts: (rec.workouts as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id),
      name: String(item.name),
      description: typeof item.description === 'string' ? item.description : undefined,
      familyId: String(item.familyId),
      size: item.size as WorkoutAuthoringDocument['workouts'][number]['size'],
      progressionBandId: String(item.progressionBandId),
      movementRequirements: (item.movementRequirements as Array<Record<string, unknown>>).map((req) => ({
        movementFamilyId: String(req.movementFamilyId),
        minimumStageId: String(req.minimumStageId),
      })),
      exercises: (item.exercises as Array<Record<string, unknown>>).map((step) => ({
        exerciseId: String(step.exerciseId),
        order: step.order as number,
        prescription: asPrescription(step.prescription),
        role: step.role as WorkoutAuthoringDocument['workouts'][number]['exercises'][number]['role'],
        skippable: typeof step.skippable === 'boolean' ? step.skippable : undefined,
      })),
      bridge: item.bridge && isRecord(item.bridge)
        ? {
          fromBandId: String(item.bridge.fromBandId),
          toBandId: String(item.bridge.toBandId),
          notes: typeof item.bridge.notes === 'string' ? item.bridge.notes : undefined,
        }
        : item.bridge === null ? null : undefined,
      authorNotes: typeof item.authorNotes === 'string' ? item.authorNotes : undefined,
    })),
  };
}
