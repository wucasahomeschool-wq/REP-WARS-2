# Rep Wars — Backend Completion Matrix

Source: `e3f1781f8a53424462fabbd943cc01b0e2725154`, schema31. Audit 2026-10-29.

**Status definitions:** IMPLEMENTED AND VERIFIED = actual runtime plus meaningful passing local tests; IMPLEMENTED BUT NOT FULLY VERIFIED = significant integration/live proof missing; PARTIALLY IMPLEMENTED = required pieces disconnected; SCAFFOLDED / PROTOTYPE ONLY = factory/type/demo without complete production activation; MISSING = required route absent; BLOCKED BY CONTENT OR BALANCE = structure depends on approved content/coefficients; BLOCKED BY DESIGN DECISION = exact necessary rule undefined; NOT REQUIRED = outside approved scope.

All listed existing tests were included in the personally executed full runner unless explicitly marked skipped/inspection-only. A passing row does not certify all neighboring rows. Test evidence is local; Supabase and Unity limitations are explicit. Sources with brace notation denote the named files, not new paths.

## A

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Canonical state/schema** — One authoritative world, schema31 | IMPLEMENTED AND VERIFIED | `src/types/GameState.ts; src/state/gameStateInvariants.ts` | tests/persistence.ts; tests/orchestratorIntegration.ts | No replacement authority needed — NONE |
| **Transactional orchestration** — Clone, execute, invariants, adopt | IMPLEMENTED AND VERIFIED | `src/orchestration/transaction.ts; src/orchestration/orchestrator.ts` | tests/orchestratorIntegration.ts; tests/atomicCommit.ts | Keep current architecture — NONE |
| **Public logical retries** — Every public mutation at most once | PARTIALLY IMPLEMENTED | `src/server/session.ts; src/server/http.ts` | tests/sessionReplay.ts; independent HTTP duplicate-deploy probe | AUD-001: require durable identity for unsequenced mutations — CORRECTNESS |

## B

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Player world ownership** — Separate authorized player worlds | IMPLEMENTED AND VERIFIED | `src/persistence/initializePlayerWorld.ts; src/orchestration/authorization.ts` | tests/backendBoundary.ts; tests/gameplaySessionLifecycle.ts | Verified with injected identity; real provider separate — NONE |
| **Production authentication** — Real credentials→stable player identity | SCAFFOLDED / PROTOTYPE ONLY | `src/server/identity.ts; src/server/production.ts` | tests/backendBoundary.ts | AUD-013: select and integrate actual provider — EXTERNAL/ENGINEERING |
| **Permanent player records** — Fitness/history/trophies survive attempt loss | IMPLEMENTED AND VERIFIED | `src/gameplay/worldRestart.ts; src/gameplay/worldTransition.ts; src/fitness/history/` | tests/gameplayContracts.ts; tests/worldTransition.ts | Real account lifecycle remains AUD-013 — NONE |

## C

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Authored geometry/catalog** — Validate and load one authoritative world | IMPLEMENTED AND VERIFIED | `src/worldDefinition/{types,parse,validate,geometry,catalog}.ts` | tests/worldDefinition.ts; tests/worldGeometryBoundaries.ts; tests/worldContentIdentity.ts | Production content choice is separate — NONE |
| **Content fingerprint** — Detect incompatible same-ID authored changes | IMPLEMENTED AND VERIFIED | `src/worldDefinition/identity.ts; src/persistence/hydrate.ts` | tests/worldContentIdentity.ts | AUD-015/018: review old unpinned saves and content rollout — NONE |
| **Current-world visibility** — Entire current map visible | IMPLEMENTED AND VERIFIED | `src/worldDefinition/instantiate.ts; src/orchestration/publicView.ts; src/persistence/empireBankMigration.ts` | tests/gameplayContracts.ts | No scouting work required — NONE |
| **Fog/scouting/PvP** — Excluded by locked design | NOT REQUIRED | `src/server/allowlist.ts; approved contract` | Not required | Do not add gameplay fog or PvP — NONE |
| **Victory/next world** — 100% registered-world control, guarded transition | IMPLEMENTED AND VERIFIED | `src/gameplay/completion.ts; src/gameplay/worldTransition.ts` | tests/worldTransition.ts; tests/gameplayContracts.ts | Registered Level2 is final content; AUD-018 — NONE |
| **Defeat/restart** — Last territory ends attempt, restart same world | IMPLEMENTED AND VERIFIED | `src/gameplay/anchors.ts; src/gameplay/worldRestart.ts` | tests/gameplayContracts.ts | No rewind into prior world; preserve obligations — NONE |
| **Final playable content** — Approved maps/values/visual pairs | BLOCKED BY CONTENT OR BALANCE | `worlds/level-1.json; worlds/level-2.json; worlds/level-1.authored.json` | Schema/geometry tests, not content approval | AUD-018 — CONTENT |

