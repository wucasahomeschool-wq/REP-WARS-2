# Long-run behavioral fixes — root-cause audit

Audit performed before production edits on `dev/ai-longrun-simulation`, HEAD `6f38eec6516682e64937b08744a5607f54bbba91`. Index empty; original 119 untracked simulation files present. All 118 checksums listed by the original manifest match. Original evidence and harness are preserved; follow-up outputs use a separate directory.

| Issue / classification | Confirmed trigger and responsible path | Evidence | Recommended minimum fix / complexity | Rule implications / required regression |
|---|---|---|---|---|
| 1. **AI planning defect** | `deriveSources` recognizes only adjacent/one-staging-hop hostile opportunities, exposed forces, and adjacent defensive coverage gaps. `sourcePlanPredicates` cannot propose a rear force's first legal hop toward a distant frontier. Existing FORCE_POSITION_VALUE only values adjacent offensive access, so expanding candidates alone is insufficient. | Archived small seed 11 week state: `army_1`, 868 troops at `t_009`, hostile sites `t_000/t_001/t_006`; `deriveSources` returns no sources. | One source for a concrete, reachable, credible frontier-access gap per uncommitted force; deterministic owned-route search; one exact adjacent MOVE per source. Measure marginal travel-adjusted physical access in existing FORCE_POSITION_VALUE. No exhaustive quantities/paths/targets or future state. | Reuses FORCE_POSITIONING/MOVE, existing movement duration and combat power. No policy/weight changes. Test remote-frontier hop, no arbitrary idleness pressure, Peace/protection, unsafe departure, claims, stable ordering, arrival/re-observation, neutral evaluators and reload. |
| 2. **Unresolved design decision** | `reinforcementProblem` explicitly rejects `destination.kind === 'new_army'`; allocator supports only garrison/existing army. MOVE relocates existing armies. `commitBankedTroopsAndAttack` is expressly player-only and spends workout rewards. | Archived faction `f_ai_0` owns land and a 16,798-troop local pool but has no field army; legal local source/quantity still returns `Local-pool army creation has no authoritative domain path`. | Do not invent a deployment rule. Requires an approved local-force creation contract: exact identity/capacity, destination claim, initial morale/supply, and allocation behavior. | Block this issue pending product authorization; no player rewards or free troops. Regression must preserve explicit refusal and prove no pool deduction/entity creation. |
| 3. **Existing economic constraint / unresolved autonomous-collection policy** | Local Food production enters `territoryEconomy.uncollected`; recruitment spends it locally. `consumeEmpireFood` pays only `faction.resources.food`. `collectTerritoryYield` can transfer owned yield on an explicit command, but AI execution exposes only eight proactive actions, with no authorized autonomous collection/transport path. Farm output is expressly conditional on collection in factual support. | Archived small seed 11 week state: `f_ai_1` bank Food 0, uncollected owned Food 45,507, Stability 34. Eighteen AI upkeep failures; observer adds 168 fixture failures. | Do not auto-bank, move Food, redirect upkeep, or add COLLECT. Product must decide AI collection versus physical local provisioning/logistics. Distinguish these from ordinary insufficient production. | Bank/local custody and reservations must stay truthful. Test bank-only upkeep, collection conservation through existing domain path, and no new autonomous transfers. |
| 4. **Missing response-aware candidate filtering; ordinary below-margin WAIT is legitimate** | All legally feasible Trade candidates remain eligible after an actual DECLINE; no exact-response checkpoint is retained by source cognition. The canonical comparator's repetition slot is explicitly deferred; action-level legacy scoring is not live. WAIT relief/spacing is enforced, but saturated Trade pressure remains eligible. | Large seed 29: 46 declines of Gold 30 for Stone 40; eight endpoint configurations because land changes. Latest declined exact plan remains among current candidates. Separately, 1,251 of 1,364 WAITs are Trade-source decisions. | Record the actual declined plan as a bounded source-context blocker against its observed terms/relevant publicly observable resource/route context. Rearm on relevant facts, own cognition, different terms or endpoints; allow other candidates. Use existing source/blocker authority, no new timers, history scan, automatic acceptance or score tuning. | Proactive contextual filter only; exact explicit offers/acceptance remain legal. Do not reinterpret WAIT or suppress all Trade. Test same declined plan suppression, alternate terms, relevant rearm, unrelated changes, privacy, persistence, and successful Trade. |

