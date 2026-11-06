# Phase 4 — Production workout activation and content integration

## Verdict

**PARTIAL — configuration reporting repaired; production workout activation BLOCKED by approved content and world policies.** No historical library has been activated. Technical fixture success is not fitness-content approval. The backend and Phase 4 are not declared production-complete.

## A. Starting checkpoint and scope

- Worktree: `/workspace/REP-WARS-2-WORKOUT-ACTIVATION`.
- Dedicated branch: `fix/backend-production-workout-activation`.
- Parent: `7c53bfa52d392a1d37ddb6d1a37935245ca125be`, reviewed Phase 3 branch `fix/backend-event-effect-persistence`, schema 32.
- Phase 3 parent: `1b194a8f90bda20cc55e7b7333d6f0bba048038e` (Phase 2), whose parent is `b6891ccb4c9a21a09d94dc1e2e8be96b9b820997` (Phase 1).
- Verified clean source and new worktree; Phase 3 remote matched the parent. Before isolation, recorded HEAD, Git status and dirty-file SHA-256 values for all 23 existing worktrees, including 78 dirty files. Existing work is not part of this checkpoint.
- Read the completion audit, matrix, remaining-work list, roadmap, audit evidence and Phase 1–3 reports. Historical audit checkpoint `67280e363fd89f256cd770566a5676d6415af695` supplies context; current code determines behavior.
- The roadmap's AUD-003 scope agrees: truthful availability, explicit catalog activation, tutorial binding and reward configuration. AUD-017/018 remain content dependencies. Only the independent availability correction is implemented here. Loader activation and tutorial binding are deliberately not claimed complete without the approved replacement content.

## B. Content-source inventory — VERIFIED, not approved

| Source | Actual identity / contents | Status and compatibility |
| --- | --- | --- |
| `src/fitness/catalog/exercises.ts`, `workouts.ts`, `library.ts` | Runtime exports contain 79 exercises and 56 workouts | Historical built-ins/prototype library. Tags such as `authored` are not the versioned `metadata.authored` contract. Not approved replacement content. |
| `Rep_Wars_Exercise_Catalog_Tier1-7_FINAL(1).json` | `rep-wars-exercise-catalog`, `tier-7.final.v3`, 216 exercises; embedded status `exercise_library_final` | Superseded by the current rebuild decision. As a standalone document, rejected by the current compiler with 5 issues, including absent combined-document format/arrays. Filename/status is not current approval. |
| `Rep_Wars_Workout_Library_B001-B007_Combined.json` | Claims `rep-wars-workout-authoring.v2`, same catalog/version; 69 exercises, 65 workouts, 23 workout families | Superseded historical artifact. Current compiler reports 639 issues, including missing measurement-model `kind` and progression-band `name`. A version string alone does not make its contents compatible. No automatic conversion attempted. |
| `src/fitness/authoring/fixture.ts::sampleAuthoringDocumentV2` | `fixture.workout-authoring.sample`, `0.0.1-test` | Explicitly test-only, not a real training program. Reused unchanged for technical regression coverage only. |
| `tests/legacyWorkoutFixture.ts` and existing tutorial tests | Already-active legacy sessions | Compatibility evidence, not fresh-world activation or approved workout prescriptions. |
| `worlds/level-1.json`, `worlds/level-2.json` | Registered production definitions | Both omit `workoutRewards`. No production soldier ratio is approved or inferred. |

The compiler contract is `src/fitness/authoring/types.ts`: `rep-wars-workout-authoring.v2` with engine `rep-wars-workout-progression.v1`. `structural.ts`, `semantic.ts` and `compile.ts::compileAuthoringDocument` validate measurement models, exercise identities, ordered stages/bands, family references, workout size, required movement readiness and prescription structure. No compiler result certifies exercise safety or product approval.

The installed catalog in `src/fitness/authoring/registry.ts` starts as `null`. `installAuthoredWorkoutCatalog` is an explicit runtime installation hook; neither `src/server/production.ts::createProductionHttpServer` nor the server entry point loads and installs an approved production catalog. No approved rebuilt content was identified in the inspected checkpoint. No separate content branch has been silently incorporated.

### Fitness areas, readiness and personalization

**IMPLEMENTED:** `src/fitness/types.ts` represents UPPER_BODY, CORE, LOWER_BODY and GLOBAL. `src/fitness/progression/readiness.ts` checks authored movement requirements; missing movement evidence starts at the catalog's first authored stage. `progression/select.ts::eligibleAuthoredWorkouts` filters size, progression window and readiness, then deterministically orders candidates. All three workout sizes are typed.

