# Implemented lane, scheduling, Attention and execution contracts

This records **IMPLEMENTED** code. Provisional choices are not locked product doctrine. The three lanes are cognition lanes, not actions/evaluators/Pressure domains. Proactive vocabulary remains eight; factual evaluator vocabulary remains seven.

## Eligibility and lane behavior

All optional contexts require `canThink`: an eligible non-player faction, `activeDiplomacyFaction` under existing faction lifecycle rules, and no existing Level-1 tutorial suppression. Current domain existence is checked again before reasoning/execution. Facts come from canonical `GameState`.

| Lane | Current eligible subjects | Scheduling / priority | Attention and exact execution | Terminal behavior |
|---|---|---|---|---|
| `REACTIVE_EMERGENCY` | Actual hostile attack intent within the authored imminent threshold, with incoming troop count exceeding current local garrison/stationary support; active invasion reference for an eligible AI defender where such domain state exists. WAR/idleness/Memory/Goals alone are insufficient. | Critical or urgent; positive sampled deliberation timer. Current provisional severity ordering puts critical before urgent before ordinary required before recovery; ready required windows have a separate non-starvation settlement pass. | Thought itself has no persistent charge. A selected exact intervention acquires normal physical claims/action cost. Critical contexts may authorize bounded extra Attention. | Fresh scoped plans → shared factual comparator → qualified near-tie selection → shared atomic start. Successful start records `INTERVENTION_STARTED`; no worthwhile/legal intervention records dormant `NO_ADDITIONAL_INTERVENTION`. Disappearance invalidates. |
| `REQUIRED_RESPONSE` | Publication of a pending Peace/Trade proposal addressed to an eligible AI recipient. Player expiry remains a domain deadline. | Existing independently progressing proposal response window; at readiness, actual-recipient assessment/settlement is serialized by the shared reducer. Required work temporarily owns the canonical primary thread and restores prior emergency progress. | Bypasses Pressure, proactive spacing and ordinary free Attention merely to answer. Existing Peace/Trade settlement paths are used. A voluntary counteroffer would remain a new commitment; autonomous counteroffer strategy is absent. | Current pending/feasibility facts are rechecked. Domain ACCEPT/DECLINE settles proposal and reservation/Attention as before; stale/withdrawn/ineligible reference invalidates without fabricated decline. Context records `RESPONSE_SETTLED` after domain response. |
| `OPERATION_RECOVERY` | Active operation in recovery or its army blocked; accepted shipment blocked in custody. | Referenced physical state creates a context. Current domain exposes no authorized remedy choice, so it becomes immediately dormant without a deliberation timer or evaluation suite. | No replacement operation, claim or charge. Existing force/quantity/cargo/Attention ownership remains with its original domain/operation. | `NO_ADDITIONAL_INTERVENTION` while undefined remedy remains; resumed/terminal physical work invalidates stale context. No retry loop or invented spatial/cargo policy. |

Current required integration is Peace/Trade only. Source-of-Truth world-event examples do not imply a schema-27 world-event response implementation. Production currently creates player-facing invasions; non-player invasion observation is therefore an extension contract, not proof of a new AI invasion system.

## Scope and exact-plan ownership

`nonProactiveCognition.ts::reactivePlans` declares stationary owned forces on the defended territory and its immediate owned neighbors; one adjacent support/withdrawal hop; counterattack toward the actual hostile force's location where legal; existing meaningful local-pool REINFORCE quantities. Plans are deduplicated by exact IDs, deterministically ordered and filtered through ordinary legality, claims, compatibility and Attention.

No unrelated BUILD/Peace/Trade/WAIT fallback is generated. RETREAT uses existing off-owned-ground legality; normal current territory threats predominantly produce MOVE/ATTACK/local REINFORCE. No remote reinforcement or new-army creation.

`ContextPlanComparator.compareInterventions` reuses all seven factual evaluators, normalization, contribution ownership and bounded own Goal/Opinion/Risk modifiers. There is no Pressure input and no WAIT plan. The implicit zero baseline is `NO_ADDITIONAL_INTERVENTION`, not a ninth action. A plan must remain worthwhile after the existing commitment threshold before near-tie RNG can choose it.

`handlers.ts::startResponseIntervention` checks canonical context identity/revision/signature, existence, thinking status, selected exact plan and fresh scoped feasibility. It calls `startExactPlan` → `startOperation` → `executeConcreteCommitment`. Domain handlers for ATTACK, MOVE, RETREAT and local REINFORCE are reused; BUILD's shared executor exists but is outside current reactive scope. Peace/Trade required responses reuse existing proposal settlement, not a second physical executor. Recovery has **no executor** because no remedy is defined.

`startOperation` uses the existing nested cloned-state transaction: exact plan/claims/compatibility/Attention checks, claims and operation-owned charge, operation creation and domain start succeed together or roll back. Existing CAS remains final persistence serialization. The integration callback preserves returned events/notifications/resource/army/territory changes. Caller request parameters are restored in `finally`.

## Attention

`constants/aiResponse.ts::RESPONSE_POLICY.emergencyExtraCapacity` is **2**, explicitly **PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED / INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN**.

