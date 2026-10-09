# Phase I — Trade proposals, reservations, and physical delivery

Implementation and independent review record, 2026-10-09. Product authority remains
`REP_WARS_AI_Decision_Engine_Source_of_Truth_v1.0.md`; this document does not
replace it. No later AI phase has been started.

## Baseline and scope

- Branch: `work`.
- Implementation baseline HEAD: `f6066bccf36415436dfb9dadf0e2fb9b682c0981`
  (`AI: peace lifecycle and required responses`).
- Parent: `2812e3547feed67191f13ef6a9ceef1e081d7983`.
- Starting working tree: clean. Initial implementation was left uncommitted.
  Independent review subsequently authorized a local checkpoint after all checks;
  the exact checkpoint hash is reported outside this document. Nothing pushed.
- Schema: **24**, from 23. New canonical proposal and shipment maps require a
  schema change; evaluator results and diagnostics remain derived.
- Scope: Trade implementation, existing canonical integration points, focused
  tests, schema expectations, and this implementation record. Unity, packages,
  workout/fitness, battle mathematics, authored construction costs/durations,
  army movement duration definitions, recruitment tuning, and Peace product
  rules are unchanged.

## Canonical ownership and exact plans

`GameState.tradeProposals` owns Trade proposal state. Each proposal links to its
canonical AI operation; that operation owns offered-resource claims, Attention,
and initiation timing. `GameState.tradeShipments` owns accepted physical cargo.
These are domain records in the same GameState/CAS transaction, not separate
stores. Derived live-key indexes accelerate lookup and rebuild on clone/reload.
History never supplies lifecycle authority.

`TradePlan` fixes faction, counterparty, offered/requested resource bundles,
exact proposer source manifest, dispatch/receiving nodes, and the proactive
source-context ID. Plan identity includes these meaningful parameters in the
existing deterministic concrete-plan identity format. Execution cannot change
the recipient, resource types, quantities, or source. Optional fields remain in
the serialized compatibility type, but current execution rejects incomplete
historical plans rather than fabricating exact parameters.

Current resources are authoritative faction banks. `territoryEconomy.uncollected`
is separate and is not an alternate Trade source. Only supported `faction_stock`
manifests can execute. No imaginary territory-local stockpile is introduced.

Proposal IDs derive from the persisted canonical operation ID. Bilateral
shipment IDs derive from proposal ID plus offered/requested direction. Claim
IDs encode exact operation, faction, and resource. No timestamp, runtime counter,
Map insertion order, random UUID, or selection RNG chooses these identities.

## Reservation, initiation, and terminal ownership

Initiation freshly validates the exact plan and atomically acquires offered
resource quantity claims and proposer Attention, creates the operation/proposal,
and starts the persisted **2s online / 60s offline** timer. All of this uses the
existing cloned-state transaction and CAS boundary. Failed start rolls back
claims, resource changes, operation, identity sequence, and Attention.

Offered goods remain owned in their original bank during initiation and pending
response. Available stock is bank quantity minus active exact resource claims.
The requested recipient side stays unreserved until ACCEPT, including if it was
sufficient at publication and becomes insufficient before response.

Construction spending, empire Food upkeep, and event costs/resource losses honor
the reservation floor. Their existing behavior is preserved when no resource
claims exist. Normal collection still adds earned resources; it is not converted
to automatic collection or localized storage. An already-started BUILD has paid
its existing authoritative cost, so Trade cannot reuse that deducted quantity.

The proposer holds existing configured Trade Attention (initial non-final cost
1) through initiation and pending response. ACCEPT, DECLINE, EXPIRY, permitted
player withdrawal, counteroffer replacement, and hard invalidation all settle
through the central operation reducer. It releases only that operation's claims
and Attention and clears the response. Terminal replay is idempotent. Accepted
shipment work holds **no diplomatic Attention**.

AI proposers cannot voluntarily withdraw. A player may withdraw its own pending
offer without transferring anything. Hard initiation invalidation creates no
published offer, pressure relief, successful spacing, or shipment; the initiating
record is retained as terminal history.

