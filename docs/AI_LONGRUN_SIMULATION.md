# AI A–L authoritative long-run simulation

Built in `/workspace/REP-WARS-2-AI-SIM`, branch `dev/ai-longrun-simulation`, directly from approved union `6f38eec6516682e64937b08744a5607f54bbba91`. The Linux worktree is the equivalent of the requested isolated Windows SIM checkout. The original checkout was not edited. Schema stays 27. No engine, balance, Unity, persistence policy, or gameplay rules were changed.

## Architecture findings

| System | Actual authority and harness use |
|---|---|
| World creation | `WorldDefinition` → `assertValidWorld` → `createGameStateFromWorld`; catalog registration lets normal hydration rebind immutable geography. Minimal square polygons satisfy the existing adjacency validator. No visual assets are generated. |
| World state | One canonical `GameState`; Orchestrator transaction clones are isolated drafts. Logs, summaries and conservation ledgers are observations, never world inputs. |
| Cognition | Canonical Goals, directed Opinion, Memory, Strategic Pressure, source-bound proactive opportunities and non-proactive response contexts. `DecisionEngine.decideForSource` receives the real faction view and generated exact plans. The legacy standalone simulation CLI/ActionScorer path is not used. |
| Commitment/execution | Normal source deliberation → exact selected plan → shared operation/domain handlers. The runner never chooses actions or executes alternate plans. Physical operations coexist under native Attention/claims. |
| Completion/combat | `ContinuousWorldEngine`, authoritative movement/attack staging, native `BattleEngine`, invasion deadlines, construction settlement and operation cleanup. Empty-site captures are distinct from calls to BattleEngine. |
| Recruitment | Native territory-local pools, local Food consumption, City multiplier and exact REINFORCE allocation. Pools start empty. Last-army replacement is currently unsupported by the domain path. |
| Economy | Native lazy production, local Food settlement, banked-Food upkeep, construction spending, reservation-aware availability, and conquest destruction. Uncollected production is not automatically banked. |
| Diplomacy | Canonical default WAR, Peace proposals/clearance, and exact Trade offers/reservations/bilateral cargo. Native required-response settlement and physical shipment timers execute without player intervention. |
| Events | Default `WorldSimulator` remains registered and executes at native event boundaries. No quiet-events replacement or invented event/choice policy. These authored worlds generated no triggered world-event batches; battle/Trade history still exists. Event mutation regressions are covered by existing backend suites. |
| Time | `SYNC_PLAYER_WORLD` through `executeAtAuthoritativeReceipt`, earned target versus processed tick, fixed-point 1.0×/0.1× accrual, native AI timers and native online leases. Fixed trusted server receipts are inputs; elapsed host CPU time never drives gameplay. No Temporal V2 change. |
| RNG | Scenario seed passed to native constructor/DecisionEngine; native canonical timer/RNG state survives persistence. Observers read resolved decisions/battles only and never sample additional strategic RNG. |
| Persistence | Existing `InMemoryGameStateStore` snapshot/hydration and state-version CAS, plus existing gameplay-session CAS helpers. Periodic full reload. This is not a Supabase/network performance or restart test. |

Exactly eight proactive actions, five Pressure domains, seven factual evaluators and three response lanes are preserved. Goals amplify only actual sources; a Goal cannot make an unsupported attack, Farm, or Peace offer appear. Required-response decisions are evidenced by canonical context/proposal transitions; their internal scoring is not fabricated where it is not exposed. Proactive comparisons contain actual alternatives, factual assessments, causal contributions, modifiers, threshold, and final near-tie resolution.

## Scenario assumptions — not locked rules

| Size | Grid | Total territories | AI factions |
|---|---|---:|---:|
| Small | 5×2 | 10 | 3 |
| Medium | 6×5 | 30 | 5 |
| Large | 10×5 | 50 | 8 |

One corner territory belongs to the required passive player. Remaining land is divided into contiguous serpentine groups. IDs, reciprocal grid adjacency and shared polygon edges are deterministic. Terrain cycles through plains/hills/forest/river/mountain/coastal, shifted by seed. The map is fully visible under existing backend doctrine.

Each AI starts with 1,600–1,760 soldiers, 60 knights and two siege engines from its authored WorldDefinition budget. Fifty soldiers per owned site, or 100 at home, are **subtracted from that same army budget** and placed in garrisons. No troops are added by this split. Initial local pools remain empty. One completed City and fortification level 1 at home, population 500 and baseValue 25 are explicitly authored fixture infrastructure. They are initial conditions, not runtime gifts or instant construction rewards.

Preset personalities cycle aggressive/economic/diplomatic/expansionist/defensive/opportunistic; ambition is 0.6. Repeated presets have unique authored identity. Native factory legacy Goals remain canonically completed/invalidated as the existing conversion dictates. Each AI also receives two concrete authored private Goals: develop a Farm at home, and control a neighboring hostile site (diplomatic factions instead seek Peace with that neighbor), priority 50. No replacement Goals or fake Goal pressure are injected.

