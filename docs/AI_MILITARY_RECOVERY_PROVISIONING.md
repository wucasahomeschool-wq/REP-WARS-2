# Military recovery and Food provisioning — pre-edit plan

Baseline: `dev/ai-longrun-simulation`, HEAD `6f38eec6516682e64937b08744a5607f54bbba91`. Six tracked production files and two new helpers from the previous behavioral pass remain intentional unstaged changes. All original and follow-up manifest entries match. The actual Git-blob engine replay of small seed 11 reproduces the archived baseline; no source checkout was changed.

## Independent review before implementation

Owned travel uses native positive movement durations, stable ID/neighborhood ordering and owned-only edges. It commits one adjacent MOVE and reobserves after arrival; it cannot teleport or create an attack through Peace/protection. Existing threshold and defensive opportunity costs explain the three residual candidates. Weighted searches are repeated at existing source/comparison boundaries; their cost needs separation from much larger retained scoring/clone and repeated-WAIT work before attributing the whole runtime difference. No threshold/weight change is justified.

Actual-decline predicates are source-owned canonical records, not raw Memory scoring. They bind exact terms/endpoints/source and relevant observable facts; other terms, explicit offers and relevant fact changes remain legal. Recipient private cognition is not read. Source retirement or material fact changes permit fresh consideration; this is deliberate context-dependent suppression, not a permanent grudge or global diplomacy cap. Existing 31 regressions will be rerun and additional mixed-context/performance probes added.

## Military execution plan

1. Enable the already-declared REINFORCE `new_army` destination; no ninth strategic action or new command is needed. This strategic local allocation invokes the existing reserved, timed domain allocation operation.
2. Retain the existing local troop quantity claim and local destination (garrison) claim. This conservatively serializes local destination mutations at one territory while allowing compatible operations elsewhere. Revalidate source ownership, NPC lifecycle, quantity, claims and invasion constraints at start and completion.
3. Derive the new army's stable ID from its canonical operation ID; reject collisions before deducting anything. Use existing newly formed native army morale/supply defaults (80/80), zero knights/siege and exact local location. No capacity cap exists in the current army domain; ordinary operation Attention/physical claims still apply. No player rewards are used or changed.
4. Atomically deduct the exact local quantity, create the force, update faction membership and operation linkage on the transaction draft. Existing operation terminal idempotency, receipt deduplication, invariants and CAS remain the authority. No separate army counter/store/timer.
5. Add a bounded FORCE_POSITIONING source for a faction lacking any field army but possessing a concrete owned-pool/reachable hostile opportunity. Choose a stable useful formation site/target using native owned travel and combat facts. Author exact quantities through existing reinforcement batch policy; score physical additional capacity in existing FORCE_POSITION_VALUE, with existing opportunity cost and comparison weights. Do not promise an attack or force formation below threshold.
6. Add tests for last-army recovery, claims, ownership, insufficient pools, cancellation/conquest, retry/reload, identity collision, local formation/transit, seeded ordering, conservation and factual Goal neutrality. Update the two previous tests that explicitly expected the now-superseded domain refusal; retain their conservation assertions and explain the authorized contract change.

## Food boundary and decision

Production resides in `territoryEconomy.uncollected.food`; recruitment spends locally. `collectTerritoryYield` explicitly credits an abstract faction bank and has no transport identity, route or receipt node. Upkeep draws only unreserved `faction.resources.food`. Trade ships goods between owned territories, but only as a bilateral accepted Trade; it is not an internal Food-to-bank service.

The newly approved automatic capability cannot be implemented physically without defining bank location/receipt and internal transport custody. Automatically calling manual collection would satisfy the bank balance but bypass the requested physical logistics. Changing upkeep to local consumption would change its accounting scope.

The user chose: **define a located bank and transport in a separate reviewed contract**. Therefore Food provisioning remains blocked here. No local-to-bank transfer, local upkeep rule, shipment destination, storage cap or routing policy will be invented. Tests will verify that untouched player/NPC economy cannot silently consume inaccessible/reserved Food. Military implementation and all original simulation validation proceed independently.

## Validation and preservation