## D

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Troop banking/deployment** — Atomic available bank→any owned land | IMPLEMENTED AND VERIFIED | `src/gameplay/military/troopBank.ts` | tests/gameplayContracts.ts | Cross-system tutorial failure AUD-002 — NONE |
| **Army identity** — Durable deterministic IDs across deletion/reload | IMPLEMENTED AND VERIFIED | `src/army/identity.ts` | tests/armyIdentity.ts | Retain C2 allocator; no second counter — NONE |
| **Physical movement** — Already-deployed forces travel with timers | IMPLEMENTED AND VERIFIED | `src/army/movement.ts; src/world/ContinuousWorldEngine.ts` | tests/strategicAttack.ts; tests/strategicAccess.ts | Foreign-entry policy is separate AUD-008 — NONE |
| **Tutorial deployment→attack** — Legal deployment must not block first conquest | PARTIALLY IMPLEMENTED | `src/gameplay/tutorial/level1.ts` | Existing tutorial tests; independent bank500 softlock probe | AUD-002 — CORRECTNESS |
| **Foreign MOVE semantics** — Consistent transit/hostile-entry rule | BLOCKED BY DESIGN DECISION | `src/army/movement.ts; src/world/ContinuousWorldEngine.ts` | Independent MOVE+ADVANCE_WORLD probe | AUD-008 — DESIGN/INTEGRATION |
| **Neutral occupation** — Capture valid neutral territory | MISSING | `src/army/strategicAttack.ts; src/server/allowlist.ts` | Independent neutral-target rejection probe | AUD-007; do not restore proactive EXPAND — DESIGN/FEATURE |
| **Reinforce and strategic retreat** — Legal force allocation and withdrawal path | PARTIALLY IMPLEMENTED | `src/gameplay/recruitment/reinforcement.ts; src/orchestration/handlers.ts; src/server/allowlist.ts` | tests/aiRecruitment.ts; tests/aiOperations.ts | AI paths exist; clarify/complete player surface AUD-010 — API/DESIGN |

## E

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Battle engine** — Deterministic composition/terrain/casualties | IMPLEMENTED AND VERIFIED | `src/battle/BattleEngine.ts; src/battle/CombatPower.ts; src/orchestration/applyBattle.ts` | tests/run.ts battle tests; tests/strategicAttack.ts | Balance AUD-019, not formula rewrite — NONE |
| **Server RNG authority** — Clients cannot choose or reroll battle seeds | IMPLEMENTED AND VERIFIED | `src/army/strategicAttack.ts; src/orchestration/handlers.ts` | tests/battleSeedAuthority.ts | Keep C3 and receipt requirements — NONE |
| **Defense temporary power** — Workout strength never becomes persistent troops | IMPLEMENTED AND VERIFIED | `src/gameplay/invasion/; src/orchestration/applyBattle.ts` | tests/defenseTroopAccounting.ts | Keep C1 — NONE |
| **Player invasion lifecycle** — Notify/respond/defend/settle/cleanup | IMPLEMENTED AND VERIFIED | `src/gameplay/invasion/` | tests/invasionLifecycle.ts; tests/level1Tutorial.ts | Clock-domain decision AUD-009 remains — NONE |
| **Combat retreat/army merging** — No new battlefield withdrawal or force merging rule | NOT REQUIRED | `src/battle/BattleEngine.ts; scoped design exclusions` | Existing loser-elimination tests | Do not infer these from strategic RETREAT — NONE |

## F

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Automatic empire resource banks** — Produced resources credit owner once | IMPLEMENTED AND VERIFIED | `src/gameplay/economy/{accrual,production,ownership}.ts` | tests/gameplayContracts.ts; tests/economyFoundation.ts | No physical resource logistics — NONE |
| **Food upkeep/Stability** — Baseline+territory upkeep, available bank spending | IMPLEMENTED AND VERIFIED | `src/gameplay/economy/foodConsumption.ts` | tests/gameplayContracts.ts; tests/gameplayConsumption.ts | Event chain AUD-004; final values AUD-018/019 — NONE |
| **Manual Golden Yield** — Pay extra bonus only and consume basis once | IMPLEMENTED AND VERIFIED | `src/gameplay/economy/collect.ts` | tests/gameplayContracts.ts; tests/gameplayConsumption.ts | Client text AUD-020 — NONE |
| **Resource reservations** — Prevent double-spend across spenders | IMPLEMENTED AND VERIFIED | `src/gameplay/trade/resources.ts; src/engine/operations.ts` | tests/aiEconomy.ts; tests/aiTrade.ts; tests/gameplayContracts.ts | Keep atomic CAS — NONE |
| **Resource transport** — Not part of empire-bank design | NOT REQUIRED | `src/gameplay/trade/trade.ts; src/persistence/empireBankMigration.ts` | Legacy cargo migration tests | Historical shipment types are compatibility, not future work — NONE |

