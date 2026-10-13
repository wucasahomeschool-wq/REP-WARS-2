# AI Phase C — canonical operations, claims and physical lifecycle

Implementation baseline: `fb0f585eb5c74b91d47203bfa7b2e27c4e58cdc3`.
Product authority: `REP_WARS_AI_Decision_Engine_Source_of_Truth_v1.0.md`.
Schema: **19**. This document supersedes Phase A/B's descriptions of live
single-commitment storage and legacy target-only execution, not their exact-plan
or canonical cognition contracts.

## Canonical ownership

`GameState.operations: Map<OperationId, AIOperation>` replaces the faction slot.
`GameState.operationClaims: Map<ClaimId, AIOperationClaim>` is the only claim store.
An operation retains the immutable concrete plan and selection metadata, faction,
created/start boundaries, phase, objective validity, claim IDs, domain links and
terminal outcome/reason/boundary. Phases are selected, physical, recovery, terminal.
There is no parallel movement, construction or battle simulation.

The persisted faction `nextAiCommitmentSequence` remains the deterministic ID
source. The existing `cmt_<seed>_<faction hash>_<turn>_<base36 sequence>_...` format
prefix is retained for compatibility, with an exact JSON faction-ID suffix to
avoid faction-hash collisions. Old IDs remain valid; new IDs identify independent
operations.
Sequence exhaustion/reuse fails. Invariants include recorded operation and domain
ID high-water marks. Plan identity continues to encode exact strategic parameters.

`WarlordState.activeCommitment` is a disposable cognition input/output DTO. It
represents one operation for the **transitional initiation gate**, never operation
ownership or progress. Rebinding rebuilds it from canonical factions/operations.
Selection registration inserts new IDs; wrapper writeback cannot overwrite or
remove existing operations. Legacy DecisionEngine status methods remain for the
non-authoritative historical simulation harness, not canonical settlement.

## Atomic start and current claims

`START_AI_OPERATION` is an explicit exact-plan integration command; it is not a
new autonomous decision loop. `RESOLVE_COMMITMENT` resolves a selected operation
by `operationId`; faction-only compatibility works only for one unambiguous live
operation. Atomic starts use a nested clone/validate transaction, fresh plan
validation, all-claims availability check, claim acquisition, domain start and
invariant validation. Only a successful inner transaction replaces the outer
draft. A failed start leaves no partial claims, project, expenditure or sequence
increment. Orchestrator/CAS remains the final serialization boundary.

| Action | Current hard claims | Authoritative physical link |
|---|---|---|
| ATTACK | Exact force; faction-local pending-attack target slot; global target slot for a player invasion | Army movement/attack intent; invasion when applicable |
| MOVE / RETREAT | Exact force | Army movement |
| BUILD | Exact territory construction site (existing one-live-project-per-site capacity) | Construction project `aiOperationId` |
| WAIT | None | Temporary scheduling only; no reward |

Faction-local engagement IDs encode `[factionId, territoryId]`, without ambiguous
concatenation. Force/site/invasion IDs encode kind and exact subject. A pending
attack does not grant exclusive ownership of enemy land against other factions.
Player invasion target exclusion matches the existing open-invasion constraint.
Resource costs are immediately debited by the existing construction start in the
same transaction; no speculative future resource/stockpile reservation is added.

The legacy domain field name `commitmentId` now refers to an operation ID. It is
not a second commitment store. Exact force, origin, staging/destination, route,
structure and site remain selected before start. Direct commands cannot impersonate
an unrelated operation to bypass this binding. Fresh failure never reselects a
force, target, structure or route. REINFORCE, OFFER_PEACE and TRADE remain unavailable.

## Physical progression and terminal settlement

The world coordinator progresses all operations independently. Operation-ID
ordering governs operation reconciliation/start; existing army-ID ordering governs
movement/ready attacks; construction uses deterministic project-ID order. A nested
start refreshes later operation references by ID, avoiding mutation of discarded
transaction objects. Construction calls its existing progress/complete functions
at world boundaries. Costs, authored work durations and economy formulas are not
changed. Physical progress summaries read army/project/invasion timing rather than
continuing the provisional selection-delay timer. Invasion deadlines still use
existing player-facing clock rules.

