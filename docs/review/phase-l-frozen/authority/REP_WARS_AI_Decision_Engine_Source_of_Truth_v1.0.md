# REP WARS — AI Decision Engine — Consolidated Source of Truth v1.0

**Date:** October 6, 2026  
**Status:** Structural AI decision architecture frozen for implementation audit  
**Implementation status:** Not audited in this document

> This file is the canonical Codex-facing AI design handoff. Older AI handoffs are subordinate where they conflict with this document.


## 1. Document Status and Scope

**STATUS: LOCKED DESIGN**

**Document:** REP WARS — AI Decision Engine — Consolidated Source of Truth v1.0  
**Date:** October 6, 2026  
**Status:** Structural AI decision architecture frozen for implementation audit.  
**Implementation status:** NOT AUDITED HERE. This document makes no claim that the current TypeScript repository already implements these rules.

This document is the single current design authority for the Rep Wars AI Decision Engine. It consolidates the redesigned AI architecture, Temporal V2 integration, four revision passes, the final full from-scratch audit, and the final correction pass.

The AI is backend-authoritative. Unity is presentation/input only. The AI must operate against the single canonical `GameState`; it must not create a second authoritative world, temporal state, reservation store, or speculative AI world that can disagree with `GameState`.


## 2. Source Precedence and Supersession

**STATUS: LOCKED DESIGN**

For AI decision behavior, use this precedence order:

1. **This consolidated source-of-truth document.**
2. **Current Temporal V2**, except where this document explicitly supersedes an older Temporal V2 sentence.
3. **Older AI Decision Engine redesign handoff(s)**, only where not contradicted here.
4. **Legacy AI designs and existing implementation**, which must be audited rather than assumed correct.

If repo behavior conflicts with this document, report the conflict. Do not silently preserve legacy behavior. If this document leaves a subsystem rule unresolved, do not invent it in implementation.

### Explicit supersessions

- Old `WAIT = 0 duration` is obsolete. Current WAIT initiation is **2 seconds online / 60 seconds offline**, followed by completion revalidation and then proactive reconsideration spacing only if WAIT still validly completes.
- Old proactive actions `EXPAND`, `SCOUT`, `DECLARE_WAR`, proactive `DEFEND`, and proactive `NEGOTIATE` are removed.
- Old serial faction lifecycle `decide -> commit one operation -> wait for it to finish -> decide again` is obsolete. Multiple compatible operations may coexist.
- Old 1-minute global simulation tick / global online-offline multiplier model is obsolete for AI Temporal V2. Canonical precision is 1 second, with per-process online/offline rates.
- Old rule placing Goal relevance inside factual evaluators is obsolete. Goals are applied in the Goal modifier layer only.
- Old rule that peace cannot be accepted while hostile operations exist is obsolete. Acceptance may enter `PENDING_HOSTILITIES_CLEARANCE`.
- Old broad statement that all backend information is visible to every AI is obsolete. AI decisions use an authorized `FACTION_DECISION_VIEW`; private cognition of other factions is not automatically visible.
- Old Temporal V2 sentence that construction work begins immediately at BUILD commit is superseded. BUILD starts the project lifecycle immediately, but the construction work timer starts only when required materials are physically ready at the site.


## 3. Exact Proactive Action Vocabulary

**STATUS: LOCKED DESIGN**

The proactive AI action vocabulary is **exactly eight actions**:

1. `ATTACK`
2. `REINFORCE`
3. `BUILD`
4. `MOVE`
5. `OFFER_PEACE`
6. `TRADE`
7. `RETREAT`
8. `WAIT`

Do not add `EXPAND`, `SCOUT`, `DECLARE_WAR`, proactive `DEFEND`, proactive `NEGOTIATE`, or `COLLECT` as proactive strategic actions.

`DEFEND` is reactive/system-owned behavior. Negotiation responses are required-response outcomes. Neutral territorial acquisition is handled by `MOVE` or `ATTACK` plus authoritative occupation rules, not by a separate `EXPAND` action.


## 4. World Relationship Baseline

**STATUS: LOCKED DESIGN**

- Default relationship between factions is `WAR`.
- `PEACE` is the exception.
- There is no `DECLARE_WAR` action.
- When a peace relationship ends, factions return to WAR according to the authoritative diplomacy rules.
- `OFFER_PEACE` is proactive.
- Incoming peace proposals create required-response cognition.


## 5. Concrete Plan Architecture

**STATUS: LOCKED DESIGN**

The AI chooses exact plans, not abstract action labels. Examples:

- `ATTACK Army A -> Territory X` with exact route/operation data.
- `BUILD Farm -> Territory Y` with exact site and resource sources.
- `MOVE Army B -> Territory Z` with exact route.
- `REINFORCE 120 -> Garrison Q` from an exact local undeployed pool.
- `TRADE exact resources -> Faction D` with exact offered/requested quantities and proposer resource sources.
- `OFFER_PEACE -> Faction E`.
- `RETREAT Army C -> fallback Y` with exact route.

Executors consume the selected exact plan. They must not independently re-decide strategic parameters later. If the plan becomes illegal, use the authoritative invalidation/recovery path; do not silently substitute a different strategic plan.


