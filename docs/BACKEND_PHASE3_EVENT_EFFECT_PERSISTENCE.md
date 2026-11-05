# Backend Phase 3 — World Event Effect Persistence

**Verdict: PASS — implemented and verified.** Publication is verified after creating the commit, as described in section F.

## A. Starting state and audit

Parent: `1b194a8f90bda20cc55e7b7333d6f0bba048038e`, branch `fix/backend-tutorial-deployed-force`, parent `b6891ccb4c9a21a09d94dc1e2e8be96b9b820997`. Local and remote Phase 2 match, with the expected six-file implementation/report and clean worktree. Phase 3 is isolated in `/workspace/REP-WARS-2-EVENT-PERSISTENCE` on `fix/backend-event-effect-persistence`. Preservation snapshot covers all 22 prior worktrees, including 78 unrelated dirty files in the original COMPLETION checkout.

Reviewed the six requested completion documents, including the Phase 2 report and `BACKEND_AUDIT_EVIDENCE.json::crossSystemProbes.eventHydration`. Roadmap Phase 3 is AUD-005: durable event consequences, protecting authored geography and content fingerprints. No scope conflict found. Schema 32 is the starting format.

## B. Pre-implementation root cause

`WorldSimulator.simulate` creates deterministic event identities, applies trigger/per-turn consequences through `ConsequenceApplier.applyDelta`, and clones active events, choices, deadlines and history. `world/eventTick.ts::runEventEngineTurn` merges its output into canonical GameState. Territory `resourceOutputPct` and `foodProductionPct` mutate the existing `Territory.resourceOutput`; they are not a separate temporary rate cache.

Economy `effectiveResourceOutput` uses that canonical rate and existing development multipliers. `persistTerritoryAccrual` credits the empire bank, records Golden Yield eligibility and advances its watermark. Snapshot/serialization already preserve those fields, balances, active event identities, choices and expiration turns. However, `hydratePersistedPayload` calls `applyImmutableWorldDefinition`, which replaces saved `tile.resourceOutput` with the authored base. The field was incorrectly classified as immutable geography. This is the loss point; no missing event ledger or extra clock was found. The shared affected consequence fields are `resourceOutputPct` and `foodProductionPct`: existing Drought, Flood, Storm, Harsh Winter, Resource Discovery, Prosperity and Trade Boom definitions use them. Their trigger/recurrence formulas are unchanged. The existing Supabase adapter uses the same `snapshotGameState`/`hydratePersistedPayload` pair as the tested memory store; the RPC/CAS envelope, expected version and atomic workout-history coordinator are unchanged.

**Executed pre-fix reproduction:** actual registered Level 2, seed 11, runtime population 3000 on each territory (explicit eligibility fixture, not a production population change). The real event engine naturally triggers Resource Discovery at t_07, changing Gold output 1→2. Process production to tick 30; reload one branch; continue both to tick 120. Continuous output 2 / bank Gold 858 versus reloaded output 1 / bank Gold 857. Full canonical snapshot comparison fails. Log: `/workspace/phase3-validation/prefix.log`. Production code was still unchanged when this failed.

**Existing duration semantics:** Resource Discovery is instant and leaves its output/windfall deltas applied. Drought and other recurring events apply consequences on active turns, including the expiration turn because expiry occurs later in the same event step. Expiration stops subsequent recurrence; there is no inverse-effect rollback. Phase 3 preserves this behavior, rather than inventing temporary multipliers or reversing already-earned consequences. Choice handling exists as a reducer, but a public event-choice command/inbox remains the separate AUD-006 gap. Natural eligibility/population is AUD-004 and remains unchanged.

## C. Implemented correction and file inventory

Preserve the already-persisted canonical event-adjusted `resourceOutput` during world-definition rebinding; keep authored initialization, geography, world identity and content fingerprints unchanged. Validate the retained field as a nonnegative finite bundle of existing resource types. No new field, second authority or schema bump is required. Missing/corrupt required output data must not be silently repaired with an invented historical event result. Old valid saves already contain this field. If an earlier load-and-save already erased an event delta, do not reconstruct history or grant compensation.

**IMPLEMENTED:** only two production behavior changes: retain the existing canonical output during hydration, and reject malformed output bundles through existing invariants. The other production edits clarify field documentation.

