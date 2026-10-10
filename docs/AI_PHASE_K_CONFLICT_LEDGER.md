# Phase K — factual Conflict Ledger and WAR_VALUE trajectory

Implementation and independent review record. The final `REP_WARS_AI_Decision_Engine_Source_of_Truth_v1.0.md` and newer explicit project doctrine remain the design authority. No later phase is implemented. The independent checkpoint review and its final validation appear below.

## Baseline and audit

Started on `work`, clean, at `46497c9b854329c0b855ee3ea591178d726586a4` (`AI: goal lifecycle and opinion architecture`), directly after `6c64ea6241e7f5c3b4bbfd64bb5e890a63776aa1`. Schema 25.

Before this change, `StrategicEvaluators.warValue` used canonical relationship legality, current border field-force strength and contingent committed attacks. Its `currentPositionBalance` had no factual casualty, territorial or economic trajectory. `economicWarPenalty` was correctly zero. Proactive Peace comparison and actual required Peace response consumed this limited factual assessment.

The audit found reusable exact Battle Engine casualty/composition results, invasion/army/operation links, authoritative conquest destruction reports and Peace activation/expiry reducers. Memory, Opinion receipts, eventHistory and analytics contained historical descriptions but were not complete objective conflict authority. None is reconstructed into the ledger. Battle participant snapshots are not frozen as a new architecture in this phase.

## Canonical representation and identity

Schema **26** adds `GameState.conflictLedger` and `conflictEventReceipts`. `src/types/ConflictLedger.ts` owns the types; `src/conflict/ledger.ts` owns recording and detached summaries. There is no runtime ledger store, persisted WAR score or duplicate lifetime total.

A ledger key contains both exact faction IDs in stable code-unit order, encoded as JSON. Each pair contains an indexed current episode and archived compact episodes. Directional totals use the pair's documented faction ordering. Caller-relative summaries explicitly map own/opponent; A's losses are not B's losses.

Each episode stores observed start/end tick and AI-clock boundaries, directional aggregates, a material sequence and a bounded material window. Current-domain movement, invasion, constructions and operations remain authoritative for physical work. Ledger links describe consequences, not another simulation.

Receipts use an exact domain-chain identity + fact kind + exact pair identity. AI operations use their persisted operation IDs. Shared direct attacks use the existing command request identity, with a persisted factual-chain link on delayed attack intent; later processing requests cannot replace that link. Invasions preserve the chain link. Legacy physical fallback uses existing canonical intent boundaries and exact sorted participants. Identical receipts are no-ops; conflicting identity reuse throws. Resolved battles also validate an exact consequence fingerprint before replay can alter physical state.

## Recording boundaries

| Boundary | Recorded fact | What is not inferred |
| --- | --- | --- |
| Successful ATTACK initiation | Commitment with exact participants/target | Damage or victory |
| Engagement-ready arrival / invasion publication | Hostile arrival, commitment deduplicated | Travel completion before it occurs |
| Battle settlement | Exact directional troops/siege losses and actual result | Future RNG, predictions or grievance |
| Actual conquest | Control exchange and actual forfeitures | Retaining razed infrastructure, fictional war penalties |
| Central operation terminal settlement | Actual attack failure/completion | Failure while unfinished physical recovery remains |
| Attributable RETREAT initiation | Directional operational activity | Invented retreat losses or a success bonus |
| Actual Peace activation | Observed episode closure | Closing at offer or mutual acceptance |
| Actual expiry to WAR | New observed epoch | A declaration or fabricated fighting |

Operational counts are diagnostics, not additional copies of military success. Unopposed occupation creates territory facts without a fictional battle/casualties. Defensive retention is not a new territorial gain. Draws record actual casualties, no fabricated capture or victory.

Conquest uses the existing `settleTerritoryOwnershipChange` report. Completed structures, fortification levels and cancelled projects remain distinct units. Uncollected resources and local undeployed troops are measured before existing destruction clears them. No conquest, resource, recruitment or construction rule is changed.