## 6. Multiple Simultaneous Operations

**STATUS: LOCKED DESIGN**

A faction may maintain multiple simultaneous world operations if:

- exact entities/resources/capacities are available;
- reservations do not conflict;
- operation lifecycle compatibility permits coexistence;
- sufficient Strategic Attention exists, unless a defined critical emergency rule applies.

One primary deliberation thread does **not** mean one active operation. Existing operations continue while the faction later deliberates about additional strategy.


## 7. Strategic Attention

**STATUS: LOCKED DESIGN**

Strategic Attention is finite faction-level strategic management bandwidth. It is separate from physical reservations, operation compatibility, the one deliberation thread, and proactive reconsideration spacing.

Strategic Attention must not alter combat strength, production, movement speed, construction speed, RNG, or physical legality.

Qualitative starting profile:

- `ATTACK`: heavy.
- `MOVE`: standard.
- `RETREAT`: standard.
- `BUILD`: light or lifecycle-phased; exact numeric behavior unresolved.
- `TRADE`: light while voluntary proposal management is active.
- `OFFER_PEACE`: light while voluntary proposal management is active.
- `REINFORCE`: zero or very light/brief; exact numeric cost unresolved.
- `WAIT`: zero.

Critical survival cognition may temporarily exceed ordinary Attention capacity through a narrowly defined emergency mechanism. This never bypasses real troops, routes, resources, reservations, combat rules, or other physical legality.

Required responses do not need free ordinary Attention merely to answer. A voluntary counteroffer is a new proposal and therefore may require ordinary Attention.


## 8. Reservations and Compatibility

**STATUS: LOCKED DESIGN**

Three independent layers govern concurrency:

1. **Reservations** — prevent double-use of exact entities, quantities, slots, and capacities.
2. **Operation compatibility** — prevents logically incompatible lifecycle states.
3. **Strategic Attention** — limits strategic management burden.

Reservations are hard legality gates, acquired and released/transformed atomically inside canonical `GameState`. CAS is the final serialization boundary.

Compatibility defaults toward coexistence unless a real authoritative mechanic creates a conflict. Do not maintain an arbitrary global action-vs-action ban matrix when resource/entity/capacity requirements can derive the conflict naturally.


## 9. Observation and One Primary Deliberation Thread

**STATUS: LOCKED DESIGN**

The AI is conceptually always observing, but it is not continuously performing full strategic search.

Cheap event/boundary observation detects:

- critical/urgent reactive issues;
- required responses;
- operation recovery choices;
- changes to proactive Strategic Pressure/actionability.

Each faction has one primary strategic deliberation thread. Many compatible world operations may run concurrently.

A genuinely urgent reactive context cancels, rather than pauses, unfinished proactive deliberation. Accrued pressure is retained and receives no false relief. The stale proactive thought never resumes; if its underlying issue remains, it is freshly reconsidered later.


## 10. Strategic Pressure

**STATUS: LOCKED DESIGN**

Strategic Pressure is the proactive initiative mechanism. It is cause-driven, source-aware, bounded/saturating, and separate from action scoring.

The five domains are exactly:

1. `MILITARY_INITIATIVE`
2. `FORCE_POSITIONING`
3. `DEVELOPMENT`
4. `DIPLOMACY_PEACE`
5. `TRADE_ECONOMIC`

Rejected standalone domains include `THREAT_SURVIVAL`, `REINFORCEMENT`, `LONG_TERM_GOAL_PROGRESS`, `IDLE_CAPABILITY`, `GENERAL_ACTIVITY`, and `LOGISTICS`.

Pressure is not actionability. A high-pressure source may be blocked. Pressure may persist while blocked and may continue evolving during active operations.

Memory does not directly inject pressure. Goals may amplify a real existing problem/opportunity, but an unfinished Goal alone does not manufacture pressure. Long inactivity is at most a small amplifier to a legitimate existing opportunity; it cannot force pointless activity.


## 11. Pressure Domain Definitions

**STATUS: LOCKED DESIGN**

### MILITARY_INITIATIVE
Represents credible opportunities for proactive territorial acquisition or offensive strategic initiative. Source families include hostile offensive opportunity, exploitable hostile change, strategic breakthrough, preemptive offensive opportunity, and `NEUTRAL_TERRITORIAL_OPPORTUNITY`.

War status alone does not create Military Initiative. Force availability alone does not create it. Neutral land merely existing does not create it; the neutral territory must be legally acquirable, meaningfully valuable, and have a plausible acquisition path.

### FORCE_POSITIONING
Represents meaningful unallocated capability, inadequate coverage, underutilized/redundant force placement, poor staging, exposure, or strategic access/response gaps. A meaningful undeployed local troop pool is a strong source. Army idleness alone is not.

### DEVELOPMENT
Represents a real economic, defensive, logistics, or infrastructure condition with a plausible concrete construction solution. Resources or free build capacity alone do not generate Development pressure.

### DIPLOMACY_PEACE
Per-opponent pressure when the current war is materially harmful, stagnant, deteriorating, or excessively burdensome. WAR alone and war duration alone do not generate it. Opinion modifies later scoring; it is not a pressure source.

