# Backend completion — isolated engineering run

## Baseline and scope

The specification's missing-checkpoint assumption was checked against Git. This environment retains the complete linear C1 → C2 → C3 → R1-C → R1-D → R1-E → R1-F history. `c5a3af52ef83ea3aaac18f132e27868ab3cb7ae0` on `feat/r1-f-workout-reward-api` is a verified descendant of the reconciled `6f38eec6516682e64937b08744a5607f54bbba91`. The new branch `feat/backend-completion` in `/workspace/REP-WARS-2-COMPLETION` preserves that available work rather than reimplementing it. All eight existing worktrees started clean and remain protected. No remote changes or Unity edits are authorized by this run.

Baseline source typecheck: pass. Baseline runtime invocation via Node (the dependency executable shim lacks execute permission): 2,124 reported passes, zero failures, including three credential skip returns historically counted as passes. Baseline test compile: 28 errors. Node v24.19.0. Raw logs and checkpoint manifests: `/tmp/repwars-completion/` (not repository artifacts).

## Dependency plan

1. Repair the 28 test typing errors without weakening compiler options or runtime assertions; await async tests and report real skips.
2. Add a fail-closed, provider-neutral identity boundary; protect clocks and public command exposure; verify actual HTTP behavior and persisted ownership.
3. Validate map geometry and deterministic content identity without choosing between Level 1 definitions; retain legacy save compatibility.
4. Audit existing reservations, deployment, operations, economy, AI, time and persistence; fix reproducible defects, preserve established gameplay. Integrate sufficiently specified capabilities; record exact missing product contracts.
5. Add end-to-end, recovery, long-horizon and adversarial coverage; compile source and tests, run the full suite, document production prerequisites and checkpoint locally.

## Test discipline

The old synchronous `test()` runner incremented the pass count before promise-returning callbacks settled. Registrations now run sequentially and await every callback; async assertion failures are failures. Credential-gated tests throw a dedicated skip marker, not successful returns. Live Supabase tests require both credentials and explicit `REP_WARS_RUN_LIVE_SUPABASE_TESTS=true` for an approved non-production database. No live database is used in this assignment.

Typing repairs add runtime narrowing, store union results before examining them, use the existing public DTO types, remove excess fields from battle input projections, and remove unreachable branches after throwing assertions. Two intentional invalid-configuration tests retain narrowly documented `unknown` casts to feed malformed data to runtime validators. No production balance/configuration type was weakened. `npm test` now runs with ts-node typechecking; dedicated source/test typecheck scripts are provided.

## Verified design boundaries

- Preserve the actual eight proactive AI actions, five pressures and seven factual evaluators. The master specification's larger historical vocabulary is an audit list, not authorization to restore removed autonomous policies.
- No invented world soldier ratios or authored workout prescriptions. Existing locked reward/session/ledger behavior from R1-C–F is reused.
- Local Food versus faction-bank location/transport remains a product contract blocker, per the prior explicit decision. No automatic banking or transport shortcut.
- Current world visibility is explicitly complete. Scouting cost/range/duration and discovery semantics require product decisions before changing live visibility. Legacy MapEngine is not a second runtime authority.
- The available branch does not contain the separately reported AI-SIM checkpoint. Its distant-army and declined-Trade changes are not claimed as integrated. This run independently implements the approved local army-formation capability using the existing exact REINFORCE plan contract; it does not reconstruct that branch or its simulation campaign.
- No production authentication provider is selected. The adapter boundary and cross-player rejection can be tested; provider validation, hosted monitoring/backups and live Supabase remain external gates.

## Executive assessment

The backend supports a tested local gameplay loop with fixture-authored rewards. This run repairs test execution/typechecking, closes identity/time/plan-ownership boundaries, exposes implemented diplomacy, pins new-world content, and adds local military recovery. It is **not feature-complete or ready for public release**. Production identity, live persistence/recovery evidence, approved workout content/ratios and several gameplay contracts remain prerequisites. No completion percentage is asserted.

## Completed changes and evidence

All changes reuse the existing canonical state, orchestration, persistence and gameplay services. The code checkpoint and final validation totals are recorded in the Git/testing sections below.