Ordinary battles record authoritative Battle Engine casualties. Invasion workout mobilization can add virtual defensive power to the Battle Engine input. Those units are not physical troops: that case records actual physical settlement losses and labels its basis. The broader existing participant/input-freeze and virtual-survivor settlement contract remains outside Phase K; the ledger does not invent physical losses to reconcile it.

Canonical AI operations record terminal failure only at their actual physical terminal boundary through `settleOperation`. Interrupted travel/recovery is preserved. Legacy direct hostile travel without an AI operation retains its existing domain lifecycle; Phase K does not create a new recovery scheduler or infer terminal damage from strategic invalidation.

## Episodes and provisional policies

**PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED:** an initial episode starts lazily at the first observed fact. Default WAR alone records nothing. Actual PEACE closes it; clearance remains open. Actual return to WAR opens the next episode. Archived facts remain canonical; historical outcomes are not reset or copied into new-episode totals. Elimination retains facts and does not synthesize a declaration, reopen an episode or enable optional cognition.

The current decision reads the current observed episode, not all prior wars. Exact start/closure/reset/retention policy remains replaceable. This is not newly locked product doctrine.

**PROVISIONAL IMPLEMENTATION TUNING — PRODUCT CONFIRMATION REQUIRED; INITIAL IMPLEMENTATION TUNING — NOT LOCKED DESIGN:** all Phase K numeric interpretation is centralized in `src/constants/conflict.ts`:

| Parameter | Initial value |
| --- | --- |
| Recent material window | 16 facts; previous comparison window 16 |
| Troop loss saturation scale | 100 |
| Net territory saturation scale | 2 |
| Economic utility saturation scale | 100 |
| Casualty / territory / economic weights | 0.4 / 0.4 / 0.2 |
| Recent vs cumulative blend | 0.6 / 0.4 |
| Material history vs current position blend | 0.5 / 0.5 |

Recency is the most recent material consequences, not a wall-clock decay. Operational activity never displaces material facts. Duration is observed factual support only: there is no automatic fatigue, war exhaustion or economic penalty. Siege, structures, projects, fortification levels and pool forfeitures are reported without fabricated universal exchange prices.

## WAR_VALUE and causal ownership

Dependency graph:

`canonical relationship + current physical/committed border placement + keyed Conflict Ledger summary → WAR_VALUE`

`actual forfeited resources → RESOURCE_VALUE support → WAR_VALUE`

`WAR_VALUE → existing single Peace continuation contribution / actual required Peace factual assessment`

The original `currentPositionBalance` remains available. With no material history, `continuationBalance` preserves that original calculation. Recorded material history adds bounded/saturating cumulative and recent casualty/territory/resource balances, prior-window comparison and factual trajectory change. Confidence stays limited: historical gains are observations, not guaranteed future victory.

There is no evaluator cycle or eighth evaluator. RESOURCE_VALUE owns resource marginality inside WAR_VALUE; the comparator does not add that resource consequence again. Existing committed attacks remain contingent, movement placement factual, and committed construction part of the existing baseline. No future battle stream or duration RNG is inspected.

Exactly eight proactive actions, seven factual evaluators and five pressure domains remain. ATTACK retains its exact source/force/route and existing factual causal owners; Phase K adds no revenge/history attack bonus. Peace plans and actual required responses use continuation history through the existing WAR_VALUE slot. Goals, Opinion and risk remain separate authorized modifiers. Raw Memory, Goals, Opinion, personality, ambition and risk do not enter the ledger or factual WAR_VALUE. Trade legality, reservations, cargo and diplomatic Attention are unchanged; Trade does not close an episode or create ceasefire.

Ledger facts alone create no Pressure source or candidate. Existing real source detection and actionability remain responsible for deciding whether to deliberate. No constant conflict polling or global rescore storm is added.

## Transactions, persistence, privacy and invariants

Recording executes inside the current domain/Orchestrator transaction with its consequence. Failed initiation, aborted transaction and stale CAS writes cannot retain facts independently. The final review fixed nested-state adoption to include both conflict maps and the previously omitted canonical Opinion receipt map. Deep clone/overwrite/hydration preserve nested episode Maps, aggregates, windows, receipts and chain links.

