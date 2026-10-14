# Military recovery — final independent review

**PASS for the requested correctness scope.** Military recovery uses conserved local troops and the existing exact-operation authority. No reproduced troop duplication, double settlement, reservation defect or replay divergence was found. A measured performance problem was corrected without changing simulation outcomes. Strategic effectiveness remains limited by substantial attrition; this is not a balance approval.

## Reviewed state and preservation

Worktree `/workspace/REP-WARS-2-AI-SIM`, branch `dev/ai-longrun-simulation`, HEAD `6f38eec6516682e64937b08744a5607f54bbba91`. The initial worktree had eight tracked modifications and intentional simulation/helper/test/evidence files. Its 3,194 existing tracked/untracked files were fingerprinted before review. All prior evidence is preserved. Only the three production paths listed below changed during this review. No staging, commit, push, merge, schema change, Food rule, scoring weight, combat formula, action threshold, world-clock or Unity change occurred.

## Military authority review

- `reinforcementProblem` validates positive safe-integer quantity, source owner/pool identity, local destination, available unreserved quantity, invasion restrictions and operation-derived army-ID collision.
- `requiredClaims` reserves the exact local quantity and the local destination. Claim acquisition checks conflicts before writes. Formation is the existing REINFORCE/new_army contract, not an extra AI action.
- `settleOperation` requires mature initiation timing, fresh domain validity and exact owned claims before calling allocation. Allocation debits the pool, creates the local army, updates membership/linkage and terminates the operation within the canonical transaction draft.
- Identity is derived injectively from the canonical operation ID using JSON string encoding; neither RNG, collection length nor wall clock assigns it.
- Terminal settlement is idempotent. Collision, cancellation, conquest, insufficient stock, wrong ownership, receipt retry and stale CAS writer tests pass. Direct duplicate allocation refuses terminal ownership.
- Existing native movement/transit, reinforcement, Attention, invariants, snapshot/hydration and session receipt/CAS paths remain in use. There is no second force store or physical execution authority.

## Medium seed 11 day performance investigation

Same configuration: medium/11, 1,440 online simulation ticks, step 5, reload every 60. All profiles ran sequentially on Linux x86_64, Node v24.19.0; five logical CPUs are exposed. Measurements include the real engine and development harness, canonical persistence/reload and retained decision diagnostics. They are workload measurements, not gameplay performance guarantees.

| Measurement | Reference without recovery | Reviewed recovery candidate | After narrow optimization |
|---|---:|---:|---:|
| Fresh profiled runtime, seconds | 57.267 | 161.565 | 107.588 |
| Decisions | 904 | 3,595 | 3,595 |
| Battles | 33 | 81 | 81 |
| Operations | 128 | 447 | 447 |
| Captures | 65 | 220 | 220 |
| Instrumented source observations | 14,824 | 42,920 | 42,920 |
| Observation inclusive time, seconds | 21.754 | 81.329 | 30.094 |
| Clone calls / inclusive seconds | 5,370 / 11.486 | 5,689 / 22.642 | 5,689 / 22.615 |
| Hydration calls / inclusive seconds | 1,755 / 14.425 | 1,755 / 29.628 | 1,755 / 30.514 |
| Snapshot calls / inclusive seconds | 1,757 / 10.687 | 1,757 / 21.959 | 1,757 / 22.347 |
| Error-constructor CPU self samples, seconds | 14.482 | 47.666 | 0 sampled |

The reference loads actual approved Git blobs through the existing reference loader. Its complete digest matches the archived previous behavioral run, which took 55.154 seconds. The fresh pre-optimization recovery run matches the archived 154.274-second candidate digest. Bootstrap differs between loaders; the reported simulation elapsed duration starts inside the native runner, after imports.

**Legitimate additional work:** recovery sustains three factions at the day endpoint rather than one, nearly quadruples decisions, and enlarges canonical operation/history state. The same 1,441 session lifecycle calls and 1,755 hydrations consequently process larger payloads. Clone, snapshot and invariant costs remain significant. The profiling table contains overlapping inclusive measurements; do not sum them.

**Avoidable overhead:** Trade demand repeatedly called throwing construction prerequisite assertions for ordinary unavailable candidates (completed development or missing city). Build-source observation also used exceptions as a predicate. The actual CPU profile attributes 47.666 seconds of self samples to `OrchestrationError`; the observed call chain includes `tradeDemand → assertCanStart`. A small independent fixture reproduces 555 Error allocations across 25 faction-boundary passes before the change and zero afterward.

**Not the dominant cause:** 31,843 instrumented strategic-access calls totaled 0.600 seconds, and 54,761 field-recovery calls totaled 2.540 seconds before optimization. These include cheap early exits. Cross-module wrappers count intercepted calls; same-module lexical calls are not all intercepted. CPU samples and enclosing timings support the conclusion without pretending these counters cover every invocation.

### Minimal correction

