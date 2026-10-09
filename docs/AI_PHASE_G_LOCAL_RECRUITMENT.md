# Phase G — local recruitment and exact pool allocation

Implemented against Phase F `7be9dc8319947f313172d595a227edcbf108184d`.
Product authority: `REP_WARS_AI_Decision_Engine_Source_of_Truth_v1.0.md`, especially §§28 and 37. This document records implementation choices and independent review evidence; it does not supersede product rules.

## Canonical ownership and Food

Schema 22 adds `GameState.territoryRecruitment: Map<TerritoryId, TerritoryRecruitment>`.
Each record owns `territoryId`, `factionId`, integer `troops`, exact decimal-integer strings `fractionalWork` and `accruedThroughWork`. Pool identity is `local-pool:v1:<JSON territory ID>`; it has no hash, runtime counter, faction-global bucket or separate store.

Automatic recruitment applies to non-player faction-owned territory. Neutral land and the human faction are excluded. Player banked workout troops, rewards, permanent progression and workout history are untouched. The territory-keyed model can support future player-world recruitment without merging those systems now.

There was no general local stockpile system. The narrow local availability contract is the territory's existing `territoryEconomy.uncollected.food`. Recruitment never accesses faction-bank Food, another territory's yield, shipment rules or auto-COLLECT. Existing upkeep and construction continue using their existing bank/cost rules.

`TerritoryEconomy.foodAccrualTick` is an optional Food-only production watermark. It lets recruitment materialize Food at world boundaries without advancing the lazy production stamp for gold/wood/iron/stone. Ordinary accrual and collection use the later of the shared and Food stamp, preventing double production or collection of consumed Food. No parallel Food balance is introduced.

**PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED:** `applyLocalPoolConquestPolicy` is the single replaceable pool-conquest rule. Pending allocations settle failed, their claims release, and the territory's undeployed pool/fraction is destroyed alongside old uncollected yield and infrastructure. No troops transfer to another territory or to the conqueror. This extension of existing garrison destruction is not locked product doctrine. Migration, invariants and scoring require valid local ownership, not destruction as the only possible future policy.

## Exact recruitment work and initial tuning

**INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN** lives in `src/constants/recruitment.ts`:

| Setting | Initial value |
|---|---:|
| Baseline troops per earned simulation tick | 1 |
| Food consumed per generated troop | 1 |
| Completed City rate multiplier | 2 |
| Meaningful candidate batch | 50 |
| Local reserve-flexibility comparison weight | 5 |

No authored recruitment coefficient or City recruitment effect existed. The multiplier is a provisional hook, not a claim of an established City statistic. City presence in the authoritative `cities` map is the completed-City contract (its `buildings[]` is fortification metadata). Construction in progress supplies no City effect. Existing Farm effects influence actual local Food output through the existing economy definition; other buildings have no invented recruitment bonus.

Precision reuses world-accrual algebra: one tick = `microticksPerSimulationTick × WORLD_TICK_DURATION_MS` = 60,000,000,000 numerator units. Decimal strings persist exact integers without JSON BigInt loss.

For elapsed earned work `d`, old fraction `f`, baseline `r`, completed-City multiplier `m`, local Food `F`, Food cost `c`:

- affordable = floor(F / c)
- potential work = f + d × r × m
- generated = min(affordable, floor(potential work / work-per-tick))
- pool += generated; local Food -= generated × c
- retain exact remainder if Food remains; stop work exactly at exhaustion (no unpaid/starving backlog)
- with zero available Food, advance the observation watermark but retain the previously earned fraction and generate nothing

There is no gameplay population cap. Shared safe-integer troop/resource representation remains checked for overflow. Recruitment consumes no RNG and emits no per-troop operation, history or resolution row.

## Progression and boundary order

`ContinuousWorldEngine` initializes missing records at the current processed frontier. Before physical arrival/completion at each new world tick, it settles recruitment for the elapsed interval using old Food/City facts, then materializes newly earned Food. New Food and newly completed Cities can only fund/modify later work. Existing arrival, interruption, deadline, event and post-completion cognition ordering remains intact.

Receipt-driven progression reuses the rated world anchor and authoritative lease segments to preserve sub-tick work. It never recruits beyond already-earned receipt time. Online/offline affect simulation work earned, not the rate per unit of simulation work. Coarse, fine, live and reload paths share the same algebra. No client time, wall-clock polling, Unity frame or server processing speed determines recruitment.

## Exact REINFORCE lifecycle

The existing Phase B discriminated plan freezes source territory, semantic pool ID, integer quantity and exact co-located destination. Supported: local garrison or existing stationary owned co-located army. New-army creation remains unavailable: the existing creation path is player-workout-funded, not local-pool-funded.

