# Phase J: canonical Goal lifecycle and directed Opinion

Implementation baseline: `6c64ea6241e7f5c3b4bbfd64bb5e890a63776aa1`
(`AI: trade proposals and physical delivery`), branch `work`, clean before editing.
Schema changes from **24 to 25**. Implementation was left uncommitted for independent
review; a local checkpoint is authorized only after the review and checks pass.
No push is authorized.
The final AI Source of Truth is product authority; this is an implementation record.
Its faction decision view, modifier, Memory/Opinion/Goal and faction lifecycle
sections govern this work. Exact Goal creation/priority rules and Opinion formulas
remain explicitly unresolved there.

## Audit before implementation

| Area | Finding at the reviewed Phase I baseline |
| --- | --- |
| Goal storage | IMPLEMENTED: canonical `factions[].goals`; disposable WarlordState/GoalSystem adapters also existed. |
| Goal generation | LEGACY: deterministic personality-based initial list, at most three, with some real faction/region targets but several vague objectives. |
| Goal lifecycle | PARTIAL: progress/targetProgress and turn deadlines, without explicit owner, concrete predicate, visibility or terminal state. Flat successful-action feedback could advance a Goal without achieving its objective. |
| Goal preference | PARTIAL: production comparator/Peace response used legacy broad action alignment. Pressure matched old target fields. |
| Opinion | IMPLEMENTED: directed canonical `factions[].diplomacy[target].opinion`, with authored initial values and historical range -100..100. Updates were scattered, without persisted event receipts. |
| Opinion integration | PARTIAL: required Peace responses read own Opinion; proactive comparison and Trade required responses did not. Generalized NEGOTIATE still mutated stance directly. |
| Memory | IMPLEMENTED historical records. Legacy ActionScorer/CLI retained revenge and action modifiers, but those paths were already disconnected from canonical production. |
| Privacy | PARTIAL: physical factual support and counterparty estimates were restricted, but no common detached own-cognition view served the new preference integrations. |
| Decay | No authoritative Opinion decay rule; none introduced. Memory decay remains a separate historical algorithm. |
| Conflict trajectory | MISSING: factual Conflict Ledger. WAR_VALUE's limited current-position facts remain unchanged. |

## Goal authority and lifecycle

`src/cognition/goals.ts` owns canonical assignment, factual predicates, lifecycle
refresh, source matching and specific-plan support. There is no separate Goal store.
Each Goal retains its faction-scoped stable ID and adds lifecycle owner, concrete
objective, ACTIVE/COMPLETED/INVALIDATED state, private visibility, creation boundary,
resolution boundary and reason. Existing progress is now an assessment of actual
canonical conditions, not an action-success reward.

Supported exact predicates are CONTROL_TERRITORY, CONTROL_REGION,
ELIMINATE_FACTION, PEACE, DEVELOPMENT, RESOURCE_HOLDING and FORCE_POSITION.
Development checks real completed authored infrastructure/City/fortification level.
Peace checks actual PEACE, not pending acceptance or clearance. Position checks
physical arrival and availability. Resource conditions use spendable unreserved
canonical holdings; accepted cargo does not complete a holding Goal before delivery.
Region and fortification progress can be fractional. Missing required targets,
expired existing deadlines and inactive owners invalidate. Terminal Goals are not
continually re-evaluated, resurrected or rewarded.

**PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED:** initial
legacy creation remains deterministic and unreplenished. Only unambiguous live
`destroy_rival` and `control_region` targets become concrete predicates. Vague or
ambiguously historically completed Goals are archived INVALIDATED, preserving IDs,
old progress and `createdTurn`. Legacy physical creation tick is unknown (`null`),
not invented at migration. New explicit assignment requires a caller-owned stable
ID and exact predicate; there is no random churn or automatic replacement generator.

No new active-Goal capacity is invented. The legacy initial-list bound remains;
authored explicit assignments have no hidden quest-log cap. Final creation, priority,
capacity and replacement policies need product confirmation. Visibility defaults to
PRIVATE; PUBLIC Goal semantics remain unresolved and are not falsely implemented.

