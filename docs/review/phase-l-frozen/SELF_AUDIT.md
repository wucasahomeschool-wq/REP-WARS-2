# Freeze self-audit findings — no fixes made

This task packages Phase L for an **independent review**; it is not a review approval or checkpoint. Actual tracked diff, all new source/test files, migration/clone/serialization, response callsites and existing validation evidence were inspected. Additional review-only probes mutate in-memory fixtures only. No production/test implementation was edited.

## F1 — Confirmed primary-thread ownership defect (high priority)

`src/engine/nonProactiveCognition.ts::observeNonProactiveWork`, urgency-escalation branch: after changing one context from URGENT to CRITICAL, it unconditionally calls `scheduler.primaryByFaction.delete(fid)`. The current primary can belong to **another** context whose status remains `thinking`.

Reproduction: one queued urgent approaching threat plus another critical threat already thinking for the same faction; advance the approaching threat to critical, then observe/process. The initial response invariants are clean. Observation reports `unowned thought`; subsequent processing produces two `thinking` records with only one primary marker. The canonical invariant rejects the invalid draft rather than permitting it to persist, so a production command could fail/roll back at that boundary.

Evidence: `scripts/self-audit-probes.ts`, first block; `evidence/self-audit-probes.jsonl`. It invokes real observer/processor/invariant functions with the existing Phase L in-memory threat fixture. The existing 60 Phase L tests do not cover escalation of a *different* context while another context owns the primary thread.

**Unfixed by explicit freeze instruction.** Passing suites do not negate this finding. Independent review should not approve a checkpoint until it is addressed under separate authorization.

## F2 — Invasion materiality/rearm gap (limited reachability)

The invasion observer signature contains only `inv.status` and sorted attacking army IDs. It does not include changed troop strength, local support, relevant route or newly feasible reinforcement alternatives. A blocked invasion context can remain blocked after a material support/pool change even with the dirty observer invoked. The second probe records this behavior in a synthetic AI-defender invasion support fixture; it is a unit contract probe, **not** proof of a normal production invasion reaching a non-player defender.

Current `beginInvasionAgainstPlayer` targets the player; `canThink` excludes the player. This narrows present production exposure, but the generic observer branch should not be treated as full future invasion-rearm coverage. No invasion or recovery design is invented here.

## F3 — Emergency budget availability is conservative (code-level question)

`strategicAttention.ts::assessAttention` computes `overflow = occupied + cost - capacity` and compares it to `allowance - reservedOverflow`. Because `occupied` already includes earlier overflow, the earlier amount can be effectively counted again. Example: capacity 6, occupied 6 including 1 still-reserved overflow after other work finishes, new MOVE cost 2; final occupancy 8 fits a two-unit extra occupancy bound, but the check rejects `2 <= 1`. Persisted per-operation overflow charges remain reserved until settlement, so the reviewer must distinguish a reserved-allowance policy from a simple total-occupancy policy.

This is not an observed leak or double-use; it is potentially stricter initiation than the stated aggregate allowance. Numeric policy is provisional and no tuning/change is made. Reviewer should establish intended allowance accounting before changing it.

## F4 — Required windows vs one deliberation thread (semantic review)

Proposal windows advance independently while full assessments are serialized in `settleReadyRequiredResponses`. Ready required work temporarily takes the primary regardless of severity and then restores emergency progress, avoiding deadline starvation. This is explicit implemented behavior, not a second mutable scheduler. Whether parallel windows represent queued response deadlines or concurrent conceptual deliberation should be checked against the final doctrine. Current Phase H/I policy is preserved rather than silently replaced.

## F5 — Runtime derived index mutation contract

`createResponseMap` has derived WeakMap live/ready/territory indexes. In-place context status changes must be followed by `map.set`; production callsites inspected do this. Cloning/hydration rebuilds indexes. Direct future mutation or a plain-Map replacement uses different/fallback indexing behavior. This is a maintenance contract to review; no current duplicate authority was found. The exact context Map remains serialized authority.

## F6 — Scope and existing physical integration limitations

Detection uses factual current troop counts and provisional imminent thresholds, not a full combat-power/survival classifier. Current invasion materiality and recovery capabilities are limited as above. Broader battle timing, spatial recovery, cargo remedies and world-event response subjects remain unresolved/not implemented. Do not infer complete physical defense/recovery from passing cognition tests.

## F7 — History cost / diagnostic instrumentation boundary

Quiet fixture has 40,000 cheap queue calls but no observer scans/thoughts. Active indexes avoid terminal-history hot scans. Full context cloning and response invariants still inspect retained records; stress history growth is not certified by the quiet benchmark. Diagnostic metrics are monkey-patched only in the review fixture process, not production source. No benchmark instrumentation leaks into runtime authority.

## Other inspected concerns

| Concern | Observation at freeze |
|---|---|
| Duplicate world/action authority | None found in changed production paths; exact domain maps and canonical context/scheduler remain distinct. |
| Hidden nondeterminism / unstable ordering | Context IDs use complete semantic strings; queue/faction/force/plan ordering is explicit. No `Date.now`, `Math.random`, UUID, locale sort or client time in the new response source. |
| RNG reroll | New timer/revision samples use persisted sequence; queued unchanged work retains timer; final seeded draw is limited to qualified near ties. No observer/recovery/future-Battle draw found. |
| Second scheduling / execution path | Domain compatibility wrappers and transaction hooks delegate required assessment to the same reducer. Reactive starts delegate to existing exact operation transaction/executors. |
| Claims / Attention leaks | Existing atomic clone/claims/domain start and terminal settlement reused; physical invalidation retains ownership. No scattered new refund was found. Existing tests cover rollback/reload/duplicate terminal behavior. |
| Lane starvation | Ready required settlement has explicit non-starvation priority. Recovery has no authorized choice and therefore remains dormant. No formal unbounded stream fairness guarantee is authored. |
| Infinite recovery loops / accidental proactive work | Dormant recovery has no timer/evaluator/start, WAIT/Pressure relief/spacing are excluded; current subject existence is rechecked. |
| Operation double execution / stale exact parameters | Selected context/plan is verified and domain start revalidates exact parameters; central settlement remains idempotent. F1 is a thread bookkeeping failure, not substitute execution. |
| Defaults / persistence | Schema 27 requires response authority; migration invents no history/timers. Clone/hydrate rebuild indexes. No new persistence service/clock/CAS semantics. |
| Tests weakened | Existing tracked test changes inspected are schema/key expectation updates; new tests add response behavior. No passing-suite claim hides known compile errors or these probe findings. |

The production freeze is preserved even where findings are suspicious or confirmed. No implementation correction, commit, push or later phase occurs in this task.
