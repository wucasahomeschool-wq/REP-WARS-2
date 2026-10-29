# Rep Wars — Backend Remaining Work

Source: `e3f1781f8a53424462fabbd943cc01b0e2725154`; audited 2026-10-29. 23 bounded work items. This is not authorization to implement them.

Priorities follow the requested taxonomy: P0 reliable core gameplay/state loss; P1 feature completion; P2 production readiness; P3 content/balance; P4 optional. “Blocks Unity” means the specified integration slice, not that every Unity task must wait. “YES launch” is not a claim that all work is code. Relative effort is not a time estimate.

First five engineering tasks: **AUD-001 → AUD-002 → AUD-005 → AUD-003 → AUD-004/AUD-006**. Event eligibility needs a bounded product decision; other independent work can proceed. See the roadmap for dependency order.

| ID | Priority | System | Effort | Decision |
|---|---|---|---|---|
| AUD-001 | P0 | Public command idempotency | MEDIUM | NO |
| AUD-002 | P0 | Tutorial and military deployment | MEDIUM | NO for correcting the contradiction |
| AUD-003 | P1 | Workout content activation | MEDIUM | NO new economics; approved content IDs are authoring inputs |
| AUD-004 | P1 | Event eligibility | MEDIUM | YES: event eligibility/population role |
| AUD-005 | P0 | Event persistence | MEDIUM | NO for loss prevention; migration/representation needs engineering review |
| AUD-006 | P1 | Event choices and consequences | MEDIUM | YES only for unsupported consequence replacements/default policy not already defined |
| AUD-007 | P1 | Neutral expansion | MEDIUM | YES: neutral occupation/resistance/cost, if any |
| AUD-008 | P1 | Foreign territory movement | MEDIUM | YES: foreign passage versus hostile entry semantics |
| AUD-009 | P1 | Time domains and rest/protection | LARGE | YES: classify response/protection/recovery/max workout gates and empire-pause behavior |
| AUD-010 | P1 | Player reinforcement/retreat contract | MEDIUM | YES only on intended player force-targeting surface; no new troop source |
| AUD-011 | P1 | Production journey acceptance | MEDIUM | NO |
| AUD-013 | P2 | Production identity and host | MEDIUM | Product/service selection required |
| AUD-014 | P2 | Live Supabase verification | MEDIUM | NO gameplay decision; credentials/access required |
| AUD-015 | P2 | Save rollout and recovery | MEDIUM | Content migration approval where definitions differ |
| AUD-016 | P2 | Database and simulation responsiveness | LARGE | NO gameplay decision; operational SLO/capacity target required |
| AUD-017 | P3 | Exercise/workout content | LARGE | YES: approve content, not a new reward equation |
| AUD-018 | P3 | World content and rewards | LARGE | YES: approved values/content and migration |
| AUD-019 | P3 | AI/military/economy balance | LARGE | YES: final balancing values after evidence |
| AUD-020 | P1 | Unity-facing integration contract | MEDIUM | NO new gameplay rules |
| AUD-021 | P2 | Production operations/security | MEDIUM | Hosting/access approvals; no gameplay decision |
| AUD-022 | P4 | Optional future gameplay | LARGE | YES before future implementation |
| AUD-023 | P4 | Command metadata clarity | SMALL | NO |
| AUD-024 | P4 | History compaction | MEDIUM | NO gameplay decision; retention policy may need approval |

## AUD-001 — Public command idempotency (P0)

Mutating HTTP requests without gameplay-session sequencing bypass receipt replay.

**Evidence:** `src/server/http.ts::commandFromBody`; `src/server/session.ts::execute / committedCommandReplay`; `probes.httpUnsequencedRetry`.

**Impact:** Two identical requestIds deployed 10 troops twice, bank100→80 and two army identities. It spends twice; no free troops demonstrated.

**Smallest viable change:** Require supported durable logical identity for every public mutation, or reject incomplete identity before execution. Reuse current lease/sequence receipt authority. Keep read-only compatibility. Test every exposed mutation, lost response, restart and stale writer.

