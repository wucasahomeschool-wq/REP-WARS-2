# Phase F: factual strategic evaluation and source-local comparison

Implemented on `75342549227956bbfe32c815134547b34a98a1d1` (reviewed Phase E).
The final AI Source of Truth remains product authority. This document records
implementation choices; it does not lock balance or redesign domain rules.
Schema remains **21**. Independent review corrections are documented below;
the reviewed phase is authorized for a local checkpoint only, with no push.

## Production boundary

`handleAiDecide` retains Phase E source readiness, actionability, timers and
complete bounded source-specific generation. It calls `decideForSource` with
the current transaction draft, exact feasible plans and persisted opportunity.
`ContextPlanComparator` verifies current source identity/revision, faction,
scope, feasibility and a meaningful non-WAIT alternative. No fallback into
legacy scoring exists here. The scope verification regenerates the bounded
authorization set once; it does not pick a preferred target or score it.

`DecisionEngine.decide` without a source remains a deprecated standalone
CLI/historical-test compatibility entry. A live canonical primary thread is
explicitly forbidden from using that entry without its source. Production
does not build the old snapshot-wide scoring context. The old `ActionScorer`
is marked deprecated and has no callsite on canonical proactive execution.
Old tool scores, Memory-driven revenge, flat Personality/action bonuses,
Ambition aggression and WAIT patience/resource bonuses are not used in the
production path. Historical tool tests continue to protect their compatibility.
The deprecated scorer is instantiated lazily only for the standalone path.

## Exactly seven factual evaluators

| Identity | Current inputs and outputs | Dependencies/limitations |
| --- | --- | --- |
| BATTLE_OUTLOOK | Exact force, current domain defenders/garrison, morale/composition, terrain, fortification, gated City factor and already-earned invasion defense; effective powers, relative advantage, outcome band, branch loss bounds | Reuses CombatPower; no BattleEngine resolve or future seed. Defeat can annihilate attackers under existing rules. Unopposed non-player capture is deterministic. Player intervention is explicit uncertainty. |
| TERRITORY_VALUE | Post-control authored output, retained infrastructure, friendly connectivity and dependent positions; dimension utility/factual breakdown | RESOURCE_VALUE supports output potential. Foreign buildings/developments are destroyed on acquisition under the existing ownership reducer. No Goal or immediate combat/danger contribution. |
| LOCAL_DANGER | Unique credible hostile forces, committed attacks, route/arrival timing, local defense and friendly committed support arriving in time; hostile/defense power, deficit, danger ratio, earliest timing | Every hostile force counted once even with intent/operation/route overlap. No strategic importance or fear preference. |
| FORCE_POSITION_VALUE | Same exact force at specified destination versus origin; incremental coverage, offensive access, response reach and origin loss | Marginal gaps use LOCAL_DANGER; offensive access uses BATTLE_OUTLOOK and route timing. Redundant raw troops earn no unconditional reward. |
| RESOURCE_VALUE | Specified resource/quantity/direction, actual bank stocks, authored build demand, level-gated Food upkeep, projected output and already-paid construction costs; nonlinear marginal utility | Current storage is faction-bank-only. Uncollected yield cannot fund construction/upkeep; no invented local pools, escrow or manifests. Production is conditional output potential, not automatic future collection. |
| BUILD_VALUE | Exact site/type/upgrade, authored effects/cost/duration, committed same-site work, incremental output/defense/capability and investment exposure | Owns internal RESOURCE_VALUE funding and LOCAL_DANGER exposure. Comparator never re-adds those sub-assessments. Roads absent from current legal construction; no generic road bonus. |
| WAR_VALUE | Current opponent-specific border position and committed contingent hostilities; relative position and factual commitments | No factual Conflict Ledger exists. Historical gains/losses remain unavailable, not inferred from subjective Memory or operation success. No invented war-specific economic penalty. Available for later Peace reasoning, which is not executable here. |

