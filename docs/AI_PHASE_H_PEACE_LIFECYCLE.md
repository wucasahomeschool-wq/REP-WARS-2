# Phase H — Peace proposals, default WAR and required responses

## Scope and baseline

Implemented on local `work`, starting at `2812e3547feed67191f13ef6a9ceef1e081d7983`
(`AI: local recruitment and pool-based reinforcement`). Schema advances from 22
to 23. The final AI Source of Truth is the product authority; this document is
an implementation record. The independent review is recorded in
`AI_PHASE_H_REVIEW.md`; a local checkpoint is authorized only after validation.
Nothing was pushed.

No Trade lifecycle, Conflict Ledger, Goal/Opinion lifecycle, general reactive or
recovery scheduler, new spatial recovery policy, history compaction, resource
logistics, Unity or fitness implementation is included. Battle mathematics,
movement durations, construction durations and recruitment tuning are unchanged.

## Canonical authority and identities

`GameState.peaceRelationships` stores only bilateral non-WAR exceptions:
`PENDING_HOSTILITIES_CLEARANCE` and `PEACE`. Absence means `WAR`. Directed legacy
relationship sentiment and Opinion cannot create or terminate legal Peace.

`peaceProposals` owns proposal lifecycle and response timing. The persisted
`peaceProposalThreads` index references the one live proposal for an unordered
pair; it does not duplicate proposal state. Live progression uses that index,
not scans of the terminal proposal ledger. Different pairs can coexist.

Pairs use code-unit-sorted complete faction IDs encoded as JSON. Proposal IDs
are derived from the owning operation ID, which retains the persisted faction
sequence and exact faction suffix established in Phase C. No timestamps,
runtime counters, UUIDs or insertion order provide identity.

The exact OFFER_PEACE plan retains proposer and counterparty throughout
selection, initiation and settlement. The operation owns proposer Attention;
the proposal owns response lifecycle; the relationship owns clearance and
finalization. Army movement, attack intent and invasion remain their existing
physical authorities. Clone, hydrate and serialization preserve nested timer
progress without aliasing preceding committed state. CAS remains the final
serialization boundary.

## Lifecycle and timing

| Stage | Online | Offline | Ownership and result |
| --- | --- | --- | --- |
| OFFER_PEACE initiation | 1 second | 30 seconds | Exact proposer operation; light Attention acquired atomically at start. Not yet a visible offer. |
| Required AI recipient response | Seeded 3–8 seconds | Corresponding 30–80 seconds | Required lane; no ordinary persistent recipient Attention and no proactive spacing gate. |
| Player response window | 300 seconds | 7,200 seconds | ACCEPT_PEACE or DECLINE_PEACE; unanswered window expires without inferred consent. |
| Peace finalization after hostile clearance | 2 seconds | 10 seconds | Relationship timer; no proposer Attention. |

Timers reuse authoritative persisted duration-progress arithmetic. They are
created/sampled once, survive reload, and permit offline-to-online promotion
without online-to-offline demotion. Server-authoritative presence and receipt
boundaries drive progress, not client timestamps or processing latency.

Publication ends the primary initiation, applies the relevant source's relief
and begins proactive spacing exactly once. A pending offer is not a ceasefire.
Attacks remain legal until mutual acceptance. Acceptance immediately installs
`PENDING_HOSTILITIES_CLEARANCE`, symmetrically blocks new bilateral hostile
operations, and terminally settles the proposal operation, releasing its
Attention through the existing central operation reducer.

Existing attacks, staging travel, recovery travel and invasions continue. Once
all actual hostile work clears, the finalization timer begins. Its completion
activates PEACE. **Source of Truth §33 takes precedence over the attachment's
tentative alternative ordering:** clearance precedes finalization, rather than
running finalization first and then waiting for clearance.

Decline, player-window expiry, permitted player withdrawal, or hard invalidation
terminally settles the proposal once. No outcome fabricates consent. AI cannot
voluntarily withdraw. A player can withdraw their own pending proposal. Duplicate
terminal handling cannot release another operation's Attention or duplicate
history/goal feedback. Early generic operation completion cannot fake an
accepted proposal.

New Peace expiry uses a REAL_WORLD deadline and returns the pair to default WAR
without declaration or automatic attack. Elimination also clears the exception.
The initial 24-hour Peace term and war-position comparison weight 70 live in
`src/constants/peace.ts`, explicitly marked **INITIAL IMPLEMENTATION TUNING —
NOT LOCKED DESIGN**. They are not final product balance.

## Required cognition and proactive integration

Required responses are ordered by remaining deadline urgency, publication
boundary, then stable proposal ID. They use the recipient's current canonical
state, factual WAR_VALUE, and separate bounded own-Goal, own-Opinion and risk
interpretation. Raw Memory is not war history or response scoring authority.

Pending required work preempts unfinished ordinary deliberation, not an already
committed proactive initiation, WAIT or physical operation. Normal Attention
saturation and proactive spacing do not suppress the required lane. Elapsed
spacing is cleared before the required-work gate so it cannot cause repeated
one-millisecond wakeups while a response is pending.

