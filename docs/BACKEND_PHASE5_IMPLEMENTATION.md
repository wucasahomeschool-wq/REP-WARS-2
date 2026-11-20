# Phase 5 — Natural event eligibility and player choices (two checkpoints)

**Verdict: BLOCKED before implementation — Checkpoint A requires the population/eligibility product decision explicitly identified in the roadmap.** Phase 4's workout-content dependency is independent of this blocker. No production code, tests, schemas, content or gameplay values were changed. This is an audit and reproduction report, not an implementation checkpoint.

## A. Authoritative scope

Source: `docs/BACKEND_COMPLETION_ROADMAP.md`, “Phase 5 — Natural event eligibility and player choices (two checkpoints)”; related findings AUD-004 and AUD-006 in the audit, matrix and remaining-work list. Current user instructions authorize this phase but explicitly limit multiple substantial features to the first independently testable subphase.

| Required scope assessment | Verified roadmap contract |
| --- | --- |
| Exact title | Natural event eligibility and player choices (two checkpoints). |
| Objective | Make relevant events reachable and interactive using the existing event engine. |
| Included, Checkpoint A | Resolve authored population versus obsolete population gating; registered-world eligibility tests; compatible migration if needed. This is the first authorized implementation subphase. |
| Included, later Checkpoint B | Safe public choice DTO; authorized receipted resolution command; truthful consequence support; existing default/expiry behavior. Not a substitute for blocked A. |
| Excluded | New population economy, garrison morale stat, invented secession mechanics, arbitrary event coefficients; all unrelated backend phases, workout content and Unity changes. |
| Dependencies | Bounded eligibility decision, completed Phase 3 effect persistence and Phase 1 receipts. The reviewed source contains both corrections. |
| Product decisions | Population's role in event eligibility; later, replacement/removal of unsupported consequences. Reuse choice/expiry behavior where it already exists. |
| Technical work after approval | A: change the appropriate eligibility or authoring/initialization path, with explicit compatibility tests. B: expose existing event mechanics through the canonical public command path. No new engine/store. |
| Expected tests | Food shortage → Stability → eligible event; initialized registered worlds; deterministic/reloaded processing; later active-choice reconnect, authorization, invalid/expired choice, duplicate choice, reserved resources, outcome reload and no falsely advertised unapplied effect. Preserve Phases 1–4, full runner, both TS checks and build after implementation. |
| Full Phase 5 acceptance | A real initialized world can trigger intended events, inspect them and resolve choices exactly once without private AI leakage. A alone must be labeled PARTIAL for the complete two-checkpoint phase. |
| Can proceed while Phase 4 is PARTIAL? | Yes in dependency terms: event eligibility uses no workout catalog, reward ratio or tutorial workout binding. It cannot proceed without its own population decision. |

The roadmap's “Product decisions genuinely required” section asks: **“Is population an authored initial value used by existing events, or should events be eligible from existing ownership/economy facts without a population gate? ... If retained, approve its authored values/interface.”** Neither the inspected implementation nor later Phase 1–4 reports supplies this approval. The locked Food → Stability → events requirement establishes the intended connection, but does not choose between these two implementations.

No substantive scope conflict was found. The older roadmap's documentation-only stop and Phase 4's instruction not to start Phase 5 are superseded by the current explicit Phase 5 authorization. Their unresolved product decisions are not superseded. Phase 3's population-3000 fixture explicitly proves persistence only; it is not approval to initialize production population to 3000.

Sources inspected: `BACKEND_COMPLETION_AUDIT.md`, `BACKEND_COMPLETION_MATRIX.md`, `BACKEND_REMAINING_WORK.md`, `BACKEND_COMPLETION_ROADMAP.md`, `BACKEND_AUDIT_EVIDENCE.json`, and the Phase 1, 2, 3 and 4 implementation reports. Historical audit checkpoint `67280e363fd89f256cd770566a5676d6415af695` remains context; the current code was traced independently.

## B. Starting state and isolation

- Repository: `wucasahomeschool-wq/REP-WARS-2`.
- Inspected source worktree: `/workspace/REP-WARS-2-WORKOUT-ACTIVATION`, clean on `fix/backend-production-workout-activation`.
- Verified local and GitHub source HEAD: `0e69549d03b4f7f50252351a28868b9eaffc7e6d`.
- Verified parent: `7c53bfa52d392a1d37ddb6d1a37935245ca125be`; schema 32.
- New isolated worktree: `/workspace/REP-WARS-2-EVENT-ELIGIBILITY`.
- New branch: `fix/backend-natural-event-eligibility`, created from the exact source commit; initially clean. No other commits were incorporated.
- There are now **24 pre-existing worktrees**, including Phase 4, and **78 inherited dirty files**. Captured each worktree's HEAD/status and dirty-file SHA-256 values before isolation in `/workspace/phase5-validation/worktrees-before.json`.
- Phase 4's `requireWorkoutRewardConfiguration` and `serializeWorkoutSelectionView` correction, focused tests and report are present. No prior checkpoint or dirty file was overwritten.

## C. Audit findings and reproduced defect

### Existing mechanisms — IMPLEMENTED