The sole live terminal reducer is `settleOperation`. Completion, interruption,
battle force destruction, invasion closure and construction completion/destruction
reach it by operation ID. It records a terminal result once, releases only claims
owned by that operation, clears live domain reverse links and applies existing
canonical goal/memory feedback once. Replay is a no-op. Historical terminal links
remain available for inspection. No Attention/Pressure hooks execute yet; their
future settlement work must attach at this reducer.

Attacker success means the authoritative battle winner is **attacker**. Defender
victory and draw/held results fail the attacking objective. Defender reward/cooldown
semantics remain separate. A battle destroying another claimed force also settles
that force's operation. If its invasion is still open, only the extinct force
claim releases; the invasion target slots remain until the existing invasion
resolver closes it. No alternative battle math or invasion clock is introduced.

### Invalid objective while traveling

Stale attack invalidation clears the attack intent, marks the operation's objective
invalid and phase recovery, and releases its objective target slots. It **does not
clear movement**. The exact force claim remains until the already-started march
arrives through movement authority; a halted broken route retains that claim. Arrival at the already
chosen staging territory settles failure; no new recovery destination or strategic
plan is selected. The eight-ticks-remaining regression also exercises reload.

There is no OPERATION_RECOVERY cognition lane. If a destination/edge ceases to exist,
movement becomes **blocked** with a persisted `haltedAtTick` and interruption reason.
The original route, start, duration and elapsed boundary remain; the army is still
unavailable and its operation remains recovery with the force claim held. Remaining
travel stops counting down at that boundary. Repeated ticks/reload cannot release
it or silently resume it if an edge returns. `Army.location` remains the recorded
origin reference, not a returned/stationary physical force. Missing endpoints may
remain referenced by blocked travel; the force itself must still exist.

**Classification A: preserved physical truth, awaiting domain recovery policy.**
The repository has no spatial mid-route location or recovery model. No rerouting,
return-to-origin, nearest-safe destination or recovery cognition is invented.

An arbitrary failure request cannot free an in-progress construction or open
invasion. Those domains must reach their real terminal boundary first. Premature
ready-attack polling preserves movement without changing the intent. Invasion start
rejects moving/blocked or incompatibly engaged forces, including non-AI domain
callers. A stationary invasion whose defender lost the objective settles failure
through its existing resolver before further nested operation starts. Legacy invasion
closure neither uses a traveling force in battle nor clears an unrelated march.

## Migration from schema 18

- Empty commitment slots create no operation.
- Exact pending physical plans become selected operations, without fabricated
  resources/routes/forces.
- Exact executing records link only to their actual selected army and matching
  movement/attack intent. Movement origin/destination and attack target/staging/
  exact-force identity must agree across every present physical link; one matching
  attack link cannot conceal a mismatched march. Invasions retain their existing domain IDs; multiple matching old invasion links are ambiguous, never selected by map order.
- BUILD links only to one uniquely matching in-progress project. Older BUILD
  records marked completed at project start are resumed physically; a persisted
  `legacyFeedbackApplied` marker prevents replay of feedback already applied by
  the old start-time terminal path.
- Incomplete or ambiguous historical reasoning is archived as interrupted legacy
  metadata; no exact plan is reconstructed. Its unlinked movement/attack/invasion
  continues autonomously with the reasoning reference detached. World travel is
  not deleted. A pending record beside mismatched physical work is archived rather than restarted. Reverse-link cleanup checks the exact army/invasion identity, not just an ID that happened to remain live. Malformed explicit concrete plans remain corruption, not fallback.
- Claim ownership conflicts archive ambiguous reasoning rather than duplicate
  physical ownership. Faction-local legacy ID collisions are deterministically suffixed by exact
  faction ID, with the old audit ID retained and exact owned domain references
  updated. They never overwrite another faction. Invalid faction bindings are rejected.
- Hydration removes `commitments`. Schema 19 requires the canonical maps and rejects
  missing claim storage. High-water marks cannot fall below recorded IDs.

Live operations/claims and nested data deep-clone. Terminal records are deeply
frozen and may safely share immutable references across transaction clones; a
WeakSet records only this immutability proof, never world facts or lifecycle
choices. Reload rebuilds equivalent immutable data. No mutable alias survives.