**PARTIAL:** `AuthoredSelectionRequest` currently accepts size, not an explicit fitness-area selection. `authoring/compile.ts::bodySectionForFamily` derives area from family-ID substrings, falling back to GLOBAL. That is not an approved mapping for the replacement library. Authored starts preserve authored prescriptions; `handleStartWorkout` does not apply the legacy estimate-based personalization to authored definitions. The existing legacy personalization engine does not by itself establish the redesigned bounded, movement-specific adaptive prescription contract. No new mapping, readiness evidence, capability threshold or adaptive bounds are invented here.

## C. Reproduction and root cause

### Real fresh-world command probe

The regression creates an empty in-memory persistence adapter, then uses the real authenticated HTTP command boundary and production `ensurePlayerWorld`/`initializePlayerWorld` path. Authentication is a trusted test adapter; this is not live identity-provider/Supabase certification. No active legacy session, workout ratio, authored catalog, fitness evidence or free troops are injected.

1. `POST /session/open` with stable request identity and `worldAttempt: 0` creates a fresh registered Level 1 and server lease.
2. `GET_FITNESS_CATALOG` reports `authoredCatalog: null`.
3. `GET_WORKOUT_SELECTION` for NORMAL_TROOPS/SHORT returns historical `wk_moderate_full_body`, source `tutorial`, without authoritative catalog/size metadata.
4. Before the fix, selection advertised **`allowed: true`**.
5. A sequenced `START_WORKOUT` for that selected ID returns `success: false`, code **`WORKOUT_CONFIGURATION_UNAVAILABLE`**, message **`Normal workouts require an authored workout size and catalog identity`**. HTTP transport status is 200; the command result is a rejection.
6. Canonical state remains schema 32, attempt 0, Level 1 / FIRST_WORKOUT_PENDING, no active workout, zero banked soldiers, no applied workout reward. No entitlement is created.

The pre-fix test failed exactly at `true == false` after verifying the start rejection. Raw pre-fix probe and assertion output are retained outside the repository at `/workspace/phase4-validation/audit-probe.json`, `audit-probe.log` and `pre-fix.log`. The committed regression contains the reproducible public journey.

### Exact conflicting paths

- `fitness/selection.ts::selectedWorkoutIdForPurpose` maps purposes to the historical default `wk_moderate_full_body`.
- `gameplay/workoutSelection.ts::usesAuthoredWorkoutSelection` excludes gated Level 1. `resolveStartWorkout` enforces its historical tutorial ID. Merely installing an unrelated valid catalog cannot supply the tutorial binding.
- `serializeWorkoutSelectionView` previously calculated `allowed` using only tutorial/session/invasion gates through `isWorkoutStartAllowed`. It never checked normal reward prerequisites.
- `orchestration/gameplayCommands.ts::handleStartWorkout` resolves content, checks eligibility and creates a candidate session. `gameplay/workoutStart.ts::lockWorkoutStartReward` correctly refuses NORMAL_TROOPS without authored size/catalog metadata and a valid current-world policy before storing that session.
- After supplying legitimate authored content, the absent world policy is a second independent blocker. The current start rejection is intentional fail-closed behavior, not a reason to fall back to physical-output rewards.

Thus the confirmed technical defect is **false discovery availability**. The underlying production activation problem additionally requires approved replacement content, explicit tutorial selection/binding, deployment catalog loading and approved world ratios.

### Existing authoritative lifecycle retained

`handleStartWorkout` → `resolveStartWorkout` / `assertResolvedWorkoutEligible` → `beginWorkoutSession` → server-issued reward session identity → `lockWorkoutStartReward` → canonical active session. Session and entitlement commit together through the existing orchestrator/host, durable receipts and CAS. No client size/reward assertion replaces server-authored terms.

`handleRecordExercise` advances prescribed work through the session engine. `handleFinalizeWorkout` → `runWorkoutRewardPipeline` → `settleLockedWorkout` → `applyLockedCompletionReward` credits the persisted entitlement only after full completion. `playerRewards.appliedRewards` remains the settlement authority, and workout history commits through the existing atomic coordinator. Optional feedback and legitimate later fitness evaluation are separate from soldier payment. Abandoned/incomplete work does not earn completion soldiers.

`completionPolicy.ts` retains SHORT 60, STANDARD 100, LONG 145, positive integer ratio micros and BigInt half-up rounding. No policy value is changed. Specialized DEFENSE, EXTRA_CONSTRUCTION_WORKERS and GOLDEN_YIELD retain existing context-specific effects and do not acquire normal soldier entitlement requirements. Resource Exchange is not a separate implemented workout purpose; this phase adds no exchange/supercharge mode or conversion rule.

## D. Implementation inventory