Preserve all previous files and manifests; new evidence goes under `docs/ai-recovery-provisioning/`. Run new regressions, previous 31 behavior tests and 19 simulation tests, A–L, integration, full backend, production/test-inclusive TypeScript and whitespace checks. Rerun all 16 original configurations without changed inputs; compare both original and previous corrected corpus. Track formed/recovered armies, operation lifecycle, Food and troop conservation, military/diplomatic actions, WAIT and performance. Preserve three credential-gated live database skips as skips, and the 28 inherited diagnostic identities. No stage, commit, push, merge, Unity or protected-branch edit.

### Validation-driven adjustment

The first complete formation-only matrix finished all sixteen worlds with exact conservation, but Large seed 47 emitted two nested references to one normal failed attack. At tick 195, a 101-troop force defended its arrived staging territory, lost 25 troops, then failed the native `>100` attack guard. Its attack intent, claims and Attention were cleared through the existing terminal path. The strict harness flagged this expected physical invalidation; no error is discarded or gameplay guard weakened.

That review also revealed a pre-existing local-allocation factual gap: the offensive assessment measures only power shortfall and does not recognize restoring attack eligibility for an existing sub-threshold survivor. A minimal military-support correction values the capacity unlocked when exact reinforcement crosses the existing floor. No threshold, weight, action, combat rule or operation ordering changes. Add failure-first/cross-floor regressions and rerun all sixteen configurations into `results/final-after/`; preserve the first matrix under `results/after/` as intermediate evidence.

## Completed implementation

| Capability / reviewed fix | Status | Practical result |
|---|---|---|
| Local-pool field-army domain | **IMPLEMENTED AND VERIFIED** | Existing REINFORCE/new_army now reserves and consumes exact local troops, creates a deterministic operation-backed army locally, and terminates atomically. General explicit NPC formation is legal even when another field army exists. |
| Optional AI military recovery | **IMPLEMENTED WITH LIMITATIONS** | One bounded recovery opportunity per army-less faction with a real reachable hostile objective. Actual lost-army recovery occurs in native long runs; it does not guarantee immediate rebuilding, winning a war or recovering again before simulation cutoff. Existing Pressure, spacing, risk and commitment thresholds still govern selection. |
| Food administration | **BLOCKED BY UNRESOLVED DESIGN** | User explicitly chose a separately reviewed located-bank/transport contract. No automatic collection, receiver choice, local upkeep substitution, new storage, internal cargo, or bank credit was implemented. |
| Previous distant-army MOVE | **IMPLEMENTED WITH LIMITATIONS; independent review PASS** | Correct deterministic owned-only search, native durations and one adjacent committed hop. No MOVE score or threshold was increased in this pass. Final six-hour frontier gaps fall to one, but low-capacity long-distance moves can still fail current scoring. |
| Previous decline filtering | **IMPLEMENTED AND VERIFIED; independent review PASS** | Exact unchanged-context declines remain filtered; alternatives, explicit offers and material-context reeligibility pass. No private recipient cognition is used. General WAIT churn persists. |
| Existing-force eligibility restoration | **IMPLEMENTED AND VERIFIED** | FORCE_POSITION_VALUE now recognizes that a sub-threshold surviving force becomes legally usable offensively when exact allocation crosses the native `>100` floor. The actual baseline returned zero capacity for the 76→101 reproduction; corrected assessment returns native power 111.1. No combat math or floor changed. |

### Production files changed in this assignment

Eight files relative to the previous pass:

1. `src/gameplay/recruitment/reinforcement.ts`: positive safe quantity, NPC ownership, collision and exact operation/claim checks; atomic local allocation/formation and faction membership/operation linkage.
2. `src/gameplay/recruitment/formation.ts` (new): operation-derived ID and existing native formation defaults, soldiers only, 80 morale/80 supply, no movement/intent. No player rewards are accessed.
3. `src/army/fieldRecovery.ts` (new): current owned pools, owned travel, existing physical target power/legality and stable site/target ordering. One current source; bounded existing reinforcement quantities. Does not create a projected GameState or take RNG samples.
4. `src/engine/strategicPressure.ts`: FIELD_FORCE_GAP under existing FORCE_POSITIONING and exact new_army candidates; old source behavior preserved.
5. `src/types/AIPressure.ts`: source-kind vocabulary extension.
6. `src/state/pressureInvariants.ts`: source-to-exact-formation binding, with existing invariants retained.
7. `src/scoring/contextPlanComparison.ts`: current recovery objective passed as factual support to the existing allocation assessment.
8. `src/scoring/strategicEvaluators.ts`: exact physical formation capacity and native attack-eligibility restoration in existing FORCE_POSITION_VALUE; defensive/offensive usefulness combined once with existing allocation costs/weights.