### TRADE_ECONOMIC
Represents real marginal resource need or exchange opportunity plus a plausible counterparty. Shortage/surplus alone is insufficient without an actionable exchange opportunity.


## 12. Source Contexts and Actionability

**STATUS: LOCKED DESIGN**

The proactive deliberation unit is `DOMAIN + SOURCE CONTEXT`, not just a domain.

A ready source must pass a cheap contextual actionability gate before consuming the primary deliberation thread. `WAIT` alone never makes a context actionable; at least one plausible non-WAIT family must exist.

One cause may feed multiple domains, but each deliberation remains source-bound. Cross-domain substitutes remain owned by their own domains.

If the source disappears during deliberation: `CONTEXT_INVALIDATED`.

If the source remains but no meaningful legal non-WAIT plan exists: `NO_ACTIONABLE_PLAN`.

Neither result is `WAIT`; neither grants WAIT pressure relief or proactive reconsideration spacing.


## 13. Blocked Context Rearming

**STATUS: LOCKED DESIGN**

A `NO_ACTIONABLE_PLAN` context becomes dormant-but-observed and records the blockers that made its authorized candidate set infeasible.

Rearming is **predicate-based**, not merely event-based. A blocked context reopens only when a previously false feasibility condition becomes true strongly enough that at least one authorized non-WAIT candidate is plausibly actionable.

Examples:

- insufficient local troops -> rearm when a meaningful authorized reinforcement quantity becomes available, not on every +1 troop;
- insufficient Attention -> rearm when enough ordinary Attention exists for at least one authorized plan;
- reserved force -> rearm when a context-relevant force becomes legally usable;
- no route -> rearm when at least one authorized relevant route becomes legal;
- insufficient accessible resources -> rearm when a real candidate resource bundle becomes feasible;
- construction capacity full -> rearm when suitable capacity becomes available.

With multiple blockers, rearm only when at least one full candidate-feasibility predicate becomes plausibly true. A new transformed source or genuine emergency may create a new/reactive context immediately; blocker suppression must never hide a materially different crisis.


## 14. Candidate Generation

**STATUS: LOCKED DESIGN**

Candidate generation is bounded and context-specific. It need not search the entire world, but within the declared authorized candidate space it must be deterministic and complete before returning `NO_ACTIONABLE_PLAN`.

Do not randomly sample a few options and declare no plan if an authorized candidate was simply not examined.

Stable plan IDs/fingerprints include all strategically meaningful parameters, such as force, destination, route, reinforcement quantity/source, build site/resource sources, or trade terms/counterparty.


## 15. Domain-to-Action Mapping

**STATUS: LOCKED DESIGN**

- **MILITARY_INITIATIVE:** primary `ATTACK`; target-bound support `MOVE` / `REINFORCE`; narrow `RETREAT` recovery where appropriate; `WAIT`. For peaceful neutral acquisition, primary `MOVE`. For combat-required neutral acquisition, `ATTACK`.
- **FORCE_POSITIONING:** `MOVE`, `REINFORCE`, narrow `RETREAT`, `WAIT`. No direct `BUILD` or `ATTACK`.
- **DEVELOPMENT:** `BUILD`, `WAIT` only. Trade alternatives belong to Trade pressure; force alternatives belong to Force Positioning.
- **DIPLOMACY_PEACE:** `OFFER_PEACE`, `WAIT` only.
- **TRADE_ECONOMIC:** `TRADE`, `WAIT` only.

Support actions must directly serve the current source context. Unrelated actions are excluded.


## 16. Proactive Deliberation and Temporal V2

**STATUS: LOCKED DESIGN**

Authoritative cognition timing classes from Temporal V2:

- Routine proactive deliberation: **6-10 seconds online / 300-500 seconds offline**.
- Standard proactive deliberation: **12-20 / 600-1000**.
- Major proactive deliberation: **25-40 / 1500-2400**.
- Critical reactive deliberation: **1-2 / 5-10**.
- Urgent reactive deliberation: **2-5 / 20-50**.
- Required response deliberation: **3-8 / 30-80**.
- Proactive reconsideration spacing: **45-75 / 4500-7500**, sampled once with authoritative seeded deterministic RNG and persisted.

Ranges are sampled exactly once when the timer starts. Retry, recovery, replay, reconnect, and catch-up must not reroll them.


## 17. Proactive Initiation Lifecycle

**STATUS: LOCKED DESIGN**

Action initiation timings:

- `ATTACK`: 0 / 0 seconds.
- `REINFORCE`: 1 / 10.
- `BUILD`: 0 / 0.
- `MOVE`: 0 / 0.
- `OFFER_PEACE`: 1 / 30.
- `TRADE`: 2 / 60.
- `RETREAT`: 0 / 0.
- `WAIT`: 2 / 60.

For a nonzero initiation, after a plan wins:

1. Fresh legality validation.
2. Acquire exact reservations and applicable Strategic Attention.
3. Persist the sampled initiation duration/process.
4. Enter `PROACTIVE_INITIATION_IN_PROGRESS`.
5. Close ordinary proactive cognition immediately.
6. Reactive/required/recovery cognition remains allowed.
7. At successful initiation completion, revalidate hard prerequisites, apply the exact `commitEffect`, transform reservations as needed, apply relevant pressure relief, and begin proactive reconsideration spacing.