## Transitional limits and containment

Ordinary AI cognition still waits while any same-faction operation lives. This is
explicitly temporary until Attention/compatibility/pacing are implemented. Explicit
exact-plan starts can safely represent independent concurrent physical operations.

Public summaries add an operation count; the old commitment-count field is a
compatibility alias derived from operations. No private reasoning enters the public
view. AI integration commands are not HTTP-exposed. Analytics use exact operation IDs, distinguish newly selected operations from gated cognition over several held operations, and do not count a physical start as a terminal failure. BUILD completion emits one exact terminal resolution record.

No Strategic Attention, strategic compatibility, Pressure/evaluator redesign,
source contexts, recruitment/pools, Peace/Trade proposals, default-WAR migration,
final WAIT timing, final proactive scheduler, Unity, fitness or battle mathematics
are implemented. Implementation was left uncommitted for this independent review; the requested local checkpoint is created only after review/validation pass. Nothing is pushed.

## Validation and known costs

`tests/aiOperations.ts` covers coexistence, force/site/target claims, atomic failure
(including a domain failure after acquisition), exact linkage, transitional gating,
objective recovery, attacker outcomes, idempotence, migration/feedback protection,
reload, immutable clone isolation, deterministic same-boundary progression and
corrupt state. Phase A/B regressions remain registered. Older tests use an explicit
**test-only** fixture authoring adapter; production has no target-only fallback.
Removed proactive DEFEND/NEGOTIATE/DECLARE_WAR and resource-funded REINFORCE tests
now assert truthful unavailability; movement-cancellation expectations now assert
preserved travel. Domain/CAS/fitness assertions are retained.

Long-lived terminal operation history grows with initiated actions. The independent
review classified repeated active-history scans and repeated immutable-plan identity
encoding as **Phase C performance defects**, corrected locally without compaction:

- The canonical ordinary `Map` has a derived live-key index synchronized by its map
  mutation methods and the central terminal re-set. Its index contains no operation
  facts and is not persisted; clone/hydration rebuild it. Active queries visit live
  entries rather than every terminal record. Native map semantics/prototype remain.
- Plan shape/identity checks may reuse results only for plans recursively frozen by
  their own constructors. Mutable and merely shallow-frozen inputs are always checked.
  Current-state legality is never cached. Reload recomputes the same shape result.
- Sequence high-water validation scans recorded identities once across factions,
  instead of scanning all retained operations separately for each faction.
- Transaction clones bulk-copy indexed maps, share only proven immutable terminal
  records, and deeply clone live operations. Unindexed/hydrated maps are fully
  checked and cloned before acquiring this optimization; mutable aliases cannot
  cross transaction boundaries.

The bounded 2,000-tick CPU profile initially spent about 38% of catch-up samples in
invariants, including about 29% in repeated plan validation/identity encoding;
transaction/event cloning was another substantial cost. The first local corrections
reduced the comparable profile from 8,435 ms to 5,513 ms with identical operation
count (1,149), claims (2), chunks (32), resolutions (2,012), world changes (1,108)
and events (1,046). The final 2,000-tick diagnostic took 5,294 ms. The final
standalone 10,000-tick diagnostic took 56,822 ms, versus the original 173,678 ms
(about 67% less time), retaining 6,670 operations and one live claim. Chunks (157),
world changes (5,554) and events (1,046) match the original run. Resolution records
increase from 11,979 to 12,036 because 57 BUILD completions are now correctly
reported; this is an analytics correction, not additional gameplay outcomes.
The full-suite run measured the same 10,000-tick fixture at 60,093 ms with the
same chunks, world changes, resolution records and events; it also repeats the
fixture and checks reload for deterministic equivalence.

Full-map cloning/structural validation and retained-history serialization remain
linear in historical record count, and the existing EventEngine still clones its
own event state. These remaining costs are acceptable for this structural review,
with later retention/compaction profiling required rather than a performance claim;
no persisted terminal history is deleted and no archive policy is invented here.

## Validation results

- Phase A focused regressions: 17 passed, 0 failed.
- Phase B focused regressions: 28 passed, 0 failed.
- Phase C focused regressions: 60 passed, 0 failed.
- Production TypeScript `--noEmit`: passed.
- Test-inclusive TypeScript: the same 28 pre-existing diagnostics; normalized
  file/code/message comparison found no added or removed diagnostics.