`GoalProgressAssessment` answers a specific Goal/exact-plan causal question. It is
support, not an evaluator or universal score. Capture/Peace/Trade effects remain
contingent. Existing same-type construction, committed movement destinations and
accepted inbound cargo remain in the relevant baseline. Same-target active attacks,
real attack intents and invasions mark that contingent branch ALREADY_COMMITTED;
a second plan cannot earn the same explicit Goal benefit again. Capture is still
contingent, so this does not complete the Goal or assert a future victory. Intermediate development
and resource effects have bounded materiality. Supplied stale Goal objects are
re-resolved by ID from the deciding faction's current canonical state.

The late `preference:goal` contribution is the single explicit preference owner.
Priority/materiality aggregate saturates within the existing modifier bound. Factual
usefulness is still owned by the seven unchanged factual evaluators. Pressure can
amplify only an already-real matching source in the existing five domains; no Goal
creates a source, candidate, route, complementary partner or build feasibility.
Source semantics are filtered before assessing current relevant Goal progress;
unrelated Goals are not reassessed or sorted on the observer path.

Fresh predicates suppress terminal Goal influence immediately, including during
deliberation. Canonical lifecycle refresh occurs at relevant domain transitions,
transaction boundaries and earned deliberation completion, not every observer tick.
Goal completion ceases future amplification/modifiers without a global rescore or
Goal completion reward. Already accumulated source pressure remains genuine source
state; completion does not invent arbitrary pressure refunds.

## Opinion authority, events and preference

The existing directed diplomacy Opinion is reused as the sole current stance:
observer faction -> target faction. Missing directed stance is neutral/unknown.
WAR legality does not initialize dislike. Canonical Peace relationships alone govern
hostility legality; positive Opinion cannot create Peace and negative Opinion cannot
override Peace or clearance.

Canonical attack receipts include the exact persisted operation ID through both
immediate and staged execution, keeping independent operations distinct.

All numeric stance policy lives in `src/constants/cognition.ts`, explicitly
**INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN** and
**PROVISIONAL IMPLEMENTATION TUNING — PRODUCT CONFIRMATION REQUIRED**. Range is -100..100,
Opinion modifier bound is 8, attack received -40, territory lost -25, actual treaty
activation +30 and received Trade delivery +5. Existing authored world-event deltas
also use the same bounded updater. These formulas require product confirmation;
they are not new locked balance. No continuous decay is invented.

`applyOpinionEvent` uses domain-owned stable transition identity plus exact directed
pair identity. Canonical `opinionEvents` stores idempotency receipts, never a second
stance or war trajectory. Replay is a no-op; conflicting reuse fails explicitly.
Receipt IDs preserve full identities without hashing/truncation or runtime counters.
Current Opinion is never rebuilt from receipts, diagnostic history or raw Memory.

Supported production transitions are actual strategic attack/invasion publication,
territory loss, actual Peace activation, exact Trade shipment delivery and existing
authored world-event stance changes. A self-selected attack no longer generates an
additional self-directed hatred update. Pending Peace/Trade publication or Trade
acceptance does not fabricate successful-interaction Opinion.

ATTACK/OFFER_PEACE/TRADE receive one bounded `preference:opinion` contribution
outside factual evaluation. Own actual Peace/Trade required responses can also use
their own exact Goal assessment and directed stance. Trade factual gain/loss is
normalized using existing Resource Value/comparison scales before the bounded
preference stack, keeping units comparable. Acceptance feasibility still precedes
preference and is freshly checked again by authoritative settlement.

Raw Memory, generic aggression, Ambition hatred multipliers and legacy action
bonuses do not enter these paths. Risk keeps its separate existing contribution.
Aggregate modifiers remain bounded. Non-WAIT qualification additionally requires a
positive factual foundation, so preferences cannot rescue nonpositive factual plans;
the existing commitment margin and final-only seeded near-tie procedure remain.
WAIT stays the zero-additional-commitment baseline.

## Privacy, persistence and containment

`factionDecisionView` derives detached own active Goals, directed Opinions and own
traits. Other known factions expose only identity/name and public relationship.
The physical factual support remains Goal/Opinion/Memory-neutral. Proposer estimates
cannot access recipient-private getters; actual required responses use only their
recipient-owned preference state. No new private cognition is added to public DTOs.

