# AI Phase D — Attention, compatibility and decision opportunities

Baseline: `b8f3314ee9e8c3fd99974ec6cfc4cd462b24f6cf`.
Highest product authority: `REP_WARS_AI_Decision_Engine_Source_of_Truth_v1.0.md`.
Schema: **20**. Changes remain uncommitted for independent review. No push.

## Three independent constraints

- Phase C claims retain hard force/site/invasion ownership.
- `assessStrategicCompatibility` is the shared, pure, context-aware lifecycle rule boundary. Production defaults to permissive; current executable domains represent no independent strategic conflict beyond physical legality/claims. There is no military-action pair blacklist, treaty redesign, speculative ceasefire or Peace clearance implementation. Rules have stable identities, consider canonical state and relevant live operations, and evaluate in code-unit order. The isolated relationship-context unit fixture demonstrates future rule rejection without enabling that policy in production.
- Strategic Attention is a finite budget **per faction**, not a shared world budget. Canonical `strategicAttention.capacity` persists the common per-faction limit. Each operation owns its faction, cost, acquisition/release boundaries and historical-grandfathering marker. `occupiedAttention` derives occupancy using Phase C's live-key index. There is no mutable occupied total or runtime Attention store.

`src/constants/strategicAttention.ts` is the sole numeric tuning location:

**INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN**

| Setting | Initial value |
|---|---:|
| Ordinary capacity, independently per faction | 6 |
| ATTACK, heavy | 3 |
| MOVE / voluntary RETREAT, standard | 2 |
| BUILD / TRADE / OFFER_PEACE, light | 1 |
| REINFORCE / WAIT | 0 |

No progression or emergency overflow is implemented. Required response cognition will not use the ordinary proactive acquisition boundary; a future voluntary proposal/counteroffer will. Attention does not modify combat, movement, production, construction, RNG or physical capacity. Pool allocation and proposals remain unavailable.

## Feasibility and atomic initiation

`assessConcretePlanFeasibility` independently reports `LEGALITY`, `CLAIM`, `COMPATIBILITY` and `ATTENTION` rejections. Generation preserves Phase B's declared finite scope and stable plan IDs/order; scoring receives only feasible exact plans and independently rejects infeasible explicit scoring input. No executor reselects parameters.

Operation start fresh-checks these constraints, acquires all claims and Attention, creates/links the operation and starts the existing domain inside the same nested cloned transaction. Invariants and Orchestrator/CAS remain the serialization boundary. A post-acquisition domain failure rolls back charge, claims, expenditure, sequence, operation and physical state together.

Selection alone does not consume Attention. ATTACK/MOVE/RETREAT/BUILD acquire at successful authoritative initiation. The charge stays occupied throughout physical/recovery phases, including staged travel, invasion, blocked routes and invalid objectives awaiting physical arrival. `settleOperation` alone releases the charge at the real terminal boundary. Duplicate settlement is a no-op; another owner's charge cannot be refunded. Terminal charge metadata remains immutable historical evidence, not active occupancy.

## Primary thread and opportunity coalescing

The old faction-wide operation gate and `operationForDecisionGate` are removed. Disposable `WarlordState` instances never seed physical operations into cognition. Current canonical operations still constrain feasibility through claims, compatibility and Attention.

Canonical `aiDecisionOpportunities` is a sparse faction map containing:

- `lastBoundaryTick`: the last consumed ordinary opportunity;
- `primaryOperationId`: the pending selection/initiation on the primary thread, or null.

Opportunity identity is `[exact faction ID, worldTick]`. The authoritative `AI_DECIDE` transaction claims the boundary **before** cognition. Re-entry at that boundary is coalesced even after instant completion/WAIT; later boundaries remain blocked only while the primary initiation is outstanding or existing cadence disallows reconsideration. Several physical operations never occupy that primary slot. Successful domain initiation clears the primary pointer; terminal invalidation clears a matching failed pending initiation. CAS rejects competing writes; retries observe the already-consumed opportunity. Simultaneous faction processing uses stable ID order.

Low-level `DecisionEngine` remains the calculation/selection boundary, not an authoritative opportunity dispatcher. All production cognition enters through `handleAiDecide`; the separate legacy CLI harness does not own canonical initiation. Explicit `START_AI_OPERATION` consumes an externally supplied exact plan, not another autonomous deliberation; all claim/compatibility/Attention constraints still apply.