**Dependencies:** None.

**Product decision:** NO.

**Blocks Unity:** Reliable mutation integration. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-002 — Tutorial and military deployment (P0)

Legal deployment can make the required tutorial attack impossible.

**Evidence:** `src/gameplay/tutorial/level1.ts::assertLevel1TutorialPlayerAttackAllowed / assertLevel1TutorialWorkoutAllowed`; `src/gameplay/military/troopBank.ts::deployBankedTroops`; `crossSystemProbes.tutorialDeployment`.

**Impact:** Bank500 at FIRST_ATTACK_AVAILABLE can all be deployed; tutorial then requires a bank commit, rejects deployed-army attack and another normal workout, and cannot restart a nondefeated world.

**Smallest viable change:** Allow the existing authoritative deployed-army attack path to satisfy tutorial progression and preserve scripted ordering. Do not forbid approved deployment, grant troops, erase the tutorial or add balance changes. Add HTTP journey for partial/all deployment and reload.

**Dependencies:** None.

**Product decision:** NO for correcting the contradiction.

**Blocks Unity:** Onboarding military flow. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-003 — Workout content activation (P1)

No production catalog bootstrap; tutorial is bound to legacy selected workout; selection can advertise a workout that normal start rejects.

**Evidence:** `src/fitness/authoring/registry.ts::installAuthoredWorkoutCatalog`; `src/gameplay/workoutSelection.ts::resolveStartWorkout`; `src/gameplay/workoutStart.ts::lockWorkoutStartReward`; `src/server/production.ts::createProductionHttpServer`; `probes.productionWorkoutStart`.

**Impact:** Fresh players cannot start the promised normal-workout loop. Supplying ratio data alone does not remove the tutorial binding.

**Smallest viable change:** Load and validate an explicit approved catalog in production composition; bind tutorial to authoritative authored workout selection; return truthful availability/configuration errors. Test with clearly labeled fixtures until approved content arrives. Preserve lock/settlement mechanics.

**Dependencies:** AUD-017, AUD-018 for production acceptance.

**Product decision:** NO new economics; approved content IDs are authoring inputs.

**Blocks Unity:** Workout integration. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-004 — Event eligibility (P1)

Fresh authored worlds have population0 but all natural territory event candidates require population≥2000.

**Evidence:** `src/worldDefinition/instantiate.ts::createGameStateFromWorld`; `src/events/EventTriggers.ts::candidateTerritoriesForEvents`; `src/constants/balance.ts::BALANCE.events.world.territoryChoiceMinPopulation`; `arrivalEvents.naturalEvents`.

**Impact:** Food/Stability cannot drive normal world events;100 registered-Level2 event turns triggered0. This is a deterministic eligibility mismatch, not evidence for changing random probabilities.

**Smallest viable change:** Resolve whether population is authored/initialized for events or the eligibility contract must use existing non-population facts. Then integrate/test natural eligible events without inventing a population economy or silent balance values.

**Dependencies:** None.

**Product decision:** YES: event eligibility/population role.

**Blocks Unity:** Event integration. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-005 — Event persistence (P0)

Hydration overwrites event-mutated territory resourceOutput with immutable authored output.

**Evidence:** `src/events/WorldSimulator.ts::ConsequenceApplier.applyDelta`; `src/worldDefinition/instantiate.ts::applyImmutableWorldDefinition`; `src/persistence/hydrate.ts::hydratePersistedPayload`; `crossSystemProbes.eventHydration`.

**Impact:** Seed11 event-eligible Level2 fixture: t_07 Gold output1→2 via Resource Discovery→1 after reload; all invariants pass. Persistent outcomes depend on reload.

**Smallest viable change:** Separate immutable base from canonical runtime consequence or preserve its effective value under an explicit compatibility migration. Add actual event→production→save/reload→continued-production equivalence tests. Preserve authored fingerprint/geography checks.