## Required responses and counteroffers

Required Trade response is deadline/event driven, integrated alongside Phase H
required responses, and precedes ordinary proactive thought. It bypasses
proactive Attention saturation, source-pressure readiness, and reconsideration
spacing. Existing committed primary initiation is not interrupted; unfinished
ordinary deliberation yields to required work.

Automatic AI response currently chooses **ACCEPT_TRADE or DECLINE_TRADE** using
fresh fulfillment legality and the recipient's own factual RESOURCE_VALUE
marginal gains/losses. It does not recursively run strategic cognition, inspect
raw Memory, invent war penalties, or use Pressure as an eligibility requirement.
Player recipient commands can accept or decline exact terms.

`COUNTEROFFER_TRADE` accepts a complete exact reverse-participant plan. In one
nested transaction it terminalizes the old offer, releases old claims/Attention,
creates a new proposal/operation/identity, reserves the new proposer's offered
side, and records ancestry. Failure restores the entire original offer. The
replacement uses normal Trade initiation before publication to the new recipient.
No in-place term mutation, proactive NEGOTIATE, or autonomous bargaining policy
has been added. Automatic AI counteroffer selection is not implemented; exact
counteroffer response execution is available.

There is **no global, faction, or pair-level pending Trade cap**. Several offers
from the same proposer, including the same pair with independent manifests, may
remain pending subject to actual quantities and Attention. Only one new primary
initiation occupies the existing proactive thread at a time.

Trade is independent of WAR, pending Peace, PENDING_HOSTILITIES_CLEARANCE, and
PEACE. Neither publication nor acceptance creates a ceasefire, prevents ATTACK,
or automatically destroys/intercepts accepted cargo.

## Atomic acceptance and conservation

Before mutation, ACCEPT checks pending status, current active participants,
exact proposer manifest and claims, current recipient unreserved availability,
exact endpoints, and bilateral routes. Current recipient source selection is
the one actual faction bank, using canonical resource-key order, with no RNG.

Both sides then atomically leave their banks and enter two exact canonical cargo
manifests. Recipient quantities are allocated directly into custody in this
transition; no lingering recipient claim or prior pending reservation is needed.
No partial shipment state or one-sided resource deduction can be committed.
Proposer claims transform into custody by central terminal settlement.

Cargo is unavailable to subsequent Trade, BUILD, or upkeep. Delivery credits the
recipient only after physical unloading. Successful delivery marks the manifest
terminal before it can be replayed. Decline/expiry/withdrawal/counteroffer creates
no shipment or recipient credit. Safe-integer overflow at receipt blocks intact
cargo rather than rounding or duplicating quantities.

Normal acceptance/transit/delivery conserves each resource exactly across free
banks plus undelivered custody. Delivered records are historical proof, not
additional usable stock. Tests isolate independently authored world-event losses
when asserting Trade-only conservation.

## Physical delivery and timing

Accepted manifests progress through `loading → transit → unloading → delivered`.
Routes and sampled/persisted leg progress are canonical, not evaluator forecasts.

| Process | Online | Offline |
| --- | ---: | ---: |
| Trade initiation | 2s | 60s |
| Loading | 10s | 60s |
| Unloading | 5s | 30s |

Loading/unloading reuse authoritative duration progress, persisted fractions,
server-derived presence, promotion without demotion, and existing clock domains.
Route hops reuse **existing `calculateMovementDuration` and world-tick movement
authority**. This phase does not rewrite force travel to final Temporal V2 ranges
or add an approximate second travel formula.

Physical shipment progression occurs before simultaneous deadline/world-event
choices and before required responses/proactive cognition. Receipt-clock anchoring
translates persisted timestamps without earning additional work or rerolling.
Client timestamps, server latency, and real-world response gates do not substitute
for physical travel progression.

## Explicit provisional policies

The following are all **PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION
REQUIRED**, not locked product doctrine:

1. **Endpoints:** a faction bank has no authored physical location. Exact owned
   territories are dispatch/receiving nodes, not newly invented stockpiles.
   Generated plans use the first owned node by stable code-unit ID ordering;
   explicit plans can select another owned node. Receipt credits the actual bank
   only after unloading at the exact receiving node.