`FactualSupport` whitelists physical facts. Its inputs exclude Goals, Memory,
Opinion values, Personality, Ambition, Pressure, world seed and attack seed.
Assessments and memoization expire with one decision. No evaluator outputs
become canonical world state. Each assessment includes identity, raw facts,
provenance and a common confidence/branch/realization/timing/external-choice
envelope. No fake probabilities are attached to unknown external decisions.

## Baseline, logistics and time

The decision baseline retains active movement, construction and attacks,
including domain work not initiated by AI. Movement/construction are derived
deterministic execution effects; attacks are contingent. Target ownership is
never replaced by an assumed victory. Paid construction costs already changed
the actual bank and are not deducted a second time. Committed matching build
output is baseline, giving a redundant additional build zero benefit.

Logistics reports exact adjacent legs/reachability and uses
`calculateMovementDuration`. An ATTACK engagement edge is not charged as march
time. Existing route scope remains unchanged; no new pathfinder/roads added.

Shared timing uses persisted army work and `displayedRemainingTicks` for
construction. Online/offline completion bounds reuse the exported unchanged
`millisecondsUntilWholeTicks` kernel, including current earned fractional
world-clock work when available. Blocked routes and external invasion response
have unknown completion bounds; neither becomes zero-time recovery. Existing
invasion deadlines are world-tick deadlines, not invented UTC deadlines.
`sampledActivityTiming` uses actual sampled duration/progress and the existing
non-demoting duration kernel. Unsampled future authoring remains ranges via
`unsampledTimingBounds`, without consuming RNG or predicting presence.

## Contribution ownership and comparison

Each normalized contribution has a unique causal key, owner, category, sign,
bounded magnitude, confidence and explanation. Duplicate causal keys are an
error. Supporting evaluator results are not automatically added to comparison.
For example BUILD_VALUE owns resource consumption once. Position improvement
and origin loss are separate parts of the same marginal comparison, not two
raw position scores. Exposure of the specified moved force is a separate
LOCAL_DANGER consequence using the proposed destination placement.
Both committed and potential adjacent attacks use the actual zero-march
engagement edge. Only persisted staging travel grants arrival time for friendly
support; proposed coverage/response cannot arrive early. A hostile force already
committed to another target is not freely retargeted in the baseline. Existing
domain force eligibility and already-earned invasion defense are respected.

The categories are source resolution, additional benefit, direct cost,
opportunity cost, commitment burden, timeliness, realization, modifiers and
stabilizers. They are not extra evaluators. Plans from unrelated sources are
rejected; no universal empire score table exists. Raw Pressure never enters
the comparison. WAIT is exactly zero: no new commitment while existing work
continues, with no reward, patience bonus or escalating repetition penalty.

All numeric normalization/scales live in `strategicEvaluation.ts`, marked
**INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN**. Important initial
values: contribution bound 100, comparison bound 400, minimum commitment
advantage **5**, near-tie band **2**, modifier bound 8 / aggregate bound 12.
Resource dimension scaling is not a market exchange rate. No broad balance
tuning was performed. Modifiers remain bounded enough that large factual
disadvantages cannot be overwhelmed by stacked preferences.

Current canonical Goal alignment is the single explicit plan-preference
modifier; existing missing-target/deadline semantics are retained. Current
risk tolerance interprets factual downside in a separate bounded slot.
Generic action Personality, goal-independent Ambition aggression, raw Memory
and legacy repetition are omitted. Final Personality/delayed-payoff Ambition,
Opinion, exact-plan hysteresis/repetition and Goal lifecycle are deferred, not
smuggled into evaluators. The stabilizer category currently contributes zero.

Qualified non-WAIT plans must clear the configured WAIT margin. Seeded RNG
draws only among qualified plans within the bounded near-tie band; stable plan
IDs determine ordering. Lone leaders and WAIT fallback consume no selection
draw. This follows the Source of Truth selection order: qualification precedes
near-tie variation, so RNG cannot rescue a sub-threshold plan.