Reactive preemption cancels unfinished proactive deliberation, not an already-committed initiation process. An initiation may still be authoritatively invalidated if a hard prerequisite disappears. Invalidation releases/transforms reservations/Attention, applies no action effect, grants no false relief, and starts no proactive spacing.


## 18. WAIT

**STATUS: LOCKED DESIGN**

`WAIT` is a real scored proactive option meaning: **the current context remains real and actionable, but the faction deliberately prefers initiating no new proactive commitment over the available meaningful alternatives.**

WAIT is not a military, construction, or diplomacy commitment. It reserves no entity/resource and consumes no Strategic Attention. Existing world operations continue. Reactive/required/recovery cognition remains available.

### WAIT initiation

- 2 seconds online / 60 seconds offline.
- Ordinary proactive cognition is closed during this interval.

### WAIT completion revalidation

At completion, perform a lightweight revalidation of the original source:

1. faction still cognition-eligible;
2. source still exists;
3. source has not materially changed enough to stale the original WAIT decision;
4. at least one meaningful legal non-WAIT alternative still plausibly exists.

Outcomes:

- source gone -> `CONTEXT_INVALIDATED`; no relief, no spacing;
- source materially changed -> stale WAIT invalidated; fresh observation; no relief, no spacing;
- no meaningful non-WAIT alternative remains -> `NO_ACTIONABLE_PLAN`; install blocker predicates; no relief, no spacing;
- otherwise -> WAIT validly completes, grants moderate relevant pressure relief, then proactive reconsideration spacing begins.

Do not run a second full deliberation at WAIT completion. No second RNG draw is used.


## 19. Reactive, Required-Response, and Recovery Cognition

**STATUS: LOCKED DESIGN**

Three non-proactive cognition lanes exist:

1. `REACTIVE_EMERGENCY`
2. `REQUIRED_RESPONSE`
3. `OPERATION_RECOVERY`

They do not use Strategic Pressure or ordinary proactive reconsideration spacing.

Deterministic operation fallbacks execute before AI cognition. Recovery deliberation occurs only when authoritative mechanics expose an actual choice.

Reactive contexts are tightly scoped to the triggering problem. An endangered force cannot use its emergency context to build an unrelated farm or start unrelated diplomacy.

An unchanged handled reactive condition does not repeatedly retrigger. It may reopen on a material decision-relevant predicate change: severity escalation, new hostile participant, support loss, route invalidation, battle phase change, newly meaningful reinforcement availability, deadline boundary, or another authored material transition.

`NO_ADDITIONAL_INTERVENTION` is a valid reactive response outcome where the authoritative context allows it. It is not `WAIT`: no WAIT timer, no WAIT relief, no proactive spacing.


## 20. Required Response Outcomes

**STATUS: LOCKED DESIGN**

Required responses are not proactive action families.

Examples:

- Peace: `ACCEPT_PEACE`, `DECLINE_PEACE`.
- Trade: `ACCEPT_TRADE`, `DECLINE_TRADE`; `COUNTEROFFER` only if the final Trade contract exposes it.
- World events: choose among legal options supplied by the World Events Engine.

Required response cognition itself consumes no persistent Strategic Attention. If a response creates a new voluntary persistent commitment, that commitment may require Attention.


## 21. Seven Strategic Evaluators

**STATUS: LOCKED DESIGN**

The evaluator vocabulary is exactly:

1. `BATTLE_OUTLOOK`
2. `TERRITORY_VALUE`
3. `LOCAL_DANGER`
4. `FORCE_POSITION_VALUE`
5. `RESOURCE_VALUE`
6. `BUILD_VALUE`
7. `WAR_VALUE`

All seven evaluators are factual/goal-neutral. Personality, Ambition, Goals, Opinion, Risk Tolerance, hysteresis, repetition damping, and seeded near-tie variation are applied later in scoring.

Do not add `LOGISTICS_VALUE`, `WAIT_VALUE`, or `PEACE_VALUE` unless the design is explicitly reopened.


## 22. Evaluator Contracts

**STATUS: LOCKED DESIGN**

### BATTLE_OUTLOOK
Evaluates a specific engagement using authoritative combat primitives: troop quantity/composition where relevant, quality, morale, terrain, position, garrison, fortifications/city effects, and bounded combat modifiers. It does not answer whether the territory is worth taking or whether war is worth continuing. It must never inspect the actual future seeded battle result.

### TERRITORY_VALUE
Evaluates the factual usefulness of controlling/retaining a place: production/economic value, infrastructure, connectivity, terrain/position, shielding/dependency, resource access, and strategic topology. It excludes Goal preference.

### LOCAL_DANGER
Evaluates credible near-term hostile pressure relative to realistic defense/support. It uses committed hostile operations, reachable hostile strength, timing, local defense via Battle Outlook, and friendly support. It excludes speculative enemy intent, Goals, Personality, Opinion, Ambition, and Memory.

### FORCE_POSITION_VALUE
Evaluates the marginal usefulness of a specific force at a location: coverage, offensive access, response coverage, redundancy, mobility, exposure, and positioning utility. It excludes Goal preference and direct action preference.