Migration 25→26 creates empty ledger/receipt Maps, preserving all previous operations, claims, Peace/Trade, recruitment, cognition, sequence and clock state. It fabricates no old war duration, casualties or subjective history. Old in-flight physical truth remains valid; only newly observed consequences gain ledger coverage. Current-schema missing canonical Maps are corruption, not silently recreated authority.

`conflictStateProblems` validates pair/faction identity, episode sequence and closure boundaries, nonnegative safe-integer physical counts, finite resource amounts, ordered bounded material windows and keyed receipt ownership/identity. General transaction invariant cost can grow with retained history; hot WAR/observer paths do not scan it.

GET_GAME_STATE/public invasion output excludes the private ledger, receipts, trajectory and evaluator internals. No Unity files were changed. Internal WAR assessment provenance includes opponent, episode, observed coverage, directional totals, material windows, current position, continuation, limitations and contingent committed effects. These outputs are derived diagnostics, never reread as canonical authority.

## Storage growth and performance

Per-episode aggregates are fixed-size and recent storage is bounded to 32 material records. Replay receipts remain keyed and retained; archived compact episodes remain retained. Thus persistence/clone/invariant work can grow with history, but current decision work does not. General history/receipt compaction is deferred rather than invented.

Diagnostics use actual production observers, Orchestrator world advancement, recording reducers and factual evaluators. Heavy event bursts/Peace-cycle cases are explicitly reducer stress fixtures, not claims about Battle Engine throughput. Fine/coarse/reload tests additionally progress a real staged attack and compare exact canonical facts.

Validation and measured results are recorded below after final checks.

## Implementation validation before independent review

- Phase A 17/0; B 28/0; C 60/0; D 41/0; E 55/0; F 73/0; G 78/0; H 85/0; I 90/0; J 83/0; K **73/0**. Total focused: **683/0**.
- Independently selected anchors 16/0, invasion 24/0, economy foundation 22/0, cities 24/0, developments 15/0, persistence 45/0: **146/0**. Selected temporal/presence/session/replay/accrual coverage: **117/0**. The final full suite also reruns these production integrations.
- Final full suite: **1,762 passed / 0 failed** (baseline 1,689 plus 73 Phase K regressions).
- Production TypeScript `--noEmit`: passed.
- Test-inclusive compilation: **the same 28 pre-existing diagnostics**, compared by file + error code + message to the Phase J baseline; zero new or removed diagnostics. This compilation remains failing for those existing unrelated errors.
- `git diff --check`: passed.
- Source-of-Truth review: no locked-rule conflict found. Epoch/window/interpretation policy was unresolved; choices above are explicitly provisional.

Performance measurements (milliseconds, bounded diagnostics; not a broad platform benchmark):

| Fixture | Elapsed | Work and retained facts |
| --- | ---: | --- |
| 12 factions, no source, 10,000 ticks | 2,991 | 240,000 observer calls; 0 ledger writes, deliberations, WAR calls, operations or history rows |
| 5,000 material battle facts + 1,000 fresh keyed WAR assessments | 82 | 5,000 keyed receipts; recent window 32; WAR time 26 ms; archive/receipt iteration trapped |
| 64 factions, 2,016 pairs, 100 quiet ticks | 787 | 2,016 facts/receipts; 12,800 observers; 0 deliberations or WAR calls |
| 5,000 casualty/transfer facts + 5,000 exact replays | 56 | 10,000 keyed receipt lookups; only 5,000 updates; recent window 32 |
| 1,000 facts, 25 reloads and exact assessment comparisons | 162 | Every reload preserves facts and WAR assessment; 26 WAR calls, about 1 ms total |
| 1,000 Peace/WAR cycles + 1,000 current-episode assessments | 52 | 1,001 compact episodes; 3,000 receipts; current window empty; WAR time 14 ms |
| 24 real exact ATTACK commands, battles, captures and reload | 97 | 24 starts/settlements/arrivals/battles/transfers; 48 material facts, 120 receipts; recent window 32; exact reload equivalence |