| Change | Implementation / tests | Result and limits |
|---|---|---|
| Strict test execution | `package.json`, `tests/run.ts`, typing repairs in existing tests, `tests/skip.ts` | Source and tests compile without suppressing the 28 inherited errors. Promise tests are awaited. Three opt-in database tests are skips rather than passes. |
| Identity and startup | `src/server/identity.ts`, `http.ts`, `main.ts`, `production.ts`, `session.ts`; `tests/backendBoundary.ts` | Four player routes fail closed without a trusted adapter. Cross-player body identity is rejected before world creation. Development bypass is explicit and forbidden in production. Production composition validates configuration eagerly, forbids fixtures, requires Supabase plus trusted identity/readiness adapters. Actual provider/hosted readiness is not supplied. |
| Server time and ownership | `src/orchestration/orchestrator.ts`, `authorization.ts`; boundary tests | A trusted receipt replaces caller `now`. Nested plans cannot act as another faction; caller operation/commitment links are rejected. Failed commands retain canonical state. Internal AI/system paths retain their intended authority. |
| Truthful public commands | `src/server/allowlist.ts`, `http.ts`; real HTTP Peace/Trade tests | Public catalog lists implemented, exposed commands only. Seven existing Peace/Trade commands are exposed. Unsupported historical commands and internal-only REINFORCE are removed from public exposure. No diplomacy rule or cost changed. |
| Content compatibility | `src/worldDefinition/contentIdentity.ts`, `identity.ts`, `instantiate.ts`, `index.ts`, `src/types/GameState.ts`, `state/{createGameState,cloneGameState,gameStateInvariants}.ts`, `persistence/versioning.ts`, public DTO/handler and simulation fixture updates; `tests/worldContentIdentity.ts` | Schema 30 adds a nullable content pin. New saves reject incompatible registered content under the same ID; legacy provenance remains explicitly unknown. Clone/hydrate/migrate preserve all other fields. No world JSON or Unity content is changed. |
| Geometry/input defects | `src/worldDefinition/{geometry,parse,validate}.ts`; content tests | Zero-length edges no longer contain arbitrary points. Self-crossing/repeated-edge rings and malformed containers/initial troop quantities are rejected. Parser does not mutate caller containers. This is not a complete map-topology validator. |
| Military recovery | `src/gameplay/recruitment/reinforcement.ts`, `src/army/soldierForce.ts`, `gameplay/attacks/commitBankedTroops.ts`, `engine/strategicPressure.ts`, `scoring/strategicEvaluators.ts`; `tests/localFormation.ts` | Existing `REINFORCE` destination `new_army` consumes reserved local troops at timed completion, allocates with C2's durable counter and updates faction/operation references. Existing banked deployment stats are shared unchanged. Bounded hostile-frontier candidates and factual force utility enable actual AI selection without new actions, weights or RNG. |
| Cross-system validation | `tests/backendBoundary.ts`, `tests/backendLongHorizon.ts` | Real HTTP identity → selection/start → progress → payout without feedback → banked attack → restart/retry → offline accrual; exact public diplomacy lifecycle; two seeded 1,440-tick replay tests. |
| Delivery/recovery foundations | `.github/workflows/backend.yml`, `.env.example`, `docs/BACKEND_OPERATIONS.md` | Node-24 CI definition, explicit configuration and safe migration/restore runbook. Hosted CI, deployment and restore drills have not run. |

### Concrete defects reproduced and corrected

1. Baseline test compile had 28 errors and the synchronous runner could count a returned promise as passed before it settled. Strict compilation and awaited execution now replace those weak checks.
2. Caller-selected `playerId` could choose the persistence namespace. The default HTTP path now requires an authenticated principal; the old behavior is isolated to explicitly enabled local development.
3. Handler request time could differ from the trusted receipt; forged workout `now` values now cannot control that time.
4. A player-supplied nested REINFORCE plan could act on an NPC local pool. Ownership validation and removal of the internal command from public exposure close that path.
5. Registered world definitions could silently rebind immutable geometry/content under the same identity. Newly created saves now carry a compatibility fingerprint; migration does not invent a historical one.
6. Degenerate polygon segments could incorrectly report remote points on a zero-length edge. Geometry tests reproduce and prevent it.
7. The typed `new_army` destination was always rejected as having no authoritative path. The approved local formation operation now works through reservations/timers and the existing ID allocator.
8. A newly added startup test caught lazy Supabase validation in the first production factory implementation. The factory now invokes the existing configuration validator before returning a server. This candidate failure is preserved in external validation logs; it was not waived.

