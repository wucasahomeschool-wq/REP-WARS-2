# Phase E — source-bound pressure and proactive timing

Product authority: `REP_WARS_AI_Decision_Engine_Source_of_Truth_v1.0.md`. This document records implementation; it does not replace product rules. Parent checkpoint: `49cc525f8db0cedab75567241b9e85fa3b309b18`. Schema: **21**. Phase F and push are not authorized. The subsequent independent-review request authorizes a local checkpoint only after review and validation pass.

## Canonical authority

`GameState.aiPressure` holds bounded source-specific pressure, semantic references, material revision, and complete candidate blocker predicates. `aiDecisionOpportunities` owns the one primary source-bound deliberation/initiation thread, exact sampled timers, opportunity identity, and reconsideration spacing. `aiClock` carries the temporal processing cursor and the existing rated-world projection anchor. This is not a second world simulation or external timer database. Operations, claims, Attention and physical domains retain their Phase C/D authority.

The five domains are exactly MILITARY_INITIATIVE, FORCE_POSITIONING, DEVELOPMENT, DIPLOMACY_PEACE, TRADE_ECONOMIC. Pressure chooses a context, never modifies an action score. Current legacy plan scoring/Goals are retained; pressure is not passed as a score contribution. Memory is not read by pressure. Matching unfinished Goals may amplify an already-existing source.

Source IDs encode the exact faction, domain, kind, subject, counterparty and project type using JSON arrays and code-unit ordering. Magnitude changes retain IDs. Ownership/type transformation creates a different identity. Facts are always read from the current canonical state; no troop/resource snapshots are authoritative. Material revision distinguishes stale WAIT completion from mere prerequisite loss. Deliberation refreshes magnitude facts at completion rather than freezing an earlier world snapshot.

## Source families and finite scopes

* Hostile offensive opportunity: valuable hostile-owned land, credible current relative force strength, and immediate/one-owned-staging-hop access. Every exact local ATTACK and direct staging MOVE is probed/generated, with no heuristic target pruning. There is no global empire-wide action competition.
* Coverage gap: threatened friendly ground without a local friendly force, with adjacent support. MOVE must not create a worse unsupported exposure at its origin.
* Exposed force: a particular force on hostile ground; every adjacent friendly fallback RETREAT is considered. Idleness, safe neutral ground and force availability alone are not pressure sources.
* Productive development: missing matching production development plus an actual resource need relative to existing authored construction costs or Food upkeep. One exact site/type BUILD predicate per source.
* Frontier development: actual neighboring hostile field strength and a missing city or legal fortification. City and fortification remain distinct site/type contexts.
* War burden: actual WAR, low Stability and an exposed border against current opposing field strength. WAR duration alone is not a source. OFFER_PEACE remains unavailable.
* Resource exchange: actual need plus known counterparty holdings and a complementary resource position. No hostile-partner exclusion. TRADE remains unavailable.

**Neutral acquisition is not fabricated.** Current MOVE changes army location, not land ownership; current ATTACK rejects ownerless land. A legally acquirable neutral source cannot truthfully be generated until a domain mechanic supports it. This is a domain integration dependency, not a new EXPAND action. Recruitment pools and other unsupported source families remain deferred.

An operation actually addressing this exact source suppresses duplicate source plans and incremental urgency while it progresses. The source and its existing pressure remain; no construction/travel/conquest result is invented. Unrelated sources continue accumulating normally.

## Observation, blockers, outcomes

The observer runs at canonical world/material boundaries and authoritative AI timer/lease boundaries. It derives causes and performs finite hard-prerequisite probes, with no scorer, selection RNG, future battle RNG or broad future evaluation. The same source-specific predicate enumerator is shared with candidate generation to prevent mismatched scopes. Unchanged dormant blocker plans are reused only when all freshly derived exact parameters match; current legality/claims/compatibility/Attention are still rechecked. No feasibility or world fact is cached. There is no full deliberation every second or every world tick.

A context needs at least one meaningful legal non-WAIT plan. Complete alternative predicates are ORed; each plan requires all its legality, claim, compatibility and Attention conditions. Blockers preserve distinct Phase D rejection layers. Threshold checks use current troop minima, complete authored build bundles, real force/route state, actual protection/cooldown and capacity. Small incomplete restorations do not rearm. Unsupported lifecycles and fully addressed contexts carry explicit unavailable reasons. `NO_ACTIONABLE_PLAN` is canonical dormant blocker state, not an action, WAIT, reward, relief or spacing.

Full cognition starts only for the highest-pressure ready actionable context (stable ID ties). The completed timer reobserves current canonical facts, generates its exact plans, and uses existing bounded near-top seeded selection. Selection RNG includes persisted opportunity identity. Source disappearance yields CONTEXT_INVALIDATED, never fallback WAIT. Eliminated factions stop accumulating pressure/starting cognition; physical operation progress remains independent.