Previous `src/army/strategicAccess.ts`, `src/gameplay/trade/declinedContext.ts` and the Trade terminal hook in `src/gameplay/trade/trade.ts` are byte-identical to the prior pass. No economy, world/Temporal, scheduler, response ownership, Attention tuning, HTTP, persistence, workout, Unity or protected-source code was edited.

Schema remains **27**. No new persistent fields, army counters, stores, currencies or historical records were fabricated. New armies use existing Army fields and operation links. New source enum values require the updated reader; rollback to older readers can reject these values. Eight proactive actions, five Pressure domains and seven factual evaluators remain unchanged.

### Execution, reservations and concurrency

The existing exact plan contract already expresses `destination.kind = new_army`. No command/action extension was necessary: REINFORCE is strategic local troop allocation; the domain settlement now implements its previously unsupported formation destination. Source ownership, exact pool ID and quantity, co-location, active invasion and collision checks run at authoritative boundaries. Existing local quantity and garrison destination claims are retained; that destination slot conservatively serializes local mutations, while compatible MOVE/formation operations elsewhere coexist.

Troops stay in the pool during initiation and are unavailable through claims. At the established 1s online/10s offline completion, exact allocation creates a local army and updates membership/linkage on the transaction draft. Terminal replay cannot repeat the deduction or create another army. Cancellation/conquest does not refund a completed effect or create a replacement at another site. Existing pool destruction on conquest remains the approved runtime's provisional policy. Subsequent travel uses ordinary native transit, not a spawn at a distant target.

IDs derive from canonical operation IDs, never map size, wall-clock processing speed or new RNG. Existing operation sequences, receipt replay and `state_version` CAS remain final authority. Collision, wrong-owner, insufficient and claimed-stock failures leave the committed state unchanged. No global one-operation gate was restored, and no extra creation capacity cap was invented where none exists in the current domain.

### Food findings and outstanding contract

Primary territory Food production is local `uncollected.food`; recruitment spends that local Food. Bank Food can also reflect initial stock, existing Trade/events and explicit collection. Upkeep remains faction-wide and draws only eligible unreserved bank Food. The bank has no location; local yield has no internal Food-to-bank cargo/reservation lifecycle. Calling COLLECT_RESOURCES automatically would credit an abstract bank without the required physical transport.

The separate contract must specify bank location/ownership and loss behavior, collection/pickup custody and eligible local reservations, transport capacity/cost/routes/loading/delivery, storage limits, and receipt/upkeep ordering. Neither "first owned territory" nor a capital policy, instant remote bank credit, or local upkeep rule was inferred here. Player economy and rewards are unchanged. Existing tests verify bank-only upkeep, reservation-aware consumption, explicit collection conservation and Food-funded local recruitment; they are **not tests of an implemented automatic provisioning mechanism**.

## Final simulation results

All sixteen original configurations/seeds/definitions were rerun without changed assumptions. Reference results and the previous behavioral corpus are preserved; a fresh actual Git-code smoke replay reproduces the archived original small-seed-11 digest. The comparison verifies every original reference digest and all input definitions/configurations. Final runs use the final eleven-production-file fingerprints (including unchanged prior helpers); the initial formation-only matrix is preserved separately.

Nine six-hour online runs:

| Metric | Original | Previous fixes | Current |
|---|---:|---:|---:|
| Decisions | 7,234 | 7,732 | 8,033 |
| ATTACK | 689 | 678 | 808 |
| REINFORCE | 1 | 3 | 64 |
| BUILD | 524 | 524 | 617 |
| Proactive MOVE | 0 | 5 | 7 |
| OFFER_PEACE | 0 | 0 | 0 |
| TRADE | 50 | 4 | 2 |
| RETREAT | 0 | 1 | 1 |
| WAIT | 5,970 | 6,517 | 6,534 |
| Operations | 1,296 | 1,243 | 1,536 |
| Battles | 278 | 271 | 299 |
| Territory changes | 638 | 630 | 725 |
| Completed formed armies | 0 | 0 | 37 |
| Recovered faction-cases | 0 | 0 | 22 |
| Distant-frontier gaps | 4 | 3 | 1 |
| Repeated exact declined offers | 38 | 0 | 0 |