2. **No route at ACCEPT:** both graph routes must currently exist. Failure leaves
   the proposal pending and offered stock reserved; it does not lose, transfer,
   or teleport resources. Stable shortest-hop BFS uses the real territory graph;
   WAR is not an invented access exclusion.
3. **Accepted interruption:** topology/receiving-node loss preserves exact cargo,
   route, and elapsed work in `blocked`. No refund, seizure, destruction, automatic
   reroute, or return destination is invented. Blocked work does not repeatedly
   wake on an expired timer; a future recovery policy is still required.
4. **Trade-specific response timing:** none is authored in the Source of Truth.
   One centralized proposal-response fallback uses seeded AI **3–8s online /
   30–80s offline**, and player **300s online / 7200s offline**. AI durations are
   sampled once and persisted; expiry does not fabricate DECLINE cognition.

`src/gameplay/trade/policy.ts` isolates endpoints/routes/interruption policy;
`src/constants/trade.ts` isolates response fallback. These do not redesign the
general economy, logistics, or proposal framework.

New bounded-generation batch **50** and resource comparison weight **100** are
**INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN**. Existing Attention,
recruitment, battle, and construction tuning was not changed.

## Pressure, candidates, evaluation, and committed baseline

TRADE_ECONOMIC sources require factual complementary shortage/surplus, using
currently eligible authored construction demand and applicable upkeep. Stock
existence alone creates no source. The cheap observer identifies known
complementary counterparties without concrete plans, routes, scoring, or RNG;
zero-stock/no-need/no-surplus cases avoid partner enumeration.

Declared complete bound per selected known counterparty: one capped exact exchange
for each ordered pair of distinct resources meeting both sides' complementary
need/surplus. With five current resources this is at most **20 plans**, not all
quantity combinations. Exact available quantities exclude active reservations.
Stable plan IDs/order and source-context binding survive reconstruction.

Within-context comparison uses the existing **RESOURCE_VALUE** evaluator for
offered marginal loss and requested marginal gain, each with one causal owner.
Logistics/timing and recipient acceptance uncertainty remain factual support.
The proposer estimate accepts only visible exact terms and deliberately returns
limited [0,1] acceptance bounds; it cannot inspect recipient-private Goals,
Opinion, Pressure, Memory, risk, deliberation, or future RNG.

Exactly seven evaluators and eight proactive categories remain. No TRADE_VALUE,
NEGOTIATE, or DECLARE_WAR scoring path is introduced. Actual recipient assessment
uses its own canonical factual view. Pending offered claims reduce usable stocks;
accepted cargo is explicitly represented in the committed-effects baseline with
actual timing/progress, never credited as already-delivered bank stock.

## Migration, invariants, history, and privacy

Schema 23 and older gain empty proposal/shipment maps. No historical Trade,
shipment, stock change, timer, source context, or claim is fabricated. Existing
operations, claims, Attention, Peace, pressure, IDs, and high-water marks remain
intact. Schema 24 missing canonical maps is corruption rather than remigration.
Clone/hydrate/serialize retain isolated nested exact plans, bundles, routes, and
timers; live indexes rebuild from records.

Invariants cover exact identity/plan/operation binding, participants and bank
source, valid bundle quantities, pending claims, aggregate reservation limits,
timers, terminal ownership release, bilateral accepted manifests, counteroffer
ancestry, route/progress/phase validity, delivery markers, and orphan resource
claims. Semantic field comparison is independent of JSON key insertion order.

History emits stable offered/terminal/shipment-created/delivered lifecycle rows,
never a row per resource unit. It is diagnostic, idempotent by transition, and
does not become a second resource or proposal authority.

Public output includes participant-visible published terms, status, player
response window, and physical shipment facts. It omits initiating private plans,
source manifests, AI timers, acceptance estimates, RNG, Goals/Opinion/Memory,
Pressure, and candidate explanations. Unrelated viewers do not see proposal terms.