Schema 24 -> 25 initializes receipts empty, preserves existing bounded current
stance, grounds/archives legacy Goals deterministically, and never replays Memory
to invent history. Operations, claims, Attention, pressure/source state, timers,
Peace, Trade, recruitment and ID high-water marks remain intact. Current schema 25
requires the receipt map and lifecycle metadata on every Goal. Clone/hydration deep-preserve Goal objective metadata and
receipts without mutable reference aliasing. Invariants check owner/ID/lifecycle,
objective/priority/progress, valid boundaries (including unknown legacy creation),
directed bounds and receipt identity.

Generalized NEGOTIATE is now explicitly unsupported in command catalog/routing;
historical symbols remain compatible, and exact Trade counteroffer responses are
unchanged. Legacy GoalSystem/ActionScorer CLI algorithms are marked isolated and
remain disconnected from canonical proactive comparison. No fallback is added.
Phase F already deferred exact-plan hysteresis/repetition and final general
Personality/delayed-payoff Ambition modifiers. They remain deferred; Phase J does
not claim to implement them through narrative Memory. Existing legacy regression
and canonical operation stability tests continue to pass.

Exactly eight proactive actions, seven factual evaluators and five pressure domains
remain. Battle mathematics, physical durations, construction/economy mechanics,
recruitment tuning, Unity and fitness/workouts are unchanged. No Conflict Ledger,
autonomous counteroffer, cargo recovery, P2P market or later phase is introduced.

## Validation

All focused suites pass: A 17, B 28, C 60, D 41, E 55, F 73, G 78, H 85,
I 90, J 83. Affected anchors/invasion/economy/cities/developments/persistence:
146 passed (including 16 anchors). Affected temporal/schema/session/lease/replay/
idempotency: 117 passed. These are overlapping subsets, not additive suite totals.
Full suite: **1,689 passed, zero failed**. Production TypeScript `--noEmit` passes.
Test-inclusive TypeScript retains exactly the same **28 pre-existing diagnostics**
by file/code/message fingerprint, with no new diagnostics. `git diff --check` passes.

The focused regressions include real canonical attack, Peace activation and shipment
delivery, stale deliberation, canonical Goal substitution resistance, deep clone,
rollback, migration/reload, private-getter traps, contribution ownership, factual
neutrality, final-only RNG, terminal influence cessation, unsupported negotiation,
unchanged observer work and narrow source-relevant pressure checks.

## Bounded performance diagnostics

Diagnostics use production Orchestrator/world/cognition/persistence mechanics with
instrumented boundaries. Quiet authored events isolate the workloads. Initial fixture
normalization is excluded from transition counters. Explicit comparison/response
microbenchmarks are labeled below; they are not claimed autonomous deliberations.

| Workload | Elapsed ms | Work performed |
| --- | ---: | --- |
| 12 factions, no changing events, 10,000 ticks | 2,943 | 240,000 cheap observations; zero full deliberations, candidates, lifecycle predicate checks, Opinion updates, operations or history; 314 refresh entry calls |
| 64 factions, 4,032 directed stances, 100 ticks | 624 | 12,800 observations; zero cognition, stance updates or transitions; four refresh calls |
| Three active Goals, 100 explicit exact-plan comparisons | 74 | 500 compared plans; zero lifecycle/Opinion transitions |
| 500-Goal completion burst | 23 | 500 factual checks/transitions; two refresh calls including idempotency; zero full deliberations |
| Own-private Peace/Trade required assessment | 27 | 200 explicit assessments with throwing foreign-private getters; zero foreign reads or proactive deliberations |
| 25 reload reconstructions | 32 | 26 explicit comparisons/130 plans, bit-equivalent results and one retained Opinion receipt |
| 4,032 directed stances, guarded observer, 100 boundaries | 295 | 6,400 observer calls; throwing stance getters prove zero directed Opinion reads; zero comparisons/updates |
| 2,000 events plus 22,000 duplicate replays, including reload | 29 | 24,000 keyed attempts; exactly 2,000 updates/receipts; duplicates all no-ops, no history rows |
| 12 factions with own active Goals/stances, 10,000 quiet ticks | 3,908 | 240,000 observations; zero deliberations/plans/operations/history; 3,768 lifecycle checks at 314 transaction/domain refresh boundaries, zero transitions/Opinion updates |