The last fixture uses real Orchestrator/domain execution and the existing Battle Engine, with explicit exact plans (not 24 autonomous deliberations). It recorded 192,296 actual attacking troop casualties and 480 defending casualties under unchanged combat mechanics. It generated no eventHistory rows. The reducer stress fixtures intentionally contain no additional AI decisions/history rows; they measure factual recording/evaluation rather than combat throughput.

The comparable Phase J quiet fixture was 2,805 ms with the same 240,000 observations and zero deliberations. The measured difference is small and uncalibrated; no new work proportional to conflict history occurs in observer/WAR hot paths. Retained-history clone/hydration/invariant cost remains a future storage dependency, explicitly not solved by deleting history.

Focused coverage includes direct/shared and canonical-operation attack recording, attacker failure, defensive hold, real tied-roll draw, conquest forfeitures, physical recovery preservation, actual Peace activation/expiry, real in-flight clearance alongside accepted Trade, operation rollback, actual persistence CAS conflict/retry, exact fine/coarse staged-attack progression, reload, pair direction/order, inactive-faction behavior, factual/private-state traps, RNG isolation, schema migration and current-schema corruption.

## Changed files and review corrections

**39 files: 33 modified, 6 new.**

New: `src/types/ConflictLedger.ts`, `src/conflict/ledger.ts`, `src/constants/conflict.ts`, `src/state/conflictInvariants.ts`, `tests/aiConflict.ts`, this document.

Modified production: `src/types/GameState.ts`, `src/types/index.ts`, `src/state/cloneGameState.ts`, `src/state/gameStateInvariants.ts`, `src/persistence/versioning.ts`; `src/army/strategicAttack.ts`, `src/engine/operations.ts`, `src/orchestration/handlers.ts`, `src/orchestration/applyBattle.ts`; `src/gameplay/invasion/create.ts`, `src/gameplay/invasion/resolve.ts`, `src/gameplay/economy/ownership.ts`, `src/gameplay/diplomacy/peace.ts`; `src/scoring/factualSupport.ts`, `src/scoring/strategicEvaluators.ts`, `src/scoring/contextPlanComparison.ts`, `src/scoring/peaceAssessment.ts`.

Modified test infrastructure: `tests/run.ts` registers Phase K and includes canonical Maps in the structural assertion. Schema assertions alone advance in `aiCognition`, `aiPeace`, `aiRecruitment`, `aiStrategicPressure`, `aiTrade`, `commandIdempotency`, `economyFoundation`, `gameplaySessionLeases`, `gameplaySessionLifecycle`, `invasionLifecycle`, `leaseWorldAccrual`, `persistence`, `presenceLeases`, `sessionReplay`, `temporalBoundaries`. No physical/gameplay assertion was weakened.

Review corrections: nested adoption now preserves canonical ledger and Opinion receipts; fortification levels/projects are not fictional counts of completed structures; conflicting battle replay identities fail before physical mutation; exact direct-command identities cannot collide merely because the same force acts at one boundary; delayed/invasion links persist across processing/reload.

No Battle Engine/CombatPower math, movement duration, construction duration, recruitment tuning, Trade mechanics, fitness/workout, Unity, project/package or source-art file changed. No commit or push was made; HEAD remains the Phase J checkpoint on `work`.

## Deferred contracts

- Product confirmation of episode start/closure/current-vs-archived influence and recency/trajectory normalization tuning.
- Existing Battle participant/input-freeze and virtual-defense physical settlement contract; no new Battle/input pipeline in Phase K.
- Legacy direct hostile travel without canonical AI operation ownership does not gain an invented recovery/terminal policy; only actual observed settlement is factual.
- General retained receipt/episode/history compaction and long-horizon clone/invariant optimization.
- Reactive-emergency scheduling, recovery cognition, final hysteresis/repetition and all later-phase work.

## Independent checkpoint review

**Verdict: PASS after four Phase-K-scoped corrections.** Review started on `work` at the exact Phase J checkpoint `46497c9b854329c0b855ee3ea591178d726586a4`, with the expected 39-file uncommitted Phase K implementation. The Source of Truth §§21–23 and §34 were checked against the actual diff, recording callsites, physical settlement, nested transactions, persistence, evaluator dependencies and production cognition. No locked-rule conflict was found. Final scope remains **39 files: 33 modified, 6 new; schema 26**. No existing gameplay assertion was weakened.