## Corrections made during implementation review

- Added Trade to source-bound primary initiation invariants; protected by a real
  AI_DECIDE → exact selection → operation initiation → publication regression.
- Blocked cargo no longer retains an expired-timer wake loop. Custody and elapsed
  work remain intact while timers stop accruing/creating repeated boundaries.
- Resource claims compare semantic fields, not JSON insertion order.
- Reservation-aware spending includes upkeep and event costs/losses, not just
  BUILD and second Trade.
- Physical delivery is ordered before simultaneous world deadlines/events.
- Strengthened physical tests to advance through actual authoritative world
  commands, including fine/coarse progression, unload, and reload equivalence.

## Initial implementation validation (before independent review)

| Suite/check | Result |
| --- | ---: |
| Phase A canonical reasoning | 17 passed |
| Phase B exact plans | 28 passed |
| Phase C operations | 60 passed |
| Phase D Attention/concurrency | 41 passed |
| Phase E pressure | 55 passed |
| Phase F evaluation | 73 passed |
| Phase G recruitment | 78 passed |
| Phase H Peace | 85 passed |
| Phase I Trade | **71 passed** |
| Independent anchors | 16 passed |
| Invasion | 24 passed |
| Economy foundations / cities / developments | 22 / 24 / 15 passed |
| Persistence | 45 passed |
| Temporal/schema/session/lease/idempotency/replay focused integration | 117 passed |
| Full existing suite including Phase I | **1,587 passed, 0 failed** |
| Production TypeScript `--noEmit` | Passed |
| Test-inclusive TypeScript | Same 28 pre-existing diagnostics, no new diagnostics |
| `git diff --check` | Passed |

Test-inclusive fingerprints match the recorded baseline after stripping only
source line/column offsets. Focused integration totals overlap the full suite;
they are not additional unique tests. Construction and Peace/attack coexistence
are exercised by the full suite and Trade-focused reservation/war regressions.

All test runners use the existing ts-node transpile-only test convention; passing
runtime tests are not a claim that test-inclusive type checking is clean. New
Trade test code itself introduces no diagnostics.

## Initial implementation diagnostics (before independent review)

Production Orchestrator, world progression, timers, and CAS paths were exercised
with derived, non-persisted instrumentation. Conservation fixtures suppress
independent random world events, not Trade or movement authority. Counts below
include actual function invocations; candidate emissions can repeat during fresh
authorization and are not claimed as unique plans. Metrics from two reload
branches aggregate work across both independently executed equivalent branches.

| Fixture | ms | Source observations | Full proactive deliberations | Candidate emissions | Required AI responses | Claims acquired/released | Accept/decline/counteroffer | Shipments/delivery calls | History rows |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |
| No sources: 12 active factions, 10,000 ticks | 3,508 | 240,000 | 0 | 0 | 0 | 0/0 | 0/0/0 | 0/0 | 0 |
| Two same-pair independent pending offers | 17 | 8 | 0 | 0 | 0 | 2/0 | 0/0/0 | 0/0 | 2 |
| Requested Food spent before response | 9 | 4 | 0 | 0 | 0 | 1/1 | 0/1/0 | 0/0 | 2 |
| Bilateral acceptance through physical unload | 38 | 136 | 0 | 0 | 0 | 1/1 | 1/0/0 | 2/2 | 6 |
| Exact counteroffer replacement | 10 | 8 | 0 | 0 | 0 | 2/1 | 0/0/1 | 0/0 | 3 |
| Reload pending, equivalent branches | 17 | 12 | 0 | 0 | 0 | 1/0 | 0/0/0 | 0/0 | 1 |
| Reload cargo, equivalent delivered branches | 72 | 258 | 0 | 0 | 0 | 1/1 | 1/0/0 | 2/4 | 8 |
| Genuine profitable source, canonical AI selection | 13 | 7 | 1 | 11 | 0 | 1/0 | 0/0/0 | 0/0 | 1 |
| Automatic required response, constrained Attention and active spacing | 4 | 15 | 0 | 0 | 1 | 1/1 | 0/1/0 | 0/0 | 2 |