The fourth fix targets **actual declined proposals**, not all WAIT selections. Waiting when no exact plan clears the meaningful commitment margin is current locked behavior. Lower WAIT counts alone will not establish a fix.

The first fix extends authored source coverage, not the movement executor: a selected MOVE still contains only one exact adjacent hop and reserves the actual force. Arrival completes that operation before fresh observation chooses another hop or ATTACK. Factual access uses physical combat-capacity difference and existing authoritative travel duration; it does not encode personality, Goals, future RNG, or a flat aggression bonus.

No new numeric balance constants, currencies, proactive actions, Pressure domains or evaluators are proposed. The response filter records source-owned context, not raw Memory scoring or recipient-private cognition. Additive source/blocker vocabulary uses existing schema-27 fields; no historical sources or decisions are fabricated.

## Decisions needed

1. Whether REINFORCE may create a new local field army from a reserved local pool, and the authoritative identity/capacity/morale/supply contract.
2. Whether NPC economy has an automatic collection rule, or Food upkeep must receive explicitly transported/local provision. Existing manual collection alone does not authorize either.

These issues remain blocked in this pass unless explicitly authorized. Independent safe source/candidate fixes continue.

## Completed implementation and verdicts

| Finding | Final status | What is and is not established |
|---|---|---|
| Remote idle armies | **IMPROVED BUT NOT FULLY RESOLVED** | The archived missing-source case now produces a qualifying exact adjacent MOVE and the army advances in the real simulation. Reachable frontier discovery is no longer restricted to one staging hop. Other distant first hops can still fail the existing scoring margin or reduce defensive coverage; they are not forced to move. |
| Last field army | **BLOCKED BY DESIGN DECISION** | The current domain explicitly refuses local-pool `new_army` deployment. Tests establish the gap and preserve pool/entity state. No deployment, free recruitment, or player reward reuse was added. |
| Bank Food versus local production | **BLOCKED BY DESIGN DECISION** | Bank-only upkeep and explicitly collected local production are existing gameplay behavior. Tests confirm the custody split and conservation through the authorized collection command. Autonomous NPC collection/provisioning remains undefined; no Food was moved automatically. |
| Retrying an actual declined Trade | **CONFIRMED FIXED for unchanged-context exact retries** | A native DECLINE records a bounded candidate predicate in its canonical source. The same complete plan is filtered until relevant context changes, while different terms and explicit offers remain legal. General below-margin Trade/positioning WAIT churn is **NOT RESOLVED** and ordinary WAIT remains intentional current behavior. |

The unanswered deployment/provisioning questions do not authorize either rule. These two issues were left blocked while independent safe changes proceeded.

### Exact production scope

- `src/army/strategicAccess.ts` (new): disposable deterministic weighted search over owned land, stable IDs/ties, current hostile feasibility, native movement durations and combat power. One concrete reachable target per eligible force; origin defense, active claims/operations/invasions, Peace and player protection remain constraints. Search is O((V+E) log V), with O(V+E) temporary storage; there is no exhaustive candidate Cartesian product or permanent route authority. It runs at existing observation/comparison boundaries, not as a new per-tick world observer.
- `src/engine/strategicPressure.ts`: adds `STRATEGIC_ACCESS` under existing FORCE_POSITIONING, authors exactly the next adjacent hop, and applies actual-decline context predicates. Existing signatures retain their old representation when no response blocker exists.
- `src/scoring/contextPlanComparison.ts` and `src/scoring/strategicEvaluators.ts`: existing FORCE_POSITION_VALUE compares usable physical attack capacity discounted by remaining authoritative owned travel. This replaces its offensive-access term for that source rather than adding another bonus. Existing weights, commitment margin, defensive terms and Goal neutrality remain intact.
- `src/types/AIPressure.ts` and `src/state/pressureInvariants.ts`: additive source/blocker vocabulary and exact source-to-MOVE binding; existing ownership/claim invariants remain enabled.
- `src/gameplay/trade/declinedContext.ts` (new) and `src/gameplay/trade/trade.ts`: record response relevance only after native terminal decline releases proposer claims. Fingerprint includes exact terms/endpoints/source, relevant observable holdings/demand/incoming custody/routes, public relationship, and the proposer's own relevant modifiers. Only own resource Goals concerning these terms affect rearming. Counterparty private cognition is never queried. Retention is bounded to current source candidates, with no terminal-history scan or separate authority.