1. `src/persistence/initializePlayerWorld.ts::initializePlayerWorld` resolves registered worlds and calls the canonical world initializer. Its optional `worldId` allows the actual Level 2 definition to be tested without inventing content.
2. `src/worldDefinition/instantiate.ts::createGameStateFromWorld` initializes **every authored territory with `population: 0`**. `WorldTerritoryDefinition` in `src/worldDefinition/types.ts` has no authored population field. Adding an arbitrary JSON value would not make the initializer apply it.
3. `src/events/EventTriggers.ts::candidateTerritoriesForEvents` requires an owner, population at least `BALANCE.events.world.territoryChoiceMinPopulation` (**2000**) and room under the existing concurrent-event cap.
4. `src/events/WorldSimulator.ts::simulate` calls this filter before `evaluateAllTriggersForTerritory`, deterministic candidate shuffling, trigger weighting and severity selection. Empty candidates prevent all initial natural territory candidates from reaching those calculations. Existing active events/chains are a different path; this finding does not claim that forcibly seeded events cannot execute.
5. `src/events/EventDefinitions.ts::evaluateAllTriggersForTerritory` already adjusts Food Shortage weight/severity using faction Food ratios and Rebellion weight/severity using Stability/unrest. These modifiers cannot bypass the outer population filter. The defect is not evidence for changing their probabilities.
6. `src/gameplay/economy/foodConsumption.ts::{empireFoodDemand,consumeEmpireFood}` already applies empire-plus-territory demand to available, unreserved bank Food. Failed upkeep lowers Stability using existing coefficients. Level 1 remains deliberately upkeep-gated. No upkeep or shortage coefficient needs to be invented to demonstrate the blocked connection.
7. `src/world/ContinuousWorldEngine.ts` invokes `runEventEngineTurn` through the existing tick ordering. `src/world/eventTick.ts` advances the event turn, adapts canonical state, invokes the existing simulator and merges results through `src/orchestration/applyEvents.ts`.
8. `GameState` owns territories/population, faction resources/Stability, active events/history, world time and receipts. The existing snapshot/hydrator and CAS store persist them. Phase 3 preserves canonical event-adjusted production; no second event authority is needed.

Public execution remains: authenticated HTTP → `CommandRequest` → session host/Orchestrator → cloned canonical simulation → invariants → durable receipt/CAS commit → response. `SYNC_PLAYER_WORLD` exercises this path. There is no public command that legitimately authors population during play.

### Missing/partial mechanisms

- **BLOCKED, A:** no approved contract determines whether to author population or remove the universal event population filter. Existing zero-population saves also need deterministic compatibility treatment if authored population is chosen. Arbitrary backfill would invent state.
- **PARTIAL, B:** `WorldSimulator.resolveChoice` already checks active status, duplicate resolution, choice identity and affordable reservation-aware cost, applies supported consequences and records choice state. It is an internal reducer, not an authenticated public action. `serializePublicGameState` exposes `activeEventCount`, not the full safe choice inbox; command metadata/allowlist do not expose a choice-resolution route.
- **UNRESOLVED, B:** `EventModel.ConsequenceDelta` explicitly marks `moraleDeltaGarrison` and `infrastructureDeltaPct` as NOT APPLIED. `ConsequenceApplier.applyDelta` can still return the consequence's descriptive message. A later public choice contract must not advertise that as an applied mechanical effect. Replacement/removal requires the roadmap's decision; adding new stats is excluded.

### Executed deterministic reproduction — VERIFIED

No repository source or tests were edited. External probe: `/workspace/phase5-validation/eligibility-probe.cjs`; raw results: `eligibility-probe.log` and `eligibility-probe.json`.

| Check | Observed result |
| --- | --- |
| Real registered Level 1 initializer, seed 11 | 3 territories; populations `[0,0,0]`; 0 candidate territories; canonical invariants pass. |
| Real registered Level 2 initializer, seed 11 | 8 territories; all population 0; 0 candidates; canonical invariants pass. |
| Actual event engine on fresh Level 2, seed 11, 100 event turns | 0 triggered natural events, 0 history entries. No population or event fixture is inserted. This is a component-turn probe, not 100 calendar minutes. |
| Explicit depleted-bank diagnostic fixture | Actual Level 2 player Food set to 0 only to isolate shortage behavior; existing one-cycle upkeep at tick 60 demands 2 Food, pays 0 and lowers Stability **70 → 68**. Candidates remain empty. Repeated upkeep at the same tick makes no second change; snapshot/hydration preserves the complete state and empty candidate set. This fixture does not claim a naturally depleted production campaign. |
| Authenticated public `SYNC_PLAYER_WORLD` | Real Level 2 production initializer persisted to the in-memory CAS adapter, seed 11; first request anchors time, then **60,000,000 elapsed real milliseconds offline** earns **100 simulation ticks** at 0.1×. Receipted sync processes worldTick/target/turn to 100; still 0 event history/candidates. Same logical request replay makes 0 additional writes and leaves the full snapshot unchanged. Invariants pass. |

Public probe authentication is a trusted local test adapter, not live account-provider proof. No workout fixture, ratio, troop grant, event insertion or population change is used in the initialized-world or public-sync probes.

**Expected product behavior:** a legitimate initialized world should be able to reach the intended condition-driven event system. This does not mean a random event must trigger in a particular finite sample. **Actual defect proof:** the candidate set is structurally empty for every fresh territory, before RNG or event conditions. Seed 11 reproduces the historical audit's 100-turn result, but the empty-set conclusion does not depend on that seed.

**Smallest correction after approval:** either remove the obsolete outer population requirement while preserving ownership, concurrency caps and existing event-specific conditions, or add/apply explicitly approved authored population with defined existing-save behavior. These are alternatives, not interchangeable implementation details. Raising populations or setting the threshold to zero without approval would choose gameplay policy. No correction is implemented.

## D. Changes and compatibility

Only repository file added: `docs/BACKEND_PHASE5_IMPLEMENTATION.md` (this audit/blocker report).