Every fixture selected zero WAIT. Trade starts respectively: **0, 2, 1, 1, 2, 1,
1, 1, 1**. The reload-cargo fixture ends each branch with exactly two delivered
manifests and six retained history rows; four delivery calls/eight instrumented
new rows aggregate both branches, not duplication inside one world.

The requested-side fixture performs actual upkeep before rejecting/declining;
its Food reduction is an independently authored economy effect. In normal
bilateral and reload delivery fixtures, combined bank-plus-cargo Wood and Food
remain exactly 300 each. Pending/counteroffer fixtures conserve the same totals.

Automatic required responses, deadline expiry, saturation bypass, and response
determinism are covered by focused production-path tests. The additional automatic
response diagnostic completes one required AI response despite constrained normal
Attention and active proactive spacing, with no proactive deliberation. Other
listed explicit response diagnostics report zero automatic responses rather than
mislabeling command execution as AI cognition.

Performance classification: bounded additional domain work, with no full
deliberation in the no-source fixture and no hot-path scan of terminal Trade
history. A 5,000-terminal-record regression makes terminal-map iteration throw
and verifies live processing still succeeds. No compaction policy was invented.

## Remaining unresolved/deferred work

- Product confirmation of endpoint/no-route/accepted-interruption policy and
  Trade-specific response timings.
- Generalized resource-local stockpiles/logistics and future cargo recovery or
  convoy rules; none were fabricated here.
- More informative proposer response estimates and autonomous exact AI
  counteroffer selection. Current factual ACCEPT/DECLINE and explicit exact
  counteroffer lifecycle are operational.
- Final Goal/Opinion/Conflict Ledger and general reactive/recovery architecture
  remain deferred, as do terminal-history compaction and unrelated timing work.
- No conflict with locked Source-of-Truth rules was found within this bounded
  phase. Remaining final resource-locality and travel-timing designs are not
  falsely claimed as already implemented.

Initial Phase I implementation stopped for independent review. The review below
records scoped corrections and validation before the authorized local checkpoint.
No later phase or push is authorized here.

## Independent adversarial review and checkpoint

**Verdict: PASS AFTER PHASE-I-SCOPED CORRECTIONS.** The review traced current
production handlers, transaction/CAS flow, claims, all resource consumers,
required responses, physical progression, persistence, invariants, and diagnostics.
It added **19 focused regressions** without removing or weakening existing ones.
Schema remains **24**: the new shipment halt marker belongs to this unreleased
Phase I schema, not a new historical migration.

### Defects reproduced and corrected

1. **Endpoint loss detected late:** dispatch conquest during loading and receiving
   node loss during transit were not checked immediately. Reproducing tests failed
   before correction. `tradeShipmentNodeProblem` now stops affected undelivered
   work at its true boundary, preserves cargo, and gives no new owner credit.
   Losing the old dispatch node *after departure* does not erase outgoing travel.
2. **Blocked transit had no halt frontier:** the original committed baseline
   reported blocked transit as fully progressed. `blockedAtTick` persists the exact
   halt boundary; factual remaining/progressed work stops there while the world
   continues. Blocked load/unload timer work remains frozen and creates no polling
   wake. No recovery destination or policy was added.
3. **Hydration could skip arrival:** unloading/delivered records were not required
   to be at the final route index with cleared transit state. Invariants now reject
   premature unload, contradictory physical phases, invalid halted work, and stale
   halt markers. The corrupt-save regression failed before correction.
4. **ACCEPT claim check was incomplete:** wrong bank subject could survive its
   preflight even though later invariants detected it. ACCEPT now verifies every
   semantic claim field, including identity, kind, subject and scope, before any
   resource allocation. The regression failed before correction.
5. **Committed receipts were recorded but ignored in residual exchange need:**
   accepted inbound custody now reduces residual future Trade shortage and the
   marginal value of additional gains. It remains unavailable for any current
   spending/outgoing offer; loss affordability still uses actual free bank stock.
   Blocked cargo does not promise arrival. Coverage saturation is derived support,
   never a new quantity ledger. No evaluator, score weight, or future simulation
   was introduced. The committed-baseline regression failed before correction.