The faction's normal canonical capacity and configured action costs remain unchanged. `occupiedAttention` derives costs from active operation-owned charges. Only an owned critical reactive context in a qualifying live status can request the extra allowance. Existing reserved emergency overflow is accounted for. There is no separate emergency budget store or manual refund.

`acquireAttention` persists exact `contextId`, `revision` and overflow on the new operation when capacity is exceeded. It does not bypass forces, troops, resource quantities, routes, claims, relationship legality or battle rules. Urgent/required/recovery contexts cannot make voluntary physical operations free. Required assessment itself needs no capacity; zero-cost REINFORCE still needs exact pool/destination claims and its 1/10-second initiation.

Central `settleOperation` releases charges once at true physical terminal settlement. Strategic invalidation with unfinished movement preserves force claim, elapsed travel and charge. Blocked physical work retains Attention; accepted cargo has no diplomatic Attention under the prior Trade contract. Replays cannot release another operation's charge.

Invariants enforce owned provenance, valid cost/overflow, aggregate extra bound, terminal release and existing claim ownership. See self-audit item F3 for conservative accounting that may reject otherwise within-bound combinations; no correction is made in this freeze.

## Deterministic scheduling and clocks

`responseContextId` uses full JSON-encoded faction/subject identity, defended territory and actual hostile commitment/conflict-chain identity when available. New hostile commitments are distinct problems; historical unidentified intent is explicitly `legacy-unidentified`, not fabricated history. Priority uses severity, remaining required deadline, descending irreversibility, creation boundary and lexical exact ID. Factions, threats and plans are sorted using the repository's code-point comparison, not locale/Map order.

`primaryByFaction` owns one response context per faction. Independent physical operations keep progressing. Urgent/critical work cancels unfinished proactive deliberation, retaining Pressure with no relief/spacing; it does not cancel WAIT or committed initiation. A higher-severity response queues lower-severity thought retaining its sampled timer/progress. Resumption updates the watermark so inactive queue time is not earned as thought.

Response clocks use the existing authoritative presence/duration kernel: offline→online promotion, no demotion. Critical 1–2s online / 5–10s offline; urgent 2–5s / 20–50s. Required proposal windows retain their existing 3–8s / 30–80s AI timing surfaces and domain ownership. Physical completion/arrival gates precede cognition through the existing temporal/Orchestrator flow; non-proactive scheduling runs before proactive thought and again after newly started physical work at the same boundary. Required player expiry is not AI cognition.

The observer runs only on dirty domain notifications or a material hostile-arrival threshold. Quiet calls check empty indexes without physical/history scanning. Positive timers and handled-context dormancy prevent unlimited same-instant thought. `lastBoundaryByFaction` is persisted bookkeeping; it is not by itself the recursion guard. The shared reducer can be reached from normal progression or domain/transaction compatibility wrappers, but those delegate to the same settlement implementation.

### RNG inventory

1. `startProactiveTimer` is reused for a *new* emergency deliberation duration, seeded from world seed, faction, timer kind and persisted `nextTimerSequence`. Exact sampled duration/progress is persisted. Queueing/reload does not resample.
2. Existing Peace/Trade publication samples their domain response timer once through the same duration helper; registration adds only a reference, including migration.
3. `processNonProactiveBoundary` forks a decision-local seed from exact response ID/revision; `selectInterventionComparison` consumes a draw only among qualified near ties. No observer/priority/recovery RNG and no future Battle RNG is consulted.
4. Reused physical domain execution may use its existing Battle RNG; Phase L does not create an evaluation draw from that stream.

Historical handled outcomes are not rerolled on unchanged observation. A genuinely material revision is new reasoning work, not replay of an old decision. Tests cover preserved samples/reload; self-audit notes the concrete thread-ownership exception.

## Claims / cancellation / cleanup

| Subject | Existing owner reused | Phase L handling |
|---|---|---|
| Force / movement | Operation force claim + army movement | Incompatible concurrent lane starts fail fresh checks; elapsed work is not erased by cognition cancellation. |
| Attack engagement | Exact force/engagement claims + attack intent/invasion | Same claimed force cannot receive substitute operation. Existing terminal outcome/link cleanup remains central. |
| Undeployed troops | Exact local quantity claim | REINFORCE holds exact quantity/destination during initiation, revalidates and allocates once; no troop creation. |
| Garrison / destination | Existing reinforcement destination claim | Two lanes cannot allocate overlapping protected destination/quantity through parallel successful transitions. |
| Construction / resources | Existing site/capacity/resource rules | No new reactive BUILD path; existing operations/Trade reservations remain authoritative. |
| Manifests / cargo | Trade proposal reservations and accepted shipment custody | Required response reuses atomic bilateral acceptance; blocked cargo is neither credited nor refunded. |
| Attention | Each physical operation's persisted charge | Narrow critical overflow is still operation-owned and terminal-settled. |

Two contexts may *propose* the same force or local quantity, but fresh `assessConcretePlanFeasibility`, `acquireOperationClaims`, existing quantity-sum invariants and CAS serialize actual starts. Cognition preemption releases no physical claim; context closure is separate from operation settlement. There is no `ReservationStore`, alternate world clock or second execution authority.

**Review caveat:** scheduling is not certified defect-free. The exact urgency-escalation primary-marker failure is documented/reproduced separately, and is left unchanged.
