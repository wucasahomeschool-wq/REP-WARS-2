# REP WARS — Comprehensive Backend Completion Audit

Audit date: 2026-10-29 (America/Denver). Source: `e3f1781f8a53424462fabbd943cc01b0e2725154`, `feat/backend-gameplay-contracts`, schema **31**. This is a documentation-only audit, not a release approval.

## Executive verdict

**The backend is not feature-complete and is not ready for public launch.** Its central architecture and substantial gameplay functionality are real and tested. It does not need a replacement engine. Several required connections between working subsystems are incomplete or incorrect. The normal new-player workout journey also lacks approved production content and a complete content activation path.

Personally executed: **2,347 passed, 0 failed, 3 skipped** in the full backend runner; production TypeScript, test-inclusive TypeScript and build all passed. The three skips require explicitly approved non-production Supabase access. They are not passes. Historical reports of 28 inherited TypeScript diagnostics do **not** describe this checkpoint: the current test-inclusive check is clean.

Independent probes found defects beyond the passing regression suite:

- An identical public deployment request sent twice without gameplay-session sequencing executes twice. It spends troops twice; this is repeated action, not free troop creation.
- At the tutorial's first-attack step, deploying all available banked troops makes existing troops unusable for the required attack and blocks another normal workout. Restart is unavailable because the player is not defeated.
- Every freshly instantiated authored territory has population zero; the event engine excludes populations below 2,000. Registered Level 2 produced **zero natural events over 100 event turns** in the probe.
- In an explicitly event-eligible fixture, Resource Discovery increased territory Gold production from **1 to 2**, but hydrate reset it to **1**. Both states passed invariants.
- Neutral conquest has no current authoritative public path. Ordinary MOVE can arrive in hostile territory without an invasion, occupation or battle; the intended rules for that path need to be made explicit.

These observations are recorded with executable probe source and exact results in [BACKEND_AUDIT_EVIDENCE.json](BACKEND_AUDIT_EVIDENCE.json). No fixes were made.

## Repository identity and preservation

The source checkpoint's parent is `c9473107bbd5281d011480dc3fe3ff1a207c9688`. Audit worktree: `/workspace/REP-WARS-2-COMPLETION-AUDIT`; branch: `audit/backend-completion-20261029`. It was created from the exact source commit with a clean index and tree. All earlier worktrees were inventoried, including hashes of pre-existing dirty/untracked files. Their work is outside this commit.

The source remote was verified as `https://github.com/wucasahomeschool-wq/REP-WARS-2.git`; no newer backend head was found in the inspected remote refs. `REP-WARS-3` still points to `6f38eec6516682e64937b08744a5607f54bbba91`. This audit does not imply the new backend is merged there. The separate AI simulation history is not treated as an additional runtime authority. The Windows Unity checkout and its potentially newer uncommitted work are unavailable; only the Unity code in this source tree was inspected. Do not apply this report as a destructive patch to that worktree.

The ignored dependency symlink uses the existing installed toolchain. Build output is ignored. Temporary probes and logs are under `/tmp/backend-completion-audit/`; probe source, results and log fingerprints are preserved in the audit JSON. No production files, worlds, catalogs, tests, database rows or Unity settings were changed.

## Method and evidence boundaries

Read the handoff and phase reports for navigation, then traced actual source, command registration, HTTP allowlist, persistence mapping and call sites. Ran the unmodified full runner and independent probes. Test fixtures are explicitly distinguished from registered content, and low-level domain probes from real HTTP requests.

`IMPLEMENTED AND VERIFIED` means source plus meaningful local runtime tests, not live-service certification. All status categories are defined in [BACKEND_COMPLETION_MATRIX.md](BACKEND_COMPLETION_MATRIX.md). Work items and priorities are in [BACKEND_REMAINING_WORK.md](BACKEND_REMAINING_WORK.md); implementation order and finish criteria are in [BACKEND_COMPLETION_ROADMAP.md](BACKEND_COMPLETION_ROADMAP.md).