### Military accounting and remaining planning limits

Formation starts only from an owned, co-located recruitment pool with sufficient available quantity and no active invasion engagement. Existing local-troop and destination claims reserve the exact plan; no soldiers exist in an army until initiation completes. Settlement deducts that quantity, allocates a durable army ID, creates the force locally, updates the faction index and records the operation link. Repeated settlement is rejected by the existing operation lifecycle. Interrupted initiation releases claims without consuming troops or identity. Two stale writers produce the same draft identity, and only one CAS can commit it.

Ten focused tests cover actual AI selection/execution, exact conservation, insufficient/wrong-owner/exhausted-ID rejection, duplicate initiation, partial timer reload, deterministic replay, terminal repetition, interruption, stale CAS, ID non-reuse and subsequent ordinary movement. The existing Phase G assertion that new-army formation was unsupported was intentionally changed to assert the newly approved capability; no casualty or balance assertion was removed.

Automatic candidate discovery is currently limited to a faction with no field armies and an adequate owned pool adjacent to an existing hostile objective. An interior-only pool or a pool below the existing legal attack minimum is not proven to restore proactive mobility. The domain operation can form locally outside that candidate scope. This is **partial strategic recovery**, not evidence that the AI can always recover or use new armies wisely. No personality, scoring weight, attack threshold or combat equation changed.

## Feature completion matrix

Status meanings are those in the master specification. Severity below describes the impact of **remaining work**, not an assertion that the tested implementation is defective. “Verified” means executed local tests, not a live production deployment.