DIPLOMACY_PEACE's real WAR_BURDEN source can now produce exact OFFER_PEACE plans
and WAIT. Pair uniqueness, canonical relationship, current faction activity,
compatibility and proposer Attention are freshly validated before atomic start.
The existing source-blocker/actionability logic remains intact. No source is
created merely because the world defaults to WAR.

The proactive comparator uses the existing factual WAR_VALUE plus separate Goal
and risk interpretation, uncertainty and commitment burden. Exactly seven
factual evaluators remain. WAR_VALUE currently knows only authoritative current
war and border-force position facts; it does not invent exhaustion, historical
casualties, economic war penalties or grievances. This is sufficient for
limited present use, and intentionally low-information pending a future
Conflict Ledger.

Counterparty Response Estimate is support, not an eighth evaluator or recursive
recipient AI. Its input is an explicit minimal proposer/recipient/relationship
view. With no authored public preference model it returns acceptance bounds
`[0,1]`, limited confidence and unresolved external choice. It cannot read the
recipient's private Goals, Opinion, Memory, Pressure, deliberation or future RNG.
Actual required response assessment independently uses the recipient's own
canonical state.

DECLARE_WAR is unsupported in the command catalog; its historical exported
handler fails explicitly. It cannot end Peace. The old NEGOTIATE API remains
legacy Opinion behavior, not a proactive action or a Peace counteroffer.
TRADE remains unavailable.

## Physical linkage and integration corrections

New ATTACK operations, intents and staging movement capture the exact opposing faction. Clearance
checks consult active operations, current intents and active invasions. Recovery
travel still counts as physical hostile work until its authoritative terminal
boundary. These checks use active operation indexing, not terminal history.
Direct player attack travel also retains its counterparty after objective
invalidation or route interruption, without requiring an AI operation wrapper.

If a target transfers to a third faction, the original objective invalidates;
the executor cannot silently attack the new owner. Elapsed travel, physical
force commitment and the force claim remain preserved. No new rerouting or
spatial recovery policy was invented.

Default WAR exposed an existing invasion integration gap for a genuinely empty
player territory: the normal unanswered-defense route attempted an invalid
zero-defender BattleEngine input. Resolution now reuses the existing unopposed
occupation reducer after the existing invasion response/defense lifecycle.
It introduces no battle formula, synthetic defender, timing change or new
conquest rule. Central settlement records attacker success correctly.

Transactions reconcile earned diplomacy boundaries before new command effects,
then reconcile physical consequences afterward. World progression processes
physical completion/arrival before required response and ordinary cognition.
The existing same-instant ordering, deterministic catch-up and CAS isolation
remain in use.

## Migration and invariants

Schema 22 and older saves receive empty proposal/thread storage, without
fabricated offers, pressure, acceptance, history or relief. Only explicitly
signed unexpired legacy non-aggression treaties import a Peace exception.
Neutral/friendly/allied/hostile sentiment, positive Opinion, and unrelated
alliance/trade records do not create one. Imported treaty expiry retains its
authored turn clock, including historical explicitly open-ended terms; new
Peace is not silently substituted for historical terms.

Existing physical hostility against an imported treaty pair puts that exception
into clearance without cancelling travel or invasions. An imported treaty can
still expire during clearance. Original opposing-faction metadata is taken
from existing invasion/domain linkage where present, then current target
ownership when that is the only known fact. A removed historical target with
no persisted counterparty remains genuinely unresolved; migration does not
invent strategic history.

Schema-23 payloads missing required maps fail closed. Invariants check exact
proposal/operation identities, participants, live-pair index bijection,
Attention-owning operation linkage, orphan live operations, terminal-state
agreement, timer ranges and arithmetic, watermarks, explicit acceptance/treaty
basis, relationship timing, and captured hostile counterparties. Existing
operation/claim/sequence high-water marks are retained.

## Public view and history

Public state exposes default WAR, relationship exceptions, participant-visible
published proposal IDs/status and the player response window. Unpublished
initiations remain hidden. It exposes no response score, evaluator findings,
private modifiers, source/Pressure, timer seeds/progress, RNG or future choice.

Lifecycle events enter existing canonical event history with stable semantic
IDs. Durable proposal terminal records remain persisted. Existing
WorldSimulator recent-event retention still applies; Phase H invents no history
compaction or retention policy. Diagnostic metrics are derived local outputs,
not persisted decision authority.

## Initial implementation validation, before independent review

All commands used the installed Node TypeScript/ts-node entrypoints because
package executable wrappers in this environment are not executable.