## A. Canonical state and orchestration

**IMPLEMENTED AND VERIFIED, with one boundary gap.** `src/types/GameState.ts` owns schema 31. `src/orchestration/orchestrator.ts::executeAtAuthoritativeReceipt`, `transaction.ts::runStateTransaction`, `state/cloneGameState.ts`, and `state/gameStateInvariants.ts::checkGameStateInvariants` implement canonical draft execution, invariant checking and adoption. `engineRegistry.ts::createDefaultRegistry` connects the battle, AI and event engines. `handlers.ts` and `gameplayCommands.ts` connect strategic and fitness commands to that authority.

CAS is the final persistence serialization boundary; stale worlds are not silently merged. Deferred world processing is durable, not an artificial gameplay cap. Physical operations, claims, Attention, response records and their terminal cleanup are canonical state. There is no need for an AI Director or second GameState.

The public host accepts some state-changing commands without lease/sequence identity. `server/http.ts::commandFromBody` makes those fields optional; `server/session.ts::execute` enters receipt handling only for session-bearing mutations. A requestId alone is not an idempotency key. Existing sequenced retry tests pass but do not close the unsequenced route. **AUD-001**.

## B. Identity, profiles and player-world ownership

**PARTIALLY IMPLEMENTED overall.** `server/identity.ts` supports a trusted authenticator; `server/production.ts::createProductionHttpServer` requires it and dependency readiness. Authentication failures fail closed. `server/main.ts` explicitly requires development identity and refuses production mode. `persistence/initializePlayerWorld.ts::ensurePlayerWorld` keys a world to the authenticated player; `orchestration/authorization.ts` restricts faction-scoped commands.

Permanent fitness, applied reward identity, external workout history and completed-world IDs exist. No separate account/profile service is needed to preserve those records. A production login provider, durable account mapping and executable deployment composition are not supplied by the factory. Cross-account tests use injected identities; real token verification and account lifecycle remain unverified. **AUD-013**. Do not mistake body playerId in local development for a production login implementation.

## C. Worlds, ownership and visibility

**IMPLEMENTED AND VERIFIED for registered world loading, geometry validation and full visibility; PARTIAL for the complete content lifecycle.** `worldDefinition/types.ts`, `parse.ts`, `validate.ts`, `geometry.ts`, `catalog.ts::WorldCatalog`, `instantiate.ts::createGameStateFromWorld`, and `worldConfig.ts` define the runtime input. `gameplay/completion.ts`, `worldTransition.ts`, `worldRestart.ts`, and `anchors.ts::applyPlayerTerritoryLoss` implement completion, guarded transition, last-territory defeat and same-world restart.

Registered content is only:

| Definition | Territories / factions | Starting field forces | Completion |
|---|---:|---|---|
| `worlds/level-1.json` | 3 / 2 | Player 400 soldiers + 40 knights; AI 150 + 20 | 100% control |
| `worlds/level-2.json` | 8 / 3 | Player 400 + 40; each of two AI 500 + 20 | 100% control |

These are code/content values, not approved balance recommendations. Neither file has an approved `workoutRewards` policy. Neither authors the new Food values; compatibility defaults apply. `worlds/level-1.authored.json` shares the Level 1 identity but starts the player with zero troops and the AI with 130 soldiers + 20 knights, and differs visually/geometrically. It must not silently replace the registered definition. **AUD-018**.

Current-world visibility is complete. Known-territory fields remain compatibility data, not scouting gates. Fog-of-war, scouting, PvP and indefinitely simulated conquered worlds are **NOT REQUIRED**. Decorative fog is unaffected.

World fingerprints protect pinned content; old unpinned saves cannot prove what historical content they used. Changing world definitions requires an explicit content-migration review, not a filename substitution. Runtime supports additional completion predicates, but both registered worlds require total control; future production content must retain the locked 100% rule.

## D. Troops, deployment, movement and neutral expansion