**Dependencies:** None.

**Product decision:** NO for loss prevention; migration/representation needs engineering review.

**Blocks Unity:** Durable event/economy integration. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-006 — Event choices and consequences (P1)

Choice reducer has no public command/inbox; some advertised consequence fields are explicitly not applied.

**Evidence:** `src/events/WorldSimulator.ts::resolveChoice`; `src/events/EventModel.ts::ConsequenceDelta`; `src/orchestration/publicView.ts::serializePublicGameState`; `src/server/allowlist.ts`.

**Impact:** Player cannot durably inspect and answer an available choice through the production API; some choice narratives promise unsupported effects.

**Smallest viable change:** Expose owned active-event choices and one receipted choice handler using existing reducer; preserve expiry/reload and private data boundary. Map only approved implemented effects or remove unsupported promises. Do not add garrison morale/infrastructure meters.

**Dependencies:** AUD-001, AUD-004, AUD-005.

**Product decision:** YES only for unsupported consequence replacements/default policy not already defined.

**Blocks Unity:** Event UI. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-007 — Neutral expansion (P1)

Valid unowned territories cannot be captured through exposed ATTACK/MOVE.

**Evidence:** `src/army/strategicAttack.ts::startStrategicAttack`; `src/army/movement.ts::progressArmyMovements`; `src/server/allowlist.ts`; `probes.neutralAttack`.

**Impact:** Full occupation of worlds containing neutral land cannot be completed; existing registered worlds are all faction-owned, so this is not their immediate blocker.

**Smallest viable change:** Define minimal neutral occupation/resistance rule, then implement via existing command/physical arrival/ownership transaction. Retain eight proactive actions; no legacy EXPAND resurrection.

**Dependencies:** None.

**Product decision:** YES: neutral occupation/resistance/cost, if any.

**Blocks Unity:** Neutral-world military integration. **Blocks launch:** YES for contracted feature set.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-008 — Foreign territory movement (P1)

Ordinary MOVE allows entry into foreign-owned territory without attack intent or encounter.

**Evidence:** `src/army/movement.ts::beginArmyMovement`; `src/world/ContinuousWorldEngine.ts::advanceArmyMovements`; `arrivalEvents.hostileArrival`.

**Impact:** Actual Level2 MOVE+ADVANCE_WORLD reaches t_07 after2ticks; owner unchanged, no invasion. Hostile transit and attacks are inconsistent unless this passage is intentionally legal.

**Smallest viable change:** Document permitted WAR/PEACE/neutral passage and enforce the approved rule at start and arrival, reusing attack/invasion and movement authority. Do not automatically declare war or invent border tolls.

**Dependencies:** None.

**Product decision:** YES: foreign passage versus hostile entry semantics.

**Blocks Unity:** Military route expectations. **Blocks launch:** YES until policy is consistent.

**Effort:** MEDIUM. **Confidence:** HIGH behavior; policy unresolved.

## AUD-009 — Time domains and rest/protection (P1)

Invasion response, protection and recovery use player-facing simulation ticks, not independently stored real-world deadlines.

**Evidence:** `src/gameplay/config.ts::GAMEPLAY_CONFIG`; `src/gameplay/invasion/eligibility.ts::playerFacingTick`; `src/gameplay/invasion/pause.ts`; `src/gameplay/invasion/progress.ts`; `src/world/timeToTick.ts`.

**Impact:** 30 world minutes become≈300 real minutes wholly offline; pause can freeze/extend gates. Cannot claim all real-world timing doctrine is implemented.

**Smallest viable change:** Approve an explicit gate-by-gate clock-domain/pause table, implement only real-world gates with trusted receipt/deadline identity, migrate active obligations conservatively, test live/offline/catch-up equivalence. Do not globally speed world ticks.

**Dependencies:** None.

**Product decision:** YES: classify response/protection/recovery/max workout gates and empire-pause behavior.

**Blocks Unity:** Accurate deadline/protection UI. **Blocks launch:** YES.

