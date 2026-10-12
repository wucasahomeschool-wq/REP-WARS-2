# Phase L — non-proactive cognition and physical recovery

## Baseline and authority

Implementation began on clean branch `work`, HEAD
`7b6cf00a639b6ed1b17302713ef13ad6d2ea195f` (`AI: conflict ledger and war value trajectory`).
The final `REP_WARS_AI_Decision_Engine_Source_of_Truth_v1.0.md` remains the product authority;
this document records implementation and limitations, not new product doctrine.
Schema advances from 26 to **27**. No checkpoint or push is authorized for this implementation.

## Audit before implementation

* **IMPLEMENTED:** canonical exact operations, physical claims, operation-owned Attention,
  pressure/source cognition, persistent duration clocks, local recruitment, Peace, Trade,
  Goal/Opinion and factual conflict history. These systems were reused.
* **PARTIAL:** Peace and Trade each scheduled their own required responses in
  `processPeaceBoundary` / `processTradeBoundary`. They canceled proactive thought only
  at response completion. There was no shared priority/thread authority.
* **IMPLEMENTED:** `settleOperation` preserved unfinished attack travel and force claims;
  `progressArmyMovements` preserved a blocked march with its origin, destination,
  elapsed duration and halt boundary. Trade preserved interrupted cargo in custody.
* **MISSING:** shared emergency/recovery context lifecycle, canonical response priority,
  one bounded non-proactive thread, event-driven recovery observation, and critical
  Attention overflow ownership.
* **UNRESOLVED:** spatial recovery, blocked-cargo remedy, general construction remedies,
  and broader final battle timing/participant lifecycle. This phase does not invent them.

## Canonical authority and indexes

`GameState.aiResponses` stores `AIResponseContext` by exact semantic identity.
`aiResponseScheduler` stores the faction's primary response context, scheduling boundary,
dirty notification and next material hostile-arrival threshold. Physical world facts
remain in armies, operations, invasions, projects and cargo; contexts contain references.

`NON_PROACTIVE_LANES` contains exactly `REACTIVE_EMERGENCY`, `REQUIRED_RESPONSE`, and
`OPERATION_RECOVERY`. These are cognition lanes, not actions or pressure domains.
The proactive action vocabulary remains eight; factual evaluators remain seven.

`responseContextId` uses full JSON-encoded faction/subject identity. Hostile contexts
include the actual conflict-chain/commitment identity and defended territory, so a later
attack by the same army is a different problem. Unidentified historical physical intents
remain explicit legacy references; no historical identity is fabricated. IDs never use
hash truncation, insertion order, process counters or wall-clock sampling.

`createResponseMap` maintains derived live, ready and territory indexes. They contain
keys only, are rebuilt during cloning/hydration, and are never serialized as authority.
Queue/Attention feasibility does not scan terminal operation/context history.
`cloneGameState` deep-copies mutable context, timer, plan and scheduler data.

## Shared required response scheduling

Publication calls `registerRequiredResponse` for the exact proposal. Withdrawal,
invalidation and terminal settlement call `invalidateProposalResponse`. Required work
does not need Pressure, proactive spacing or free normal Attention.

`settleReadyRequiredResponses` owns the shared fresh-recipient assessment boundary.
Peace delegates to `assessRequiredPeaceResponse` and `settlePeaceProposal`; Trade delegates
to `assessRequiredTradeResponse` and `settleTradeProposal`. Acceptance continues to use
the existing atomic bilateral resource/cargo transition. Counteroffer replacement stays
in the existing exact command/domain path; autonomous AI counteroffer strategy is absent.

Response-window progress remains owned by the proposal's existing persisted timer.
Windows can advance independently; full assessment/settlement is serialized on one
canonical response thread. Deadline-ready work temporarily takes that thread and restores
an interrupted emergency's already-earned progress. It cannot starve behind physical
operations or an unrelated low-priority context. This preserves Phase H/I window semantics
without inventing a second response timeout or extending deadlines because of processing latency.

Peace and Trade retain independently owned AI 3–8 / 30–80 second response policies and
player expiry windows. Player expiry is a domain deadline gate, not fabricated AI cognition.
Proposal disappearance, faction loss and hard invalidation cancel cognition without fake
decline. Pending Trade still reserves only the proposer, rechecks recipient holdings at
ACCEPT, and releases diplomatic Attention before physical shipment.

