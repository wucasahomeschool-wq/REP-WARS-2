# Backend scale and world-validation continuation

Parent: `fcbbb046abbb6ae964d0c309b772d37e1af948a7`; isolated branch `perf/backend-world-validation`. Schema remains 30. No world content, Unity, economy, AI preferences or time rules change.

## Scope and source

This phase completes combined validation of bounded catch-up, geometry correctness and external verification budgets, and removes measured geometry-validation overhead without weakening checks. `tests/backendScale.ts` uses validated authored-world fixtures and the actual session host, in-memory CAS persistence, hydration, AI, operations and world advancement. It is not a second engine or the archived AI-SIM campaign.

The synthetic rectangular worlds have 10/30/50 territories and 3/5/8 AI factions, plus a passive player. Starting stock/armies, terrain output and personality traits come from the existing tiny fixture, with unique faction/personality identities and contiguous initial ownership. There are no post-start grants, authored reward ratios, new gameplay constants or custom AI decisions. Relationships explicitly start at WAR. These are engineering fixtures, not recommended production balance.

For each seed 11 and 29, run 360 ticks for all three sizes and 1,440 ticks for the largest. Each case compares a trusted large request budget with one chunk per request, recreating the session host and loading persisted state before each request. A historical server lease explicitly earns the target at 1.0x: 360/1,440 ticks mean six/24 simulation hours of continuous online presence, not ordinary calendar play. The fixture never derives authority from a client clock.

All eight final canonical snapshots match exactly across request chunking/reload. Every persisted boundary passes invariants, progresses toward the unchanged accrued target, and preserves the input definition. One-chunk runs use six or 23 requests respectively. Source/test compilation and build have zero diagnostics.

## Measured results and limitations

`BACKEND_SCALE_VALIDATION.json` preserves both executions of every case, hashes, timings and memory observations. The focused run has 26 passes (16 existing geometry regressions plus 10 new tests), zero failures. Six-hour operation counts for seeds 11/29 are 15/40, 147/106 and 196/159 for the three sizes. Day runs record 256/159 operations. These are durable operation records, not decision/WAIT counts; compact catch-up omits detailed proactive decisions. Attack-resolution records are not a distinct battle count or victory rate. Changed territories compare endpoint ownership, not every intermediate capture.

Six-hour cases report no Food failures. Day cases report 18/17 failed Food cycles. This is the still-unresolved faction-bank versus local-stock provisioning contract, not repaired by catch-up or silently waived as a passing economy claim. Both processing cadences reproduce the same outcomes. No automatic Food collection, located bank or transport rule is introduced.

The largest day case takes about 57/61 seconds whole/sliced; a single sliced request reaches 4.8 seconds. A chunk-count limit bounds admitted historical work, **not CPU latency**. Production ingress and capacity testing remain necessary. RSS reaches roughly 1.1 GiB in the focused process, including TypeScript, multiple cases and retained runtime allocations; it is not an isolated per-world memory requirement. Snapshots reach about 1.87 MB. The measurements are local Linux/Node v24.19.0 smoke evidence, not a production SLA.

## Contained attack failure

The 50-territory seed-29 run contains an `INVALID_TARGET`: operation `cmt_16_vtbycy_23_f_ATTACK_scale_tile_18|"scale_ai_4"` arrives at tick 25 after ownership changes from its expected `scale_ai_2` to `scale_ai_1`. Exact target revalidation correctly rejects it.

The first test incorrectly required an empty domain-error list; the preserved failure prompted investigation rather than an engine change. `tests/probes/backendScaleInvalidation.cjs` instruments the actual execution and settlement in an isolated process: zero battle invocations, unchanged physical troops/locations/resources/local pools/economy/bank/identity counter/seed across rejection and settlement, no remaining operation claims or intent, and Attention 4 → 1 (three released). Repeated terminal settlement returns false and leaves canonical state unchanged.

The permanent tests permit only `INVALID_TARGET` errors linked to failed ATTACK resolutions with verified terminal cleanup; unrelated errors fail. This does not convert failed attacks into successful battles, refund earlier losses, or waive arbitrary engine errors.

## Geometry optimization

Correctness validation added in `c106304` increased costs for detailed authored rings. The optimized implementation performs conservative edge-bound checks before expensive predicates and prepares per-call point-location bounds. Padding includes the existing perpendicular and endpoint tolerances, including short edges. There is no persistent cache, new authority, relaxed tolerance or content repair.

Five alternating measured validations after warm-up against the unchanged parent:

| Definition | Parent median | Candidate median |
|---|---:|---:|
| registered Level 1 | 259 ms | 113 ms |
| registered Level 2 | 368 ms | 139 ms |

Reproduce with `node -r ts-node/register tests/probes/worldValidationBenchmark.cjs /path/to/parent-worktree`. The probe reports source hashes as well as HEADs because an uncommitted candidate shares its parent's HEAD. Validation runs on authored creation and `applyImmutableWorldDefinition` during hydration; it is not a per-tick observer. Full containment/overlap/partial-edge tests remain enabled. New tests add 2,000 rotated analytical rectangle cases and tolerance boundaries. A separate temporary differential probe compared 20,000 seeded pairs at five scales (60,000 checks) with the parent: zero mismatches. Raw probe/logs are retained at `/tmp/repwars-validation-performance/`; permanent analytical regressions do not depend on those files.

## Validation status

The earlier geometry/dependency full-suite attempts and an initial combined run were interrupted without a final summary; none is counted as passed. The completed combined `npm test` rerun exits 0: **2,268 passed, 0 failed, 3 skipped**. All eight case hashes also match the separate focused run. The increase from the last completed 2,220-pass run is 16 geometry + 22 dependency-budget + 10 scale/optimization regressions. Production and test-inclusive TypeScript, production build and whitespace checks pass with zero diagnostics. No live database or hosted Unity test has been executed. Three Supabase cases remain credential-gated.

## Next engineering work and external gates

The previously unavailable AI-SIM checkpoint `ce63ad0bd1d74494c0a87f494d65d9efb8d88b25` is now available through the remote-tracking ref. This phase does not merge it or claim its MOVE/Trade changes are integrated. Its pure construction-prerequisite optimization is the next candidate for a separate current-code reproduction and compatibility check; current recovery already has its own local army formation, so copying the older branch wholesale would be unsafe.

Provider/account mapping, approved non-production database credentials and deployed RPC/RLS proof, operational restore/ingress/monitoring checks, authored workout ratios/content, Level 1 content selection and unresolved gameplay logistics still block production completion. GitHub Actions API inspection returned Forbidden; local tests do not establish hosted CI success. No merge or deployment was performed.