Explanations/complete comparisons are ephemeral private Decision diagnostics.
The diagnostics include the applied WAIT margin, qualified/near-tie plan IDs,
the optional final draw and selected plan ID. Uncertainty templates are immutable
and copied into explanations, so diagnostic edits cannot affect future cognition.
The existing selected commitment score/reason/factor audit DTO remains for
compatibility; no new persisted evaluator cache or schema migration is added.
Public GET_GAME_STATE does not expose private diagnostics. Exact-plan execution,
central settlement, claims, Attention and Phase E timing are unchanged.

## Files

New: `src/constants/strategicEvaluation.ts`,
`src/types/StrategicEvaluation.ts`, `src/scoring/factualSupport.ts`,
`src/scoring/strategicEvaluators.ts`, `src/scoring/contextPlanComparison.ts`,
`tests/aiStrategicEvaluation.ts`, this document.

Modified: `src/engine/DecisionEngine.ts`, `src/orchestration/handlers.ts`,
`src/scoring/ActionScorer.ts`, `src/types/index.ts`,
`src/world/temporalBoundaries.ts` (export existing timing kernel only),
`tests/aiCanonicalReasoning.ts`, `tests/aiStrategicPressure.ts`, `tests/run.ts`.
The three older production-spy assertions now inspect the new comparison
boundary; their canonical freshness/pressure/scope assertions were preserved.

## Validation and diagnostics

Focused Phase F tests protect all seven neutral evaluators, Battle primitives
and RNG exclusion, marginal positioning, resource thresholds/accessibility,
committed baselines, timing/reload/promotion, single contribution ownership,
source scope, WAIT/margin/near ties, canonical thread guard, privacy and dormant
observer behavior. A/B/C/D/E, domain/session/temporal and anchors remain required.
Final results: Phase A 17, B 28, C 60, D 41, E 55, F 73 focused tests passed;
16 anchors and 117 affected temporal/schema/session tests passed. Full suite:
**1,353 passed / 0 failed**. Production TypeScript `--noEmit` passed.
Test-inclusive compilation retains exactly the same 28 pre-existing diagnostics
(normalized file/code/message comparison), with no new diagnostics.
`git diff --check`, new-file whitespace and 15-file scope inventory passed.

Representative instrumented runs (diagnostic wall clock only, never authority):

| Fixture | Elapsed | Full deliberations | Plans incl. WAIT | Result / starts | Cache hits / misses | Comparison time |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| No-source, 10,000 ticks | 7,415 ms | 0 | 0 | none | 0 / 0 | 0 |
| Actual resource need, 10,000 ticks | 4,058 ms | 5 | 10 | 5 BUILD / 5 starts / 5 settlements | 0 / 29 | 7.11 ms |
| Military + blocked development + inactive Peace, 100 ticks | 66 ms | 1 | 5 | 1 ATTACK / 1 settlement | 12 / 14 | 4.52 ms |
| Twelve attacking forces in one source, 100 ticks | 72 ms | 1 | 13 | 1 ATTACK / 1 settlement | 71 / 61 | 6.92 ms |
| Composite military source, six staging + six home forces, 100 ticks | 85 ms | 1 | 19 | 1 ATTACK / 1 settlement | 76 / 68 | 7.21 ms |

Actual evaluator calls (cache misses), in the declared seven-identity order:
no-source `(0,0,0,0,0,0,0)`;
resource `(0,0,5,0,19,5,0)`;
mixed `(2,1,9,2,0,0,0)`;
heavy `(12,1,36,12,0,0,0)`;
composite `(12,1,43,12,0,0,0)`.

Inclusive evaluator computation milliseconds in the same order:
resource `(0,0,0.7523,0,0.6093,2.4139,0)`;
mixed `(0.5823,0.0945,0.4894,1.3493,0,0,0)`;
heavy `(0.7644,0.1384,0.7131,2.3347,0,0,0)`;
composite `(1.1324,0.0990,0.8553,2.2454,0,0,0)`.
These timings include nested support calls, so summing evaluator times would
count nested work twice. No-source invokes no evaluator computation at all.