**IMPLEMENTED AND VERIFIED for banking, owned deployment, identity and physical transit; PARTIAL for all player military journeys.** `gameplay/military/troopBank.ts::{availableBankedTroops,debitTroopBank,deployBankedTroops}` use playerRewards for the player's existing bank and faction bankedTroops for NPCs. There is no duplicate player bank. Claims prevent double-use; `army/identity.ts::allocateArmyId` is durable and deterministic. Deployment creates a separate force at owned land instantly, not a cross-territory movement or merge.

`army/movement.ts::{beginArmyMovement,progressArmyMovements}` and `world/ContinuousWorldEngine.ts::advanceArmyMovements` govern deployed transit. Strategic ATTACK creates and resolves its own intent. The tutorial still demands a banked commitAmount, so approved deployment can break its required journey (**AUD-002**).

Neutral ownership is representable and validates, but `army/strategicAttack.ts::startStrategicAttack` rejects an unowned target, ordinary MOVE does not occupy it, and legacy MapEngine expansion is not a public authority. Neutral expansion is explicitly in the requested feature contract: **AUD-007**, including a narrow neutral occupation rule decision.

A real MOVE followed by internal authoritative ADVANCE_WORLD put the Level 2 player army in enemy `t_07` after two ticks, with no attackIntent, invasion or battle. This is confirmed behavior; it does not prove a particular war/passage rule was approved. Define and enforce the distinction between transit and hostile entry (**AUD-008**).

AI REINFORCE can allocate bank troops to an exact destination through existing plans. Player DEPLOY creates another force; it does not reinforce/merge an existing army. RETREAT is an AI strategic action, not a battlefield withdrawal mechanic. The public contract must state the supported player equivalents or finish the missing narrow route (**AUD-010**); do not invent merging or change loser-elimination combat.

## E. Battles and invasions

**IMPLEMENTED AND VERIFIED in local tests.** `battle/BattleEngine.ts`, `battle/CombatPower.ts`, `orchestration/applyBattle.ts`, `army/strategicAttack.ts`, and `gameplay/invasion/` provide deterministic combat, terrain/composition/morale/quality/fortification modifiers, occupation and player response windows. Backend seed authority, temporary defense power accounting, durable army IDs and failed-operation cleanup are exercised by C1–C3 and later tests.

No evidence here supports changing combat equations. AI-versus-AI immediate resolution and player invasion/defense routes exist. Failed exact targets in simulation are distinguished from engine faults and must release claims and Attention once. Quantitative fairness, strategic attrition and replacement rates are not certified by these tests (**AUD-019**).

`gameplay/config.ts` and `invasion/{eligibility,pause,progress}.ts` still express protection/response/recovery in world ticks. A 30-tick response window is about 300 real minutes under uninterrupted 0.1× offline accrual (ignoring pause and processing lag), not 30 real minutes. This is calculated from code, not a timed experiment. Which gates are real-world deadlines needs explicit mapping and migration; a single global clock multiplier is not the answer (**AUD-009**).

## F. Economy, Food and Golden Yield

**IMPLEMENTED AND VERIFIED at the domain/transaction boundary; event integration is incomplete.** `gameplay/economy/accrual.ts::persistTerritoryAccrual` automatically credits faction resource banks with a durable production watermark. `production.ts` enforces checked quantities; `trade/resources.ts` makes spending reservation-aware. No resource transport is required by schema-31 gameplay.

`foodConsumption.ts::{empireFoodDemand,consumeEmpireFood}` applies empire baseline + owned authored upkeep, excluding inactive landless factions. It consumes available bank Food and reduces Stability for failed cycles. It does not charge armies, kill troops or apply a global low-Food production nerf. Existing defaults: 60-tick production/upkeep cycle, fallback one Food per territory, baseline zero, Stability penalty two per failed cycle; Level 1 remains upkeep-gated. These are provisional compatible constants in `economy/config.ts`, not final balance. Live/chunk equivalence and reserved Food behavior are tested.