No source, test, world JSON, schema, API, migration, balance, catalog, Unity or build configuration change. No implementation test was added because there is no approved target behavior yet. External analysis files under `/workspace/phase5-validation/` are diagnostic artifacts, not production assets.

Schema remains 32. No save mutation or compensation is performed. Existing event output, workout locks, durable receipts, deployed-force tutorial behavior and all Phase 1–4 source files remain byte-identical to the verified checkpoint.

## E. Validation and limits

- **Executed now:** five diagnostic checks above; all five assertions groups completed successfully, exit 0. They confirm the blocker, not a fixed gameplay journey.
- **Executed now:** public sync/retry, component upkeep idempotence, exact snapshot/hydration equality, canonical invariants and Git preservation/whitespace checks.
- **Not rerun:** full backend suite, production/test-inclusive TypeScript and production build. There are no executable changes and the explicit product-decision stop gate applies before implementation. No claim is made that implementation acceptance gates passed for Phase 5.
- **Historical verified source results only:** Phase 4 reported 2,437 passed, 0 failed, 3 live Supabase skips, 12 new regressions, Phases 1–3 preserved, both TS checks and build passed. These totals are not new Phase 5 execution results.
- **Live Supabase:** not executed; authorized disposable-environment opt-in/credentials remain outstanding. No production database was contacted.

Reproduce from the isolated worktree:

```sh
TS_NODE_TRANSPILE_ONLY=1 node -r ./node_modules/ts-node/register /workspace/phase5-validation/eligibility-probe.cjs
git diff --check
git status --short
```

Once A has an approved contract, add pre-fix/fix regressions against that contract, real initialized-world shortage eligibility, seeded outcomes, continuous/reloaded/catch-up equivalence, legacy-save compatibility, CAS/retry and reservations where affected. Then run all required subsystem/Phase 1–4/full-suite/build gates. B's public choice journey remains a separate checkpoint.

## F. Decisions and remaining limitations

**Decision required now:** Should natural event eligibility use existing ownership/Food/Stability/event conditions without the universal population gate, or should population remain an explicitly authored requirement?

If population is retained, approve its authored interface/initial values and intended treatment of existing zero-population saves. Do not copy the Phase 3 population-3000 test fixture into production. No new population economy is needed or authorized under either choice.

**Later Checkpoint B:** approve removal/replacement of unsupported choice consequences where current mechanics do not define them, then implement safe public inspection and receipted resolution. Do not skip blocked A by implementing this substantial second checkpoint without authorization.

Phase 4 remains PARTIAL, but its missing workouts, ratios and tutorial bindings do not cause this eligibility blocker. No workout-content work resumed. Phase 6 and all unrelated systems remain out of scope.

## G. Git and preservation

- Branch: `fix/backend-natural-event-eligibility`.
- Base and current HEAD: `0e69549d03b4f7f50252351a28868b9eaffc7e6d`.
- New commit: **NONE**, as instructed for a phase blocked before implementation.
- Push: **NONE**; no new Phase 5 remote checkpoint or synchronization claim.
- Source remote `fix/backend-production-workout-activation` independently verified at the exact base SHA; proposed Phase 5 remote branch was absent.
- Working tree: only this new, unstaged report is expected; index and tracked files unchanged.
- All 24 earlier worktrees, their HEAD/status and 78 dirty-file hashes are checked against the preflight inventory. No protected branch or unrelated worktree was modified.

No reset, clean, stash, merge, rebase, deployment, gameplay implementation or Phase 6 work. Stop for the population/eligibility decision.

---

## Checkpoint A — Natural Event Eligibility Implementation

**Current verdict: BLOCKED at acceptance/checkpoint; implementation is PARTIAL and uncommitted.** The historical audit above is preserved verbatim. The user has now resolved its original decision: remove the universal population minimum, retain population and existing event-specific rules, and do not invent population data. The new blocker below is a demonstrated consequence of activating the existing event system, not a request to reconsider that decision.

### Starting state and scope — VERIFIED

Continued the existing `/workspace/REP-WARS-2-EVENT-ELIGIBILITY` worktree on `fix/backend-natural-event-eligibility`, HEAD `0e69549d03b4f7f50252351a28868b9eaffc7e6d`, parent `7c53bfa52d392a1d37ddb6d1a37935245ca125be`. Before implementation, the only local change was this untracked diagnostic report. All 24 earlier worktrees and 78 inherited dirty files were verified against their saved HEAD/status/SHA-256 inventory. No additional worktree was created. Phase 5B remains separate and unstarted.

### Changes — IMPLEMENTED, not approved for release

| File | Change |
| --- | --- |
| `src/events/EventTriggers.ts` | `candidateTerritoriesForEvents` no longer filters by population; ownership and concurrent-event limit remain intact. |
| `src/constants/balance.ts` | Remove the now-unused `territoryChoiceMinPopulation` constant; no event weights or other numerical settings changed. |
| `src/events/EventDefinitions.ts` | Canonicalize Flood's rounded zero population loss to positive zero. Previously zero population generated `-0` while JSON reload produced `0`, breaking exact canonical replay comparisons. All nonzero losses retain the same equation. |
| `tests/naturalEventEligibility.ts` | 19 new focused regressions using registered-world initialization, actual event engine, canonical persistence, command/CAS and authenticated HTTP infrastructure. |
| `tests/eventEffectPersistence.ts` | Explicitly isolate natural triggering in five existing drought-recurring-effect component tests using the existing per-turn trigger limit, restored in `finally`. All original recurrence, expiry, production and snapshot assertions are retained. The old fixture silently depended on population zero suppressing unrelated events. Full natural-event integration tests remain enabled. |
| `tests/run.ts` | Register the new focused suite. |
| `docs/BACKEND_PHASE5_IMPLEMENTATION.md` | Preserve original audit and append this implementation/evidence/blocker report. |

