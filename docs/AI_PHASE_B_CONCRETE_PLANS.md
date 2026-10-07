# AI Implementation Phase B — concrete plans

Authority: `REP_WARS_AI_Decision_Engine_Source_of_Truth_v1.0.md`, with the explicit bounded Phase B implementation request. Phase A's uncommitted canonical-freshness changes remain the baseline. No checkpoint or push is performed.

## Contract and executable scope

`src/types/AIConcretePlan.ts` defines a readonly discriminated union. Generation and commitment cloning freeze independent copies, including nested routes, resource quantities and destination data. New production candidates use `ScoredConcretePlan`, whose `plan` is required. `AICommitment.plan` is optional solely for historical action/target records; every newly selected commitment includes its exact plan.

| Action | Exact plan data | Current operational source |
| --- | --- | --- |
| ATTACK | Faction, army, origin, staging, target, ordered route | Existing immediate engagement or one-hop owned staging then engagement |
| MOVE | Faction, army, origin, destination, ordered adjacent route | Existing physical adjacent army movement |
| RETREAT | Faction, army, origin, owned fallback, ordered adjacent route | Existing strategic repositioning from non-owned ground; no battlefield retreat |
| BUILD | Faction, structure type, site, exact current faction-stock charge; exact next fortification level when applicable | CITY, FORTIFICATION, FARM, MINE, LUMBER through current construction definitions |
| REINFORCE | Faction, territory-local pool ID, integer quantity, co-located garrison/army/new-army destination | Unavailable: no authoritative undeployed pools/recruitment yet |
| OFFER_PEACE | Faction, exact counterparty | Unavailable: proposal lifecycle absent |
| TRADE | Faction, exact counterparty, offered/requested resource bundles, optional exact source holdings | Unavailable: proposal lifecycle absent; contract does not exclude WAR partners |
| WAIT | Faction, existing turn/opportunity identity, no physical target | Reward-free no new operation; scheduling unchanged |

Resource-source contracts distinguish the existing faction stock from a future local-stockpile representation with exact quantities and optional manifest references. No stockpiles, pools, manifests, escrow, resource locality or reservations are implemented here.

`ActionType` retains historical DEFEND/NEGOTIATE/DECLARE_WAR values for saves, history, goals and unrelated commands. They have no proactive generator or scorer. Old resource-funded REINFORCE survives only in the explicitly labeled legacy commitment branch. A new pool-shaped REINFORCE cannot fall through into that branch.

## Canonical input and candidate scope

`toDecisionEngineSnapshot()` borrows the current transaction's canonical GameState as `canonicalState`, alongside its existing direct map references. Construction feasibility calls the actual domain definition against that draft, including cities, completed infrastructure and construction capacity. This is not another state store and is never persisted or retained by cognition. Hand-built historical snapshots lacking these facts cannot fabricate BUILD candidates.

`generateConcretePlans()` declares this finite candidate scope:

- Every owned force without an active march/attack intent, every existing adjacent MOVE destination.
- Every foreign-owned target reachable from that force's current owned staging site, or one adjacent owned staging site. All legal force/staging/target combinations are retained. Routing beyond the existing one-hop approach is not invented.
- Every adjacent owned fallback for a force on non-owned ground.
- Every current authored construction type on every owned territory. Ownership, city/infrastructure prerequisites, upgrade level, busy capacity, exact affordability and current construction-ID collisions are checked before scoring.
- One target-free WAIT; zero unsupported pool/proposal plans.

The candidate count is bounded by the current graph: approximately `forces * local_degree^2 + forces * local_degree + 5 * owned_sites + 1`. There is no heuristic top-N pruning within this scope. Feasibility and identity validation inspect current domain state; this phase does not implement future source-context selection or blocker/rearm behavior.

Army ownership, troop eligibility, active operations, adjacency, owned staging, foreign targets, player protection/anchors/cooldowns and existing open invasions are checked before ATTACK scoring. The same checks are reused at execution. No actual future seeded battle is sampled.

## Scoring and stable identity

A plan ID is `plan:v1:` followed by canonical JSON of all plan parameters: object keys use explicit UTF-16 code-unit comparison, route order is preserved, and meaningful quantities/sites/structure/force/counterparty/opportunity are included. No hash collisions, locale comparison, map insertion ordering or wrapper counters establish semantic plan identity.

Plans are sorted by ID before scoring. Existing combat estimates, personality, memory, goals, ambition, base scores and bounded random variation are reused. ATTACK scores the selected army; MOVE scores the selected destination; RETREAT scores the selected endangered force; BUILD scores its identified structure/site. Scorers do not search for replacement parameters. Existing fortification-specific desirability applies only to fortifications; other legal structures use the existing common site/goal factors provisionally. Final evaluator architecture and balance tuning are deferred.

Score ordering breaks ties by plan ID. The existing seeded near-top selection window and weighted choice are retained. Commitment IDs still use Phase A's persisted canonical sequence; the selected plan's own semantic identity is separate.

## Exact execution and compatibility