### RESOURCE_VALUE
Evaluates marginal value of gaining/losing a specified quantity at a specified location/accessibility state. It includes supply, reservations/in-transit amounts, production, unavoidable demand, known strategic demand, saturation, and threshold effects. Gains/losses may be asymmetric.

### BUILD_VALUE
Evaluates the factual marginal value/cost of an exact legal construction project at a location, using authoritative building effects, projected post-completion state, resource/capacity/time/investment exposure, and other factual evaluators/support layers where relevant. Roads use Logistics Analysis; there is no generic road bonus.

### WAR_VALUE
Evaluates the factual strategic benefit/harm of continuing war with a specific opponent, including territorial/military/economic trajectory and opportunity burden. It is not Peace Value. Goal preference and Opinion are applied later.


## 23. Factual Support Layers

**STATUS: LOCKED DESIGN**

These are support layers, not strategic evaluators:

### LOGISTICS_ANALYSIS
Provides factual route/reachability, authoritative travel duration, reachable sets, alternate routes, connectivity/disconnection, redundancy, projected road/network impact, and transit dependence. It reports facts such as `12 minutes -> 8 minutes`, not `worth 73`.

### TIMING_PROJECTION
Provides valid completion-time possibilities from current progress without predicting future player presence. It may expose remaining time if future elapsed time stays online, remaining time if it stays offline, current exact progress, unsampled ranges, timing sensitivity, and real-world deadlines. It does not invent a probability that the player will log in.

For already-started processes, persisted sampled durations/progress are factual. Uncommitted candidate ranges must not consume future RNG merely to score the plan.

### COMMITTED_EFFECTS_PROJECTION
Derived from canonical `GameState` and active operations. It describes already-committed deterministic effects, contingent committed effects, pending responses, and accepted/executing effects. It never becomes a second authoritative GameState, never peeks at future RNG, and never recursively predicts future uncommitted AI/player choices.

### FACTION_DECISION_VIEW
The subset of canonical facts and faction-owned cognition the deciding faction is authorized to use. No fog of war does not imply access to another faction's private cognition.

### COUNTERPARTY_RESPONSE_ESTIMATE
Used by proactive Peace/Trade to estimate acceptance using only information authorized by the proposer faction's Decision View. It may not read recipient-private Goals, Opinion, pressure, deliberation, future RNG, or future decisions. The actual recipient response may use that recipient's own real internal state.


## 24. Cross-Action Scoring Architecture

**STATUS: LOCKED DESIGN**

There are two competitions:

- Strategic Pressure chooses **what source context deserves thought**.
- Context-specific cross-action scoring chooses **what exact plan to do about that source**.

There is no empire-wide universal action score comparing unrelated contexts.

Every candidate is compared against the same conceptual baseline:

`current canonical state + already-committed effects`.

WAIT is the `no additional proactive commitment` baseline; existing operations/economy continue.

Plan comparison categories may include:

- source resolution;
- additional strategic benefit;
- direct strategic cost;
- opportunity cost;
- commitment burden;
- timeliness;
- realization structure;
- uncertainty;
- modifiers;
- explanation.

Each causal consequence must have one scoring owner. Supporting evaluators may explain a fact, but comparators must not re-add the same consequence under another label.


## 25. Modifier Architecture

**STATUS: LOCKED DESIGN**

Modifiers interpret real strategic facts; they do not rewrite them.

- **Personality:** stable strategic style/preferences. Never a crude `Aggressive -> ATTACK +25` rule.
- **Ambition:** persistence toward meaningful long-term gains despite delay/cost/bounded risk. It is not aggression.
- **Goals:** specific long-term outcomes. Goal preference belongs only to the Goal modifier layer, not factual evaluators.
- **Opinion:** directed stance `Opinion[A][B]`; strongest for ATTACK/OFFER_PEACE/TRADE where relevant. Raw Memory does not double-count the same history.
- **Risk Tolerance:** interpretation of downside severity, variance, uncertainty, investment exposure, and long commitments.
- **Hysteresis:** modest resistance to reversing strategic direction over tiny score changes. It yields to major factual change/illegality/emergency.
- **Repetition Damping:** small contextual decaying resistance to semantically similar repeated plans. It must not prevent necessary repetition; WAIT never gets an escalating repetition penalty.
- **Seeded Variation:** final deterministic variation only among qualified near-tied plans; it cannot rescue a plan below the WAIT commitment threshold.

Modifiers must be bounded/saturating so a stack of preferences cannot overwhelm a clearly disastrous factual plan.


## 26. Selection Order

**STATUS: LOCKED DESIGN**

For each proactive source context:

1. Hard legality.
2. Physical/entity/resource/capacity availability.
3. Reservation conflicts.
4. Operation compatibility.
5. Strategic Attention feasibility.
6. Context relevance/actionability.
7. Factual evaluator/support outputs.
8. Context-normalized factual comparison.
9. Goal / Personality / Ambition / Opinion / Risk modifiers where relevant.
10. Hysteresis and repetition damping.
11. Minimum meaningful commitment advantage versus WAIT.
12. Seeded near-tie variation only among already-qualified near-ties.
13. Stable plan ID/order deterministic tie-break.
14. Fresh final revalidation/reservations/CAS before commit.