Fresh feasibility separates physical legality, claim conflicts, compatibility and Attention. Empty physical stock is a LEGALITY failure; stock already reserved is a CLAIM failure. Moving/blocked/approaching/retreating/invasion-held forces are rejected. No route, remote transfer, troop purchase, substitution or new troop generation occurs in allocation.

Atomic nested transaction start acquires:

- a `local_troops` quantity claim, keyed by exact territory + operation ID;
- an exclusive `force` claim for an army destination, or a `garrison` claim for a local garrison;
- operation-owned Attention under the existing configuration (REINFORCE remains zero);
- a canonical operation and its persisted initiation timer.

The pool balance includes reserved troops until allocation; `availableLocalTroops` subtracts all other live quantity claims. A failed start rolls back claims, sequence, timer, operation and domain writes.

Locked initiation: **1 second online / 10 seconds offline**, separately marked locked in the timing configuration. It reuses `ProactiveTimer` and exact earned duration progress, including offline-to-online promotion without later demotion. One primary proactive initiation remains occupied until the short allocation completes, independently of other physical operations.

Central `settleOperation(..., 'completed')` refuses early completion, freshly checks the exact plan/timer/owned claims, applies the exact pool decrement and destination increment, then owns success feedback, claim/Attention release and terminal freezing. Replaying it does nothing. No separate applied-allocation ledger is needed.

Failure/invalidation releases reservations without allocation, reward, relief or spacing. Transaction-level reconciliation cancels invalid allocations before final invariants, so conquest, new invasion or destination destruction cannot be rejected merely because they invalidated a pending allocation. The existing central reducer remains the only terminal authority. Conquest can destroy the underlying troops under its separate physical doctrine.

For source-bound successful completion, pressure relief applies once to that source and persisted reconsideration spacing begins. Selection/start gives neither. A physical operation's completion cannot cause recursive ordinary cognition at the same boundary. Explicit `START_AI_OPERATION` is still an integration/domain boundary, not a second autonomous deliberation lane.

## Sources, bounded candidates and evaluators

The existing FORCE_POSITIONING `COVERAGE_GAP` identity now includes truthful local allocation solutions. It is not duplicated into another pressure source for the same problem. Cheap detection compares the strongest currently available adjacent hostile force group with stationary local defense using authoritative CombatPower, including morale, terrain, fortifications and completed City defense. Engaged/moving forces do not masquerade as available adjacent attackers/local defenders. This is a bounded factual source test, not plan evaluation or battle RNG. The gap is converted to additional soldier/garrison equivalents using the same combat-power primitive. Candidates can allocate to the local garrison or eligible co-located armies; existing relevant MOVE alternatives remain.

MILITARY_INITIATIVE can allocate to the exact local force preparing its source target, including an existing one-owned-staging-hop approach. It never reinforces unrelated destinations. WAR alone, army idleness and a non-empty pool alone do not create a source. No EXPAND or recruitment action is added.

Complete declared quantity scope, per actual local/source shortfall:

1. full measured shortfall;
2. one meaningful batch (50, or the smaller exact closing shortfall);
3. a batch-rounded half shortfall.

Deduplicate equal quantities; at most three per exact destination. Predicates are independent of small pool increments, and current availability filters them before scoring. Their identities change only with relevant strategic parameters. Existing AND-per-candidate / OR-across-alternatives blockers enforce the complete quantity/destination/claims/compatibility/Attention prerequisites. There is no enumeration of 1..N or +1 rearm rule.

Exactly seven evaluator identities remain. `FORCE_POSITION_VALUE` assesses factual marginal local allocation using existing CombatPower, LOCAL_DANGER and target-bound BATTLE_OUTLOOK support. Defensive gain is the before/after difference for the actual mixed-morale defenders, not the combat power of added troops in isolation. Offensive gain uses the exact source target and selected army. Comparator normalization and the one pool-flexibility contribution remain outside factual evaluation; already-paid Food is not charged again. No REINFORCE_VALUE is added. Goals/risk remain in their existing separate modifier slots.

Factual support explicitly carries available/reserved local stock and pending exact allocation quantity/destination with its sampled remaining timer bounds. It does not add pending troops prematurely to the physical army/garrison or assume hostile choices cannot interrupt allocation. Source-free deprecated ActionScorer/CLI compatibility does not choose/execute recruitment or pool allocation. Canonical production uses the source-specific generator/comparator.

Legacy resource-funded REINFORCE is removed from the command handler and CLI execution. Old balance constants remain explicitly deprecated historical references with no production caller. The REINFORCE command now requires an exact plan and delegates to the canonical operation start. The locked eight proactive actions remain unchanged.

## Persistence, invariants, containment