### Reproduced defects and corrections

1. **Immediate invasion lost direct command identity.** `executeAttack` did not pass its existing request ID through `maybeHoldAttackAsInvasion`/`beginInvasionAgainstPlayer`; an unlinked immediate invasion therefore used the legacy physical fallback. The bridge now passes that ID. Existing operation identity and persisted delayed-intent links still take precedence, so later processing requests do not change a chain. The production-handler regression also fails under an injected bridge that drops this ID. Invasion IDs, timing, participant selection and eligibility are unchanged.
2. **Siege losses were absent from recent material facts.** Cumulative siege totals existed, but a siege-only consequence did not enter the material windows. Windows and detached summaries now preserve directional siege losses; invariants validate their shape/counts. Siege remains distinct from troops, with no invented exchange price or new evaluator.
3. **Replayed unopposed conquest could undo a subsequent recapture.** Receipt deduplication previously happened after physical transfer. `applyUnopposedOccupationToGameState` now checks the exact conquest receipt before ownership, garrison, resource, Goal or Memory mutation. Exact replay is a no-op even after a later recapture; conflicting participants/target fail explicitly.
4. **Closed episodes could still change.** New RETREAT/ATTACK_TERMINAL facts were permitted to alter closed aggregates. Recording now rejects new facts against a closed Peace episode, while exact receipt replay remains a no-op and WAR_RETURN retains the explicit next-episode transition. Physical withdrawal during Peace remains legal but is not recorded as new conflict activity. A real RETREAT operation regression verifies travel still starts without changing the closed ledger.

Eleven review regressions were added, bringing Phase K to **84 tests**. They cover the four corrections, exact 16/17/32/33 window rollover, actual reloaded invasion mobilization and physical defender-loss accounting, and schema-25 in-flight attack migration preserving physical state/claims/exact plans without fabricated historical outcomes.

### Authority, accounting and evaluator findings