No initializer, world definition, population field, migration, schema, command identity, clock, AI decision, workout, Unity or public-choice change. Schema remains **32**. Existing active events and persisted history are not reset. The existing rolling cooldown-history retention still expires old rows at its established boundary; this is distinct from resetting history on load. Previously earned production and historical seeded outcomes are not reconstructed or rerolled.

### Event-specific eligibility audit — VERIFIED

Source: `src/events/EventDefinitions.ts::evaluateAllTriggersForTerritory`, `src/events/EventTriggers.ts::{buildTriggerFn,COMMON_ELIGIBILITY,candidateTerritoriesForEvents}`, and `src/events/WorldSimulator.ts::simulate`.

Every current event uses owned territory and absence of an active duplicate of its own type as hard event conditions. Candidate-level concurrency, same-event cooldown and per-turn limits also remain effective. The following are the existing additional **weight/severity factors**, not newly imposed hard requirements:

| Event | Existing factors retained |
| --- | --- |
| Drought | Plains/desert, agricultural Food output |
| Flood | River/coastal terrain |
| Storm | Coastal terrain |
| Harsh Winter | Mountain/hills |
| Resource Discovery | Sparse resource types, mountain/hills |
| Food Shortage | Drought, low/critical faction Food ratio |
| Famine | Food Shortage, critical Food ratio, combined severity |
| Prosperity | High Stability, strong Gold ratio |
| Trade Boom | Coastal terrain, neighbor count |
| Unrest | Low Stability, Famine/Food Shortage, critical severity |
| Rebellion | Active Unrest, critical Stability, combined severity |
| Border Tension | Hostile neighboring ownership |

All currently configured base weights are positive. No current trigger-weight formula multiplies by population, so zero population does not recreate universal exclusion. `COMMON_ELIGIBILITY.populationThreshold` remains available for an explicitly configured event-specific predicate; current catalog triggers do not use it. Population quantities, aggregate-population helper and event population-loss effects remain in place.

**Limitation:** flood in non-river terrain and adverse events without their strongest thematic condition can still have positive weight. This is existing implemented behavior; no new terrain, Food or Stability threshold was invented. Whether stricter hard prerequisites are wanted requires an approved event design, outside this gate-removal correction.

### Reproduction and focused verification — VERIFIED

Before changing production eligibility, the two fresh-world regressions failed: actual candidate arrays were empty for both registered Level 1 and Level 2 with all authored populations zero. Log: `/workspace/phase5a-validation/pre-fix.log` (0 passed, 2 expected failures).

After correction, `/workspace/phase5a-validation/focused-fixed.log` records **46 passed, 0 failed, 0 skipped**: **19 Phase 5A** plus **27 Phase 3** regressions. Coverage includes:

- Registered Level 1/2 event activation without population fabrication.
- Ownership, all 12 active-type duplicate exclusions, concurrent-event cap and cooldown boundary.
- Existing Food upkeep lowering Stability and increasing relevant existing event weights.
- Retained terrain weighting and explicit population-predicate behavior.
- Exact canonical replay for seeds 3, 11 and 29 over 12 event turns with multiple JSON reloads.
- Zero-population schema-32 save compatibility and naturally earned production persistence.
- Online 1.0x and offline 0.1x accrual: 70 earned ticks plus a half-tick remainder; continuous processing versus reloaded 64+6 tick processing gives equal canonical gameplay state.
- Failed persistence rollback/retry, stale CAS conflict, successful receipt replay and authenticated HTTP sync/reconnect without a second write.
- Flood zero-loss serialization and unchanged nonzero loss calculations.

These passing bounded cases are not proof of safe unlimited catch-up. The long-run failures below prevent acceptance.

### Newly exposed long-run blocker — VERIFIED

Existing `Resource Discovery`, `Prosperity` and `Trade Boom` activation consequences permanently multiply territory `resourceOutput`. `src/events/WorldSimulator.ts::ConsequenceApplier.applyDelta` rounds `oldVal * (1 + percentage)` and stores it as canonical production. Their positive Gold modifiers can recur after the normal cooldown. Expiration does not undo already-applied production. Phase 3 correctly preserves that production across reload.

`src/gameplay/economy/accrual.ts::persistTerritoryAccrual` credits produced resources and Golden Yield eligibility through `src/gameplay/economy/production.ts::addResourcesChecked`. This correctly rejects values outside JavaScript's safe-integer range. Activating natural events now exposes repeated compounded production that exceeds that range during long catch-up; execution fails with **`Collection would overflow safe gold storage`**.

The existing persistence regressions hit this failure:

- `three-day and week-long catch-up persist once`
- `several weeks of catch-up does not write per tick`
- `10,000-tick paused catch-up is deterministic and does not keep per-tick history`
- `paused player facing clocks do not expire during offline catch-up`

These use the existing legacy sample-world fixture and actual persistence/catch-up path. Their tick counts are **simulation ticks**, not claims about ordinary player calendar time. They are not disabled or weakened. No production cap, lost-resource clamp, temporary-effect replacement, probability change, new cooldown or artificial time cap has been introduced.

