# Backend Phase 2 — Tutorial and Deployed-Force Compatibility

## 1. Verdict

**PASS for executed Phase 2 backend acceptance.** The full suite completed with **2,398 passed, 0 failed, 3 skipped** and exit status 0. Focused Phase 2 coverage is **28 passed, 0 failed, 0 skipped**. Git publication is verified separately after this report is committed. This report addresses **AUD-002 only**. It does not claim the backend is feature-complete or that fresh production workout content is activated.

## 2. Starting checkpoint and isolation

- Reviewed source branch: `fix/backend-durable-mutation-identity`.
- Reviewed source commit: `b6891ccb4c9a21a09d94dc1e2e8be96b9b820997`.
- Verified parent: `67280e363fd89f256cd770566a5676d6415af695` (completion audit documentation), itself based on `e3f1781f8a53424462fabbd943cc01b0e2725154`.
- Isolated worktree: `/workspace/REP-WARS-2-TUTORIAL-FORCE`.
- Isolated branch: `fix/backend-tutorial-deployed-force`.
- Schema remains **32**. No migration or saved-state field was added.

The Phase 1 local and remote hashes matched; the destination branch did not exist. All 21 earlier worktrees were inspected before work. On resumption after the environment interruption, their heads and dirty-file inventory still matched the recorded inventory: only the original COMPLETION worktree contained unrelated changes (78 files). A fresh external snapshot records heads, complete status and dirty-file hashes for the final preservation comparison. No writes were made to those worktrees.

Sources read: `BACKEND_COMPLETION_AUDIT.md`, `BACKEND_COMPLETION_MATRIX.md`, `BACKEND_REMAINING_WORK.md`, `BACKEND_COMPLETION_ROADMAP.md`, `BACKEND_PHASE1_MUTATION_IDENTITY.md`, followed by the actual tutorial, military, workout, persistence and public-command implementations.

## 3. Root cause and surrounding audit

`src/gameplay/tutorial/level1.ts::assertLevel1TutorialPlayerAttackAllowed` required `commitAmount` at both `FIRST_ATTACK_AVAILABLE` and `FINAL_ATTACK_AVAILABLE`. Separately, `nextActionAllowed` tested only whether the raw bank exceeded `MIN_ATTACKING_TROOPS` (100; an attack needs strictly more than 100 soldiers plus knights). Both conditions ignored already-deployed forces.

`src/orchestration/handlers.ts::executeAttack` already supported two authoritative routes:

1. A supplied `commitAmount` creates a dedicated army through `commitBankedTroopsAndAttack` and spends that bank amount.
2. Without `commitAmount`, the ordinary strategic attack handler uses deployed forces; `onlyArmyId` selects an existing force, and `stagingTerritoryId` can specify its staging plan.

The tutorial guard ran before either route, rejecting the second. Partial deployment also reproduced the contradiction if the player selected a deployed force; it was not limited to an empty bank. The original audit probe's `armyId` was not the existing ATTACK selector. The correction uses and documents **`onlyArmyId`**, without introducing an alias or silently choosing a new troop source.

Relevant dependencies:

- `src/gameplay/military/troopBank.ts::deployBankedTroops`: ownership, available bank, deterministic identity and atomic debit; unchanged.
- `src/army/strategicAttack.ts::startStrategicAttack`, `listImmediateAttackingArmies`, `selectDelayedAttackPlan`: owned staging, force size, movement, intent, hostility and claim checks; unchanged.
- `src/engine/operations.ts::assertClaimAvailable`: existing reservation authority; unchanged.
- `level1.ts::stampProgress`, `syncLevel1Tutorial`, `tryFireScriptedInvasion`: conquest-based milestones and one scripted raid; unchanged.
- `level1.ts::assertLevel1TutorialWorkoutAllowed`: stage-specific normal and defense workout restrictions; unchanged.
- Session host → Orchestrator → cloned transaction → invariants → persisted receipts/CAS remains the only public mutation route.

The surrounding audit found the same bank-only condition at the final attack beat; this correction covers both. A moving or claimed army is temporarily unavailable, not a reason to grant troops or bypass travel. An unselected legal sibling remains usable. Garrison-only units and several individually undersized forces are not implicitly merged into a new field army. The test-only complete-loss fixture receives truthful `INSUFFICIENT_TROOPS`; it is not a claim of a new recovery-workout policy. No equivalent dead end was reproduced from legal deployment of the registered starting force and earned reward after this correction. Universal attrition/fragmentation recovery is not proven or redesigned here.

## 4. Pre-fix reproduction

Before production edits, the new regression failed against Phase 1 with:

```text
bank: 0
selectedArmy: army:v1:1
tutorial.beat: FIRST_ATTACK_AVAILABLE
tutorial.nextActionAllowed: false
error: MISSING_PARAMETER — Level 1 tutorial attacks require commitAmount
```