## Emergencies, materiality and bounded plans

`observeNonProactiveWork` detects actual committed hostile approaches and current invasions.
WAR, Goals, Opinion, raw Memory, ledger history, army idleness and pool existence alone do
not create an emergency. Only surviving eligible non-player factions perform optional thought;
the existing Level 1 tutorial suppression is respected.

The observer runs on domain-change notifications or scheduled arrival-urgency thresholds,
not every tick. Movement start/arrival/interruption, attack initiation/invalidation,
ownership/battle consequences, operation transitions, invasion creation and cargo blocking
notify it. Recruitment uses the territory index and exact blocked quantity thresholds;
increments below a relevant prerequisite do not wake cognition. Quiet tick progression
does not scan operations, proposals, invasions or terminal history for Phase L.

`reactivePlans` declares this complete bounded scope: stationary owned forces on the
threatened tile and its immediate owned neighbors; one adjacent support/withdrawal hop;
counterattack on the actual hostile force's territory where legal; and the existing three
meaningful local-pool reinforcement batches. Every plan uses Phase B feasibility, claims,
compatibility and Attention. It cannot build an unrelated farm, negotiate, create an army,
reinforce remotely or allocate into a battle/invasion-held force.

Current territory threats ordinarily yield MOVE, applicable ATTACK and local REINFORCE.
RETREAT retains its existing off-owned-ground legality; this phase does not manufacture
an otherwise nonexistent exposed-force combat event to force a RETREAT candidate.

Stable material signatures describe the same problem's force/support class, relevant
route and complete feasible alternatives. AND prerequisites belong to one exact plan;
alternative plans form an OR. Unrelated freed forces/routes and partial prerequisite
restoration do not supply a complete alternative. Urgency escalation, a new hostile
commitment, material support loss or newly meaningful local quantity may rearm. ETA
decrement, +1 resource and pressure growth alone cannot restart handled cognition.

Critical deliberation samples **1–2 seconds online / 5–10 offline**; urgent samples
**2–5 / 20–50**. Samples/progress persist using the existing duration kernel and canonical
timer sequence. Promotion is permitted, demotion forbidden, and reload does not reroll.
Queued emergency progress is not credited as active thought. The next independent thought
begins at the preceding thought's completion boundary, without a receipt/chunk gap.

Urgent/critical work cancels unfinished proactive deliberation. It does not cancel WAIT or
other committed initiation, clear physical movement, rewind RNG, relieve Pressure or start
proactive spacing. Proactive cognition later observes fresh canonical facts.

## Comparison and exact execution

`ContextPlanComparator.compareInterventions` reuses the same seven factual evaluators,
normalization, causal contribution ownership and bounded own Goal/Opinion/Risk modifiers.
It has no Pressure source and never manufactures a WAIT plan. Its implicit zero baseline
is `NO_ADDITIONAL_INTERVENTION`. Only qualified near ties reach seeded variation;
inferior plans cannot be rescued by randomness or modifiers.

`startResponseIntervention` verifies canonical context revision, existence, selected plan
identity and current scoped feasibility. It calls the existing `startExactPlan` /
`startOperation` nested transaction and shared domain handlers. Claim, Attention,
sequence and domain mutations succeed together or roll back. Returned physical changes,
events and notifications are retained. Execution never substitutes an army, quantity,
target, route or destination. `responseContextId` is private operation provenance;
`finishDecisionInitiation` excludes it from proactive relief/spacing.

Central operation settlement remains the exactly-once owner of claims, Attention and
domain feedback. Reaction itself writes no invented casualty, conquest, Opinion or Goal
reward. Real domain consequences continue through the Phase J/K event paths.

## Recovery and truthful non-action

Blocked movement, invalid attack objectives and blocked cargo link a stable recovery
context to their existing operation/shipment. Current domain mechanics expose no authorized
spatial reroute, return destination, cargo refund or replacement project choice. Such a
context immediately records dormant `NO_ADDITIONAL_INTERVENTION`: no evaluator suite,
WAIT, relief, spacing, new operation or repeated retries.

Movement keeps its exact origin/destination, elapsed work/halt boundary, force claim and
Attention until the domain reaches a physical terminal state. Cargo keeps exact ownership
and quantity in custody without diplomatic Attention. A changed route alone cannot invent
a remedy; recovery only cancels/rearms when authoritative domain feasibility actually
changes. Resumed/terminal physical work invalidates its stale recovery reference.
Construction completion/destruction retains existing settlement; no cancellation/refund
or new `AWAITING_MATERIALS` architecture is implemented.