## Transitional timing and WAIT

Actual production world processing still uses whole prototype world ticks and the existing `BALANCE.world.reassessmentIntervalTicks`. Temporal V2's per-faction seeded online/offline reconsideration timer lifecycle is not yet executable here. This phase adds no third duration rule, polling, wall clock or frame timer.

Successful proactive initiation closes the thread and starts the existing cadence. Physical arrival, invasion resolution, construction completion and objective invalidation no longer restart that cadence. Failed initiation grants no new successful-initiation spacing. Final seeded 45–75 / 4500–7500-second reconsideration integration remains deferred to the cognition/initiation timing phase.

WAIT remains reward-free, target-free, claim-free and zero-Attention. Its selected/terminal record is bookkeeping, not a physical operation. Existing provisional one-tick world scheduling is retained; direct compatibility resolution may complete it immediately. Neither path advances time by itself or permits another ordinary decision at the same boundary. Final 2/60-second initiation, source revalidation and pressure relief remain deferred. WAIT-only actionability/source-context rules are not implemented here.

## Migration and invariants

Schema 19 -> 20 preserves every physical operation, exact plan, domain link and claim. Active physical/recovery operations receive deterministic cost metadata and historical-grandfathering; historical work may exceed the new ordinary capacity and continues unchanged. New positive-cost work is blocked until occupancy permits it. Terminal/selected records have no live charge. Legacy pending selection ownership and consumed boundaries are reconstructed deterministically. Schema 20 missing accounting is rejected, not silently remigrated.

Clone/hydrate/serialize isolate capacity, opportunity and live operation charge data. Deeply frozen terminal records continue safe immutable sharing. Invariants validate capacity/costs, exact faction ownership, acquisition/release boundaries, terminal release, primary selected-operation ownership, consumed boundaries, normal capacity and preserved historical overflow.

## Validation and performance

- Phase A: 17 passed; Phase B: 28 passed; Phase C: 60 passed.
- Phase D: 41 focused regressions passed after independent review, including concurrent compatible work, saturation, distinct rejection dimensions, terminal release/replay, rollback, over-cap migration, blocked travel, CAS race, coalescing, primary thread, deterministic coarse/fine progression, reload and the five review regressions described below. A/B/C/D together: 146 passed, zero failed.
- Independent anchors: 16 passed, 0 failed.
- Full suite after independent-review corrections: **1,225 passed, 0 failed**. The preceding implementation run was 1,220/0; five review regressions were added. The initial implementation run had 1,213 passes and seven stale schema-19 metadata guards. Those guards now assert schema 20; all functional temporal/lease/replay/CAS assertions are unchanged. Their seven complete test modules also passed 117 tests independently.
- Production TypeScript `--noEmit`: passed.
- Test-inclusive TypeScript: same 28 pre-existing diagnostics; normalized file/code/message comparison has no added or removed diagnostic.
- `git diff --check`: passed.

A 5,000-terminal-record guard makes `.values()` throw and verifies Attention/production compatibility hot queries still work using only live state. No terminal compaction or active-count proxy is introduced. Feasibility does bounded work per candidate over current live operations; shape/accounting checks extend the existing invariant pass. A bounded 2,000-tick CPU profile (with the full suite concurrently running) measured 13,041 ms, 2,490 retained operations, one claim, 32 chunks, 1,655 world changes, 3,956 resolutions and 1,046 events. Phase C retained 1,149 operations in that fixture. Attention/compatibility had four direct CPU samples out of 14,083 (<0.1%); canonical invariants had 2,903 samples (~21%), with cloning/transaction/event work also substantial. These wall times are diagnostic, not an isolated equal-workload comparison. The corrected full suite's first 10,000-tick run measured **226,583 ms**, 157 chunks, 7,235 state changes, zero event-history entries, 19,397 resolution records and 1,046 events. The preceding full run measured 227,151 ms with identical counts. The recorded Phase C suite run was 60,093 ms with 12,036 resolution records; this is a real wall-time increase with a different permitted-cognition workload, not an equal-workload speed comparison. Repeated-run determinism and reload validation passed in both full runs. More frequent permitted cognition may create more WAIT/history records than Phase C; no assertion of unchanged workload is made.