| File | Change |
| --- | --- |
| `src/worldDefinition/instantiate.ts` | `applyImmutableWorldDefinition` no longer overwrites saved `resourceOutput`; all other authored rebinding and content-identity checks remain. |
| `src/state/gameStateInvariants.ts` | Validate present output object, existing resource keys, finite nonnegative values. Used by snapshot, hydration and existing transaction validation. |
| `src/types/index.ts` | Correct the `Territory.resourceOutput` authority/lifetime comment. |
| `src/gameplay/economy/effectiveOutput.ts` | Clarify that economy reads canonical output including applied event consequences. No calculation changes. |
| `tests/eventEffectPersistence.ts` (new) | 27 focused regressions, including real session-host/CAS continuation and deterministic gameplay comparisons. |
| `tests/run.ts` | Register Phase 3 regressions in the complete runner. |
| `docs/BACKEND_PHASE3_EVENT_EFFECT_PERSISTENCE.md` (new) | This audit, reproduction, compatibility and validation report. |

**Compatibility:** persisted format and schema remain **32**. No new field, migration, event store, timing state or compensation ledger. Initial worlds still copy authored output. Existing valid output bundles remain valid, including zero/optional resource keys; malformed required output now fails explicitly instead of being hidden by rebinding. Authored content fingerprint mismatch still rejects load, and authored terrain/region/adjacency still rebind. Save versions 29–30 retain their existing once-only migration of genuinely unbanked yield; versions 31–32 already bank production and preserve those balances unchanged.

## D. Executed validation

**VERIFIED — pre-fix reproduction:** one regression failed before production edits. The exact same regression passes afterward:

| At simulation tick 120, seed 11 | Before fix: continuous | Before fix: reload at tick 30 | After fix: both paths |
| --- | ---: | ---: | ---: |
| t_07 Gold output per production cycle | 2 | 1 | 2 |
| Owner bank Gold | 858 | 857 | 858 |

The test compares the complete serialized canonical state, not just this illustrative balance. Population 3000 is an explicit event-eligibility fixture on actual registered Level 2; authored rates, resource balances, seed and event selection are unchanged. This does not establish natural production-world eligibility.

**VERIFIED — focused regressions: 27 passed, 0 failed, 0 skipped.**

- Natural Resource Discovery; reload at ticks 0/1/29/59/60/120; repeated round trips and repeated accrual at the same watermark do not credit gains twice.
- Existing recurring Drought at activation, during, immediately before expiry, at expiry and afterward. A controlled active-event fixture uses Food output 100 to make rounded reductions observable; it is not new production content. Each active turn through turn 3 reduces output; later turns do not. Exactly one expiration history entry, no reactivation, no reversal of lasting deltas.
- Existing Food Shortage `import_food` choice reducer: one cost, selected consequences/history, shortened expiration, cleared pending choices and chain suppression survive reload. Repeating the choice does not spend again. Subsequent event/production processing matches. This is reducer coverage, not a nonexistent public choice endpoint.
- Actual `createSessionHost.execute(SYNC_PLAYER_WORLD)` through normal Orchestrator, canonical simulation and in-memory CAS persistence: 150 earned ticks plus a half-tick remainder, online and offline separately. One request with ample budget equals three 64/64/22-tick requests with fresh hosts/reloads. Earned target remains 150; backlog is not discarded. AI, operations, event history, rates, balances and all other gameplay state match.
- For those different request schedules only command receipts are excluded using the established `gameplaySnapshot` helper, because distinct logical requests intentionally produce distinct receipts. All other canonical fields remain compared. Same-command failure/retry and lost-acknowledgment tests compare full snapshots including receipts and persistence versions.
- Failure before commit leaves the original state unchanged; retry equals an unfailing control. A simulated successful commit followed by a lost acknowledgment is recovered from the durable receipt; restarting the host and retrying produces no new write or economic effect. An independently cached stale writer conflicts and cannot overwrite committed consequences.
- Authored geography is restored, and catalog fingerprint changes are rejected. Schemas 29/30/31/32 preserve output and earned resources through existing migrations; rehydration is idempotent. Legacy fixtures represent <=30 production as unbanked yield rather than relabeling an already-banked current save. Historically erased rates are not fabricated from event history.
- Malformed/missing output rejected; zero, empty and existing finite resource bundles retained.

Reproduction commands (run from the isolated worktree):

```sh
TS_NODE_TRANSPILE_ONLY=1 node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json tests/eventEffectPersistence.ts
REP_WARS_TEST_PATTERN='^(?!Phase 2:|a long renewal sequence stores one sequence number$)' TS_NODE_TRANSPILE_ONLY=1 npm test
REP_WARS_TEST_PATTERN='^(Phase 2:|a long renewal sequence stores one sequence number$)' TS_NODE_TRANSPILE_ONLY=1 npm test
npm run typecheck
npm run typecheck:tests
npm run build
git diff --check
```

The full suite is run in two complementary groups using its existing test filter; every excluded test in either group must execute in the other. No assertions or test registration are changed. The earlier unfiltered run was interrupted after 2,375 passes and three skips, before its final summary, and is not counted as a completed suite. A second unfiltered attempt was deliberately stopped in favor of these bounded invocations. Both incomplete logs are retained.