The prior comparable Phase I no-source measurement was 2,716 ms and initial Phase J
was 2,805 ms. The final quiet rerun was 2,943 ms: no pathological cognition or history
churn is hidden by that small measured overhead. An early review run of the 4,032
stance fixture measured 1,067 ms using generic deep cloning at event merges. A local
semantics-preserving typed detached copy (including nested treaty terms) reduced it
to 624 ms, versus the prior 591 ms. Reference-isolation regressions still pass.
Measurements above were serial, after test workloads finished; contended preliminary
numbers are not used as comparable benchmarks.

**Classification:** local event-copy performance defect corrected; remaining cost is
expected canonical snapshot/invariant and sparse Goal refresh work. No significant
no-source regression or repeated full cognition was found. Ordinary observation does
not scan directed Opinion pairs, rebuild Opinion from Memory, score plans per tick,
or scan terminal operations. Transaction/event snapshot copies and invariants still
visit persisted state where required; these are not disguised cognition. Retained
terminal Goal/receipt compaction remains a future policy question and was not invented.
Timings are diagnostics, not balance or hard runtime guarantees.

## Remaining product decisions

Goal creation/priority/capacity/replacement, PUBLIC visibility, exact objective
policy extensions and Opinion event/modifier formulas remain provisional. Historical
WAR_VALUE trajectory remains unavailable until a separate authorized Conflict Ledger
phase. Existing exact-plan hysteresis/repetition and broader preference work remains
explicitly deferred. No later phase has begun.

## Changed-file inventory

55 files: 46 modified, 9 new.

New:

- `docs/AI_PHASE_J_GOALS_OPINION.md`
- `src/cognition/decisionView.ts`
- `src/cognition/goals.ts`
- `src/cognition/migration.ts`
- `src/cognition/opinion.ts`
- `src/constants/cognition.ts`
- `src/state/cognitionInvariants.ts`
- `src/types/AICognition.ts`
- `tests/aiCognition.ts`

Modified:

- `src/army/movement.ts`
- `src/army/strategicAttack.ts`
- `src/engine/outcomeFeedback.ts`
- `src/engine/proactiveCognition.ts`
- `src/engine/strategicPressure.ts`
- `src/events/EventModel.ts`
- `src/events/WorldSimulator.ts`
- `src/gameplay/construction/complete.ts`
- `src/gameplay/diplomacy/peace.ts`
- `src/gameplay/invasion/create.ts`
- `src/gameplay/trade/trade.ts`
- `src/goals/GoalSystem.ts`
- `src/orchestration/applyBattle.ts`
- `src/orchestration/applyEvents.ts`
- `src/orchestration/commandIndex.ts`
- `src/orchestration/handlers.ts`
- `src/orchestration/transaction.ts`
- `src/persistence/versioning.ts`
- `src/scoring/contextPlanComparison.ts`
- `src/scoring/peaceAssessment.ts`
- `src/scoring/tradeAssessment.ts`
- `src/state/cloneGameState.ts`
- `src/state/createGameState.ts`
- `src/state/gameStateInvariants.ts`
- `src/types/GameState.ts`
- `src/types/StrategicEvaluation.ts`
- `src/types/index.ts`
- `src/worldDefinition/instantiate.ts`
- `tests/aiCanonicalReasoning.ts`
- `tests/aiPeace.ts`
- `tests/aiRecruitment.ts`
- `tests/aiRuntime.ts`
- `tests/aiStrategicPressure.ts`
- `tests/aiTrade.ts`
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

## Independent adversarial review

The review traced production entry points and the complete diff from the Phase I
checkpoint rather than treating the initial implementation tests as proof. There
is one canonical Goal authority (`factions[].goals`) and one directed current
Opinion authority (`factions[].diplomacy[target].opinion`). Receipt metadata supplies
replay protection, not a second stance or a factual Conflict Ledger. WarlordState,
GoalSystem and factionDecisionView cannot write their detached reasoning data back
as canonical authority. Production `handleAiDecide` uses `decideForSource`; the
legacy ActionScorer has no error/empty-plan fallback into production.