| File | Change |
| --- | --- |
| `src/gameplay/workoutStart.ts` | Extract existing read-only world/policy prerequisites into `requireWorkoutRewardConfiguration`, reused by start and discovery. Validate the existing fixed-point calculation for the authoritative size. Preserve entitlement construction, error vocabulary and fail-closed start behavior. |
| `src/gameplay/workoutSelection.ts` | NORMAL_TROOPS discovery checks those same prerequisites. Missing/invalid configuration sets `allowed: false` and additive `configurationError: {code, message}`. Other purposes keep their existing behavior. |
| `tests/productionWorkoutActivation.ts` | Fresh production HTTP failure proof plus explicitly labeled existing R1 fixture discovery/start/reload/completion/retry coverage. |
| `tests/workoutSelection.ts` | Replace three contradictory assertions that an unconfigured normal workout is playable. Preserve historical preview fields, legacy-session journey, defense progression and all other assertions. |
| `tests/run.ts` | Register the new focused regressions in the full runner. |
| `docs/BACKEND_PHASE4_PRODUCTION_WORKOUT_ACTIVATION.md` | Audit, partial implementation scope, content blockers and validation/checkpoint record. |

**API compatibility:** Existing selection fields remain as compatibility previews. They are explicitly not playable/approved when `configurationError` exists. Clients must honor `allowed: false` and show the configuration error rather than presenting a startable workout. `GET_FITNESS_CATALOG` still exposes historical reference definitions; listing is not approval. Start independently validates even if an older client ignores discovery. No client can override these checks.

**Persistence:** No new canonical fields, schema bump, migration, ledger or runtime authority. Schema remains 32. Legacy active/pending rewards and specialized effects are untouched. No catalog content, world JSON, gameplay coefficients, tutorial script, Unity code, event persistence or Phase 1 identity implementation changes.

## E. Verification

**VERIFIED — 2,437 passed, 0 failed, 3 skipped**, across two complementary full-runner groups. This is the Phase 3 baseline of 2,425 passes plus 12 new regressions. A successful fixture journey is explicitly **not** a fresh production-content journey.

| Executed gate | Result |
| --- | --- |
| Pre-fix public HTTP regression | 0 passed, 1 expected failure: discovery advertised `allowed: true` while start rejected missing configuration |
| New Phase 4 focused group | 12 passed, 0 failed, 0 skipped |
| Full core group | 2,408 passed, 0 failed, 3 live skips; 29 filtered into complementary group |
| Full tutorial/long-retry group | 29 passed, 0 failed, 0 skipped; 2,411 filtered into core group |
| Coverage reconciliation | All 2,440 registered cases accounted for, no overlapping groups, both processes exited 0 |
| Phase 1 durable identity, included above | 23 passed |
| Phase 2 deployed-force tutorial, included above | 28 passed |
| Phase 3 event persistence, included above | 27 passed |
| Production TypeScript | PASS, zero diagnostics |
| Test-inclusive TypeScript | PASS, zero diagnostics; no suppression or compiler-setting changes |
| Production build | PASS |
| Diff/whitespace review | PASS |
| Prior-worktree preservation | All 23 existing worktrees and 78 dirty-file hashes unchanged |

Existing authoring, progression, rewards, tutorial, larger-world reload, persistence/CAS and HTTP boundary tests were executed by the full runner. The three skipped checks are live Supabase save/reload, atomic world/history rollback and server restart. Each reports that explicit non-production opt-in is absent; they are not counted as passes, and no production database was tested. Source/test SHA-256 values remained unchanged throughout full validation.

Raw evidence is outside the repository under `/workspace/phase4-validation/`: `pre-fix.log`, `focused-complete.log`, `full-core.log`, `full-journeys.log`, TypeScript/build logs and exit-code files, `final-verification.json`, and the fresh-world/content probe. Intermediate interrupted runs and the corrected new-test assertion failures remain available but are not counted as passing gates. No large generated logs are added to Git.

New focused coverage: fresh-world authenticated HTTP configuration failure; missing/zero/negative/fractional/unsafe policy values; missing authored world; unrelated fixture catalog cannot replace tutorial binding; specialized-purpose isolation; all three sizes through read-only discovery, real start, persisted lock, hydration/reconnect, busy-session gating, rejected incomplete settlement, full prescribed completion without feedback, exactly-once reward/history and duplicate/new-request-ID replay. Uses the existing R1-D test-only 1.25 ratio, yielding 75/125/181 test soldiers; these are not production recommendations.

The test harness initially compared in-memory responses directly to JSON durable receipts. Corrected the new assertions to include the existing replay marker and omitted undefined JSON properties; no replay implementation was changed. Interrupted test runs are not counted as passing gates.

Reproduction/validation commands from this worktree:

```sh
REP_WARS_TEST_PATTERN='^Phase 4:' TS_NODE_TRANSPILE_ONLY=1 npm test
REP_WARS_TEST_PATTERN='^(?!Phase 2:|a long renewal sequence stores one sequence number$)' TS_NODE_TRANSPILE_ONLY=1 npm test
REP_WARS_TEST_PATTERN='^(Phase 2:|a long renewal sequence stores one sequence number$)' TS_NODE_TRANSPILE_ONLY=1 npm test
npm run typecheck
npm run typecheck:tests
npm run build
git diff --check
```

The two full-runner groups use the existing filter and must be complementary: every excluded case runs in the other group. No test is removed or disabled. Transpile-only runtime execution is paired with both independent strict TypeScript checks.

Acceptance coverage and its limits:

| Requested behavior | Evidence boundary |
| --- | --- |
| Fresh-world discovery | New authenticated HTTP regression proves truthful missing configuration, not a playable approved workout. |
| Valid selection / start / completion / reload / retry | New three-size journeys use unchanged, explicitly test-only R1-D content and policy. |
| Unknown IDs, measurement/prescription rejection | Existing `tests/workoutAuthoring.ts` and session/catalog validation suites; no historical JSON is installed to bypass validation. |
| Readiness | Existing `tests/workoutProgression.ts` and `tests/workoutStartRewards.ts`, including explicit-ID readiness/window bypass rejection. |
| Incomplete / abandoned rewards | New incomplete-session rejection plus existing `tests/workoutSettlementRewards.ts` abandonment and mandatory-work assertions. |
| Feedback, revision changes, atomic history and stale CAS | Existing R1-D/E/F start, settlement and API suites; no replacement ledger or test expectations. |
| Tutorial | Existing scripted and Phase 2 regressions; legacy fixtures remain labeled compatibility evidence. Fresh approved-content tutorial startup remains BLOCKED. |
| Upper Body / Core / Lower Body | Existing type/compiler mapping inspected; acceptance of the rebuilt area-specific program remains BLOCKED, not satisfied by synthetic workouts. |
| Specialized gameplay and earlier phases | Existing reward/defense/construction/Golden Yield and Phase 1–3 suites remain in the full runner. No unsupported workout mode is asserted operational. |

## F. Remaining blockers and decisions

1. **BLOCKED — content:** provide the explicitly approved replacement exercise catalog and workout library, revision/IDs, valid measurements and prescriptions, movement-stage readiness requirements, and beginner-accessible content for the intended sizes/areas. Do not resubmit historical labels as approval. No actual fresh-world completed production workout is claimed.
2. **BLOCKED — world policy:** approve `WorldDefinition.workoutRewards` revision and `soldiersPerRewardUnitMicros` for each supported world. No placeholder ratio is shipped.
3. **UNRESOLVED integration:** identify the approved tutorial workout binding/selection policy and content manifest. Current Level 1 historical purpose table is preserved, not silently replaced or aliased to new content. Then complete explicit production loading/validation and verify start/discovery identity using those real definitions.
4. **PARTIAL fitness contract:** validate explicit area mapping and bounded prescription adaptation against the rebuilt content. Existing size/readiness/compiler tests are technical contracts, not a complete acceptance test of the new Upper/Core/Lower program. No universal score or mandatory capability is introduced.
5. **Verification limit:** three live Supabase tests require an authorized test environment; no fabricated credentials or destructive production checks. Local tests exercise the common serialization/CAS/history coordinator but cannot certify a live deployment.
6. The compatibility preview and tutorial public expected-action labels still exist. This patch blocks advertised normal availability; it does not claim to remove every historical display reference or approve specialized workout content for a rebuilt production library.

These dependencies prevent full Phase 4 PASS. Stop for content/product review; do not proceed to Phase 5 or author new workouts.

## G. Git checkpoint

Dedicated branch: `fix/backend-production-workout-activation`.
Parent: `7c53bfa52d392a1d37ddb6d1a37935245ca125be`.
**Local verification complete; PARTIAL implementation checkpoint.** The containing implementation commit is the checkpoint (a document cannot embed its own Git hash); obtain it with `git log -1 --format=%H -- docs/BACKEND_PHASE4_PRODUCTION_WORKOUT_ACTIVATION.md`. Exact SHA, normal branch-only push result and local/remote comparison are supplied in the post-commit final handoff.

The final production diff is limited to the two listed gameplay files. All tests and builds pass; the six-file checkpoint contains only those files, focused tests/runner updates and this report. Schema remains 32. Before staging, the three reviewed remote source branches were still pinned and the Phase 4 remote branch did not exist. Final pre-commit checks confirmed that all earlier worktrees matched the preflight snapshot.

Only this dedicated branch may be pushed, without force. No merge, deployment, protected-branch update, content authoring or Phase 5 work is part of this checkpoint. Production activation remains blocked as described above.