An independent registered-content component probe (`/workspace/phase5a-validation/overflow-probe.cjs`) initializes actual Level 2, seed **11**, without population changes, runs the authoritative event engine and production accrual, and compares continuous state with JSON reloads every 64 ticks. Both paths reach the same overflow at **tick 2,371**; compared canonical snapshots agree, including at failure. Territory `t_07` Gold output grows from authored **1** to **1,253,139** at turn 1,000 and **165,130,229,934** at turn 2,000. These are Gold units per the existing 60-tick production cycle (`ECONOMY_CONFIG.ticksPerProductionCycle`), not bank balances or workout rewards. This controlled component probe omits AI, upkeep and player commands; it is not a simulated player campaign. The four existing integrated catch-up failures independently establish the runtime impact. The original heavier three-seed diagnostic was stopped before producing a result and is not counted as evidence; the completed probe covers one seed.

**Required decision/authorization:** define how repeat production-changing event effects are intended to stack and remain numerically bounded over long play. Current permanent compounding plus repeat eligibility cannot be accepted merely by removing the old gate. `src/gameplay/economy/config.ts` explicitly documents no resource caps beyond safe-integer storage. Choosing finite output limits, noncompounding effects, temporary modifiers or different repetition rules changes gameplay and is not authorized here. Removing the safe-integer guard or silently dropping earned production is not a correct workaround.

### Fixture dependencies — diagnostic only

Five additional older checks fail under newly active natural events: unknown-event fallback isolation; concurrent decision during a long march; Food-cycle source scheduling; blocked development versus military activity; and exact ordinary production/recruitment accounting. A separate diagnostic control sets only the existing natural-trigger limit to zero, runs their unchanged assertions, and restores no production files: **5 passed, 0 failed** (`/workspace/phase5a-validation/fixture-controls.log`). This establishes their dependence on a quiet event fixture, not an acceptance pass under normal configuration. Their assertions have not been removed or weakened. They remain failures in the normal full run, pending explicit component-fixture isolation after the long-run blocker is resolved.

### Validation completion

**Full suite: 2,447 passed, 9 failed, 3 skipped (2,459 registered cases).** Executed as two disjoint, complementary groups; the verification script checked that the filtered cases in each group exactly match the other group's executed cases and that test names do not overlap. This is a failed acceptance run, not a PASS.

| Executed validation | Result |
| --- | --- |
| Full core group | 2,418 passed / 9 failed / 3 skipped; exit 1; 29 cases covered by complementary group |
| Full tutorial/long-renewal group | 29 passed / 0 failed / 0 skipped; exit 0 |
| Phase 1 durable identity | 23 passed |
| Phase 2 tutorial deployed-force | 28 passed |
| Phase 3 event persistence | 27 passed |
| Phase 4 discovery correctness | 12 passed |
| New Phase 5A | 19 passed |
| Focused Phase 3 + 5A execution | 46 passed / 0 failed / 0 skipped |
| Independent long-catch-up reproduction | 0 passed / 4 failures with the exact safe-Gold overflow error |
| Quiet-trigger diagnostic controls (not acceptance) | 5 passed / 0 failed; unchanged assertions |
| Registered-world overflow probe | Seed 11 continuous/reloaded paths fail identically at tick 2,371; probe exits 0 because it asserts that diagnostic outcome |
| Production TypeScript | PASS, zero diagnostics |
| Test-inclusive TypeScript | PASS, zero diagnostics |
| Production build | PASS |
| `git diff --check` | PASS |
| Prior worktree preservation | 24 HEAD/status inventories and 78 dirty-file hashes unchanged |

Full-suite coverage includes the existing event, initialization, economy, simulation, persistence, public retry and earlier phase suites. All eight existing authored-grid scale comparisons pass: 10/30/50 territories at 360 ticks, plus 50 territories at 1,440 ticks, each with seeds 11 and 29. Both legacy AI-only 1,440-tick deterministic replay cases also pass. These are bounded verification results, not evidence that longer event compounding is safe.

The 19 new tests increase the prior registered count from 2,440 to 2,459. With all tests passing the expected pass count would be 2,456; nine normal-configuration failures reduce actual passes to 2,447. Diagnostic reruns and focused suites are not added again to full-suite totals.

The three live Supabase tests remain explicitly skipped: no authorized disposable-environment opt-in/credentials were supplied. No production database was contacted. An earlier incomplete full-core attempt has no final footer and is not included in these totals; the completed rerun provides the core result.

Reproduction commands from this worktree:

```sh
REP_WARS_TEST_PATTERN='^Phase 5A:|^Phase 3:' TS_NODE_TRANSPILE_ONLY=1 npm test
REP_WARS_TEST_PATTERN='^(?!Phase 2:|a long renewal sequence stores one sequence number$)' TS_NODE_TRANSPILE_ONLY=1 npm test
REP_WARS_TEST_PATTERN='^(Phase 2:|a long renewal sequence stores one sequence number$)' TS_NODE_TRANSPILE_ONLY=1 npm test
npm run typecheck
npm run typecheck:tests
npm run build
git diff --check
```

Raw evidence and reproducibility scripts remain outside the repository in `/workspace/phase5a-validation/`. Key files: `pre-fix.log`, `focused-fixed.log`, `full-core-rerun.log`, `full-journeys.log`, `overflow-regressions.log`, `overflow-probe.cjs`, `overflow-probe.log`, `fixture-controls.log`, `typecheck.log`, `typecheck-tests.log`, `build.log`, `verify-final.py`, and `final-verification.json`. A local review archive at `/workspace/phase5a-validation/phase5a-review.tar.gz` preserves the seven candidate repository files and completed evidence. It is not a remote Git checkpoint or deployment artifact.


### Checkpoint and remaining work

No implementation commit or push is made: the full acceptance gates do not pass and publishing this activation as a safe completed subset would conceal the long-run failure. Local HEAD remains the Phase 4 checkpoint above. The candidate changes, regression tests, original report and raw evidence are preserved for review. They are not a production-ready checkpoint.

