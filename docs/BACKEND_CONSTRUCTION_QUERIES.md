# Non-throwing construction prerequisite queries

Parent: `e7f557fa903316ef1ab15770d42350bd0995fbbf`. Isolated worktree `/workspace/REP-WARS-2-CONSTRUCTION-QUERIES`, branch `perf/backend-construction-queries`. Schema stays 30.

## Reproduction and scope

Current `tradeDemand` and the fortification build-source probe used `assertCanStart` as an ordinary availability predicate. Completed developments, absent cities and other expected unavailable choices repeatedly constructed caught `OrchestrationError` objects. The current six-territory tiny fixture with completed infrastructure produced 30,000 error allocations during 1,000 demand scans across its three factions. A focused regression over 25 demand/source passes failed before the change with 1,475 allocations instead of zero.

This is the same narrow issue documented in the now-accessible AI-SIM checkpoint `ce63ad0bd1d74494c0a87f494d65d9efb8d88b25`. The current construction definition file was still identical to its original shared ancestor. The approved pure prerequisite implementation is reused and independently checked against the current parent; no branch is merged and no older military, RNG, reward or AI behavior is copied wholesale.

## Implementation

- `src/gameplay/construction/definitions.ts`: `constructionStartProblem` returns a typed diagnostic or null, without mutation or Error allocation. Existing five command assertions use that same prerequisite query and still throw the original public error when invalid.
- `src/gameplay/trade/candidates.ts`: demand queries consume that result directly.
- `src/engine/strategicPressure.ts`: the existing fortification availability predicate does likewise.

Resource affordability, reservations, construction slots, timing and completion remain in their existing authoritative paths. This helper is an internal prerequisite query, not a replacement command validator. It adds no cache, new authority, schema field, policy constant or gameplay rule. Candidate eligibility, scores, RNG and action vocabulary are unchanged.

## Tests and independent comparisons

Six new registered tests cover exact missing/foreign territory errors, completed-at-zero developments, city/fortification requirements, separation from resource checks, unchanged factual demand and input state, and zero error allocations from ordinary observation. The pre-change failure is retained in `BACKEND_CONSTRUCTION_QUERY_VALIDATION.json`.

`tests/probes/constructionParity.cjs <parent-commit>` loads the actual parent definition source read-only through Git. Across 600 cases it compares command errors and the query result for all five project types with varying ownership, absent territory, city, completed infrastructure and fortification. **Zero differences; zero input mutations.** The first sandbox invocation could not spawn Git (`EPERM`); the identical read-only probe passed with the execution permission needed for that subprocess. This was an environment restriction, not a waived test failure.

`tests/probes/constructionAllocation.cjs` repeats the current demand scan. Allocations fall **30,000 → 0**; output hashes are identical and both input snapshots are unchanged. Local elapsed time was 248 → 5.6 ms for that microbenchmark. Do not interpret this as the speedup of the entire backend.

The full backend runner completed with **2,274 passed, 0 failed, 3 explicit live-Supabase skips** (2,268 parent passes plus six new regressions). Production and test-inclusive TypeScript and production build pass with zero diagnostics; whitespace checks pass. No credential-gated test is counted as passed. The complete full-run terminal summary was verified after the environment pause; an interrupted partial log was not used as proof.

## Larger-world behavior and performance

All eight existing seeded scenarios were rerun by the full suite in both whole and one-chunk/reload modes: **16/16 final canonical hashes exactly match the parent run**. This includes the contained target-owner invalidation, claims/Attention cleanup and existing day-run Food failures. No gameplay improvement is inferred from faster execution.

| Scenario, seed | Whole before → after | Chunked/reload before → after |
|---|---:|---:|
| 10 territories, 360 ticks, 11 | 1.139 → 0.605 s | 1.056 → 0.603 s |
| 10 territories, 360 ticks, 29 | 0.770 → 0.553 s | 0.821 → 0.610 s |
| 30 territories, 360 ticks, 11 | 4.331 → 2.701 s | 4.359 → 2.923 s |
| 30 territories, 360 ticks, 29 | 3.298 → 1.997 s | 3.502 → 2.120 s |
| 50 territories, 360 ticks, 11 | 12.277 → 6.005 s | 12.269 → 6.294 s |
| 50 territories, 360 ticks, 29 | 6.794 → 3.631 s | 6.834 → 3.891 s |
| 50 territories, 1,440 ticks, 11 | 59.081 → 31.856 s | 61.123 → 35.440 s |
| 50 territories, 1,440 ticks, 29 | 13.790 → 9.263 s | 14.655 → 10.180 s |

These are single local Linux/Node v24.19.0 comparisons from consecutive full-suite runs. CPU scheduling, compiler overhead and cumulative memory affect them; they establish an observed improvement, not a hosted capacity guarantee. All fixtures/seed/presence assumptions remain those in `BACKEND_VALIDATION_SCALE.md`. No archived AI-SIM performance figure is substituted for these measurements.

## Remaining boundaries

This does not integrate the historical distant-MOVE or declined-offer behavioral changes, select between the two branches' recovery candidate policies, solve strategic attrition, or define Food bank/transport. Those remain separately identified work/contracts. Public deployment still needs an approved identity provider/account mapping, non-production database verification and operational review, authored workout policies/content, selected Level 1 content and the unresolved gameplay contracts in `BACKEND_COMPLETION.md`. No Unity edit, protected-branch merge or deployment is performed.