If the best non-WAIT plan does not clear the context's meaningful commitment margin, WAIT may win. Exact numerical scales remain unresolved.


## 27. ATTACK

**STATUS: LOCKED DESIGN**

An ATTACK plan contains an exact attacking force, target territory, and route.

Hard legality includes ownership/hostility, route, entity reservations, invasion capacity, Strategic Attention, attack cooldowns, recent-workout attack-protection gates, diplomacy clearance state, and orchestrator rules.

A mere pending peace offer does not make Attack illegal. After mutual peace acceptance enters `PENDING_HOSTILITIES_CLEARANCE`, neither party may initiate a new hostile operation against the other.

Scoring uses Battle Outlook, Territory Value, projected Force Position Value, projected Local Danger, Logistics Analysis, commitment/opportunity cost, and War Value context. Goals/Opinion/etc. apply afterward.

The AI must not inspect future combat RNG. Player intervention remains genuine uncertainty unless a separately authored player-behavior model is later approved.


## 28. REINFORCE and Troop Locality

**STATUS: LOCKED DESIGN**

Automatic troop generation is continuous and not a strategic action. A territory's baseline, Food condition, and city effects determine local troop generation; if physically available Food for that territory is zero, its generation rate is zero.

Generated troops enter that territory's **local undeployed reinforcement pool**, not a faction-global pool.

`REINFORCE` allocates an exact quantity from one local undeployed pool to a legal co-located destination: local garrison, eligible co-located field army, or a new local field army if the authoritative force model permits creation.

REINFORCE never transports troops across territory boundaries. Cross-territory troop movement uses physical `MOVE`.

For a nonzero REINFORCE initiation, the exact local troop quantity is reserved at initiation start and allocated at successful completion.

A force in MOVE, ATTACK approach, RETREAT, or active battle/invasion has a committed manifest and cannot receive ordinary REINFORCE during that lifecycle.


## 29. MOVE and RETREAT

**STATUS: LOCKED DESIGN**

`MOVE` is physical force transit along an exact route. It is the mechanism for cross-territory force redeployment and for peaceful occupation of legally acquirable neutral territory.

`RETREAT` is an exact force-to-fallback route plan used proactively in narrow exposed-position contexts or reactively in danger/recovery contexts. Immediate emergency retreat belongs to reactive cognition.

Both obey authoritative route timings, reservations, invalid-destination behavior, and physical locality. Emergency cognition does not create teleportation or bypass route legality.


## 30. Neutral Territorial Acquisition

**STATUS: LOCKED DESIGN**

No `EXPAND` action exists.

- Peacefully occupiable neutral territory -> `MOVE` plus authoritative occupation/claim rules on arrival.
- Neutral territory that requires combat -> `ATTACK` plus authoritative Battle/Invasion/Occupation rules.

`NEUTRAL_TERRITORIAL_OPPORTUNITY` is a Military Initiative source only when the territory is legally acquirable, meaningfully valuable, and has a plausible path.

If two factions race toward the same neutral territory, the Territory/Occupation subsystem owns arrival/claim resolution. An executor must not silently convert an invalidated MOVE into an ATTACK.


## 31. BUILD and Resource Locality

**STATUS: LOCKED DESIGN**

Resources are geographically localized. Faction aggregate totals are informational; they are not omnipresent spendable inventory.

A BUILD plan includes the exact structure/site, exact resource source stockpiles/quantities, required transfer/shipment manifests, and construction slot/capacity.

At zero-second BUILD commit:

1. validate structure/site/capacity;
2. validate exact resource sources;
3. reserve the exact required resources;
4. reserve construction site/slot/capacity;
5. create the project;
6. create required local-transfer/shipment operations.

Project states conceptually include `AWAITING_MATERIALS -> UNDER_CONSTRUCTION -> COMPLETE`.

The project lifecycle starts at BUILD commit, but the authored construction-class work timer starts only when all required materials are physically ready at the site. Therefore project completion time may equal material logistics time plus construction work time.

A qualifying construction workout may immediately complete remaining construction work only once the project is `UNDER_CONSTRUCTION`; it does not teleport missing materials.

Executor-side resource re-shopping is forbidden. If planned sourcing becomes invalid, use authoritative recovery/replanning semantics.


## 32. TRADE

**STATUS: LOCKED DESIGN**

Trade is proactive and allowed during WAR. Terms are exact and concrete.

Only the proposer's offered resources are reserved while the proposal is pending. Because resources are localized, the proposer reserves exact offered quantities from exact source stockpiles during TRADE initiation. Requested recipient resources are not reserved merely because a proposal exists.

Recipient insufficiency does not invalidate proposal creation; `ACCEPT_TRADE` is illegal until the recipient can provide the requested side. On acceptance, the recipient resolves exact legal source quantities and reserves/allocates them atomically.

Accepted goods require physical shipment: load, route transit, unload. No teleportation.

AI does not voluntarily withdraw its own pending Trade proposal. Player withdrawal may exist as an external player rule. No arbitrary global pending-proposal cap exists unless later explicitly authored.