Banks start at Gold 1,400 (240 for every third faction), Food 900, Iron 220, Wood 60 or 650, Stone 10 or 600. These niches create real shortage/surplus contexts. Per-territory authored output is Gold 25, Food 100, Iron 10, Stone 20, Wood 20–40 per native production cycle before native developments. Banks are never replenished by the harness.

The observer starts with zero resources/troops/output and is paused using the native player pause helper. It performs no actions, workouts, collection or diplomacy. Pause does not disable the observer's native upkeep: it fails one upkeep cycle per production cycle. Analyses separate this fixture noise from **AI** Food shortages. It occupies one tile and can affect geography; this is not a world with the player surgically removed. Its other native state remains valid.

## Reproduction

Run from this worktree. Dependencies already present at the pinned baseline were used.

```bash
node node_modules/ts-node/dist/bin.js --transpile-only src/simulation/longrun/cli.ts --sizes small --seeds 11 --ticks 60 --output /tmp/ai-smoke
node node_modules/ts-node/dist/bin.js --transpile-only src/simulation/longrun/cli.ts --sizes small,medium --seeds 11,29,47 --ticks 360 --output docs/ai-longrun/results/six-hours
node node_modules/ts-node/dist/bin.js --transpile-only src/simulation/longrun/cli.ts --sizes large --seeds 11,29,47 --ticks 360 --output docs/ai-longrun/results/large-six-hours
node node_modules/ts-node/dist/bin.js --transpile-only src/simulation/longrun/cli.ts --seeds 11 --ticks 1440 --step 5 --output docs/ai-longrun/results/one-day
node node_modules/ts-node/dist/bin.js --transpile-only src/simulation/longrun/cli.ts --seeds 29 --ticks 360 --presence offline --step 5 --output docs/ai-longrun/results/offline-six-hours
node node_modules/ts-node/dist/bin.js --transpile-only src/simulation/longrun/cli.ts --sizes small --seeds 11 --ticks 10080 --step 5 --output docs/ai-longrun/results/one-week
node node_modules/ts-node/dist/bin.js --transpile-only src/simulation/longrun/analyze.ts
```

Use a separate `--output` directory when comparing reruns. Every artifact directory includes exact configuration and WorldDefinition in `scenario.json`. `runSimulation(config)` is also callable from awaited tests. `reverseInsertion` is a diagnostic permutation of initial canonical Map insertion order. No concurrent simulations run inside one process because reducer observation hooks are process-local; independent CLI processes are isolated.

Trusted receipt origin: `1700000000000` milliseconds. Online sessions renew through the native CAS lifecycle once per real minute; offline sessions are absent. Receipts advance 60,000 or 600,000 milliseconds per earned world tick. Processing batches do not change that heartbeat history. Online/offline runs are different canonical inputs and appropriately produce different decisions. Reload cadence is 60 ticks in recorded main runs. Processing batches are one tick in the initial matrix and five in extensions/offline runs.

## Evidence and interpretation

See [all run results](ai-longrun/results/RESULTS.md), [machine-readable analysis](ai-longrun/results/analysis.json), and [validation evidence](ai-longrun/VALIDATION.md).

Sixteen main runs completed. The nine equal-duration online seeds selected 7,234 decisions, including 5,970 WAITs, created 1,296 operations, resolved 278 occupied battles, and recorded 638 ownership changes (including repeat captures and empty-site captures). These totals do not include repeated prefixes from one-day/week extensions. A sampled boundary held 25 simultaneous live operations across factions. This is a lower-bound concurrency observation, not an instantaneous maximum or faction capacity claim.

Every main run had zero command/nested world errors and zero troop, siege, or resource conservation residual. Conservation includes bank plus uncollected stock plus undelivered cargo; reservations are not counted as extra ownership. Troops include soldiers, knights, garrisons and local pools; siege is separate. Native recruitment, production, upkeep, construction spending, event consequences and conquest losses are observed at their existing reducers; persisted conflict aggregates account for physical battle casualties. Nested transaction failures discard buffered diagnostics/accounting, and records enter the timeline only after enclosing command and CAS success. No conservation ledger influences execution.

`timeline.jsonl.gz` stores full internal diagnostic rows and `timeline.md` provides a concise human timeline. `final-state.json.gz` is the actual persisted snapshot. `operation-lifecycle.json` extracts canonical exact plans, creation/start ticks and terminal records; it also covers starts and completions inside one processing batch. Proposal/shipment rows include their native timers and timestamps. The first six-hour summaries predate the sampled-concurrency field; analysis reconstructs that field from their unchanged transition logs. Original large logs were compressed losslessly. The archived small seed-11 six-hour state hash was independently reproduced with the completed runner.