| Suite/check | Result |
| --- | --- |
| Phase A | 17 passed |
| Phase B | 28 passed |
| Phase C | 60 passed |
| Phase D | 41 passed |
| Phase E | 55 passed |
| Phase F | 73 passed |
| Phase G | 78 passed |
| Phase H | 69 passed |
| Independent anchors | 16 passed |
| Affected invasion/economy/persistence integration group | 146 passed |
| Affected temporal/schema/session/replay group | 117 passed |
| Full suite | 1,500 passed, 0 failed |
| Production TypeScript `--noEmit` | Passed |
| Test-inclusive TypeScript | Same 28 pre-existing diagnostics; diagnostic fingerprints unchanged after excluding source line/column shifts |
| `git diff --check` | Passed |

Focused Phase H coverage includes real Orchestrator initiation/response paths,
real competing persistence CAS writes, exact timings, promotion/no-demotion,
reload during each stage, active attention and primary-thread behavior,
pending-offer attacks, bilateral post-acceptance blocking, long hostile travel
through invasion and clearance, unopposed invasion resolution, hard invalidation,
third-party target transfer, duplicate settlement, pressure relief, source-scoped
plans, required-response privacy/own-state reasoning, default WAR, migration,
pair-order determinism, malformed/orphan data and no terminal-ledger hot scans.

Old fixture changes are schema-version expectations or explicit authored Peace
in isolated noncombat fixtures. A recruitment threshold fixture protects its
enemy player anchor to preserve the test's coverage/recruitment purpose under
new default-WAR AI activity. Existing conservation and catch-up assertions are
retained; global non-hostility was not added to production or shared fixtures.

## Bounded diagnostics

These measurements instrument existing production progression from temporary
files outside the checkout. Times are environment diagnostics, not performance
guarantees; the final full test suite was also running during measurement.

| Fixture | Elapsed | Timer updates | Required deliberations | Responses | Clearance checks | Relationship transitions | Retained history |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| No proposals; 12 factions, 66 pairs, 10,000 ticks | 5,838 ms | 0 | 0 | 0 | 0 | 0 | 0 |
| Six independent simultaneous pairs | 14 ms | 24 | 6 | 6 | 12 | 12 | 24 |
| Accepted proposal during long staged attack | 32 ms | 3 | 0 | 1 player response | 71 | 1 final activation | 0 after existing event retention |
| Required-response reload; two equivalent branches | 4 ms | 9 | 2 across branches | 1 per final branch | 4 across branches | 4 across branches | 4 per final state |
| Player response expiry | 1 ms | 1 | 0 | 0 | 0 | 0 | 2 |
| Peace expiry back to WAR | 1 ms | 2 | 1 | 1 | 2 | 3 | 5 |

The no-proposal fixture processed 240,000 cheap before/after observer calls and
zero proactive deliberations, offers or resolution/history records. Six-pair
fixture retained six proposal records and six Peace pairs. The long-travel
fixture retained its one durable proposal, completed the exact attack, and
did not activate Peace until physical clearance plus finalization. Reload
produced identical encoded canonical states. Counts spanning two reload
comparison branches are instrumentation totals, not duplicated game outcomes.
No fixture invoked proactive scoring merely to answer a required proposal.

Performance classification: bounded additional lifecycle work; no pair-wide
full-cognition polling or terminal-proposal-history scanning in progression.
The review found and fixed the expired-spacing wake defect described above.
No compaction, new scheduler or product pacing rule was introduced.

## Changed-file inventory

New files:

- `src/types/Peace.ts`
- `src/constants/peace.ts`
- `src/gameplay/diplomacy/relationships.ts`
- `src/gameplay/diplomacy/peace.ts`
- `src/scoring/peaceAssessment.ts`
- `src/persistence/peaceMigration.ts`
- `src/state/peaceInvariants.ts`
- `tests/aiPeace.ts`
- this document
- `docs/AI_PHASE_H_REVIEW.md`

Modified implementation files cover exact-plan availability, compatibility,
pressure/factual war observations, operation settlement, proactive timing,
attack/invasion continuation, command routing and handlers, transaction/public
view integration, schema migration, cloning, invariants, and receipt-clock
anchoring. Modified tests cover current schema expectations, command catalog,
explicit noncombat fixtures and focused phase registration. Final scope:
42 modified files and 10 new files, 52 total after independent review. No Unity, source PNG, package,
project setting, workout/reward catalog or unrelated backend feature changed.

## Deferred matters

- Trade and its exact resource reservations/delivery require the next separately
  authorized phase; they were not started.
- Treaty term and Peace comparison weight require future product/balance
  confirmation. Imported open-ended historical treaties remain historical
  compatibility, not a new default Peace term.
- WAR_VALUE lacks historical Conflict Ledger evidence; proposer response
  estimates intentionally lack recipient-private information.
- General required/reactive/recovery scheduling, final Goal/Opinion lifecycle,
  spatial recovery, terminal-history compaction and resource logistics remain
  deferred.
- Missing original counterparty evidence in ambiguous pre-H physical records
  cannot be reconstructed as historical fact.

The independent review adds physical-clearance and factual-danger corrections,
rejects negative historical treaty dates, and marks historical declarations
unsupported in compatibility helpers. Its final validation/checkpoint record
is in `AI_PHASE_H_REVIEW.md`. No push or Phase I implementation is included.