`economy/collect.ts::collectTerritoryYield` credits only `floor(eligible production × stored multiplier) − eligible production`; normal yield is already banked. Collection clears the eligibility basis and consumes the effect once. Ownership change clears old eligibility. Old cargo and unbanked yield migrate once under `persistence/empireBankMigration.ts`. This satisfies the user's latest two explicit compatibility decisions.

Food→Stability is wired. Stability/Food→natural events currently stalls on zero population (**AUD-004**). Do not call that entire chain complete merely because upkeep tests pass.

## G. Construction and development

**IMPLEMENTED AND VERIFIED for CITY, FORTIFICATION, FARM, MINE and LUMBER.** `gameplay/construction/definitions.ts`, `construction/`, `cities/`, `construction/complete.ts` and `gameplay/config.ts` connect costs, resource reservations, one construction slot, timers, completion and acceleration. Farm/Mine/Lumber use the existing 1.5 matching-output factor; zero authored output stays zero. City and fortification effects enter combat; completed cities influence the existing provisional NPC recruitment rate.

Ownership-loss cleanup and exact BUILD plans are tested. Roads and markets are not active production mechanics; the contract says roads “where supported.” They are future/design work, not a reason to fabricate costs or mark the working construction engine missing (**AUD-022**).

## H. AI Decision Engine

**IMPLEMENTED AND VERIFIED for architecture and tested execution; behavior/balance NOT fully verified.** `engine/DecisionEngine.ts`, `strategicPressure.ts`, `proactiveCognition.ts`, `nonProactiveCognition.ts`, `decisionOpportunities.ts`, `operations.ts`, `strategicAttention.ts`, `responseRecords.ts`, `cognition/`, and `types/AIConcretePlan.ts` implement the eight actions, five pressures, seven factual evaluators, exact plans, ownership and response lanes.

NPC recruitment in `gameplay/recruitment/recruitment.ts::progressRecruitment` accumulates deterministic simulation work per owned territory into the faction bank. Existing base/city rates remain provisional; there is no Food recruitment charge or player passive grant. NPC REINFORCE uses that same bank and the existing decision/claim lifecycle. Landless eliminated factions stop recruitment and decisions. No second deployment controller was added.

The current strategic-access and declined-Trade context fixes are integrated. Historical alternative AI-SIM policies must not be silently grafted onto this line. New empire-bank economics invalidate old balance conclusions; eight current load scenarios establish determinism and bounded progress, not sustainable strategy or human conquest difficulty. The 16 archived AI-SIM configurations were **not** rerun here. No measured overall attacker win rate or ten-day player campaign is claimed.

## I. Peace and Trade

**IMPLEMENTED AND VERIFIED in the current bank model.** `gameplay/diplomacy/relationships.ts`, the Peace modules and `gameplay/trade/trade.ts::{beginTradeProposal,acceptanceProblem,settleTradeProposal}` implement default WAR, proposals, response timers, hostility clearance, peace, exact requested/offered terms, reservations and terminal cleanup. Trade remains legal in WAR. ACCEPT applies both bank deltas atomically; recipient resources are not reserved merely because an offer is pending.

Historical shipment structures remain for migration/history compatibility. Runtime `progressTradeShipments` rejects unconverted live cargo; new trades create no physical shipment. This is intentional removal of superseded logistics, not a missing system. Counters, withdrawal, rejection and invalidation have command paths. Exact declined offers may requalify when relevant context changes; no forced acceptance is required.

## J. World and imperial events

**PARTIALLY IMPLEMENTED.** `events/EventDefinitions.ts`, `EventTriggers.ts`, `WorldSimulator.ts` and `world/eventTick.ts::runEventEngineTurn` form a real seeded engine with event lifecycles, severity, chains, cooldowns, history and consequences. It is invoked by world advancement.

Three concrete integration failures remain:

1. `instantiate.ts` initializes population zero; `EventTriggers.ts::candidateTerritoriesForEvents` requires at least 2,000. No normal population initializer/growth route makes fresh worlds eligible (**AUD-004**).
2. `WorldSimulator` mutates `territory.resourceOutput`; `persistence/hydrate.ts::hydratePersistedPayload` invokes `applyImmutableWorldDefinition`, which overwrites that output with authored base values. Seed 11 Resource Discovery loss was reproduced (**AUD-005**). Persist runtime modifiers separately from immutable base, or preserve the canonical effective output under a reviewed contract; do not overwrite geography to fix it.
3. `WorldSimulator.resolveChoice` is called by tests/simulation, not a public command handler. Public state exposes an active-event count, not a durable player choice inbox. `EventModel.ts` explicitly marks garrison morale and infrastructure percentage deltas unapplied (**AUD-006**). Finish owned, validated choice handling and truthful supported consequences; do not invent new stats.

“Rebellion” exists as an event, not as a verified territory-secession system. No requirement to invent secession coefficients is inferred.

## K. Fitness and exercise progression

**PARTIALLY IMPLEMENTED / BLOCKED BY CONTENT.** `fitness/session/`, `fitness/evaluation/`, `fitness/personalization/`, `fitness/progression/`, `fitness/authoring/{structural,semantic,compile,registry}.ts` implement prescriptions, measured completion, readiness, progression evidence and authored catalog compilation. Permanent fitness is separate from expendable military losses.

There is a legacy overall estimate/personalization path and an authored movement-readiness path. `fitness/personalization/config.ts` does not enable body-section levels as the production personalization mode. The rebuilt Upper Body/Core/Lower Body content cannot be assumed installed merely because compatible authoring types exist. Validate its mapping and readiness behavior against real approved content; do not invent a universal exercise score (**AUD-017**).

`authoring/registry.ts` starts with no installed catalog; server composition does not load one. Tutorial selection hardcodes the legacy selected workout. This is an engineering activation/binding task distinct from writing new workout content (**AUD-003**).

## L. Workout completion and rewards

**IMPLEMENTED AND VERIFIED for locked rewards with valid authored fixtures; production entry is BLOCKED.** `src/rewards/completionPolicy.ts` (see source inventory in evidence), `gameplay/workoutStart.ts::lockWorkoutStartReward`, `rewards/application/apply.ts`, `rewards/pipeline/settleLockedWorkout.ts`, `fitness/history/`, `orchestration/gameplayCommands.ts` and the Supabase atomic coordinator provide start locks, half-up fixed-point conversion, full-completion settlement, applied identity, bank credit and durable history.

SHORT/STANDARD/LONG use 60/100/145 units, with an authored ratio; no invented production ratio or readiness/feedback soldier multiplier. Legacy sessions and specialized defense/construction/Golden Yield effects remain distinct. Feedback may follow payment; late evidence is preserved without paying again. Active or unpaid obligations block transition/restart; abandoned terminal sessions do not permanently block them.

The actual fresh-world HTTP probe returned a legacy workout from GET_WORKOUT_SELECTION, then rejected START_WORKOUT with WORKOUT_CONFIGURATION_UNAVAILABLE. Both registered worlds lack approved policies and there is no production catalog loader. A passing fixture reward test is not a complete player onboarding journey. **AUD-003, AUD-017, AUD-018**.

## M. Rest, protection and comeback

**IMPLEMENTED BUT NOT FULLY VERIFIED against final time-domain policy.** Workout pause/resume, rest steps, abandonment, defense protection/recovery and empire pause exist in `fitness/session/`, `gameplay/invasion/` and `gameplay/config.ts`. Defeat/restart preserves permanent fitness and paid identities. No mandatory daily workout or streak is needed for strategic commands.

Protection and pause currently operate on player-facing world ticks. Do not advertise the current constants as real-clock guarantees. Clarify gate clock domains, permitted actions during empire pause and intended comeback presentation before changing them (**AUD-009**). Do not add hunger meters, compulsory workouts or invented recovery rewards.

## N. Time, offline processing and determinism