## G

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Five construction types** — City, fortification, farm, mine, lumber | IMPLEMENTED AND VERIFIED | `src/gameplay/construction/definitions.ts` | tests/economyCities.ts; tests/economyDevelopments.ts; tests/constructionQueries.ts | No new building economy needed — NONE |
| **Construction lifecycle** — Cost, slot, timer, acceleration, ownership loss | IMPLEMENTED AND VERIFIED | `src/gameplay/construction/{consume,progress,complete}.ts` | tests/economyFoundation.ts; tests/aiOperations.ts | Preserve approved acceleration — NONE |
| **Roads/markets** — Only if separately approved supported design | BLOCKED BY DESIGN DECISION | `src/gameplay/construction/definitions.ts; src/server/allowlist.ts` | No complete live road/market route | AUD-022, optional future scope — FUTURE |

## H

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Eight-action decision engine** — Existing Observe→Decide→Commit→Execute→Complete | IMPLEMENTED AND VERIFIED | `src/engine/DecisionEngine.ts; src/engine/proactiveCognition.ts` | AI A–L tests in full runner; tests/backendScale.ts | No director/new action — NONE |
| **Pressure/evaluators/goals** — Five pressures, seven factual evaluators, private cognition | IMPLEMENTED AND VERIFIED | `src/engine/strategicPressure.ts; src/cognition/; src/types/AIConcretePlan.ts` | tests/aiStrategicPressure.ts; tests/aiStrategicEvaluation.ts; tests/aiCognition.ts | Balance/goal usefulness AUD-019 — NONE |
| **Attention/claims/ownership** — Concurrent exact operations with exclusive claims | IMPLEMENTED AND VERIFIED | `src/engine/{operations,strategicAttention,decisionOpportunities}.ts` | tests/aiStrategyConcurrency.ts; tests/aiResponseCorrections.ts | Keep terminal cleanup and zero-cost semantics — NONE |
| **Response lanes** — Emergency, required response, operation recovery | IMPLEMENTED AND VERIFIED | `src/engine/nonProactiveCognition.ts; src/engine/responseRecords.ts` | tests/aiResponses.ts; tests/aiResponseCorrections.ts | No new automatic recovery policy assumed — NONE |
| **NPC recruitment/deployment** — Time accrual→bank→planned REINFORCE | IMPLEMENTED AND VERIFIED | `src/gameplay/recruitment/recruitment.ts; src/gameplay/military/troopBank.ts` | tests/gameplayContracts.ts; tests/aiRecruitment.ts | Provisional rates; no player passive recruitment — NONE |
| **Military strategic effectiveness** — Useful sustainable decisions over campaigns | IMPLEMENTED BUT NOT FULLY VERIFIED | `src/engine/strategicPressure.ts; src/gameplay/trade/declinedContext.ts` | tests/strategicAccess.ts; tests/backendScale.ts | AUD-019; historical AI-SIM evidence not current balance proof — BALANCE/VERIFICATION |

## I

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Peace lifecycle** — Default WAR, mutual acceptance, hostility clearance | IMPLEMENTED AND VERIFIED | `src/gameplay/diplomacy/` | tests/aiPeace.ts; tests/aiResponses.ts | No proactive DECLARE_WAR/NEGOTIATE — NONE |
| **Trade lifecycle** — Exact terms/reservations; atomic bank exchange on ACCEPT | IMPLEMENTED AND VERIFIED | `src/gameplay/trade/trade.ts` | tests/aiTrade.ts; tests/gameplayContracts.ts | No physical delivery to reimplement — NONE |
| **Declined-offer memory** — Suppress exact stale offers; context can restore | IMPLEMENTED AND VERIFIED | `src/gameplay/trade/declinedContext.ts` | tests/strategicAccess.ts; tests/aiTrade.ts | Do not force acceptance to reduce WAIT — NONE |