## Tuning versus locked time

All starting pressure values are in `src/constants/strategicPressure.ts`, clearly marked **INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN**:

* saturation 100,000 units; readiness 10,000;
* base accrual 100 units per online second;
* matching Goal multiplier 1.25;
* relevant successful physical initiation relief 8,000; valid WAIT relief 3,000;
* provisional credible force fraction 3/4.

Pressure uses exact rational carry at ONLINE 1 / OFFLINE 1/50. It follows persisted authoritative presence intervals and elapsed simulation processing time, not process speed. The existing physical world rate remains 1 / 1/10; pressure is not double-scaled by that world rate.

Existing `timeToTick` fixed-point algebra now supports action-specific rational normalized duration clocks. Existing Temporal V2 projection preserves those fields. New durations sample once in canonical whole seconds with SeededRNG and persisted sequence; existing persisted timers never reroll; progress/rate/carry survive reload. OFFLINE→ONLINE promotes; logout never demotes earned activity rate. Pressure itself uses actual presence, without activity promotion.

Routine development deliberation is 6–10s / 300–500s; standard positioning 12–20 / 600–1000; major military 25–40 / 1500–2400. Required/reactive/recovery scheduling is not implemented. Reconsideration is 45–75s / 4500–7500, sampled once after **successful initiation**, never physical completion. All four physical action initiation delays remain zero.

WAIT owns a primary initiation timer **2s / 60s**, no physical operation, claim or Attention. It grants no troops, income or resources and does not advance physical world time. At completion, lightweight canonical probes distinguish disappearance, material transformation, loss of all non-WAIT alternatives and valid completion. Only valid completion earns moderate relevant relief and starts spacing. Completion does not rescore or draw a second selection RNG. Failed physical start gives no relief/spacing and retains atomic domain rollback. Existing compatibility DTO selection IDs may leave gaps in the operation sequence; no WAIT operation is stored.

## Authoritative boundaries and receipt integration

ContinuousWorldEngine uses the existing world-boundary/presence algebra to interleave sub-tick AI boundaries with physical world processing. The obsolete unscoped tick-cadence cognition fallback is removed. Physical movement/construction/battle durations and domain mathematics are unchanged. Explicit tick fixtures have a deterministic virtual OFFLINE clock inverse to the existing world rate; production attaches UTC through trusted server receipts.

Mutating server commands process already-earned world/AI boundaries in the same cloned command transaction before applying newly observed command effects. A command-scoped time authority derives its target from canonical earned world time; client timestamps cannot supply it. CAS remains the final commit. Command retries/replays do not reroll timers. Read-only commands remain non-mutating. Lease receipts can progress AI timers when there is no physical backlog; an existing backlog is ordered through the normal SYNC/catch-up path. Session renewal/replay/history buffering retain existing ownership.

## Migration, privacy and performance

Schema 20→21 preserves all physical operations, claims, Attention and ID high-water marks. Contextless unstarted historical selections and fake active WAIT records are archived without invented source identity, timers or duplicated outcome feedback. No physical travel/construction/invasion is cancelled. The current receipt watermark anchors new cognition; old physical backlog is processed before new AI time, without fabricated historic cognition. Schema 21 requires pressure/clock storage and validates nested source, primary and timer state. Clone/hydrate isolate plans, blockers and clocks.

Private pressure, source predicates, timers and deliberation are not added to public/Unity state. Existing operation diagnostics remain inspectable. Hot paths use active-operation indexes, never retained terminal-history scans. No compaction policy is introduced.

The comparable seed-10 paused 10,000-tick fixture has no genuine actionable sources. Its previously reported 12,350 Phase D deliberations, 5,301 WAIT records and 7,049 physical starts are therefore not meaningful work under source-bound actionability. A supplemental resource-need fixture verifies that the new path really initiates operations rather than simply becoming a no-op. Final measured results are reported in the completion response.

Deferred: seven evaluators/final modifiers; broader source authoring/tuning; recruitment/reinforcement pools; diplomacy lifecycles/default WAR; reactive/required/recovery cognition; full Decision View/projections; history compaction and undefined spatial recovery. None is implemented by Phase E.

## Validation and file inventory

Final validation: Phase A 17 / B 28 / C 60 / D 41 / E 55 focused regressions passed; 16 anchor and 117 affected temporal/schema/session regressions passed. Full suite: **1,280 passed, 0 failed**. Production `tsc --noEmit` passed. Test-inclusive compilation retains the same 28 pre-existing diagnostics (compared by file, diagnostic code and message, ignoring shifted line numbers); no new diagnostics. `git diff --check` passed.