Each run had zero WAIT selections and zero repeated same-boundary deliberations.
The focused production WAIT regression separately proves WAIT can win against
legal but inferior non-WAIT alternatives. Resource runs create ten physical
resolution records; mixed two; heavy/composite one each; no-source zero.
Observer update counts are 60,000 / 60,027 / 233 / 231 / 231 respectively.
Resource has 11 blocked/no-actionable observations; mixed has one. These blocked
contexts remain dormant instead of repeatedly running evaluator suites.

The no-source fixture has no genuine opportunity (adequate banked resources,
no credible legal hostile source); it does not disable an otherwise actionable
source. Resource decisions arise from actual bank scarcity and authored tile
output. Mixed retains an actionable military source alongside blocked development
and an inactive Peace domain. Composite naturally generates ATTACK and staging
MOVE alternatives within one source; no choice or pressure was hand-forced.

Performance classification: expected bounded additional factual evaluation at
earned cognition only; no significant observer regression or pathological churn.
No-source remains roughly 7.4 seconds versus Phase E's 7.629 seconds; resource
roughly 4.1 seconds versus 4.015 seconds. No terminal-operation-history hot-path
scan, observer suite, per-source world clone or historical compaction policy.

## Deferred boundaries

No recruitment/pools/REINFORCE execution, Peace/Trade lifecycle/default WAR,
Conflict Ledger, final Goal/Opinion lifecycle, reactive/required/recovery lane,
full Decision View, counterparty prediction, spatial recovery, compaction,
localized resource redesign, battle/movement/construction math changes, Unity
or fitness/workout changes. No Phase G. Local reviewed checkpoint only; nothing pushed.

## Independent adversarial review

Review remains bounded to Phase F and the final Source of Truth. No product
rule or balance value was redesigned; schema remains 21.

Corrections and additional guards:

- Threat timing uses actual engagement semantics: no phantom march across an
  adjacent attack edge, even for uncommitted attack-capable hostile forces.
  Committed staging uses its persisted remaining movement. Proposed defense
  and response coverage cannot arrive before their real route. A hostile force
  committed against another target is unavailable for a different simultaneous
  attack; already-earned invasion defense is counted once. Existing minimum
  attack-force eligibility is reused.
- Production-build assessment retains conditional collection/exposure branches
  from its factual support instead of presenting bank income as guaranteed.
- Comparison validates exact plan shape/identity, authorization and the complete
  bounded source candidate set. A legitimate ID cannot disguise changed params.
- Causal contribution insertion rejects duplicate owners and non-finite values.
  Saturation uses equivalent overflow-safe arithmetic; constants are unchanged.
- Selection rejects non-finite scores, duplicate plans and fictional WAIT reward.
  Threshold eligibility precedes the seeded near-tie pool. Private diagnostics
  now include qualification, applied thresholds and the optional final draw.
- Immutable uncertainty templates are copied into derived explanations. Editing
  an explanation cannot become hidden authority over later cognition. Resource
  and Goal reduction order is deterministic, independent of property/set order.
- Deprecated ActionScorer construction is confined to standalone compatibility.
  Canonical direct decisions and catch-up cannot call it or use it after errors.

Added **24 focused review regressions**, bringing Phase F to 73. They cover
actual seeded BattleEngine result equivalence after repeated evaluation,
realistic/staged support timing, hostile commitment availability, earned defense,
neutrality/order/reload, larger-benefit/higher-cost authored construction,
explicit evaluation failure/rollback, complete source scope, duplicate causal
ownership, exact threshold/near-tie boundaries, diagnostic isolation and real
production catch-up without legacy scoring. The two existing support tests retain
late-versus-timely assertions with real staging travel rather than a fictitious
engagement delay; no invariant was weakened.

WAR_VALUE is intentionally low-information and sufficient only for current
limited factual position/commitment reporting. Historical trajectory and future
Peace discrimination remain dependent on the deferred Conflict Ledger/lifecycle.
Other deferred items remain unchanged: recruitment/pools, diplomacy, final
Goal/Opinion/modifier/stabilizer lifecycles, spatial recovery and compaction.