| Capability | Status | Evidence | Remaining work / severity / dependency |
|---|---|---|---|
| Canonical state and transactions | IMPLEMENTED AND VERIFIED | `orchestration/transaction.ts`, invariants, orchestration and full regression runner | Continue schema/content compatibility review; high impact if bypassed. |
| Workout lifecycle | IMPLEMENTED AND VERIFIED | `fitness/session/*`, `gameplay/workoutStart.ts`, R1-C–F tests and authenticated loop | Final authored size-tagged workouts and approved personalization content; release blocker, product. |
| Locked normal reward settlement | IMPLEMENTED AND VERIFIED | `rewards/completionPolicy.ts`, `completionEntitlement.ts`, `pipeline/settleLockedWorkout.ts`, `application/apply.ts`; retry/CAS/feedback tests | World ratios absent in production definitions; release blocker, authored policy. No ratio invented. |
| Specialized/legacy rewards | IMPLEMENTED AND VERIFIED | Existing defense/construction/Golden Yield pipeline; C1 and legacy reward tests | Existing specialized rules retained; final content/participation review is product work. |
| Fitness readiness/progression | PARTIALLY IMPLEMENTED | Movement-specific evidence, readiness, personalization and progression suites pass | Final exercise prescriptions, body-region progression/content requirements cannot be inferred from existing estimates; high, product. |
| Player banked deployment | PARTIALLY IMPLEMENTED | `gameplay/attacks/commitBankedTroops.ts`; C2 and HTTP loop | Existing attack deployment works. General bank-to-local-garrison placement and redeployment contract not defined; high, located bank/logistics policy. |
| Local reinforcement / army formation | IMPLEMENTED AND VERIFIED | `gameplay/recruitment/reinforcement.ts`, Phase G and 10 formation tests | NPC automatic planning remains frontier-scoped; medium, broader strategic design/testing. Public player REINFORCE DTO is not implemented. |
| Army movement | IMPLEMENTED AND VERIFIED | `army/movement.ts`, `armyMovement.ts`, operation claims and formation movement test | General transport/stranded recovery policies remain partial; medium, approved recovery behavior. |
| Invasion / defense | IMPLEMENTED AND VERIFIED | `gameplay/invasion/*`, `invasionLifecycle.ts`, C1/C3 | Final defense-participation product decisions not changed; medium. |
| Battle / occupation | IMPLEMENTED AND VERIFIED | `battle/BattleEngine.ts`, `army/strategicAttack.ts`, defense accounting and seed-authority tests | No balance conclusions from test success; campaign calibration still required. |
| Army identity | IMPLEMENTED AND VERIFIED | `army/identity.ts`, `armyIdentity.ts`, reload/deletion/CAS formation tests | Existing IDs preserved; no external counter. |
| Construction | IMPLEMENTED AND VERIFIED | `gameplay/construction/*`, economy/city tests | New road/market definitions require approved costs/durations; medium, product. |
| Resource economy / reservations | IMPLEMENTED AND VERIFIED | `gameplay/economy/*`, `engine/operations.ts`, economy/Trade tests | Existing local yield and faction stock semantics retained; broader logistics incomplete. |
| Upkeep | IMPLEMENTED AND VERIFIED | `gameplay/economy/foodConsumption.ts`, reservation-aware economy tests | NPC produced Food can remain inaccessible to bank upkeep; high, located-bank/transport decision. |
| Automatic AI Food provisioning | BLOCKED BY PRODUCT DECISION | Local production versus unlocated faction bank audit; previous explicit user decision | Define physical bank location and transport before implementation; high. |
| Physical Trade logistics | PARTIALLY IMPLEMENTED | `gameplay/trade/{trade,resources,policy}.ts`, AI Trade/reservation suites | Existing first-owned dispatch/bank node and custody/stranding policy is provisional, not general physical resource transport; high, product. |
| Roads | BLOCKED BY PRODUCT DECISION | No approved road cost/time/speed definition in current construction registry | Define road effects, construction and links; medium. No fake successful road command added. |
| General resource shipments | BLOCKED BY PRODUCT DECISION | Trade shipment authority exists; general bank transport does not | Physical stockpile/bank and custody contract; high. |
| Markets | BLOCKED BY PRODUCT DECISION | No integrated priced market contract in current command path | Approved pricing, liquidity and settlement policy; medium. Trade is not labeled a market. |
| Trade | IMPLEMENTED AND VERIFIED | Existing proposal/reservation/shipment lifecycle plus new authenticated HTTP lifecycle | Declined-offer improvement from unavailable AI-SIM branch not integrated; provisional logistics noted above. |
| Peace / diplomacy | IMPLEMENTED AND VERIFIED | `gameplay/diplomacy/peace.ts`, AI Peace tests, new public offer/respond/withdraw routes | Default WAR, pending clearance and exact terms retained; no old DECLARE_WAR/NEGOTIATE resurrection. |
| AI warlords | PARTIALLY IMPLEMENTED | A–L suites, real selection/formation, seeded long-horizon harness | Distant-army scope, repeated Trade rejection, attrition and interior-pool recovery need separate evidence/work; medium-high. No borrowed historical simulation claims. |
| Time / catch-up | IMPLEMENTED AND VERIFIED | Temporal, lease, accrual, timer, replay and 10,000-tick catch-up tests | Supported current scope only; overall request work budgeting remains engineering work. No Temporal V2 claim. |
| Fog of war | BLOCKED BY PRODUCT DECISION | `orchestration/publicView.ts` explicitly exposes a fully visible current world; legacy `map/MapEngine.ts` is not runtime authority | Define knowledge/current visibility/persistence and reveal policy; high. No false hidden-world guarantee. |
| Scouting | BLOCKED BY PRODUCT DECISION | No integrated live scouting contract with approved parameters | Range, timing, costs, reveal duration and public projection policy; high. |
| World events | IMPLEMENTED AND VERIFIED | `events/WorldSimulator.ts`, `world/eventTick.ts`, event observation tests | Existing event set only; no new event balance or invented content. |
| World progression | IMPLEMENTED AND VERIFIED | `worldDefinition/campaign.ts`, completion/campaign reward guards | Registered Level 1/2 require `control_fraction: 1`; content still limited and Level 1 geometry disagreement unresolved. The generic definition format also permits historical alternate completion modes; do not author them as approved full-domination worlds. |
| World validation/content revisions | PARTIALLY IMPLEMENTED | 18 content/geometry tests; pinned schema-30 saves | Legacy hash unknown; complete polygon-overlap/island coverage and visual-content revision workflow need editor integration; high for content rollout. |
| Persistence/CAS | IMPLEMENTED AND VERIFIED | In-memory and Supabase adapter/table-fake tests; world/history rollback and stale writers | Actual database/RPC/RLS durability is BLOCKED BY INFRASTRUCTURE; three live tests skipped. |
| Reconnect / receipts | IMPLEMENTED AND VERIFIED | Session replay, command idempotency, R1-F and restart HTTP loop | Local restart uses real host with in-memory persistence port, not proof of process/DB durability. |
| Authentication | PARTIALLY IMPLEMENTED | Fail-closed boundary, production factory and cross-player tests | Provider verification/mapping/revocation not configured; critical release blocker, infrastructure/product. |
| Public data/error safety | IMPLEMENTED AND VERIFIED | Existing 50-case privacy family in full runner; nested/proxy/logger tests; public catalog filtering | Geography remains intentionally fully visible; cannot claim implemented fog filtering. |
| CI | IMPLEMENTED BUT UNVERIFIED | `.github/workflows/backend.yml`; same commands run locally | Hosted workflow not executed; medium, branch sharing/CI environment. |
| Hosted operations/backups | BLOCKED BY INFRASTRUCTURE | `BACKEND_OPERATIONS.md` runbook | Restore drill, monitoring, rate limits, TLS, provider and deployment configuration; critical release prerequisites. |
| Unity/editor integration | NOT IN SCOPE OF THIS ASSIGNMENT | Existing public DTOs preserved/extended; no Unity diff | Unity must consume authentication, content pins and reward/session DTOs; exact visual Level 1 contract requires review. |