**Effort:** LARGE. **Confidence:** HIGH.

## AUD-010 — Player reinforcement/retreat contract (P1)

AI REINFORCE/RETREAT exist; public DEPLOY creates another force and MOVE is transit. No public existing-army reinforcement route is exposed.

**Evidence:** `src/gameplay/recruitment/reinforcement.ts`; `src/gameplay/military/troopBank.ts::deployBankedTroops`; `src/server/allowlist.ts`; `src/orchestration/handlers.ts`.

**Impact:** Clients cannot assume new deployment means reinforcement of an identified army. Strategic retreat must not be presented as withdrawing from an already resolved battle.

**Smallest viable change:** Publish supported player equivalents. If reinforcement into an existing force is required, expose the existing exact bank-allocation semantics with ownership/claim checks. Do not invent army merging or combat retreat.

**Dependencies:** AUD-001.

**Product decision:** YES only on intended player force-targeting surface; no new troop source.

**Blocks Unity:** Reinforcement/retreat controls. **Blocks launch:** YES for unresolved required interface.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-011 — Production journey acceptance (P1)

Existing tests pass without proving all ten required journeys through authentic production composition/content.

**Evidence:** `tests/level1Production.ts`; `tests/level1Tutorial.ts`; `tests/backendScale.ts`; `tests/gameplayContracts.ts`; `tests/workoutRewardApi.ts`.

**Impact:** Fixture assumptions mask tutorial, event and content activation failures.

**Smallest viable change:** Add deterministic authenticated HTTP journey suite with restarts, actual catalog-loader path and content manifests. Cover no-feedback payout, deployment-before-attack, event choice+reload, neutral occupation, defeat/restart, transition and migration. Keep fixtures labeled.

**Dependencies:** AUD-001–010, AUD-017/018 for production content cohort.

**Product decision:** NO.

**Blocks Unity:** Final integrated acceptance. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-013 — Production identity and host (P2)

Trusted-auth server factory exists; real identity provider/account mapping and deployable composition are absent/unverified.

**Evidence:** `src/server/identity.ts`; `src/server/production.ts::createProductionHttpServer`; `src/server/main.ts`.

**Impact:** Injected test identity does not authenticate real users; development body identity cannot be shipped.

**Smallest viable change:** Select provider/account identity contract; implement verified credential adapter and explicit production host/readiness composition. Reject fallback identity, test token expiry/revocation and cross-account access.

**Dependencies:** None.

**Product decision:** Product/service selection required.

**Blocks Unity:** NO for local integration; YES for real login. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-014 — Live Supabase verification (P2)

Three opt-in live tests were skipped; deployed RPC/RLS/schema/permissions are unverified.

**Evidence:** `src/persistence/supabase/atomicCommit.ts`; `src/persistence/supabase/adapter.ts`; `tests/supabasePersistence.ts`; `tests/atomicCommit.ts`.

**Impact:** Local mocks cannot establish real atomic rollback, stale writer isolation or data-access policy.

**Smallest viable change:** Supply approved disposable non-production database and credentials; apply/review migrations, execute live atomic world/history, CAS, restart and RLS isolation tests. Never use production data for destructive tests.

**Dependencies:** Approved external environment.

**Product decision:** NO gameplay decision; credentials/access required.

**Blocks Unity:** NO for mock/local integration. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-015 — Save rollout and recovery (P2)

Transform fixtures exist, but actual save corpus, deployed compatibility and restore/rollback procedure have not been verified.

**Evidence:** `src/persistence/versioning.ts`; `src/persistence/empireBankMigration.ts::migrateEmpireBanks`; `src/worldDefinition/identity.ts`; `tests/gameplayContracts.ts`.

**Impact:** Schema31 turns historical cargo into recipient bank credit and local pools into banks; old executables cannot safely read new authority.

**Smallest viable change:** Run anonymized approved real-shape corpus through migrate→save→reload; prove no second payouts, review unpinned world content, rehearse backup/restore and version-compatible rollback.