## J

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Seeded event engine** — Natural events, chains, cooldowns, consequences | PARTIALLY IMPLEMENTED | `src/events/{WorldSimulator,EventDefinitions,EventTriggers}.ts` | Existing event-engine tests; independent authored-world probe | AUD-004/005/006 — INTEGRATION |
| **Natural event eligibility** — Events reachable in actual initialized world | PARTIALLY IMPLEMENTED | `src/worldDefinition/instantiate.ts; src/events/EventTriggers.ts` | 0 events/100 turns in registered Level2 | AUD-004 — DESIGN/INTEGRATION |
| **Event persistence** — Event effects survive reload without reroll | PARTIALLY IMPLEMENTED | `src/events/WorldSimulator.ts; src/persistence/hydrate.ts` | Independent Resource Discovery output reset | AUD-005 — CORRECTNESS |
| **Player event choices** — Owned choice inbox and receipted resolution | MISSING | `src/events/WorldSimulator.ts::resolveChoice; src/server/allowlist.ts` | Reducer tests only, no public command | AUD-006 — FEATURE |
| **All advertised consequences** — Every choice accurately describes applied effect | PARTIALLY IMPLEMENTED | `src/events/EventModel.ts` | Explicit unapplied morale/infrastructure fields | AUD-006 — DESIGN/FEATURE |

## K

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Workout authoring compiler** — Validate versioned catalog and readiness data | IMPLEMENTED AND VERIFIED | `src/fitness/authoring/` | tests/workoutAuthoring.ts; tests/workoutProgression.ts | Production loader AUD-003; content AUD-017 — NONE |
| **Movement readiness/progression** — Earn legitimate movement-specific progression | IMPLEMENTED AND VERIFIED | `src/fitness/progression/` | tests/workoutProgression.ts; tests/workoutStartRewards.ts | New three-area content mapping still requires acceptance — NONE |
| **Fitness personalization** — Adapt prescriptions without multiplying soldier payout | IMPLEMENTED BUT NOT FULLY VERIFIED | `src/fitness/personalization/; src/fitness/estimate/` | tests/fitnessPersonalization.ts; tests/fitnessLevel.ts | Legacy estimate mode and new catalog compatibility AUD-017 — CONTENT/VERIFICATION |
| **Production catalog activation** — Start valid workouts selected from approved content | PARTIALLY IMPLEMENTED | `src/fitness/authoring/registry.ts; src/gameplay/workoutSelection.ts; src/server/production.ts` | Independent selection/start mismatch | AUD-003/017 — ENGINEERING/CONTENT |

## L

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Reward policy and start lock** — 60/100/145; authored ratio; durable immutable terms | IMPLEMENTED AND VERIFIED | `src/rewards/completionPolicy.ts; src/gameplay/workoutStart.ts` | tests/workoutRewardContracts.ts; tests/workoutStartRewards.ts | Production ratios not invented; AUD-018 — NONE |
| **Exactly-once soldier payout** — Full completion→existing applied ledger→bank | IMPLEMENTED AND VERIFIED | `src/rewards/application/apply.ts; src/rewards/pipeline/settleLockedWorkout.ts` | tests/workoutSettlementRewards.ts; tests/workoutRewardApi.ts | General request identity gap AUD-001 distinct from ledger protection — NONE |
| **Optional feedback** — Pay without feedback; later fitness evidence no repayment | IMPLEMENTED AND VERIFIED | `src/rewards/pipeline/settleLockedWorkout.ts; src/fitness/history/` | tests/workoutSettlementRewards.ts; tests/workoutRewardApi.ts | Unity behavior AUD-020 — NONE |
| **Legacy/specialized effects** — Retain identities and temporary/contextual effects | IMPLEMENTED AND VERIFIED | `src/rewards/pipeline/; src/gameplay/invasion/; src/gameplay/economy/collect.ts` | tests/workoutSettlementRewards.ts; tests/defenseTroopAccounting.ts; tests/gameplayContracts.ts | No ordinary soldiers for specialized workouts — NONE |
| **History/world atomicity** — No paid world with missing authoritative workout history | IMPLEMENTED AND VERIFIED | `src/persistence/supabase/atomicCommit.ts; src/fitness/history/` | tests/atomicCommit.ts; reward tests; live tests skipped | Live proof AUD-014 — EXTERNAL verification remains |