Schema 21 migration initializes empty pools/zero fractional generation at the already-earned world frontier, including pending accrued backlog/fraction. It does not retrospectively recruit historical troops. Existing operations, claims, Attention, sources, timers and identity high-water marks remain. Current-schema missing/malformed maps fail validation. Clone/hydrate/JSON safely preserve pools, Food watermark, claims, exact plans and timer progress; active objects never alias preceding state.

Invariants cover valid territory/owner, nonnegative safe pool quantities, exact fractional representation/range, Food watermark validity, exact per-operation reservation quantity, aggregate reserved ≤ pool, local compatible destination, implemented initiation/timer/linkage, and no terminal claims. Existing operation identity/Attention invariants remain. Live claim/operation indexes are reused; no terminal-history scan is added to availability, observer or initiation hot paths.

Private pools, fractional work, reservation details and initiation timers are not added to public/Unity views. No gameplay Battle math, movement duration, construction duration, workout/fitness implementation, Unity, package or project-setting change was made. Food availability changes are narrowly authorized recruitment integration; unrelated resource accrual remains lazy.

## Review limits / deferred work

- Numeric recruitment/City/batch/flexibility tuning is provisional.
- General localized resource stockpiles, shipments and material logistics remain absent.
- AI/non-player recruitment only; any player-world extension needs explicit product integration.
- Pool destruction on conquest is a provisional implementation policy requiring product confirmation, not locked doctrine.
- New local field-army creation remains unsupported.
- No diplomacy proposals, Conflict Ledger, Goal/Opinion lifecycle, reactive/recovery scheduling, spatial recovery or history compaction was implemented.

## Independent review corrections and diagnostic evidence

Self-review kept Food materialization limited to Food rather than changing other resources' lazy accrual; folded local allocation into the existing COVERAGE_GAP rather than duplicating pressure for the same need; recognized the authoritative completed City record; and made offensive allocation evaluation consume the selected source target instead of scanning neighboring hostile targets. The last correction is protected by an exact-target/staged-approach regression. A production-world coarse/fine/reload regression also preserves exact pending allocations, claims, deployed troops and local economy state.

Independent adversarial review additionally reproduced and corrected:

1. An army listed in an invasion could pass allocation eligibility if its attack intent was absent and the invasion was elsewhere. Exact invasion membership now rejects it at fresh candidate/start/completion validation.
2. Recruitment progress validation accepted numeric values instead of persisted exact strings, and permitted a watermark beyond earned work. Invariants now require exact string representation, bound the watermark to earned/processed canonical work, and safely reject malformed/neutral/unknown-owner pools.
3. Existing rebellion consequences inverted an already-negative authored garrison casualty delta and created troops while reporting losses. Both casualty paths now apply the signed authored delta. Magnitudes, unrelated population logic, battle math and player rewards were not changed.
4. Raw troop-count coverage detection ignored existing City/terrain/fortification defense. The mixed fixture kept deliberating after actual defense was sufficient. Cheap coverage detection and bounded quantity generation now use authoritative factual combat power, without evaluator calls or RNG in the observer.
5. Allocation valuation measured added troops in isolation, overstating marginal defense in a mixed-morale force. It now computes exact before/after defense using the current factual defenders and garrison; offensive preparation remains exact-target-bound.
6. Conquest pool destruction was insufficiently identified as a replaceable non-locked policy. It is isolated in `applyLocalPoolConquestPolicy` with the exact provisional/product-confirmation label above.

Sixteen additional regressions exercise these defects plus competing CAS starts, reload/retry/duplicate completion conservation, compound blockers, tiny Food production and collection, live/coarse starvation, City completion, genuine automatic threshold crossing, conquest at allocation completion, destroyed-City restart and an army merely traveling toward a pool. Original tests were not weakened: old purchase assertions were replaced with explicit rejection/no-mutation assertions, ownership-change fixtures now use real domain settlement, and schema assertions advance to 22. A fractional hydrate fixture now records its genuinely earned canonical clock frontier rather than inventing future work.

Final full suite: **1,431 passed, zero failed**. `git diff --check`: passed.

Phase-G-focused tests: **78 passed, zero failed**. Phase A/B/C/D: **17/28/60/41**; Phase E: **55**; Phase F: **73**; anchors: **16**. Affected temporal/presence/schema/session/replay guards: **117**. Economy foundation/developments/cities/persistence: **22/15/24/45**. Production TypeScript `--noEmit` passes. Test-inclusive compilation still reports exactly the same **28 pre-existing diagnostics** (paths, diagnostic codes and messages compared after removing line-number shifts); no new diagnostic was added.

10,000-tick production-path diagnostic fixtures each process four recruitment territories, or **40,000 territory progression updates**. Instrumentation runs outside the repository and records arithmetic progress, actual cognition/comparison, operation starts/settlement and observer rearming. These are small controlled workloads, not a comparison with a larger sample world; elapsed measurements are diagnostic, not timing guarantees.