`constructionStartProblem` is a pure non-throwing prerequisite query. The five authoritative definition assertions call that same query and still throw the original code/message/details for rejected commands. Trade-demand and build-source probes use the query directly. Costs, durations, resource/slot checks, completion effects and decision eligibility are unchanged. No cross-decision cache was introduced.

An independent probe compiled the actual saved pre-change definition source and compared 600 native assertion/query cases, including missing territories, ownership, cities, fortification levels and completed developments: zero semantic mismatches and zero input mutations. The first probe compared an absent optional `details` property with `details: undefined`; its retained failure was a comparison-shape issue. JSON-equivalent query comparison and exact old/new command-error comparison both pass.

The fresh optimized Medium run has **identical complete canonical state and exact decision/event timeline bytes**, including all scores and failures. Runtime falls 33.4% in the paired profiling runs. Remaining costs are predominantly canonical cloning/serialization/hydration/invariants and increased real activity, not evidence for lowering AI commitment thresholds.

## Two invalidated attacks

Both are expected authoritative-state invalidations, not a reservation double-use bug. A force reserved for its own attack can still defend its physical territory; its claim does not grant immunity from casualties. After defending, 25 soldiers are lost from a 101-soldier force. Native arrival revalidation rejects the now-76-soldier attack. The failed attack does not roll a second battle or refund/recreate troops.

| Exact operation | Canonical terminal tick | Attention release tick | Claimed quantity/entity cleanup |
|---|---:|---:|---|
| `cmt_b_1dsm2he_933_kw_ATTACK_t_003\|"f_ai_0"` | 936 | 936 | Empty terminal claim IDs; no live own claims |
| `cmt_b_1dsm2hf_1326_t0_ATTACK_t_007\|"f_ai_1"` | 1328 | 1328 | Empty terminal claim IDs; no live own claims |

The earlier contained-failure artifact labels observation batches 940 and 1330 as terminal ticks. Actual operation terminals are 936 and 1328. Battle rows similarly carry outer batch ticks; their input turns are 933 and 1327. This report preserves the older artifact and distinguishes these clocks. The 76 survivors are present immediately after defensive casualty calculation; both armies are lost later, so they are **not** present in the day-end snapshot.

`executeReadyStrategicAttack` clears intent/movement on rejection; the handler settles the exact operation and releases claims/Attention. The independent replay preserves four nested references to these two failures, zero troop/siege/five-resource residuals and valid committed state. The strict existing CLI would continue to flag the nonempty nested-error arrays. The profiling entry collects them rather than asserting zero errors; its exit status is not a claim of zero domain failures. The targeted native-arrival regression verifies no battle/refund and idempotent cleanup.

## Newly formed armies and sustainability

Analysis covers all 16 archived final military configurations. Cases overlap in duration and reuse faction labels; these are cohort totals, not independent-world estimates.

- 94 armies formed; 93 formed with 101 soldiers.
- 77 are absent at run end. The cohort's 77 distinct losing battle participants per case account for those losses; 17 remain.
- Formed armies participated as attackers 110 times: 59 wins, 51 losses. They defended 36 times: 10 wins, 26 losses.
- 43 attacks had native execution-time win probability below 50%. Matched commitment diagnostics show negative relative advantage for 14 and very favorable advantage above 0.9 for 25; the other four have intermediate/missing extracted advantage values. Execution-time probabilities are not claimed to be information available at commitment.
- 24 formed armies never attacked. They can still defend, move or survive; this count is not automatically a planning failure.
- Medium seed 11 day formed 28 armies, lost 26, and recorded 50 formed-army attacks (30 wins, 20 losses). Large seed 11 day forms 19 successive armies for one faction. Repeated attrition is a genuine behavioral weakness.

A traced Large seed 11 case illustrates changed facts: at commitment tick 378 the target garrison is zero; by native battle turn 380 it is 101 after a local garrison reinforcement, reducing the attacking 101-soldier army's native probability to 0.465. Other unfavorable commitments remain selected under existing territory, Opinion and Risk preferences. No future recipient reasoning or RNG is read to prevent these outcomes. No personality, score, combat or attack threshold was changed to manufacture better statistics.

## MOVE and Trade review

Owned-route discovery is disposable, deterministic weighted traversal over owned land with native travel durations and stable IDs. The exact candidate remains an adjacent physical MOVE; it does not teleport or commit a speculative full conquest route. Claims, invasion participation and exposed-origin guards remain intact. Some candidates still lose to better alternatives or remain below the existing margin; no forced MOVE bonus was added. Current measured route/recovery query costs do not justify a new cache or search redesign.

Declined-Trade suppression applies only to the exact declined plan in its recorded observable context. Stocks, demand, route, public relationship and proposer-owned modifiers can reenable it; alternate terms/counterparties and explicit offers remain legal. The blocker uses the existing canonical source record, not raw historical memory scoring or a private recipient estimate. Relevant-context, insertion-order, reload, explicit-offer and alternative-offer regressions pass. WAIT churn remains; the fix does not prove improved diplomacy.

## Affected authoritative reruns