`executeConcreteCommitment()` uses the chosen parameters and calls the existing attack, movement and construction domains. ATTACK supplies `onlyArmyId` and exact staging; the strategic-attack domain no longer chooses another staging route for these callers, and the delayed intent retains that army. MOVE/RETREAT call the movement handler with the exact army and destination. BUILD calls `startConstruction()` with the exact project/site after validating exact funding and next upgrade level. WAIT changes no resources or troops.

Execution-time invalidity produces the existing failed commitment/invalidation response (`INVALID_TARGET` or a domain error), not another strategic decision. Unsupported final lifecycles fail with `FEATURE_NOT_IMPLEMENTED`. Exactly one active commitment per faction remains; existing march/invasion completion and construction-start commitment semantics remain unchanged. This is not the final multi-operation lifecycle.

Schema **18** prevents a schema-17 binary from ignoring a concrete plan and reverting to target-only execution. Migration preserves old records and IDs and does not reconstruct missing army/route/build parameters. Such records follow the existing explicit legacy bridge. Persisted plans are structurally validated, checked against their deterministic ID/action/faction/display-target binding, and deep-cloned/frozen on hydration.
Only an absent/undefined plan denotes legacy compatibility. Present malformed
values, including null/false/zero/empty text, are rejected; they cannot restore
legacy strategic selection. Execution also rejects contradictory display
targets before starting the chosen concrete operation.

The old `simulateDecisionOutcomes()` turn-only preview lacks canonical movement/construction authority. It explicitly rejects new concrete physical operations instead of substituting parameters or pretending to execute them; canonical execution remains available through the existing `--world` Orchestrator flow. Its WAIT branch is also reward-free. Historical manual battle DTO tests retain their legacy harness path. The default old turn-only preview therefore needs a later deliberate migration if it is to run the new concrete-plan loop.

## Regression coverage and deferred work

`tests/aiConcretePlans.ts` covers exact force/route/site/type retention, all five build types, legal candidate exclusion, complete staging combinations, execution invalidation without substitution, stable identities/order across map permutation and reload, bounded seeded alternatives, deep immutability, migration, unavailable future contracts, legacy preview rejection, reward-free WAIT and single-commitment gating. Earlier scorer assertions that required fake resource-funded REINFORCE, unfinished TRADE, proactive DEFEND, or null-target MOVE/RETREAT are replaced with locked-vocabulary checks. Legacy saved commitment execution coverage remains intact. Tests with an explicit current-schema assertion advance to 18; unrelated gameplay assertions are retained.

Deferred: source contexts/Strategic Pressure, final evaluators/scoring, attention, concurrent commitments, reservations, recruitment/pools, Peace/Trade proposals, default-WAR migration, final WAIT timing, recovery/reactive scheduling, goal/opinion lifecycle, projections and conflict ledger. Battle mathematics, movement durations, construction costs/timings, canonical physical domains, economy authority, Unity and fitness are unchanged.

## Phase B file inventory

Relative to the preserved Phase A working tree:

- Created: `docs/AI_PHASE_B_CONCRETE_PLANS.md`
- Modified: `src/army/strategicAttack.ts`
- Modified: `src/engine/DecisionEngine.ts`
- Created: `src/engine/concretePlans.ts`
- Modified: `src/engine/executableActions.ts`
- Modified: `src/index.ts`
- Modified: `src/orchestration/handlers.ts`
- Modified: `src/persistence/versioning.ts`
- Modified: `src/scoring/ActionScorer.ts`
- Modified: `src/simulation/cli.ts`
- Modified: `src/state/gameStateAdapters.ts`
- Modified: `src/state/gameStateInvariants.ts`
- Created: `src/types/AIConcretePlan.ts`
- Modified: `src/types/GameState.ts`
- Modified: `src/types/index.ts`
- Created: `tests/aiConcretePlans.ts`
- Modified: `tests/aiRuntime.ts`
- Modified: `tests/commandIdempotency.ts`
- Modified: `tests/economyFoundation.ts`
- Modified: `tests/gameplaySessionLeases.ts`
- Modified: `tests/gameplaySessionLifecycle.ts`
- Modified: `tests/invasionLifecycle.ts`
- Modified: `tests/leaseWorldAccrual.ts`
- Modified: `tests/longSimulation.ts`
- Modified: `tests/persistence.ts`
- Modified: `tests/presenceLeases.ts`
- Modified: `tests/run.ts`
- Modified: `tests/sessionReplay.ts`
- Modified: `tests/temporalBoundaries.ts`

## Combined Phase A+B final review

The review corrected shallow nested-memory copies, retained direct-call
commitment gating, sequence migration/high-water validation, and falsy-plan
legacy fallback/display-target inconsistency. The sequence helper is
`src/engine/commitmentIdentity.ts`; the transaction memory correction is in
`src/state/cloneGameState.ts`. Focused regressions were added to the existing
Phase A/B test modules. No domain timing, battle mathematics, economy, CAS,
Unity, fitness, or later AI architecture was changed.

Validation after corrections: Phase A 17/17; Phase B 28/28; full suite
1,124 passed, zero failed; production TypeScript `--noEmit` passed. The
test-inclusive compiler still reports the same 28 pre-existing diagnostics,
with no new diagnostics. The combined implementation is eligible for the
authorized local checkpoint after the final whitespace/scope checks. Nothing
is to be pushed, and Phase C is not started.