## Validation and numerical evidence

The final executed command/count table and compact evidence manifest are appended after validation. Raw logs reside outside Git at `/tmp/repwars-completion/`; they are not production artifacts. No credentialed database test, Unity editor test, hosted CI run, deployment, backup or remote operation occurred.

There are **53 new registered tests**: 23 boundary/integration, 18 world content/geometry, 10 formation, and two long-horizon replay tests. Existing current-schema assertions change to 30; historical input schemas remain unchanged. Baseline 2,124 included three false-positive skip returns: the comparable baseline is 2,121 executed passes plus three skips. Expected final accounting is 2,121 + 53 executed passes, with three skips separately reported.

The authenticated loop uses an explicitly synthetic authored LONG workout and the existing test-only ratio 1.25, producing 181 locked soldiers through half-up rounding. It finishes without feedback, survives restart/lost response, spends through the actual banked ATTACK path, checks battle troop conservation, then ends the lease and verifies ten real-world offline minutes earn one simulation tick. This is not an approved production ratio or a demonstration of workout sensing.

### Long-horizon experiment

`src/simulation/longRunHarness.ts::runLongSimulation` drives Orchestrator/ADVANCE_WORLD/ContinuousWorldEngine with `SAMPLE_MAP`/`WARLORD_SPECS`. These are existing **legacy AI-only fixtures**, including fixture cities, not representative human calendar campaigns. Each seed runs 1,440 simulation ticks (1,440 simulation minutes) twice; no claim is made that this equals one calendar day with ordinary presence.

| Seed | Successful attack resolutions | Failed attack resolutions | Net territories whose owner changed | Final operations / claims | Serialized state bytes | SHA-256 |
|---|---:|---:|---:|---|---:|---|
| 11 | 3 | 0 | 2 | 3 / 0 | 1,460,605 | `e68d781da9cf1696f1e57d405aa0085e53fe8e4ec963a778117e5c855c8fe530` |
| 29 | 4 | 2 | 2 | 6 / 0 | 847,498 | `bc9eeed703f6353ebcd460696e9a79b237ed5c99467e27f1341576313ecd1a64` |