The temporary pre-interruption log was lost with the environment's `/tmp`. To preserve independently repeatable evidence, the reproduction was rerun after resumption by loading the **exact parent version** of `level1.ts` into the regression process, without replacing any working-tree file. It produced the same expected rejection. The current implementation passes that regression. The parent source, reproduction loader and raw log are external validation artifacts under `/workspace/phase2-validation/`.

### Explicit fixture boundary

Registered Level 1 starts with the real player army: 400 soldiers and 40 knights. The fixture supplies only an **already-active legacy** `wk_hard_full_body_basics` normal session using the existing HARD prescription. Public exercise recording and finalization earn **821 troops** under the unchanged legacy formula. A legal deployment of 321 leaves exactly 500 banked troops; a second legal deployment spends all 500. No tutorial flag, bank grant, new workout definition or conversion ratio is seeded.

Fresh NORMAL_TROOPS start still has the separate **AUD-003 / Phase 4** catalog-policy activation problem. The full journey uses an explicitly seeded historical active session at each of the two normal-workout starts. Their completion, reward settlement, defense workout start/completion, deployment, attacks and progression all use real authoritative commands. This is not an end-to-end claim for a brand-new production player's content onboarding.

## 5. Implementation

1. Remove the tutorial-only `commitAmount` requirement. Keep stage and first-target guards intact.
2. Derive the tutorial ATTACK availability hint from existing bank/force eligibility helpers. Check hostility, target claims, pending attacks, available bank, owned staging, individual force claims and physical availability. Inspect each selectable force so a claimed sibling cannot hide a legal one. The query never executes a battle or mutates state.
3. Add the existing `onlyArmyId` selector to ATTACK's public command metadata.

The actual attack, battle, deployment, reservation and settlement engines were not changed. There is no new tutorial troop ledger or combat path.

## 6. Banked versus deployed behavior

| Situation | Result |
|---|---|
| Valid bank commitment, no deployment | Existing dedicated-army bank path succeeds. |
| Partial deployment | Either a valid bank commitment or eligible selected deployed force works. |
| Full deployment, bank zero | `onlyArmyId` can select the eligible deployed force; public availability remains true. |
| Multiple player armies | Explicit selection leaves unrelated eligible armies unchanged. |
| Enemy, absent, undersized, moving or claimed force | Existing military rejection; no troops or claims are changed by rejection. |
| Foreign staging territory | Rejected by existing staging rules. |
| Existing legal one-hop staging route | Movement starts; conquest waits for arrival and battle/occupation. |
| No legal attacking force | Existing `INSUFFICIENT_TROOPS`, with a false attack-availability hint. |
| Wrong first target or wrong tutorial beat | Existing tutorial error; no scripted raid or milestone is created. |

Clients should supply **either** `commitAmount` **or** `onlyArmyId` according to the intended source. The existing precedence of the bank path when `commitAmount` is present is unchanged. Without either selector, existing ordinary military source-selection semantics remain unchanged.

## 7. Progression integrity

The first target is still `t_01`; attacking `t_03` first is rejected because it would remove the army needed for the scripted raid. Actual non-anchor ownership stamps first conquest. Attack submission and a delayed march do not stamp conquest.

Executed journey: legacy active normal workout → public completion/payment → bank500 → full deployment → first conquest → one scripted invasion → public DEFENSE start/completion → final normal workout completion → final full deployment/attack → all territories owned → `COMPLETE` → reload/read/replay.

The existing scripted raid cap of eight troops, its ordering, defense effect, later workout requirement and world-completion rules remain unchanged. No tutorial progression code was rewritten. Delayed attack coverage verifies no raid at march initiation and the raid only after earned-time processing reaches conquest. It uses an explicit army-location fixture to exercise the existing foreign-origin one-hop path; Phase 6 passage policy remains outside scope.

## 8. Military integrity

Tests compare bank plus physical player troop totals across deployment and unopposed occupation, assert exact unselected-army preservation, and check canonical invariants. Rejected attacks preserve army and claim maps. A reservation fixture includes its actual physical movement and canonical operation/claim linkage; claimed units cannot be reused. A second unclaimed force remains selectable.

The complete tutorial and multi-seed runs exercise existing defense combat and final settlement. Three fixed seeds (3, 11, 29), each run twice from identical authoritative state/commands, compare the entire persisted canonical snapshot. No combat formula, RNG, C1 accounting, C2 identity, C3 seed authority, resource rule or troop price changed.

## 9. Phase 1 compatibility

Every tested mutation has a stable `requestId`, current `worldAttempt` and ordinary intent fingerprint. Deployment and attack tests cover:

- Same request after reload: same original result, no extra save/effect.
- Changed quantity/source under the same ID: `COMMAND_IDENTITY_CONFLICT`.
- Two independent stale session hosts: one successful CAS and one original-result replay.
- Different-intent stale writer: conflict without a hidden merge.
- Failure before commit: no canonical change; retry applies once.
- Lost commit acknowledgement: persisted outcome is recovered, never applied twice.
- Defeat/restart: old successful outcomes remain replayable, but unexecuted old-attempt commands are fenced by `COMMAND_ATTEMPT_STALE`.