6. **Unroutable ordinary candidates:** proactive generation could select current
   terms that could not satisfy the provisional bilateral ACCEPT-route rule.
   It now consults the same `tradeAcceptanceRoutes` policy once per shared-endpoint
   scope. Explicit proposal publication still permits recipient insufficiency or
   no current route; it reserves offered stock without promising ACCEPT. The
   route-generation regression failed before correction.

### Adversarial guarantees verified

- **Atomicity:** a fault injected on insertion of the second cargo manifest rolls
  back both bank deductions, the first manifest, claims, Attention, timer sequence,
  proposal state and history through the real cloned transaction. Stale CAS save
  tests prevent two committed acceptances. No one-sided state becomes authoritative.
- **Recipient freedom:** pending requested goods fund BUILD, upkeep, event costs,
  and another outgoing offer; the incoming proposal creates no recipient claim.
  ACCEPT rechecks exact current availability and cannot incur debt or partial terms.
- **Conservation/no teleport:** bank plus undelivered cargo totals remain exact;
  ACCEPT credits neither recipient immediately. Physical loading, actual movement,
  unloading and one-time credit are distinct phases. Tests advance real world
  commands and replay response/progression/terminal paths without duplicate history.
- **Concurrency:** separate quantities may share one bank; same-pair and different-
  counterparty offers coexist. The six-offer stress fixture derives its capacity
  from configured Trade cost; an additional offer fails atomically. No global or
  pair uniqueness rule, broad resource lock, or faction-wide operation gate exists.
- **Counteroffer:** exact reverse terms receive a new operation/proposal and new
  claims. Failure restores the old pending offer; replay cannot spawn a second
  replacement. Replacement reload retains ancestry and resource ownership.
  No autonomous counteroffer strategy or proactive NEGOTIATE was introduced.
- **Attention/required response:** proposer charge is retained only through proposal
  management and released once centrally on every terminal route. Cargo has no
  diplomatic charge. Required AI response proceeds independently of proactive
  Pressure, spacing and normal Attention saturation; actual settlement revalidates.
- **War/Peace:** real Trade initiation works at WAR and during existing relationship
  exceptions. Pending Peace and Trade coexist without settling each other. Trade
  leaves hostility permission intact during pending, accepted and shipment phases.
- **Scoring/privacy:** exactly eight `PROACTIVE_AI_ACTIONS` and seven
  `STRATEGIC_EVALUATORS` remain. RESOURCE_VALUE owns exact gain/loss causes;
  timing/response estimate remain support. The proposer estimate receives visible
  terms only. No private recipient state, future RNG or evaluator explanation is
  exposed. Legacy CLI/scorer paths remain isolated historical harnesses, not an
  alternative authoritative Trade store or canonical cognition fallback.
- **Persistence:** initiation, pending/response, counteroffer replacement, load,
  transit, unload and blocked work retain IDs, exact quantities, claims and timers.
  Schema 23 migration initializes empty Trade maps and preserves Phase H physical,
  Peace, recruitment, operation/sequence and Attention state; no vague historical
  Trade becomes a real proposal. Stable IDs, sorted routes and code-unit ordering
  preserve reconstruction/insertion-order equivalence.

### Four provisional policies after review

All retain **PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED**.

| Policy | Review classification and replaceable surface |
| --- | --- |
| A. Bank dispatch/receipt nodes | Isolated and replaceable: `tradeNode`, `tradeEndpointProblem`, `tradeShipmentNodeProblem` in `policy.ts`. No fabricated local quantities. |
| B. Both routes at ACCEPT | Isolated and replaceable: `tradeAcceptanceRoutes` is shared by fresh acceptance, response legality and proactive feasibility; RESOURCE_VALUE contains no route eligibility rule. |
| C. Interrupted accepted custody | Conserved, canonical, non-polling. Node checks are policy support; central shipment block records reason/halt and preserves exact cargo/elapsed work. No seizure/refund/reroute/recovery. |
| D. Response timing reuse | Independent Trade-owned `TRADE_RESPONSE_POLICY` in `constants/trade.ts`; does not import or depend on Peace policy constants. |