Phase 5A remains blocked at acceptance. Phase 5 as a whole remains incomplete; Checkpoint B public event choices has not begun. Unsupported internal consequence descriptions, missing approved workout content/ratios/tutorial bindings (Phase 4 PARTIAL), and credential-gated live Supabase verification remain separate limitations. No merge, deployment, protected-branch update or unrelated worktree change.


---

## Checkpoint A — Production Bonus Correction and Final Validation

**Status: VERIFIED — Phase 5A PASS.** The earlier diagnostic and blocked-validation sections above remain historical evidence. This section records the subsequent explicitly authorized temporary/additive positive-bonus policy. It does not authorize Phase 5B.

### Audit and policy compatibility

Verified the existing isolated branch `fix/backend-natural-event-eligibility`, HEAD `0e69549d03b4f7f50252351a28868b9eaffc7e6d`, and all seven preserved Phase 5A candidate files before editing. The previous full failed validation and review archive remain intact under `/workspace/phase5a-validation/`. New evidence is under `/workspace/phase5a-production-validation/`. All 24 earlier worktrees and 78 dirty-file hashes matched preflight. No worktree was recreated or discarded.

The roadmap explicitly deferred broader event-duration policy in Phase 3. Its persistence correction is not a separately locked mandate for permanent positive event compounding. The new authorization supplies that policy. No conflict requiring a different gameplay decision was found.

`Territory.resourceOutput` is the persisted underlying production bundle. Previously, `ConsequenceApplier.applyDelta` directly assigned `round(currentOutput * (1 + percentage))`; the next trigger multiplied that changed value. Resource Discovery, Prosperity and Trade Boom increase Gold, and Flood/Prosperity can increase Food. Activation stores the consequence on an `ActiveEvent`, but expiration previously only changed event status. It did not remove production gains. Drought also has recurring adverse production consequences; those existing penalties are not positive bonuses and are not rebalanced here.

The actual economy uses `effectiveResourceOutput` followed by `productionAccruedBetween` and `persistTerritoryAccrual`. Permanent Farm/Mine/Lumber effects live in `territoryInfrastructure` and multiply matching production separately. The earlier Phase 3 hydrator correction retains authoritative `resourceOutput` instead of replacing it with authored defaults. That behavior is unchanged.

The repeated positive writes caused the prior Level 2 seed-11 overflow at tick 2,371. Before this correction, the new regression `natural discovery leaves underlying production intact` failed with **2 !== 1**, independently confirming that activation modified the persistent basis. See `pre-fix.log` in the new evidence directory.

### Production calculation and lifecycle — IMPLEMENTED

1. New event records carry an optional, versioned `productionBonusPolicy`: `active-v1` or `instant-v1`. The already-persisted `consequences`, `startedTurn`, `expiresTurn`, type and identity hold the terms; no new resource ledger, production balance, timer or parallel GameState was added.
2. The event activation path removes **positive production percentages only** from immediate permanent mutation. Immediate resource windfalls, Stability effects, troop effects and adverse consequences retain their established application. Current production bonuses occur on activation; current recurring and choice effects contain no positive production percentages.
3. `temporaryProductionOutput` derives effective production from stored terms. Different event types add their positive percentages against the same persistent basis. Same-type records do not stack; defensive duplicate input deterministically selects the latest occurrence by start turn then instance ID. Ordinary natural eligibility already excludes an active same-type duplicate.
4. Decimal rational arithmetic with BigInt intermediates combines percentages and performs one half-up rounding. No cap, new balance precision, coefficient, weight or floating-point tolerance is introduced. Unsafe results fail closed under numeric protections.
5. Existing infrastructure multipliers apply after the temporary event-adjusted rate, preserving the prior development order. Gold is not multiplied by developments. Updating the underlying rate or completing infrastructure does not become reversible event state.
6. Active bonuses use the existing event window `[startedTurn, expiresTurn)` and active status. Expiration removes only that record's future contribution. No inverse mutation is applied to the underlying rate or bank.
7. Resource Discovery remains an immediately resolved event with its existing immediate resource grant. Its already-recorded one-turn duration/expiry defines a one-turn production-effect window (`instant-v1`); it is not converted to a new event type or extended with a new waiting period. At expiry it contributes no further production.
8. `runEventEngineTurn` settles the elapsed production interval **before** changing event terms or advancing the event turn. This prevents a new activation or expiry from repricing accrued time since the prior watermark, particularly when a catch-up request ends between ordinary economy cycles. Movement, construction, deadline, event and AI phases are not reordered; clocks and earned targets are unchanged. This is a production boundary settlement inside the existing event adapter, not a new scheduler or upkeep cycle.
9. Expiration never withdraws banked resources or Golden Yield eligibility. Repeated settlement at the same production watermark credits nothing twice. Resource reservations and command/CAS authority remain unchanged.

**Scope precision:** positive event production bonuses are temporary/additive. Existing negative Drought/Storm/Winter production consequences and non-production consequences retain their original rules. This phase does not invent a replacement penalty model, new event probabilities or new event combinations.

### Additional lifecycle defect found during validation

The old chain-ready guard skipped only positive delays. A successful chain stores the existing sentinel `delayRemaining = -999`, but that negative value passed the guard on every later turn. A controlled Drought → Food Shortage reproduction, with the parent already consumed and probability 1, still triggered a child. This duplicates economic consequences and repeatedly expands event state; it is not a balance or probability decision. `WorldSimulator.simulate` now accepts exactly zero as ready. Positive delays still count down, failed rolls remain at zero, and successful chains retain the same consumed sentinel. No probabilities, chain types, delays, expiry order or cooldowns changed. Two focused regressions cover consumed/reloaded and ready/failed/successful paths.