Schema remains **27**, with no new fields or fabricated history. The source/blocker enum vocabulary is additive: saves using it require the updated reader; older executables may reject these new enum values. Existing schema-27 saves without these records retain their signature format. Historical declines do not acquire invented context during loading; filtering learns prospectively at the next actual decline.

No numerical tuning constants, action costs, personality weights, movement/battle/economy rules, world-time rules, recruitment rules or workout progression were changed. The eight proactive actions, five Pressure domains and seven factual evaluators remain unchanged. There is one canonical GameState; execution still commits the selected force and adjacent route through the existing operation/CAS path. Full owned routes are diagnostic search results, not instructions to teleport or execute a future plan.

## Before/after simulations

All **16 original configurations** were replayed twice: actual baseline code loaded read-only from Git, then the corrected production code. Every baseline final-state digest matches the archived original case. Configurations, fixed seeds, presence, batching and reload cadence match. The final matrix was rerun after production files were frozen; preliminary iterations are retained separately and excluded from the comparison.

Across the nine six-hour online cases:

| Metric | Before | After |
|---|---:|---:|
| Decisions | 7,234 | 7,732 |
| ATTACK | 689 | 678 |
| REINFORCE | 1 | 3 |
| BUILD | 524 | 524 |
| Proactive MOVE | 0 | 5 |
| OFFER_PEACE | 0 | 0 |
| TRADE | 50 | 4 |
| RETREAT | 0 | 1 |
| WAIT | 5,970 | 6,517 |
| Operations | 1,296 | 1,243 |
| Battles | 278 | 271 |
| Territory captures | 638 | 630 |
| Repeated complete exact declined offers | 38 | 0 |
| Final idle forces with credible distant frontier access | 4 | 3 |

MOVE above counts proactive decisions; reactive physical MOVE operations are reported separately in case summaries. Repeated offers include complete endpoints/source, not merely resource pair. Large seed 29's 46 Gold-for-Stone declines comprise eight distinct endpoint configurations and 38 repeats, rather than 46 identical full plans.

Small seed 11 now makes a real MOVE, progresses its army and records 24 attacks versus 21, and 11 battles versus 10. Its distant frontier gap disappears. This is useful military activity, not just fewer WAITs. In the week run, conquest leaves one surviving faction rather than two but raises AI bank-Food failures **18 to 68**. That exposes the unresolved provisioning constraint more strongly; it is not an economy improvement.

Large seed 29 reduces Trade decisions 47 to 2 and exact repeats 38 to 0, but WAIT rises 1,364 to 1,757 and battles fall 52 to 44. The engine continues considering other below-threshold sources; it does not automatically accept Trade or become universally more active. Build totals remain unchanged and no proactive Peace succeeded in this corpus. Elimination, remaining pools, resource balances, recruitment, physical shipments and surviving field forces are preserved per case in the comparison JSON rather than summarized as recovery fixes.

Three remaining six-hour frontier gaps were independently assessed. Medium seed 29 MOVE scores -0.155; Medium seed 47 scores -16.432 with defensive opportunity cost; Large seed 11 scores 3.039 below the existing margin of 5. The sources and candidates exist and no qualifying competing plan was ignored in these snapshots. Improving this longer-horizon preference requires separate evidence/design review, not a forced MOVE or hidden bonus here. See `evidence/residual-frontier-assessments.jsonl`.

All **32 final matrix executions** completed without command/nested errors or reported invariant violations. Troop, siege and all five resource accounting residuals were zero. This demonstrates the measured boundaries, not a proof of every possible gameplay state.

Runtime/memory effects are mixed. Large seed 29 six-hour runtime rises 121.37 to 161.38 seconds; Large seed 11 day rises 141.29 to 164.77 seconds. More available sources and continued WAIT deliberation create real additional work. Peak RSS ranges approximately 381–771 MiB before and 355–928 MiB after. These processes include TypeScript/compiler/bootstrap, canonical cloning and retained full private scoring logs, and host workloads overlapped. They are reproducible workload observations, not isolated engine benchmarks or proof of a universal percentage regression. No per-tick global planner, new polling system or unbounded candidate search was added. Further optimization should measure source/search/evaluation costs separately before changing behavior.