Dispatch ownership matters before departure; receipt ownership matters for all
undelivered work. The chosen response ranges and endpoint/route/interruption
policies are not promoted to product doctrine. Automatic counteroffer selection,
local stockpile/logistics redesign, final cargo recovery, interception, Goal/
Opinion/Conflict Ledger, broad reactive scheduling and compaction stay deferred.
No locked Source-of-Truth conflict was found within the reviewed bounded phase.

### Final validation

| Check | Result |
| --- | ---: |
| Phase A / B / C / D focused | 17 / 28 / 60 / 41 passed |
| Phase E / F / G / H focused | 55 / 73 / 78 / 85 passed |
| Phase I focused | **90 passed, 0 failed** |
| Anchors / invasion / economy foundations / cities / developments / persistence | 16 / 24 / 22 / 24 / 15 / 45 passed |
| Temporal/schema/session/leases/idempotency/replay integration | 117 passed |
| Full suite after final regression | **1,606 passed, 0 failed** |
| Production TypeScript `--noEmit` | Passed |
| Test-inclusive TypeScript | Same 28 pre-existing diagnostic fingerprints, no new diagnostics |
| `git diff --check` | Passed |

Focused integration includes construction and invasion truth; Trade-specific
regressions also cover construction spending and Peace/attack coexistence. Counts
are not additive to the full suite. Runtime tests retain the established existing
transpile-only convention; test-inclusive type checking is not reported as clean.

### Review performance and conservation diagnostics

Same fixtures and production pathways, extended with phase-change instrumentation
and an explicit six-offer stress fixture. Total elapsed is measured after the main
regression runs, not interpreted as guaranteed production throughput. Source
observations are cheap probes; candidate counts are emissions including repeated
fresh authorization, not unique scored plans. Explicit response commands are not
miscounted as required AI deliberation. Shipment phase changes exclude same-phase
route-hop progress; reload metrics aggregate two equivalent execution branches.

| Fixture | ms | Observations | Proactive/required deliberations | Candidates | Claims acquired/released | Accept/decline/counter | Shipments/phase changes/deliveries | History rows |
| --- | ---: | ---: | --- | ---: | --- | --- | --- | ---: |
| no-source / 12 factions / 10000 ticks | 2716 | 240000 | 0/0 | 0 | 0/0 | 0/0/0 | 0/0/0 | 0 |
| several pending / same-pair independent manifests | 11 | 8 | 0/0 | 0 | 2/0 | 0/0/0 | 0/0/0 | 2 |
| recipient spends requested side | 4 | 4 | 0/0 | 0 | 1/1 | 0/1/0 | 0/0/0 | 2 |
| accepted bilateral / load route unload | 26 | 136 | 0/0 | 0 | 1/1 | 1/0/0 | 2/6/2 | 6 |
| counteroffer replacement | 4 | 8 | 0/0 | 0 | 2/1 | 0/0/1 | 0/0/0 | 3 |
| reload pending / equivalent branches | 7 | 12 | 0/0 | 0 | 1/0 | 0/0/0 | 0/0/0 | 1 |
| reload cargo / equivalent delivered branches | 43 | 258 | 0/0 | 0 | 1/1 | 1/0/0 | 2/10/4 | 8 |
| actual profitable source / canonical selection | 14 | 7 | 1/0 | 11 | 1/0 | 0/0/0 | 0/0/0 | 1 |
| automatic required response / constrained Attention + spacing | 4 | 15 | 0/1 | 0 | 1/1 | 0/1/0 | 0/0/0 | 2 |
| stress / six same-faction nonoverlapping offers | 16 | 24 | 0/0 | 0 | 6/0 | 0/0/0 | 0/0/0 | 6 |