## Independent review and performance correction

The review traced canonical authority, fresh atomic starts, central settlement,
over-cap migration, concurrent physical work, pending initiation ownership,
same-boundary coalescing, CAS retries and public output. No live singular
commitment authority, second occupied-total store, manual Attention refund,
physical-duration reset or new public cognition field was found. Compatibility
has no production pair blacklist: its current rule set is empty and permissive;
the relationship restriction exercised in tests is explicitly a unit fixture.
HTTP's allowlist excludes internal AI decision/start/resolve commands.

Two semantic-preserving performance defects were corrected:

- A successful isolated nested start transferred through `overwriteGameState`,
  which cloned the entire validated draft again. The start now transfers its
  exclusively owned draft through `adoptOwnedTransactionState`. Ordinary
  `overwriteGameState` retains its safe cloning behavior for external sources.
- Every transaction repeated all structural checks on deeply immutable terminal
  records. Successful terminal validation is now memoized by immutable record
  identity. Current map key, faction existence, sequence high-water and world
  boundary remain checked. Live, replaced, mutable and freshly hydrated records
  receive normal validation. Settlement also isolates/freezes a manually supplied
  plan before granting terminal immutability proof. These caches contain validation
  proofs, never authoritative world data or occupied Attention.

Five additional regressions cover validation reuse without hiding key/faction/
sequence/replacement corruption, backwards boundaries, mutable-plan isolation,
ATTACK plus two independent BUILDs with independent settlement, and public/HTTP
privacy. The existing 5,000-terminal-record active-query guard remains intact.