A counteroffer, if the final Trade contract supports it, terminates the old proposal, releases the old proposer's reservation, then begins a new exact Trade proposal with the countering faction as proposer.

Proposal-management Attention belongs to the voluntary proposer and releases when the proposal reaches a terminal response/finalization boundary; physical shipment afterward is Logistics execution, not continued diplomatic Attention.


## 33. Peace Lifecycle

**STATUS: LOCKED DESIGN**

`OFFER_PEACE` creates a proposal after its 1/30-second initiation. While merely pending, the relationship remains WAR and new hostilities remain legal unless another rule blocks them.

If the recipient accepts while hostile operations already exist, enter `PENDING_HOSTILITIES_CLEARANCE` rather than cancelling those operations.

Once mutual acceptance has occurred:

- neither party may initiate a new hostile operation against the other;
- existing hostile operations continue normally to terminal state;
- once hostile operations clear, run the authoritative peace finalization process and enter PEACE.

Mutual acceptance releases proposal-management Strategic Attention; waiting for old hostilities to clear is an authoritative diplomacy lifecycle, not ongoing proposal management.


## 34. Memory, Opinion, Goals, and Conflict Ledger

**STATUS: LOCKED DESIGN / UNRESOLVED DETAILS**

AI Memory is historical/support state. It may record events and feed explicitly defined current-state updaters, but it is not a pressure domain, strategic evaluator, or free-floating score modifier.

Historical events may update Opinion or Goal lifecycle state. Later decisions use the current Opinion/Goal state rather than re-adding the same Memory event as another bonus/penalty.

Factual war trajectory belongs in an authoritative Conflict/War Ledger, not subjective Memory.

Strategic hysteresis and repetition fingerprints are separate from narrative Memory.

**UNRESOLVED downstream designs:** exact Goal creation/priority/achievement/invalidation rules; Opinion update formulas; Conflict Ledger schema/window/reset rules.


## 35. Faction Lifecycle

**STATUS: LOCKED DESIGN**

Only an `ACTIVE` faction may initiate new autonomous AI decisions.

`INACTIVE` or `ELIMINATED` factions initiate no new proactive strategy, optional reactive military decisions, or autonomous diplomatic initiatives.

Existing operations, proposals, reservations, construction, shipments, etc. transition according to their owning subsystem's authoritative elimination/invalidation rules. The AI must not invent those consequences.


## 36. Determinism, Canonical State, and Persistence

**STATUS: LOCKED DESIGN**

- Backend TypeScript/Node is authoritative; Unity renders state and sends intent.
- `GameState` is the single canonical runtime world.
- AI support views/projections are derived and disposable, never independent authorities.
- Supabase persistence uses player/world payload plus optimistic `state_version` CAS; stale writers conflict, never hidden-merge.
- Reservations transform/release atomically on terminal state.
- Timed work preserves exact/fixed-point progress and is replay/catch-up equivalent.
- Seeded timer ranges are sampled once and persisted; historical RNG never rerolls.
- Future combat RNG is never exposed to Battle Outlook or candidate scoring.
- Stable context/plan IDs and stable deterministic tie-breaks prevent server iteration order from becoming hidden RNG.
- Same-second authoritative boundaries use a stable replay-safe implementation order; do not add fake gameplay delay to separate them.


## 37. Temporal V2 World Processes Relevant to AI

**STATUS: LOCKED DESIGN**

Current Temporal V2 reference values remain authoritative unless explicitly superseded above:

- Canonical precision: 1 second.
- No global online/offline clock multiplier; each process owns its rates.
- Force route per-hop online/offline: normal 120/840 sec; moderate 180/1260; difficult 240/1680; severe 360/2520.
- Road per-hop override: Level 1 60/420; Level 2 30/210; Level 3 5/35.
- AI-vs-AI battle: 120/1800 after attacker arrival.
- AI attacks player intervention window: 120/1800 after arrival.
- Standard fight finalization when applicable: 5 sec.
- Qualifying defensive workout victory finalization: 3 sec after successful completion; workout timing itself is external.
- Construction work classes: VERY_SMALL 300/900; SMALL 600/1800; STANDARD 1200/3600; LARGE 5400/7200; EXTRA_LARGE 18000/54000. **These work timers begin at `UNDER_CONSTRUCTION`, after required materials are physically ready.**
- Resource generation: anchored every 1800 simulation seconds.
- Food consumption: continuous/gradual.
- Automatic troop generation: continuous; Food=0 -> generation rate 0.
- Local resource transfer: 5/30.
- Shipment load: 10/60; route transit; unload: 5/30.
- AI attack cooldowns: AI->AI same attacker 0 online / 1800 offline-only; AI->same player 0 online / 10800 offline-only; player->AI no artificial cooldown.

Real-world deadlines ignore presence multipliers. Presentation time and processing time never alter authoritative gameplay outcomes.


## 38. Battle/Invasion Integration Boundary

**STATUS: UNRESOLVED / EXTERNAL**

The AI architecture assumes the Battle/Invasion subsystem owns combat participant/input locking and mid-engagement integration.

Still to define externally before implementation of all edge cases:

- which battle inputs are locked at battle start;
- whether/how a second friendly force arriving during an active engagement participates;
- whether fortification completion during an active engagement changes the battle input set;
- exact multi-army same-target invasion semantics;
- exact retreat/disengagement/interception rules.

The AI must not invent these rules. Battle Outlook consumes the authoritative combat interface once these contracts are defined.


## 39. Remaining Downstream Unresolved Items

**STATUS: UNRESOLVED**

The following do **not** reopen the core AI architecture but must be designed before their implementation phase:

- numeric Strategic Attention capacity/costs and phase costs;
- exact pressure accumulation thresholds/rates and anti-starvation formula;
- score normalization and weights;
- exact minimum commitment margins versus WAIT;
- modifier magnitudes/saturation curves;
- Goal lifecycle;
- Opinion updater;
- Conflict/War Ledger;
- player-intervention uncertainty policy;
- exact army merge/split/garrison reassignment semantics;
- multi-force same-target invasion rules;
- Trade delivery-node selection and no-route-at-acceptance behavior;
- construction cancellation/refund/remedy rules;
- exact resource storage-node schema;
- building-to-construction-class assignments;
- builder acceleration formula;
- exact emergency Attention overflow implementation;
- exact response-thread priority formula and same-priority stable key ordering;
- World Event response vocabularies/timelines owned by the World Events Engine.


## 40. Implementation Status Classification

**STATUS: IMPLEMENTED / PROPOSED / UNRESOLVED**

### LOCKED DESIGN
Everything explicitly labeled `LOCKED DESIGN` in this document is the intended current product architecture and should be treated as the design target.

### IMPLEMENTED
**Unknown until repo audit.** Do not infer implementation from this document or from older handoff files. The next Codex phase must inspect the actual repository and classify each major item as `IMPLEMENTED`, `PARTIAL`, `MISSING`, `CONFLICTING`, or `LEGACY`.

### PROPOSED
Only numeric/operational details explicitly left open in this document remain proposed. Do not invent values during repo reconciliation.

### UNRESOLVED
Items in Sections 38-39 have explicit external owners or later design phases. Implementation should expose interfaces/placeholders where necessary rather than guessing product rules.


## 41. Codex Phase 1 — Mandatory Repo Audit Before Changes

**STATUS: LOCKED WORKFLOW**

The next engineering step is **audit first, no code changes**.

Codex should inspect the actual repo and report, with file paths and symbols, the current status of:

- AI action vocabulary and old action remnants;
- canonical `GameState` and any duplicated AI/world state;
- AI observer/decision loop;
- Strategic Pressure or legacy action scoring/director logic;
- one-thread cognition and Temporal V2 timing integration;
- WAIT behavior;
- reservations/entity/quantity/capacity locking;
- Strategic Attention if any;
- battle/invasion interfaces;
- movement/routes;
- troop generation and undeployed pool location semantics;
- economy/resource stockpiles and physical shipments;
- BUILD/construction lifecycle;
- diplomacy/peace/trade;
- Memory/Opinion/Goals;
- RNG/determinism/replay/catch-up;
- Supabase persistence and `state_version` CAS;
- tests/simulations.

Every major requirement should be classified as:

- `IMPLEMENTED`
- `PARTIAL`
- `MISSING`
- `CONFLICTING`
- `LEGACY`

The audit must identify reusable systems and specific conflicts. It must not rewrite the engine during the audit phase.


## 42. Codex Non-Negotiable Implementation Invariants

**STATUS: LOCKED WORKFLOW**

When implementation begins after the audit:

- reuse working systems instead of creating parallel replacements;
- maintain one canonical `GameState`;
- keep combat/economy/fitness/timing/RNG/persistence authority on the backend;
- keep Unity presentation/input only;
- use exact plans and authoritative reservations;
- never hide-merge stale CAS writes;
- preserve logical command identity across network retry;
- do not restore discarded actions or old global timing models;
- do not invent unresolved product rules;
- work phase-by-phase: audit -> implement -> test/build -> review -> Git checkpoint -> next;
- after every phase, report changed files, tests run, remaining gaps, and any design conflict found, then STOP.


## 43. Structural Freeze Statement

**STATUS: LOCKED DESIGN**

The **core structural AI decision architecture is frozen** at this version for repository reconciliation.

Frozen structural elements include:

- eight proactive actions;
- five Strategic Pressure domains;
- seven factual strategic evaluators;
- source-context deliberation;
- actionability and predicate-based blocked-context rearming;
- WAIT/no-action semantics and WAIT completion revalidation;
- context-specific candidate generation;
- cross-action comparison and single-owner contribution accounting;
- modifier ownership;
- reactive/required/recovery cognition;
- one primary deliberation thread;
- multiple compatible concurrent world operations;
- Strategic Attention architecture;
- reservation/compatibility architecture;
- local troop/resource geography;
- physical logistics;
- Committed Effects Projection;
- Timing Projection;
- Faction Decision View and AI epistemic boundary;
- Memory role;
- proactive initiation lifecycle;
- determinism/CAS principles.

Do not reopen these during implementation merely because the legacy code is different. If implementation reveals a genuine contradiction with an authoritative non-AI subsystem, surface it for design review instead of silently changing doctrine.