- Full suite: 1,184 passed, 0 failed (complete existing test runner, including
  long offline catch-up, HTTP, persistence, CAS/session and lease suites).
- Review correction: exact-start anchor protection now preserves the existing
  `anchor_protected` metadata and telemetry. The independent anchor suite has
  16 passing tests, and Phase C covers failed start atomicity for this case.
- `git diff --check`: passed.


## Phase C changed-file inventory

53 existing files modified; 6 new files (59 total). No packages, project settings, Unity,
fitness implementation, battle formulas or balance constants changed.

### New files

- `docs/AI_PHASE_C_OPERATIONS_CLAIMS.md`
- `src/engine/operations.ts`
- `src/persistence/operationMigration.ts`
- `src/types/AIOperation.ts`
- `tests/aiOperationFixtures.ts`
- `tests/aiOperations.ts`

### Modified files

- `src/analytics/observer.ts`
- `src/army/movement.ts`
- `src/army/strategicAttack.ts`
- `src/engine/DecisionEngine.ts`
- `src/engine/commitmentIdentity.ts`
- `src/engine/concretePlans.ts`
- `src/engine/outcomeFeedback.ts`
- `src/gameplay/construction/complete.ts`
- `src/gameplay/construction/consume.ts`
- `src/gameplay/construction/progress.ts`
- `src/gameplay/economy/ownership.ts`
- `src/gameplay/invasion/create.ts`
- `src/gameplay/invasion/progress.ts`
- `src/gameplay/invasion/resolve.ts`
- `src/orchestration/applyBattle.ts`
- `src/orchestration/commandIndex.ts`
- `src/orchestration/handlers.ts`
- `src/orchestration/publicView.ts`
- `src/persistence/types.ts`
- `src/persistence/versioning.ts`
- `src/simulation/cli.ts`
- `src/state/cloneGameState.ts`
- `src/state/createGameState.ts`
- `src/state/gameStateAdapters.ts`
- `src/state/gameStateInvariants.ts`
- `src/types/AIConcretePlan.ts`
- `src/types/GameState.ts`
- `src/types/index.ts`
- `src/world/ContinuousWorldEngine.ts`
- `src/worldDefinition/instantiate.ts`
- `tests/aiCanonicalReasoning.ts`
- `tests/aiConcretePlans.ts`
- `tests/aiEconomy.ts`
- `tests/aiRuntime.ts`
- `tests/armyMovement.ts`
- `tests/commandIdempotency.ts`
- `tests/economyFoundation.ts`
- `tests/foundationHardening.ts`
- `tests/gameplayConsumption.ts`
- `tests/gameplaySessionLeases.ts`
- `tests/gameplaySessionLifecycle.ts`
- `tests/invasionLifecycle.ts`
- `tests/leaseWorldAccrual.ts`
- `tests/level1Tutorial.ts`
- `tests/levelAnchors.ts`
- `tests/longSimulation.ts`
- `tests/persistence.ts`
- `tests/presenceLeases.ts`
- `tests/run.ts`
- `tests/sessionReplay.ts`
- `tests/strategicAttack.ts`
- `tests/temporalBoundaries.ts`
- `tests/worldDefinition.ts`

## Independent review corrections

The review added 22 focused regressions (Phase C now 60): halted MOVE/RETREAT/ATTACK
and missing destination, premature attack polling, direct-command/retry/reload
exclusivity, system invasion force availability, ownership invalidation, active
invasion/RETREAT migration, ambiguous ID links, high-water terminal IDs, immutable
shape-cache safety, history-independent live queries, exact analytics, immediate
attacker/defender/draw settlement and exactly-once BUILD completion reporting.
Old interruption tests now assert retained physical unavailability, not a return
or force release. Failed-command unchanged-state/deep-clone assertions remain intact.

No Source-of-Truth conflict was discovered. The temporary cognition gate remains
explicitly transitional. Attention, strategic compatibility and later cognition
lanes are intentionally unimplemented. Mid-route recovery/endpoint restoration and
historical-operation retention/compaction policy remain external integration items.