## Attention, priority and provisional policies

**PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED:** all numeric
emergency/materiality/priority/overflow choices live in `constants/aiResponse.ts`.

| Surface | Current implementation | Classification |
| --- | --- | --- |
| Severity order | critical, urgent, required, recovery | Provisional priority policy |
| Within severity | deadline, irreversibility, creation boundary, exact ID | Deterministic policy; no unrelated-context RNG |
| Imminence | critical at <=1 remaining world tick; urgent at <=3 | Provisional detection against existing physical timing |
| Force/support materiality | 50-troop classes; exact complete feasible alternatives | Provisional thresholds, not balance doctrine |
| Irreversibility | incoming physical threats precede otherwise equal reversible work | Provisional binary weight |
| Critical overflow | at most 2 additional Attention units | Provisional finite allowance |
| Reactive physical cost | ordinary action cost, operation-owned until physical settlement | No free military actions |
| Recovery retry | no choice => dormant; actual domain change => reassessment/cancellation | No speculative remedy |
| Context aging | none | No invented timeout/decay |

Overflow records its authorizing context/revision and exact charge on the operation.
It cannot override troops/routes/claims or grant another operation's capacity. Ordinary
positive-cost initiation remains blocked over capacity. Reload preserves occupancy;
terminal settlement releases it exactly once. Historical over-cap operations are untouched.

## Persistence, invariants, privacy and unresolved contracts

Schema 26→27 preserves all A–K world state, IDs, claims, Attention, recruitment, Peace,
Trade, history and sequences. It creates an empty response authority and derives only
references to currently pending required proposals. Physical recovery/threat discovery
uses current domain truth on first observation; no historical emergency, action, sample,
relief or conflict fact is reconstructed.

`responseStateProblems` checks exact identity/ownership, lane/subject binding, lifecycle,
timer validity, exclusive primary ownership, exact plans, operation provenance and dormant
timer absence. Existing invariants additionally enforce finite emergency occupancy and
canonical claims. Pending overdue material boundaries are earned work to process, not
permission to rewind physical state.

`inspectNonProactiveWork` supplies server-only priority, trigger reference, timing, chosen
plan, physical blockage and feasibility diagnostics. Public serializers/Unity and
counterparty views exclude contexts, priority, modifiers, timer/RNG state and deliberation.
Diagnostics/history are never re-read as authority.

**UNRESOLVED / DEFERRED:** the repository's current world-tick army movement and immediate
AI battle prototype do not implement all broader final Temporal V2 battle rules (120/1800
post-arrival battle/window, guaranteed defense finalization, frozen participant/virtual
survivor lifecycle). Those are existing physical-domain integration gaps, not repaired by
changing battle math or timing here. Spatial recovery and cargo remedies remain undefined.
Existing required-response policies remain independently provisional. Large retained
history still participates in persistence/cloning/invariant costs; no compaction policy
is invented. No final hysteresis/repetition or later-phase tuning is included.

## Validation and diagnostics

Focused results: A 17, B 28, C 60, D 41, E 55, F 73, G 78, H 85, I 90, J 83,
K 84, **L 60**; **754 passed, zero failed**. New tests cover queue identity/priority,
bounded primary thread, preemption, exact shared execution, claim/CAS rollback,
critical overflow/release, required freshness/privacy, blocked custody, reload,
coarse/fine equivalence and event-driven observer hot paths. Prior invariant assertions
remain; schema and documented state-domain expectations advance to 27.

Anchors/movement/strategic attack/invasion/economy/persistence/temporal/session/replay
integration suite: **319 passed, zero failed**. Full suite and final static results are
recorded below. Test-inclusive compilation retains the identical
28 existing diagnostics, compared by file/code/message with an exported Phase K baseline;
production compilation introduces none.

Diagnostics used actual domain handlers and canonical fixture authoring. Quiet fixtures
have no forces, no useful unbuilt structure/resource source and no response event. Stress
proposal/cargo fixtures are valid independently identified exact operations/claims; no
fictional cargo is appended to acceptance. Timings are host measurements, not policy.