Positive percentage capture also now multiplies authored decimal coefficients through rational intermediates before storing the numeric consequence. This removes binary-product artifacts such as `0.08 × 1.8` becoming `0.14400000000000002`. The existing severity scales and all authored coefficients are unchanged. Stored percentages are summed exactly for the final half-up output calculation. The regression's 30% × 3 example is an arithmetic edge case, not a newly approved severity scale.

An initial long validation run was deliberately stopped to include these confirmed corrections; a later core run was interrupted without a result before resumption. Neither incomplete run is counted as successful full-suite validation. Their logs remain preserved.

### Save compatibility and Phase 3 preservation

Schema remains **32**; no migration or authored-default restoration is performed. The optional event-policy field is preserved by existing canonical cloning/serialization/hydration. New validation rejects unsupported policy tags, invalid windows and nonfinite percentage terms.

A legacy event has no policy field: its historical consequence may already be irreversibly rounded into the saved production rate. That saved rate remains the authoritative persistent baseline and is **not** boosted again from old event history. Banks, historical output, pending events, receipts and previously earned resources are retained. Arbitrarily dividing old output or restoring world JSON could destroy genuine persistent improvements; neither is done. New activations follow the new policy even in a loaded legacy world.

This is forward-reader compatibility, not permission to run an older executable over new-policy saves: an older binary does not interpret the new event tag. Deploy/rollback must use compatible binaries. No deployment is performed here.

An already-inflated historical save near numeric capacity is not silently repaired or compensated. The fix prevents new exponential event growth; it cannot reconstruct a lost historical baseline from the six-turn rolling history. Authoritative saved values remain protected by Phase 3.

### Five fixture repairs — each Category A

All five tests use controlled subsystem fixtures and require the absence of unrelated random consequences to prove their exact assertions. `withoutNewNaturalEvents` scopes the **existing** natural-trigger limit to one synchronous callback and restores it in `finally`. It does not disable existing active effects or expiry. No production setting or global full-suite configuration is changed.

| Test | Classification / why isolation is correct | Assertions retained |
| --- | --- | --- |
| Unknown ActiveEvent does not become Drought | A — unknown-type reducer isolation, not natural occurrence | Exact unchanged target output and no Drought per-turn consequence |
| Another decision initiates during a long march | A — AI concurrency on a fixed military/resource fixture | March remains physical, another operation exists, opportunity and invariants |
| Food-cycle source creation independent of chunk size | A — controlled Food-pressure scheduling component with real clock/catch-up infrastructure | Actual BUILD from the specified shortage and identical pressure/operations/opportunities across schedules |
| Military acts while blocked development stays dormant | A — deliberately unfunded development and military action lanes | Legal military actions, no BUILD, blocked saturated pressure, no invented peace source |
| Automatic production/troop accrual needs no collection | A — exact baseline income and recruitment accounting | Exact Food gain, bank troop quantity and no local-pool grant |

Normal-world, natural-event, long-catch-up and public synchronization acceptance tests **remain event-enabled**. No random seed was changed to avoid a failure. The earlier five Phase 3 recurrence probes remain explicitly isolated for their controlled adverse-event lifecycle; their assertions are retained.

### Additional development integration assertion

The final run also identified an assertion tied to the superseded permanent-compounding representation: `one Farm per territory; events compound on base then Farm multiplies` expected 48 Food output while the natural active bonus correctly produced 55.5 after Farm multiplication. This is **Category B**, a construction/event integration journey. Natural events remain enabled with the same seed. The test now compares identical persistent output and active event terms with and without Farm infrastructure, requires the seeded bonus to remain effective, and verifies Farm multiplication afterward. Duplicate Farm rejection and exact preservation of the manually improved persistent basis remain asserted. Focused production regressions independently verify exact additive bonus arithmetic and permanent improvement behavior. This is additional to the original five Category A repairs.

### Regression inventory

The 19 existing Phase 5A eligibility/persistence/retry cases remain. Twenty-one additional production cases cover:

- Natural discovery no longer writes the underlying rate (pre-fix failure recorded).
- Before/during/after rates; repeated occurrences; additive overlap; duplicate same-type protection; partial expiry.
- Permanent output changes and Farm multiplier retention.
- Earned bank/Golden Yield basis and duplicate watermark settlement.
- Exact JSON round-trip at five active/expired boundaries.
- Legacy baked-in rate preservation without second application.
- Instant Discovery's existing one-turn effect window.
- Settlement of the preceding interval at expiry, without repricing or confiscation.
- Clone isolation and invalid policy/percentage rejection.
- Exact additive arithmetic, half-up rounding and overflow rejection without clamping.
- Authored severity products retain their exact decimal coefficients before final half-up rounding; an arithmetic-only 30% × 3 example is not a new authored severity.
- Consumed event chains cannot trigger again after reload; zero-delay failed probability rolls remain retryable, and a successful chain is consumed exactly once.
- Actual registered Level 2 seed 11 through tick 3,000, comparing continuous execution with JSON reloads every 64 ticks; full canonical equality and invariants at ticks 2,371 and 3,000; underlying Gold rates stay at initial values. No population fixture, cap or resource reset.

The long registered-world case is an event/production component probe using actual production initialization and engine code, not a human campaign or calendar-day claim. Existing full-suite real command/catch-up tests provide the composed runtime proof. Existing online/offline tests separately verify 1.0x/0.1x accrual, half-tick remainders, durable backlog, failed commits, stale writers and replayed public requests with the new stored terms.

### Validation runtime diagnostic