| Review area | Result and production evidence |
| --- | --- |
| Vocabulary | `PROACTIVE_AI_ACTIONS`, `STRATEGIC_EVALUATORS`, `PRESSURE_DOMAINS` remain exactly eight/seven/five. Conflict history is support, not an action, evaluator or pressure domain. |
| Canonical authority | `GameState.conflictLedger` and `conflictEventReceipts` are the only mutable factual authority. `recordConflictFact` records current domain consequences; diagnostic summaries/caches, Memory and logs do not write/reconstruct history. |
| Pair/directional identity | `conflictPairId` preserves full exact IDs in stable code-unit order. Own/opponent summary indexing is reciprocal; B history cannot pollute C. No hashes, runtime sequence, wall clock or Map index are used. |
| Episodes | First factual observation creates a lazy episode; default WAR fabricates nothing. Actual clearance keeps it open, actual Peace freezes it, actual expiry creates the next clean episode. Replayed old receipts cannot alter the new episode. Archive/current lookup remains keyed. |
| Chains/receipts | Operation ID or existing request ID follows persisted intent/invasion links. Fact kind distinguishes commitment/arrival/result/transfer/terminal without converting those counts into repeated success. Battle fingerprint and conquest preflight prevent repeated physical application. |
| Casualties | `applyBattleResultToGameState` records Battle Engine troop and siege casualties separately. Attacker defeat is failure, defender retention is no territorial gain, draws grant no victory/capture. |
| Virtual defense | Actual `resolveInvasionBattle(..., 'defense_battle')` regression preserves defensive victory/territory retention/attacker termination and records only physical defender losses. Virtual workout power is not a troop casualty or economic loss. See the important external integration risk below. |
| Territory/destruction | Actual transfers increment one gain/loss. `settleTerritoryOwnershipChange` supplies measured uncollected-resource/pool forfeitures. Completed City/Farm/Mine/Lumber, fortification levels and cancelled projects are distinct quantities. Recapture is a separate exact chain. |
| Economic burden | Actual conquest forfeitures consult RESOURCE_VALUE once inside WAR_VALUE. There are no invented upkeep penalties, sanctions, embargoes, exhaustion or subjective war weariness. Structure/project/pool/siege losses are reported without fabricated prices. |
| Material windows | Exact recent 16 plus preceding 16 rollover verified at 16/17/32/33 and through 50,000 events. Troop/siege/control/forfeiture consequences qualify; activity-only noise does not displace them. Cumulative totals remain exact. |
| Trajectory/duration | Favorable, unfavorable and mixed histories have directional factual components. Recency is event-window based; elapsed duration is diagnostic only. Quiet elapsed time causes no decay or fatigue. Normalization/weights remain centralized provisional tuning. |
| Committed baseline | Existing physical positioning and committed hostile effects remain factual/contingent respectively; a committed attack is never guaranteed capture. WAIT and Phase E source/actionability behavior are unchanged. |
| Dependency graph | Canonical physical border/relationship facts + keyed current episode → WAR_VALUE; forfeited-resource amounts → RESOURCE_VALUE → WAR_VALUE. No WAR_VALUE→TERRITORY_VALUE/LOCAL_DANGER/FORCE_POSITION_VALUE/BATTLE_OUTLOOK cycle exists. |
| Causal ownership | ATTACK retains Battle Outlook, Territory Value, positioning and timing owners without a new history/revenge bonus. Peace uses one `war:continuation_avoided` contribution. Required Peace response interprets the same factual continuation result; Goal/Opinion/Risk remain later separate modifiers. |
| Neutrality/RNG | Goal, Opinion, Memory, Personality, Ambition and Risk do not enter ledger/WAR factual support. Private-field getter traps and changed cognition leave factual results unchanged. Repeated factual evaluation cannot consume future battle RNG. No persisted universal war score exists. |
| Trade independence | Trade remains legal during WAR/clearance/Peace. Actual in-flight attack + Peace clearance + accepted bilateral cargo regression verifies that Trade does not close a conflict, create ceasefire or corrupt hostile claims. Phase K changes no Trade reducer or eligibility. |
| Temporal/CAS | Writes run with physical consequences in existing cloned transactions before next cognition, without a new scheduler. Aborted drafts and real persistence CAS conflict/retry retain neither partial consequences nor duplicate facts. Nested adoption preserves ledger and canonical Opinion receipts. |
| Migration/reload | 25→26 initializes empty maps rather than inferring subjective history. Existing operations/claims/Peace/Trade/recruitment/identity clocks remain intact. Current-schema missing maps are corruption. Fine/coarse/reloaded real staged attacks produce identical facts and WAR output. |
| Determinism/privacy | Stable caller/event order, exact pair/participant identities, persisted boundaries and fixed window rules survive insertion-order changes/reload. Public DTOs omit ledger/receipts/WAR diagnostics. Internal detached diagnostics expose components, provenance, observed coverage and limitations only. |

### Final review validation

| Check | Result |
| --- | --- |
| Phase A / B / C / D focused | 17 / 28 / 60 / 41 passed |
| Phase E / F / G / H focused | 55 / 73 / 78 / 85 passed |
| Phase I / J / K focused | 90 / 83 / **84** passed |
| Total focused A–K | **694 passed, 0 failed** |
| Independent anchors | **16 passed** |
| Selected invasion / economy foundation / cities / developments / persistence | 24 / 22 / 24 / 15 / 45 passed; with anchors **146/0** |
| Selected temporal / presence / session / replay / accrual | **117 passed, 0 failed** |
| Full suite, including Peace/Trade/battle/persistence/schema integrations | **1,773 passed, 0 failed** |
| Production TypeScript `--noEmit` | Passed |
| Test-inclusive TypeScript | Same **28 pre-existing diagnostics**; file + code + message comparison shows zero added/removed diagnostics. This check still fails for those unrelated existing errors. |
| `git diff --check` | Passed |

### Independent performance diagnostics

Measurements are bounded local diagnostics, not platform/mobile claims. Reducer bursts exercise exact factual recording; the real-attack row uses Orchestrator/Battle execution. No observer or evaluator benchmark bypasses production helpers.