| Fixture | Elapsed ms | Troops generated / Food consumed | Opportunities / deliberations | WAIT | Plans scored | REINFORCE starts/completions | Rearms | Resolutions / event history |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Recruiting, no strategic source | 334 | 39996 / 39996 | 0 / 0 | 0 | 0 | 0 / 0 | 0 | 0 / 0 |
| Starved, rich faction banks | 312 | 0 / 0 | 0 / 0 | 0 | 0 | 0 / 0 | 0 | 0 / 0 |
| Growing pool, real local coverage need | 2055 | 9999 / 9999 | 41 / 41 | 38 | 85 | 3 / 3 | 3 | 6 / 0 |
| No-source fine progression | 692 | 39996 / 39996 | 0 / 0 | 0 | 0 | 0 / 0 | 0 | 0 / 0 |
| Mixed: City, starving/blocked site, reinforcement and irrelevant large pool | 1676 | 29997 / 29997 | 18 / 18 | 15 | 40 | 3 / 3 | 3 | 6 / 0 |

The growing-pool fixture allocates 581 troops and leaves 9,418 undeployed; the mixed fixture allocates 460 and leaves 19,538 in the generating City territory. The starving territory generates nothing, while the irrelevant pool accrues without creating its own strategic activity. No-source and starvation cases perform zero scoring. No per-troop operation, history or resolution exists. Coarse/fine no-source pools, fractions and economy stamps match exactly after semantic canonicalization (SHA-256 `45cc13c0b99b175899a47fdae0c67e37f35280fb5b7f84d13b3c9ca0f7a885fc`). Separate production regressions compare exact live/coarse/reloaded state across starvation, City completion, threshold crossing and ownership change.

**Performance classification:** a Phase-G source-quality/pacing defect was found and fixed. Before the coverage correction, the same mixed fixture took 3,372 ms with **870 deliberations / 867 WAIT selections / 2,591 scored plans**; afterward it takes 1,676 ms with **18 / 15 / 40**, retaining all three genuine allocation starts/completions. Improved performance is from ending a false source, not disabling legitimate cognition or deleting history. No terminal-history compaction or balance tuning was introduced.

**Review verdict:** PASS after scoped corrections. One canonical local pool authority, exact local conservation, atomic owned quantity/destination claims, central idempotent settlement and primary-thread/pacing contracts are preserved. Migration initializes zero pools at the already-earned frontier and does not fabricate troops, Food consumption or historical plans. All eight proactive categories and exactly seven evaluator identities remain. No Source-of-Truth conflict remains; conquest treatment and numeric recruitment tuning remain explicitly provisional. No Phase H capability was implemented.

## Changed-file inventory

Created:

- `docs/AI_PHASE_G_LOCAL_RECRUITMENT.md`
- `src/constants/recruitment.ts`
- `src/gameplay/recruitment/recruitment.ts`
- `src/gameplay/recruitment/reinforcement.ts`
- `src/types/Recruitment.ts`
- `tests/aiRecruitment.ts`

Modified:

- `src/constants/balance.ts`
- `src/engine/concretePlans.ts`
- `src/engine/executableActions.ts`
- `src/engine/operations.ts`
- `src/engine/proactiveCognition.ts`
- `src/engine/strategicPressure.ts`
- `src/events/EventDefinitions.ts`
- `src/gameplay/economy/accrual.ts`
- `src/gameplay/economy/ownership.ts`
- `src/orchestration/commandIndex.ts`
- `src/orchestration/handlers.ts`
- `src/orchestration/transaction.ts`
- `src/persistence/versioning.ts`
- `src/scoring/contextPlanComparison.ts`
- `src/scoring/factualSupport.ts`
- `src/scoring/strategicEvaluators.ts`
- `src/simulation/cli.ts`
- `src/state/cloneGameState.ts`
- `src/state/gameStateInvariants.ts`
- `src/state/pressureInvariants.ts`
- `src/types/AIOperation.ts`
- `src/types/GameState.ts`
- `src/world/ContinuousWorldEngine.ts`
- `src/world/aiTemporal.ts`
- `tests/aiConcretePlans.ts`
- `tests/aiOperations.ts`
- `tests/aiStrategicPressure.ts`
- `tests/commandIdempotency.ts`
- `tests/economyFoundation.ts`
- `tests/gameplaySessionLeases.ts`
- `tests/gameplaySessionLifecycle.ts`
- `tests/invasionLifecycle.ts`
- `tests/leaseWorldAccrual.ts`
- `tests/persistence.ts`
- `tests/presenceLeases.ts`
- `tests/run.ts`
- `tests/sessionReplay.ts`
- `tests/strategicAttack.ts`
- `tests/temporalBoundaries.ts`