The test runner uses transpile-only to avoid retaining the TypeScript compiler during the large runtime suite. Both independent strict TypeScript checks run separately; no diagnostic suppression or changed compiler settings.

**VERIFIED — full repository suite: 2,425 passed, 0 failed, 3 skipped.** This is the Phase 2 baseline of 2,398 passes plus 27 new Phase 3 regressions. The existing three live Supabase tests are not counted as passes.

| Executed check | Result |
| --- | --- |
| Core runner group | 2,396 passed, 0 failed, 3 live skips; 29 filtered into the complementary group |
| Tutorial and long-retry group | 29 passed, 0 failed, 0 skipped; 2,399 filtered into the core group |
| Exhaustive coverage check | 2,428 total registered cases; complementary exclusions match the other group's executed count; no overlap or uncovered cases; both processes exited 0 |
| Phase 1 identity regressions, included above | 23 passed |
| Phase 2 tutorial regressions, included above | 28 passed |
| Phase 3 regressions, included above and also run directly | 27 passed |
| Existing larger-world/reload comparisons | 8 passed: seeds 11/29, 10/30/50 territories at 360 ticks and 50 territories at 1,440 ticks |
| Production TypeScript | PASS, zero diagnostics |
| Test-inclusive TypeScript | PASS, zero diagnostics |
| Production build | PASS |
| `git diff --check` | PASS |

The two successful full-runner invocations cover the existing event, economy, production, temporal, persistence/CAS, command identity and tutorial suites. The larger-world tests are existing runtime compatibility checks; the explicit event-eligible Level 2 regressions provide the production-event persistence proof. Every passed test from the interrupted unfiltered attempt also appears in the successful combined coverage. Source/test SHA-256 checks confirm no implementation changes occurred during validation.

Raw local validation logs are outside the repository in `/workspace/phase3-validation/` (`prefix.log`, `postfix-initial.log`, `focused.log`, `full.log`, `full-rerun.log`, `full-core.log`, `full-journeys.log`, TypeScript/build logs and exit-code files). They are supporting execution output, not production artifacts.

## E. Remaining limitations and deferred work

- **UNRESOLVED/out of scope:** natural event population/eligibility gaps (AUD-004). Event-eligible fixtures prove persistence without changing trigger conditions.
- **PARTIAL existing system:** event choices work in the existing reducer; no public choice command/inbox is implemented here (AUD-006). Unsupported consequence kinds remain unsupported. No event types, probabilities or coefficients changed.
- **Compatibility limit:** if an older server already loaded an event-modified save and persisted the reset base rate, the lost authoritative value cannot safely be recovered from current state. This fix prevents future loss; it does not fabricate history or compensation.
- **Verification limit:** no authorized live Supabase test credentials are configured. The existing three live integration checks remain gated; local CAS/failure/retry tests exercise the common serializer/hydrator and authoritative transaction path. No production database was contacted.
- Existing duration policy is preserved, including lasting deltas and recurrence on the expiry turn. Any broader policy revision requires separate authorization.
- Phase 4 production workout/content activation has **not begun**. No Unity, combat, AI policy, tutorial, reward, economy-balance, event-ordering or temporal-rule edits.

## F. Review and Git checkpoint

Dedicated branch: `fix/backend-event-effect-persistence`.
Parent: `1b194a8f90bda20cc55e7b7333d6f0bba048038e`.
The Phase 2 parent is `b6891ccb4c9a21a09d94dc1e2e8be96b9b820997`; both reviewed remote branches remain pinned.

Pre-checkpoint preservation verification: all 22 earlier worktrees retain their original HEAD/status, and all 78 pre-existing dirty files retain their SHA-256 hashes. Only the seven listed Phase 3 files are changed in the isolated worktree; build output is ignored, and existing tracked dependency files are unchanged. No unrelated generated evidence is staged.

The commit containing this report is the Phase 3 checkpoint. Its exact full hash, successful normal push and local/remote synchronization result are recorded in the final handoff after publication; a commit cannot embed its own hash. Resolve the checkpoint and verify publication with:

```sh
git log -1 --format='%H %P %s' -- docs/BACKEND_PHASE3_EVENT_EFFECT_PERSISTENCE.md
git rev-parse origin/fix/backend-event-effect-persistence
git rev-list --left-right --count HEAD...origin/fix/backend-event-effect-persistence
git status --short
```

Only this dedicated branch is authorized for normal push. Final handoff requires identical local/remote hashes, ahead/behind 0/0, a clean isolated worktree and another preservation check of the 22 earlier worktrees. No merge or deployment is authorized. Phase 4 and natural-event eligibility changes remain deferred.