Full per-case results: `docs/ai-behavior-fixes/results/COMPARISON.md` and `COMPARISON.json`. Readable timelines, compressed private decision/event logs, final snapshots and exact configurations are retained in `results/before/` and `results/final-after/`.

## Regression and validation evidence

**31 new focused regressions** cover the archived missing-source failure and exact movement lifecycle, stable weighted routing, hard legality/protection/claims, defensive departure, Goal-neutral facts, persistence and input/RNG immutability; the explicit army-deployment gap and bank/local Food split; native required-response decline, same/alternative terms and counterparties, relevant versus unrelated rearming, private recipient cognition, replayed settlement, reservation conservation, physical bilateral acceptance, schema signatures, and native three-size conservation.

The portable archived fixture lives under `tests/fixtures/ai-behavioral/`; the tests do not require the large generated simulation corpus. Two focused tests were deliberately run against the **actual baseline Git code** before accepting the fix: 0 passed / 2 failed as expected (missing distant source and repeated declined candidate). The corrected suite passes. This expected failure evidence is not a current-suite failure.

| Personally executed check | Result |
|---|---|
| New behavioral regressions | **31 passed / 0 failed / 0 skipped** |
| Existing standalone long-run harness | **19 passed / 0 failed / 0 skipped** |
| Existing focused AI A–L | **837 passed / 0 failed** |
| Existing backend integration | **319 passed / 0 failed** |
| Full existing backend runner | **1,916 reported passed / 0 failed**; three live Supabase checks were credential-gated skips counted in its legacy passed total |
| Production TypeScript | **PASS**, exit 0 |
| Test-inclusive TypeScript | Exit 2, **same 28 inherited diagnostic identities** (file/code/message, ignoring shifted positions); no new or removed identity |
| Matrices | **16 baseline + 16 corrected**, all measured invariants/conservation checks clean |
| Original evidence integrity | **118/118 manifest entries unchanged**, plus original manifest preserved |
| Final production integrity | **8/8 production fingerprints match** the final simulation code |

The unavailable live checks are Supabase save/reload, atomic Postgres world/workout-history commit, and server restart. In-memory CAS and existing mocked persistence/integration tests executed; no live-database approval is implied. New suites are standalone and additional to the old runner's counts.

Commands from `/workspace/REP-WARS-2-AI-SIM`:

```bash
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiBehavioralFixes.ts
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiLongRunSimulation.ts
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-driver.cjs focus
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-integration.cjs focus
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit
node scripts/ai-behavioral-matrix.cjs before
node scripts/ai-behavioral-matrix.cjs after --output-root docs/ai-behavior-fixes/results/final-after
node node_modules/ts-node/dist/bin.js --transpile-only src/simulation/longrun/compareBehavior.ts
git diff --check
```

Logs and fingerprints live in `docs/ai-behavior-fixes/evidence/`. Original harness batching/reload/seed/insertion-order regressions were rerun against the corrected production code. Long-run repeatability of the reference is proven by all 16 original digest matches; final code also passes the independent native seeded replay/batching tests. There is no claim that every arbitrary future long-run batching schedule has been proven equivalent.

## Remaining weaknesses and next milestone

1. **Product decisions needed:** authoritative local-pool army deployment and NPC collection/provisioning contracts. Existing abundant pools/output cannot substitute for missing authorized domain behavior.
2. **Still unresolved:** below-threshold repeated WAIT and longer-horizon positioning preference. Exact decline filtering solves one causal retry family, not the general cognition-cost problem.
3. **Unverified by these scenarios:** universal rational attack/retreat behavior and successful proactive Peace. Legal Trade remains possible and a focused bilateral acceptance/delivery test passes, but changed wars do not establish universally better diplomacy.
4. **Performance investigation recommended:** distinguish weighted frontier observation cost from retained scoring/clone cost and recurring below-margin deliberation, without suppressing real opportunities.

The next milestone should be independent review of these bounded source/filter changes and separate product approval of the two blocked contracts. No new phase, deployment, economy redesign, tuning or automatic generated-log commit has been started.

All changes remain unstaged in the isolated simulation worktree. Original checkout, shared production and Unity files are untouched; no commit, push, merge or deployment was performed. See `docs/ai-behavior-fixes/ARTIFACTS.md` for eventual tracking recommendations; existing evidence is preserved rather than cleaned away.