Decision logs are server/developer diagnostics and contain private NPC cognition. They are not a public API or player-facing DTO. Diagnostic wall times, sampling and formatting order are not canonical world inputs. Reversed insertion preserves decisions, battle results and semantic state; faction territory membership arrays serialize in the Map's order, so the permutation test normalizes only those unordered lists. Identical normal-order seeds reproduce full snapshot and timeline exactly. Fine/batched small runs also match complete canonical state; an independent medium 60-tick probe matched physical operations, claims, recruitment, diplomacy and conflict state. This is evidence for tested horizons, not a proof of every future Temporal guarantee.

## Behavioral findings and ranked improvements

| Priority | Finding and evidence | Classification / recommended follow-up |
|---|---|---|
| 1 | Small seed 11 keeps two factions at WAR. The economic survivor's 868-troop army stops at `t_009`, far from hostile `t_001`; no further military decisions follow tick 36 through a week. Source generation explicitly limits military opportunities to immediate/one-owned-staging-hop scope. | Reproduced strategic reach limitation, not an invariant or randomness defect. Review bounded frontier positioning using existing MOVE/ATTACK plans. Do not create EXPAND or an AI Director. |
| 1 | Territory-owning factions lose all field armies yet accumulate thousands of local troops. Large seed 11 after one day has three such survivors; native `reinforcementProblem` rejects `new_army` because no authoritative creation path exists. | Explicit domain capability gap. Product must define lawful local army creation/mobilization before cognition can use it. No automatic army creation was added. |
| 1 | Small seed 11 economic faction ends the week with banked Food 0, Stability 34 and 60,321 local troops while local output remains plentiful. Eighteen AI upkeep cycles fail; another 168 failures belong solely to the passive observer. Six Farms are built late, but production still cannot replenish banked Food. | Reproduced sustainable-economy gap. Resolve bank access/collection and upkeep support policy together; evaluate whether Farm source-resolution utility actually addresses its bank shortage. Do not add proactive COLLECT or fake bank transfers. |
| 2 | Medium online WAIT share is 86.5–88.9%; large 76.7–83.4%. One identical material source is considered 203 times. Most waits are Trade-source exchanges scoring below threshold; an example's requested-gain contribution 5.88 is outweighed by external-choice cost 10 plus offered loss/timing/Attention. | Reconsideration/churn concern and policy/tuning question, not proof every WAIT is irrational. Review material-change rearming/scoring cadence using existing source architecture; do not silently change weights or timers. |
| 2 | Resource-site improvements and many Cities are built on threatened borders and destroyed shortly afterward. Large seed 11 has 28 construction terminal failures caused by conquest. | Exposure/planning concern. Inspect existing factual BUILD/Risk comparisons before proposing any tuning. Do not classify ordinary enemy invalidation as double spending. |
| 2 | Large seed 29 makes 47 Trades; large seed 11 makes three. Seed 11 accepts all three and delivers six physical shipments. Diplomacy is therefore not universally broken. No scenario issues OFFER_PEACE. | Peace coverage gap: source requires Stability <50 and a stronger adjacent hostile force. Peace Goals alone intentionally do not generate offers. Follow up with a separately authored canonical war-burden fixture rather than forcing acceptance. |
| 3 | Lowest resolved attacker probability is 0.364, in medium seed 47. Other risky battles range roughly 0.4–0.55. Native uncertainty, committed effects and response/interception of moving armies can change facts after selection. | Risky outcomes, not sufficient evidence of suicidal planning. Logs preserve factual selection comparisons and actual battle inputs/results for independent review. No balance adjustment justified from these worlds alone. |
| 3 | Zero proactive RETREAT selections in this matrix; few MOVE/REINFORCE selections, although response-lane interventions do create such operations. Goals sometimes favor causal comparisons and border Goals complete, while Farm Goals remain inactive until real Food shortage sources emerge. | Scenario and declared-source coverage limits. Additional adversarial fixtures should investigate retreat/positioning and meaningful Peace opportunities. Do not invent actions to satisfy coverage. |

No new canonical corruption, duplicate completion, double reservation, invalid post-elimination decision, conservation failure, or identical-seed determinism defect was demonstrated. The scenario generator's first Large attempt was rejected for duplicate preset identity; that isolated harness defect was corrected with unique IDs before any recorded Large run. No production defect was repaired or hidden.

Recorded runtimes include full diagnostics and repeated in-memory hydration/CAS: initial online six-hour cases approximately 4–122 seconds; one-day 16–141 seconds; small one-week 80 seconds. Linux x86_64, Node 24.19.0, shared container CPU. Some jobs ran concurrently, so these are reproducibility evidence, not gameplay/server throughput guarantees. No pathological processing loop was observed, but WAIT churn adds evaluator work.

Deferred spatial recovery, cargo remedies, battle timing, generic non-player invasion rearming, required-window interpretation, Attention tuning and context/history compaction remain unchanged. This harness does not prove those missing policies or assert the AI is strategically finished.

All files remain uncommitted and unstaged. No push, merge, deploy, Unity modification, Phase M or Temporal V2 work.