The final source-link guard validates operation and primary-thread faction identity against semantic source identity without requiring vanished sources to remain live or scanning retained history. Existing immutable terminal-validation caching remains in place.

46 intended files: 36 modified, 10 new. No package, project settings, Unity, fitness/workout implementation, battle mathematics, construction/movement duration or resource logistics files changed. Server receipt integration is solely to preserve canonical ordering of previously earned AI time before new command effects.

* Modified: `src/engine/DecisionEngine.ts`
* Modified: `src/engine/decisionOpportunities.ts`
* Modified: `src/orchestration/handlers.ts`
* Modified: `src/orchestration/orchestrator.ts`
* Modified: `src/persistence/versioning.ts`
* Modified: `src/server/session.ts`
* Modified: `src/state/cloneGameState.ts`
* Modified: `src/state/gameStateInvariants.ts`
* Modified: `src/types/AIConcretePlan.ts`
* Modified: `src/types/AIOperation.ts`
* Modified: `src/types/AIStrategy.ts`
* Modified: `src/types/GameState.ts`
* Modified: `src/world/ContinuousWorldEngine.ts`
* Modified: `src/world/catchup.ts`
* Modified: `src/world/temporalBoundaries.ts`
* Modified: `src/world/timeToTick.ts`
* Modified: `src/world/worldAccrual.ts`
* Modified: `tests/aiCanonicalReasoning.ts`
* Modified: `tests/aiConcretePlans.ts`
* Modified: `tests/aiOperations.ts`
* Modified: `tests/aiStrategyConcurrency.ts`
* Modified: `tests/analytics.ts`
* Modified: `tests/armyMovement.ts`
* Modified: `tests/commandIdempotency.ts`
* Modified: `tests/economyFoundation.ts`
* Modified: `tests/gameplaySessionLeases.ts`
* Modified: `tests/gameplaySessionLifecycle.ts`
* Modified: `tests/invasionLifecycle.ts`
* Modified: `tests/leaseWorldAccrual.ts`
* Modified: `tests/longSimulation.ts`
* Modified: `tests/persistence.ts`
* Modified: `tests/presenceLeases.ts`
* Modified: `tests/run.ts`
* Modified: `tests/sessionReplay.ts`
* Modified: `tests/temporalBoundaries.ts`
* Modified: `tests/worldDefinition.ts`
* New: `docs/AI_PHASE_E_PRESSURE_SOURCE_TIMING.md`
* New: `src/constants/strategicPressure.ts`
* New: `src/engine/proactiveCognition.ts`
* New: `src/engine/strategicPressure.ts`
* New: `src/persistence/pressureMigration.ts`
* New: `src/state/pressureInvariants.ts`
* New: `src/types/AIPressure.ts`
* New: `src/world/aiTemporal.ts`
* New: `tests/aiPressureFixtures.ts`
* New: `tests/aiStrategicPressure.ts`

## Final bounded catch-up diagnostics

Same seed-10 paused 10,000-tick comparison: **7,629 ms**, 157 chunks, 0 source opportunities/deliberations, 0 WAIT, 0 operation starts/settlements, 0 resolution records, 0 plan scoring/feasibility evaluations, 60,000 cheap observer updates, 5 clones (~3.5 ms), 4 invariant checks (~3.9 ms), no terminal-history visits in these paths. Prior reviewed Phase D measurements were approximately 78,495–83,453 ms, with 12,350 deliberations, 5,301 WAIT selections, 7,049 operation starts and 19,397 resolution records. This is primarily removal of non-source-driven cognition/history churn, not a like-for-like increase in simulation throughput or a history-compaction change.

Supplemental same-seed 10,000-tick fixture with actual AI Food/Iron needs: **4,015 ms**, 5 source opportunities, 5 completed deliberations, 10 scored plans, 5 exact BUILD starts and 5 settlements, 10 resolution records, 0 WAIT, 0 same-boundary repeat deliberations, 16 sources created, 11 blocked/no-actionable observations, 0 rearm events, 304 feasible-plan checks (no rejected finite plans; unavailable sources produce none), 60,033 cheap observer updates, 10 clones (~4.3 ms), 9 invariant checks (~6.1 ms). No pending primary thread or active claim remained. Active-operation queries (~34.5 ms) used the existing live index; retained terminal records were not scanned by observer/Attention/cognition queries. Serialization/snapshot/hydration occurred only in fixture setup/finalization, not per tick. The supplemental fixture is deliberately different and does not replace the unchanged comparison.

These are bounded local diagnostics, not a general production scalability claim. Larger-world observer authoring/profiling and history-compaction policy remain later work.

## Independent review corrections