| Case | Archived recovery seconds | Fresh review seconds | Result |
|---|---:|---:|---|
| Medium 11 online day | 154.274 | 107.588, profiled | Exact state and timeline; same two contained failures |
| Large 29 online six hours | 163.614 | 67.666 | Exact state and timeline; 1,951 decisions, one formation, two proactive MOVEs, zero repeated exact declines |
| Small 11 online week | 92.507 | 84.968 | Exact state and timeline; same 68 AI upkeep shortages, no formation |

The controlled same-instrumentation Medium before/after comparison is 161.565→107.588. Other rows compare archived versus fresh host measurements and are not controlled universal speedup estimates. All three preserve every measured resource/troop/siege residual at zero. No scenario assumption, seed, presence or reload setting changed. The other 13 configurations were audited from preserved evidence, not rerun in this review.

## Personally rerun validation

| Suite/check | Result |
|---|---|
| New prerequisite/performance regressions | 5 passed / 0 failed / 0 skipped |
| Military recovery | 31 / 0 / 0 |
| Existing MOVE/Trade behavioral tests | 31 / 0 / 0 |
| Existing simulation tests | 19 / 0 / 0 |
| A–L focused | 837 / 0 |
| Integration | 319 / 0 |
| Full backend runner | 1,916 reported passed / 0 failed; three credential-gated live Supabase skips, 1,913 actually executed |
| Production TypeScript `--noEmit` | PASS |
| Test-inclusive TypeScript | Exit 2; same 28 inherited diagnostic identities, no additions/removals |
| `git diff --check` | PASS |
| Native pre-change/current prerequisite parity | 600 cases, zero mismatches/mutations |
| Independent archived-state hydration/invariants | 16 cases; zero violations/residuals; missing formed-army identities exactly match distinct battle losers |

Full backend counts do not include the standalone development suites; these were explicitly run. A–L and integration overlap the full runner and must not be summed as unique test cases. In-memory retry/CAS coverage ran; credential-gated live database coverage did not.

The first independent archive-hydration probe omitted registration of the synthetic authored world and was correctly refused by the native WorldCatalog boundary. The corrected probe registers each archived scenario's actual definition before hydration. Its successful results and initial fixture error are both preserved; no production hydration change was needed.

### Reproduction commands

Run in the simulation worktree:

```sh
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiMilitaryReview.ts
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiMilitaryRecovery.ts
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiBehavioralFixes.ts
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiLongRunSimulation.ts
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-driver.cjs focus
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-integration.cjs focus
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit
git diff --check
```

For a fresh profile, set `REVIEW_OUTPUT` to a **new** path and run the saved `evidence/profile.cjs` using the same ts-node registration and `--cpu-prof --cpu-prof-interval=2000`. For the reference use the existing `scripts/ai-behavioral-baseline.cjs` loader with that entry point. Saved `stack-count.cjs` supports `REVIEW_PRE_PERFORMANCE=1`, loading the three preserved pre-performance source texts without changing the checkout. `prerequisite-parity.cjs` likewise compiles the actual preserved old definition. Avoid overwriting this evidence.

## Exact changes in this review

Production:

1. `src/gameplay/construction/definitions.ts`: shared non-throwing prerequisites; authoritative assertions retain errors.
2. `src/gameplay/trade/candidates.ts`: pure prerequisite query for factual demand.
3. `src/engine/strategicPressure.ts`: pure prerequisite query for build-source observation; all pre-existing recovery/MOVE edits retained.

New regression file: `tests/aiMilitaryReview.ts` (five tests). New report: this file. New evidence/results: `docs/ai-military-final-review/`, inventoried by its manifest. No existing implementation report, simulation artifact, military helper, scoring implementation or prior regression was rewritten.

Keep the three production changes, regression and concise report as reviewable code/doc scope. Raw CPU profiles, full timelines and snapshots are reproducible generated evidence, not automatic commit candidates. The manifest hashes their exact bytes. All historical evidence remains available.

## Remaining risks and recommendation

1. High repeated military attrition deserves a separate evidence-led strategy review. Minimum usable formations and existing attack preferences do not establish sustainable war planning. Do not infer causation solely from a losing roll.
2. Whole-state cloning, serialization and conflict-invariant work grow with canonical history. Context/history compaction remains deferred; no second authority or hidden cache was added here.
3. Low MOVE frequency and repeated WAIT evaluation remain strategic limitations, not proven missing legal candidates in the reviewed fixtures.
4. Food provisioning remains blocked on the separately reviewed located-bank/transport contract requested by the user. No automatic collection or local-upkeep reinterpretation was implemented.
5. Spatial/cargo recovery, broader battle timing, generic invasion rearming and other previously deferred policies remain deferred. Live Supabase behavior was not newly proven without credentials.

No demonstrated military correctness blocker remains in this review. Preserve the unstaged candidate and use an explicit scoped Git review/checkpoint; this task does not create it. The next behavioral milestone should analyze minimum-force survival and counterparty defensive response from observable facts before proposing any policy tuning.