Across all sixteen current cases, **94** field armies formed. Recovery counts identify distinct recovering faction IDs per independent case; labels repeat across worlds. Some armies are subsequently destroyed and some factions lose all territory before deployment is possible. Formation count and capture churn are not proof of intelligent campaigning or improved survival.

Small seed 11's week remains unchanged from the previous fixes: **68** AI failed upkeep cycles versus original **18**, one surviving faction, no newly formed army (the opponent loses its land before useful recovery). Food provisioning is not fixed. Bank/local custody and all measured resource totals remain truthful.

Medium seed 11's day now has **28** formations, **81** battles versus previous 33, and three survivors versus one. ATTACK decisions rise 68→269 and WAIT rises 782→3,176. Recovery keeps more factions militarily active, but also sustains attrition and cognitive work. This is stronger persistence, not proof of superior strategy. Large seed 11's day produces 26 formations and 89 battles versus 55; its survivors remain two. Proactive Peace still has no successful selection in this corpus.

### Invariants, conservation and expected failures

**16/16 final worlds completed**, with zero measured troop/siege/five-resource residuals and no reported GameState invariant violations. The strict zero-nested-error runner reports **15/16 clean cases**, exit 1 for the matrix: Medium seed 11 day records four nested references to **two** expected attack failures. Both forces defended at their staging territory and dropped 101→76 before their own attack resolution. Native revalidation rejected those attacks, released their claims and Attention, cleared their intents and preserved the 76 surviving troops. No invalid battle, refund, duplicate settlement or canonical corruption occurred.

These errors are preserved, not filtered to make the runner green. `evidence/contained-physical-failures.json` independently correlates native battle inputs/results, exact failed operations and final invariant/claim state. A new regression verifies actual transit timing, sub-threshold rejection and exactly-once cleanup. The initial matrix's analogous Large seed 47 failure remains historical evidence. Broad battle-timing and spatial-recovery policy was not changed to prevent these legitimate physical invalidations.

### Performance and strategy assessment

Large seed 29 runtime: original **121.37s**, previous **161.38s**, current **163.61s**. Its old performance issue was not solved by adding recovery. Isolated 50-territory native queries measured approximately **5ms for 160 access probes** and **7ms for 21 recovery probes**; they do not explain the entire logged simulation cost. Source queries repeat at existing boundaries and still merit profiling on substantially larger worlds.

Medium seed 11 day rises **55.15→154.27s**, with decisions 904→3,595 and battles 33→81. Large seed 11 day rises **164.77→200.09s**. More living factions and operations produce additional real work. Max RSS includes TypeScript/compiler, canonical cloning and retained private scoring logs, with some host validation overlap; it is not isolated engine allocation. No polling observer, balance coefficient or MOVE threshold was changed. Full per-case runtime/RSS and military/economy/diplomatic metrics are in `docs/ai-recovery-provisioning/results/COMPARISON.md` and `.json`.

Paid upkeep, Food shortages, recruited quantities/costs and net resource conservation are recorded. Gross Food production/ownership forfeiture is not separately tallied in the preserved harness and is not invented from net balances. New automatic internal collection/transport is zero because that capability remains blocked.

## Final tests and self-audit

| Personally run against final production | Result |
|---|---|
| New military/recovery suite | **31 passed / 0 failed / 0 skipped** |
| Previous behavioral suite | **31 passed / 0 failed / 0 skipped** |
| Existing long-run suite | **19 passed / 0 failed / 0 skipped** |
| A–L focused | **837 passed / 0 failed** |
| Backend integration | **319 passed / 0 failed** |
| Full backend runner | **1,916 reported passed / 0 failed**; three credential-gated live Supabase checks are included as passes by its legacy reporting |
| Production TypeScript | **PASS**, exit 0 |
| Test-inclusive TypeScript | **Same 28 inherited file/code/message identities**, exit 2; no unrelated diagnostic suppression |
| Tracked and new-text whitespace | **PASS** |