Both replays match the entire canonical snapshot, with zero invariant violations, engine errors, advance failures or decisions for eliminated factions. Seed 11 eliminates `celestial_theocracy`; seed 29 eliminates none. The harness's “battles” counter counts successful ATTACK commitment resolutions, not a player victory rate; net owner changes are not a gross conquest count. The two failed attack resolutions are surfaced as contained lifecycle outcomes, not silently converted to successful battles. These small samples do not establish military balance or strategic quality.

Before/after formation, those hashes and outcomes are identical. Formation was not triggered in this cohort, so this proves non-regression only; the focused actual-AI recovery fixture establishes that capability. Before timings (ms): seed 11 2,406/2,090, seed 29 1,772/1,666. After timings: 3,837/3,235 and 2,352/2,520. The after run overlapped a full suite, so these are **not a controlled speed comparison**. Process-wide RSS reached about 313 MiB after four runs; it is not an isolated per-world allocation estimate. No performance optimization is claimed.

In the final full runner, the same seeds/replays took 2,429/2,397 and 1,934/1,991 ms, with the same hashes. The existing **paused** 10,000-tick catch-up case took 15,379 ms, 157 chunks, 188 state changes, zero retained eventHistory entries, zero commitment resolutions and 1,046 returned events. A paused catch-up measurement must not be relabeled a production multi-faction AI load test.

### API and migration impact

Default HTTP startup now rejects unauthenticated player access. Existing local clients must explicitly opt into development identity; production clients require the reviewed credential adapter. This is an intentional security compatibility change. `/ready` is new, separate from `/health`; no probe means 503. Public GET_COMMAND_INDEX no longer advertises unsupported/internal commands. The seven newly exposed diplomacy commands still require their existing exact plans, owned identities and legal lifecycle.

`definitionContentFingerprint` is an additive public-state field. GET_WORLD_DEFINITION additionally returns `contentIdentity` (algorithm, full and geometry fingerprints) and `persistedContentFingerprint`. State schema 30 is not backward-readable by schema-29 binaries. Upgrade migration gives old saves a null pin and preserves their prior rebind semantics; it does not certify their historical geometry. Matching new pinned saves round-trip exactly. No SQL table, production data, world ratio, catalog, geometry or Unity asset was changed. Review the recovery runbook before enabling writes with this schema.

## Architecture review and self-audit

- **Authority:** one GameState and existing transaction drafts. No second reward ledger, army allocator, economy store, AI Director or RNG service. Public commands remain routed through the host, Orchestrator, invariants and CAS.
- **Reward safety:** C1–C3 and R1-C–F remain ancestors. Locked entitlement, applied-reward identity, optional feedback, legacy/specialized effects and campaign obligation guards are unchanged. Permanent fitness progress is not military collateral.
- **Military/resources:** exact local claims and timed settlement reuse operations. Formation does not create troops; subsequent MOVE uses transit. Existing resource/Trade reservations and interruption tests pass. General stranded recovery is not silently “repaired.”
- **Determinism/time:** no client seed, clock, timing multiplier, ordering or RNG policy changed. Only trusted server receipt reaches handlers through the HTTP path. Existing online 1.0x/offline 0.1x and durable accrued backlog remain; migration does not process earned backlog.
- **Concurrency:** local serialization is not the final authority; state_version CAS remains decisive. Lost responses replay durable receipts where supported; entitlement-ledger identity protects payout beyond the latest receipt.
- **Privacy:** the approved representation-safe projector and bounded non-executing diagnostics remain intact. Trusted authentication errors do not leak provider details. NPC private cognition is not exposed by public DTOs. Fog does not yet hide geography.
- **Compatibility:** schema 30 is one nullable metadata field, with a migration rather than reinitialization. New pinned content fails closed on mismatch. Legacy null pins cannot prove the old definition; no historical hash is fabricated. Existing world JSON remains byte-identical.
- **Outstanding engineering risks:** catch-up drains a full earned target using bounded internal chunks but lacks a total request work budget; a large backlog can occupy a worker. Session-host caches are unbounded. Content validation is not a general polygon Boolean engine. These are explicitly unfinished, not solved by a gameplay-time cap or speculative eviction.