**IMPLEMENTED AND VERIFIED for accrual, backlog and tested ordering; NOT universally complete.** `world/realtimeClock.ts`, `worldAccrual.ts`, `presenceLeases.ts`, `timeToTick.ts`, `temporalBoundaries.ts`, `ContinuousWorldEngine.ts`, and `server/session.ts` separate earned target from processed worldTick and use server-authoritative presence. Baseline is one simulation minute; online 1.0× and offline 0.1× use exact fixed-point arithmetic. Independent cognition timers preserve promotion rules. Completion/invalidation/deadline/world-event/observation ordering is explicit.

Catch-up budgets yield with durable backlog and resumable commands instead of deleting time. Eight grid cases matched whole/sliced snapshots, and two legacy seeds replayed identically. They do not cover event production modifiers in ordinary authored worlds because those worlds start event-ineligible. AUD-005 is a concrete exception to any blanket save/live equivalence claim; AUD-009 is the time-domain policy gap.

## O. Persistence, migration and concurrency

**IMPLEMENTED AND VERIFIED locally; live infrastructure UNVERIFIED.** `persistence/{snapshot,serialization,hydrate,versioning}.ts`, `supabase/{adapter,mapper,atomicCommit,commandHistoryBuffer}.ts`, SQL migrations, and session receipts implement round trips, schema transforms, optimistic versions and atomic world/workout history. Schema 30→31 credits undelivered agreed cargo once, banks existing yields once, migrates local troop reserves conservatively, releases obsolete reinforcement claims and retains old plan history. It does not fabricate past workout rewards or trophies.

Source migration tests, real-shape fixtures and command failure/retry tests pass. No real production save corpus, backup/restore or live RPC/RLS has been exercised in this audit. Event output reset is a real hydration correctness issue, not a failed CAS implementation. General public retries remain incomplete without required receipts.

## P. API and Unity integration

**Backend supports meaningful local integration now; complete production play loop is PARTIAL.** `server/http.ts`, `allowlist.ts`, `orchestration/protocol.ts`, `publicView.ts`, command handlers and reward API tests expose world/session, movement, deployment, build, diplomacy and workout routes. Locked reward presentation/reconnect fields are server-owned. HTTP error projection and non-executing diagnostic handling are tested; internal AI state must stay private even though the map is fully visible.

In-tree `Unity/Assets/RepWars/{RepWarsApiClient,RepWarsSessionDriver,RepWarsGameplaySession,RepWarsPlayLoop}.cs` is not evidence of the latest Windows checkout. `RepWarsPlayLoop.FinishWorkout` can auto-submit ABOUT_RIGHT feedback before finalize. That is not the new optional-feedback interaction. Integration must handle auth, lease/sequence receipts, pending catch-up, promised versus settled rewards, late real feedback, bonus-only collection and world-content identity (**AUD-020**). No Unity edits or execution occurred here.

GET_COMMAND_INDEX returns internal command metadata as well as exposed routes; the HTTP allowlist still blocks those internal calls. This is a client-contract clarity issue, not an execution bypass (**AUD-023**).

## Q. Security and production operations

**PARTIALLY IMPLEMENTED.** Trusted auth composition, request/body checks, fail-closed readiness, bounded admissions/dependency waits/cache, privacy-safe errors, CAS and CI definitions exist. Full tests cover malformed responses, proxy/serialization hooks, stale state and injected dependency failures.

A production login adapter/host composition, live Supabase validation, deployment TLS/ingress/secrets controls, backup/restore, monitoring/alerts and hosted CI proof remain release work (**AUD-013–016**). `.github/workflows/backend.yml` is an implemented CI definition, not proof of a hosted run.

`persistence/supabase/blockingRest.ts` uses spawnSync with a 30-second timeout. One database call can block the Node event loop, including unrelated requests and health responses. Catch-up also has synchronous CPU chunks; queue limits do not preempt that work. Measure and resolve deployment capacity/worker isolation with representative load, preserving serial per-player state (**AUD-016**). Unbounded canonical histories merit capacity testing; safe compaction must never prune payment or idempotency authority by convenience (**AUD-024**).