The diagnostic executes the production `syncPlayerWorld` catch-up path using
`tests/persistence.ts`'s `playerState(10)`, paused player empire and `syncTo(state,
10000)`, with the in-memory CAS store. Phase C was extracted from checkpoint
`b8f3314` into a temporary archive checkout; no branch/history was changed.
Instrumentation and temporary analysis files remain outside the repository.
Before/after counters use the same fixture and instrumentation. Major diagnostic
runs were serialized; the before run briefly overlapped validation near its end,
so these are diagnostic wall times, not controlled hardware performance guarantees.

| Metric, 10,000 ticks | Phase C checkpoint | Phase D before corrections | Phase D corrected, detailed |
| --- | ---: | ---: | ---: |
| Elapsed ms | 54,756 | 217,646 | 78,495 |
| Deliberations / generated plan sets | 6,670 | 12,350 | 12,350 |
| WAIT selections | 1,303 | 5,301 | 5,301 |
| Physical operation starts | 5,367 | 7,049 | 7,049 |
| Terminal settlements, including WAIT bookkeeping | 6,669 | 12,348 | 12,348 |
| Resolution records (starts and physical ends) | 12,036 | 19,397 | 19,397 |
| Scored plans | 33,225 | 46,852 | 46,852 |
| Invariant invocations | 6,674 | 12,354 | 12,354 |
| Invariant ms | 27,458 | 158,510 | 42,485 |
| Full operation-map copies, one per state clone | 13,345 | 24,705 | 12,355 |
| Operation-map copy ms | 5,310 | 23,468 | 10,019 |

A same-instrumentation corrected run measured 77,047 ms before adding the detailed
internal rejection counters; all workload counts matched the final 78,495-ms run.
The final full suite's first comparable run measured 83,453 ms and passed its
repeat-run/reload comparison with those same workload counts.
The 2,000-tick comparison was 5,221 ms for C, 12,758 ms before correction, and
6,996 ms after correction, again with unchanged D outcomes/counts. Previously
reported suite measurements were 60,093 ms for C and 226,583 ms for D.

Final detailed D counters: 12,350 consumed opportunities and deliberations; zero
duplicate faction/boundary deliberations; per-faction decision gaps exclusively
two ticks (7,047) or three ticks (5,300). Thus no faction fully deliberates each
tick or recursively at one boundary. There were 356,758 feasibility evaluations
(including generation, scoring guards and fresh starts), with 250,704 LEGALITY,
2,510 CLAIM, 333 ATTENTION and zero COMPATIBILITY rejection entries. Rejection
counts are evaluations, not unique rejected plan identities. Production
compatibility currently has no rejection rule. There were 55 BUILD, 5,370 MOVE,
1,624 RETREAT and 5,301 WAIT selections; this paused-player fixture chose no ATTACK.
Separate focused ATTACK tests cover its initiation and lifecycle.

Active-operation queries: 443,808 calls, 211,453 returned active records and about
262 ms total. They use the derived live-key index; the 5,000-terminal guard proves
they do not traverse terminal values. Full-world integrity checks still traverse
76,296,602 historical operation entries across transactions (and sequence-floor
checks traverse persisted IDs); these are integrity/history costs, not Attention
or compatibility active queries. No records were removed or compacted. Generation
took about 8,162 ms, state cloning about 17,900 ms (including operation-map copies).
These inclusive timers overlap and must not be added as disjoint CPU totals.
Two persistence snapshots and one hydration took about 157 ms and 2 ms; there
were no JSON-string serialization calls or external database latency. The result
retained 12,350 operations, two claims, zero event-history entries, 157 chunks,
7,235 world-change records, 19,397 resolution records and 1,046 emitted events.

Classification: **B — implementation performance defects, corrected**; **C —
expected additional concurrent workload**, quantified; **D — future architecture
dependencies**, retained explicitly. Of 5,680 additional deliberations versus C,
3,998 selected WAIT. This is not claimed to be meaningful additional physical
work: final reconsideration timing/source-context blocking should address that
churn later. Existing two-tick cadence and provisional WAIT delay remain expressly
transitional, as authorized for Phase D; no new timing rule or Pressure/blocker
system was introduced. Retained-history copying/integrity costs remain a later
optimization/compaction design concern. There is no unexplained same-boundary or
per-faction every-tick cognition regression after the local corrections.

## Containment and deferred work

No Strategic Pressure/evaluators, source contexts/blockers, final reconsideration/WAIT timers, recruitment/pools, proposal lifecycles, default WAR/Peace clearance, reactive/required/recovery scheduler, Goal/Opinion redesign, spatial recovery policy, compaction, battle mathematics, movement/construction durations, localized economy, Unity, fitness or balance redesign is implemented. No Source-of-Truth conflict was found; the explicit Phase D scope defers the final timing/proposal features. Required response and emergency Attention behavior remain future integration points.

## Changed-file inventory

30 modified files and 8 new files (38 total). No package, project-setting, Unity, battle-math, physical movement/construction timing or fitness implementation files changed.

### New

- `docs/AI_PHASE_D_ATTENTION_COMPATIBILITY.md`
- `src/constants/strategicAttention.ts`
- `src/engine/decisionOpportunities.ts`
- `src/engine/strategicAttention.ts`
- `src/engine/strategicCompatibility.ts`
- `src/persistence/strategyMigration.ts`
- `src/types/AIStrategy.ts`
- `tests/aiStrategyConcurrency.ts`

### Modified

- `src/engine/DecisionEngine.ts`
- `src/engine/concretePlans.ts`
- `src/engine/operations.ts`
- `src/orchestration/handlers.ts`
- `src/persistence/types.ts`
- `src/persistence/versioning.ts`
- `src/scoring/ActionScorer.ts`
- `src/state/cloneGameState.ts`
- `src/state/gameStateAdapters.ts`
- `src/state/gameStateInvariants.ts`
- `src/types/AIOperation.ts`
- `src/types/GameState.ts`
- `src/world/ContinuousWorldEngine.ts`
- `tests/aiCanonicalReasoning.ts`
- `tests/aiConcretePlans.ts`
- `tests/aiOperationFixtures.ts`
- `tests/aiOperations.ts`
- `tests/armyMovement.ts`
- `tests/economyFoundation.ts`
- `tests/invasionLifecycle.ts`
- `tests/persistence.ts`
- `tests/run.ts`
- `tests/strategicAttack.ts`

The following existing test files only update the expected current schema metadata from 19 to 20:

- `tests/temporalBoundaries.ts`
- `tests/sessionReplay.ts`
- `tests/presenceLeases.ts`
- `tests/leaseWorldAccrual.ts`
- `tests/gameplaySessionLifecycle.ts`
- `tests/gameplaySessionLeases.ts`
- `tests/commandIdempotency.ts`