All fixtures select zero WAIT. Trade starts by fixture: **0, 2, 1, 1, 2, 1, 1, 1,
1, 6**. No-source run retains zero proposals, shipments or resolution/history rows.
Before review its measured elapsed time was 3,508ms; after review **2,716ms** with
240,000 cheap source probes and zero full cognition. This is ordinary run variance,
not a claim that the corrections alone caused a speedup.

The accepted fixture creates two shipments, makes six physical phase changes and
delivers exactly twice. The reload-cargo fixture reports four delivery calls over
two branches; each final world has only two delivered shipments and six retained
history rows. Wood and Food remain exactly 300 in isolated normal/counteroffer/
reload fixtures. Requested-side Food spending is an existing upkeep effect, not
Trade loss. The stress case keeps six offers/claims, rejects another start without
partial effects, and survives reload with the same claim quantities.

Performance classification: **bounded additional work; no unexplained pathological
regression**. No-source cognition remains zero; live query guards exclude 5,000
terminal Trade records. Whole-state clone/invariant/persistence cost still includes
retained canonical ledger size at transaction boundaries; no compaction/archive
policy was invented or claimed. Diagnostic counters remain derived and unpersisted.

### Checkpoint scope

Final scope is **54 files: 43 modified, 11 new**, including this review record and
one additional Phase-I-scoped correction in `scoring/strategicEvaluators.ts`.
Protected fitness/Unity/package/battle/movement/construction-duration/recruitment-
tuning files are unchanged. The authorized local commit message is
`AI: trade proposals and physical delivery`, with direct parent
`f6066bccf36415436dfb9dadf0e2fb9b682c0981`. The external completion report records
its exact hash and the verified clean working tree. Nothing is pushed. Stop here.

## Final file inventory

54 changed files: 43 modified, 11 new.

Created:

- `docs/AI_PHASE_I_TRADE_LIFECYCLE.md`
- `src/constants/trade.ts`
- `src/gameplay/trade/candidates.ts`
- `src/gameplay/trade/policy.ts`
- `src/gameplay/trade/records.ts`
- `src/gameplay/trade/resources.ts`
- `src/gameplay/trade/trade.ts`
- `src/scoring/tradeAssessment.ts`
- `src/state/tradeInvariants.ts`
- `src/types/Trade.ts`
- `tests/aiTrade.ts`

Modified:

- `src/engine/concretePlans.ts`
- `src/engine/executableActions.ts`
- `src/engine/operations.ts`
- `src/engine/proactiveCognition.ts`
- `src/engine/strategicPressure.ts`
- `src/events/EventModel.ts`
- `src/events/WorldSimulator.ts`
- `src/gameplay/construction/consume.ts`
- `src/gameplay/economy/foodConsumption.ts`
- `src/orchestration/commandIndex.ts`
- `src/orchestration/handlers.ts`
- `src/orchestration/publicView.ts`
- `src/orchestration/transaction.ts`
- `src/persistence/versioning.ts`
- `src/scoring/contextPlanComparison.ts`
- `src/scoring/factualSupport.ts`
- `src/scoring/strategicEvaluators.ts`
- `src/state/cloneGameState.ts`
- `src/state/gameStateAdapters.ts`
- `src/state/gameStateInvariants.ts`
- `src/state/pressureInvariants.ts`
- `src/types/AIConcretePlan.ts`
- `src/types/AIOperation.ts`
- `src/types/GameState.ts`
- `src/world/ContinuousWorldEngine.ts`
- `src/world/aiTemporal.ts`
- `tests/aiConcretePlans.ts`
- `tests/aiOperations.ts`
- `tests/aiPeace.ts`
- `tests/aiRecruitment.ts`
- `tests/aiStrategicPressure.ts`
- `tests/commandIdempotency.ts`
- `tests/economyFoundation.ts`
- `tests/gameplaySessionLeases.ts`
- `tests/gameplaySessionLifecycle.ts`
- `tests/invasionLifecycle.ts`
- `tests/leaseWorldAccrual.ts`
- `tests/orchestratorIntegration.ts`
- `tests/persistence.ts`
- `tests/presenceLeases.ts`
- `tests/run.ts`
- `tests/sessionReplay.ts`
- `tests/temporalBoundaries.ts`