## End-to-end gameplay journeys

| Journey | Verified path and limitation | Verdict |
|---|---|---|
| 1. New player | Auth-injected initialization/session/world snapshot works; default selection advertises legacy workout and normal start fails. Real login absent. | PARTIAL; AUD-003/013/017/018 |
| 2. Workout → conquest | Fixture R1 start/progress/finalize/bank and battle paths pass. Production content unavailable; deploying bank first can dead-end tutorial. | PARTIAL; AUD-002/003 |
| 3. Empire development | Automatic banks, owned deployment, builds, acceleration, Food and Golden bonus tests pass. Event effects/choices break complete loop. | PARTIAL; AUD-004–006 |
| 4. AI lifecycle | Seeded observation/pressure/plan/claim/execute/complete, bank recruitment and response lanes run in scale tests. Strategy quality not certified. | VERIFIED mechanism; behavior review pending |
| 5. Invasion defense | C1/C3, fresh defense session, response/settlement/cleanup tests pass. Real-clock interpretation unresolved. | PARTIAL time contract; AUD-009 |
| 6. Offline return | Leases, exact accrual, bounded durable backlog, receipt resume and grid reload equivalence pass. Event modifiers do not survive hydration. | PARTIAL; AUD-005/009 |
| 7. Peace/Trade | Existing proposal/response/clearance and new atomic exchange, reservations, migrated cargo tests pass. | IMPLEMENTED AND VERIFIED locally |
| 8. Victory | Registered 100% completion, one-time trophy, guarded transition to Level 2 tests pass; no registered Level 3. No full production human campaign executed. | VERIFIED transitions; content-limited |
| 9. Defeat/restart | Last-owned-territory defeat, stopped attempt, same-world reset, preserved fitness/paid identities/receipts pass. | IMPLEMENTED AND VERIFIED locally |
| 10. Save migration | Migration fixtures/round trips/CAS failures tested; production corpus/live DB not tested; event field loss reproduced. | PARTIAL; AUD-005/014/015 |

## Test quality and measured simulations

The full runner includes C1–C3, R1-C–F, AI A–L, economy, event engine, world/session, privacy, migration, orchestration and newer gameplay contracts. This audit did not independently recount a historical “837 A–L” subtotal; only the current actual full total is asserted. No tests were deleted, edited or replaced. The preceding gameplay-contract report recorded 2,340 passes because seven supplemental migration/CAS tests were added while that run was already executing; it separately recorded 42 focused passes and 2,347 unique passes. This audit loaded the complete final source before running, and all 2,347 passed in the single full run.

Good coverage includes exact plan reservations, partial persistence failure, known receipt replay, forged entitlement terms, HTTP serialized privacy, response ownership and world-bank migrations. Important blind spots: fixtures install approved-looking catalogs and ratios; legacy tests have population; new world tests do not; retry tests supply sequences; deployment and tutorial tests did not compose the new flow. Auth/database fakes cannot certify deployed identity or database policy. Invariants do not detect all semantic losses (the event reload probe passed them).

Current measured grid runs (Linux x86_64, Node 24.19.0; five visible CPUs; shared process, not a capacity benchmark):

| Territories / AI | Seed | Earned ticks | Whole / sliced seconds | Final operations | Successful ATTACK resolutions | Canonical bytes |
|---|---:|---:|---:|---:|---:|---:|
| 10 / 3 | 11 | 360 | 2.059 / 2.011 | 19 | 9 | 117,087 |
| 10 / 3 | 29 | 360 | 0.292 / 0.406 | 17 | 10 | 146,471 |
| 30 / 5 | 11 | 360 | 1.258 / 1.262 | 42 | 31 | 377,734 |
| 30 / 5 | 29 | 360 | 0.896 / 1.025 | 49 | 45 | 433,788 |
| 50 / 8 | 11 | 360 | 11.621 / 12.209 | 205 | 144 | 1,131,812 |
| 50 / 8 | 29 | 360 | 2.232 / 2.259 | 82 | 59 | 646,355 |
| 50 / 8 | 11 | 1440 | 36.383 / 39.331 | 208 | 144 | 1,134,912 |
| 50 / 8 | 29 | 1440 | 2.014 / 2.807 | 82 | 59 | 646,358 |