## M

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Rest/pause/recovery** — Legitimate rest without permanent progression penalty | IMPLEMENTED BUT NOT FULLY VERIFIED | `src/fitness/session/; src/gameplay/invasion/pause.ts; src/gameplay/config.ts` | tests/workoutPauseResume.ts; tests/invasionLifecycle.ts | AUD-009 time-domain/pause contract — DESIGN |

## N

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Earned world time** — 1min ticks, exact1.0/.1 presence accrual | IMPLEMENTED AND VERIFIED | `src/world/{realtimeClock,worldAccrual,presenceLeases,timeToTick}.ts` | tests/worldAccrual.ts; tests/gameplaySessionLeases.ts | No client presence authority — NONE |
| **Durable bounded catch-up** — Preserve backlog and deterministic next boundary | IMPLEMENTED AND VERIFIED | `src/server/session.ts; src/world/ContinuousWorldEngine.ts` | Bounded catch-up tests; tests/backendScale.ts | Event reload exception AUD-005; capacity AUD-016 — NONE |
| **Real-world gate separation** — Real deadlines ignore simulation multiplier | PARTIALLY IMPLEMENTED | `src/gameplay/config.ts; src/gameplay/invasion/` | Existing tick-based tests, code trace | AUD-009 — DESIGN/FEATURE |

## O

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Serialization/CAS/migrations** — Canonical maps, stable identities, no hidden stale merge | IMPLEMENTED AND VERIFIED | `src/persistence/{serialization,versioning,snapshot}.ts; src/persistence/supabase/adapter.ts` | tests/persistence.ts; tests/supabasePersistence.ts; tests/gameplayContracts.ts | Hydration event defect and live deployment separate — NONE |
| **Schema31 economic migration** — Cargo/yield/local reserves convert once | IMPLEMENTED AND VERIFIED | `src/persistence/empireBankMigration.ts` | tests/gameplayContracts.ts including five cargo phases | Real-corpus rollout AUD-015 — NONE |
| **Live DB and disaster recovery** — Actual permissions, RPC atomicity, restore | IMPLEMENTED BUT NOT FULLY VERIFIED | `src/persistence/supabase/; SQL migrations` | 3 credential-gated tests skipped | AUD-014/015 — EXTERNAL |

## P

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **HTTP privacy** — Safe projection and non-executing diagnostics | IMPLEMENTED AND VERIFIED | `src/server/http.ts` | tests/aiResponseCorrections.ts; tests/backendBoundary.ts | No leak found in executed suite; not an external penetration test — NONE |
| **Reward/reconnect DTO** — Display persisted promised/paid amounts | IMPLEMENTED AND VERIFIED | `src/orchestration/publicView.ts; src/orchestration/gameplayCommands.ts` | tests/workoutRewardApi.ts | Unity integration AUD-020 — NONE |
| **Current Unity end-to-end client** — Actual input/feedback/receipts/backlog handling | PARTIALLY IMPLEMENTED | `Unity/Assets/RepWars/RepWarsPlayLoop.cs; Unity/Assets/RepWars/RepWarsApiClient.cs` | No Unity tests executed; Windows worktree unavailable | AUD-020 — CLIENT INTEGRATION |
| **Public command discovery** — Advertise supported external capabilities | PARTIALLY IMPLEMENTED | `src/orchestration/commandIndex.ts; src/server/allowlist.ts` | Allowlist tests; catalog unfiltered | AUD-023 — OPTIONAL CLARITY |

## Q

| Feature / intended behavior | Status | Source evidence | Coverage | Remaining work / blocker |
|---|---|---|---|---|
| **Admission/cache/dependency limits** — Bound in-flight work and fail closed | IMPLEMENTED AND VERIFIED | `src/server/session.ts; src/server/dependencyBudget.ts` | tests/backendBoundary.ts; tests/sessionCache.ts | Synchronous CPU/I/O capacity AUD-016 — NONE |
| **Deployable authenticated service** — Identity, DB, readiness and executable host | SCAFFOLDED / PROTOTYPE ONLY | `src/server/production.ts; src/server/main.ts` | Factory tests, no deployment | AUD-013/021 — EXTERNAL/ENGINEERING |
| **CI/monitoring/restore evidence** — Operationally verifiable release | IMPLEMENTED BUT NOT FULLY VERIFIED | `.github/workflows/backend.yml; docs/BACKEND_OPERATIONS.md` | Local full suite/build only | AUD-014–016/021 — OPERATIONS |
| **Future self-learning/optimization** — Separate approved future direction, not current scope | NOT REQUIRED | `src/engine/DecisionEngine.ts; audit scope` | No implementation required by current audit | AUD-022/024; no open-ended engine rewrite — NONE |
