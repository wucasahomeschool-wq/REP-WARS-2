import assert from 'assert';
import {
  AUTHORED_V2_FIXTURE_CATALOG_ID,
  compileAuthoringDocument,
  mergeRuntimeCatalogs,
  sampleAuthoringDocumentV2,
  validateWorkoutAuthoringDocument,
  WORKOUT_AUTHORING_FORMAT,
  WORKOUT_AUTHORING_JSON_SCHEMA,
} from '../src/fitness';
import type { WorkoutAuthoringDocument } from '../src/fitness';

export interface WorkoutAuthoringTestApi {
  test: (name: string, fn: () => void) => void;
}

function cloneDoc(): WorkoutAuthoringDocument {
  return JSON.parse(JSON.stringify(sampleAuthoringDocumentV2())) as WorkoutAuthoringDocument;
}

function issueCodes(raw: unknown): string[] {
  return validateWorkoutAuthoringDocument(raw).issues.map((issue) => issue.code);
}

export function registerWorkoutAuthoringTests(api: WorkoutAuthoringTestApi): void {
  const { test } = api;

  test('valid v2 fixture is structurally and semantically valid', () => {
    const result = validateWorkoutAuthoringDocument(sampleAuthoringDocumentV2());
    assert.strictEqual(result.ok, true, result.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; '));
    assert.ok(result.completeness.completeFamilyIds.includes('wf_foundations'));
    assert.ok(result.completeness.incompleteFamilies.some((row) => row.familyId === 'wf_bridge'));
    assert.ok(result.issues.some((issue) => issue.code === 'authoring.incomplete_family' && issue.severity === 'warning'));
  });

  test('JSON Schema 2020-12 document describes the locked format', () => {
    const schema = WORKOUT_AUTHORING_JSON_SCHEMA as { $schema?: string; properties?: { formatVersion?: { const?: string } } };
    assert.strictEqual(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.strictEqual(schema.properties?.formatVersion?.const, WORKOUT_AUTHORING_FORMAT);
  });

  test('duplicate IDs are rejected', () => {
    const doc = cloneDoc();
    doc.exercises.push({ ...doc.exercises[0]! });
    assert.ok(issueCodes(doc).includes('authoring.duplicate_id'));
  });

  test('missing references are rejected', () => {
    const doc = cloneDoc();
    doc.exercises[0]!.movementFamilyId = 'mf_missing';
    assert.ok(issueCodes(doc).includes('authoring.unknown_movement_family'));
  });

  test('stage/family mismatch is rejected', () => {
    const doc = cloneDoc();
    doc.exercises[0]!.movementStageId = 'ms_sq_1';
    assert.ok(issueCodes(doc).includes('authoring.stage_family_mismatch'));
  });

  test('invalid progression window is rejected', () => {
    const doc = cloneDoc();
    doc.progressionBands[0]!.selectionWindowBandIds = ['band_1b'];
    const codes = issueCodes(doc);
    assert.ok(codes.includes('authoring.window_missing_self'));
    doc.progressionBands[0]!.selectionWindowBandIds = ['band_1a', 'band_missing'];
    assert.ok(issueCodes(doc).includes('authoring.window_unknown_band'));
  });

  test('invalid prescription kind is rejected', () => {
    const doc = cloneDoc();
    doc.exercises.find((ex) => ex.id === 'ax_hold')!.defaultPrescription = {
      kind: 'REPETITIONS',
      repetitions: 10,
    };
    assert.ok(issueCodes(doc).includes('authoring.invalid_prescription_kind'));
  });

  test('duplicate movement requirement is rejected', () => {
    const doc = cloneDoc();
    const workout = doc.workouts.find((row) => row.id === 'aw_foundations_standard')!;
    workout.movementRequirements.push({ movementFamilyId: 'mf_horizontal_push', minimumStageId: 'ms_hp_2' });
    assert.ok(issueCodes(doc).includes('authoring.duplicate_family_requirement'));
  });

  test('requirement stage must belong to the family', () => {
    const doc = cloneDoc();
    const workout = doc.workouts.find((row) => row.id === 'aw_foundations_standard')!;
    workout.movementRequirements[0]!.minimumStageId = 'ms_sq_2';
    assert.ok(issueCodes(doc).includes('authoring.requirement_stage_mismatch'));
  });

  test('broken workout-family membership is rejected both directions', () => {
    const doc = cloneDoc();
    doc.workouts[0]!.familyId = 'wf_bridge';
    assert.ok(issueCodes(doc).includes('authoring.family_membership_mismatch'));
    const other = cloneDoc();
    other.workoutFamilies[0]!.workoutIds = other.workoutFamilies[0]!.workoutIds.filter((id) => id !== 'aw_foundations_short');
    assert.ok(issueCodes(other).includes('authoring.family_membership_mismatch'));
  });

  test('invalid exercise ordering is rejected', () => {
    const doc = cloneDoc();
    doc.workouts[0]!.exercises[1]!.order = 3;
    assert.ok(issueCodes(doc).includes('authoring.invalid_exercise_order'));
  });

  test('partial family authoring is valid with completeness warnings', () => {
    const result = validateWorkoutAuthoringDocument(sampleAuthoringDocumentV2());
    assert.strictEqual(result.ok, true);
    const incomplete = result.completeness.incompleteFamilies.find((row) => row.familyId === 'wf_band2a');
    assert.ok(incomplete);
    assert.ok(incomplete!.missingSizes.includes('SHORT'));
    assert.ok(incomplete!.missingSizes.includes('LONG'));
  });

  test('complete family authoring is reported separately from validity', () => {
    const result = validateWorkoutAuthoringDocument(sampleAuthoringDocumentV2());
    assert.ok(result.completeness.completeFamilyIds.includes('wf_foundations'));
    assert.ok(!result.completeness.completeFamilyIds.includes('wf_bridge'));
  });

  test('invalid bridge is rejected', () => {
    const same = cloneDoc();
    const workout = same.workouts.find((row) => row.id === 'aw_bridge_1a_1b')!;
    workout.bridge = { fromBandId: 'band_1a', toBandId: 'band_1a' };
    assert.ok(issueCodes(same).includes('authoring.invalid_bridge'));
    const missing = cloneDoc();
    missing.workouts.find((row) => row.id === 'aw_bridge_1a_1b')!.bridge = {
      fromBandId: 'band_1a',
      toBandId: 'band_missing',
    };
    assert.ok(issueCodes(missing).includes('authoring.invalid_bridge'));
  });

  test('valid authoring JSON compiles to a runtime catalog', () => {
    const compiled = compileAuthoringDocument(sampleAuthoringDocumentV2());
    assert.strictEqual(compiled.ok, true, compiled.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; '));
    assert.ok(compiled.catalog);
    assert.strictEqual(compiled.catalog!.catalogId, AUTHORED_V2_FIXTURE_CATALOG_ID);
    assert.ok(compiled.catalog!.workouts.aw_foundations_short);
    assert.strictEqual(compiled.catalog!.workouts.aw_foundations_short!.size, 'SHORT');
    assert.strictEqual(compiled.catalog!.exercises.ax_hp_incline!.movementFamilyId, 'mf_horizontal_push');
  });

  test('invalid JSON never reaches a runtime catalog', () => {
    const compiled = compileAuthoringDocument({ formatVersion: 'nope' });
    assert.strictEqual(compiled.ok, false);
    assert.strictEqual(compiled.catalog, undefined);
  });

  test('compilation is deterministic and preserves authored IDs', () => {
    const a = compileAuthoringDocument(sampleAuthoringDocumentV2());
    const b = compileAuthoringDocument(sampleAuthoringDocumentV2());
    assert.strictEqual(JSON.stringify(a.catalog), JSON.stringify(b.catalog));
    assert.deepStrictEqual(Object.keys(a.catalog!.workouts).sort(), Object.keys(b.catalog!.workouts).sort());
  });

  test('multiple catalogs merge with later version winning', () => {
    const first = compileAuthoringDocument(sampleAuthoringDocumentV2());
    const secondDoc = cloneDoc();
    secondDoc.catalogId = 'fixture.batch-002';
    secondDoc.catalogVersion = '0.0.2-test';
    secondDoc.exercises[0]!.name = 'Incline Push v2';
    const second = compileAuthoringDocument(secondDoc);
    assert.ok(first.catalog && second.catalog);
    const merged = mergeRuntimeCatalogs([first.catalog!, second.catalog!]);
    assert.strictEqual(merged.exercises.ax_hp_incline!.name, 'Incline Push v2');
    assert.ok(merged.catalogId.includes('fixture.batch-002'));
  });
}