### Defects and corrections

| Finding | Correction and regression evidence |
| --- | --- |
| A second same-target ATTACK could receive the full Goal preference despite an already-committed contingent attack. | `assessGoalProgress` now checks relevant active operations, physical attack intents and invasions, returning ALREADY_COMMITTED/zero new preference. A focused reproduction failed before the change. |
| Event output could replace a fresher canonical terminal Goal with its stale snapshot. | `mergeEventStepOntoGameState` preserves canonical Goals. The stale-output reproduction failed before correction. |
| Snapshot Opinion differences could be mistaken for an authored event, reversing a canonical stance. | Only explicit `AuthoredOpinionEffect` entries drive canonical event updates. Snapshots do not author new stance changes. The reversal reproduction failed before correction. |
| Different authored events at the same turn/boundary shared one aggregated receipt identity. | WorldSimulator emits deterministic instance/phase/consequence-index identities. Separate effects settle separately; replay of each is a no-op. Both a helper regression and a real authored WorldSimulator event exercise the path. |
| A malformed authored target could create a ghost directed stance. | ConsequenceApplier ignores self, missing or non-finite authored target effects. The test checks the actual cloned applier output, not an untouched input. |
| Schema-25 Goals could omit lifecycle metadata and pass validation. | Current-schema invariants require metadata; older saves retain the explicit migration path. A pre-correction corruption regression reproduced the omission. |
| Malformed receipt kinds and event-identity components could pass validation. | Receipt and updater checks require valid event/kind/pair identity. Corruption tests reproduced the gap. Completed Goals also require a concrete predicate and achieved progress. |
| Explicit assignment could accept self-diplomacy or unattainable authored construction levels. | Assignment validates private visibility, real supported structure levels and non-self diplomatic/elimination objectives, using existing gameplay limits without tuning them. Default priority remains 50 in centralized provisional tuning. |
| Merged event output could alias canonical Goal/Opinion objects. | The merge now creates a separate faction record with detached canonical cognition. Mutating retained output after merge cannot alter canonical state, including nested treaty terms. A typed copy removes measured generic-clone overhead without weakening isolation. |
| Separate recaptures at the same boundary collided on territory-loss receipt identity. | Capture identity now includes stable-sorted exact physical actors and their canonical operation identity. A three-capture regression reproduced the lost second consequence before correction. No battle/conquest math changed. |

Seventeen review regressions extend the focused suite from 66 to 83. Besides the
reproductions, they cover a real failed persisted CAS write and retry, actual
invasion/conquest causality, asymmetric reload, committed cargo, migration with
already-delivered cargo/activated Peace, and fresh Goal assessment at actual
proactive deliberation completion. The updated Phase A fixture supplies valid
schema-25 metadata while retaining and strengthening its original isolation checks.
Flat successful-action Goal-progress assertions were replaced with the stronger
canonical-achievement contract, not relaxed to accept arbitrary progress.

### Cross-system conclusions