**Dependencies:** AUD-005, AUD-014, AUD-018.

**Product decision:** Content migration approval where definitions differ.

**Blocks Unity:** NO. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-016 — Database and simulation responsiveness (P2)

Synchronous REST child process and synchronous simulation chunks can block the server despite admission limits.

**Evidence:** `src/persistence/supabase/blockingRest.ts`; `src/server/session.ts`; `src/world/ContinuousWorldEngine.ts`; `tests/backendScale.ts`.

**Impact:** spawnSync timeout30s blocks Node; measured one-chunk scale requests reach4.183s. Queue limits alone do not establish health responsiveness or user capacity.

**Smallest viable change:** Measure multi-player latency/fairness on intended host; remove synchronous I/O or isolate workers while preserving per-player transaction/CAS semantics. Set evidence-based capacity/timeout budgets; do not cap earned gameplay time.

**Dependencies:** AUD-014 for real DB measurements.

**Product decision:** NO gameplay decision; operational SLO/capacity target required.

**Blocks Unity:** NO. **Blocks launch:** YES.

**Effort:** LARGE. **Confidence:** HIGH.

## AUD-017 — Exercise/workout content (P3)

Rebuilt production catalog, readiness/prescriptions and three-area mapping are not installed/approved.

**Evidence:** `src/fitness/authoring/`; `src/fitness/progression/`; `src/fitness/personalization/config.ts`; `src/fitness/authoring/registry.ts`.

**Impact:** Old fixture/prototype exercise batches cannot be represented as approved player content or medical safety validation.

**Smallest viable change:** Provide validated authored exercises/workouts with stable versions, explicit SHORT/STANDARD/LONG and movement readiness. Validate compatibility; no universal fitness score, invented catalog or reward overrides.

**Dependencies:** Content authoring.

**Product decision:** YES: approve content, not a new reward equation.

**Blocks Unity:** Production workout UI/content. **Blocks launch:** YES.

**Effort:** LARGE. **Confidence:** HIGH.

## AUD-018 — World content and rewards (P3)

Registered worlds lack approved reward ratios and authored Food values; richer Unity Level1 disagrees with backend Level1.

**Evidence:** `worlds/level-1.json`; `worlds/level-2.json`; `worlds/level-1.authored.json`; `src/worldDefinition/worldConfig.ts`; `src/rewards/completionPolicy.ts`.

**Impact:** Cannot launch new-policy workout rewards with fixture ratios or silently replace a shared world identity; test worlds are not a finished campaign.

**Smallest viable change:** Approve canonical gameplay/visual content revisions, world ratios, Food baseline/upkeep/production and tutorial content. Pin matched exports and a reviewed save transition; preserve100% conquest.

**Dependencies:** AUD-003, Map/content authoring.

**Product decision:** YES: approved values/content and migration.

**Blocks Unity:** Full production world visual/workout acceptance. **Blocks launch:** YES.

**Effort:** LARGE. **Confidence:** HIGH.

## AUD-019 — AI/military/economy balance (P3)

Current bank economy and recruitment have no verified production balance/campaign-completion target.

**Evidence:** `src/constants/recruitment.ts`; `src/gameplay/economy/config.ts`; `src/gameplay/config.ts`; `tests/backendScale.ts`.

**Impact:** Deterministic convergence does not prove sustainable attacks, fair defense, useful recruitment or reasonable workout soldier demand.

**Smallest viable change:** Run approved-content seeded campaign cohorts and repeatable player strategies; report actual battle victories/casualties and attrition, economy, recovery, decision variety. Keep rates provisional until approved, no silent weight tuning.

**Dependencies:** AUD-017, AUD-018, Correctness phases.

**Product decision:** YES: final balancing values after evidence.

**Blocks Unity:** NO for engineering integration. **Blocks launch:** YES for balanced launch.

**Effort:** LARGE. **Confidence:** HIGH.