The unchanged legacy multi-day catch-up cases are computationally expensive after natural eligibility is restored. A five-second CPU sample of the disposable long test found 1,335 garbage-collector samples, 541 `cloneConsequenceDelta`, 531 `simulate`, 511 `hasActiveEventOn`, 469 `cloneActiveEvent`, and 353 `effectiveResourceOutput` samples among the leading frames. This is sampled execution attribution, not a benchmark or a percentage of total campaign time. A brief read-only debugger inspection observed turn **9,555** and **50,468** retained event records, confirming forward progress. No canonical value was modified. Both diagnostic clients disconnected immediately afterward.

The engine retains historical event records in `activeEvents`; cloning and scanning costs grow with that collection. This phase neither deletes those records nor redesigns their retention. The sample and scripts remain outside Git under `/workspace/phase5a-production-validation/`. Runtime of these exhaustive tests must not be represented as typical player latency or calendar pacing. The production changes are fixed throughout final validation.

### Validation evidence

Final complementary full-suite execution: **2,477 passed, 0 failed, 3 live Supabase tests skipped; 2,480 registered cases**. The verification script checked disjoint coverage, source hashes and preservation of 24 earlier worktrees / 78 dirty files. Focused run: 72 passed. Phase 1: 23; Phase 2: 28; Phase 3: 27; Phase 4: 12; eligibility: 19; production: 21. Production and test-inclusive TypeScript checks and production build passed, zero diagnostics. Whitespace check passed.

All four formerly overflowing long cases passed with natural events enabled: three-day/week-long catch-up (1,712.6 seconds), two-week catch-up (4,075.8 seconds), 10,000-tick replay (2,508.8 seconds), paused-clock catch-up (1,411.9 seconds). Times are wall seconds under concurrent validation, not gameplay pacing or standalone benchmarks. Core group: 2,444 passed / 0 failed / 3 skipped; long cases: four passes; tutorial/renewal group: 29 passes. Five original quiet-fixture failures and the additional event-enabled Farm assertion are resolved as documented above. Registered Level 2 seed 11 passes tick 2,371 and 3,000 with canonical continuous/reloaded equality. Eight larger-map chunk/reload comparisons and two legacy long replay cases pass.

Evidence remains in `/workspace/phase5a-production-validation/`: `final-verification.json`, `durable-*.log`, exit files, `full-journeys-final.log`, `focused-final.log`, and reviewed build logs. Interrupted runs are not counted. Credentials were unavailable for the three live Supabase tests; none is claimed as passed.

### File inventory

| File | Change |
| --- | --- |
| `src/constants/balance.ts` | Remove obsolete universal population threshold; retain event-specific balance. |
| `src/events/EventTriggers.ts` | Owned territories enter event eligibility regardless of population; caps and per-event conditions retained. |
| `src/events/EventDefinitions.ts` | Canonical zero Flood loss; exact decimal capture of existing positive bonus coefficients. |
| `src/events/EventModel.ts` | Optional versioned production-bonus policy on existing event records. |
| `src/events/productionBonuses.ts` (new) | Separate positive bonuses from persistent mutation; derive additive, nonduplicated, safely rounded output. |
| `src/events/WorldSimulator.ts` | Tag both activation paths, filter temporary bonuses from permanent writes, honor consumed-chain sentinel. |
| `src/gameplay/economy/effectiveOutput.ts` | Derive temporary production before existing infrastructure multipliers. |
| `src/world/eventTick.ts` | Settle prior accrued production before event boundaries. |
| `src/state/gameStateInvariants.ts` | Validate optional bonus policy, window and finite terms. |
| `tests/naturalEventEligibility.ts` (new) | Nineteen eligibility, persistence, clock and public retry/CAS regressions. |
| `tests/eventProductionBonuses.ts` (new) | Twenty-one production, arithmetic, lifecycle and registered-world long-run regressions. |
| `tests/naturalEventFixtures.ts` (new) | Scoped synchronous event-free component fixture with unconditional restoration. |
| `tests/aiRecruitment.ts` | Isolate exact baseline production/recruitment component. |
| `tests/aiStrategicPressure.ts` | Isolate two fixed-pressure components. |
| `tests/aiStrategyConcurrency.ts` | Isolate the long-march concurrency component. |
| `tests/economyDevelopments.ts` | Preserve event-enabled Farm journey; assert temporary-event output before Farm multiplication. |
| `tests/eventEffectPersistence.ts` | Preserve adverse recurrence isolation and assert persistent/effective distinction under new bonus policy. |
| `tests/run.ts` | Register new suites and isolate unknown-event reducer case. |
| `docs/BACKEND_PHASE5_IMPLEMENTATION.md` (new, existing local report extended) | Preserve historical findings and add this implementation/validation checkpoint. |

No world content, workout content, Unity, persistence SQL or database schema file changed. Raw logs and diagnostic scripts are outside the repository, not staged.

### Remaining limitations and checkpoint

Verified on `fix/backend-natural-event-eligibility`, parent `0e69549d03b4f7f50252351a28868b9eaffc7e6d`. This report is included in the containing checkpoint; its exact SHA and push verification are reported after commit. User subsequently authorized preservation and branch consolidation for the personal version.

Schema remains 32; no migration. Remaining limitations: three credential-gated live Supabase checks; retained event history causes expensive long simulations; historical inflated saves are preserved without speculative reconstruction; adverse production penalties retain existing rules; Phase 4 lacks approved content/configuration; public event choices remain Phase 5B, not implemented.

No Phase 5B public event choices, Phase 6, Phase 4 content activation, merge or deployment is part of this work. Phase 5 as a whole remains incomplete until its separately authorized Checkpoint B is implemented.