Previously persisted rejected commands retain their original results after this update. A player retrying a pre-fix rejected attack must submit a new logical request ID; this correction does not invalidate or rewrite Phase 1 receipts.

The defeat test uses an explicit ownership-loss fixture after resolving the scripted invasion, then the existing `applyPlayerTerritoryLoss` reducer and public restart. It does not manufacture a successful conquest or tutorial flag. Durable history, receipt authority, CAS implementation and schema32 are unchanged.

## 10. Executed validation

| Validation | Executed result |
|---|---|
| Focused Phase 2 | **28 passed, 0 failed, 0 skipped**; 2,373 other tests excluded by the explicit name filter, not executed in this focused run. |
| Full backend | **2,398 passed, 0 failed, 3 skipped**, exit 0. All 28 Phase 2 tests and all 23 Phase 1 mutation-identity regressions executed successfully. |
| Production TypeScript | **PASS**, zero diagnostics. |
| Test-inclusive TypeScript | **PASS**, zero diagnostics; no inherited errors suppressed. |
| Production build | **PASS**. |
| `git diff --check` | **PASS**. |

Commands:

```sh
REP_WARS_TEST_PATTERN='^Phase 2:' npm test
TS_NODE_TRANSPILE_ONLY=1 npm test
npm run typecheck
npm run typecheck:tests
npm run build
git diff --check
```

The Phase 1 baseline was 2,370 passes plus three skips. The final increase is exactly the 28 new regressions. Affected tutorial, troop-bank, military, invasion, persistence, HTTP, C1–C3, workout, timing and session suites ran as part of this complete backend runner.

An earlier full run ended without a final summary after 2,325 passes, no failures and three skips; a detached retry also ended without a summary. Neither is counted as a completed suite. The final managed run executes the unchanged full runner with `TS_NODE_TRANSPILE_ONLY=1` to avoid retaining the compiler during tests. Production and test-inclusive **strict typechecks were separately executed and passed**; no type errors or tests were suppressed. Final raw output and explicit exit status are `/workspace/phase2-validation/full-final.log` and `full-final.exit`. The focused run is `focused-final.log`.

Initial expanded test runs found fixture mistakes, not production regressions: an operation missing its physical lifecycle, zero-troop armies left in the map, a foreign-origin march incorrectly expected to fail, a defeat fixture leaving an open invasion on lost territory, and a read-only GET mistakenly expected to advance time. Fixtures were corrected to honor existing invariants and timing. Existing tests were neither removed nor weakened. Delayed processing now uses the public receipted `SYNC_PLAYER_WORLD` command.

The three live Supabase tests require approved disposable credentials and remain distinct from executed memory/mock CAS proofs. No production database was accessed.

## 11. File inventory

- `src/gameplay/tutorial/level1.ts`: deployed-force eligibility and truthful attack hint; preserve stage/target progression.
- `src/orchestration/handlers.ts`: call the source-independent tutorial guard.
- `src/orchestration/commandIndex.ts`: advertise existing `onlyArmyId`.
- `tests/tutorialDeployedForce.ts`: 28 new focused public-host/HTTP and domain-invariant regressions.
- `tests/run.ts`: register those tests.
- `docs/BACKEND_PHASE2_TUTORIAL_DEPLOYED_FORCE.md`: this implementation/evidence report.

No world JSON, Unity file, fitness catalog, schema, battle engine, persistence infrastructure or unrelated gameplay file changed. External raw validation logs are not production assets and are not included in the commit.

## 12. Remaining risks and limits

- Fresh production normal-workout content activation is still Phase 4. No invented ratios or catalog content were introduced to conceal that blocker.
- Live Supabase concurrency and atomicity need the three gated tests in an explicitly approved disposable environment; mock/memory evidence is not live DB evidence.
- Existing garrison conversion, small-force merging and universal post-attrition recovery are not implemented by this correction. The registered deployment journey remains completable; arbitrary depleted saves receive accurate errors rather than free troops.
- Foreign-territory movement policy remains the separate Phase 6 audit item. Its existing one-hop behavior was preserved, not endorsed as a new gameplay rule.
- `nextActionAllowed` is a derived advisory view, not permission to bypass final military/CAS checks when the world changes between read and command.

## 13. Git checkpoint

The checkpoint is the commit containing this report on `fix/backend-tutorial-deployed-force`, with the reviewed Phase 1 commit as its sole parent. Its exact hash and GitHub push verification will be reported after commit (a commit cannot embed its own hash). Only the six files above are included in the checkpoint. Final pre-commit comparison checked all 21 other worktrees: zero head, status or dirty-file hash mismatches. Final local/remote verification and worktree comparisons are retained outside the repository in `/workspace/phase2-validation/`.

No merge, deployment, force push, protected-branch update or unrelated-worktree edit is authorized or performed.

## 14. Next recommended phase

**Phase 3 — Durable Event Consequences**, only after explicit authorization. Phase 3 has not begun. Phase 2 does not finish the overall backend.