## AUD-020 — Unity-facing integration contract (P1)

Backend reward/session/backlog contracts have advanced beyond the in-tree demonstration play loop.

**Evidence:** `Unity/Assets/RepWars/RepWarsPlayLoop.cs::FinishWorkout`; `Unity/Assets/RepWars/RepWarsApiClient.cs`; `src/orchestration/publicView.ts`; `tests/workoutRewardApi.ts`.

**Impact:** Auto ABOUT_RIGHT feedback, duplicate animations, stale content and invented client reward expectations must not ship. Latest Windows code was not accessible.

**Smallest viable change:** Audit current Windows code separately, integrate existing backend DTOs/auth/receipts/backlog/reward status and truthful optional feedback without replacing HUD/maps. Publish backend capability/error examples first, run Unity/device acceptance later.

**Dependencies:** AUD-001, AUD-003, AUD-013 for real auth, AUD-018.

**Product decision:** NO new gameplay rules.

**Blocks Unity:** Complete end-to-end client acceptance. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-021 — Production operations/security (P2)

CI definition and readiness hooks exist, but hosted CI, ingress/TLS, monitoring, dependency outages and recovery are not certified.

**Evidence:** `.github/workflows/backend.yml`; `src/server/dependencyBudget.ts`; `src/server/production.ts`; `docs/BACKEND_OPERATIONS.md`.

**Impact:** Passing local tests does not prove an operable release or healthy service under attack/outage.

**Smallest viable change:** Prove hosted CI, secret handling, network exposure, observability/alerts, dependency failure behavior, rate/admission policy and deployment rollback. Record evidence on the actual hosting configuration.

**Dependencies:** AUD-013–016.

**Product decision:** Hosting/access approvals; no gameplay decision.

**Blocks Unity:** NO. **Blocks launch:** YES.

**Effort:** MEDIUM. **Confidence:** HIGH.

## AUD-022 — Optional future gameplay (P4)

Road/market expansion and Self-Learning AI are not completed active mechanics in this checkpoint.

**Evidence:** `src/gameplay/construction/definitions.ts`; `src/server/allowlist.ts`; `src/engine/DecisionEngine.ts`.

**Impact:** Do not call these missing required engines or add them to the current finish line without separate approval.

**Smallest viable change:** Keep as separately scoped future/design work; do not implement during completion fixes.

**Dependencies:** None.

**Product decision:** YES before future implementation.

**Blocks Unity:** NO. **Blocks launch:** NO.

**Effort:** LARGE. **Confidence:** HIGH scope distinction.

## AUD-023 — Command metadata clarity (P4)

GET_COMMAND_INDEX includes internal command metadata while HTTP uses an explicit allowlist.

**Evidence:** `src/orchestration/commandIndex.ts`; `src/server/allowlist.ts`.

**Impact:** Client discovery can advertise calls that will always be rejected; the allowlist still protects execution.

**Smallest viable change:** Label public capability explicitly or project a filtered public index without changing internal registration.

**Dependencies:** None.

**Product decision:** NO.

**Blocks Unity:** NO. **Blocks launch:** NO.

**Effort:** SMALL. **Confidence:** HIGH.

## AUD-024 — History compaction (P4)

Long-lived operations, receipts and audit history need a measured retention strategy if capacity requires it.

**Evidence:** `src/engine/operations.ts`; `src/types/GameState.ts`; `tests/backendScale.ts`.

**Impact:** Larger snapshots make cloning/hydration costly; arbitrary pruning could lose idempotency or reward authority.

**Smallest viable change:** Profile first under AUD-016. Design lossless/safe retention only when justified, retaining stable identities and durable settlement facts. Do not treat compaction as permission to discard history.

**Dependencies:** AUD-016.

**Product decision:** NO gameplay decision; retention policy may need approval.

**Blocks Unity:** NO. **Blocks launch:** CONDITIONAL on capacity evidence.

**Effort:** MEDIUM. **Confidence:** HIGH.