The review found and corrected these Phase E defects before checkpointing:

1. At a physical boundary, WAIT could revalidate before a same-instant force arrival. Pre-boundary progression now earns timer work without running endpoint observation; arrivals/completions, interruptions, existing deadline gates and world facts apply before endpoint cognition.
2. End-of-chunk Food processing delayed source creation differently in coarse versus fine catch-up. The host now invokes the existing economy reducer at its authored production-cycle boundary before cognition and aggregates the original Food result rows. Existing invasion deadline reducers also run before cognition at their current authoritative boundaries. Events run after physical consequences. Economy/battle/movement/construction definitions, costs, math and durations are unchanged. This repairs composition/order, not domain design.
3. Military material fingerprints omitted defending army strength and fortification, allowing an obsolete WAIT to succeed. Meaningful current defense buckets and fortification now participate in WAIT material revision; identity remains semantic.
4. Dormant contexts rebuilt immutable exact plans repeatedly. Freshly matching canonical blocker predicates are reused; every feasibility check still reads current canonical state and any changed exact parameter gets a new plan.
5. Orphan selected primary threads and malformed blocker entries lacked structural guards. They now fail canonical validation; private pressure/thread/timer state remains absent from public projections.
6. New seeded durations were sampled at millisecond granularity despite Source of Truth §37's whole-second authoring precision. Sampling now uses integer seconds; fixed-point millisecond watermarks/fractional progress and persisted timers remain intact. No timing range or pressure/Attention tuning value changed.

Eleven additional review regressions cover score independence from pressure, defender-change invalidation, dormant predicate reuse, same-instant arrival versus WAIT, Food-boundary coarse/fine equivalence, a genuine military source with saturated blocked development, trusted receipt versus new command effects, schema-20 physical/ID preservation, orphan/malformed canonical data, public privacy and duration precision. Existing tests were not weakened to make these corrections pass.

No later evaluator, recruitment, diplomacy, Goal/Opinion, recovery, localized logistics or history-compaction feature was added. The existing domain deadline representation remains unchanged; this phase does not migrate physical/domain timers to final Temporal V2 classes.

## Reviewed checkpoint diagnostics

The three diagnostics were rerun sequentially after the review corrections. Results below supersede the pre-review measurements above; timing differences at this scale are diagnostic variation, not pressure tuning.

| Fixture | Ticks | Elapsed | Opportunities / deliberations | Scored plans | Starts / settlements | WAIT | Resolution records |
|---|---:|---:|---:|---:|---:|---:|---:|
| Unchanged no-source | 10000 | 7377 ms | 0 / 0 | 0 | 0 / 0 | 0 | 0 |
| Actual Food/Iron need | 10000 | 3987 ms | 5 / 5 | 10 | 5 / 5 | 0 | 10 |
| Military + blocked development + inactive Peace | 100 | 66 ms | 1 / 1 | 5 | 1 / 1 | 0 | 2 |

The unchanged fixture's three AI factions begin with Food 2,200–3,000 and adequate authored build resources; fresh derivation finds zero real sources, and the run creates none. Its 60,000 observer calls produce zero scoring/WAIT/operations/history resolutions. The resource fixture is only changed by setting actual AI Food/Iron holdings to zero; pressure and readiness are not hand-forced. It has 60,027 observer calls, 16 created sources, 11 blocked/no-actionable observations, zero rearm events, 296 feasible-plan probes, ten clones and nine invariant checks; five genuine BUILD operations complete.

The mixed fixture has a credible hostile target, an unfunded FARM predicate (no Wood) and no Peace burden. It produces one real ATTACK and settlement, with five scored military-context plans, 234 observer calls, 331 feasibility probes (205 LEGALITY rejection entries), one clone, two invariant checks, one blocked transition and no rearm/WAIT/same-boundary repeat. Saturated blocked Development stays dormant; Peace remains absent before/after. Initial sources are discovered without hand-setting pressure or selecting an action.

Classification: the diagnosed Phase E correctness/ordering and local predicate-allocation defects are corrected. The remaining bounded workloads are acceptable for this phase. Active Attention/source logic does not scan terminal history. No performance gain comes from suppressing the mixed fixture's legitimate cognition. Larger authored-world/source profiling and retained-history compaction remain future dependencies; no compaction policy was invented.

Review validation: Phase A 17, B 28, C 60, D 41, E 55; anchors 16; affected temporal/schema/session 117, all passing. Full suite **1,280 passed / 0 failed**. Production TypeScript passed; the exact same 28 pre-existing test-inclusive diagnostics remain (file/code/message comparison ignoring shifted line numbers). Diff checks passed. Eleven review regressions were added; no old assertion was relaxed to hide the identified defects.