| Review area | Verdict and evidence |
| --- | --- |
| Global counts | Exactly eight proactive actions, seven factual evaluators and five pressure domains remain. GoalProgressAssessment and counterparty estimates remain support. |
| Goal lifecycle | Canonical predicates alone complete Goals. Initiation, staged travel, invasion publication, accepted cargo and Peace clearance do not. Disappearance, unsupported legacy predicates, deadlines and inactive ownership invalidate. Terminal state is sticky and has no reward. |
| Goal influence | Only existing real sources receive amplification; only `preference:goal` owns explicit plan preference. Fresh predicates remove terminal influence even before stored lifecycle refresh. No global rescoring is scheduled. |
| Committed effects | Same-target attack effects are contingent and do not earn duplicate preference. Committed construction/movement/cargo remain baseline support. Blocked cargo stops representing an expected future receipt and never funds present spending. |
| Opinion and causality | Directed, bounded, canonical and event-driven. A received attack/invasion and an actual territory loss are distinct consequences (-40 and -25 provisional); invasion resolution does not repeat the attack penalty. Peace updates only at activation; Trade only at delivery. Authored events use explicit effects. |
| Preference boundaries | Opinion owns one `preference:opinion` contribution for ATTACK/OFFER_PEACE/TRADE. Goal, Opinion and existing Risk are separately explained and bounded by the existing stack. A nonpositive factual plan cannot qualify solely through preferences. No raw Memory revenge or generic aggression/Ambition hatred multiplier enters production. |
| Factual neutrality | All seven factual evaluator paths remain Goal/Opinion/Memory-neutral, including BATTLE_OUTLOOK, RESOURCE_VALUE and WAR_VALUE. They consume no modifier RNG. WAR_VALUE still lacks authoritative historical trajectory; no subjective substitute is introduced. |
| Required responses | Actual Peace/Trade recipients may use their own fresh Goal/Opinion. Responses remain independent of pressure, proactive spacing and ordinary Attention; fresh acceptance predicates still own legality. |
| Privacy | Detached own-cognition view exposes only permitted foreign identity/name/public relationship. Throwing foreign-private getters protect actual comparison, required response and proposer estimate paths. Public GET_GAME_STATE omits cognition and receipt contents. |
| Persistence/CAS | Schema 24 migration preserves current stance and A-I physical/diplomatic state, archives ambiguous Goals without guessed targets/ticks, and starts receipts empty. Already-terminal domain records do not replay historical stance changes. Failed real CAS leaves no completion or receipt; a retry applies once. |
| Determinism and history | Stable exact IDs and established domain boundary order remain. Reversed collection insertion/reload gives equivalent comparisons and receipts. History remains diagnostic; no runtime reconstruction of stance or Goals from Memory/history. |
| Faction lifecycle | Existing physical-presence ACTIVE/ELIMINATED eligibility is reused. There is no separately implemented INACTIVE status enum to invent. Unavailable owners cease optional cognition and clear the pending primary thread. Persisted directed stance alone never schedules thought. |
| Scope | No Conflict Ledger, emergency/recovery scheduler, cargo recovery, autonomous counteroffer, logistics redesign, P2P/market/tax feature, new action/evaluator, battle/duration change, recruitment retuning, Unity or workout change. |

### Provisional policy classifications

| Policy | Classification |
| --- | --- |
| Creation | PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED: ground only unambiguous existing objectives; explicit authored assignment with caller-supplied identity; no elaborate generator. |
| Priority | PROVISIONAL IMPLEMENTATION TUNING — PRODUCT CONFIRMATION REQUIRED: preserve bounded 0..100 priorities and centralized default 50; final assignment rules unresolved. |
| Replacement/replenishment | Not implemented; final policy unresolved. No random/automatic churn. |
| Capacity | No new production cap. Legacy initial generation remains bounded; standalone GoalSystem's historical cap is not new canonical doctrine. Final capacity policy unresolved. |
| PUBLIC visibility | Unresolved; only PRIVATE is accepted. Foreign traits are not presumed public. |
| Opinion range/formulas | PROVISIONAL IMPLEMENTATION TUNING — PRODUCT CONFIRMATION REQUIRED: -100..100, bounded modifier 8 and supported event deltas. No numeric retuning in review. |
| Decay | Intentionally absent absent an authoritative rule. Historical Memory decay remains separate; no live Opinion decay path. |

Older `docs/AI_RUNTIME_INTEGRATION.md` sections 8/9 and its flat
GOAL_PROGRESS_ON_SUCCESS description are superseded historical records. Legacy
ActionScorer's grievance/action bonuses and GoalSystem's broad action alignment
remain reachable only through standalone compatibility/CLI tests, not canonical
handlers, catch-up or replay. Phase F's deferred exact-plan hysteresis/repetition
and general Personality/Ambition modifiers remain deferred; Phase J does not add
partial versions. No unresolved Source-of-Truth conflict requires a new product rule.

### Validation limits

The full test runner and focused/integration subsets are real repository tests.
Test-inclusive compilation is **not clean**: its 28 existing diagnostics match the
Phase I file/code/message fingerprints exactly, with zero added diagnostics.
Production compilation is clean. The new persistence conflict proof uses the real
InMemoryGameStateStore CAS path; no live Supabase deployment/database execution is
claimed. No Unity execution is part of this phase.