All eight whole/sliced canonical hashes matched; Food failure counters were zero in these fixtures. These are six or 24 **simulation hours of explicit online-earned time**, not calendar-player schedules. Defeat stops an attempt, so a 1,440-tick target does not imply continuous active campaigning for 24 hours. Successful ATTACK resolutions are not an attacker battle-win rate. Largest measured one-chunk request was 4.183 seconds; generous-budget request reached 36.322 seconds. Process RSS reached 1,228 MiB across the full suite; it is not isolated per-world memory usage. Full measurements and hashes are in evidence.

Two legacy AI-only seeds (11,29), each replayed twice for 1,440 ticks, matched canonical hashes. They are legacy fixtures, not the registered production campaign. No Unity, real auth, live DB, human strategy campaign or medical/exercise safety validation is claimed.

## Completion dimensions and finish line

- **Core engines:** substantial and integrated; do not rewrite them. Specific event/persistence and public command gaps remain.
- **Gameplay features:** not complete. Required neutral expansion and complete event interaction are absent; tutorial/deployment conflict prevents a legal journey.
- **Content:** not production-complete. Approved exercise/workout library, world ratios and coherent Level 1 source are missing.
- **Unity integration:** local meaningful integration can begin now in the existing project. Finished/authenticated workout play loop requires the contract work listed above.
- **Production readiness:** not complete. Provider, live atomic persistence/RLS, restore, deployment and capacity evidence remain.
- **Balance:** provisional. Passing deterministic tests do not establish fair military attrition, Food distribution, workout demand or conquest duration.

## Direct final answers

1. **Feature-complete? No.** Close the P0/P1 register and approved-content activation path first.
2. **All engines connected? No.** Core battle/AI/economy/fitness paths are connected, but event eligibility, choices and durable effects are not fully connected, and production workout activation is incomplete.
3. **Full playable world? Fixture/test journeys exist; a complete production-configured player campaign is not demonstrated and fresh normal workout start currently fails.**
4. **Unity meaningful integration now? Yes**, against isolated authenticated-test/dev hosts for defined routes. Not production acceptance, and no unsafe overwrite of the Windows worktree.
5. **Top five engineering tasks:** AUD-001 universal mutation identity; AUD-002 tutorial/deployment recovery; AUD-005 durable event effects; AUD-003 content bootstrap/tutorial binding; AUD-004/006 usable event lifecycle.
6. **Whole missing systems?** No replacement engine is needed. Public event-choice delivery, neutral occupation, and production identity/host composition are missing integration capabilities. Roads/markets/self-learning are not newly required systems.
7. **Feature finish checklist:** resolve P0/P1 issues, activate approved content without changing reward economics, prove all ten journeys through authenticated HTTP/restart, and publish an accurate client contract.
8. **Launch checklist separately:** approved balance/content, live SQL/RLS/CAS/atomicity/restore, login mapping, TLS/secrets/ingress, hosted CI, observability and measured capacity; Unity/device acceptance.
9. **Genuine decisions:** event eligibility without inventing population, neutral occupation/pass-through policy, time-domain/pause rules, production identity provider, approved content and provisional balance values. See the exact bounded questions in the roadmap.
10. **Astra first:** AUD-001, a narrow public-command identity/receipt enforcement phase using the existing durable receipt authority. Prove unsequenced rejection plus sequenced lost-response/restart/CAS behavior. Do not build a second ledger. AUD-002 can follow independently.

No gameplay implementation is authorized by this audit. Stop for review of the roadmap.