The three unavailable live checks are Supabase save/reload, atomic Postgres world/workout-history commit, and server restart. In-memory CAS, lost-response/restart replay and mocked persistence execute normally; live database adoption is not proven here. Standalone suites are additional to the old runner counts, not silently inserted into 1,916.

The two previous refusal tests were legitimately updated for the newly approved rule without changing suite counts. The exact prior behavioral-test bytes are retained in `evidence/pre-capability-aiBehavioralFixes.ts.txt` and match the initial fingerprint. The eligibility-restoration test fails against actual baseline code (0/1 expected), returning zero versus native capacity 111.1, and passes against final code.

New coverage includes last-army loss, qualifying exact plans, local formation, reserve/consume boundaries, early/duplicate settlement, direct ownership refusal, wrong-owner/insufficient/malformed quantities, collision, conquest through the native attack command, transit, simultaneous compatible operations, cancellation, receipt retry/restart, stale CAS, stable identities/order, reload, fine/coarse completion and full seeded native recovery replay. Private Goal/Opinion/personality changes do not alter factual utility. Actual serialized states and conservation checks accompany lifecycle tests; there is no substitute AI implementation.

Self-audit confirmed no new troop generator, Food credit, cross-territory spawn, client timing, RNG call, extra action/domain/evaluator, second store/scheduler, or production-source branch change. Current source/signature enum additions require updated readers. Normal delayed-attack failures remain visible and safely contained; no invariant was weakened to conceal them.

## Remaining risks and next milestone

1. **Located bank/transport contract:** required before approved automatic Food administration can be implemented. Small-week bank starvation is unresolved.
2. **Formation strategy:** optional AI currently targets last-field-army recovery, not general force expansion. Minimum useful formation sizes and existing thresholds can lead to repeated small-army attrition, below-margin MOVE/WAIT and delayed rebuilding. Domain capability supports additional explicit formations, but no broad generation/tuning policy was invented.
3. **Long-run cognition cost:** WAIT remains high; longer-lived empires increase simulation work and memory used by diagnostics. Profile separately before adding dormancy/caching or changing policy.
4. **Diplomacy and battle limits:** Trade filtering remains sound but offer volume is low, Peace activity remains absent, and current same-boundary battle/arrival contracts can safely invalidate attacks. Deferred spatial recovery, cargo remedies, invasion rearming, timing redesign and compaction remain untouched.
5. **Validation limits:** finite seeded corpus and mocked persistence do not establish universal rationality or live Supabase behavior. No final production approval is claimed.

Recommended next milestone: independent review of military/domain and eligibility-support changes, plus a separate located-bank/transport design review. Do not start another AI phase or Temporal V2 from these results.

## Reproduction and Git scope

```bash
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiMilitaryRecovery.ts
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiBehavioralFixes.ts
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/aiLongRunSimulation.ts
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-driver.cjs focus
TS_NODE_PROJECT=tsconfig.tests.json node -r ./node_modules/ts-node/register/transpile-only docs/review/phase-l-frozen/scripts/l-integration.cjs focus
node node_modules/ts-node/dist/bin.js --project tsconfig.tests.json --transpile-only tests/run.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --project tsconfig.tests.json --noEmit
node scripts/ai-recovery-matrix.cjs after --output-root docs/ai-recovery-provisioning/results/final-after
node scripts/ai-recovery-compare.cjs
git diff --check
```

Expected matrix exit remains 1 when the two documented normal failed attacks are flagged; all sixteen summaries and the investigation must be inspected. Do not replace that with a blanket error whitelist.

Reusable additions are `tests/aiMilitaryRecovery.ts`, two domain/planning helpers, `src/simulation/longrun/recoveryRun.ts`, matrix/comparison scripts, concise reports and fingerprints. Large private timelines/snapshots remain reproducible generated outputs, not an automatic staging recommendation. Existing evidence is preserved; intermediate matrices are explicitly separated from final results. Source/test changes remain unstaged in this isolated worktree; no commit, push, merge, deploy, Unity or protected-branch modification was performed.