## Unfinished work by owner

**Product decisions required:** approved world soldier ratios and size-tagged workout content; final readiness/progression prescriptions and defense participation rules; Level 1 backend/Unity content choice and legacy migration approval; located faction bank, stockpile/upkeep and physical Food transport; general player bank deployment/garrison contract; road costs/durations/effects, market pricing and scouting/visibility semantics; final Trade custody/stranding behavior. The prior user decision explicitly places Food bank/transport in a separately reviewed contract.

**Infrastructure required:** chosen identity provider and durable account mapping; approved non-production Supabase credentials and deployed RPC/RLS verification; TLS and request limits, host configuration, monitoring and private diagnostic retention; coordinated backups and a restore drill; hosted CI. No external provider was selected or provisioned.

**Engineering remaining:** bounded catch-up scheduling that preserves earned time and exact event order, persistence-safe host-cache eviction, larger-map/performance/load campaigns, full polygon overlap/coverage validation, and broader AI behavior/recovery validation. These have no completed implementation or production evidence in this run. The absent AI-SIM history must be recovered and reviewed before any claim that its MOVE/Trade fixes or 16-run cohort are integrated. Player reinforcement, fog/scouting and general resource transport also need the product contracts above before live commands are appropriate.

**Unity dependencies:** authenticate requests with the approved adapter contract, preserve lease/command sequencing, render server-locked and settled rewards without local calculation, handle legacy/specialized/unconfigured-content responses, compare definition identity, and validate Level 1 presentation against the chosen authored source. Unity/editor content and UI were intentionally untouched.

## Honest production verdict

1. **Basic playable loop?** Yes locally with explicit development authentication or an injected trusted test principal and fixture-authored reward content; the authenticated HTTP loop exercises it. This is not a ready-to-play production content claim.
2. **Integrated gameplay?** Existing workout/fitness/reward pipeline, banked attack, movement, invasion/battle/occupation, construction, economy/upkeep, Peace/Trade, events, campaign guards and A–L lifecycle, plus local formation.
3. **Incomplete systems?** General bank logistics/deployment, Food provisioning, roads/markets, live fog/scouting, final content and broad AI recovery/behavior remain partial or blocked as listed.
4. **Safe persistence?** Local/fake-adapter CAS and atomic world/history tests pass; actual hosted Supabase safety is not yet verified.
5. **Conflicting commands?** Yes in exercised receipt/CAS/reservation paths; stale drafts cannot overwrite the winning state.
6. **Deterministic simulation?** Yes for executed seeded, replay and supported live/catch-up tests. This does not prove every possible world or future Temporal V2 rule.
7. **Duplicate workout payouts?** Protected by the unchanged applied-reward ledger and tested retries/concurrency/restart paths.
8. **Production-safe authorization?** The boundary fails closed and rejects impersonation. An actual production credential verifier/account mapping is missing; launch remains blocked.
9. **Live Supabase verified?** No. Three tests are explicitly skipped, not passed.
10. **Ready to connect Unity?** Backend contracts are available for controlled integration. Current Unity authentication/content/reward presentation has not been executed here.
11. **Controlled non-production deployment?** Code is ready for review and adapter/configuration preparation; actual deployment testing requires the identity, test database and operational prerequisites. It is not deployed.
12. **Public mobile release?** No: authentication, live persistence, restore/monitoring, approved content and intended gameplay gaps remain.

## Next actions, in order

1. Review this isolated checkpoint, especially the public identity/API change and schema-30 content-pin migration. Do not merge automatically.
2. Approve/configure a non-production identity adapter and Supabase environment; execute the three live tests and a coordinated restore drill.
3. Approve production workout content and world soldier ratios; resolve the Level 1 content identity mismatch without silent save migration.
4. Specify the located-bank/physical-logistics contract, then player deployment/provisioning; settle fog/scouting, roads and market contracts separately.
5. Add measured host/catch-up work budgets and broader AI/recovery/load validation; preserve determinism, CAS and earned backlog.
6. Integrate and test the existing Unity application against reviewed API/content contracts. No public release before these gates pass.