| Fixture | ms | Full thoughts | Plans evaluated | Starts | Context result |
| --- | ---: | ---: | ---: | ---: | --- |
| 12 factions / 10,000 no-source ticks | 3,152 | 0 | 0 | 0 | 0 observer scans, contexts, history rows |
| 100 required Trades | 56 | 100 required | existing recipient assessments | 0 | 100 settled; no queued remainder |
| 200 physical emergency contexts | 64 | 200 | 0 | 0 | 200 handled once; 1,000 unchanged calls add no thought |
| 200 blocked cargo recoveries | 22 | 0 | 0 | 0 | 200 dormant, conserved; 1,000 calls add no thought |
| Critical + required + blocked movement | 21 | 2 | 4 | 0 | required response settles; inferior intervention rejected |
| 25 reload + coarse/fine replays | 185 | 50 | 100 | 0 | exact equivalent canonical states |
| Actionable local defensive REINFORCE | 6 | 1 | 5 | 1 | exact initiation/allocation; no proactive deliberation |

Comparable Phase K quiet baseline: **2,930 ms**, same 12-faction/10,000-tick fixture,
zero operations/history. Phase L: **3,152 ms** (~7.6% difference in this measurement).
Quiet fixture queue checks: 40,000 cheap empty-index checks at existing world/completion
boundaries; no Phase L timer wakes, physical/recovery scans, context creation or evaluation.
Other fixture queue checks: required 2, emergency burst 1,201, cargo burst 1,000, mixed 8,
reload/fine-coarse 951, actionable reinforcement 8. Domain observer scans respectively:
0 / 1 / 2 / 2 / 6 / 1 / 3.

Classification: bounded expected bookkeeping; no significant quiet-world regression.
The review removed the initial per-world-tick observer rescan, a Phase-L-local performance
defect. No tuning, physical timing change, weakened determinism or history deletion was used.

## Final verification record

**Final validation passed:** full suite **1,833 passed / 0 failed**; A–L focused
**754 passed / 0 failed**; affected integration suite **319 passed / 0 failed**.
Production TypeScript `--noEmit` passes. Test-inclusive TypeScript has exactly the same
28 baseline diagnostics, zero new/removed file/code/message identities. `git diff --check`
passes. Final scope is 46 files (39 modified, 7 new), all unstaged/uncommitted.
HEAD remains `7b6cf00a639b6ed1b17302713ef13ad6d2ea195f` on `work`.
No commit was created, nothing was pushed, and no later phase was started.

## File manifest

46 intended files: 39 modified and 7 new. Domain-file changes are notification hooks only; battle mathematics, travel/construction durations, recruitment arithmetic/tuning, Unity, fitness and package/project configuration remain unchanged.

New:

```text
docs/AI_PHASE_L_NON_PROACTIVE_COGNITION.md
src/constants/aiResponse.ts
src/engine/nonProactiveCognition.ts
src/engine/responseRecords.ts
src/state/responseInvariants.ts
src/types/AIResponse.ts
tests/aiResponses.ts
```

Modified:

```text
src/army/movement.ts
src/army/strategicAttack.ts
src/engine/concretePlans.ts
src/engine/decisionOpportunities.ts
src/engine/operations.ts
src/engine/proactiveCognition.ts
src/engine/strategicAttention.ts
src/gameplay/diplomacy/peace.ts
src/gameplay/economy/ownership.ts
src/gameplay/invasion/create.ts
src/gameplay/recruitment/recruitment.ts
src/gameplay/trade/trade.ts
src/orchestration/applyBattle.ts
src/orchestration/handlers.ts
src/orchestration/transaction.ts
src/persistence/versioning.ts
src/scoring/contextPlanComparison.ts
src/state/cloneGameState.ts
src/state/gameStateInvariants.ts
src/types/AIOperation.ts
src/types/AIStrategy.ts
src/types/GameState.ts
tests/aiCognition.ts
tests/aiConflict.ts
tests/aiPeace.ts
tests/aiRecruitment.ts
tests/aiStrategicPressure.ts
tests/aiTrade.ts
tests/commandIdempotency.ts
tests/economyFoundation.ts
tests/gameplaySessionLeases.ts
tests/gameplaySessionLifecycle.ts
tests/invasionLifecycle.ts
tests/leaseWorldAccrual.ts
tests/persistence.ts
tests/presenceLeases.ts
tests/run.ts
tests/sessionReplay.ts
tests/temporalBoundaries.ts
```