| Fixture | Total ms | Work and result |
| --- | ---: | --- |
| Quiet 12 factions / 10,000 ticks | **2,959** | 240,000 observations; 0 ledger writes/receipt lookups/WAR calls/deliberations/plans/operations/history rows. Comparable prior implementation: 2,991 ms. |
| 5,000 material facts + 1,000 fresh WAR assessments | **83** | 5,000 writes/receipts; window 32; WAR time 27 ms; archive/receipt iteration trapped. Prior: 82 ms. |
| 64 factions / 2,016 pairs / 100 quiet ticks | **782** | 2,016 setup facts; 12,800 observations; 0 WAR calls/deliberations/history; no observer pair scan. Prior: 787 ms. |
| 5,000 facts + 5,000 exact duplicate events | **50** | 10,000 keyed lookups, exactly 5,000 actual writes; no duplicate totals/window/history. Prior: 56 ms. |
| 1,000 facts / 25 reload comparisons | **169** | Exact ledger/WAR equivalence; 26 WAR calls, 2 ms; no deliberations/history. Prior: 162 ms. |
| 1,000 Peace/WAR cycles + 1,000 assessments | **55** | 1,001 episodes, 3,000 receipts; 14 ms WAR time; keyed current episode. Prior: 52 ms. |
| 24 actual exact attacks / battles / captures / reload | **94** | 24 starts/settlements/commitments/arrivals/battles/transfers; actual troop losses 192,296/480; 48 material facts, 120 receipts, window 32; no autonomous deliberations/history. Prior: 97 ms. |
| Rollover stress at 32 / 5,000 / 50,000 total material facts | **58 / 77 / 274** | Each stage runs 1,000 fresh WAR assessments: **26 / 19 / 20 ms**. Exact totals/sequences, window always 32. At final stage 50,000 receipts; no extra history. Iterators/entries/values for ledger, receipts and archived episodes are trapped during assessment. |

**Performance classification: acceptable bounded Phase-K work; future retained-history storage dependency.** No new polling, per-observer ledger scan or assessment work proportional to receipt/archive length was found. Full transaction clone/invariant/hydration work still traverses retained canonical state and can grow over long history; no compaction policy is invented here.

### Policy classification and remaining integration risks

- **PROVISIONAL IMPLEMENTATION POLICY — PRODUCT CONFIRMATION REQUIRED:** lazy observed episode start, actual Peace freeze, clearance open, clean episode at actual expiry, retention and current-episode-only interpretation remain explicit replaceable policy. Post-Peace physical withdrawal is not new conflict activity; its physical domain behavior is unchanged.
- **PROVISIONAL IMPLEMENTATION TUNING — PRODUCT CONFIRMATION REQUIRED:** material event-window size, casualty/territory/economic scales and weights, recency/history blending are centralized in `CONFLICT_TUNING`. No final Peace/Personality/Ambition tuning was performed. Commitment/activity/duration carry no independent desirability bonus; structures/siege/projects/pools have no invented conversion price.
- **High-priority external contract: Battle participant/input freeze and virtual-defense settlement.** Current invasion inputs are assembled at settlement; they are not an immutable snapshot frozen when an invasion begins. Current physical survivor application can mix virtual defense with real defenders. Phase K records observed physical losses in the virtual path, but does not repair participant freezing, virtual-survivor allocation or guaranteed-defense product behavior. The mismatch detector is valid for the present synchronous production settlement path; a future deferred-result pipeline must explicitly identify frozen physical/virtual participants rather than assume every initial-count mismatch is virtual defense. This needs a separately authorized Battle/Invasion phase.
- Receipt/episode retention and long-horizon clone/invariant/serialization optimization remain deferred. Legacy direct hostile work without an exact operation/command identity retains existing fallback/lifecycle limitations; no recovery or historic reconstruction is invented.
- No Phase L, reactive/recovery scheduler, final hysteresis/repetition, cargo recovery, autonomous counteroffers, generalized logistics/stockpiles, sanctions, PvP/market, Unity or fitness/workout changes were introduced. No push is authorized or performed.

The authorized local checkpoint message is `AI: conflict ledger and war value trajectory`; its exact hash and clean-state/direct-parent verification are reported after commit creation.
